import { readJson, writeJson } from './blob-store.mjs';
import { validOperators, responsibility } from '../api/dados.mjs';
import * as dados from '../api/dados.mjs';
import * as tratativas from '../api/tratativas.mjs';
import { sendSeatalkText, SEATALK_PAUSED } from './seatalk.mjs';
import { dialogueCompletionsByOpsId, normalizeOpsId } from './dialogues-realized.mjs';
import { PRESENCE_PATH, selectPresentTreatments } from './abs-presence.mjs';

const TARGET = 0.88;
const REMINDER_STATE_PATH = 'misscan/seatalk-dialogue-reminder.json';
const REPORT_PRESET = 'YESTERDAY';
const MANUAL_DIALOGUE_COMPLETIONS = Object.freeze([
  // Correção confirmada pelo responsável em 29/09/2026: o diálogo de José
  // Raimundo foi realizado, mas a planilha recebeu OPS430790 por engano.
  { dateKey: '2026-09-29', opsid: 'OPS430970' }
]);

function normalizeName(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizeTurn(value = '') {
  const turn = String(value || '').trim().toUpperCase();
  if (turn === 'T4') return 'T2';
  if (turn === 'T5') return 'T3';
  return turn || 'Não cadastrado';
}

function saoPauloDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function saoPauloHour() {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    hourCycle: 'h23'
  }).format(new Date()));
}

