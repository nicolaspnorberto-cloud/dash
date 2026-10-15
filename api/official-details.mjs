import {assertSyncToken,json,readJson,writeJson} from '../lib/blob-store.mjs';
import {DETAILS_PATH,normalizeDetails,detailCoverage} from '../lib/official-details.mjs';
import {OFFICIAL_PATH} from '../lib/official-source.mjs';
export async function POST(request){try{assertSyncToken(request);const text=await request.text();if(text.length>12000000)return json({ok:false,error:'OUT_12 acima do limite.'},413);const data=normalizeDetails(JSON.parse(text));await writeJson(DETAILS_PATH,data);return json({ok:true,meta:data.meta});}catch(e){return json({ok:false,error:e.message},e.status||400);}}
export async function GET(request){
 const url=new URL(request.url),from=url.searchParams.get('from'),to=url.searchParams.get('to');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(to||'')||from>to)return json({ok:false,error:'Período inválido.'},400);
 const [data,official]=await Promise.all([readJson(DETAILS_PATH,null),readJson(OFFICIAL_PATH,null)]);
 const inPeriod=r=>r.lmreceived_date>=from&&r.lmreceived_date<=to,rows=(data?.rows||[]).filter(inPeriod);
 return json({ok:true,available:!!data,rows,meta:{...data?.meta,coverage:detailCoverage(rows,(official?.rows||[]).filter(inPeriod)),periodStart:from,periodEnd:to}});
}
