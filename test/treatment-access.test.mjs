import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {configureRuntimeEnv} from '../lib/blob-store.mjs';
import {POST} from '../api/treatment-access.mjs';

test('valida PIN no servidor sem consultar dados, alterar tratativas ou devolver a senha',async()=>{
 configureRuntimeEnv({TREATMENT_WRITE_PIN:'test-only',MISSCAN_DB:{prepare(){throw new Error('Não acessar banco');}}});
 for(const pin of ['', 'errado','test-only']){
 const r=await POST(new Request('https://test/api/treatment-access',{method:'POST',headers:{'x-treatment-pin':pin}}));assert.equal(r.status,pin==='test-only'?200:401);assert.match(r.headers.get('cache-control'),/no-store/);const text=await r.text();assert.doesNotMatch(text,/test-only/);assert.equal(JSON.parse(text).ok,pin==='test-only');
 }
 configureRuntimeEnv({});assert.equal((await POST(new Request('https://test',{method:'POST'}))).status,503);
});
function gate({authorized=true,reply=null}={}){
 const elements=new Map(),calls=[];const document={body:{style:{}},activeElement:null,querySelectorAll:()=>[]};
 const el=id=>{if(!elements.has(id))elements.set(id,{hidden:true,value:'',textContent:'',disabled:false,focus(){document.activeElement=this;},addEventListener(type,fn){this[type]=fn;},querySelectorAll:()=>[]});return elements.get(id);};document.getElementById=el;
 const context={document,AbortSignal,fetch:async(url,options)=>{calls.push({url,options});return reply?reply():{ok:authorized,status:authorized?200:401,json:async()=>({ok:authorized,error:'PIN inválido'})};}};
 vm.createContext(context);vm.runInContext(readFileSync(new URL('../treatment-access.js',import.meta.url),'utf8'),context);return{el,calls,api:context.MisscanTreatmentAccess};
}
test('cada abertura exige tela e validação nova, sem reaproveitar PIN anterior',async()=>{
 const g=gate();const pending=g.api.request({label:'Reciclagem',collaborator:'Pessoa Teste'});assert.equal(g.el('treatmentAccessOverlay').hidden,false);assert.equal(g.calls.length,0);assert.equal(g.api.pin(),'');
 g.el('treatmentAccessPin').value='test-only';await g.el('treatmentAccessForm').onsubmit({preventDefault(){}});assert.equal(await pending,true);assert.equal(g.api.pin(),'test-only');assert.equal(g.el('treatmentAccessPin').value,'');assert.equal(g.el('treatmentAccessOverlay').hidden,true);
 const next=g.api.request({label:'Diálogo'});assert.equal(g.api.pin(),'');assert.equal(g.el('treatmentAccessOverlay').hidden,false);g.el('treatmentAccessCancel').onclick();assert.equal(await next,false);
});
test('PIN inválido e cancelamento mantêm a ficha bloqueada',async()=>{
 const g=gate({authorized:false});const pending=g.api.request();g.el('treatmentAccessPin').value='errado';await g.el('treatmentAccessForm').onsubmit({preventDefault(){}});assert.equal(g.api.pin(),'');assert.equal(g.el('treatmentAccessOverlay').hidden,false);assert.match(g.el('treatmentAccessStatus').textContent,/inválido/);g.el('treatmentAccessCancel').onclick();assert.equal(await pending,false);
});
test('resposta atrasada após cancelamento não concede acesso',async()=>{
 let release;const reply=new Promise(resolve=>{release=resolve;});const g=gate({reply:()=>reply});const pending=g.api.request();g.el('treatmentAccessPin').value='test-only';const submit=g.el('treatmentAccessForm').onsubmit({preventDefault(){}});g.api.release();release({ok:true,json:async()=>({ok:true})});await submit;assert.equal(await pending,false);assert.equal(g.api.pin(),'');assert.equal(g.el('treatmentAccessOverlay').hidden,true);
});
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function handler(name){const start=source.indexOf('window.'+name+'=async');return source.slice(start,source.indexOf('\n};',start)+3);}
test('diálogo, reciclagem e reincidência não abrem ficha nem alteram ciclo sem desbloqueio',async()=>{
 for(const name of ['openDialogue','openRecycle','registerRecurrence']){
  let asked=0;const context={window:{},state:{},historyTreatmentRow:()=>({colaborador:'Pessoa Teste'}),MisscanTreatmentAccess:{request:async()=>{asked++;return false;}},progressFor(){throw new Error('Não acessar ficha/ciclo');}};
  vm.createContext(context);vm.runInContext(handler(name),context);await context.window[name]('pessoa',1);assert.equal(asked,1);assert.equal(Object.keys(context.state).length,0);
 }
});
test('reincidência autorizada altera um ciclo e libera o PIN ao terminar',async()=>{
 const p={requiredCycle:1};let saved=0,released=0;const context={window:{},historyTreatmentRow:()=>({colaborador:'Pessoa Teste'}),MisscanTreatmentAccess:{request:async()=>true,release:()=>released++},progressFor:()=>p,cycleComplete:()=>true,addTreatmentHistory(){},saveTreatmentProgress(){},renderTreatments(){},syncTreatmentOrWarn:async()=>saved++,alert(){throw new Error('Não alertar');}};
 vm.createContext(context);vm.runInContext(handler('registerRecurrence'),context);await context.window.registerRecurrence('pessoa');assert.equal(p.requiredCycle,2);assert.equal(saved,1);assert.equal(released,1);
});
