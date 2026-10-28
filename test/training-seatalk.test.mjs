import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {configureRuntimeEnv} from '../lib/blob-store.mjs';
import * as trainingAPI from '../api/reciclagens.mjs';
import {planTrainingNotifications,trainingGroupMessage,trainingNotificationSchema,trainingNotificationStatements,dispatchTrainingNotifications,trainingNotificationStatuses} from '../lib/training-seatalk.mjs';
const event={id:'turma-teste-00001',type:'Reciclagem',status:'Realizada',topic:'Reciclagem de Misscan',date:'2026-10-27',instructor:'Instrutor Teste',area:'Esteiras',createdAt:'2026-10-27T18:00:00Z',participants:[{name:'PESSOA A',opsid:'OPS123',shift:'T3'},{name:'PESSOA B',opsid:'OPS456',shift:'T2'}]};
const hc=[{colaborador:'PESSOA A',opsid:'OPS123',turno:'T4'},{colaborador:'PESSOA B',opsid:'OPS456',turno:'T5'}];
function database(){const sqlite=new DatabaseSync(':memory:');const db={prepare(sql){const s=sqlite.prepare(sql);let args=[];return{bind(...v){args=v;return this;},async run(){return s.run(...args);},async first(){return s.get(...args)||null;},async all(){return{results:s.all(...args)};}};},async batch(statements){sqlite.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};return{sqlite,db};}
async function queued(){const fixture=database();await trainingNotificationSchema(fixture.db);await fixture.db.batch(trainingNotificationStatements(fixture.db,planTrainingNotifications(event,hc),event.createdAt));return fixture;}

test('consolida por turno da HC Matinal, separando T2/T4 e T3/T5 sem usar turno da ABS',()=>{
 const plan=planTrainingNotifications(event,hc);assert.equal(plan.messages.length,2);assert.equal(plan.messages[0].turn,'T2');assert.match(plan.messages[0].content,/PESSOA A — OPS123/);assert.doesNotMatch(plan.messages[0].content,/PESSOA B/);assert.match(plan.messages[1].content,/Turno: T3 \+ T5/);assert.match(plan.messages[1].content,/PESSOA B — OPS456/);
 for(const patch of [{type:'Orientação'},{type:'Treinamento'},{topic:'Segurança'},{status:'Planejada'}])assert.equal(planTrainingNotifications({...event,...patch},hc).messages.length,0);
});
test('bloqueia identidade/turno ambíguos e grupos não configurados sem adivinhar',()=>{
 const plan=planTrainingNotifications(event,[...hc,{colaborador:'PESSOA A',opsid:'OPS123',turno:'T3'}]);assert.equal(plan.messages.length,1);assert.equal(plan.unrouted[0].opsid,'OPS123');
 assert.equal(planTrainingNotifications(event,[]).messages.length,0);
 assert.equal(planTrainingNotifications(event,[{...hc[0],turno:'T1'}]).messages.length,0);
});
test('turmas grandes são divididas sem cortar nomes nem exceder o limite de texto',()=>{
 const participants=Array.from({length:250},(_,i)=>({name:'PARTICIPANTE '+i+' SOBRENOME '.repeat(7),opsid:'OPS'+(1000+i)}));
 const plan=planTrainingNotifications({...event,participants},participants.map(p=>({colaborador:p.name,opsid:p.opsid,turno:'T2'})));
 assert.ok(plan.messages.length>1);const text=plan.messages.map(m=>m.content).join('\n');for(const p of participants)assert.equal(text.split('— '+p.opsid+'\n').length-1,1);assert.ok(plan.messages.every(m=>m.content.length<8000));
});
test('fila é idempotente e concorrência não transmite duas vezes',async()=>{
 const {db}=await queued();await db.batch(trainingNotificationStatements(db,planTrainingNotifications(event,hc),event.createdAt));let sent=0;
 const opts={db,turn:'T2',now:new Date('2026-10-27T18:00:00Z'),send:async(text,{turn})=>{sent++;assert.equal(turn,'T2');return{ok:true,messageId:'msg1'};}};
 await Promise.all([dispatchTrainingNotifications(opts),dispatchTrainingNotifications(opts)]);assert.equal(sent,1);await dispatchTrainingNotifications(opts);assert.equal(sent,1);const statuses=await trainingNotificationStatuses(db);assert.equal(statuses.find(n=>n.turn==='T2').status,'SENT');assert.equal(statuses.find(n=>n.turn==='T3').status,'PENDING');
});
test('respeita 23h no T2 e fechamento 05h30 no T3; fila aguarda próxima janela',async()=>{
 const {db}=await queued();let count=0;const send=async()=>{count++;return{ok:true};};
 for(const [turn,date] of [['T2','2026-10-28T02:00:00Z'],['T2','2026-10-28T15:59:00Z'],['T3','2026-10-28T08:30:00Z'],['T3','2026-10-28T12:00:00Z']])await dispatchTrainingNotifications({db,turn,now:new Date(date),send});assert.equal(count,0);
 await dispatchTrainingNotifications({db,turn:'T3',now:new Date('2026-10-28T00:30:00Z'),send});assert.equal(count,1);
 await dispatchTrainingNotifications({db,turn:'T2',now:new Date('2026-10-28T16:00:00Z'),send});assert.equal(count,2);
});
test('falha ambígua não é reenviada automaticamente; bloqueio de horário mantém fila',async()=>{
 const {db}=await queued();let count=0;const now=new Date('2026-10-27T18:00:00Z');
 await dispatchTrainingNotifications({db,turn:'T2',now,send:async()=>({ok:true,skipped:true,reason:'outside-shift-window'})});assert.equal((await trainingNotificationStatuses(db)).find(n=>n.turn==='T2').status,'PENDING');
 const send=async()=>{count++;throw new Error('timeout');};await dispatchTrainingNotifications({db,turn:'T2',now,send});await dispatchTrainingNotifications({db,turn:'T2',now,send});assert.equal(count,1);assert.equal((await trainingNotificationStatuses(db)).find(n=>n.turn==='T2').status,'REVIEW');
});
test('cadastro cria aviso atomicamente; consulta e repetição de turma antiga não disparam nem criam fila',async()=>{
 const {db,sqlite}=database();sqlite.exec('CREATE TABLE misscan_store(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)');
 sqlite.prepare('INSERT INTO misscan_store VALUES(?,?,?)').run('misscan/training-roster.json',JSON.stringify({rows:event.participants.map(p=>({...p,sector:'Esteiras',leader:'Líder'}))}),event.createdAt);
 sqlite.prepare('INSERT INTO misscan_store VALUES(?,?,?)').run('misscan/official-mg4.json',JSON.stringify({hc}),event.createdAt);
 configureRuntimeEnv({MISSCAN_DB:db,TREATMENT_WRITE_PIN:'test-only'});
 const request=(id=event.id)=>new Request('https://test/api/reciclagens',{method:'POST',headers:{'x-treatment-pin':'test-only'},body:JSON.stringify({action:'create',event:{...event,id,participants:event.participants.map(p=>p.opsid),presenceConfirmed:true}})});
 const tasks=[];const response=await trainingAPI.POST(request(),{waitUntil(task){tasks.push(task);}});assert.equal(response.status,200);await Promise.all(tasks);
 assert.equal((await trainingNotificationStatuses(db)).length,2);assert.equal((await trainingAPI.POST(request())).status,200);assert.equal((await trainingNotificationStatuses(db)).length,2);
 // Simulate a pre-deployment class: a read or create retry cannot backfill alerts.
 sqlite.exec('DELETE FROM misscan_training_notifications');assert.equal((await trainingAPI.GET()).status,200);assert.equal((await trainingAPI.POST(request())).status,200);assert.equal((await trainingNotificationStatuses(db)).length,0);
 const history=await (await trainingAPI.GET()).json();assert.deepEqual(history.events[0].seatalkNotifications,[]);
 sqlite.exec("CREATE TRIGGER reject_notice BEFORE INSERT ON misscan_training_notifications BEGIN SELECT RAISE(ABORT,'Falha de teste'); END;");
 const failed=await trainingAPI.POST(request('nova-turma-teste-00002'));assert.equal(failed.status,400);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM misscan_training_events').get().n,1);assert.equal((await trainingNotificationStatuses(db)).length,0);
});
