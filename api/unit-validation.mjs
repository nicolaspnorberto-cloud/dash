import {assertSyncToken,json,readJson,writeJson} from '../lib/blob-store.mjs';
import {OFFICIAL_PATH} from '../lib/official-source.mjs';
import {DETAILS_PATH} from '../lib/official-details.mjs';
import {LM_SOURCE,SHARDS,ROOT,validBR,shardFor,validateBatch,classifyLM,officialBRRecords} from '../lib/unit-validation.mjs';
export async function POST(request){try{
 assertSyncToken(request);const text=await request.text();if(text.length>8000000)return json({ok:false,error:'Lote acima do limite.'},413);const body=JSON.parse(text);
 if(body.action==='batch'){const data=validateBatch(body),path=`${ROOT}/${data.generation}/${data.shard}`;await writeJson(path+'.json',data);await writeJson(path+'-meta.json',{count:data.rows.length});return json({ok:true,shard:data.shard,records:data.rows.length});}
 if(body.action!=='commit'||!/^\d{13}-[a-f0-9]{8}$/.test(body.generation||''))throw Error('Ação inválida.');
 const shards=await Promise.all(Array.from({length:SHARDS},(_,i)=>readJson(`${ROOT}/${body.generation}/${i}-meta.json`,null)));
 if(shards.some(v=>!v))throw Error('Importação incompleta: faltam partições.');
 const count=shards.reduce((s,v)=>s+v.count,0);if(!Number.isInteger(body.records)||count!==body.records||!count)throw Error('Quantidade importada divergente ou vazia.');
 const previous=await readJson(ROOT+'/manifest.json',null);if(previous&&Number(previous.generation.slice(0,13))>Number(body.generation.slice(0,13)))return json({ok:false,error:'Carga anterior à versão ativa.'},409);
 const manifest={source:LM_SOURCE,generation:body.generation,records:count,shards:SHARDS,receivedAt:new Date().toISOString(),purpose:'UNIT_VALIDATION_ONLY',officialTotalsUnchanged:true};
 await writeJson(ROOT+'/manifest.json',manifest);return json({ok:true,...manifest});
 }catch(e){return json({ok:false,error:e.message},e.status||400)}}
export async function GET(request){try{
 const u=new URL(request.url),br=String(u.searchParams.get('br')||'').trim().toUpperCase(),manifest=await readJson(ROOT+'/manifest.json',null);
 if(!br)return json({ok:true,available:!!manifest,...(manifest||{}),priority:['SOC_A_SOC_BR','SOC_A_SOC_OUT_12_EXAMPLES','MATINAL_LM'],warning:'OUT_12 contém exemplos e não representa cobertura completa por BR.'});
 if(!validBR(br))throw Error('BR inválido.');
 const [official,details,lm]=await Promise.all([readJson(OFFICIAL_PATH,null),readJson(DETAILS_PATH,null),manifest?readJson(`${ROOT}/${manifest.generation}/${shardFor(br)}.json`,null):null]);
 const authoritative=officialBRRecords(br,official,details),records=(lm?.rows||[]).filter(r=>String(r.values[0]).trim().toUpperCase()===br),validation=records.length?classifyLM(records):null;
 return json({ok:true,br,found:!!authoritative||!!validation,selectedSource:authoritative?.source||(validation?'MATINAL_LM':null),official:authoritative,matinal:validation,lmImportedAt:manifest?.receivedAt||null,officialTotalsUnchanged:true});
 }catch(e){return json({ok:false,error:e.message},e.status||400)}}
