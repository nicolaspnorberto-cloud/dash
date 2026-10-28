import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {configureRuntimeEnv} from '../lib/blob-store.mjs';
import {validateAnomaly,updateAnomaly,anomalyReport} from '../lib/anomalies.mjs';
import * as api from '../api/anomalias.mjs';import * as files from '../api/anomaly-files.mjs';
const now=new Date('2026-10-28T18:00:00Z');
const raw={id:'00000000-0000-4000-8000-000000000001',observedAt:'2026-10-28T12:00:00-03:00',area:'Esteiras',process:'Lateral',activity:'Saca sem atrelamento',description:'Fato de teste, sem dados operacionais reais.',reporter:'Instrutor de teste',shift:'T4',priority:'HIGH',dueDate:'2026-10-29'};
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');const db={prepare(sql){const s=sqlite.prepare(sql);let args=[];return{bind(...v){args=v;return this;},async run(){return s.run(...args.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v));},async first(){return s.get(...args)||null;},async all(){return{results:s.all(...args)};}};},async batch(statements){sqlite.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};configureRuntimeEnv({MISSCAN_DB:db,TREATMENT_WRITE_PIN:'test-only'});return {sqlite,db};}
const request=body=>new Request('https://test/api/anomalias',{method:'POST',headers:{'x-treatment-pin':'test-only','content-type':'application/json'},body:JSON.stringify(body)});
const get=query=>api.GET(new Request('https://test/api/anomalias'+(query?'?'+query:''),{headers:{'x-treatment-pin':'test-only'}}));

