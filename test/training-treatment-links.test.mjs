import test from 'node:test';
import assert from 'node:assert/strict';
import {linkTrainingTreatments} from '../lib/training-treatment-links.mjs';
const hc=[{colaborador:'PESSOA Á TESTE',opsid:'OPS123'}];
const base={requiredCycle:1,dialogue1:{done:true,date:'2026-10-20'},recycle1:{},history:[]};
const event={id:'turma-exemplo-1234',type:'Reciclagem',status:'Realizada',date:'2026-10-21',topic:'REGRAS DE OURO — MIS SCAN',instructor:'Instrutor',createdAt:'2026-10-21T18:00:00Z',participants:[{name:'Nome antigo',opsid:'OPS123'}]};
const run=(p=base,events=[event],roster=hc)=>linkTrainingTreatments({progress:{'PESSOA A TESTE':structuredClone(p)},hc:roster,events,today:'2026-10-27'});
test('vincula presença por OPSID e preserva turma, diálogo e histórico sem alterar entrada',()=>{
 const data=run();const p=data.progress['PESSOA A TESTE'];assert.equal(p.recycle1.done,true);assert.equal(p.recycle1.trainingEventId,event.id);assert.equal(p.recycle1.trainingOpsid,'OPS123');assert.equal(p.recycle1.responsible,'Instrutor');assert.deepEqual(p.dialogue1,base.dialogue1);assert.equal(data.links.length,1);assert.match(p.history[0].detail,/OPS123/);assert.equal(base.recycle1.done,undefined);
 const again=linkTrainingTreatments({progress:data.progress,hc,events:[event],today:'2026-10-27'});assert.equal(again.links.length,0);assert.deepEqual(again.progress,data.progress);
});
test('não encerra treinamento, orientação, outro tema, data anterior/futura ou turma não realizada',()=>{
 for(const patch of [{type:'Treinamento'},{type:'Orientação'},{topic:'Segurança'},{date:'2026-10-19'},{date:'2026-10-28'},{date:'2026-02-30'},{status:'Planejada'}])assert.equal(run(base,[{...event,...patch}]).links.length,0,JSON.stringify(patch));
});
test('não presume presença pelo nome ou por OPSID parcial, duplicado ou ausente',()=>{
 for(const participants of [[{name:'PESSOA Á TESTE',opsid:'OPS12'}],[{name:'PESSOA Á TESTE'}],[...event.participants,...event.participants]])assert.equal(run(base,[{...event,participants}]).links.length,0);
 assert.equal(run(base,[event],[...hc,{colaborador:'OUTRA PESSOA',opsid:'OPS123'}]).links.length,0);
 assert.equal(run(base,[event],[...hc,{colaborador:'PESSOA A TESTE',opsid:'OPS456'}]).links.length,0);
});
test('preserva reciclagem manual concluída e não usa turma anterior a diálogo já feito',()=>{
 for(const p of [{...base,dialogue1:{done:true,date:'2026-10-29'}},{...base,recycle1:{done:true,date:'2026-10-20',responsible:'Original'}}]){const r=run(p);assert.equal(r.links.length,0);assert.deepEqual(r.progress['PESSOA A TESTE'],p);}
});
test('recorrência exige ciclos anteriores concluídos e não reutiliza turma',()=>{
 const p={...base,requiredCycle:2,recycle1:{done:true,date:'2026-10-21',trainingEventId:event.id,trainingOpsid:'OPS123'},dialogue2:{done:true,date:'2026-10-22'}};
 assert.equal(run(p).links.length,0);
 assert.equal(run(p,[{...event,date:'2026-10-23'}]).links.length,0);
 const next=run(p,[event,{...event,id:'nova-turma',date:'2026-10-23'}]);assert.equal(next.progress['PESSOA A TESTE'].recycle2.trainingEventId,'nova-turma');assert.equal(next.progress['PESSOA A TESTE'].requiredCycle,2);
 assert.equal(run({...p,recycle1:{}}).links.length,0);
});
test('uma participação não encerra duas identidades legadas conflitantes',()=>{
 const r=linkTrainingTreatments({progress:{'PESSOA A TESTE':base,'Pessoa Á Teste':base},hc,events:[event],today:'2026-10-27'});assert.equal(r.links.length,0);
});

test('retirada ou suspensão da bipagem exige validação e não recebe baixa automática',()=>{
 for(const p of [{...base,removedFromScanning:true},{...base,suspended:true},{...base,history:[{detail:'Retirada do processo de bipagem por recorrência'}]}])assert.equal(run(p).links.length,0);
});

test('reciclagem conta sem diálogo e preserva a pendência independente do diálogo',()=>{
 for(const p of [{},{...base,dialogue1:{}},{...base,dialogue1:{done:false,date:'2026-10-26'}}]){
 const data=run(p);assert.equal(data.links.length,1);assert.equal(data.progress['PESSOA A TESTE'].recycle1.done,true);assert.deepEqual(data.progress['PESSOA A TESTE'].dialogue1,p.dialogue1);
 }
 const p={requiredCycle:2,recycle1:{done:true,date:'2026-10-19'},dialogue1:{},dialogue2:{}};assert.equal(run(p).progress['PESSOA A TESTE'].recycle2.done,true);
});

test('presença é contabilizada mesmo sem registro individual anterior, sem criar diálogo',()=>{
 const r=linkTrainingTreatments({progress:{},hc,events:[event],today:'2026-10-27'});assert.equal(r.progress['PESSOA A TESTE'].recycle1.done,true);assert.equal(r.progress['PESSOA A TESTE'].dialogue1,undefined);assert.equal(r.progress['PESSOA A TESTE'].requiredCycle,1);
});
