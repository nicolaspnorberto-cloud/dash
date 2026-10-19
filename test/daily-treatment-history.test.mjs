import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {configureRuntimeEnv} from '../lib/blob-store.mjs';
import {dailyCandidates,nextDailyAction,syncDailyHistory,dailyRows,changeDailyRecord,dailyEvidence,DAILY_CONFIG} from '../lib/daily-treatment-history.mjs';
import {POST} from '../api/daily-treatments.mjs';

const hc=[{colaborador:'PESSOA TESTE',opsid:'OPS1',turno:'T2',lider_nome:'LÍDER TESTE',setor:'Outbound'}];
const source=(dates=['2026-10-17','2026-10-18'])=>({hc,rows:dates.flatMap(date=>[
  {official_aggregate:true,official_count:10,official_identified:true,lmreceived_date:date,operator_fail:'PESSOA TESTE'},
  {official_aggregate:true,official_count:90,official_identified:false,lmreceived_date:date,operator_fail:''}
]),meta:{historyStart:dates[0],historyEnd:dates.at(-1),receivedAt:'2026-10-19T20:00:00Z'}});
function database(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE misscan_store(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)');
  sqlite.exec('CREATE TABLE misscan_store_chunks(key TEXT,generation TEXT,chunk_index INTEGER,value TEXT,PRIMARY KEY(key,generation,chunk_index))');
  const db={prepare(sql){const stmt=sqlite.prepare(sql);let args=[];return{bind(...values){args=values;return this;},async run(){return stmt.run(...args);},async first(){return stmt.get(...args)||null;},async all(){return{results:stmt.all(...args)};}};},async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const stmt of statements)out.push(await stmt.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  configureRuntimeEnv({TREATMENT_WRITE_PIN:'test-only',MISSCAN_DB:db});return{db,sqlite};
}
function input(row,changes={}){return{action:'link',id:row.id,version:row.version,type:'dialogue',cycle:1,evidenceId:'dp1',actor:'RESPONSÁVEL TESTE',note:'OPSID e data conferidos no registro oficial.',confirmed:true,...changes};}
const evidence=[{id:'dp1',key:'OPS1|dialogue|2026-10-19',opsid:'OPS1',type:'dialogue',date:'2026-10-19',source:'Planilha oficial'}];

test('histórico diário usa contagem oficial e agrupa por OPSID/dia, incluindo não identificados no denominador',()=>{
  const data=source();data.rows.push({...data.rows[0],operator_fail:'[OPS1]PESSOA TESTE',official_count:5});
  const rows=dailyCandidates(data,'2026-10-19',{},[],'2026-10-19');
  assert.equal(rows.length,2);assert.equal(rows[0].count,15);assert.equal(rows[0].indicator,15/105*100);
  assert.ok(rows.every(r=>r.state==='REVIEW'&&r.opsid==='OPS1'));
});
test('cadastro ambíguo, data inválida e ocorrência parcial do dia atual não viram pendência confirmada',()=>{
  const data=source(['2026-10-18','2026-10-19','2026-02-30']);data.hc=[...hc,{...hc[0],opsid:'OPS2'}];
  const rows=dailyCandidates(data,'2026-10-17',{},[],'2026-10-19');
  assert.equal(rows.length,1);assert.equal(rows[0].state,'REVIEW');assert.equal(rows[0].opsid,'');
});
test('caso novo após ativação tem ação pendente, sem reiniciar recorrência nem processo suspenso',()=>{
  const data=source(['2026-10-18']);
  assert.equal(dailyCandidates(data,'2026-10-18',{},[],'2026-10-19')[0].state,'PENDING');
  const done={requiredCycle:2,dialogue1:{done:true,date:'2026-10-10'},recycle1:{done:true,date:'2026-10-11'}};
  const next=nextDailyAction(done,[],'2026-10-18');assert.equal(next.cycle,2);assert.equal(next.type,'dialogue');
  assert.ok(nextDailyAction({history:[{detail:'Retirada do processo de bipagem por recorrência'}]},[],'2026-10-18').withdrawn);
  const full={};for(let i=1;i<=3;i++){full['dialogue'+i]={done:true,date:'2026-10-01'};full['recycle'+i]={done:true,date:'2026-10-02'};}
  assert.equal(nextDailyAction(full,[],'2026-10-18').terminal,true);
});
test('importação é idempotente e preserva pendência validada, auditoria e conclusão',async()=>{
  const {db}=database();await syncDailyHistory(source(),{activate:true});
  let rows=await dailyRows(db);assert.equal(rows.length,2);assert.ok(rows.every(r=>r.state==='REVIEW'));
  await changeDailyRecord(db,input(rows[0],{action:'confirm-pending'}),rows,evidence);
  await syncDailyHistory(source());rows=await dailyRows(db);assert.equal(rows[0].state,'PENDING');assert.equal(rows[0].audit.length,2);
  await changeDailyRecord(db,input(rows[0]),rows,evidence);
  await syncDailyHistory(source());rows=await dailyRows(db);assert.equal(rows[0].state,'CLOSED');assert.equal(rows[0].audit.length,3);assert.equal(rows.length,2);
});
test('vínculo vale para uma ocorrência e não conclui outras datas do mesmo OPSID',async()=>{
  const {db}=database();await syncDailyHistory(source(),{activate:true});let rows=await dailyRows(db);
  await changeDailyRecord(db,input(rows[0]),rows,evidence);rows=await dailyRows(db);
  assert.equal(rows.filter(r=>r.state==='CLOSED').length,1);assert.equal(rows.filter(r=>r.state==='REVIEW').length,1);
  await assert.rejects(changeDailyRecord(db,input(rows[1]),rows,evidence),/já está vinculada/);
});
test('vínculo rejeita outro OPSID, data anterior, tipo incompatível e validação sem responsável',async()=>{
  const {db}=database();await syncDailyHistory(source(),{activate:true});const rows=await dailyRows(db),row=rows[0];
  for(const changed of [{opsid:'OPS2'},{date:'2026-10-01'},{type:'recycle'}])await assert.rejects(changeDailyRecord(db,input(row),rows,[{...evidence[0],...changed}]),/Selecione uma tratativa válida/);
  await assert.rejects(changeDailyRecord(db,input(row,{actor:''}),rows,evidence),/responsável/);
  await assert.rejects(changeDailyRecord(db,input(row,{confirmed:false}),rows,evidence),/confirmação/);
});
test('versão impede duas pessoas de gravarem decisões sobre o mesmo registro antigo',async()=>{
  const {db}=database();await syncDailyHistory(source(),{activate:true});const rows=await dailyRows(db),row=rows[0];
  await changeDailyRecord(db,input(row,{action:'confirm-pending'}),rows,evidence);
  await assert.rejects(changeDailyRecord(db,input(row),rows,evidence),/Conflito/);
});
test('retirada da ocorrência na fonte não apaga histórico nem cria nova cobrança',async()=>{
  const {db}=database();await syncDailyHistory(source(),{activate:true});let rows=await dailyRows(db);
  await changeDailyRecord(db,input(rows[0],{action:'confirm-pending'}),rows,evidence);
  const corrected=source();corrected.rows=corrected.rows.filter(r=>r.lmreceived_date!=='2026-10-18');
  await syncDailyHistory(corrected);rows=await dailyRows(db);const revised=rows.find(r=>r.date==='2026-10-18');
  assert.equal(revised.inSource,false);assert.equal(revised.state,'REVIEW');assert.equal(rows.length,2);
});
test('sem ativação não há escrita automática e consultas sem PIN não acessam D1',async()=>{
  const {sqlite}=database();assert.equal((await syncDailyHistory(source())).active,false);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='misscan_daily_treatments'").get().n,0);
  configureRuntimeEnv({TREATMENT_WRITE_PIN:'test-only',MISSCAN_DB:{prepare(){throw new Error('Não acessar');}}});
  const response=await POST(new Request('https://test/api/daily-treatments',{method:'POST',body:'{}'}));assert.equal(response.status,401);
});
test('restrição única no banco impede reutilizar a mesma evidência em atualizações concorrentes',async()=>{
  const {db}=database();await syncDailyHistory(source(),{activate:true});const stale=await dailyRows(db);
  await changeDailyRecord(db,input(stale[0]),stale,evidence);
  await assert.rejects(changeDailyRecord(db,input(stale[1]),stale,evidence),/UNIQUE constraint/);
});
test('registro oficial existente sem vínculo exige conferência, em vez de inventar pendência',async()=>{
  const {db,sqlite}=database();
  sqlite.prepare('INSERT INTO misscan_store VALUES(?,?,?)').run(DAILY_CONFIG,JSON.stringify({trackingStart:'2026-10-17'}),'2026-10-19');
  sqlite.prepare('INSERT INTO misscan_store VALUES(?,?,?)').run('misscan/dialogues-realized.json',JSON.stringify({byDate:{'2026-10-18':[{id:'real',opsid:'OPS1'}]}}),'2026-10-19');
  await syncDailyHistory(source());assert.ok((await dailyRows(db)).every(r=>r.state==='REVIEW'));
});
test('API autenticada carrega fonte oficial e presença sem alterar registros originais de diálogos',async()=>{
  const {sqlite}=database(),official=source();
  sqlite.prepare('INSERT INTO misscan_store VALUES(?,?,?)').run('misscan/official-mg4.json',JSON.stringify(official),'2026-10-19');
  const registry=JSON.stringify({byDate:{'2026-10-19':[{id:'DP-real',opsid:'OPS1'}]}});
  sqlite.prepare('INSERT INTO misscan_store VALUES(?,?,?)').run('misscan/dialogues-realized.json',registry,'2026-10-19');
  const response=await POST(new Request('https://test/api/daily-treatments',{method:'POST',headers:{'x-treatment-pin':'test-only'},body:JSON.stringify({action:'refresh'})}));
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private.*no-store/);
  assert.equal((await response.json()).importComplete,true);
  const listed=await POST(new Request('https://test/api/daily-treatments',{method:'POST',headers:{'x-treatment-pin':'test-only'},body:JSON.stringify({action:'list'})}));
  const data=await listed.json();assert.equal(data.rows.length,2);assert.ok(data.rows.every(r=>r.state==='REVIEW'&&r.ageDays===null));
  assert.equal(data.evidence[0].opsid,'OPS1');assert.equal(sqlite.prepare("SELECT value FROM misscan_store WHERE key='misscan/dialogues-realized.json'").get().value,registry);
});
test('reciclagem em grupo mantém evidência individual por OPSID e não usa curso sem relação com MIS SCAN',async()=>{
  const {db,sqlite}=database();sqlite.exec('CREATE TABLE misscan_training_events(payload TEXT)');
  const participants=[{opsid:'OPS1'},{opsid:'OPS2'}];
  for(const topic of ['MIS SCAN','Segurança'])sqlite.prepare('INSERT INTO misscan_training_events VALUES(?)').run(JSON.stringify({id:topic,type:'Reciclagem',topic,reason:'',date:'2026-10-18',participants}));
  const result=await dailyEvidence(db,source(),[]);assert.equal(result.length,2);assert.notEqual(result[0].key,result[1].key);assert.ok(result.every(e=>e.title==='MIS SCAN'));
});

