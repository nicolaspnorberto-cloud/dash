// Calendarização: realizado e previsto têm funções distintas. Nenhuma ausência vira zero.
export const CALENDAR_TARGET=0.88;
export const calendarAddDays=(key,n)=>{const d=new Date(key+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
const block=v=>{const b=[...new Set((String(v||'').toUpperCase().match(/T[1-5]/g)||[]).map(t=>t==='T4'?'T2':t==='T5'?'T3':t))];return b.length===1?b[0]:''};
const interSoc=r=>!r.originType&&!r.previousStationType||norm(r.originType||r.previousStationType).replace(/[ _]+/g,'-')==='INTER-SOC';
const blocks=()=>Object.fromEntries(['T1','T2','T3'].map(t=>[t,{misscan:0,volumeReal:0,present:false}]));
export function buildCalendarRates({rows=[],knownDays=[],gerot={},hc=[],start,end,days,official=true}){
 const people=new Map();for(const h of hc){people.set(norm(h.colaborador||h.norm),h);if(h.opsid)people.set(norm(h.opsid),h)}
 const miss=new Map(),packed=new Map(),forecasts=new Map();let unidentified=0,withoutHC=0,identifiedForBlocks=0;
 for(const day of knownDays)if(day>=start&&day<=end)miss.set(day,{count:0,blocks:{T1:0,T2:0,T3:0}});
 for(const r of rows){const date=String(r.lmreceived_date||'').slice(0,10);if(date<start||date>end||!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;const count=r.official_aggregate===true?Math.max(0,Number(r.official_count)||0):1;if(!miss.has(date))miss.set(date,{count:0,blocks:{T1:0,T2:0,T3:0}});const m=miss.get(date);m.count+=count;
  const raw=String(r.operator_fail||''),id=raw.match(/\[?(OPS\d+)\]?/i)?.[1],name=norm(raw.replace(/\[?OPS\d+\]?/gi,''));
  if(!raw||raw.includes(',')||r.official_grouped||/^(NOT IDENTIFIED|NAO IDENTIFICADO|NA|DEMAIS COLABORADORES)$/.test(name)||raw.includes('@')){unidentified+=count;continue}
  const h=people.get(norm(id))||people.get(name),b=block(h?.turno);if(!b){withoutHC+=count;continue}m.blocks[b]+=count;identifiedForBlocks+=count;
 }
 for(const r of gerot.processed||[]){if(r.date<start||r.date>end||!interSoc(r))continue;const b=block(r.turno),v=Number(r.socPacked);if(!b||!Number.isFinite(v)||v<0)continue;if(!packed.has(r.date))packed.set(r.date,{blocks:blocks(),week:r.week||''});const p=packed.get(r.date);p.blocks[b].volumeReal+=v;p.blocks[b].present=true}
 for(const r of gerot.forecast||[]){if(r.date<start||r.date>end||!interSoc(r))continue;const v=Number(r.total);if(!Number.isFinite(v)||v<0)continue;forecasts.set(r.date,{total:v,week:r.week||''})}
 const daily=[],sums=blocks(),general={misscan:0,volumeReal:0,forecastVolume:0},coverage={requestedDays:days,matchedDays:0,missingVolumeDates:[],missingMisscanDates:[],missingBlocksDates:[],matchedDates:[],pendingMisscan:0};
 for(let date=start;date<=end;date=calendarAddDays(date,1)){
  const m=miss.get(date),p=packed.get(date),f=forecasts.get(date),bs=blocks();let volume=0;
  for(const t of ['T1','T2','T3']){const pb=p?.blocks[t];const v=pb?.volumeReal??null,c=m?m.blocks[t]:null;bs[t]={misscan:c,volumeReal:v,rate:m&&pb?.present&&v>0?c/v*100:null,present:!!pb?.present,source:'SOC_Packed INTER-SOC / turno HC atual'};if(pb?.present)volume+=v;if(m&&pb?.present&&v>0){sums[t].misscan+=c;sums[t].volumeReal+=v}}
  const missingBlocks=['T1','T2','T3'].filter(t=>!bs[t].present),hasVolume=!!p&&volume>0,complete=!!m&&hasVolume&&!missingBlocks.length;
  if(!m)coverage.missingMisscanDates.push(date);if(!hasVolume)coverage.missingVolumeDates.push(date);if(hasVolume&&missingBlocks.length)coverage.missingBlocksDates.push(date);
  if(m&&!complete)coverage.pendingMisscan+=m.count;
  if(complete){general.misscan+=m.count;general.volumeReal+=volume;general.forecastVolume+=f?.total||0;coverage.matchedDays++;coverage.matchedDates.push(date)}
  daily.push({date,week:p?.week||f?.week||'',misscan:m?.count??null,volumeReal:p?volume:null,forecastVolume:f?.total??null,forecastGap:p&&f?volume-f.total:null,forecastGapPct:p&&f&&f.total>0?(volume/f.total-1)*100:null,rate:complete?m.count/volume*100:null,target:CALENDAR_TARGET,eligible:complete,coverageStatus:!m?'Sem base Misscan':!hasVolume?'Sem volume realizado':missingBlocks.length?'Blocos incompletos':'Conferido',missingBlocks,blocks:bs,volumeSource:'db_volume_overall • INTER-SOC • SOC_Packed'});
 }
 const rates={};for(const t of ['T1','T2','T3'])rates[t]={turno:t,misscan:sums[t].misscan,volumeReal:sums[t].volumeReal,rate:sums[t].volumeReal>0?sums[t].misscan/sums[t].volumeReal*100:null,source:'SOC_Packed INTER-SOC / turno HC atual'};rates.T4={...rates.T2,turno:'T4',mappedTo:'T2'};rates.T5={...rates.T3,turno:'T5',mappedTo:'T3'};
 const weekMap=new Map();for(const d of daily){const dt=new Date(d.date+'T12:00:00Z'),wd=dt.getUTCDay()||7,monday=calendarAddDays(d.date,1-wd),key=monday;if(!weekMap.has(key))weekMap.set(key,{week:d.week||monday,periodStart:monday,misscan:0,volumeReal:0,days:0,excludedDays:0});const w=weekMap.get(key);if(d.eligible){w.misscan+=d.misscan;w.volumeReal+=d.volumeReal;w.days++}else w.excludedDays++}
 const rate=general.volumeReal>0?general.misscan/general.volumeReal*100:null;
 return {ok:true,version:'7.1-calendar-real',days,start,end,periodLabel:`${start.split('-').reverse().join('/')} a ${end.split('-').reverse().join('/')}`,target:CALENDAR_TARGET,rates,general:{...general,rate,target:CALENDAR_TARGET,gapPp:rate===null?null:rate-CALENDAR_TARGET,unidentified,withoutHC,identifiedForBlocks,pendingMisscanNoProcessed:coverage.pendingMisscan,volumeSource:'db_volume_overall • INTER-SOC • SOC_Packed'},coverage,projectionBasis:{kind:'historical-reference-scenario',rate,matchedDays:coverage.matchedDays,requestedDays:days,complete:coverage.matchedDays===days,note:'Cenário: mesma referência histórica aplicada ao forecast. Não é previsão estatística nem taxa oficial de coorte.'},mapping:{T1:'T1',T2:'T2 + T4',T3:'T3 + T5',T4:'T2',T5:'T3'},source:(official?'Oficial MG4 OUT_05':'Matinal/LM')+' ÷ SOC_Packed INTER-SOC da mesma data',blockSource:'Referência por bloco com turno HC atual; não é turno histórico de ocorrência',productionMeta:gerot.meta||{},daily,weekly:[...weekMap.values()].map(w=>({...w,rate:w.volumeReal>0?w.misscan/w.volumeReal*100:null,target:CALENDAR_TARGET})),scopeNote:'Numerador: ocorrências MG4 por data LM. Denominador: SOC_Packed INTER-SOC por data de processamento. Indicador operacional por data; não associa cada pacote à mesma coorte.'};
}
