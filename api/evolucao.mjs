import { withReportCache } from '../lib/report-cache.mjs';
import {
  json,
  readJson,
  readHistoryRange,
  rowDateKey,
  normalizeName
} from '../lib/blob-store.mjs';
import {
  attributeDynamicV613,
  responsibility,
  validOperators
} from './dados.mjs';

const HC_PATH = 'misscan/hc.json';
const META_PATH = 'misscan/history-meta.json';
const GEROT_PATH = 'misscan/gerot.json';
const TARGET = 0.88;

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOf(dateKey) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function isoWeek(dateKey) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const number = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `W${String(number).padStart(2, '0')}`;
}

function normalizeTurn(value = '') {
  const matches = [...new Set(String(value).toUpperCase().match(/T[1-5]/g) || [])]
    .map(turn => turn === 'T4' ? 'T2' : turn === 'T5' ? 'T3' : turn);
  return [...new Set(matches)].join(' / ') || 'Não cadastrado';
}

function hcIndexes(rows = []) {
  const byName = new Map();
  const byOpsid = new Map();
  for (const row of rows) {
    const name = normalizeName(row?.colaborador || row?.nome || row?.name || row?.norm || '');
    const opsid = String(row?.opsid || row?.OpsID || row?.matricula || '').trim().toUpperCase();
    if (name) byName.set(name, row);
    if (opsid) byOpsid.set(opsid, row);
  }
  return { byName, byOpsid };
}

function hcInfo(index, operator) {
  const opsid = String(operator?.opsid || '').toUpperCase();
  const row = index.byOpsid.get(opsid) || index.byName.get(normalizeName(operator?.name || ''));
  if (!row) {
    return {
      turno: 'Não cadastrado',
      setor: 'Não cadastrado',
      lider: 'Não cadastrado',
      tipo: 'Diarista'
    };
  }
  return {
    turno: normalizeTurn(row?.turno || ''),
    setor: String(row?.setor || 'Não cadastrado'),
    lider: String(row?.lider_nome || row?.lider || 'Não cadastrado'),
    tipo: String(row?.tipo_hc || row?.tipo || 'Fixo')
  };
}

function weekMetric() {
  return {
    missScan: 0,
    esteira: 0,
    expedicao: 0,
    share: null,
    position: null
  };
}

const cachedReport=withReportCache(buildReport);
export async function GET(request){return cachedReport(request);}

