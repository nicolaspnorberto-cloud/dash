import {
  assertSyncToken,
  json,
  readJson,
  writeJson,
  rowDateKey,
  monthKeyFromDateKey,
  isoWeekStartKey
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
    version: '7.1',
    recurringWindowDays: 3,
    recurringDateFormats: ['yyyy-mm-dd', 'dd/mm/yyyy'],
    method: 'POST',
    message: 'Sincronização LM V7.1 em blocos semanais, com substituição integral por data e deduplicação por shipment_id.'
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
      version: '7.1',
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
      const shard = isoWeekStartKey(dateKey);
      if (!shard) continue;
      if (!groups.has(shard)) groups.set(shard, []);
      groups.get(shard).push(row);
    }

    const shardStats = {
      ...(previousMeta?.storageGranularity === 'iso-week-v1'
        ? previousMeta?.shardStats || {}
        : {})
    };

    const savedShards = [];
    let totalMergedRows = 0;

    for (const [shard, rows] of groups.entries()) {
      const path = `misscan/history-shards/${shard}.json`;
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
        shard,
        rows: merged,
        updatedAt: now,
        stats,
        months
      });

      shardStats[shard] = { ...stats, months };
      savedShards.push(shard);
      totalMergedRows += merged.length;
    }

    const allShards = Object.keys(shardStats).sort();
    const monthStats = aggregateMonthStats(shardStats);
    const allMonths = Object.keys(monthStats).sort();
    const trackedStats = Object.values(shardStats)
      .filter(x => x && typeof x === 'object');

    const trackedStarts = trackedStats.map(x => x.start).filter(Boolean).sort();
    const trackedEnds = trackedStats.map(x => x.end).filter(Boolean).sort();

    const historyStart = trackedStarts[0] || '';
    const historyEnd = trackedEnds.at(-1) || '';

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
      version: '7.1',
      architecture: 'CLOUDFLARE_D1_ISO_WEEK_SHARDS',
      storageGranularity: 'iso-week-v1',
      receivedAt: now,
      updatedAt: now,
      historyStart,
      historyEnd,
      historyRows,
      historyActiveDays,
      historyCalendarDays,
      months: allMonths,
      monthStats,
      shards: allShards,
      shardStats,
      hcRecords: hasHC
        ? payload.hc.length
        : Number(previousMeta?.hcRecords || 0),
      incomingMisscanRecords: misscan.length
    };

    await writeJson(META_PATH, meta);

    return json({
      ok: true,
      stored: true,
      version: '7.1',
      hcRecords: meta.hcRecords,
      receivedMisscanRecords: receivedMisscan.length,
      incomingMisscanRecords: misscan.length,
      ignoredMisscanRecords: receivedMisscan.length - misscan.length,
      misscanRecords: misscan.length,
      monthsUpdated: [...new Set(savedShards.flatMap(shard => Object.keys(shardStats[shard]?.months || {})))].sort(),
      shardsUpdated: savedShards,
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
    console.error('MISSCAN_SYNC_V71_ERROR', error);
    return json({
      ok: false,
      error: error?.message || 'Falha ao sincronizar histórico V7.1.'
    }, error?.status || 500);
  }
}
