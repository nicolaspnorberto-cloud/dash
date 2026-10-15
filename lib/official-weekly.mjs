import {createHash} from 'node:crypto';

const AREAS=['ESTEIRA','EXPEDIÇÃO','NA'];
const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toUpperCase();
export const isOfficialGroup=value=>/^(DEMAIS COLABORADORES|OUTROS COLABORADORES|OUTROS OFENSORES|OUTROS)$/.test(norm(value));
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export function officialPeriodKey(date){
 const day=new Date(date+'T00:00:00Z'),monday=addDays(date,-((day.getUTCDay()+6)%7));
 return `${date.slice(0,7)}|${monday}`;
}
function periodRows(rows){
 const periods=new Map();
 for(const row of rows){const key=officialPeriodKey(row.lmreceived_date);if(!periods.has(key))periods.set(key,[]);periods.get(key).push(row);}
 return periods;
}
export function officialFingerprint(rows){
 return createHash('sha256').update(JSON.stringify(rows.map(r=>[r.lmreceived_date,norm(r.official_collaborator),r.official_area,r.official_count]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))).digest('hex');
}

// OUT_04 supplies week/month totals, never an individual occurrence date.
// A period is accepted only when totals, areas and every overlapping person agree.
export function buildOfficialWeeklyDetails(official,rankRows){
 if(!Array.isArray(rankRows)||rankRows.length>50000)throw Error('Ranking semanal inválido.');
 const daily=periodRows(official.rows),ranks=new Map();
 for(const r of rankRows){
  if(String(r.soc)!=='MG4'||String(r.station_id)!=='13812')throw Error('Ranking fora de MG4/13812.');
  const key=`${r.mes_ref}|${r.data_semana_ini}`;
  if(!/^\d{4}-\d{2}\|\d{4}-\d{2}-\d{2}$/.test(key)||!String(r.colaborador||'').trim())throw Error('Período/colaborador semanal inválido.');
  const counts=[r.miss_esteira,r.miss_expedicao,r.miss_padrao].map(Number),total=Number(r.qtd_miss_scan);
  if(![...counts,total].every(n=>Number.isSafeInteger(n)&&n>=0)||counts.reduce((s,n)=>s+n,0)!==total)throw Error('Quantidades semanais inválidas.');
  if(!ranks.has(key))ranks.set(key,[]);ranks.get(key).push({name:String(r.colaborador).trim(),counts});
 }
 const periods=[],rejected=[];
 for(const[key,rank]of ranks){
  const rows=daily.get(key);if(!rows)continue;
  const source=new Map(),target=new Map(),pool=[0,0,0],totals=[0,0,0],rankTotals=[0,0,0];
  for(const r of rows){const i=AREAS.indexOf(r.official_area),n=norm(r.official_collaborator);totals[i]+=r.official_count;const k=JSON.stringify([n,i]);source.set(k,(source.get(k)||0)+r.official_count);if(isOfficialGroup(n))pool[i]+=r.official_count;}
  for(const r of rank){r.counts.forEach((q,i)=>{rankTotals[i]+=q;const k=JSON.stringify([norm(r.name),i]);const old=target.get(k)||{name:r.name,count:0,index:i};old.count+=q;target.set(k,old);});}
  const additions=[],used=[0,0,0];let invalid=totals.some((n,i)=>n!==rankTotals[i]);
  for(const[k,r]of target){if(isOfficialGroup(r.name))continue;const delta=r.count-(source.get(k)||0);if(delta<0)invalid=true;if(delta>0){used[r.index]+=delta;additions.push({name:r.name,area:AREAS[r.index],count:delta});}}
  if(used.some((n,i)=>n>pool[i]))invalid=true;
  if(invalid){rejected.push(key);continue;}
  if(!additions.length)continue;
  const [month,monday]=key.split('|'),monthEnd=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
  const start=[monday,month+'-01',official.meta.historyStart].sort().at(-1),end=[addDays(monday,6),monthEnd,official.meta.historyEnd].sort()[0];
  periods.push({key,start,end,fingerprint:officialFingerprint(rows),additions});
 }
 return {version:1,source:'OUT_04_COLABORADOR_RANK',periods,rejected};
}

export function prepareOfficialDisplayRow(row,hc=[]){
 const grouped=isOfficialGroup(row.official_collaborator||row.operator_fail);
 if(grouped)return {...row,official_grouped:true,official_identified:false,operator_fail:''};
 const raw=String(row.operator_fail||'').trim();
 if(/^OPS\d+$/i.test(raw)){
  const person=hc.find(r=>String(r.opsid).toUpperCase()===raw.toUpperCase());
  if(person?.colaborador)return {...row,operator_fail:`[${raw.toUpperCase()}]${person.colaborador}`};
 }
 return row;
}

export function individualizeOfficialPeriod(official,from,to,details){
 const rows=official.rows.filter(r=>r.lmreceived_date>=from&&r.lmreceived_date<=to),byPeriod=periodRows(rows),applied=new Map();
 let recovered=0;
 for(const p of details?.periods||[]){
  const current=byPeriod.get(p.key);
  if(applied.has(p.key)||!current||from>p.start||to<p.end||officialFingerprint(current)!==p.fingerprint)continue;
  const pools=new Map();for(const r of current)if(isOfficialGroup(r.official_collaborator))pools.set(r.official_area,(pools.get(r.official_area)||0)+r.official_count);
  const additions=[];let valid=true;
  for(const a of p.additions){if(!Number.isSafeInteger(a.count)||a.count<=0||!AREAS.includes(a.area)||isOfficialGroup(a.name)){valid=false;break;}pools.set(a.area,(pools.get(a.area)||0)-a.count);additions.push(a);}
  if(!valid||[...pools.values()].some(n=>n<0))continue;
  const makeRow=(name,area,count,group=false)=>({official_aggregate:true,official_count:count,official_area:area,official_identified:!group,official_grouped:group,official_granularity:'week',official_period_start:p.start,official_period_end:p.end,lmreceived_date:'',operator_fail:group?'':name,official_collaborator:name,shipment_id:'',socpacked_tonumber:'',process_fail:area==='ESTEIRA'?'Esteira':area==='EXPEDIÇÃO'?'Expedição':'Padrão/Não identificado',attribution_source:group?'OFFICIAL_GROUP_REMAINDER':'OFFICIAL_OUT_04_RECONCILED'});
  const replacements=additions.map(a=>makeRow(a.name,a.area,a.count));for(const[area,count]of pools)if(count)replacements.push(makeRow('Demais colaboradores',area,count,true));
  applied.set(p.key,replacements);recovered+=additions.reduce((s,r)=>s+r.count,0);
 }
 const result=rows.filter(r=>!isOfficialGroup(r.official_collaborator)||!applied.has(officialPeriodKey(r.lmreceived_date)));
 for(const list of applied.values())result.push(...list);
 return {rows:result.map(r=>prepareOfficialDisplayRow(r,official.hc)),meta:{version:'official-individual-turns-v1',recoveredOccurrences:recovered,periodsApplied:applied.size,remainingGrouped:result.filter(r=>isOfficialGroup(r.official_collaborator)).reduce((s,r)=>s+r.official_count,0)}};
}
