import {withReportCache} from '../lib/report-cache.mjs';
import {json,readJson,readHistoryRange} from '../lib/blob-store.mjs';
import {OFFICIAL_PATH} from '../lib/official-source.mjs';
import {buildCalendarRates,calendarAddDays} from '../lib/calendar-rates.mjs';
const cachedReport=withReportCache(buildReport);
export async function GET(request){return cachedReport(request)}
async function buildReport(request){try{
 const url=new URL(request.url),value=Number(url.searchParams.get('days')||14),days=Number.isFinite(value)?Math.max(1,Math.min(90,Math.floor(value))):14;
 const [gerot,official,hcFile,histMeta]=await Promise.all([readJson('misscan/gerot.json',null),readJson(OFFICIAL_PATH,null),readJson('misscan/hc.json',{rows:[]}),readJson('misscan/history-meta.json',null)]);
 if(!gerot)return json({ok:false,error:'GEROT ainda não sincronizada.'},503);
 const meta=official?.meta||histMeta,end=String(meta?.historyEnd||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(end))return json({ok:false,error:'Histórico Misscan ainda não sincronizado.'},503);
 const start=calendarAddDays(end,1-days),rows=official?.rows||await readHistoryRange(start,end,histMeta);
 const result=buildCalendarRates({rows,knownDays:meta.days||Object.keys(meta.dayStats||{}),gerot,hc:official?.hc||hcFile.rows||[],start,end,days,official:!!official});result.misscanMeta={historyStart:meta.historyStart,historyEnd:meta.historyEnd,source:official?'OFFICIAL_OUT_05_MG4':'MATINAL_LM'};return json(result);
}catch(error){console.error('CALENDAR_RATES_ERROR',error);return json({ok:false,error:error.message||'Falha ao calcular referência histórica.'},500)}}
