import {
  assertSyncToken,
  json,
  readJson,
  writeJson,
  rowDateKey,
  monthKeyFromDateKey
} from '../blob-store.mjs';

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

function monthStatsForRows(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const date = rowDateKey(row);
    const month = monthKeyFromDateKey(date);
    if (!month) continue;
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(row);
  }
  return Object.fromEntries(
    [...groups.entries()].map(([month, monthRows]) => [month, statsForRows(monthRows)])
  );
}

function aggregateMonthStats(shardStats = {}) {
  const result = {};
  for (const shard of Object.values(shardStats)) {
    for (const [month, stats] of Object.entries(shard?.months || {})) {
      if (!result[month]) {
        result[month] = { rows: 0, activeDays: 0, start: '', end: '' };
      }
      const out = result[month];
      out.rows += Number(stats?.rows || 0);
      out.activeDays += Number(stats?.activeDays || 0);
      const start = String(stats?.start || '');
      const end = String(stats?.end || '');
      if (start && (!out.start || start < out.start)) out.start = start;
      if (end && (!out.end || end > out.end)) out.end = end;
    }
  }
  return result;
}

function daysInclusive(start, end) {
  if (!start || !end) return 0;
  const a = new Date(`${start}T12:00:00Z`);
  const b = new Date(`${end}T12:00:00Z`);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return 0;
  return Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
}

function dateKeyDaysBefore(dateKey, days) {
  const raw = String(dateKey || '').trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? raw
    : raw.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$2-$1');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const date = new Date(`${iso}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() - Math.max(0, Number(days || 0)));
  return date.toISOString().slice(0, 10);
}

export async function GET() {
  return json({
    ok: true,
    route: '/api/sync',
    version: '7.2',
    recurringWindowDays: 3,
    recurringDateFormats: ['yyyy-mm-dd', 'dd/mm/yyyy'],
    method: 'POST',
    message: 'Sincronização LM V7.2 em blocos diários, com substituição integral por data e deduplicação por shipment_id.'
  });
}

