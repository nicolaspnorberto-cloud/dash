import test from 'node:test';import assert from 'node:assert/strict';
import '../official-share.js';
import {GET as evolutionGET} from '../api/evolucao.mjs';
import {configureRuntimeEnv} from '../lib/blob-store.mjs';
import {OFFICIAL_PATH} from '../lib/official-source.mjs';
import {dailyCandidates,dailyShareTotals} from '../lib/daily-treatment-history.mjs';
const {calculate,weeklyRow}=globalThis.MisscanOfficialShare;
test('turno preserva share global e o conjunto acima do corte',()=>{
  const base={numerator:10,total:1000,turnTotal:200,operationTotal:100,personTotal:10};
  assert.equal(calculate(base).value,1);
  assert.equal(calculate({...base,operation:'ESTEIRA'}).value,10);
  assert.equal(calculate({...base,turn:'T2'}).value,1);
  assert.equal(calculate({...base,turn:'T2',operation:'ESTEIRA'}).value,10);
  assert.equal(calculate({...base,person:'PESSOA',turn:'T2',operation:'ESTEIRA'}).value,100);
});
test('denominador ausente/zero não vira percentual inventado e corte usa precisão original',()=>{
  assert.equal(calculate({numerator:5,total:0}).value,null);
  assert.equal(calculate({numerator:5,total:100,turn:'T2'}).value,5);
  assert.equal(calculate({numerator:88,total:10000}).value>0.88,false);
  assert.equal(calculate({numerator:89,total:10000}).value>0.88,true);
});
test('matriz usa quantidade da operação e total da operação em MG4, sem alterar o snapshot',()=>{
  const row={weeks:{W40:{missScan:20,esteira:5,expedicao:15}}};
  const weeks=[{week:'W40',missScan:1000,shareTotals:{esteira:200,expedicao:800,turns:{T2:{total:100}}}}];
  assert.equal(weeklyRow(row,weeks).weeks.W40.share,2);
  assert.equal(weeklyRow(row,weeks,{operation:'ESTEIRA'}).weeks.W40.share,2.5);
  const metric=weeklyRow(row,weeks,{turn:'T2',operation:'ESTEIRA'}).weeks.W40;
  assert.equal(metric.missScan,5);assert.equal(metric.share,2.5);assert.equal(metric.shareDenominator,200);
  assert.equal(row.weeks.W40.missScan,20);assert.equal(row.weeks.W40.share,undefined);
});
const hc=[{colaborador:'PESSOA A',opsid:'OPS1',turno:'T4'},{colaborador:'PESSOA B',opsid:'OPS2',turno:'T2'},{colaborador:'PESSOA C',opsid:'OPS3',turno:'T1'}];
const source={hc,rows:[['PESSOA A',3],['PESSOA B',97],['PESSOA C',800],['',100]].map(([operator_fail,official_count])=>({lmreceived_date:'2026-10-18',operator_fail,official_count,official_aggregate:true}))};
test('base diária inclui não identificados no SOC e usa somente turno confirmado na HC',()=>{
  const totals=dailyShareTotals(source)['2026-10-18'];
  assert.equal(totals.total,1000);assert.equal(totals.turns.T2,100);assert.equal(totals.turns.T1,800);
  assert.equal(totals.turns.T4,undefined);
});
test('histórico também captura pessoa acima do corte no turno e abaixo dele no SOC',()=>{
  const rows=dailyCandidates(source,'2026-10-19',{},[],'2026-10-19');const row=rows.find(r=>r.opsid==='OPS1');
  assert.equal(row.indicator,0.3);assert.equal(row.turnIndicator,3);assert.equal(row.state,'REVIEW');
});

test('API semanal preserva não identificados no total e soma áreas/turnos pela HC Matinal',async()=>{
  const official={...source,rows:source.rows.map((r,i)=>({...r,official_area:i===1?'EXPEDIÇÃO':'ESTEIRA'})),meta:{historyStart:'2026-10-18',historyEnd:'2026-10-18',historyRows:1000,updatedAt:'test-scope-v1'}};
  configureRuntimeEnv({MISSCAN_DATA:{get:async key=>key===OFFICIAL_PATH?official:key==='misscan/gerot.json'?{processed:[{date:'2026-10-18',volume:10000}]}:{},put:async()=>{}}});
  const data=await(await evolutionGET(new Request('https://test/api/evolucao?fresh=1'))).json();
  assert.equal(data.ok,true);const week=data.weeks[0];assert.equal(week.missScan,1000);assert.equal(week.shareTotals.esteira,903);assert.equal(week.shareTotals.expedicao,97);assert.equal(week.shareTotals.turns.T2.total,100);
});
