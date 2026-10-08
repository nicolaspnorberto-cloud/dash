import { envValue } from './blob-store.mjs';
export const MAX_TRAINING_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_TRAINING_FILES = 3;
export const MAX_TRAINING_BODY_BYTES = MAX_TRAINING_FILE_BYTES * MAX_TRAINING_FILES + 128 * 1024;
const CHUNK_BYTES = 500_000;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function assertTrainingPin(request) {
  const expected = envValue('TREATMENT_WRITE_PIN');
  if (!expected) throw fail('PIN de gravação não configurado no Cloudflare.', 503);
  if (request.headers.get('x-treatment-pin') !== expected) throw fail('PIN inválido. Informe o PIN das tratativas.', 401);
}
const schemas = new WeakMap();
export function trainingFileSchema(db) {
  if(schemas.has(db))return schemas.get(db);
  const ready = (async()=>{
  await db.prepare('CREATE TABLE IF NOT EXISTS misscan_training_events (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL)').run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS misscan_training_files (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES misscan_training_events(id),
    name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS misscan_training_file_chunks (
    file_id TEXT NOT NULL REFERENCES misscan_training_files(id), chunk_index INTEGER NOT NULL,
    data BLOB NOT NULL, PRIMARY KEY(file_id, chunk_index)
  )`).run();
  await db.prepare(`CREATE TRIGGER IF NOT EXISTS misscan_training_file_limit BEFORE INSERT ON misscan_training_files
    WHEN NOT EXISTS (SELECT 1 FROM misscan_training_files WHERE id=NEW.id)
    AND (SELECT COUNT(*) FROM misscan_training_files WHERE event_id=NEW.event_id) >= ${MAX_TRAINING_FILES}
    BEGIN SELECT RAISE(ABORT, 'Limite de 3 anexos por turma.'); END`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_training_files_event ON misscan_training_files(event_id)').run();
  })().catch(error=>{schemas.delete(db);throw error;});
  schemas.set(db,ready);return ready;
}
export function fileMetadata(row) {
  return { id: row.id, eventId: row.event_id, name: row.name, type: row.mime_type, size: Number(row.size), createdAt: row.created_at };
}
export async function trainingAttachments(db, eventId = '') {
  const sql = 'SELECT id,event_id,name,mime_type,size,created_at FROM misscan_training_files';
  const query = eventId ? db.prepare(sql+' WHERE event_id = ? ORDER BY created_at').bind(eventId) : db.prepare(sql+' ORDER BY created_at');
  return ((await query.all()).results || []).map(fileMetadata);
}
export async function boundedTrainingForm(request, maxBytes = MAX_TRAINING_BODY_BYTES) {
  if (Number(request.headers.get('content-length') || 0) > maxBytes) throw fail('Anexos acima do limite permitido.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw fail('Formulário vazio.');
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw fail('Anexos acima do limite permitido.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new Response(bytes, { headers: { 'content-type': request.headers.get('content-type') || '' } }).formData();
}
export async function prepareTrainingFiles(eventId, files) {
  if (files.length > MAX_TRAINING_FILES) throw fail('Selecione até 3 anexos por turma.');
  const output = [], seen = new Set();
  for (const file of files) {
    if (!file || typeof file.arrayBuffer !== 'function' || !file.name || !file.size) throw fail('Arquivo vazio ou inválido.');
    if (file.size > MAX_TRAINING_FILE_BYTES) throw fail('Cada arquivo deve ter no máximo 4 MB.', 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let type = '';
    if (bytes[0]===37 && bytes[1]===80 && bytes[2]===68 && bytes[3]===70 && bytes[4]===45) type = 'application/pdf';
    else if ([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)) type = 'image/png';
    else if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) type = 'image/jpeg';
    const extension = String(file.name).split('.').pop().toLowerCase();
    if (!type || !({'application/pdf':['pdf'],'image/png':['png'],'image/jpeg':['jpg','jpeg']}[type].includes(extension)) || (file.type && file.type !== type)) {
      throw fail('Use PDF, JPG ou PNG válido. O conteúdo deve corresponder ao formato do arquivo.');
    }
    const name = String(file.name).replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,180);
    const contentHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
    const identity = new TextEncoder().encode(eventId+'|'+name+'|'+contentHash);
    const id = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',identity))).map(v=>v.toString(16).padStart(2,'0')).join('');
    if (!seen.has(id)) output.push({id,eventId,name,type,size:bytes.length,bytes,createdAt:new Date().toISOString()});
    seen.add(id);
  }
  return output;
}
export function trainingFileStatements(db, files) {
  const statements = [];
  for (const file of files) {
    statements.push(db.prepare('INSERT OR IGNORE INTO misscan_training_files (id,event_id,name,mime_type,size,created_at) VALUES (?,?,?,?,?,?)').bind(file.id,file.eventId,file.name,file.type,file.size,file.createdAt));
    for (let offset=0,index=0; offset<file.bytes.length; offset+=CHUNK_BYTES,index++) {
      statements.push(db.prepare('INSERT OR IGNORE INTO misscan_training_file_chunks (file_id,chunk_index,data) VALUES (?,?,?)').bind(file.id,index,file.bytes.slice(offset,offset+CHUNK_BYTES).buffer));
    }
  }
  return statements;
}
