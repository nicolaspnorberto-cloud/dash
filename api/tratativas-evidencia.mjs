import { envValue, json, runtimeBinding } from '../lib/blob-store.mjs';

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const CHUNK_CHARS = 500_000;
let schemaReady = null;

function db() {
  const value = runtimeBinding('MISSCAN_DB');
  if (!value) {
    const error = new Error('Banco compartilhado MISSCAN_DB não configurado.');
    error.status = 503;
    throw error;
  }
  return value;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db().prepare(`
        CREATE TABLE IF NOT EXISTS misscan_treatment_files (
          id TEXT PRIMARY KEY,
          treatment_id TEXT NOT NULL,
          cycle INTEGER NOT NULL,
          kind TEXT NOT NULL,
          signature_type TEXT,
          name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `).run();
      await db().prepare(`
        CREATE TABLE IF NOT EXISTS misscan_treatment_file_chunks (
          file_id TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (file_id, chunk_index)
        )
      `).run();
      await db().prepare(`
        CREATE INDEX IF NOT EXISTS idx_misscan_treatment_files_cycle
        ON misscan_treatment_files (treatment_id, cycle, created_at)
      `).run();
    })().catch(error => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

function assertWritePin(request) {
  const expected = envValue('TREATMENT_WRITE_PIN');
  if (!expected) {
    const error = new Error('Defina o segredo TREATMENT_WRITE_PIN no Cloudflare para liberar gravações compartilhadas.');
    error.status = 503;
    throw error;
  }
  const received = String(request.headers.get('x-treatment-pin') || '').trim();
  if (!received || received !== expected) {
    const error = new Error('PIN de gravação inválido.');
    error.status = 401;
    throw error;
  }
}

function itemFromRow(row) {
  return {
    id: row.id,
    treatmentId: row.treatment_id,
    cycle: Number(row.cycle),
    kind: row.kind,
    signatureType: row.signature_type || null,
    name: row.name,
    type: row.mime_type,
    size: Number(row.size || 0),
    createdAt: row.created_at,
    shared: true
  };
}

async function fileById(id, includeFile) {
  const row = await db().prepare(`
    SELECT * FROM misscan_treatment_files WHERE id = ? LIMIT 1
  `).bind(id).first();
  if (!row) return null;
  const item = itemFromRow(row);
  if (includeFile) {
    const chunks = await db().prepare(`
      SELECT value FROM misscan_treatment_file_chunks
      WHERE file_id = ? ORDER BY chunk_index
    `).bind(id).all();
    item.fileBase64 = (chunks.results || []).map(chunk => chunk.value || '').join('');
  }
  return item;
}

export async function GET(request) {
  await ensureSchema();
  const url = new URL(request.url);
  const id = String(url.searchParams.get('id') || '').trim();
  if (id) {
    const item = await fileById(id, url.searchParams.get('includeFile') === '1');
    if (!item) return json({ ok: false, error: 'Arquivo não encontrado.' }, 404);
    return json({ ok: true, item });
  }
  const treatmentId = String(url.searchParams.get('treatmentId') || '').trim();
  const cycle = Number(url.searchParams.get('cycle') || 0);
  if (!treatmentId || !cycle) {
    return json({ ok: false, error: 'treatmentId e cycle são obrigatórios.' }, 400);
  }
  const result = await db().prepare(`
    SELECT * FROM misscan_treatment_files
    WHERE treatment_id = ? AND cycle = ?
    ORDER BY created_at DESC
  `).bind(treatmentId, cycle).all();
  return json({ ok: true, items: (result.results || []).map(itemFromRow) });
}

async function deleteFile(id) {
  await db().batch([
    db().prepare('DELETE FROM misscan_treatment_file_chunks WHERE file_id = ?').bind(id),
    db().prepare('DELETE FROM misscan_treatment_files WHERE id = ?').bind(id)
  ]);
}

export async function POST(request) {
  assertWritePin(request);
  await ensureSchema();
  const body = await request.json().catch(() => ({}));
  if (body.action === 'delete') {
    const id = String(body.id || '').trim();
    if (!id) return json({ ok: false, error: 'ID obrigatório.' }, 400);
    await deleteFile(id);
    return json({ ok: true });
  }
  if (body.action !== 'save') return json({ ok: false, error: 'Ação inválida.' }, 400);

  const id = String(body.id || '').trim().slice(0, 240);
  const treatmentId = String(body.treatmentId || '').trim().slice(0, 240);
  const cycle = Math.min(3, Math.max(1, Number(body.cycle) || 0));
  const base64 = String(body.fileBase64 || '').replace(/^data:[^,]+,/, '');
  const estimatedBytes = Math.floor(base64.length * 3 / 4);
  if (!id || !treatmentId || !base64) {
    return json({ ok: false, error: 'Dados da evidência incompletos.' }, 400);
  }
  if (estimatedBytes > MAX_FILE_BYTES || Number(body.size || 0) > MAX_FILE_BYTES) {
    return json({ ok: false, error: 'Arquivo acima de 4 MB. Reduza o arquivo antes de enviar.' }, 413);
  }

  const now = new Date().toISOString();
  const createdAt = String(body.createdAt || now);
  const kind = ['evidence', 'signature', 'dialogue-evidence'].includes(body.kind)
    ? body.kind
    : 'evidence';
  await deleteFile(id);
  await db().prepare(`
    INSERT INTO misscan_treatment_files
      (id, treatment_id, cycle, kind, signature_type, name, mime_type, size, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    treatmentId,
    cycle,
    kind,
    body.signatureType ? String(body.signatureType).slice(0, 40) : null,
    String(body.name || 'arquivo').slice(0, 240),
    String(body.type || 'application/octet-stream').slice(0, 120),
    Number(body.size || estimatedBytes),
    createdAt,
    now
  ).run();
  for (let offset = 0, index = 0; offset < base64.length; offset += CHUNK_CHARS, index++) {
    await db().prepare(`
      INSERT INTO misscan_treatment_file_chunks (file_id, chunk_index, value)
      VALUES (?, ?, ?)
    `).bind(id, index, base64.slice(offset, offset + CHUNK_CHARS)).run();
  }
  const item = await fileById(id, false);
  return json({ ok: true, item });
}
