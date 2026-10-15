import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCalendarRates} from '../lib/calendar-rates.mjs';
import {configureRuntimeEnv} from '../lib/blob-store.mjs';
import {GET} from '../api/taxas.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const packed=(date,total)=>['T1','T2','T3'].map(turno=>({date,turno,socPacked:total/3}));
const row=(date,count)=>({lmreceived_date:date,official_aggregate:true,official_count:count,operator_fail:'[Ops123]ANA TESTE'});
const base={start:'2026-10-12',end:'2026-10-14',days:3,hc:[{colaborador:'ANA TESTE',opsid:'OPS123',turno:'T4'}],knownDays:['2026-10-12','2026-10-13','2026-10-14']};
test('rate uses weighted official occurrences / actual SOC_Packed; forecast remains a separate comparison',()=>{
 const out=buildCalendarRates({...base,rows:[row('2026-10-12',10),row('2026-10-13',60),row('2026-10-14',20)],gerot:{processed:[...packed('2026-10-12',1000),...packed('2026-10-13',3000)],forecast:[{date:'2026-10-12',total:100},{date:'2026-10-13',total:100}]}});
 assert.equal(out.general.misscan,70);assert.equal(out.general.volumeReal,4000);assert.ok(Math.abs(out.general.rate-1.75)<1e-10);assert.equal(out.daily[0].forecastGap,900);assert.equal(out.daily[0].rate,1);
 assert.equal(out.coverage.matchedDays,2);assert.equal(out.coverage.pendingMisscan,20);assert.deepEqual(out.coverage.missingVolumeDates,['2026-10-14']);assert.equal(out.daily[2].rate,null);assert.equal(out.daily[2].volumeReal,null);assert.equal(out.rates.T2.misscan,70);assert.equal(out.rates.T4.rate,out.rates.T2.rate);
});
test('missing Misscan dates, missing shifts and foreign origin cannot fabricate valid zeros',()=>{
 const out=buildCalendarRates({...base,knownDays:['2026-10-12'],rows:[row('2026-10-12',9)],gerot:{processed:[{date:'2026-10-12',turno:'T1',socPacked:1000},...packed('2026-10-13',3000),...packed('2026-10-14',1000).map(r=>({...r,previousStationType:'FMH'}))]}});
 assert.equal(out.general.rate,null);assert.equal(out.daily[0].rate,null);assert.equal(out.daily[1].misscan,null);assert.equal(out.daily[1].rate,null);assert.equal(out.daily[2].volumeReal,null);assert.equal(out.projectionBasis.rate,null);
});
test('explicit covered zero day is valid; a forecast-only day is not a realized rate',()=>{
 const out=buildCalendarRates({...base,rows:[],gerot:{processed:packed('2026-10-12',3000),forecast:[{date:'2026-10-13',total:10000}]}});
 assert.equal(out.daily[0].rate,0);assert.equal(out.general.rate,0);assert.equal(out.daily[1].rate,null);assert.equal(out.daily[1].volumeReal,null);
});
test('weekly rollup does not combine matching ISO labels from different years',()=>{
 const out=buildCalendarRates({...base,start:'2026-12-31',end:'2027-01-05',days:6,knownDays:['2026-12-31','2027-01-05'],rows:[row('2026-12-31',10),row('2027-01-05',20)],gerot:{processed:[...packed('2026-12-31',3000),...packed('2027-01-05',3000)].map(r=>({...r,week:'W01'}))}});
 assert.equal(out.weekly.length,2);assert.notEqual(out.weekly[0].periodStart,out.weekly[1].periodStart);
});
test('API chooses official numerator even when legacy history differs and preserves latest missing-volume day',async()=>{
 const store=new Map([['misscan/official-mg4.json',{rows:[row('2026-10-12',10),row('2026-10-14',40)],hc:base.hc,meta:{historyStart:'2026-10-12',historyEnd:'2026-10-14',days:['2026-10-12','2026-10-14']}}],['misscan/gerot.json',{processed:packed('2026-10-12',3000),forecast:[{date:'2026-10-12',total:999999}]}]]);
 configureRuntimeEnv({MISSCAN_DATA:{get:async key=>structuredClone(store.get(key)??null)}});
 const response=await GET(new Request('https://local.invalid/api/taxas?days=7&fresh=1')),out=await response.json();assert.equal(response.status,200);assert.equal(out.end,'2026-10-14');assert.equal(out.general.misscan,10);assert.equal(out.general.volumeReal,3000);assert.equal(out.coverage.pendingMisscan,40);assert.equal(out.misscanMeta.source,'OFFICIAL_OUT_05_MG4');
});
test('frontend never coerces missing historical rate to zero and floors daily target counts',()=>{
 const src=readFileSync(new URL('../app.js',import.meta.url),'utf8'),start=src.indexOf('function calcForecastDay('),end=src.indexOf('\nfunction renderCalendarHistory',start),ctx={state:{autoRateMeta:{general:{rate:null}}},TARGET_MISSCAN:.88};
 vm.createContext(ctx);vm.runInContext(src.slice(start,end),ctx);const none=ctx.calcForecastDay({volume:10000});assert.equal(none.baseRate,null);assert.ok(Number.isNaN(none.projectedMiss));ctx.state.autoRateMeta.general.rate=1;const out=ctx.calcForecastDay({volume:1000});assert.equal(out.allowedMiss,8);assert.equal(out.projectedMiss,10);assert.equal(out.gap,2);ctx.state.autoRateMeta.general.rate=0;assert.equal(ctx.calcForecastDay({volume:1000}).projectedMiss,0);
});
