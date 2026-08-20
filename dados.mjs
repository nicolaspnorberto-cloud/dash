import {
  json,
  readJson,
  rowDateKey,
  monthsBetween
} from '../lib/blob-store.mjs';

const HC_PATH = 'misscan/hc.json';
const META_PATH = 'misscan/history-meta.json';

function isoDateUTC(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey, days) {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDateUTC(d);
}

function mondayOf(dateKey) {
  const d = new Date(`${dateKey}T12:00:00Z`);
  const day = d.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + delta);
  return isoDateUTC(d);
}

function resolvePeriod(url, meta) {
  const preset = String(url.searchParams.get('preset') || '').toUpperCase();
  const customFrom = String(url.searchParams.get('from') || '');
  const customTo = String(url.searchParams.get('to') || '');

  const today = isoDateUTC(new Date());
  const availableStart = meta?.historyStart || today;
  const availableEnd = meta?.historyEnd || today;

  if (/^\d{4}-\d{2}-\d{2}$/.test(customFrom) && /^\d{4}-\d{2}-\d{2}$/.test(customTo)) {
    return {
      preset: 'CUSTOM',
      from: customFrom <= customTo ? customFrom : customTo,
      to: customFrom <= customTo ? customTo : customFrom
    };
  }

  switch (preset) {
    case 'TODAY':
      return { preset, from: today, to: today };
    case 'YESTERDAY': {
      const y = addDays(today, -1);
      return { preset, from: y, to: y };
    }
    case 'CURRENT_WEEK':
      return { preset, from: mondayOf(today), to: today };
    case 'PREVIOUS_WEEK': {
      const currentMonday = mondayOf(today);
      return {
        preset,
        from: addDays(currentMonday, -7),
        to: addDays(currentMonday, -1)
      };
    }
    case 'LAST_30':
      return { preset, from: addDays(today, -29), to: today };
    case 'ALL':
      return { preset, from: availableStart, to: availableEnd };
    case 'LAST_7':
    default:
      return { preset: 'LAST_7', from: addDays(today, -6), to: today };
  }
}

function formatBr(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey || '—';
  const [y, m, d] = dateKey.split('-');
  return `${d}/${m}/${y}`;
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const meta = await readJson(META_PATH, null);
    const hcFile = await readJson(HC_PATH, { rows: [] });

    if (!meta) {
      return json({
        ok: false,
        error: 'Ainda não existe histórico sincronizado. Execute sincronizarDadosV61() no Apps Script.'
      }, 503);
    }

    const period = resolvePeriod(url, meta);
    const months = monthsBetween(period.from, period.to);

    if (months.length > 36) {
      return json({
        ok: false,
        error: 'Período muito amplo. Selecione no máximo 36 meses por consulta.'
      }, 400);
    }

    const rows = [];

    for (const month of months) {
      const file = await readJson(`misscan/history/${month}.json`, { rows: [] });
      for (const row of (file?.rows || [])) {
        const dateKey = rowDateKey(row);
        if (dateKey && dateKey >= period.from && dateKey <= period.to) rows.push(row);
      }
    }

    const last = new Date(meta?.receivedAt || meta?.updatedAt || 0);
    const ageMinutes = Number.isFinite(last.getTime())
      ? Math.round((Date.now() - last.getTime()) / 60000)
      : null;

    rows.sort((a, b) => String(a.lmreceived_date || '').localeCompare(String(b.lmreceived_date || '')));

    return json({
      ok: true,
      hc: hcFile?.rows || [],
      misscan: rows,
      meta: {
        ...meta,
        ageMinutes,
        stale: ageMinutes === null ? true : ageMinutes > 90,
        periodPreset: period.preset,
        periodStart: period.from,
        periodEnd: period.to,
        periodLabel: `${formatBr(period.from)} a ${formatBr(period.to)}`,
        historyLabel: `${formatBr(meta.historyStart)} a ${formatBr(meta.historyEnd)}`,
        returnedMisscanRecords: rows.length
      }
    });
  } catch (error) {
    console.error('MISSCAN_DATA_V61_ERROR', error);
    return json({
      ok: false,
      error: error?.message || 'Falha ao ler o histórico.'
    }, 500);
  }
}
