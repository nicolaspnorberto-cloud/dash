import {json} from '../lib/blob-store.mjs';
import {assertTrainingPin} from '../lib/training-files.mjs';
import {anomalyDatabase} from './anomalias.mjs';
export async function GET(request){try{
 assertTrainingPin(request);const id=new URL(request.url).searchParams.get('id')||'';if(!/^[a-f0-9]{64}$/.test(id))return json({ok:false,error:'Arquivo inválido.'},400);
 const db=await anomalyDatabase(),f=await db.prepare('SELECT * FROM misscan_anomaly_files WHERE id=?').bind(id).first();if(!f)return json({ok:false,error:'Arquivo não encontrado.'},404);
 const chunks=(await db.prepare('SELECT chunk_index,data FROM misscan_anomaly_file_chunks WHERE file_id=? ORDER BY chunk_index').bind(id).all()).results,bytes=new Uint8Array(f.size);let offset=0;
 for(let i=0;i<chunks.length;i++){if(chunks[i].chunk_index!==i)throw new Error('Anexo incompleto.');const part=new Uint8Array(chunks[i].data);if(offset+part.length>bytes.length)throw new Error('Anexo inválido.');bytes.set(part,offset);offset+=part.length;}if(offset!==bytes.length)throw new Error('Anexo incompleto.');
 return new Response(bytes,{headers:{'content-type':f.mime_type,'content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
}catch(e){return json({ok:false,error:e.message},e.status||400);}}
