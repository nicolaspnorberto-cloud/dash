import {json,runtimeBinding} from '../lib/blob-store.mjs';
import {assertTrainingPin,boundedTrainingForm} from '../lib/training-files.mjs';
import {validateAnomaly,updateAnomaly,anomalyReport,validateAnomalyPeriod} from '../lib/anomalies.mjs';
import {prepareAnomalyFiles,anomalyFileStatements} from '../lib/anomaly-files.mjs';
const schemas=new WeakMap();
export async function anomalyDatabase(){
 const db=runtimeBinding('MISSCAN_DB');if(!db)throw Object.assign(new Error('Banco MISSCAN_DB não configurado.'),{status:503});
 if(!schemas.has(db)){const task=(async()=>{
  await db.prepare('CREATE TABLE IF NOT EXISTS misscan_anomalies(id TEXT PRIMARY KEY,payload TEXT NOT NULL,observed_date TEXT NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_anomalies_date ON misscan_anomalies(observed_date)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS misscan_anomaly_files(id TEXT PRIMARY KEY,anomaly_id TEXT NOT NULL REFERENCES misscan_anomalies(id),name TEXT NOT NULL,mime_type TEXT NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS misscan_anomaly_file_chunks(file_id TEXT NOT NULL REFERENCES misscan_anomaly_files(id),chunk_index INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(file_id,chunk_index))').run();
 })().catch(e=>{schemas.delete(db);throw e;});schemas.set(db,task);}await schemas.get(db);return db;
}
export async function GET(request){try{
 assertTrainingPin(request);
 const url=new URL(request.url),from=url.searchParams.get('from')||'',to=url.searchParams.get('to')||'';validateAnomalyPeriod(from,to);const db=await anomalyDatabase();
 const args=[],where=[];if(from){where.push('observed_date>=?');args.push(from);}if(to){where.push('observed_date<=?');args.push(to);}
 const result=await db.prepare('SELECT payload FROM misscan_anomalies'+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY observed_date DESC,id LIMIT 10001').bind(...args).all();
 if(result.results.length>10000)return json({ok:false,error:'Mais de 10 mil registros no período. Reduza o intervalo para analisar a base completa.'},422);
 const periodRows=result.results.map(r=>JSON.parse(r.payload));
 const text=s=>String(s||'').toLocaleLowerCase('pt-BR');const q=text(url.searchParams.get('q'));
 const rows=periodRows.filter(r=>['shift','area','process','activity','status','leader','reporter','theme','synergy'].every(k=>!url.searchParams.get(k)||(k==='shift'&&url.searchParams.get(k)==='unknown'?!r.shift:k==='status'&&url.searchParams.get(k)==='PENDING'?r.status!=='CLOSED':r[k]===url.searchParams.get(k)))&&(!q||text([r.activity,r.description,r.theme,r.leader,r.reporter].join(' ')).includes(q)));
 // Earlier closures remain relevant when the selected interval starts later.
 const closed=await db.prepare('SELECT payload FROM misscan_anomalies WHERE observed_date<=? LIMIT 10001').bind(to||'9999-12-31').all();
 if(closed.results.length>10000)return json({ok:false,error:'Histórico de recorrências excedeu 10 mil registros; revisão da consulta necessária.'},422);
 const report=anomalyReport(rows,closed.results.map(r=>JSON.parse(r.payload)));
 const source=await db.prepare('SELECT COUNT(*) AS total,MAX(updated_at) AS updatedAt FROM misscan_anomalies').first();
 const attachments=(await db.prepare('SELECT id,anomaly_id,name,mime_type,size FROM misscan_anomaly_files').all()).results||[];
 report.rows=report.rows.map(r=>({...r,attachments:attachments.filter(f=>f.anomaly_id===r.id).map(f=>({id:f.id,name:f.name,type:f.mime_type,size:f.size}))}));
 const options=Object.fromEntries(['area','process','activity','leader','reporter','theme','synergy'].map(k=>[k,[...new Set(periodRows.map(r=>r[k]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'))]));
 return json({ok:true,...report,options,source:{kind:'BASE_PROPRIA_MG4',total:source.total,updatedAt:source.updatedAt},period:{from,to}});
}catch(e){return json({ok:false,error:e.message},e.status||400);}}
export async function POST(request){try{
 assertTrainingPin(request);let body,files=[];
 if((request.headers.get('content-type')||'').startsWith('multipart/form-data')){const form=await boundedTrainingForm(request);body=JSON.parse(String(form.get('record')||''));files=form.getAll('files');}
 else{const raw=await request.text();if(raw.length>30000)return json({ok:false,error:'Registro acima do limite.'},413);body=JSON.parse(raw);}
 const db=await anomalyDatabase();
 if(body.action==='create'){
  const row=validateAnomaly(body.record||{}),prepared=await prepareAnomalyFiles(row.id,files);
  const old=await db.prepare('SELECT payload FROM misscan_anomalies WHERE id=?').bind(row.id).first();
  if(old){const saved=JSON.parse(old.payload);const fields=['id','area','process','activity','theme','synergy','oriented','description','reporter','leader','shift','priority','dueDate','observedAt'];if(fields.some(k=>JSON.stringify(saved[k]??(k==='oriented'?null:''))!==JSON.stringify(row[k]??(k==='oriented'?null:''))))return json({ok:false,error:'Identificador já utilizado por outra ocorrência.'},409);return json({ok:true,record:saved,duplicate:true});}
  await db.batch([db.prepare('INSERT INTO misscan_anomalies(id,payload,observed_date,version,updated_at) VALUES(?,?,?,?,?)').bind(row.id,JSON.stringify(row),row.observedDate,row.version,row.updatedAt),...anomalyFileStatements(db,prepared)]);
  return json({ok:true,record:row});
 }
 if(body.action==='update'){
  const old=await db.prepare('SELECT payload FROM misscan_anomalies WHERE id=?').bind(String(body.id||'')).first();if(!old)return json({ok:false,error:'Ocorrência não encontrada.'},404);
  const row=updateAnomaly(JSON.parse(old.payload),body),changed=await db.prepare('UPDATE misscan_anomalies SET payload=?,version=?,updated_at=? WHERE id=? AND version=? RETURNING id').bind(JSON.stringify(row),row.version,row.updatedAt,row.id,body.version).first();
  if(!changed)return json({ok:false,error:'Registro alterado por outra pessoa. Atualize a consulta.'},409);return json({ok:true,record:row});
 }
 return json({ok:false,error:'Ação inválida.'},400);
}catch(e){return json({ok:false,error:e.message},e.status||400);}}
