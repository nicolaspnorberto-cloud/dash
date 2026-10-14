export const OFFICIAL_PATH='misscan/official-mg4.json';
export const OFFICIAL_SHEET='1nubTPlSulT2LY9ZlKkemvjyhlGlYqWIl-eyBlDVRft8';
export const MATINAL_SHEET='1fwe4cFmYxLgdUmTqtDa6l9lF8WKmpIXE0MCtsWlA4rA';
export const officialWeight=row=>row?.official_aggregate===true?Math.max(0,Number(row.official_count)||0):1;
export const officialProcessLabel=area=>area==='ESTEIRA'?'Esteira':area==='EXPEDIÇÃO'?'Expedição':'Padrão/Não identificado';
export function officialArea(value=''){
 const text=String(value).toLowerCase();
 return text.includes('esteira')?'ESTEIRA':text.includes('expedi')?'EXPEDIÇÃO':'NA';
}
export function normalizeOfficial(body){
 if(body.source?.spreadsheetId!==OFFICIAL_SHEET||body.source?.sheet!=='OUT_05_COLABORADOR_DIA'||body.hcSource?.spreadsheetId!==MATINAL_SHEET||body.hcSource?.sheet!=='Base de HC 26')throw Error('Fonte oficial ou HC Matinal divergente.');
 if(!Array.isArray(body.rows)||!body.rows.length||body.rows.length>50000||!Array.isArray(body.hc)||!body.hc.length)throw Error('Base oficial/HC vazia ou inválida.');
 const map=new Map();
 for(const r of body.rows){
  if(String(r.soc).trim()!=='MG4'||String(r.station_id).trim()!=='13812')throw Error('Registro fora do SOC MG4/13812.');
  const date=String(r.data_ref||'').slice(0,10),count=Number(r.qtd_miss_scan),name=String(r.colaborador||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isInteger(count)||count<0)throw Error('Data ou quantidade oficial inválida.');
  if(!count)continue;
  const identified=[true,1,'1','true'].includes(r.is_colaborador_identificado)&&!!name&&!/^(not.?identified|spx@shopee.com|na|n\/a|null)$/i.test(name);
  const area=officialArea(r.tipo_operacao),key=JSON.stringify([date,name,identified,area]);
  if(!map.has(key))map.set(key,{official_aggregate:true,official_count:0,official_area:area,official_identified:identified,lmreceived_date:date,operator_fail:identified?name:'',official_collaborator:name,shipment_id:'',socpacked_tonumber:'',process_fail:officialProcessLabel(area),to_mis_status:'',last_status:'Não disponível na base agregada',lmreceived_station:'Não disponível na base agregada',attribution_source:'OFFICIAL_OUT_05_MG4'});
  map.get(key).official_count+=count;
 }
 const rows=[...map.values()],days=[...new Set(rows.map(r=>r.lmreceived_date))].sort();
 if(!days.length)throw Error('Nenhum Miss Scan MG4 na fonte oficial.');
 const hc=body.hc.map(r=>({...r,turno:String(r.turno||'').trim(),opsid:String(r.opsid||'').trim().toUpperCase()}));
 const dayStats={};for(const r of rows){const d=r.lmreceived_date;dayStats[d]??={rows:0};dayStats[d].rows+=r.official_count;}
 const receivedAt=new Date().toISOString();
 return {rows,hc,meta:{source:'OFICIAL_SOC_MG4_OUT_05',official:true,officialSpreadsheetId:OFFICIAL_SHEET,hcSource:'MATINAL_BASE_HC_26',receivedAt,updatedAt:receivedAt,historyStart:days[0],historyEnd:days.at(-1),historyRows:rows.reduce((n,r)=>n+r.official_count,0),historyActiveDays:days.length,historyCalendarDays:Math.round((Date.parse(days.at(-1))-Date.parse(days[0]))/86400000)+1,days,dayStats,months:[...new Set(days.map(d=>d.slice(0,7)))],hcRecords:hc.length,storageGranularity:'official-aggregate-v1',ruleVersion:'OFFICIAL_MG4',detailAvailable:false}};
}
