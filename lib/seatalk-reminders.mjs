import { readJson, writeJson } from './blob-store.mjs';
import { validOperators, responsibility } from '../api/dados.mjs';
import * as dados from '../api/dados.mjs';
import * as tratativas from '../api/tratativas.mjs';
import { sendSeatalkText } from './seatalk.mjs';

const TARGET = 0.88;
const REMINDER_STATE_PATH = 'misscan/seatalk-dialogue-reminder.json';
const REPORT_PRESET = 'LAST_7';

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

function progressFor(progress, id) {
  const value = progress?.[id] || {};
  const cycle = Math.min(3, Math.max(1, Number(value.requiredCycle) || 1));
  return { value, cycle };
}

export function buildPendingDialogueRows({ misscan = [], hc = [], progress = {} } = {}) {
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
    const { value, cycle } = progressFor(progress, item.id);
    if (value?.[`dialogue${cycle}`]?.done) continue;
    const person = hcMap.get(item.id) || {};
    const turn = normalizeTurn(person.turno);
    const leader = String(person.lider_nome || '').trim();
    if (turn !== 'T2' || !leader) continue;
    const operation = Object.entries(item.areaCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'NA';
    rows.push({
      ...item,
      indicator,
      cycle,
      operation,
      turn,
      sector: String(person.setor || 'Não cadastrado'),
      leader
    });
  }

  return rows.sort((a, b) =>
    b.indicator - a.indicator || b.missScan - a.missScan ||
    a.collaborator.localeCompare(b.collaborator, 'pt-BR')
  );
}

export function dialogueReminderMessages(rows = [], {
  dateKey = saoPauloDate(),
  periodLabel = 'Últimos 7 dias',
  chunkSize = 18
} = {}) {
  const header = [
    '🐕 Fiscal de Misscan MG4',
    '',
    `📋 Cobrança diária — Diálogos de Performance`,
    `Data: ${formatDate(dateKey)}`,
    `Período analisado: ${periodLabel}`,
    `Target: acima de ${formatPercent(TARGET)}`,
    'Escopo: somente colaboradores do turno T2 com líder identificado',
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
    part.forEach((row, index) => {
      lines.push(
        `${start + index + 1}. ${row.collaborator}`,
        `   ${row.cycle}º diálogo pendente • Indicador ${formatPercent(row.indicator)}`,
        `   ${row.turn} • ${row.sector} • Líder: ${row.leader}`
      );
    });
    if (page === pages) {
      lines.push('', `⚠️ Total: ${rows.length} colaborador(es) aguardando diálogo.`);
    }
    messages.push(lines.join('\n'));
  }
  return messages;
}

function signature(rows) {
  return rows.map(row => `${row.id}|${row.cycle}|${row.indicator.toFixed(6)}`).join('\n');
}

async function responseJson(response, label) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `Falha ao carregar ${label} (${response.status}).`);
  }
  return data;
}

export async function sendDailyDialogueReminder({ force = false } = {}) {
  const origin = 'https://worker.internal';
  const [reportResponse, treatmentResponse] = await Promise.all([
    dados.GET(new Request(`${origin}/api/dados?preset=${REPORT_PRESET}&include_hc=1`)),
    tratativas.GET(new Request(`${origin}/api/tratativas`))
  ]);
  const [report, treatment] = await Promise.all([
    responseJson(reportResponse, 'dados de Misscan'),
    responseJson(treatmentResponse, 'histórico de tratativas')
  ]);

  const rows = buildPendingDialogueRows({
    misscan: report.misscan || [],
    hc: report.hc || [],
    progress: treatment.progress || {}
  });
  const dateKey = saoPauloDate();
  const reportSignature = signature(rows);
  const previous = await readJson(REMINDER_STATE_PATH, {});
  if (!force && previous?.dateKey === dateKey && previous?.signature === reportSignature) {
    return { ok: true, skipped: true, reason: 'already-sent', dateKey, pending: rows.length };
  }

  const messages = dialogueReminderMessages(rows, {
    dateKey,
    periodLabel: report?.meta?.periodLabel || 'Últimos 7 dias'
  });
  const sent = [];
  for (const message of messages) sent.push(await sendSeatalkText(message));

  await writeJson(REMINDER_STATE_PATH, {
    dateKey,
    signature: reportSignature,
    pending: rows.length,
    sentAt: new Date().toISOString(),
    group: sent[0]?.group || '',
    messageIds: sent.map(item => item.messageId).filter(Boolean)
  });

  return {
    ok: true,
    sent: true,
    dateKey,
    pending: rows.length,
    messages: messages.length,
    group: sent[0]?.group || ''
  };
}
