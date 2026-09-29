import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPendingDialogueRows,
  dialogueReminderMessages
} from '../lib/seatalk-reminders.mjs';

function misscan(name, area = 'Packed TO') {
  return {
    operator_fail: `[Ops1]${name}`,
    process_fail: area,
    to_mis_status: ''
  };
}

test('lista somente pessoas acima do target com diálogo pendente', () => {
  const misscanRows = [
    ...Array.from({ length: 3 }, () => misscan('PESSOA PENDENTE')),
    ...Array.from({ length: 2 }, () => misscan('PESSOA REALIZADA')),
    ...Array.from({ length: 95 }, () => misscan('BASE OPERACIONAL'))
  ];
  const rows = buildPendingDialogueRows({
    misscan: misscanRows,
    hc: [
      { norm: 'PESSOA PENDENTE', turno: 'T4', setor: 'Outbound', lider_nome: 'Líder A' },
      { norm: 'PESSOA REALIZADA', turno: 'T3', setor: 'Outbound', lider_nome: 'Líder B' }
    ],
    progress: {
      'PESSOA REALIZADA': { requiredCycle: 1, dialogue1: { done: true } }
    }
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].collaborator, 'BASE OPERACIONAL');
  assert.equal(rows[1].collaborator, 'PESSOA PENDENTE');
  assert.equal(rows[1].turn, 'T2');
  assert.equal(rows[1].leader, 'Líder A');
});

test('mensagem apresenta cobrança, líder e total sem quantidade de pacotes', () => {
  const messages = dialogueReminderMessages([{
    id: 'PESSOA TESTE', collaborator: 'PESSOA TESTE', cycle: 2,
    indicator: 1.24, missScan: 12, turn: 'T2', sector: 'Outbound', leader: 'Líder Teste'
  }], { dateKey: '2026-09-29', periodLabel: '23/09/2026 a 29/09/2026' });
  assert.equal(messages.length, 1);
  assert.match(messages[0], /PESSOA TESTE/);
  assert.match(messages[0], /2º diálogo pendente/);
  assert.match(messages[0], /Líder: Líder Teste/);
  assert.match(messages[0], /Total: 1 colaborador/);
  assert.doesNotMatch(messages[0], /Miss Scan:/);
});

test('mensagem confirma quando não existem pendências', () => {
  const messages = dialogueReminderMessages([], { dateKey: '2026-09-29' });
  assert.match(messages[0], /Não há diálogos de performance pendentes/);
});
