import { assertSyncToken, json, readJson, writeJson } from '../lib/blob-store.mjs';

const PATH='misscan/producao-real.json';

function normalizeTurn(v=''){
  const t=String(v||'').toUpperCase().trim();
  if(t==='T4') return 'T2';
  if(t==='T5') return 'T3';
  return ['T1','T2','T3'].includes(t)?t:'';
}

function normalizeDate(v=''){
  const s=String(v||'').trim();
  let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m) return `${m[1]}-${m[2]}-${m[3]}`;
  m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if(m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d=new Date(s);
  return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):'';
}

function cleanRows(rows=[]){
  const map=new Map();
  for(const row of rows){
    const date=normalizeDate(row?.date||row?.data||row?.period||'');
    const turno=normalizeTurn(row?.turno||row?.shift||row?.bloco||'');
    const real=Number(row?.real??row?.processed??row?.processado??row?.volume??0);
    const meta=Number(row?.meta??row?.target??row?.metaOperacao??0);
    if(!date||!turno||!Number.isFinite(real)||real<0) continue;
    map.set(`${date}|${turno}`,{
      date,turno,real:Math.round(real),meta:Number.isFinite(meta)?Math.round(meta):0,
      source:String(row?.source||row?.fonte||'Oráculo MG4')
    });
  }
  return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.turno.localeCompare(b.turno));
}

export async function GET(){
  return json({ok:true,route:'/api/producao-sync',method:'POST',version:'6.3'});
}

export async function POST(request){
  try{
    assertSyncToken(request);
    const body=await request.json();
    const incoming=cleanRows(Array.isArray(body?.rows)?body.rows:[]);
    if(!incoming.length) return json({ok:false,error:'Nenhuma linha válida de produção real.'},400);

    const current=await readJson(PATH,{rows:[]});
    const merged=cleanRows([...(current?.rows||[]),...incoming]);
    const dates=merged.map(x=>x.date).filter(Boolean).sort();
    const stored={
      ok:true,
      rows:merged,
      meta:{
        ...(current?.meta||{}),
        ...(body?.meta||{}),
        updatedAt:new Date().toISOString(),
        historyStart:dates[0]||'',
        historyEnd:dates.at(-1)||'',
        version:'6.3'
      }
    };
    await writeJson(PATH,stored);
    return json({ok:true,stored:true,incoming:incoming.length,total:merged.length,meta:stored.meta});
  }catch(error){
    console.error('PRODUCAO_SYNC_V63_ERROR',error);
    return json({ok:false,error:error?.message||'Falha ao sincronizar produção real.'},error?.status||500);
  }
}
