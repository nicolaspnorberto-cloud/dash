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

function mergeRows(existingRows, incomingRows) {
  const map = new Map();

  [...(existingRows || []), ...(incomingRows || [])].forEach((r, index) => {
    const key = String(r?.shipment_id || '').trim() || `ROW_${index}`;
    const score = rowScore(r);
    const dt = Date.parse(String(r?.lmreceived_date || '').replace(' ', 'T')) || 0;
    const current = map.get(key);

    if (!current || score > current.__score || (score === current.__score && dt > current.__dt)) {
      map.set(key, { ...r, __score: score, __dt: dt });
    }
  });

  return [...map.values()]
    .map(({ __score, __dt, ...r }) => r)
    .sort((a, b) => String(a.lmreceived_date || '').localeCompare(String(b.lmreceived_date || '')));
}

function bounds(rows) {
  const dates = (rows || []).map(rowDateKey).filter(Boolean).sort();
  return { start: dates[0] || '', end: dates.at(-1) || '' };
}

export async function GET() {
  return json({
    ok: true,
    route: '/api/sync',
    version: '6.1',
    method: 'POST',
    message: 'Sincronização incremental do histórico mensal.'
  });
}

export async function POST(request) {
  try {
    assertSyncToken(request);
    const payload = await request.json();

    if (!payload || !Array.isArray(payload.hc) || !Array.isArray(payload.misscan)) {
      return json({ ok: false, error: 'Payload inválido: hc e misscan precisam ser arrays.' }, 400);
    }

    if (payload.hc.length > 30000 || payload.misscan.length > 100000) {
      return json({ ok: false, error: 'Payload acima do limite operacional esperado.' }, 413);
    }

    const now = new Date().toISOString();

    await writeJson(HC_PATH, {
      rows: payload.hc,
      updatedAt: now,
      source: payload?.meta?.hcSheet || 'Base de HC 26'
    });

    const groups = new Map();
    for (const row of payload.misscan) {
      const dateKey = rowDateKey(row);
      const month = monthKeyFromDateKey(dateKey);
      if (!month) continue;
      if (!groups.has(month)) groups.set(month, []);
      groups.get(month).push(row);
    }

    const savedMonths = [];
    let totalMergedRows = 0;

    for (const [month, rows] of groups.entries()) {
      const path = `misscan/history/${month}.json`;
      const existing = await readJson(path, { rows: [] });
      const merged = mergeRows(existing?.rows || [], rows);

      await writeJson(path, { month, rows: merged, updatedAt: now });
      savedMonths.push(month);
      totalMergedRows += merged.length;
    }

    const previousMeta = await readJson(META_PATH, {
      months: [],
      historyStart: '',
      historyEnd: ''
    });

    const allMonths = [...new Set([...(previousMeta?.months || []), ...savedMonths])].sort();
    const incomingBounds = bounds(payload.misscan);

    const historyStart = [previousMeta?.historyStart, incomingBounds.start]
      .filter(Boolean).sort()[0] || '';

    const historyEnd = [previousMeta?.historyEnd, incomingBounds.end]
      .filter(Boolean).sort().at(-1) || '';

    const meta = {
      ...(payload.meta || {}),
      architecture: 'PUSH_PRIVADO_V6_1_HISTORY',
      receivedAt: now,
      updatedAt: now,
      historyStart,
      historyEnd,
      months: allMonths,
      hcRecords: payload.hc.length,
      incomingMisscanRecords: payload.misscan.length
    };

    await writeJson(META_PATH, meta);

    return json({
      ok: true,
      stored: true,
      version: '6.1',
      hcRecords: payload.hc.length,
      incomingMisscanRecords: payload.misscan.length,
      misscanRecords: payload.misscan.length,
      monthsUpdated: savedMonths,
      mergedRowsAcrossUpdatedMonths: totalMergedRows,
      historyStart,
      historyEnd,
      receivedAt: now
    });
  } catch (error) {
    console.error('MISSCAN_SYNC_V61_ERROR', error);
    return json({
      ok: false,
      error: error?.message || 'Falha ao sincronizar histórico.'
    }, error?.status || 500);
  }
}
