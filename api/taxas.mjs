import { json, readJson, normalizeName, rowDateKey, monthsBetween } from '../lib/blob-store.mjs';

const PROD_PATH='misscan/producao-real.json';
const HC_PATH='misscan/hc.json';
const META_PATH='misscan/history-meta.json';

function addDays(key,days){
  const d=new Date(`${key}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);
}
function blockForTurn(value=''){
  const turns=[...new Set(String(value||'').toUpperCase().match(/T[1-5]/g)||[])];
  const blocks=[...new Set(turns.map(t=>t==='T4'?'T2':t==='T5'?'T3':t).filter(t=>['T1','T2','T3'].includes(t)))];
  return blocks.length===1?blocks[0]:'';
}
function identifiedOperator(raw=''){
  const text=String(raw||'').trim();
  if(!text||text.includes(',')) return '';
  const clean=text.replace(/\[Ops\d+\]/gi,' ').trim();
  const norm=normalizeName(clean);
  if(!norm||/@/.test(clean)||['NA','NOT IDENTIFIED','NAO IDENTIFICADO'].includes(norm)) return '';
  return norm;
}
function fmtBr(k=''){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(k))return k||'—';const [y,m,d]=k.split('-');return `${d}/${m}/${y}`;
}

export async function GET(request){
  try{
    const url=new URL(request.url);
    const days=Math.max(1,Math.min(90,Number(url.searchParams.get('days')||14)));
    const prod=await readJson(PROD_PATH,null);
    const hcFile=await readJson(HC_PATH,{rows:[]});
    const histMeta=await readJson(META_PATH,null);
    if(!prod?.rows?.length) return json({ok:false,error:'Produção real ainda não sincronizada. Execute sincronizarHistoricoProducaoInicialV63().' },503);
    if(!histMeta) return json({ok:false,error:'Histórico Misscan ainda não sincronizado.'},503);

    const prodEnd=String(prod.meta?.historyEnd||prod.rows.at(-1)?.date||'');
    const missEnd=String(histMeta.historyEnd||'');
    const end=[prodEnd,missEnd].filter(Boolean).sort()[0]||prodEnd||missEnd;
    const start=addDays(end,-(days-1));

    const hcMap=new Map();
    for(const h of (hcFile.rows||[])) hcMap.set(normalizeName(h?.colaborador||h?.norm||''),h);

    const missBy={T1:0,T2:0,T3:0};
    let unidentified=0,withoutHC=0;
    const months=monthsBetween(start,end);
    for(const month of months){
      const f=await readJson(`misscan/history/${month}.json`,{rows:[]});
      for(const row of (f.rows||[])){
        const date=rowDateKey(row);
        if(!date||date<start||date>end) continue;
        const op=identifiedOperator(row?.operator_fail||'');
        if(!op){unidentified++;continue;}
        const hc=hcMap.get(op);
        if(!hc){withoutHC++;continue;}
        const block=blockForTurn(hc.turno||'');
        if(block) missBy[block]++;
        else withoutHC++;
      }
    }

    const prodBy={T1:0,T2:0,T3:0};
    const daily=[];
    for(const r of prod.rows){
      if(!r?.date||r.date<start||r.date>end) continue;
      const block=blockForTurn(r.turno);
      const real=Number(r.real||0);
      if(block&&Number.isFinite(real)&&real>=0){
        prodBy[block]+=real;
        daily.push({date:r.date,turno:block,real,meta:Number(r.meta||0)});
      }
    }

    const rates={};
    for(const t of ['T1','T2','T3']){
      const rate=prodBy[t]>0?missBy[t]/prodBy[t]*100:null;
      rates[t]={turno:t,misscan:missBy[t],volumeReal:prodBy[t],rate};
    }
    // Regra operacional: T4 pertence a T2 e T5 pertence a T3.
    rates.T4={...rates.T2,turno:'T4',mappedTo:'T2'};
    rates.T5={...rates.T3,turno:'T5',mappedTo:'T3'};

    const totalMiss=missBy.T1+missBy.T2+missBy.T3;
    const totalProd=prodBy.T1+prodBy.T2+prodBy.T3;
    return json({
      ok:true,days,start,end,periodLabel:`${fmtBr(start)} a ${fmtBr(end)}`,
      rates,
      general:{misscan:totalMiss,volumeReal:totalProd,rate:totalProd?totalMiss/totalProd*100:null,unidentified,withoutHC},
      mapping:{T1:'T1',T2:'T2',T3:'T3',T4:'T2',T5:'T3'},
      productionMeta:prod.meta||{},
      misscanMeta:{historyStart:histMeta.historyStart,historyEnd:histMeta.historyEnd},
      daily
    });
  }catch(error){
    console.error('TAXAS_V63_ERROR',error);
    return json({ok:false,error:error?.message||'Falha ao calcular taxas automáticas.'},500);
  }
}
