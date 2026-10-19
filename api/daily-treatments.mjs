import {envValue,json,readJson} from '../lib/blob-store.mjs';
import {OFFICIAL_PATH} from '../lib/official-source.mjs';
import {PRESENCE_PATH,saoPauloPresenceDate} from '../lib/abs-presence.mjs';
import {presenceForTreatments} from './treatment-presence.mjs';
import {DAILY_CONFIG,dailySchema,dailyRows,dailyContext,syncDailyHistory,changeDailyRecord} from '../lib/daily-treatment-history.mjs';

export async function POST(request){
  try{
    const expected=envValue('TREATMENT_WRITE_PIN');
    if(!expected)return json({ok:false,error:'Consulta indisponível.'},503);
    if(String(request.headers.get('x-treatment-pin')||'').trim()!==expected)return json({ok:false,error:'PIN de tratativas inválido.'},401);
    const text=await request.text();if(text.length>20000)return json({ok:false,error:'Requisição acima do limite.'},413);
    const body=JSON.parse(text);
    if(!['list','refresh','link','confirm-pending'].includes(body.action))throw new Error('Ação inválida.');
    const db=await dailySchema();
    if(body.action==='refresh'){
      const official=await readJson(OFFICIAL_PATH,null);if(!official?.rows?.length)throw new Error('Fonte oficial MG4 indisponível.');
      await syncDailyHistory(official,{activate:true});
    }
    let rows=await dailyRows(db);
    const context=await dailyContext(db);
    if(['link','confirm-pending'].includes(body.action)){await changeDailyRecord(db,body,rows,context.evidence);rows=await dailyRows(db);}
    const today=saoPauloPresenceDate();
    const presence=presenceForTreatments(rows.filter(r=>r.opsid&&/^T[1-3]$/.test(r.turno)),await readJson(PRESENCE_PATH,null));
    const byKey=new Map(presence.map(p=>[p.opsid+'|'+p.turno,p]));
    rows=rows.map(row=>({...row,presence:byKey.get(row.opsid+'|'+row.turno)||null,
      ageDays:row.state==='PENDING'?Math.max(0,Math.round((Date.parse(today)-Date.parse(row.date))/86400000)):null,
      evidenceCurrent:row.evidence?context.evidence.some(e=>e.key===row.evidence.key):null}));
    const involved=new Set(rows.map(r=>r.opsid).filter(Boolean));
    const result=json({ok:true,config:await readJson(DAILY_CONFIG,null),rows,evidence:context.evidence.filter(e=>involved.has(e.opsid)),sourceUpdatedAt:context.official.meta.receivedAt,checkedAt:new Date().toISOString(),today});
    result.headers.set('cache-control','private, no-store, max-age=0');result.headers.set('Vary','x-treatment-pin');return result;
  }catch(error){
    const conflict=/UNIQUE constraint failed/i.test(error.message);
    return json({ok:false,error:conflict?'Tratativa já vinculada a outra ocorrência; recarregue o histórico.':error.message},conflict?409:error.status||400);
  }
}
