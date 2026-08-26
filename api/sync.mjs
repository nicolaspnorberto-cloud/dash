import {
  assertSyncToken,
  json,
  readJson,
  writeJson,
  rowDateKey,
  monthKeyFromDateKey
} from '../lib/blob-store.mjs';

const HC_PATH = 'misscan/hc.json';
const META_PATH = 'misscan/history-meta.json';

function rowScore(r) {
  const pf = String(r?.process_fail || '').trim();
  const tm = String(r?.to_mis_status || '').trim();
  const op = String(r?.operator_fail || '').trim();

  const hasResp =
    pf === 'Packed TO' ||
    pf.startsWith('Extra Parcel') ||
    tm === 'Whole TO' ||
    tm === 'Extra Parcel';

  const identified =
    op &&
    !op.includes(',') &&
    !/@/.test(op) &&
    !/^\s*NA\s*$/i.test(op);

  return (hasResp ? 10 : 0) +
    (identified ? 4 : 0) +
    (pf ? 2 : 0) +
    (tm ? 1 : 0);
}

function rowIdentityKey(r, index = 0) {
  const shipment = String(r?.shipment_id || '').trim();
  const date = rowDateKey(r) || 'NO_DATE';
  return shipment ? `${date}|${shipment}` : `${date}|ROW_${index}`;
}

function mergeRows(existingRows, incomingRows) {
  const map = new Map();

  [...(existingRows || []), ...(incomingRows || [])].forEach((r, index) => {
    const key = rowIdentityKey(r, index);
    const score = rowScore(r);
    const dt = Date.parse(String(r?.lmreceived_date || '').replace(' ', 'T')) || 0;
    const current = map.get(key);

    if (
      !current ||
      score > current.__score ||
      (score === current.__score && dt > current.__dt)
    ) {
      map.set(key, { ...r, __score: score, __dt: dt });
    }
  });

  return [...map.values()]
    .map(({ __score, __dt, ...r }) => r)
    .sort((a, b) =>
      String(a.lmreceived_date || '').localeCompare(
        String(b.lmreceived_date || '')
      )
    );
}

function statsForRows(rows = []) {
  const dateSet = new Set();
  const dates = [];

  for (const row of rows) {
    const key = rowDateKey(row);
    if (!key) continue;
    dateSet.add(key);
    dates.push(key);
  }

  dates.sort();

  return {
    rows: rows.length,
    activeDays: dateSet.size,
    start: dates[0] || '',
    end: dates.at(-1) || ''
  };
}

function daysInclusive(start, end) {
  if (!start || !end) return 0;
  const a = new Date(`${start}T12:00:00Z`);
  const b = new Date(`${end}T12:00:00Z`);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return 0;
  return Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
}

export async function GET() {
  return json({
    ok: true,
    route: '/api/sync',
    version: '6.8',
    method: 'POST',
    message: 'Sincronização LM V6.8 com substituição integral por data e deduplicação por shipment_id.'
  });
}

