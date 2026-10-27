import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {configureRuntimeEnv} from '../lib/blob-store.mjs';
import {GET} from '../api/tratativas.mjs';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('API compartilhada e consumidores recebem conclusão da turma sem alterar registros originais',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 const db={prepare(sql){const s=sqlite.prepare(sql);let values=[];return{bind(...v){values=v;return this;},async run(){return s.run(...values);},async first(){return s.get(...values)||null;},async all(){return{results:s.all(...values)};}};}};
 configureRuntimeEnv({MISSCAN_DB:db});
 sqlite.exec('CREATE TABLE misscan_store(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT); CREATE TABLE misscan_training_events(id TEXT PRIMARY KEY,payload TEXT,created_at TEXT)');
 sqlite.prepare('INSERT INTO misscan_store VALUES(?,?,?)').run('misscan/hc.json',JSON.stringify({rows:[{colaborador:'Pessoa Teste',opsid:'OPS123'}]}),'2026-10-27');
 await GET();
 const original=JSON.stringify({requiredCycle:1,dialogue1:{done:true,date:'2026-10-20'},recycle1:{}});
 sqlite.prepare('INSERT INTO misscan_treatment_state VALUES(?,?,?,?,?)').run('progress','PESSOA TESTE',original,'2026-10-20','2026-10-20');
 const event={id:'turma-teste',type:'Reciclagem',status:'Realizada',topic:'MISSCAN',date:'2026-10-21',createdAt:'2026-10-21T18:00:00Z',instructor:'Instrutor',participants:[{opsid:'OPS123'}]};
 sqlite.prepare('INSERT INTO misscan_training_events VALUES(?,?,?)').run(event.id,JSON.stringify(event),event.createdAt);
 const response=await GET();assert.equal(response.status,200);const data=await response.json();assert.equal(data.progress['PESSOA TESTE'].recycle1.done,true);assert.equal(data.trainingLinks.length,1);
 assert.equal(sqlite.prepare("SELECT payload FROM misscan_treatment_state WHERE scope='progress'").get().payload,original);
 sqlite.close();
});

test('browser aceita conclusão da turma mesmo com rascunho local posterior e identifica a origem',()=>{
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const extract=name=>{const start=source.indexOf('function '+name+'(');const end=source.indexOf('\nfunction ',start+1);return source.slice(start,end);};
 const context={nowISO:()=> '2026-10-27T18:00:00Z',uniqueObjects:items=>items,treatmentRecordTimestamp:()=> '2026-10-27T18:00:00Z'};
 vm.createContext(context);vm.runInContext(extract('mergeProgressRecord')+'\n'+extract('recycleLabel'),context);
 const r=context.mergeProgressRecord({recycle1:{done:false,updatedAt:'2026-10-27'}},{recycle1:{done:true,source:'TRAINING_ATTENDANCE',trainingEventId:'turma',completedAt:'2026-10-21'}});
 assert.equal(r.recycle1.done,true);assert.equal(context.recycleLabel(r.recycle1)[0],'Concluída · turma');
});
