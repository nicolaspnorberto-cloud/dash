import {officialPeriodKey} from './official-weekly.mjs';

const area=value=>/esteira/i.test(value)?'ESTEIRA':/expedi/i.test(value)?'EXPEDIÇÃO':'NA';
export function normalizeDestinations(rows){
 if(!Array.isArray(rows)||rows.length>50000)throw Error('Destinos inválidos.');
 return rows.map(r=>{
  const month=String(r.mes_ref),week=String(r.data_semana_ini),count=Number(r.qtd_miss_scan);
  if(String(r.soc)!=='MG4'||String(r.station_id)!=='13812'||!/^\d{4}-\d{2}$/.test(month)||!/^\d{4}-\d{2}-\d{2}$/.test(week)||!Number.isSafeInteger(count)||count<0||!String(r.destino_planejado||'').trim())throw Error('Destino fora de MG4/13812 ou inválido.');
  return {key:month+'|'+week,destination:String(r.destino_planejado).trim(),area:area(r.tipo_operacao),count};
 });
}

export function selectDestinations(official,from,to){
 const available=Array.isArray(official.destinationRows),periods=new Map();
 for(const row of official.rows){
  const key=officialPeriodKey(row.lmreceived_date),p=periods.get(key)||{start:row.lmreceived_date,end:row.lmreceived_date,total:0};
  p.start=p.start<row.lmreceived_date?p.start:row.lmreceived_date;p.end=p.end>row.lmreceived_date?p.end:row.lmreceived_date;p.total+=row.official_count;periods.set(key,p);
 }
 const grouped=new Map();for(const row of official.destinationRows||[]){if(!grouped.has(row.key))grouped.set(row.key,[]);grouped.get(row.key).push(row);}
 const rows=[],included=[],excluded=[];
 for(const [key,p] of periods){
  if(p.end<from||p.start>to)continue;
  const source=grouped.get(key),sum=source?.reduce((n,r)=>n+r.count,0);
  if(from>p.start||to<p.end||!source||sum>p.total){excluded.push({start:p.start,end:p.end});continue;}
  included.push({start:p.start,end:p.end});rows.push(...source.map(r=>({...r,periodStart:p.start,periodEnd:p.end})));
 }
 return {available,source:'OUT_08_DESTINO_ORIGEM',granularity:'week',rows,periods:included,excludedPeriods:excluded};
}
