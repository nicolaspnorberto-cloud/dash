import {json,readJson} from '../lib/blob-store.mjs';
import {ROOT,SHARDS} from '../lib/unit-validation.mjs';
import {DETAILS_PATH} from '../lib/official-details.mjs';
import {officialPersonBRs,lmPersonBRs} from '../lib/operator-errors.mjs';
export async function GET(request){try{
 const u=new URL(request.url),from=u.searchParams.get('from')||'',to=u.searchParams.get('to')||'',opsid=(u.searchParams.get('opsid')||'').trim().toUpperCase(),name=(u.searchParams.get('name')||'').trim();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to||!/^OPS\d+$/.test(opsid)&&(!name||name.length>200))throw Error('Informe período e colaborador válidos.');
 const person={opsid,name},raw=u.searchParams.get('shard');
 if(raw===null){const data=await readJson(DETAILS_PATH,null);return json({ok:true,available:!!data,...officialPersonBRs(data,person,from,to)});}
 const shard=Number(raw);if(!Number.isInteger(shard)||shard<0||shard>=SHARDS)throw Error('Partição inválida.');
 const manifest=await readJson(ROOT+'/manifest.json',null);if(!manifest)return json({ok:true,available:false,rows:[],nextShard:null});
 const generation=u.searchParams.get('generation');if(generation&&generation!==manifest.generation)return json({ok:false,error:'A LM foi atualizada durante a consulta. Consulte novamente.'},409);
 const data=await readJson(`${ROOT}/${manifest.generation}/${shard}.json`,null);if(!data)throw Error('Partição LM indisponível.');
 return json({ok:true,available:true,rows:lmPersonBRs(data,person,from,to),generation:manifest.generation,nextShard:shard+1<SHARDS?shard+1:null,updatedAt:manifest.receivedAt});
 }catch(e){return json({ok:false,error:e.message},400)}}
