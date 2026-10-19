import test from 'node:test';import assert from 'node:assert/strict';
import {reconcileDailyRows} from '../lib/daily-reconciliation.mjs';
const row={id:'R',opsid:'OPS1',turno:'T2',date:'2026-10-17',state:'REVIEW',actionType:'dialogue',cycle:1,inSource:true,proposal:{}};
const dp=(changes={})=>({id:'D',key:'OPS1|dialogue|2026-10-18',opsid:'OPS1',type:'dialogue',date:'2026-10-18',source:'Planilha de Diálogo de Performance',...changes});
const options={today:'2026-10-19',dialogueDates:['2026-10-17','2026-10-18','2026-10-19'],dialogueUpdatedAt:'2026-10-19T20:00:00Z'};
const match=(rows=[row],evidence=[],o=options)=>reconcileDailyRows(rows,evidence,o);
test('cruzamento localiza por OPSID e data, sem concluir automaticamente várias ocorrências',()=>{
  const original=[row,{...row,id:'R2',date:'2026-10-18'}],result=match(original,[dp()]);
  assert.ok(result.every(r=>r.reconciliation.status==='FOUND'&&r.state==='REVIEW'));
  assert.equal(result[0].reconciliation.dialogues[0].date,'2026-10-18');assert.equal(original[0].reconciliation,undefined);
});
test('diálogo anterior não quita reincidência e OPSID diferente não é confundido',()=>{
  const result=match([row],[dp({date:'2026-10-16'}),dp({opsid:'OPS2'})])[0].reconciliation;
  assert.equal(result.status,'NOT_FOUND');assert.equal(result.dialogues.length,0);assert.equal(result.previousDialogues.length,1);
});
test('ausência de registro só é classificada com todos os dias consultados',()=>{
  assert.equal(match()[0].reconciliation.status,'NOT_FOUND');
  assert.equal(match([row],[],{...options,dialogueDates:['2026-10-17','2026-10-19']})[0].reconciliation.status,'UNKNOWN');
  assert.match(match()[0].reconciliation.reason,/não comprova/);
});
test('vínculo em outra ocorrência e ciclo incompatível exigem conferência',()=>{
  const linked={...row,id:'LINK',state:'CLOSED',evidence:dp()};
  assert.equal(match([row,linked],[dp()])[0].reconciliation.status,'UNKNOWN');
  assert.equal(match([row],[dp({cycle:2})])[0].reconciliation.status,'UNKNOWN');
});
test('retirada, cadastro ambíguo e fonte revisada bloqueiam nova cobrança',()=>{
  for(const changed of [{opsid:''},{turno:'Não confirmado'},{inSource:false},{proposal:{withdrawn:true,review:'Retirado do processo'}}])assert.equal(match([{...row,...changed}],[dp()])[0].reconciliation.status,'BLOCKED');
});
test('reciclagem e presença não substituem diálogo e vínculo sem fonte é preservado',()=>{
  const recycle=dp({type:'recycle'});const result=match([row],[recycle])[0].reconciliation;
  assert.equal(result.status,'UNKNOWN');assert.equal(result.recycles.length,1);
  const linked=match([{...row,state:'CLOSED',evidence:dp()}])[0];assert.equal(linked.state,'CLOSED');assert.equal(linked.reconciliation.status,'UNKNOWN');
});