function formatDate(dateKey) {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(dateKey || '');
}

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}%`;
}

function saoPauloDateFrom(value = '') {
  const text = String(value || '').trim();
  const direct = text.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (direct) return direct[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(parsed);
}

function actionLabel(type, cycle) {
  if (type === 'dialogue') return `${cycle}º diálogo`;
  if (type === 'recycle') return `${cycle}ª reciclagem`;
  return 'Fluxo concluído';
}

function treatmentAction(progress, id, opsid, dialogueCompletions, occurrenceDate) {
  const value = progress?.[id] || {};
  const officialDates = [...new Set(dialogueCompletions?.[opsid] || [])].sort();

  for (let cycle = 1; cycle <= 3; cycle++) {
    const dialogue = value[`dialogue${cycle}`] || {};
    const dialogueDate = dialogue.done
      ? saoPauloDateFrom(dialogue.date || dialogue.updatedAt)
      : officialDates[cycle - 1] || '';

    if (!dialogueDate) {
      return {
        doneCurrent: false,
        actionType: 'dialogue',
        actionCycle: cycle,
        actionLabel: actionLabel('dialogue', cycle)
      };
    }
    if (occurrenceDate && dialogueDate > occurrenceDate) {
      return {
        doneCurrent: true,
        actionType: 'dialogue',
        actionCycle: cycle,
        actionLabel: actionLabel('dialogue', cycle),
        completedActionLabel: actionLabel('dialogue', cycle)
      };
    }

    const recycle = value[`recycle${cycle}`] || {};
    const recycleDate = recycle.done
      ? saoPauloDateFrom(recycle.completedAt || recycle.date || recycle.updatedAt)
      : '';
    if (!recycleDate) {
      return {
        doneCurrent: false,
        actionType: 'recycle',
        actionCycle: cycle,
        actionLabel: actionLabel('recycle', cycle)
      };
    }
    if (occurrenceDate && recycleDate > occurrenceDate) {
      return {
        doneCurrent: true,
        actionType: 'recycle',
        actionCycle: cycle,
        actionLabel: actionLabel('recycle', cycle),
        completedActionLabel: actionLabel('recycle', cycle)
      };
    }
  }

  return {
    doneCurrent: true,
    actionType: 'complete',
    actionCycle: 3,
    actionLabel: 'Fluxo concluído',
    completedActionLabel: '3ª reciclagem'
  };
}

export function buildDialogueStatusRows({
  misscan = [], hc = [], progress = {}, completedOpsIds = [],
  dialogueCompletions = {}, occurrenceDate = ''
} = {}) {
  const completionHistory = Object.fromEntries(
    Object.entries(dialogueCompletions || {}).map(([opsid, dates]) => [
      normalizeOpsId(opsid),
      [...new Set((dates || []).filter(Boolean))].sort()
    ])
  );
  for (const opsid of completedOpsIds || []) {
    const normalized = normalizeOpsId(opsid);
    if (normalized) completionHistory[normalized] = ['9999-12-31'];
  }
  const hcMap = new Map();
  for (const row of hc || []) {
    const key = normalizeName(row?.norm || row?.colaborador);
    if (key) hcMap.set(key, row);
  }

  const identified = [];
  for (const row of misscan || []) {
    if (responsibility(row) === 'NA') continue;
    const operators = validOperators(row?.operator_fail);
    if (operators.length !== 1) continue;
    identified.push({ row, operator: operators[0] });
  }

  const total = identified.length || 1;
  const grouped = new Map();
  for (const { row, operator } of identified) {
    const id = normalizeName(operator.name);
    if (!id) continue;
    if (!grouped.has(id)) {
      grouped.set(id, {
        id,
        opsid: normalizeOpsId(operator.opsid),
        collaborator: operator.name,
        missScan: 0,
        areaCounts: {}
      });
    }
    const item = grouped.get(id);
    const area = responsibility(row);
    item.missScan++;
    item.areaCounts[area] = (item.areaCounts[area] || 0) + 1;
  }

  const rows = [];
  for (const item of grouped.values()) {
    const indicator = item.missScan / total * 100;
    if (!(indicator > TARGET)) continue;
    const treatment = treatmentAction(
      progress,
      item.id,
      item.opsid,
      completionHistory,
      occurrenceDate
    );
    const person = hcMap.get(item.id) || {};
    const turn = normalizeTurn(person.turno);
    const leader = String(person.lider_nome || '').trim();
    if (turn !== 'T2' || !leader) continue;
    const operation = Object.entries(item.areaCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'NA';
    rows.push({
      ...item,
      indicator,
      operation,
      turn,
      sector: String(person.setor || 'Não cadastrado'),
      leader,
      ...treatment,
      cycle: treatment.actionCycle,
      done: treatment.doneCurrent
    });
  }

  return rows.sort((a, b) =>
    b.indicator - a.indicator || b.missScan - a.missScan ||
    a.collaborator.localeCompare(b.collaborator, 'pt-BR')
  );
}

export function buildPendingDialogueRows(options = {}) {
  return buildDialogueStatusRows(options).filter(row => !row.done);
}

export function dialogueReminderMessages(rows = [], {
  dateKey = saoPauloDate(),
  periodLabel = 'D-1',
  chunkSize = 18
} = {}) {
  const header = [
    '**FISCAL DE MISSCAN — TRATATIVAS PENDENTES**',
    '',
    `📅 Referência: **${periodLabel}**`,
    `🎯 Critério: indicador acima de **${formatPercent(TARGET)} — Turno T2**`,
    ''
  ];

  if (!rows.length) {
    return [[...header, '✅ Não há diálogos de performance pendentes no momento.'].join('\n')];
  }

  const messages = [];
  for (let start = 0; start < rows.length; start += chunkSize) {
    const part = rows.slice(start, start + chunkSize);
    const page = Math.floor(start / chunkSize) + 1;
    const pages = Math.ceil(rows.length / chunkSize);
    const lines = [...header];
    if (pages > 1) lines.push(`Página ${page}/${pages}`, '');
    const byLeader = new Map();
    part.forEach(row => {
      if (!byLeader.has(row.leader)) byLeader.set(row.leader, []);
      byLeader.get(row.leader).push(row);
    });
    let position = start + 1;
    for (const [leader, members] of byLeader) {
      lines.push(`👤 **Líder: ${leader}**`, '');
      for (const row of members) {
        lines.push(
          `${position}. ${row.collaborator} — ${formatPercent(row.indicator)} | ${row.actionLabel || actionLabel('dialogue', row.cycle)}`
        );
        position++;
      }
      lines.push('');
    }
    if (page === pages) {
      lines.push(
        '⚠️ **Ação necessária:** Diálogos devem ser realizados pelo líder; reciclagens, pelo instrutor. Após o diálogo, enviar o PDF juntamente com o nome do colaborador.',
        '',
        `**Total: ${rows.length} ${rows.length === 1 ? 'tratativa pendente' : 'tratativas pendentes'}.**`
      );
    }
    messages.push(lines.join('\n'));
  }
  return messages;
}

export function dialogueClosingMessage(rows = [], {
  periodLabel = 'D-1', deferred = []
} = {}) {
  const completed = rows.filter(row => row.done);
  const pending = rows.filter(row => !row.done);
  const lines = [
    '**FISCAL DE MISSCAN — FECHAMENTO DE TRATATIVAS**',
    '',
    `📅 Referência: **${periodLabel}**`,
    `🎯 Critério: indicador acima de **${formatPercent(TARGET)} — Turno T2**`,
    '',
    `✅ **Realizados (${completed.length})**`
  ];
  if (completed.length) {
    completed.forEach((row, index) => {
      lines.push(`${index + 1}. ${row.collaborator} — ${formatPercent(row.indicator)} | ${row.completedActionLabel || row.actionLabel || actionLabel('dialogue', row.cycle)}`);
    });
  } else {
    lines.push('Nenhum diálogo identificado como realizado.');
  }
  lines.push('', `⚠️ **Faltantes (${pending.length})**`);
  if (pending.length) {
    pending.forEach((row, index) => {
      lines.push(`${index + 1}. ${row.collaborator} — ${formatPercent(row.indicator)} | ${row.actionLabel || actionLabel('dialogue', row.cycle)} | Líder: ${row.leader}`);
    });
  } else {
    lines.push('Nenhum diálogo pendente.');
  }
  lines.push('', `**Total acompanhado: ${rows.length + deferred.length} | Realizados: ${completed.length} | Pendentes com presença confirmada: ${pending.length} | Aguardando presença: ${deferred.length}.**`);
  if (deferred.length) lines.push('As tratativas aguardando presença permanecem abertas, sem cobrança durante a ausência ou enquanto a presença não for confirmada no ABS.');
  return lines.join('\n');
}

function signature(rows) {
  return rows.map(row => `${row.id}|${row.actionType}|${row.actionCycle}|${row.done}|${row.indicator.toFixed(6)}`).join('\n');
}

async function responseJson(response, label) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `Falha ao carregar ${label} (${response.status}).`);
  }
  return data;
}

export async function sendDailyDialogueReminder({ force = false } = {}) {
  if (SEATALK_PAUSED) return { ok: true, skipped: true, reason: 'emergency-paused' };
  const hour = saoPauloHour();
  if (!force && (hour < 13 || hour > 23)) {
    return { ok: true, skipped: true, reason: 'outside-t2-window', hour };
  }

  const origin = 'https://worker.internal';
  const dateKey = saoPauloDate();
  const presence = await readJson(PRESENCE_PATH, null);
  const presenceCheck = selectPresentTreatments([], presence, { dateKey });
  if (!presenceCheck.available) return { ok: true, skipped: true, reason: presenceCheck.reason, dateKey };
  const [reportResponse, treatmentResponse, storedDialogueCompletions] = await Promise.all([
    dados.GET(new Request(`${origin}/api/dados?preset=${REPORT_PRESET}&include_hc=1`)),
    tratativas.GET(new Request(`${origin}/api/tratativas`)),
    dialogueCompletionsByOpsId(dateKey)
  ]);
  const [report, treatment] = await Promise.all([
    responseJson(reportResponse, 'dados de Misscan'),
    responseJson(treatmentResponse, 'histórico de tratativas')
  ]);

  const dialogueCompletions = { ...storedDialogueCompletions };
  for (const correction of MANUAL_DIALOGUE_COMPLETIONS) {
    if (correction.dateKey > dateKey) continue;
    const opsid = normalizeOpsId(correction.opsid);
    if (!opsid) continue;
    dialogueCompletions[opsid] = [
      ...new Set([...(dialogueCompletions[opsid] || []), correction.dateKey])
    ].sort();
  }
  const occurrenceDate =
    report?.meta?.periodStart && report?.meta?.periodStart === report?.meta?.periodEnd
      ? report.meta.periodStart
      : '';
  const statusRows = buildDialogueStatusRows({
    misscan: report.misscan || [],
    hc: report.hc || [],
    progress: treatment.progress || {},
    dialogueCompletions,
    occurrenceDate
  });
  const presenceSelection = selectPresentTreatments(statusRows, presence, { dateKey });
  if (!presenceSelection.available) return { ok: true, skipped: true, reason: presenceSelection.reason, dateKey };
  const eligibleStatusRows = presenceSelection.eligible;
  const deferred = presenceSelection.deferred;
  const rows = eligibleStatusRows.filter(row => !row.done);
  const hourKey = `${dateKey}T${String(hour).padStart(2, '0')}`;
  const isClosingReport = !force && hour === 23;
  const reportSignature = signature(isClosingReport ? eligibleStatusRows : rows) + (isClosingReport ? `|deferred:${deferred.length}` : '');
  const previous = await readJson(REMINDER_STATE_PATH, {});
  if (!force && !isClosingReport && !rows.length) {
    return { ok: true, skipped: true, reason: deferred.length ? 'no-present-pending' : 'no-pending', dateKey, pending: 0, deferred: deferred.length };
  }
  if (!force && previous?.hourKey === hourKey && previous?.signature === reportSignature) {
    return { ok: true, skipped: true, reason: 'already-sent-this-hour', dateKey, hourKey, pending: rows.length };
  }

  const periodLabel =
    report?.meta?.periodStart && report?.meta?.periodStart === report?.meta?.periodEnd
      ? `D-1 | ${formatDate(report.meta.periodStart)}`
      : report?.meta?.periodLabel || 'D-1';
  const messages = isClosingReport
    ? [dialogueClosingMessage(eligibleStatusRows, { periodLabel, deferred })]
    : dialogueReminderMessages(rows, { dateKey, periodLabel });
  const sent = [];
  for (const message of messages) sent.push(await sendSeatalkText(message));

  await writeJson(REMINDER_STATE_PATH, {
    dateKey,
    hourKey,
    signature: reportSignature,
    pending: rows.length,
    deferred: deferred.length,
    presenceDate: presence.dateKey,
    presenceGeneratedAt: presence.generatedAt,
    sentAt: new Date().toISOString(),
    group: sent[0]?.group || '',
    messageIds: sent.map(item => item.messageId).filter(Boolean)
  });

  return {
    ok: true,
    sent: true,
    dateKey,
    pending: rows.length,
    deferred: deferred.length,
    completed: statusRows.filter(row => row.done).length,
    closingReport: isClosingReport,
    messages: messages.length,
    group: sent[0]?.group || ''
  };
}
