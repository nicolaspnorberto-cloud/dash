import {importDailyDialogues} from '../lib/daily-dialogue-history.mjs';
import {reconcileDailyRows} from '../lib/daily-reconciliation.mjs';
import {envValue,json,readJson} from '../lib/blob-store.mjs';
import {OFFICIAL_PATH} from '../lib/official-source.mjs';
import {PRESENCE_PATH,saoPauloPresenceDate} from '../lib/abs-presence.mjs';
import {presenceForTreatments} from './treatment-presence.mjs';
import {DAILY_CONFIG,dailySchema,dailyRows,dailyContext,syncDailyHistory,changeDailyRecord} from '../lib/daily-treatment-history.mjs';

function privateJson(data,status=200){const response=json(data,status);response.headers.set('cache-control','private, no-store, max-age=0');response.headers.set('Vary','x-treatment-pin');return response;}

export async function POST(request){
  try{
    const expected=envValue('TREATMENT_WRITE_PIN');
    if(!expected)return json({ok:false,error:'Consulta indisponível.'},503);
    if(String(request.headers.get('x-treatment-pin')||'').trim()!==expected)return json({ok:false,error:'PIN de tratativas inválido.'},401);
    const text=await request.text();if(text.length>1400000)return json({ok:false,error:'Requisição acima do limite.'},413);
    const body=JSON.parse(text);
    if(!['list','refresh','link','confirm-pending','import-dialogues'].includes(body.action))throw new Error('Ação inválida.');
    if(body.action==='import-dialogues')return privateJson({ok:true,...await importDailyDialogues(body.snapshot)});
    if(text.length>20000)return privateJson({ok:false,error:'Requisição acima do limite.'},413);
    const db=await dailySchema();
    if(body.action==='refresh'){
      const official=await readJson(OFFICIAL_PATH,null);if(!official?.rows?.length)throw new Error('Fonte oficial MG4 indisponível.');
      // Divide a primeira importação em semanas para não esgotar a CPU do Worker.
      const today=saoPauloPresenceDate();
      const days=[...new Set((official.rows||[]).map(r=>r.lmreceived_date).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d<today))].sort();
      const start=body.cursor?days.indexOf(body.cursor):0;
      if(start<0)throw new Error('Continuação da importação inválida; inicie novamente.');
      const page=days.slice(start,start+7),continuation=days[start+7]||null;
      const result=await syncDailyHistory(official,{activate:true,from:page[0],to:page.at(-1)});
      return privateJson({ok:true,continuation,importComplete:!continuation,imported:result.records,through:page.at(-1)});
    }
    let rows=await dailyRows(db);
    const context=await dailyContext(db);
    if(['link','confirm-pending'].includes(body.action)){await changeDailyRecord(db,body,rows,context.evidence);rows=await dailyRows(db);}
    const today=saoPauloPresenceDate();
    const entries=[...new Map(rows.filter(r=>r.opsid&&/^T[1-3]$/.test(r.turno)).map(r=>[r.opsid+'|'+r.turno,{opsid:r.opsid,turno:r.turno}])).values()];
    const evidenceKeys=new Set(context.evidence.map(e=>e.key));
    const presence=presenceForTreatments(entries,await readJson(PRESENCE_PATH,null));
    const byKey=new Map(presence.map(p=>[p.opsid+'|'+p.turno,p]));
    rows=rows.map(row=>({...row,presence:byKey.get(row.opsid+'|'+row.turno)||null,
      occurrenceAgeDays:Math.max(0,Math.round((Date.parse(today)-Date.parse(row.date))/86400000)),
      ageDays:row.state==='PENDING'?Math.max(0,Math.round((Date.parse(today)-Date.parse(row.date))/86400000)):null,
      evidenceCurrent:row.evidence?evidenceKeys.has(row.evidence.key):null}));
    rows=reconcileDailyRows(rows,context.evidence,{dialogueDates:context.dialogueDates,dialogueUpdatedAt:context.dialogueUpdatedAt,today});
    const involved=new Set(rows.map(r=>r.opsid).filter(Boolean));
    const result=json({ok:true,config:await readJson(DAILY_CONFIG,null),rows,evidence:context.evidence.filter(e=>involved.has(e.opsid)),dialogueSource:{updatedAt:context.dialogueUpdatedAt,coveredDays:context.dialogueDates.length,historical:context.dialogueHistorical},sourceUpdatedAt:context.official.meta.receivedAt,checkedAt:new Date().toISOString(),today});
    result.headers.set('cache-control','private, no-store, max-age=0');result.headers.set('Vary','x-treatment-pin');return result;
  }catch(error){
    const conflict=/UNIQUE constraint failed/i.test(error.message);
    return json({ok:false,error:conflict?'Tratativa já vinculada a outra ocorrência; recarregue o histórico.':error.message},conflict?409:error.status||400);
  }
}
