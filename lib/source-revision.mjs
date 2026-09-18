import { createHash } from 'node:crypto';
import { readJson, json } from './blob-store.mjs';
import { withReportCache } from './report-cache.mjs';

async function buildSourceReport(){
  try{
    const [meta,hc,gerot]=await Promise.all([
      readJson('misscan/history-meta.json',null),
      readJson('misscan/hc.json',null),
      readJson('misscan/gerot.json',null)
    ]);
    if(!meta)return json({ok:false,error:'Histórico ainda não sincronizado.'},503);
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const revision=createHash('sha256').update(JSON.stringify([day,meta,hc,gerot])).digest('hex');
    return json({ok:true,revision,receivedAt:meta.receivedAt||null});
  }catch{return json({ok:false,error:'Não foi possível verificar a atualização das bases.'},503);}
}

export const sourceRevision=withReportCache(buildSourceReport);