export async function POST(request) {
  try {
    assertSyncToken(request);
    const payload = await request.json();

    const hasHC = Array.isArray(payload?.hc);
    const receivedMisscan = Array.isArray(payload?.misscan) ? payload.misscan : null;
    const replaceDates = new Set(
      Array.isArray(payload?.meta?.replaceDates)
        ? payload.meta.replaceDates.filter(x => /^\d{4}-\d{2}-\d{2}$/.test(String(x || '')))
        : []
    );

    if (!receivedMisscan) {
      return json({
        ok: false,
        error: 'Payload inválido: misscan precisa ser um array.'
      }, 400);
    }

    if ((hasHC && payload.hc.length > 30000) || receivedMisscan.length > 100000) {
      return json({
        ok: false,
        error: 'Payload acima do limite operacional esperado.'
      }, 413);
    }

    // Compatibilidade com o Apps Script V6.4.2, que ainda envia uma janela
    // recorrente de 45 dias em dezenas de lotes. Depois do backfill completo,
    // reprocessar semanas antigas é desnecessário e pode exceder a CPU do
    // Worker. Mantemos somente os três dias finais informados pelo próprio
    // snapshot. Backfill e atualização exata por data continuam integrais.
    const recurringCutoff = payload?.meta?.syncMode === 'INCREMENTAL_CHUNKED'
      ? dateKeyDaysBefore(payload?.meta?.periodEnd, 2)
      : '';

    const misscan = recurringCutoff
      ? receivedMisscan.filter(row => rowDateKey(row) >= recurringCutoff)
      : receivedMisscan;

    const now = new Date().toISOString();

    if (hasHC && payload?.meta?.updateHC !== false) {
      await writeJson(HC_PATH, {
        rows: payload.hc,
        updatedAt: now,
        source: payload?.meta?.hcSheet || 'Base de HC 26'
      });
    }

    const previousMeta = await readJson(META_PATH, {
      version: '7.2',
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
      if (!dateKey) continue;
      if (!groups.has(dateKey)) groups.set(dateKey, []);
      groups.get(dateKey).push(row);
    }

    const previousMode = String(previousMeta?.storageGranularity || '');
    const legacyShards = previousMode === 'iso-week-v1'
      ? (previousMeta?.shards || [])
      : (previousMeta?.legacyShards || []);
    const legacyShardStats = previousMode === 'iso-week-v1'
      ? (previousMeta?.shardStats || {})
      : (previousMeta?.legacyShardStats || {});
    const dayStats = {
      ...(['day-v1', 'hybrid-day-week-v1'].includes(previousMode)
        ? previousMeta?.dayStats || {}
        : {})
    };

    const savedDays = [];
    let totalMergedRows = 0;

    for (const [day, rows] of groups.entries()) {
      const path = `misscan/history-days/${day}.json`;
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
      const months = monthStatsForRows(merged);

      await writeJson(path, {
        day,
        rows: merged,
        updatedAt: now,
        stats
      });

      dayStats[day] = { ...stats, months };
      savedDays.push(day);
      totalMergedRows += merged.length;
    }

    const allDays = Object.keys(dayStats).sort();
    const monthStats = aggregateMonthStats(dayStats);
    const allMonths = Object.keys(monthStats).sort();
    const trackedStats = Object.values(dayStats)
      .filter(x => x && typeof x === 'object');

    const trackedStarts = trackedStats.map(x => x.start).filter(Boolean).sort();
    const trackedEnds = trackedStats.map(x => x.end).filter(Boolean).sort();

    const legacyStarts = Object.values(legacyShardStats).map(x => x?.start).filter(Boolean).sort();
    const legacyEnds = Object.values(legacyShardStats).map(x => x?.end).filter(Boolean).sort();
    const historyStart = [trackedStarts[0], legacyStarts[0]].filter(Boolean).sort()[0] || '';
    const historyEnd = [trackedEnds.at(-1), legacyEnds.at(-1)].filter(Boolean).sort().at(-1) || '';

    const statsRows = trackedStats.reduce(
      (sum, x) => sum + Number(x.rows || 0),
      0
    );

    const statsActiveDays = trackedStats.reduce(
      (sum, x) => sum + Number(x.activeDays || 0),
      0
    );

    const backfillDone = payload?.meta?.backfill?.status === 'DONE';
    const hasLegacy = legacyShards.length > 0 && !backfillDone;
    const historyRows = hasLegacy
      ? Math.max(Number(previousMeta?.historyRows || 0), statsRows)
      : statsRows;
    const historyActiveDays = hasLegacy
      ? Math.max(Number(previousMeta?.historyActiveDays || 0), statsActiveDays)
      : statsActiveDays;

    const historyCalendarDays = daysInclusive(historyStart, historyEnd);

    const meta = {
      ...previousMeta,
      ...(payload.meta || {}),
      version: '7.2',
      architecture: hasLegacy
        ? 'CLOUDFLARE_D1_HYBRID_DAY_WEEK_SHARDS'
        : 'CLOUDFLARE_D1_DAY_SHARDS',
      storageGranularity: hasLegacy ? 'hybrid-day-week-v1' : 'day-v1',
      receivedAt: now,
      updatedAt: now,
      historyStart,
      historyEnd,
      historyRows,
      historyActiveDays,
      historyCalendarDays,
      months: allMonths,
      monthStats,
      days: allDays,
      dayStats,
      legacyShards: hasLegacy ? legacyShards : [],
      legacyShardStats: hasLegacy ? legacyShardStats : {},
      hcRecords: hasHC
        ? payload.hc.length
        : Number(previousMeta?.hcRecords || 0),
      incomingMisscanRecords: misscan.length
    };

    await writeJson(META_PATH, meta);

    return json({
      ok: true,
      stored: true,
      version: '7.2',
      hcRecords: meta.hcRecords,
      receivedMisscanRecords: receivedMisscan.length,
      incomingMisscanRecords: misscan.length,
      ignoredMisscanRecords: receivedMisscan.length - misscan.length,
      misscanRecords: misscan.length,
      monthsUpdated: [...new Set(savedDays.map(day => day.slice(0, 7)))].sort(),
      daysUpdated: savedDays,
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
    console.error('MISSCAN_SYNC_V72_ERROR', error);
    return json({
      ok: false,
      error: error?.message || 'Falha ao sincronizar histórico V7.2.'
    }, error?.status || 500);
  }
}
