import {envValue,json,runtimeBinding,readJson,writeJson} from '../lib/blob-store.mjs';
import {ABS_SOURCE,parseCSV,validateRoster,validateEvent} from '../lib/training.mjs';
import {trainingFileSchema,trainingAttachments,boundedTrainingForm,prepareTrainingFiles,trainingFileStatements} from '../lib/training-files.mjs';
const ROSTER='misscan/training-roster.json';
async function schema(){const db=runtimeBinding('MISSCAN_DB');if(!db)throw Object.assign(new Error('Banco MISSCAN_DB não configurado.'),{status:503});await trainingFileSchema(db);return db;}
function pin(request){const expected=envValue('TREATMENT_WRITE_PIN');if(!expected)throw Object.assign(new Error('PIN de gravação não configurado no Cloudflare.'),{status:503});if(request.headers.get('x-treatment-pin')!==expected)throw Object.assign(new Error('PIN de gravação inválido.'),{status:401});}
async function pullRoster(){
  const query='select C,G,K,N,O';
  const url=`https://docs.google.com/spreadsheets/d/${ABS_SOURCE.spreadsheetId}/gviz/tq?gid=${ABS_SOURCE.sheetId}&range=A4:O5000&headers=1&tqx=out:csv&tq=${encodeURIComponent(query)}`;
  const response=await fetch(url,{signal:AbortSignal.timeout(12000)});const text=await response.text();
  if(!response.ok||/^\s*</.test(text))throw new Error('A planilha ABS não permitiu leitura automática. Importe a lista validada ou sincronize pelo Apps Script.');
  const csv=parseCSV(text);if(!csv[0]?.some(v=>/colaborador/i.test(v)))throw new Error('Cabeçalho da COPPIT - ABS não reconhecido.');
  const rows=validateRoster(csv.slice(1).filter(r=>r[0]).map(r=>({name:r[0],shift:r[1],sector:r[2],leader:r[3],opsid:r[4]})));
  const roster={rows,source:ABS_SOURCE,updatedAt:new Date().toISOString()};await writeJson(ROSTER,roster);return roster;
}
export async function GET(){
  try {const db=await schema();let roster=await readJson(ROSTER,null),sourceError='';
    if(!roster)sourceError='Aguardando a primeira sincronização privada da COPPIT - ABS pelo Apps Script.';
    await trainingFileSchema(db);
    const [result,attachments]=await Promise.all([db.prepare('SELECT payload FROM misscan_training_events ORDER BY created_at DESC').all(),trainingAttachments(db)]);
    const byEvent=new Map();for(const file of attachments){if(!byEvent.has(file.eventId))byEvent.set(file.eventId,[]);byEvent.get(file.eventId).push(file);}
    return json({ok:true,roster:roster||{rows:[],source:ABS_SOURCE},sourceError,events:(result.results||[]).map(r=>{const event=JSON.parse(r.payload);return {...event,attachments:byEvent.get(event.id)||[]};})});
  }catch(e){return json({ok:false,error:e.message},e.status||500);}
}
export async function POST(request){
  try {pin(request);let body,files=[];
    if((request.headers.get('content-type')||'').startsWith('multipart/form-data')){const form=await boundedTrainingForm(request);const text=String(form.get('event')||'');if(text.length>3000000)throw new Error('Turma acima do limite.');body={action:'create',event:JSON.parse(text)};files=form.getAll('files');}
    else {if(Number(request.headers.get('content-length')||0)>3000000)return json({ok:false,error:'Arquivo acima do limite.'},413);const text=await request.text();if(text.length>3000000)return json({ok:false,error:'Arquivo acima do limite.'},413);body=JSON.parse(text);}
    const db=await schema();
    if(body.action==='refreshRoster'){return json({ok:true,roster:await pullRoster()});}
    if(body.action==='importRoster'){const roster={rows:validateRoster(body.rows),source:ABS_SOURCE,updatedAt:new Date().toISOString()};await writeJson(ROSTER,roster);return json({ok:true,roster});}
    if(body.action!=='create')return json({ok:false,error:'Ação inválida.'},400);
    const roster=await readJson(ROSTER,null);if(!roster?.rows?.length)throw new Error('Carregue a lista ABS antes de registrar uma turma.');
    const event=validateEvent(body.event||{},roster.rows);
    if(new TextEncoder().encode(JSON.stringify(event)).length>1500000)throw new Error('Turma muito grande. Divida os participantes em turmas menores.');
    const preparedFiles=await prepareTrainingFiles(event.id,files);
    await trainingFileSchema(db);
    const existing=await db.prepare('SELECT payload FROM misscan_training_events WHERE id = ?').bind(event.id).first();
    if(existing){const saved=JSON.parse(existing.payload);const canonical=e=>JSON.stringify({...e,createdAt:undefined});if(canonical(saved)!==canonical(event))return json({ok:false,error:'Identificador já usado por outra turma.'},409);}
    const statements=trainingFileStatements(db,preparedFiles);
    if(!existing)statements.unshift(db.prepare('INSERT INTO misscan_training_events (id,payload,created_at) VALUES (?,?,?)').bind(event.id,JSON.stringify(event),event.createdAt));
    if(statements.length)await db.batch(statements);
    const saved=await db.prepare('SELECT payload FROM misscan_training_events WHERE id = ?').bind(event.id).first();return json({ok:true,event:{...JSON.parse(saved.payload),attachments:await trainingAttachments(db,event.id)}});
  }catch(e){return json({ok:false,error:e.message},e.status||400);}
}
