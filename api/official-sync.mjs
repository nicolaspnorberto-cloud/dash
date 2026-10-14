import {assertSyncToken,json,readJson,writeJson} from '../lib/blob-store.mjs';
import {OFFICIAL_PATH,normalizeOfficial} from '../lib/official-source.mjs';
export async function GET(){const data=await readJson(OFFICIAL_PATH,null);return json({ok:true,enabled:!!data,meta:data?.meta||null});}
export async function POST(request){try{assertSyncToken(request);const text=await request.text();if(text.length>6000000)return json({ok:false,error:'Base oficial acima do limite.'},413);const data=normalizeOfficial(JSON.parse(text));await writeJson(OFFICIAL_PATH,data);return json({ok:true,records:data.rows.length,hc:data.hc.length,meta:data.meta});}catch(error){return json({ok:false,error:error.message},error.status||400);}}
