import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('../PRODUTIVIDADE_HC_SYNC.gs',import.meta.url),'utf8'),ctx);
const headers=['date','station_name','workstation_id','_hour','operator_id','packing'];
const row=(day,ops,bipes,ws='W1',hour='10:00')=>[day,'SoC_MG_Contagem_Industrial',ws,hour,ops,bipes];
const book=(hist,d0)=>({getSheetByName:name=>({getDataRange:()=>({getValues:()=>[headers,...(name==='prod_hist'?hist:d0)]})})});
test('produção soma postos/horas por OPSID e remove snapshot duplicado',()=>{const r=row('2026-11-25','ops123',10);const p=ctx.consolidarProducaoIndividualMG4_(book([r,r,row('2026-11-25','ops123',5,'W2')],[row('2026-11-26','ops123',3)]),'2026-11-26');assert.equal(p.rows[0].bipes,15);assert.deepEqual([...p.days],['2026-11-25']);assert.deepEqual([...p.partialDays],['2026-11-26'])});
test('D0 substitui dia sobreposto sem somar fontes',()=>{const p=ctx.consolidarProducaoIndividualMG4_(book([row('2026-11-25','ops123',10)],[row('2026-11-25','ops123',12)]),'2026-11-26');assert.equal(p.rows[0].bipes,12)});
test('conflito de bipe na mesma hora/posto/OPSID bloqueia sincronização',()=>assert.throws(()=>ctx.consolidarProducaoIndividualMG4_(book([row('2026-11-25','ops123',10),row('2026-11-25','ops123',12)],[row('2026-11-26','ops123',3)]),'2026-11-26'),/conflitante/));
test('não mistura outra estação e não usa TOs como bipes',()=>{const other=row('2026-11-25','ops999',300);other[1]='Outra estação';const p=ctx.consolidarProducaoIndividualMG4_(book([row('2026-11-25','ops123',10),other],[row('2026-11-26','ops123',3)]),'2026-11-26');assert.equal(p.rows.reduce((n,r)=>n+r.bipes,0),13)});