export async function POST(request) {
  try {
    assertSyncToken(request);
    const payload = await request.json();

    const hasHC = Array.isArray(payload?.hc);
    const misscan = Array.isArray(payload?.misscan) ? payload.misscan : null;
    const replaceDates = new Set(
      Array.isArray(payload?.meta?.replaceDates)
        ? payload.meta.replaceDates.filter(x => /^\d{4}-\d{2}-\d{2}$/.test(String(x || '')))
        : []
    );

    if (!misscan) {
      return json({
        ok: false,
        error: 'Payload inválido: misscan precisa ser um array.'
      }, 400);
    }

    if ((hasHC && payload.hc.length > 30000) || misscan.length > 100000) {
      return json({
        ok: false,
        error: 'Payload acima do limite operacional esperado.'
      }, 413);
    }

    const now = new Date().toISOString();

    if (hasHC && payload?.meta?.updateHC !== false) {
      await writeJson(HC_PATH, {
        rows: payload.hc,
        updatedAt: now,
        source: payload?.meta?.hcSheet || 'Base de HC 26'
      });
    }

    const previousMeta = await readJson(META_PATH, {
      version: '6.8',
      months: [],
      monthStats: {},
      historyStart: '',
      historyEnd: '',
      historyRows: 0,
      historyActiveDays: 0,
      historyCalendarDays: 0
    });

    const groups = new Map();

    for (const row of misscan) {
      const dateKey = rowDateKey(row);
      const month = monthKeyFromDateKey(dateKey);
      if (!month) continue;
      if (!groups.has(month)) groups.set(month, []);
      groups.get(month).push(row);
    }

    const monthStats = {
      ...(previousMeta?.monthStats || {})
    };

    const savedMonths = [];
    let totalMergedRows = 0;

    for (const [month, rows] of groups.entries()) {
      const path = `misscan/history/${month}.json`;
      const existing = await readJson(path, { rows: [] });

      // Quando o Apps Script informa replaceDates, removemos o snapshot antigo
      // dessas datas antes de mesclar o novo. Isso impede resíduos de uma carga
      // parcial (ex.: 952 BR) quando a LM já contém o bloco completo.
      const baseRows = (existing?.rows || []).filter(row => {
        const key = rowDateKey(row);
        return !replaceDates.has(key);
      });

      const merged = mergeRows(baseRows, rows);
      const stats = statsForRows(merged);

      await writeJson(path, {
        month,
        rows: merged,
        updatedAt: now,
        stats
      });

      monthStats[month] = stats;
      savedMonths.push(month);
      totalMergedRows += merged.length;
    }

    const legacyMonths = Array.isArray(previousMeta?.months)
      ? previousMeta.months
      : [];

    const allMonths = [...new Set([
      ...legacyMonths,
      ...Object.keys(monthStats),
      ...savedMonths
    ])].sort();

    const trackedStats = Object.values(monthStats)
      .filter(x => x && typeof x === 'object');

    const trackedStarts = trackedStats.map(x => x.start).filter(Boolean).sort();
    const trackedEnds = trackedStats.map(x => x.end).filter(Boolean).sort();

    const historyStart = [
      previousMeta?.historyStart,
      trackedStarts[0]
    ].filter(Boolean).sort()[0] || '';

    const historyEnd = [
      previousMeta?.historyEnd,
      trackedEnds.at(-1)
    ].filter(Boolean).sort().at(-1) || '';

    const statsRows = trackedStats.reduce(
      (sum, x) => sum + Number(x.rows || 0),
      0
    );

    const statsActiveDays = trackedStats.reduce(
      (sum, x) => sum + Number(x.activeDays || 0),
      0
    );

    const historyRows = statsRows;
    const historyActiveDays = statsActiveDays;

    const historyCalendarDays = daysInclusive(historyStart, historyEnd);

    const meta = {
      ...previousMeta,
      ...(payload.meta || {}),
      version: '6.8',
      architecture: 'PUSH_PRIVADO_V6_4_DYNAMIC_LM_HISTORY',
      receivedAt: now,
      updatedAt: now,
      historyStart,
      historyEnd,
      historyRows,
      historyActiveDays,
      historyCalendarDays,
      months: allMonths,
      monthStats,
      hcRecords: hasHC
        ? payload.hc.length
        : Number(previousMeta?.hcRecords || 0),
      incomingMisscanRecords: misscan.length
    };

    await writeJson(META_PATH, meta);

    return json({
      ok: true,
      stored: true,
      version: '6.8',
      hcRecords: meta.hcRecords,
      incomingMisscanRecords: misscan.length,
      misscanRecords: misscan.length,
      monthsUpdated: savedMonths,
      mergedRowsAcrossUpdatedMonths: totalMergedRows,
      historyStart,
      historyEnd,
      historyRows,
      historyActiveDays,
      historyCalendarDays,
      receivedAt: now,
      backfill: meta.backfill || null
    });

  } catch (error) {
    console.error('MISSCAN_SYNC_V68_ERROR', error);
    return json({
      ok: false,
      error: error?.message || 'Falha ao sincronizar histórico V6.4.'
    }, error?.status || 500);
  }
}
