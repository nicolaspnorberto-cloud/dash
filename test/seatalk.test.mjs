import test from 'node:test';
import assert from 'node:assert/strict';
import { configureRuntimeEnv } from '../lib/blob-store.mjs';
import {
  seatalkWindowOpen,
  notifySeatalkTreatment,
  collectGroups,
  resetSeatalkCachesForTests,
  sendSeatalkText,
  treatmentMessage
} from '../lib/seatalk.mjs';

test('collectGroups encontra grupos em respostas aninhadas', () => {
  const groups = collectGroups({ data: { group_chats: [
    { group_id: 'g1', group_name: 'TESTE BOT' },
    { group_id: 'g2', name: 'Operação MG4' }
  ] } });
  assert.deepEqual(groups.map(({ id, name }) => ({ id, name })), [
    { id: 'g1', name: 'TESTE BOT' },
    { id: 'g2', name: 'Operação MG4' }
  ]);
});

test('sendSeatalkText autentica, resolve o grupo e envia texto', async (t) => {
  t.mock.timers.enable({apis:['Date'], now:new Date('2026-10-08T17:00:00Z')});
  configureRuntimeEnv({
    SEATALK_APP_ID: 'app-id',
    SEATALK_APP_SECRET: 'app-secret',
    SEATALK_OFFICIAL_GROUP_NAME: 'TESTE BOT'
  });
  resetSeatalkCachesForTests();
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/app_access_token')) {
      return new Response(JSON.stringify({
        code: 0,
        app_access_token: 'token',
        expire: Math.floor(Date.now() / 1000) + 3600
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/messaging/v2/group_chat/joined')) {
      return new Response(JSON.stringify({
        code: 0,
        data: { groups: [{ group_id: 'group-123', group_name: 'TESTE BOT' }] }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ code: 0, message_id: 'message-123' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const result = await sendSeatalkText('Teste do dashboard', { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.group, 'TESTE BOT');
  assert.equal(calls.length, 3);
  const sent = JSON.parse(calls[2].options.body);
  assert.equal(sent.group_id, 'group-123');
  assert.equal(sent.message.text.content, 'Teste do dashboard');
  assert.equal(calls[2].options.headers.Authorization, 'Bearer token');
});

test('sendSeatalkText resolve o formato atual da lista de grupos do SeaTalk', async (t) => {
  t.mock.timers.enable({apis:['Date'], now:new Date('2026-10-08T17:00:00Z')});
  configureRuntimeEnv({
    SEATALK_APP_ID: 'app-id-current',
    SEATALK_APP_SECRET: 'app-secret-current',
    SEATALK_OFFICIAL_GROUP_NAME: 'TESTE BOT'
  });
  resetSeatalkCachesForTests();
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/app_access_token')) {
      return new Response(JSON.stringify({
        code: 0,
        app_access_token: 'token-current',
        expire: Math.floor(Date.now() / 1000) + 3600
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/messaging/v2/group_chat/joined')) {
      return new Response(JSON.stringify({
        code: 0,
        next_cursor: '',
        joined_group_chats: { group_id: ['group-current'] }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/messaging/v2/group_chat/info')) {
      return new Response(JSON.stringify({
        code: 0,
        group: { group_name: 'TESTE BOT' }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ code: 0, message_id: 'message-current' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const result = await sendSeatalkText('Teste do formato atual', { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.group, 'TESTE BOT');
  assert.equal(calls.length, 4);
  assert.match(calls[2].url, /group_chat\/info\?group_id=group-current/);
  const sent = JSON.parse(calls[3].options.body);
  assert.equal(sent.group_id, 'group-current');
});

test('treatmentMessage contém os campos operacionais principais', () => {
  const message = treatmentMessage({
    eventType: 'DIALOGO',
    cycle: 1,
    collaborator: 'COLABORADOR TESTE',
    indicator: 1.25,
    missScan: 12,
    turno: 'T2',
    setor: 'Outbound',
    leaderName: 'Líder Teste',
    instructorName: 'Instrutor Teste',
    details: { date: '29/09/2026' }
  });
  assert.match(message, /Diálogo de Performance/);
  assert.match(message, /COLABORADOR TESTE/);
  assert.match(message, /Miss Scan: 12/);
  assert.match(message, /29\/09\/2026/);
});


test('janela de Brasília bloqueia às 23h e durante a madrugada', () => {
  for (const [stamp, expected] of [
    ['2026-10-08T15:59:59Z', false], ['2026-10-08T16:00:00Z', true],
    ['2026-10-09T01:59:59Z', true], ['2026-10-09T02:00:00Z', false],
    ['2026-10-09T02:30:00Z', false], ['2026-10-09T03:00:00Z', false]
  ]) assert.equal(seatalkWindowOpen(new Date(stamp)), expected, stamp);
});

test('nenhum envio ou autenticação após o corte; T3 nunca vai ao grupo T2', async (t) => {
  t.mock.timers.enable({apis:['Date'], now:new Date('2026-10-09T02:00:00Z')});
  let calls=0;
  const fetchImpl=()=>{calls++;throw new Error('Não deveria transmitir');};
  assert.equal((await sendSeatalkText('Teste',{fetchImpl})).reason,'outside-t2-window');
  assert.equal((await notifySeatalkTreatment({turno:'T3'},{fetchImpl})).reason,'outside-t2-shift');
  const {sendDailyDialogueReminder}=await import('../lib/seatalk-reminders.mjs');
  assert.equal((await sendDailyDialogueReminder({force:true})).reason,'outside-t2-window');
  assert.equal(calls,0);
});

test('autenticação que cruza 23h não transmite mensagem', async (t) => {
  t.mock.timers.enable({apis:['Date'], now:new Date('2026-10-09T01:59:59Z')});
  configureRuntimeEnv({SEATALK_APP_ID:'crossing',SEATALK_APP_SECRET:'test',SEATALK_OFFICIAL_GROUP_ID:'test-group'});
  resetSeatalkCachesForTests();
  let messages=0;
  const fetchImpl=async (url)=>{
    if(url.endsWith('/auth/app_access_token')) {
      t.mock.timers.setTime(new Date('2026-10-09T02:00:01Z').getTime());
      return Response.json({code:0,app_access_token:'test-token',expire:3600});
    }
    if(url.endsWith('/messaging/v2/group_chat')) messages++;
    return Response.json({code:0,group:{group_name:'TEST'}});
  };
  assert.equal((await sendSeatalkText('Teste',{fetchImpl})).reason,'outside-t2-window');
  assert.equal(messages,0);
});
