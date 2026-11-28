export const LM_SOURCE={spreadsheetId:'1fwe4cFmYxLgdUmTqtDa6l9lF8WKmpIXE0MCtsWlA4rA',sheet:'LM'};
export const LM_HEADERS=['shipment_id','lmreceived_date','lmreceived_station','last_soc_name','last_status','socpacked_date','socpacked_operator','socpacked_tonumber','step_fail','process_fail','operator_fail','to_mis_status','is_misscan','is_misroute'];
export const SHARDS=32,ROOT='misscan/unit-validation';
export const validBR=v=>/^BR[A-Z0-9]+$/.test(String(v||'').trim().toUpperCase());
export function shardFor(br){let h=0;for(const c of String(br).trim().toUpperCase())h=(Math.imul(h,31)+c.charCodeAt(0))>>>0;return h%SHARDS;}
export function validateBatch(body){
 if(body.source?.spreadsheetId!==LM_SOURCE.spreadsheetId||body.source?.sheet!==LM_SOURCE.sheet)throw Error('Fonte LM divergente.');
 if(!/^\d{13}-[a-f0-9]{8}$/.test(body.generation||''))throw Error('Geração inválida.');
 if(!Number.isInteger(body.shard)||body.shard<0||body.shard>=SHARDS)throw Error('Partição inválida.');
 if(!Array.isArray(body.rows)||body.rows.length>15000)throw Error('Lote inválido.');
 for(const r of body.rows){if(!Number.isInteger(r.sourceRow)||r.sourceRow<2||!Array.isArray(r.values)||r.values.length!==14||r.values.some(v=>typeof v!=='string'||v.length>3000)||!validBR(r.values[0])||shardFor(r.values[0])!==body.shard)throw Error('Registro inválido ou fora da partição.');}
 return {source:LM_SOURCE,generation:body.generation,shard:body.shard,rows:body.rows,receivedAt:new Date().toISOString()};
}
const yes=v=>/^(sim|yes|true|1)$/i.test(String(v||'').trim());
export function classifyLM(records){
 const originals=records.map(r=>({sourceRow:r.sourceRow,...Object.fromEntries(LM_HEADERS.map((h,i)=>[h,r.values[i]]))}));
 const eligible=originals.filter(r=>r.last_soc_name==='SoC_MG_Contagem_Industrial'&&r.to_mis_status.trim().toUpperCase()!=='OK'&&yes(r.is_misscan)&&!yes(r.is_misroute));
 const signatures=new Set(eligible.map(r=>JSON.stringify([r.lmreceived_date,r.operator_fail,r.process_fail])));
 const operators=[...new Set(eligible.map(r=>r.operator_fail.trim()).filter(v=>v&&!/^(na|not identified|spx@shopee.com)$/i.test(v)))];
 const conflict=signatures.size>1,multipleOperators=operators.some(v=>/[,;|\n]/.test(v));
 return {records:originals,eligible:eligible.length>0,uniqueBRCount:eligible.length?1:0,duplicateRows:Math.max(0,originals.length-1),conflict,multipleOperators,operator:!conflict&&!multipleOperators&&operators.length===1?operators[0]:null,status:!eligible.length?'EXCLUDED':conflict?'CONFLICT':multipleOperators?'MULTIPLE_OPERATORS':operators.length?'IDENTIFIED':'UNIDENTIFIED'};
}
export function officialBRRecords(br,official,details){
 const exact=official?.meta?.official===true?(official.rows||[]).filter(r=>!r.official_aggregate&&String(r.shipment_id||'').trim().toUpperCase()===br):[];
 if(exact.length)return {source:'SOC_A_SOC_BR',completeUnitRecords:true,records:exact};
 // shipment_evento_atribuicao is a peer used as evidence, not the offending BR.
 const examples=(details?.rows||[]).filter(r=>(r.br_examples||[]).includes(br));
 return examples.length?{source:'SOC_A_SOC_OUT_12',completeUnitRecords:false,records:examples}:null;
}
