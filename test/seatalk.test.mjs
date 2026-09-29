import test from 'node:test';
import assert from 'node:assert/strict';
import { configureRuntimeEnv } from '../lib/blob-store.mjs';
import {
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

test('sendSeatalkText autentica, resolve o grupo e envia texto', async () => {
  configureRuntimeEnv({
    SEATALK_APP_ID: 'app-id',
    SEATALK_APP_SECRET: 'app-secret',
    SEATALK_GROUP_NAME: 'TESTE BOT'
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
