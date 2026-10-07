import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESENCE_SOURCE, validatePresence, selectPresentTreatments, saoPauloPresenceDate } from '../lib/abs-presence.mjs';
import { dialogueClosingMessage, dialogueReminderMessages, sendDailyDialogueReminder } from '../lib/seatalk-reminders.mjs';
import { configureRuntimeEnv } from '../lib/blob-store.mjs';
import { POST } from '../api/presence-sync.mjs';

const now = new Date('2026-10-08T01:00:00Z'); // Ainda 07/10 em São Paulo.
const snapshot = (rows, changes = {}) => ({source:PRESENCE_SOURCE,dateKey:'2026-10-07',generatedAt:now.toISOString(),rows,...changes});
const treatment = (opsid, done=false) => ({opsid,done,collaborator:opsid,leader:'Líder teste',indicator:1,actionLabel:'1º diálogo'});

test('data da cobrança segue São Paulo, incluindo virada UTC',()=>{
  assert.equal(saoPauloPresenceDate(now),'2026-10-07');
});
test('cobra somente OPSID confirmado presente, sem concluir nem alterar ausentes',()=>{
  const codes=['P','S2','ON','F','DSR','AM','FE','S1','TR','DF','','TM','INT','PR'];
  const input=codes.map((_,i)=>treatment(`OPS${i+1}`));
  const before=structuredClone(input);
  const result=selectPresentTreatments(input,snapshot(codes.map((status,i)=>({opsid:`OPS${i+1}`,status,disabled:false}))),{now});
  assert.deepEqual(result.eligible.map(r=>r.opsid),['OPS1','OPS2','OPS3']);
  assert.equal(result.deferred.length,11);
  assert.deepEqual(input,before);
  assert.ok(result.deferred.every(r=>!r.done));
  const message=dialogueReminderMessages(result.eligible)[0];
  assert.doesNotMatch(message,/OPS4 —/);
});
test('OPSID ausente, duplicado ou desligado não recebe cobrança',()=>{
  const result=selectPresentTreatments([treatment('OPS1'),treatment('OPS2'),treatment('OPS3')],snapshot([
    {opsid:'OPS1',status:'P',disabled:true},
    {opsid:'OPS2',status:'P',disabled:false},{opsid:'OPS2',status:'P',disabled:false}
  ]),{now});
  assert.equal(result.eligible.length,0);
  assert.equal(result.deferred.length,3);
});
test('retorno confirmado ao ABS libera cobrança sem alterar histórico',()=>{
  const input=[treatment('OPS123')];
  assert.equal(selectPresentTreatments(input,snapshot([{opsid:'OPS123',status:'F',disabled:false}]),{now}).eligible.length,0);
  assert.equal(selectPresentTreatments(input,snapshot([{opsid:'OPS123',status:'P',disabled:false}]),{now}).eligible.length,1);
  assert.equal(input[0].done,false);
});
test('ABS velho, fonte errada, dia errado, vazio ou ausente impede alerta',()=>{
  for(const data of [null,snapshot([]),snapshot([{opsid:'OPS1'}],{dateKey:'2026-10-06'}),snapshot([{opsid:'OPS1'}],{source:{...PRESENCE_SOURCE,sheet:'set2026'}}),snapshot([{opsid:'OPS1'}],{generatedAt:'2026-10-07T23:00:00Z'})]) {
    assert.equal(selectPresentTreatments([treatment('OPS1')],data,{now}).available,false);
  }
});
test('fechamento não transforma ausência em faltante nem em realizado',()=>{
  const result=selectPresentTreatments([treatment('OPS1'),treatment('OPS2'),treatment('OPS3',true)],snapshot([
    {opsid:'OPS1',status:'P',disabled:false},{opsid:'OPS2',status:'AM',disabled:false}
  ]),{now});
  const message=dialogueClosingMessage(result.eligible,{deferred:result.deferred});
  assert.match(message,/Realizados \(1\)/);
  assert.match(message,/Faltantes \(1\)/);
  assert.match(message,/Aguardando presença: 1/);
  assert.doesNotMatch(message,/OPS2 —/);
});
test('valida fonte, data, duplicata e formato antes de aceitar presença',()=>{
  const valid=snapshot([{opsid:'123',status:' p ',disabled:false}]);
  assert.equal(validatePresence(valid,now).rows[0].opsid,'OPS123');
  for(const invalid of [{...valid,dateKey:'2026-10-06'},{...valid,rows:[...valid.rows,...valid.rows]},{...valid,rows:[{opsid:'OPS1',status:'P'}]}]) assert.throws(()=>validatePresence(invalid,now));
});
test('endpoint exige token antes de ler o banco',async()=>{
  configureRuntimeEnv({EMAIL_WEBHOOK_TOKEN:'test',MISSCAN_DB:{prepare(){throw new Error('Não consultar');}}});
  const result=await POST(new Request('https://test/api/presence-sync',{method:'POST',body:'{}'}));
  assert.equal(result.status,401);
});
test('endpoint grava somente presença e recusa snapshot antigo sem sobrescrever',async()=>{
  const writes=[];
  let stored=null;
  configureRuntimeEnv({EMAIL_WEBHOOK_TOKEN:'test',MISSCAN_DB:{prepare(sql){let args=[];return{bind(...values){args=values;return this;},async first(){return stored;},async run(){if(sql.includes('INSERT INTO misscan_store')){writes.push(args);stored={value:args[1]};}},async all(){return{results:[]};}};}}});
  const stamp=new Date();
  const body={source:PRESENCE_SOURCE,dateKey:saoPauloPresenceDate(stamp),generatedAt:stamp.toISOString(),rows:[{opsid:'OPS123',status:'P',disabled:false}]};
  const request=value=>new Request('https://test/api/presence-sync',{method:'POST',headers:{'x-sync-token':'test'},body:JSON.stringify(value)});
  const accepted=await POST(request(body));
  assert.equal(accepted.status,200);
  assert.equal(writes[0][0],'misscan/abs-presence.json');
  const rejected=await POST(request({...body,generatedAt:new Date(stamp.getTime()-1000).toISOString()}));
  assert.equal(rejected.status,409);
  assert.equal(writes.length,1);
});
test('mesmo envio forçado sem ABS válido retorna sem enviar SeaTalk',async()=>{
  configureRuntimeEnv({MISSCAN_DB:{prepare(){return{bind(){return this;},async first(){return null;}}}}});
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error('Não acessar nem enviar rede');};
  try {
    const result=await sendDailyDialogueReminder({force:true});
    assert.equal(result.skipped,true);
    assert.equal(result.reason,'presence-unavailable-or-stale');
  } finally {globalThis.fetch=oldFetch;}
});
