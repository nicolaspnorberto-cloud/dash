import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDialogueStatusRows,
  buildPendingDialogueRows,
  dialogueClosingMessage,
  dialogueReminderMessages
} from '../lib/seatalk-reminders.mjs';

function misscan(name, area = 'Packed TO', opsid = 'Ops1') {
  return {
    operator_fail: `[${opsid}]${name}`,
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

test('remove da cobrança quem possui diálogo D-0 na base oficial', () => {
  const misscanRows = [
    ...Array.from({ length: 3 }, () => misscan('PESSOA REALIZADA HOJE', 'Packed TO', 'Ops430790')),
    ...Array.from({ length: 2 }, () => misscan('PESSOA AINDA PENDENTE', 'Packed TO', 'Ops999999')),
    ...Array.from({ length: 95 }, () => misscan('BASE OPERACIONAL', 'Packed TO', 'Ops111111'))
  ];
  const rows = buildPendingDialogueRows({
    misscan: misscanRows,
    hc: [
      { norm: 'PESSOA REALIZADA HOJE', turno: 'T2', lider_nome: 'Líder A' },
      { norm: 'PESSOA AINDA PENDENTE', turno: 'T2', lider_nome: 'Líder A' }
    ],
    completedOpsIds: ['430790']
  });

  assert.deepEqual(rows.map(row => row.collaborator), ['PESSOA AINDA PENDENTE']);
});

test('nova ocorrência após diálogo realizado avança para a primeira reciclagem', () => {
  const misscanRows = [
    ...Array.from({ length: 3 }, () => misscan('PESSOA REINCIDENTE', 'Packed TO', 'Ops430970')),
    ...Array.from({ length: 97 }, () => misscan('BASE OPERACIONAL', 'Packed TO', 'Ops111111'))
  ];
  const rows = buildDialogueStatusRows({
    misscan: misscanRows,
    hc: [
      { norm: 'PESSOA REINCIDENTE', turno: 'T2', lider_nome: 'Líder A' }
    ],
    dialogueCompletions: { OPS430970: ['2026-09-29'] },
    occurrenceDate: '2026-09-29'
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].done, false);
  assert.equal(rows[0].actionType, 'recycle');
  assert.equal(rows[0].actionCycle, 1);
  assert.equal(rows[0].actionLabel, '1ª reciclagem');
});

test('diálogo feito depois da ocorrência encerra somente aquela ocorrência', () => {
  const rows = buildDialogueStatusRows({
    misscan: [
      ...Array.from({ length: 3 }, () => misscan('PESSOA TRATADA', 'Packed TO', 'Ops430970')),
      ...Array.from({ length: 97 }, () => misscan('BASE OPERACIONAL', 'Packed TO', 'Ops111111'))
    ],
    hc: [{ norm: 'PESSOA TRATADA', turno: 'T2', lider_nome: 'Líder A' }],
    dialogueCompletions: { OPS430970: ['2026-09-29'] },
    occurrenceDate: '2026-09-28'
  });

  assert.equal(rows[0].done, true);
  assert.equal(rows[0].completedActionLabel, '1º diálogo');
});

test('fechamento separa realizados e faltantes', () => {
  const misscanRows = [
    ...Array.from({ length: 3 }, () => misscan('PESSOA REALIZADA', 'Packed TO', 'Ops430970')),
    ...Array.from({ length: 2 }, () => misscan('PESSOA PENDENTE', 'Packed TO', 'Ops999999')),
    ...Array.from({ length: 95 }, () => misscan('BASE OPERACIONAL', 'Packed TO', 'Ops111111'))
  ];
  const rows = buildDialogueStatusRows({
    misscan: misscanRows,
    hc: [
      { norm: 'PESSOA REALIZADA', turno: 'T2', lider_nome: 'Líder A' },
      { norm: 'PESSOA PENDENTE', turno: 'T2', lider_nome: 'Líder B' }
    ],
    completedOpsIds: ['430970']
  });
  const message = dialogueClosingMessage(rows, { periodLabel: 'D-1 | 28/09/2026' });

  assert.match(message, /FECHAMENTO DE TRATATIVAS/);
  assert.match(message, /Realizados \(1\)/);
  assert.match(message, /Faltantes \(1\)/);
  assert.match(message, /PESSOA REALIZADA/);
  assert.match(message, /PESSOA PENDENTE/);
  assert.match(message, /Total previsto: 2 \| Realizados: 1 \| Faltantes: 1/);
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
  assert.match(messages[0], /\*\*FISCAL DE MISSCAN — TRATATIVAS PENDENTES\*\*/);
  assert.match(messages[0], /PESSOA TESTE/);
  assert.match(messages[0], /OUTRA PESSOA/);
  assert.equal((messages[0].match(/👤 \*\*Líder: Líder Teste\*\*/g) || []).length, 1);
  assert.match(messages[0], /1\. PESSOA TESTE/);
  assert.match(messages[0], /2\. OUTRA PESSOA/);
  assert.match(messages[0], /2º diálogo/);
  assert.match(messages[0], /Líder: Líder Teste/);
  assert.match(messages[0], /enviar o PDF juntamente com o nome do colaborador/);
  assert.match(messages[0], /\*\*Total: 2 tratativas pendentes\.\*\*/);
  assert.doesNotMatch(messages[0], /Miss Scan:/);
  assert.doesNotMatch(messages[0], /registrar.*dashboard/i);
});

test('mensagem confirma quando não existem pendências', () => {
  const messages = dialogueReminderMessages([], { dateKey: '2026-09-29' });
  assert.match(messages[0], /Não há diálogos de performance pendentes/);
  assert.match(messages[0], /Referência: \*\*D-1\*\*/);
});