async function buildReport(request) {
  try {
    const url = new URL(request.url);
    const requestedWeeks = Math.max(6, Math.min(16, Number(url.searchParams.get('weeks') || 8)));
    const meta = await readJson(META_PATH, null);
    const gerot = await readJson(GEROT_PATH, null);
    const hcFile = await readJson(HC_PATH, { rows: [] });

    if (!meta?.historyStart || !meta?.historyEnd) {
      return json({ ok: false, error: 'Histórico da LM ainda não está disponível.' }, 503);
    }
    if (!gerot?.processed?.length) {
      return json({ ok: false, error: 'Volume expedido da GEROT ainda não está disponível.' }, 503);
    }

    const end = meta.historyEnd;
    const requestedStart = addDays(mondayOf(end), -(requestedWeeks - 1) * 7);
    const start = requestedStart < meta.historyStart ? meta.historyStart : requestedStart;
    const sourceRows = await readHistoryRange(start, end, meta);

    const volumeByWeek = new Map();
    const volumeDaysByWeek = new Map();
    const weekStartByKey = new Map();
    for (const row of (gerot.processed || [])) {
      const date = String(row?.date || '');
      if (!date || date < start || date > end) continue;
      const week = isoWeek(date);
      const currentStart = weekStartByKey.get(week);
      if (!currentStart || date < currentStart) weekStartByKey.set(week, date);
      const volume = Math.max(0, Number(row?.socPacked || 0));
      volumeByWeek.set(week, (volumeByWeek.get(week) || 0) + volume);
      if (!volumeDaysByWeek.has(week)) volumeDaysByWeek.set(week, new Set());
      if (volume > 0) volumeDaysByWeek.get(week).add(date);
    }

    const attributed = attributeDynamicV613(sourceRows);
    const hcIndex = hcIndexes(hcFile?.rows || []);
    const map = new Map();
    const misscanByWeek = new Map();
    let manual = 0;
    let unidentified = 0;

    for (const row of attributed) {
      const date = rowDateKey(row);
      if (!date) continue;
      const week = isoWeek(date);
      const currentStart = weekStartByKey.get(week);
      if (!currentStart || date < currentStart) weekStartByKey.set(week, date);
      misscanByWeek.set(week, (misscanByWeek.get(week) || 0) + 1);
      const operators = validOperators(row?.operator_fail || '');
      if (operators.length !== 1) {
        unidentified++;
        continue;
      }
      const operator = operators[0];
      if (operator.key === 'OPS0' || normalizeName(operator.name) === 'MANUAL') {
        manual++;
        continue;
      }

      const key = String(operator.opsid || normalizeName(operator.name)).toUpperCase();
      if (!map.has(key)) {
        map.set(key, {
          key,
          opsid: operator.opsid || '',
          colaborador: operator.name,
          ...hcInfo(hcIndex, operator),
          weeks: {}
        });
      }

      const item = map.get(key);
      if (!item.weeks[week]) item.weeks[week] = weekMetric();
      const metric = item.weeks[week];
      metric.missScan++;
      const area = responsibility(row);
      if (area === 'ESTEIRA') metric.esteira++;
      if (area === 'EXPEDIÇÃO') metric.expedicao++;
    }

    const weekKeys = [...new Set([
      ...volumeByWeek.keys(),
      ...misscanByWeek.keys()
    ])].sort((a, b) => String(weekStartByKey.get(a) || a).localeCompare(String(weekStartByKey.get(b) || b)));

    for (const week of weekKeys) {
      const volume = Number(volumeByWeek.get(week) || 0);
      const weeklyMissScan = Number(misscanByWeek.get(week) || 0);
      const ranked = [...map.values()]
        .filter(item => item.weeks[week]?.missScan > 0)
        .sort((a, b) => b.weeks[week].missScan - a.weeks[week].missScan ||
          a.colaborador.localeCompare(b.colaborador, 'pt-BR'));
      ranked.forEach((item, index) => {
        const metric = item.weeks[week];
        metric.position = index + 1;
        metric.volume = volume;
        metric.share = weeklyMissScan > 0 ? metric.missScan / weeklyMissScan * 100 : null;
      });
    }

    const rows = [...map.values()].sort((a, b) => {
      const latest = weekKeys.at(-1);
      return Number(b.weeks[latest]?.missScan || 0) - Number(a.weeks[latest]?.missScan || 0) ||
        a.colaborador.localeCompare(b.colaborador, 'pt-BR');
    });

    return json({
      ok: true,
      version: '6.16',
      target: TARGET,
      weeks: weekKeys.map(week => ({
        week,
        missScan: Number(misscanByWeek.get(week) || 0),
        volume: Number(volumeByWeek.get(week) || 0),
        rate: Number(volumeByWeek.get(week) || 0) > 0
          ? Number(misscanByWeek.get(week) || 0) / Number(volumeByWeek.get(week)) * 100
          : null,
        volumeDays: volumeDaysByWeek.get(week)?.size || 0
      })),
      rows,
      meta: {
        periodStart: start,
        periodEnd: end,
        historyStart: meta.historyStart,
        historyEnd: meta.historyEnd,
        sourceRows: sourceRows.length,
        returnedRows: rows.length,
        manual,
        unidentified,
        volumeSource: 'GEROT db_volume_overall • Inter-SOC • SOC_Packed',
        numeratorSource: 'Matinal/LM • mesma atribuição do ranking V6.13',
        shareSource: 'BRs do colaborador ÷ total de Miss Scans da semana',
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('EVOLUCAO_V615_ERROR', error);
    return json({ ok: false, error: error?.message || 'Falha ao calcular matriz de evolução.' }, 500);
  }
}
