import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('seleção mantém pessoas entre filtros e grava uma turma compartilhada',async()=>{
  const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',checked:false,disabled:false,addEventListener(type,fn){this[type]=fn;},reportValidity(){return true;}});return elements.get(id);};
  const roster=[{name:'Pessoa A',opsid:'OPS123',shift:'T4',sector:'Outbound',leader:'Líder A'},{name:'Pessoa B',opsid:'OPS456',shift:'T2',sector:'Esteiras',leader:'Líder B'}];let submitted;
  vm.runInNewContext(readFileSync(new URL('../training.js',import.meta.url),'utf8'),{document:{getElementById:el,querySelector:()=>el('nav')},crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},sessionStorage:{getItem:()=>''},Intl,Date,Set,Map,Blob,URL,fetch:async(_,options)=>{if(options.body){submitted=JSON.parse(options.body);return {ok:true,json:async()=>({ok:true,event:{...submitted.event,participants:roster.filter(p=>submitted.event.participants.includes(p.opsid))}})};}return {ok:true,json:async()=>({ok:true,roster:{rows:roster,updatedAt:'2026-10-07T18:00:00Z'},events:[]})};}});
  await el('trainingReload').onclick();el('trShift').value='T4';el('trShift').change();el('trSelect').onclick();el('trShift').value='T2';el('trShift').change();el('trSelect').onclick();assert.equal(el('trCount').textContent,'2 selecionados');
  el('trTopic').value='Regras de Ouro';el('trDate').value='2026-10-07';el('trInstructor').value='Instrutor';el('trArea').value='Outbound';el('trType').value='Reciclagem';el('trPin').value='teste';el('trPresence').checked=true;el('trPresence').onchange();await el('trSave').onclick();assert.deepEqual(Array.from(submitted.event.participants),['OPS123','OPS456']);assert.match(el('trSaveStatus').textContent,/registrada no banco/);assert.equal(el('trCount').textContent,'0 selecionados');assert.match(el('trHistory').innerHTML,/Pessoa A/);
});
