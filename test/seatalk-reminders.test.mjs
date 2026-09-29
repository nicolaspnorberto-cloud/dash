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

test('lista somente T2 acima do target, com líder e diálogo pendente', () => {
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

  assert.equal(rows.length, 1);
  assert.equal(rows[0].collaborator, 'PESSOA PENDENTE');
  assert.equal(rows[0].turn, 'T2');
  assert.equal(rows[0].leader, 'Líder A');
});

test('mensagem agrupa por líder e orienta o envio do PDF', () => {
  const messages = dialogueReminderMessages([
    {
      id: 'PESSOA TESTE', collaborator: 'PESSOA TESTE', cycle: 2,
      indicator: 1.24, missScan: 12, turn: 'T2', sector: 'Outbound', leader: 'Líder Teste'
    },
    {
      id: 'OUTRA PESSOA', collaborator: 'OUTRA PESSOA', cycle: 1,
      indicator: 1.02, missScan: 10, turn: 'T2', sector: 'Inbound', leader: 'Líder Teste'
    }
  ], { dateKey: '2026-09-29', periodLabel: '28/09/2026 a 28/09/2026' });
  assert.equal(messages.length, 1);
  assert.match(messages[0], /PESSOA TESTE/);
  assert.match(messages[0], /OUTRA PESSOA/);
  assert.equal((messages[0].match(/👤 Líder: Líder Teste/g) || []).length, 1);
  assert.match(messages[0], /2º diálogo/);
  assert.match(messages[0], /Líder: Líder Teste/);
  assert.match(messages[0], /somente colaboradores do turno T2 com líder identificado/);
  assert.match(messages[0], /enviar o PDF juntamente com o nome do colaborador/);
  assert.match(messages[0], /Total: 2 diálogo\(s\) pendente\(s\)/);
  assert.doesNotMatch(messages[0], /Miss Scan:/);
  assert.doesNotMatch(messages[0], /registrar.*dashboard/i);
});

test('mensagem confirma quando não existem pendências', () => {
  const messages = dialogueReminderMessages([], { dateKey: '2026-09-29' });
  assert.match(messages[0], /Não há diálogos de performance pendentes/);
  assert.match(messages[0], /Período analisado: D-1/);
});
