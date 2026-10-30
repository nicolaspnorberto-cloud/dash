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
    completedOpsIds: ['430790'],
    occurrenceDate: '2026-09-28'
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
    completedOpsIds: ['430970'],
    occurrenceDate: '2026-09-28'
  });
  const message = dialogueClosingMessage(rows, { periodLabel: 'D-1 | 28/09/2026' });

  assert.match(message, /FECHAMENTO DE TRATATIVAS/);
  assert.match(message, /Realizados \(1\)/);
  assert.match(message, /Faltantes \(1\)/);
  assert.match(message, /PESSOA REALIZADA/);
  assert.match(message, /PESSOA PENDENTE/);
  assert.match(message, /Total acompanhado: 2 \| Realizados: 1 \| Pendentes com presença confirmada: 1 \| Aguardando presença: 0/);
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

test('rota T3 reúne T3 e T5 e exclui T2',()=>{
 const names=['Pessoa T2','Pessoa T3','Pessoa T5'];
 const options={targetTurn:'T3',misscan:names.map((name,i)=>({operator_fail:`[Ops${123+i}]${name}`,process_fail:'Packed TO'})),hc:names.map((name,i)=>({colaborador:name,turno:['T2','T3','T5'][i],lider_nome:'Lider'}))};
 const rows=buildDialogueStatusRows(options);
 assert.equal(rows.length,2);
 assert.deepEqual(rows.map(x=>x.collaborator).sort(),['Pessoa T3','Pessoa T5']);
});


test('T2 dispensa ABS somente às 13h e 14h; T3 e demais horários exigem presença', async()=>{
  const {reminderPresenceSelection}=await import('../lib/seatalk-reminders.mjs');
  const rows=[{opsid:'OPS1',done:false},{opsid:'OPS2',done:true}];
  for(const hour of [13,14]) {
    const result=reminderPresenceSelection(rows,null,{turn:'T2',hour,dateKey:'2026-10-22'});
    assert.equal(result.available,true);assert.equal(result.required,false);
    assert.deepEqual(result.eligible,rows);assert.deepEqual(result.deferred,[]);
  }
  for(const [turn,hour] of [['T2',12],['T2',15],['T2',22],['T3',13],['T3',14],['T3',21]]) {
    const result=reminderPresenceSelection(rows,null,{turn,hour,dateKey:'2026-10-22'});
    assert.equal(result.available,false);assert.equal(result.required,true);
  }
});


test('T3 dispensa ABS nas duas primeiras horas; às 23h30 e no fechamento exige ABS',async()=>{
  const {reminderPresenceSelection}=await import('../lib/seatalk-reminders.mjs');
  const rows=[{opsid:'OPS1',done:false},{opsid:'OPS2',done:true}];
  for(const [hour,minute] of [[21,30],[22,30],[23,29]]) {
    const result=reminderPresenceSelection(rows,null,{turn:'T3',hour,minute,dateKey:'2026-10-23'});
    assert.equal(result.available,true);assert.equal(result.required,false);
    assert.deepEqual(result.eligible,rows);assert.deepEqual(result.deferred,[]);
  }
  for(const [hour,minute] of [[21,29],[23,30],[0,30],[5,30]]) {
    const result=reminderPresenceSelection(rows,null,{turn:'T3',hour,minute,dateKey:'2026-10-23'});
    assert.equal(result.available,false);assert.equal(result.required,true);
  }
});

test('fiscal usa a classificação da aba Novos por OPSID, mantendo turno, share e tratativa',()=>{
 const options={misscan:[...Array.from({length:3},()=>misscan('PESSOA NOVATA','Packed TO','Ops123')),...Array.from({length:97},()=>misscan('BASE OPERACIONAL','Packed TO','Ops999'))],hc:[{norm:'PESSOA NOVATA',opsid:'OPS123',turno:'T2',lider_nome:'Líder de teste'}],admissions:[{opsid:'OPS123',admissionDate:'2026-10-15'}],classificationDate:'2026-10-29'};
 const [novice]=buildDialogueStatusRows(options);assert.equal(novice.isNewHire,true);assert.equal(novice.indicator,3);assert.equal(novice.turn,'T2');assert.equal(novice.leader,'Líder de teste');
 const [afterMonth]=buildDialogueStatusRows({...options,classificationDate:'2026-11-15'});assert.equal(afterMonth.isNewHire,false);assert.equal(afterMonth.indicator,novice.indicator);assert.equal(afterMonth.actionLabel,novice.actionLabel);
 const [unknown]=buildDialogueStatusRows({...options,admissions:[]});assert.equal(unknown.isNewHire,false);
 for(const record of [{admissionDate:'2026-10-30'},{admissionDate:'2026-02-30'},{admissionDate:'2026-10-15',conflict:true}])assert.equal(buildDialogueStatusRows({...options,admissions:[{opsid:'OPS123',...record}]})[0].isNewHire,false);
});
test('alerta e fechamento destacam novatos sem divulgar data de admissão ou alterar o nome',()=>{
 const novice={id:'TESTE NOVATO',collaborator:'Pessoa Teste',leader:'Líder de teste',indicator:3,cycle:1,isNewHire:true,actionLabel:'Realizar diálogo'},normal={...novice,id:'TESTE NORMAL',collaborator:'Outra Pessoa',isNewHire:false};
 const message=dialogueReminderMessages([novice,normal])[0];assert.match(message,/Pessoa Teste 🆕 \*\*COLABORADOR NOVATO\*\*/);assert.doesNotMatch(message,/Outra Pessoa 🆕/);assert.match(message,/Reforçar o acompanhamento/);
 const closing=dialogueClosingMessage([{...novice,done:true,completedActionLabel:'Diálogo realizado'},normal]);assert.match(closing,/Pessoa Teste 🆕 \*\*COLABORADOR NOVATO\*\*/);assert.match(closing,/Realizados \(1\)/);assert.match(closing,/Faltantes \(1\)/);assert.doesNotMatch(message+closing,/15\/10\/2026|2026-10-15/);
 const regular=dialogueReminderMessages([normal])[0];assert.doesNotMatch(regular,/COLABORADOR NOVATO|Reforçar o acompanhamento/);
});
test('novato sem OPS na ocorrência pode ser vinculado ao OPS confirmado na HC; T3/T5 preservados',()=>{
 const rows=buildDialogueStatusRows({misscan:[...Array.from({length:3},()=>({...misscan('PESSOA NOVATA','Packed TO',''),operator_fail:'PESSOA NOVATA'})),...Array.from({length:97},()=>misscan('BASE OPERACIONAL','Packed TO','Ops999'))],hc:[{norm:'PESSOA NOVATA',opsid:'OPS123',turno:'T5',lider_nome:'Líder de teste'}],admissions:[{opsid:'OPS123',admissionDate:'2026-10-15'}],classificationDate:'2026-10-29',targetTurn:'T3'});assert.equal(rows.length,1);assert.equal(rows[0].isNewHire,true);assert.equal(rows[0].turn,'T3');
});
