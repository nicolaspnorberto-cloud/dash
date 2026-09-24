import { createHash } from 'node:crypto';
import { readJson, readJsonRevision, json } from './blob-store.mjs';
import { withReportCache } from './report-cache.mjs';

async function buildSourceReport(){
  try{
    const keys=[
      'misscan/history-meta.json',
      'misscan/hc.json',
      'misscan/gerot.json'
    ];
    const revisions=await Promise.all([
      ...keys.map(readJsonRevision),
      readJson('misscan/history-meta.json',null)
    ]);
    const meta=revisions.at(-1);
    if(!meta)return json({ok:false,error:'Histórico ainda não sincronizado.'},503);
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const stamps=revisions.slice(0,-1);
    const revision=createHash('sha256').update(JSON.stringify([
      day,
      stamps.some(Boolean)?stamps:[meta.receivedAt||meta.updatedAt||'',meta.hcRecords||0]
    ])).digest('hex');
    return json({ok:true,revision,receivedAt:meta.receivedAt||null});
  }catch{return json({ok:false,error:'Não foi possível verificar a atualização das bases.'},503);}
}

export const sourceRevision=withReportCache(buildSourceReport);
