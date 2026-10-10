import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const roster=[{name:'Pessoa A',opsid:'OPS123',shift:'T4',sector:'Outbound',leader:'Líder A'},{name:'Pessoa B',opsid:'OPS456',shift:'T2',sector:'Esteiras',leader:'Líder B'}];
function panel({events=[],fail=false}={}){
 const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{options:[],getContext(){return {clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}};},setPointerCapture(){},getBoundingClientRect(){return {left:0,top:0,width:900,height:260};},value:'',innerHTML:'',textContent:'',checked:false,disabled:false,files:[],hidden:false,classList:{toggle(){},contains(){return false;}},setAttribute(k,v){this[k]=v;},addEventListener(type,fn){this[type]=fn;},reportValidity(){return true;}});return elements.get(id);};
 let submitted,submittedBody;
 const context={document:{getElementById:el,querySelector:()=>el('nav')},crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},sessionStorage:{getItem:()=>''},structuredClone,Intl,Date,Set,Map,Blob,URL,FormData,File,AbortSignal,setTimeout,fetch:async(_,options)=>{if(options.body){submittedBody=options.body;submitted=options.body instanceof FormData?{event:JSON.parse(options.body.get('event'))}:JSON.parse(options.body);if(fail)return{ok:false,json:async()=>({ok:false,error:'Falha de teste'})};return {ok:true,json:async()=>({ok:true,event:{...submitted.event,participants:roster.filter(p=>submitted.event.participants.includes(p.opsid)),attachments:options.body instanceof FormData?[{id:'0'.repeat(64),name:'presenca.pdf',size:100}]:[]}})};}return {ok:true,json:async()=>({ok:true,roster:{rows:roster,updatedAt:'2026-10-07T18:00:00Z'},events})};}};
 vm.runInNewContext(readFileSync(new URL('../training.js',import.meta.url),'utf8'),context);
 return{el,get submitted(){return submitted;},get body(){return submittedBody;}};
}
async function fill(ui){const {el}=ui;await el('trainingReload').onclick();el('trSelect').onclick();el('trTopic').value='Regras de Ouro';el('trDate').value='2026-10-07';el('trInstructor').value='Instrutor';el('trArea').value='Outbound';el('trType').value='Reciclagem';el('trPin').value='teste';el('trPresence').checked=true;el('trPresence').onchange();}

test('seleção mantém pessoas entre filtros e grava uma turma compartilhada',async()=>{
 const ui=panel(),{el}=ui;await el('trainingReload').onclick();el('trShift').value='T4';el('trShift').change();el('trSelect').onclick();el('trShift').value='T2';el('trShift').change();el('trSelect').onclick();assert.equal(el('trCount').textContent,'2 selecionados');
 el('trTopic').value='Regras de Ouro';el('trDate').value='2026-10-07';el('trInstructor').value='Instrutor';el('trArea').value='Outbound';el('trType').value='Reciclagem';el('trPin').value='teste';el('trPresence').checked=true;el('trPresence').onchange();await el('trSave').onclick();assert.deepEqual(Array.from(ui.submitted.event.participants),['OPS123','OPS456']);assert.match(el('trSaveStatus').textContent,/registrada no banco/);assert.equal(el('trCount').textContent,'0 selecionados');assert.match(el('trHistory').innerHTML,/Pessoa A/);
});
test('envia PDF com a turma em multipart e preserva seleção e arquivos após falha',async()=>{
 const ui=panel({fail:true}),{el}=ui;await fill(ui);el('trFiles').files=[new File(['%PDF-1.7'],'presenca.pdf',{type:'application/pdf'})];el('trFiles').onchange();await el('trSave').onclick();assert.ok(ui.body instanceof FormData);assert.equal(ui.body.getAll('files').length,1);assert.equal(el('trCount').textContent,'2 selecionados');assert.match(el('trFileList').innerHTML,/presenca.pdf/);assert.match(el('trSaveStatus').textContent,/mantidos/);
});
test('recusa arquivo grande sem substituir os anexos já selecionados',async()=>{
 const ui=panel(),{el}=ui;await fill(ui);el('trFiles').files=[new File(['%PDF-1.7'],'presenca.pdf',{type:'application/pdf'})];el('trFiles').onchange();el('trFiles').files=[{name:'grande.pdf',type:'application/pdf',size:5*1024*1024,lastModified:1}];el('trFiles').onchange();assert.match(el('trFileStatus').textContent,/4 MB/);assert.match(el('trFileList').innerHTML,/presenca.pdf/);assert.doesNotMatch(el('trFileList').innerHTML,/grande.pdf/);
});
test('histórico filtra presença anexada, tipo, turno e participante sem mudar a turma original',async()=>{
 const original={id:'00000000-0000-4000-8000-000000000001',date:'2026-10-07',topic:'Teste',type:'Reciclagem',instructor:'Teste',participants:roster,attachments:[{id:'0'.repeat(64),name:'lista.pdf',size:20}]};const ui=panel({events:[original,{...original,id:'00000000-0000-4000-8000-000000000002',type:'Treinamento',attachments:[]}]}),{el}=ui;await el('trainingReload').onclick();el('trHistoryType').value='Reciclagem';el('trHistoryEvidence').value='with';el('trHistoryShift').value='T4';el('trHistoryShift').oninput();assert.match(el('trStats').textContent,/1 turmas · 1 participações/);assert.match(el('trHistory').innerHTML,/1 de 2 no filtro/);assert.match(el('trHistory').innerHTML,/lista.pdf/);assert.equal(original.participants.length,2);
});
test('datas invertidas dão mensagem e desabilitam exportação, e navegação usa botões',async()=>{
 const ui=panel(),{el}=ui;await el('trainingReload').onclick();el('trHistoryFrom').value='2026-10-08';el('trHistoryTo').value='2026-10-07';el('trHistoryTo').oninput();assert.match(el('trHistoryStatus').textContent,/data final/);assert.equal(el('trExport').disabled,true);el('trHistoryTab').onclick();assert.equal(el('trHistoryPanel').hidden,false);assert.equal(el('trNewPanel').hidden,true);el('trResetHistory').onclick();assert.equal(el('trHistoryFrom').value,'');assert.equal(el('trHistoryStatus').textContent,'');
});

test('orientação exige assinaturas de instrutor e de todos, sem foto',async()=>{
 const ui=panel(),{el}=ui;await fill(ui);el('trType').value='Orientação';el('trType').input();assert.equal(el('trSave').disabled,true);
 const sign=id=>{el('trSigner').value=id;el('trSignatureCanvas').onpointerdown({pointerId:1,clientX:20,clientY:20});el('trSignatureCanvas').onpointermove({clientX:70,clientY:70});el('trSignatureCanvas').onpointerup();el('trSignatureSave').onclick();};
 sign('instructor');sign('OPS123');assert.equal(el('trSave').disabled,true);sign('OPS456');assert.equal(el('trSave').disabled,false);await el('trSave').onclick();assert.equal(ui.submitted.event.signatures.instructor.name,'Instrutor');assert.equal(ui.submitted.event.signatures.participants.OPS456.name,'Pessoa B');assert.match(el('trHistory').innerHTML,/polyline/);
});
