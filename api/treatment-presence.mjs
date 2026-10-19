import {envValue,json,readJson} from '../lib/blob-store.mjs';
import {PRESENCE_PATH,PRESENCE_MAX_AGE_MS,saoPauloPresenceDate,selectPresentTreatments} from '../lib/abs-presence.mjs';
import {normalizeOpsId} from '../lib/dialogues-realized.mjs';

export function presenceForTreatments(entries,snapshot,now=new Date()){
  const today=saoPauloPresenceDate(now);
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'}).format(now));
  const yesterday=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10);
  const checks=new Map();
  const candidates=[...new Set(entries.map(entry=>normalizeOpsId(entry.opsid)))].map(opsid=>({opsid,done:false}));
  return entries.map(entry=>{
    const opsid=normalizeOpsId(entry.opsid);
    const turn=String(entry.turno||'').trim().toUpperCase();
    const night=['T3','T5'].includes(turn)&&hour<6;
    const dateKey=night?yesterday:today;
    const data=snapshot?.dateKey===dateKey?snapshot:snapshot?.previousDay;
    if(!checks.has(dateKey)){
      const selection=selectPresentTreatments(candidates,snapshot,{now,dateKey});
      const statuses=new Map(selection.deferred.map(row=>[row.opsid,row.presenceReason==='absent'?'ABSENT':'UNKNOWN']));
      selection.eligible.forEach(row=>statuses.set(row.opsid,'PRESENT'));
      checks.set(dateKey,{available:selection.available,statuses});
    }
    const selection=checks.get(dateKey);
    const status=selection.statuses.get(opsid)||'UNKNOWN';
    // Expira também na mudança de data ou na troca da referência noturna às 06h.
    const boundary=night?Date.parse(today+'T06:00:00-03:00'):Date.parse(today+'T00:00:00-03:00')+86400000;
    const expiry=selection.available?Math.min(Date.parse(data.generatedAt)+PRESENCE_MAX_AGE_MS,boundary):now.getTime();
    return {opsid,turno:turn,dateKey,status,generatedAt:data?.generatedAt||'',validUntil:new Date(expiry).toISOString()};
  });
}

export async function POST(request){
  try{
    const expected=envValue('TREATMENT_WRITE_PIN');
    if(!expected)return json({ok:false,error:'Consulta de presença indisponível.'},503);
    if(String(request.headers.get('x-treatment-pin')||'').trim()!==expected)return json({ok:false,error:'PIN de tratativas inválido.'},401);
    const text=await request.text();
    if(text.length>200000)return json({ok:false,error:'Consulta acima do limite.'},413);
    const body=JSON.parse(text);
    if(!Array.isArray(body.entries)||body.entries.length>2500)throw new Error('Lista de consulta inválida.');
    const entries=body.entries.map(entry=>{
      if(!entry||!/^OPS\d+$/.test(normalizeOpsId(entry.opsid))||!/^T[1-5]$/.test(String(entry.turno||'')))throw new Error('OPSID ou turno inválido.');
      return {opsid:normalizeOpsId(entry.opsid),turno:entry.turno};
    });
    const snapshot=await readJson(PRESENCE_PATH,null);
    const response=json({ok:true,source:'ABS',checkedAt:new Date().toISOString(),rows:presenceForTreatments(entries,snapshot)});
    response.headers.set('cache-control','private, no-store, max-age=0');
    response.headers.set('Vary','x-treatment-pin');
    return response;
  }catch(error){return json({ok:false,error:error.message||'Falha ao consultar presença.'},error.status||400);}
}
