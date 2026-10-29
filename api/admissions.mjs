import {assertSyncToken,json,readJson,writeJson} from '../lib/blob-store.mjs';
import '../new-hire-policy.js';
const PATH='misscan/admissions.json';
export const SOURCE={spreadsheetId:'1ltU2eLkym-ERSNyzvFsK0EyvKZT5kKUiHcY6PNiOxR8',sheetId:942845654,sheet:'COPPIT - ABS',field:'data_admissao'};
export function normalizeAdmissions(body){
 if(Object.keys(SOURCE).some(k=>body.source?.[k]!==SOURCE[k]))throw new Error('Fonte de admissão divergente.');
 if(!Array.isArray(body.rows)||!body.rows.length||body.rows.length>10000)throw new Error('Cadastro de admissões inválido ou vazio.');
 const stamp=Date.parse(body.generatedAt);if(!Number.isFinite(stamp)||Math.abs(Date.now()-stamp)>3600000)throw new Error('Sincronização de admissões desatualizada.');
 const map=new Map();
 for(const r of body.rows){const opsid=String(r.opsid||'').trim().toUpperCase();if(!/^OPS\d+$/.test(opsid))throw new Error('OPSID inválido na sincronização de admissões.');const raw=String(r.admissionDate||'').trim();if(raw.length>80)throw new Error('Data de admissão acima do limite.');const admissionDate=globalThis.MisscanNewHirePolicy.date(raw)||raw,previous=map.get(opsid);if(previous){if(previous.admissionDate!==admissionDate)previous.conflict=true;}else map.set(opsid,{opsid,admissionDate,conflict:false});}
 return {rows:[...map.values()],source:SOURCE,generatedAt:new Date(stamp).toISOString(),updatedAt:new Date().toISOString()};
}
export async function GET(){try{const data=await readJson(PATH,null);return json({ok:true,available:!!data,...(data||{rows:[],source:SOURCE,generatedAt:null}),rule:'Um mês calendário desde a admissão; passagem no aniversário mensal, com ajuste ao último dia do mês quando necessário.'});}catch(e){return json({ok:false,error:'Não foi possível consultar as admissões.'},503);}}
export async function POST(request){try{assertSyncToken(request);const raw=await request.text();if(raw.length>1500000)return json({ok:false,error:'Cadastro acima do limite.'},413);const data=normalizeAdmissions(JSON.parse(raw)),previous=await readJson(PATH,null);if(previous?.generatedAt>data.generatedAt)return json({ok:false,error:'Sincronização anterior ao cadastro atual.'},409);await writeJson(PATH,data);return json({ok:true,records:data.rows.length,generatedAt:data.generatedAt,conflicts:data.rows.filter(r=>r.conflict).length});}catch(e){return json({ok:false,error:e.message},e.status||400);}}
