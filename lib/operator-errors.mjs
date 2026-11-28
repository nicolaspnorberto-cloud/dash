import {classifyLM,validBR} from './unit-validation.mjs';
export const cleanName=v=>String(v||'').replace(/\[ops\d+\]/gi,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().replace(/\s+/g,' ');
export function matchesPerson(raw,{opsid,name}){
 const ids=[...new Set((String(raw||'').match(/OPS\d+/gi)||[]).map(s=>s.toUpperCase()))];
 if(ids.length)return !!opsid&&ids.length===1&&ids[0]===opsid;
 return !!name&&cleanName(raw)===cleanName(name)&&!/[;,|\n@]/.test(String(raw));
}
export function officialPersonBRs(data,person,from,to){
 const groups=(data?.rows||[]).filter(r=>r.official_area==='ESTEIRA'&&r.lmreceived_date>=from&&r.lmreceived_date<=to&&matchesPerson(r.operator_fail||r.official_collaborator,person));
 const map=new Map();for(const r of groups)for(const br of r.br_examples||[]){if(!validBR(br))continue;const key=r.lmreceived_date+'|'+br;if(!map.has(key))map.set(key,{br,date:r.lmreceived_date,source:'SOC_A_SOC_OUT_12',operator:r.operator_fail,area:r.official_area,to:r.socpacked_tonumber||'',rule:r.detail_rule||'',status:'Exemplo de BR na fonte oficial'});}
 return {rows:[...map.values()].sort((a,b)=>b.date.localeCompare(a.date)||a.br.localeCompare(b.br)),groupOccurrences:groups.reduce((n,r)=>n+r.official_count,0),complete:false,updatedAt:data?.meta?.receivedAt||null};
}
export function lmPersonBRs(data,person,from,to){
 const map=new Map();for(const r of data?.rows||[]){const br=String(r.values[0]).trim().toUpperCase();if(!map.has(br))map.set(br,[]);map.get(br).push(r);}
 const out=[];for(const [br,records]of map){const relevant=records.filter(r=>r.values[1].slice(0,10)>=from&&r.values[1].slice(0,10)<=to&&matchesPerson(r.values[10],person)&&classifyLM([r]).eligible);if(!relevant.length)continue;const validation=classifyLM(records);if(!validation.eligible)continue;const r=relevant[0].values;out.push({br,date:r[1].slice(0,10),source:'MATINAL_LM',operator:r[10],area:'Operação a confirmar na fonte oficial',to:r[7],rule:r[8]+' / '+r[9],status:validation.conflict?'Conflito na LM; não atribuir automaticamente':validation.multipleOperators?'Múltiplos operadores na LM':'Registro LM; atribuição oficial ainda não confirmada'});}
 return out.sort((a,b)=>b.date.localeCompare(a.date)||a.br.localeCompare(b.br));
}
