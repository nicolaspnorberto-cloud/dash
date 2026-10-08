import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {configureRuntimeEnv} from '../lib/blob-store.mjs';
import * as classes from '../api/reciclagens.mjs';
import * as attachments from '../api/training-files.mjs';
import {prepareTrainingFiles,MAX_TRAINING_FILE_BYTES,trainingFileSchema} from '../lib/training-files.mjs';
const PIN='test-only';
const roster=[{name:'COLABORADOR DE TESTE',opsid:'OPS123',shift:'T4',sector:'Outbound',leader:'LÍDER DE TESTE'}];
const event={id:'00000000-0000-4000-8000-000000000001',topic:'MIS SCAN',instructor:'INSTRUTOR DE TESTE',area:'Outbound',date:'2026-10-07',type:'Reciclagem',participants:['OPS123'],presenceConfirmed:true};
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  const db={prepare(sql){const s=sqlite.prepare(sql);let values=[];return{bind(...v){values=v;return this;},async run(){return s.run(...values.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v));},async first(){return s.get(...values)||null;},async all(){return{results:s.all(...values)};}};},async batch(statements){sqlite.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  sqlite.exec('CREATE TABLE misscan_store(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)');sqlite.prepare('INSERT INTO misscan_store VALUES(?,?,?)').run('misscan/training-roster.json',JSON.stringify({rows:roster}),'2026-10-07');
  configureRuntimeEnv({TREATMENT_WRITE_PIN:PIN,MISSCAN_DB:db});return{sqlite,db};}
function pdf(name='presenca.pdf',size=40){const bytes=new Uint8Array(size).fill(32);bytes.set(new TextEncoder().encode('%PDF-1.7\n'));return new File([bytes],name,{type:'application/pdf'});}
function createRequest(files=[],data=event){const form=new FormData();form.append('event',JSON.stringify(data));files.forEach(f=>form.append('files',f));return new Request('https://test/api/reciclagens',{method:'POST',headers:{'x-treatment-pin':PIN},body:form});}
function uploadRequest(file,id=event.id){const form=new FormData();form.append('eventId',id);form.append('files',file);return new Request('https://test/api/training-files',{method:'POST',headers:{'x-treatment-pin':PIN},body:form});}

test('registra turma e PDF na mesma transação e baixa bytes intactos somente com PIN',async()=>{
 const {sqlite}=database();const original=pdf('Lista assinada.pdf',600000);const response=await classes.POST(createRequest([original]));assert.equal(response.status,200);const data=await response.json();assert.equal(data.event.participants[0].name,roster[0].name);assert.equal(data.event.attachments.length,1);const id=data.event.attachments[0].id;
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM misscan_training_file_chunks').get().n,2);
 const denied=await attachments.GET(new Request('https://test/api/training-files?id='+id));assert.equal(denied.status,401);
 const downloaded=await attachments.GET(new Request('https://test/api/training-files?id='+id,{headers:{'x-treatment-pin':PIN}}));assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('cache-control'),'private, no-store');assert.equal(downloaded.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()),new Uint8Array(await original.arrayBuffer()));
 const history=await (await classes.GET()).json();assert.equal(history.events[0].attachments[0].name,'Lista assinada.pdf');assert.equal(history.events[0].attachments[0].bytes,undefined);
});
test('arquivo inválido não deixa turma parcial no banco',async()=>{
 const {sqlite}=database();const bad=new File(['<script>alert(1)</script>'],'presenca.pdf',{type:'application/pdf'});const response=await classes.POST(createRequest([bad]));assert.equal(response.status,400);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM misscan_training_events').get().n,0);
});
test('limite de 3 anexos e repetição idempotente preservam os arquivos existentes',async()=>{
 const {sqlite}=database();const files=[pdf('a.pdf'),pdf('b.pdf'),pdf('c.pdf')];assert.equal((await classes.POST(createRequest(files))).status,200);
 assert.equal((await classes.POST(createRequest(files))).status,200);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM misscan_training_files').get().n,3);
 const extra=await attachments.POST(uploadRequest(pdf('d.pdf')));assert.equal(extra.status,409);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM misscan_training_files').get().n,3);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM misscan_training_file_chunks').get().n,3);
});
test('falha durante a gravação dos chunks reverte também a turma',async()=>{
 const {sqlite}=database();await trainingFileSchema({prepare(sql){const stmt=sqlite.prepare(sql);return{async run(){stmt.run();}};}});sqlite.exec("CREATE TRIGGER reject_chunk BEFORE INSERT ON misscan_training_file_chunks BEGIN SELECT RAISE(ABORT,'Falha de teste'); END;");const response=await classes.POST(createRequest([pdf()]));assert.equal(response.status,400);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM misscan_training_events').get().n,0);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM misscan_training_files').get().n,0);
});
test('anexa posteriormente em turma existente sem alterar participantes ou tratativas',async()=>{
 const {sqlite}=database();assert.equal((await classes.POST(createRequest())).status,200);const before=sqlite.prepare('SELECT payload FROM misscan_training_events').get().payload;const result=await attachments.POST(uploadRequest(pdf()));assert.equal(result.status,200);assert.equal(sqlite.prepare('SELECT payload FROM misscan_training_events').get().payload,before);assert.equal((await result.json()).attachments.length,1);
 const missing=await attachments.POST(uploadRequest(pdf(),'00000000-0000-4000-8000-000000000002'));assert.equal(missing.status,404);
});
test('recusa anexo grande, tipo disfarçado, arquivo vazio e excesso de arquivos',async()=>{
 await assert.rejects(prepareTrainingFiles(event.id,[pdf('large.pdf',MAX_TRAINING_FILE_BYTES+1)]),/4 MB/);
 await assert.rejects(prepareTrainingFiles(event.id,[new File([''],'vazio.pdf',{type:'application/pdf'})]),/vazio/);
 await assert.rejects(prepareTrainingFiles(event.id,[pdf('disfarce.jpg')]),/formato/);
 await assert.rejects(prepareTrainingFiles(event.id,[pdf(),pdf(),pdf(),pdf()]),/3 anexos/);
});
test('requisição acima do limite e PIN ausente são barrados antes do banco',async()=>{
 configureRuntimeEnv({TREATMENT_WRITE_PIN:PIN,MISSCAN_DB:{prepare(){throw new Error('Não acessar banco');}}});
 assert.equal((await attachments.POST(new Request('https://test/api/training-files',{method:'POST',body:'{}'}))).status,401);
 assert.equal((await attachments.POST(new Request('https://test/api/training-files',{method:'POST',headers:{'x-treatment-pin':PIN,'content-length':'5000000'},body:'test'}))).status,413);
});
test('JSON antigo continua funcionando sem anexos e preserva turno original',async()=>{
 database();const response=await classes.POST(new Request('https://test/api/reciclagens',{method:'POST',headers:{'x-treatment-pin':PIN,'content-type':'application/json'},body:JSON.stringify({action:'create',event})}));assert.equal(response.status,200);const saved=(await response.json()).event;assert.equal(saved.participants[0].shift,'T4');assert.deepEqual(saved.attachments,[]);
});