test('registro valida campos e datas, mantém desconhecidos e consolida T4/T5 sem inventar líder',()=>{
 const row=validateAnomaly(raw,now);assert.equal(row.shift,'T2');assert.equal(row.leader,'');assert.equal(row.status,'OPEN');assert.equal(row.observedAt,'2026-10-28T15:00:00.000Z');assert.equal(validateAnomaly({...raw,shift:'T5'},now).shift,'T3');
 for(const patch of [{activity:''},{description:''},{observedAt:'2026-10-29T15:00:00Z'},{observedAt:'2026-02-30T15:00:00Z'},{priority:'toString'},{dueDate:'2026-02-30'}])assert.throws(()=>validateAnomaly({...raw,...patch},now));
});
test('recorrência agrupa área/processo/atividade e não mistura desvios diferentes',()=>{
 const a=validateAnomaly(raw,now),b={...a,id:'b',activity:' saca SEM ATRELAMENTO '},c={...a,id:'c',activity:'Gaiola com TO duplicada'},d={...a,id:'d',area:'Outro setor'};const r=anomalyReport([a,b,c,d]);assert.equal(r.summary.total,4);assert.equal(r.summary.repeatedActivities,1);assert.equal(r.summary.repeats,1);assert.equal(r.ranking[0].total,2);
});
test('recorrência após conclusão considera horário da ocorrência, não data de cadastro',()=>{
 const a=validateAnomaly(raw,now);const done=updateAnomaly(a,{version:1,status:'CLOSED',actor:'Instrutor',resolution:'Ação de teste',evidence:'Verificação de teste'},new Date('2026-10-28T16:00:00Z'));
 const before={...a,id:'before',observedAt:'2026-10-28T15:30:00.000Z'},after={...a,id:'after',observedAt:'2026-10-28T17:00:00.000Z'};const r=anomalyReport([before,after],[done,before,after]);assert.equal(r.summary.afterClosure,1);assert.equal(r.rows[0].afterClosure,false);assert.equal(r.rows[1].afterClosure,true);
});
test('concluir exige ação e evidência, versões antigas não sobrescrevem e histórico é preservado',()=>{
 const a=validateAnomaly(raw,now);for(const body of [{version:1,status:'CLOSED',actor:'Instrutor'},{version:0,status:'IN_PROGRESS',actor:'Instrutor'},{version:1,status:'toString',actor:'Instrutor'}])assert.throws(()=>updateAnomaly(a,body,now));
 const done=updateAnomaly(a,{version:1,status:'CLOSED',actor:'Instrutor',resolution:'Ação',evidence:'Conferência'},now);assert.equal(done.version,2);assert.equal(done.history.length,1);assert.throws(()=>updateAnomaly(done,{version:2,status:'OPEN',actor:'Instrutor'},now));
});
test('base inicia vazia e criação é autenticada, persistente e idempotente',async()=>{
 const {sqlite}=database();const empty=await (await get()).json();assert.equal(empty.summary.total,0);assert.equal(empty.source.total,0);assert.deepEqual(empty.rows,[]);
 const data={...raw,observedAt:'2026-10-01T12:00:00-03:00'};const saved=await api.POST(request({action:'create',record:data}));assert.equal(saved.status,200);assert.equal((await api.POST(request({action:'create',record:data}))).status,200);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM misscan_anomalies').get().n,1);
 const report=await (await get('from=2026-10-01&to=2026-10-31')).json();assert.equal(report.summary.total,1);assert.equal(report.byShift[0].label,'T2');assert.equal(report.rows[0].attachments.length,0);
});
test('sem PIN recusa gravação antes do banco; período inválido é rejeitado',async()=>{
 configureRuntimeEnv({TREATMENT_WRITE_PIN:'test-only',MISSCAN_DB:{prepare(){throw new Error('Não acessar banco');}}});const denied=await api.POST(new Request('https://test/api/anomalias',{method:'POST',body:'{}'}));assert.equal(denied.status,401);assert.equal((await get('from=2026-10-28&to=2026-10-01')).status,400);
});
test('filtros de turno desconhecido e atividade exata preservam contagens corretas',async()=>{
 database();for(const [i,activity,shift] of [[1,'Atividade A',''],[2,'Atividade A maior','T2'],[3,'Atividade A','T3']])assert.equal((await api.POST(request({action:'create',record:{...raw,id:raw.id.slice(0,-1)+i,activity,shift,observedAt:'2026-10-01T12:00:00-03:00'}}))).status,200);
 assert.equal((await (await get('shift=unknown')).json()).summary.total,1);assert.equal((await (await get('activity=Atividade%20A')).json()).summary.total,2);
});
test('atualização exige versão atual e fica disponível para outros usuários',async()=>{
 database();const created=await (await api.POST(request({action:'create',record:{...raw,observedAt:'2026-10-01T12:00:00-03:00'}}))).json();const body={action:'update',id:created.record.id,version:1,status:'IN_PROGRESS',actor:'Instrutor de teste',resolution:'Contenção de teste'};assert.equal((await api.POST(request(body))).status,200);assert.equal((await api.POST(request(body))).status,409);const r=await (await get()).json();assert.equal(r.rows[0].status,'IN_PROGRESS');assert.equal(r.rows[0].history[0].actor,'Instrutor de teste');
});
test('foto/PDF é salvo atomicamente e download exige PIN, preservando os bytes',async()=>{
 const {sqlite}=database(),form=new FormData();form.append('record',JSON.stringify({action:'create',record:{...raw,observedAt:'2026-10-01T12:00:00-03:00'}}));const bytes=new TextEncoder().encode('%PDF-1.7\n Evidência de teste');form.append('files',new File([bytes],'evidencia.pdf',{type:'application/pdf'}));const response=await api.POST(new Request('https://test/api/anomalias',{method:'POST',headers:{'x-treatment-pin':'test-only'},body:form}));assert.equal(response.status,200);const report=await (await get()).json(),id=report.rows[0].attachments[0].id;
 assert.equal((await files.GET(new Request('https://test/api/anomaly-files?id='+id))).status,401);const downloaded=await files.GET(new Request('https://test/api/anomaly-files?id='+id,{headers:{'x-treatment-pin':'test-only'}}));assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()),bytes);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM misscan_anomaly_files').get().n,1);
});
test('anexo inválido não deixa ocorrência parcial na base',async()=>{
 const {sqlite}=database(),form=new FormData();form.append('record',JSON.stringify({action:'create',record:{...raw,observedAt:'2026-10-01T12:00:00-03:00'}}));form.append('files',new File(['html inválido'],'foto.jpg',{type:'image/jpeg'}));assert.equal((await api.POST(new Request('https://test/api/anomalias',{method:'POST',headers:{'x-treatment-pin':'test-only'},body:form}))).status,400);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM misscan_anomalies').get().n,0);
});

test('consulta sem PIN ou com PIN inválido não lê o banco nem expõe indicadores',async()=>{
 configureRuntimeEnv({TREATMENT_WRITE_PIN:'test-only',MISSCAN_DB:{prepare(){throw new Error('Não acessar o banco');}}});for(const headers of [{},{'x-treatment-pin':'errado'}]){const r=await api.GET(new Request('https://test/api/anomalias',{headers}));assert.equal(r.status,401);const d=await r.json();assert.equal(d.rows,undefined);assert.equal(d.summary,undefined);}
});
