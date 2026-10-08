import { json, runtimeBinding } from '../lib/blob-store.mjs';
import { assertTrainingPin, trainingFileSchema, trainingAttachments, boundedTrainingForm, prepareTrainingFiles, trainingFileStatements, MAX_TRAINING_FILE_BYTES } from '../lib/training-files.mjs';
function database() { const db=runtimeBinding('MISSCAN_DB'); if(!db)throw Object.assign(new Error('Banco MISSCAN_DB não configurado.'),{status:503}); return db; }
export async function GET(request) {
  try {
    assertTrainingPin(request);
    const id=new URL(request.url).searchParams.get('id') || '';
    if(!/^[a-f0-9]{64}$/.test(id))return json({ok:false,error:'Arquivo inválido.'},400);
    const db=database();await trainingFileSchema(db);
    const file=await db.prepare('SELECT * FROM misscan_training_files WHERE id = ?').bind(id).first();
    if(!file)return json({ok:false,error:'Lista de presença não encontrada.'},404);
    const result=await db.prepare('SELECT chunk_index,data FROM misscan_training_file_chunks WHERE file_id = ? ORDER BY chunk_index').bind(id).all();
    const chunks=result.results || [];const bytes=new Uint8Array(Number(file.size));let offset=0;
    for(let i=0;i<chunks.length;i++) { const chunk=chunks[i];if(Number(chunk.chunk_index)!==i)throw new Error('Anexo incompleto.');const data=new Uint8Array(chunk.data);if(offset+data.length>bytes.length)throw new Error('Anexo inválido.');bytes.set(data,offset);offset+=data.length; }
    if(offset!==bytes.length)throw new Error('Anexo incompleto.');
    return new Response(bytes,{headers:{'content-type':file.mime_type,'content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
  }catch(e){return json({ok:false,error:e.message},e.status||500);}
}
export async function POST(request) {
  try {
    assertTrainingPin(request);
    const form=await boundedTrainingForm(request,MAX_TRAINING_FILE_BYTES+128*1024);
    const eventId=String(form.get('eventId')||'');
    if(!/^[\w-]{16,80}$/.test(eventId))throw new Error('Turma inválida.');
    const files=await prepareTrainingFiles(eventId,form.getAll('files'));
    if(files.length!==1)throw new Error('Envie um anexo por vez.');
    const db=database();await trainingFileSchema(db);
    if(!await db.prepare('SELECT id FROM misscan_training_events WHERE id = ?').bind(eventId).first())return json({ok:false,error:'Turma não encontrada.'},404);
    await db.batch(trainingFileStatements(db,files));
    return json({ok:true,attachments:await trainingAttachments(db,eventId)});
  }catch(e){return json({ok:false,error:e.message},e.status||(/Limite de 3/.test(e.message)?409:400));}
}
