export const DETAILS_PATH='misscan/official-mg4-details.json';
const cleanCode=(value,prefix)=>new RegExp('^'+prefix+'[A-Z0-9]+$','i').test(String(value||'').trim())?String(value).trim().toUpperCase():'';
function dateKey(value){
 const text=String(value||'').trim(),match=text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/),date=match?`${match[3]}-${match[2]}-${match[1]}`:text.slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Error('Data OUT_12 inválida.');return date;
}
export function normalizeDetails(body){
 if(body.source?.spreadsheetId!=='1nubTPlSulT2LY9ZlKkemvjyhlGlYqWIl-eyBlDVRft8'||body.source?.sheet!=='OUT_12_COLABORADOR_LT_TO'||!Array.isArray(body.rows)||!body.rows.length||body.rows.length>50000)throw Error('Fonte OUT_12 inválida.');
 const rows=body.rows.map(r=>{
  const count=Number(r.qtd_miss_scan),distinct=Number(r.qtd_brs_distintos);
  if(String(r.soc)!=='MG4'||String(r.station_id)!=='13812'||!Number.isSafeInteger(count)||count<0||!Number.isSafeInteger(distinct)||distinct<0||distinct>count)throw Error('Linha OUT_12 fora de MG4/13812 ou quantidade inválida.');
  const name=String(r.colaborador||'').trim(),rule=String(r.regra_atribuicao||''),level=String(r.nivel_atribuicao||'');
  return {lmreceived_date:dateKey(r.data_ref),official_aggregate:true,official_count:count,official_area:/esteira/i.test(r.tipo_operacao)?'ESTEIRA':/expedi/i.test(r.tipo_operacao)?'EXPEDIÇÃO':'NA',official_collaborator:name,operator_fail:[true,1,'1','true'].includes(r.is_colaborador_identificado)?name:'',socpacked_tonumber:cleanCode(r.to_voando,'TO'),lt_viagem:String(r.lt_viagem||'').trim(),br_examples:[...new Set([r.br_exemplo_1,r.br_exemplo_2,r.br_exemplo_3].map(v=>cleanCode(v,'BR')).filter(Boolean))],br_distinct_in_group:distinct,detail_grouped:/cauda|top.?3|demais|consolidado/i.test(rule+' '+level),detail_rule:rule,detail_level:level,attribution_source:'OFFICIAL_OUT_12',source_created_at:String(r.created_at||'')};
 });
 return {rows,meta:{source:'OUT_12_COLABORADOR_LT_TO',receivedAt:new Date().toISOString(),records:rows.length}};
}
export function detailCoverage(rows,officialRows){
 const detailed=new Map(),expected=new Map();
 for(const r of rows)detailed.set(r.lmreceived_date,(detailed.get(r.lmreceived_date)||0)+r.official_count);
 for(const r of officialRows)expected.set(r.lmreceived_date,(expected.get(r.lmreceived_date)||0)+r.official_count);
 const dates=[...new Set([...detailed.keys(),...expected.keys()])].sort();
 return {detailOccurrences:rows.reduce((n,r)=>n+r.official_count,0),officialOccurrences:officialRows.reduce((n,r)=>n+r.official_count,0),dates:dates.map(date=>({date,detail:detailed.get(date)||0,official:expected.get(date)||0})),complete:dates.every(d=>(detailed.get(d)||0)===(expected.get(d)||0))};
}