test('carga grande usa lotes JSON e permanece abaixo de 50 consultas D1',async()=>{
  const {db,sqlite}=database();let calls=0;
  const prepare=db.prepare.bind(db);db.prepare=sql=>{calls++;if(calls>49)throw new Error('D1 query budget exceeded');return prepare(sql);};
  const data=source(['2026-10-18']);data.hc=Array.from({length:1000},(_,i)=>({...hc[0],colaborador:'PESSOA '+i,opsid:'OPS'+(i+1)}));
  // Um dia por pessoa mantém o share acima do corte, totalizando 1.000 ocorrências.
  data.rows=data.hc.map((p,i)=>({official_aggregate:true,official_count:1,lmreceived_date:new Date(Date.UTC(2023,0,1+i)).toISOString().slice(0,10),operator_fail:p.colaborador}));
  data.meta.historyStart='2023-01-01';data.meta.historyEnd='2025-09-26';
  await syncDailyHistory(data,{activate:true});assert.ok(calls<30);assert.equal(sqlite.prepare('SELECT count(*) n FROM misscan_daily_treatments').get().n,1000);
  calls=0;const corrected={...data,rows:[]};await syncDailyHistory(corrected);assert.ok(calls<30);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM misscan_daily_treatments WHERE in_source=0').get().n,1000);
});
test('importação semanal continua sem revisar registros de outras semanas',async()=>{
  const {db,sqlite}=database();const dates=Array.from({length:15},(_,i)=>new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10)),data=source(dates);
  sqlite.prepare('INSERT INTO misscan_store VALUES(?,?,?)').run('misscan/official-mg4.json',JSON.stringify(data),'2026-10-19');
  async function refresh(cursor){const response=await POST(new Request('https://test/api/daily-treatments',{method:'POST',headers:{'x-treatment-pin':'test-only'},body:JSON.stringify({action:'refresh',cursor})}));assert.equal(response.status,200);return response.json();}
  const first=await refresh();assert.equal(first.continuation,dates[7]);assert.equal((await dailyRows(db)).length,7);
  const second=await refresh(first.continuation);assert.equal(second.continuation,dates[14]);assert.equal((await dailyRows(db)).length,14);
  const last=await refresh(second.continuation);assert.equal(last.importComplete,true);assert.equal((await dailyRows(db)).filter(r=>r.inSource).length,15);
  await refresh();assert.equal((await dailyRows(db)).filter(r=>r.inSource).length,15);
});
