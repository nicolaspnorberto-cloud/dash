import '../official-share.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import '../presence-ui.js';

function setup(responder){
  const elements=new Map(),session=new Map();
  const el=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,checked:false,disabled:false,classList:{contains:()=>true},setAttribute(k,v){this[k]=v;},addEventListener(k,fn){this[k]=fn;},insertAdjacentHTML(_,html){this.innerHTML+=html;}});return elements.get(id);};
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const base={date:today,turno:'T2',leader:'LÍDER TESTE',count:10,indicator:2,totalDay:500,turnTotal:100,cycle:1,actionType:'dialogue',version:0,inSource:true,audit:[],proposal:{review:'Conferir histórico'},ageDays:2};
  const presence={opsid:'OPS1',turno:'T2',dateKey:today,validUntil:'2099-01-01T00:00:00Z',status:'PRESENT'};
  const rows=[{...base,id:'A',opsid:'OPS1',name:'PESSOA A',state:'PENDING',presence},{...base,id:'B',opsid:'OPS2',name:'PESSOA B',state:'REVIEW',ageDays:null,presence:{...presence,opsid:'OPS2',status:'ABSENT'}},{...base,id:'C',opsid:'OPS3',name:'PESSOA C',state:'CLOSED',evidence:{key:'K',source:'Registro',date:today},evidenceCurrent:true}];
  let exported,lastRequest;
  const context={MisscanOfficialShare:globalThis.MisscanOfficialShare,document:{getElementById:el,hidden:false},MisscanPresenceUI:globalThis.MisscanPresenceUI,Intl,Date,Map,Set,Number,String,Math,AbortController,setTimeout,clearTimeout,setInterval(){},sessionStorage:{getItem:key=>session.get(key)||'',setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)},exportCSV:r=>{exported=r;},fetch:async(_,options)=>{lastRequest=JSON.parse(options.body);if(responder)return responder(lastRequest,{rows,today});return {ok:true,json:async()=>({ok:true,rows,evidence:[],config:{trackingStart:today},sourceUpdatedAt:new Date().toISOString(),checkedAt:new Date().toISOString()})};}};
  vm.runInNewContext(readFileSync(new URL('../daily-history.js',import.meta.url),'utf8'),context);
  return {el,get exported(){return exported;},get request(){return lastRequest;},async load(){el('dhPin').value='teste';await el('dhAccess').onsubmit({preventDefault(){}});}};
}
test('visão diária tem filtros próprios e não mistura histórico não confirmado com pendências',async()=>{
  const ui=setup();await ui.load();
  assert.match(ui.el('dhBody').innerHTML,/PESSOA A/);assert.match(ui.el('dhBody').innerHTML,/Fonte ou vínculo a conferir/);
  ui.el('dhStatus').value='PENDING';ui.el('dhStatus').change();
  assert.match(ui.el('dhBody').innerHTML,/PESSOA A/);assert.doesNotMatch(ui.el('dhBody').innerHTML,/PESSOA B|PESSOA C/);
  ui.el('dhExport').onclick();assert.equal(ui.exported.length,1);assert.equal(ui.exported[0].opsid,'OPS1');
});
test('pendentes presentes combina presença e pendência e datas invertidas não exportam',async()=>{
  const ui=setup();await ui.load();ui.el('dhPresence').value='PENDING_PRESENT';ui.el('dhPresence').change();
  assert.match(ui.el('dhBody').innerHTML,/PESSOA A/);assert.doesNotMatch(ui.el('dhBody').innerHTML,/PESSOA B|PESSOA C/);
  ui.el('dhFrom').value='2099-01-02';ui.el('dhTo').value='2099-01-01';ui.el('dhFrom').change();assert.equal(ui.el('dhExport').disabled,true);
});
test('alternar histórico usa botões sem alterar o acompanhamento atual',()=>{
  const ui=setup();ui.el('dailyHistoryTab').onclick();assert.equal(ui.el('currentTreatmentView').hidden,true);assert.equal(ui.el('dailyTreatmentView').hidden,false);
  ui.el('dailyCurrentTab').onclick();assert.equal(ui.el('currentTreatmentView').hidden,false);assert.equal(ui.el('dailyTreatmentView').hidden,true);
});

test('interface continua as semanas e só exibe registros após a leitura final',async()=>{
  const requests=[];const ui=setup((body,{rows,today})=>{
    requests.push(body);const data=body.action==='list'?{ok:true,rows,evidence:[],config:{trackingStart:today},checkedAt:new Date().toISOString()}:body.cursor?{ok:true,importComplete:true}:{ok:true,continuation:'2026-10-08',through:'2026-10-07'};
    return {ok:true,json:async()=>data};
  });
  await ui.load();assert.deepEqual(requests.map(r=>r.action),['refresh','refresh','list']);assert.equal(requests[1].cursor,'2026-10-08');assert.match(ui.el('dhBody').innerHTML,/PESSOA A/);assert.equal(ui.el('dhLoad').disabled,false);
});
test('falha HTML do servidor informa HTTP e libera nova tentativa sem revelar resposta bruta',async()=>{
  const ui=setup(()=>({ok:false,status:500,json:async()=>{throw new Error('HTML de erro interno');}}));
  await ui.load();assert.match(ui.el('dhMessage').textContent,/HTTP 500/);assert.doesNotMatch(ui.el('dhMessage').textContent,/HTML/);assert.equal(ui.el('dhLoad').disabled,false);
});

test('cruzamento mostra datas de diálogos/reciclagens e filtra sem exigir vínculo manual',async()=>{
  const ui=setup((body,{rows,today})=>{
    rows[1].reconciliation={status:'FOUND',dialogues:[{date:today}],recycles:[{date:today}],reason:'Registro localizado por OPSID'};
    return {ok:true,json:async()=>({ok:true,rows,evidence:[],config:{trackingStart:today},dialogueSource:{coveredDays:30,updatedAt:new Date().toISOString()},checkedAt:new Date().toISOString()})};
  });await ui.load();ui.el('dhReconciliation').value='FOUND';ui.el('dhReconciliation').change();
  assert.match(ui.el('dhBody').innerHTML,/PESSOA B/);assert.doesNotMatch(ui.el('dhBody').innerHTML,/PESSOA A|PESSOA C/);
  assert.match(ui.el('dhBody').innerHTML,/Tratativa localizada/);assert.match(ui.el('dhBody').innerHTML,/<strong>Diálogo:<\/strong>/);
  assert.match(ui.el('dhBody').innerHTML,/<strong>Reciclagem:<\/strong>/);assert.match(ui.el('dhSourceStatus').textContent,/30 dia/);
});
test('share diário muda com turno, preserva base global e não muda com líder ou busca',async()=>{
  const ui=setup();await ui.load();ui.el('dhExport').onclick();assert.equal(ui.exported[0].share_diario_pct,2);
  ui.el('dhTurn').value='T2';ui.el('dhTurn').change();ui.el('dhExport').onclick();assert.equal(ui.exported[0].share_diario_pct,10);
  ui.el('dhLeader').value='LÍDER TESTE';ui.el('dhLeader').change();ui.el('dhExport').onclick();assert.equal(ui.exported[0].share_diario_pct,10);
  ui.el('dhTurn').value='';ui.el('dhTurn').change();ui.el('dhExport').onclick();assert.equal(ui.exported[0].share_diario_pct,2);
});
