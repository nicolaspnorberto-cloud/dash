import { del } from '@vercel/blob';
import {
  assertSyncToken,
  json,
  readJson,
  writeJson,
  rowDateKey,
  monthKeyFromDateKey
} from '../lib/blob-store.mjs';

const META_PATH = 'misscan/history-meta.json';
const STAGE_ROOT = 'misscan/snapshot-stage';

function validDateKey(value = '') {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

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

function identityKey(r, index = 0) {
  const shipment = String(r?.shipment_id || '').trim();
  const date = rowDateKey(r) || 'NO_DATE';

  return shipment
    ? `${date}|${shipment}`
    : `${date}|ROW_${index}`;
}

function dedupeRows(rows = []) {
  const map = new Map();

  rows.forEach((r, index) => {
    const key = identityKey(r, index);
    const score = rowScore(r);

    const dt =
      Date.parse(
        String(r?.lmreceived_date || '').replace(' ', 'T')
      ) || 0;

    const current = map.get(key);

    if (
      !current ||
      score > current.__score ||
      (score === current.__score && dt > current.__dt)
    ) {
      map.set(key, {
        ...r,
        __score: score,
        __dt: dt
      });
    }
  });

  return [...map.values()]
    .map(({ __score, __dt, ...r }) => r)
    .sort((a, b) =>
      String(a?.lmreceived_date || '').localeCompare(
        String(b?.lmreceived_date || '')
      )
    );
}

function statsForRows(rows = []) {
  const dates = [];
  const dateSet = new Set();

  for (const row of rows) {
    const key = rowDateKey(row);
    if (!key) continue;

    dates.push(key);
    dateSet.add(key);
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

  if (
    !Number.isFinite(a.getTime()) ||
    !Number.isFinite(b.getTime())
  ) {
    return 0;
  }

  return (
    Math.floor(
      (b.getTime() - a.getTime()) / 86400000
    ) + 1
  );
}

function stagePath(batchId, index) {
  return `${STAGE_ROOT}/${batchId}/${String(index).padStart(4, '0')}.json`;
}

async function cleanupStage(batchId, totalChunks) {
  const paths = [];

  for (let i = 1; i <= totalChunks; i++) {
    paths.push(stagePath(batchId, i));
  }

  if (!paths.length) return;

  try {
    await del(paths);
  } catch (error) {
    console.warn(
      'SNAPSHOT_STAGE_CLEANUP',
      error?.message || error
    );
  }
}

export async function GET() {
  return json({
    ok: true,
    route: '/api/snapshot-sync',
    version: '6.10',
    mode: 'transactional-staging'
  });
}

export async function POST(request) {
  try {
    assertSyncToken(request);

    const payload = await request.json();

    const mode = String(
      payload?.mode || 'chunk'
    ).toLowerCase();

    const batchId = String(
      payload?.batchId || ''
    ).trim();

    if (
      !batchId ||
      !/^[a-zA-Z0-9_-]{6,120}$/.test(batchId)
    ) {
      return json({
        ok: false,
        error: 'batchId inválido.'
      }, 400);
    }

    if (mode === 'chunk') {
      const index = Number(payload?.index || 0);

      const totalChunks = Number(
        payload?.totalChunks || 0
      );

      const rows = Array.isArray(payload?.rows)
        ? payload.rows
        : null;

      if (
        !Number.isInteger(index) ||
        index < 1 ||
        !Number.isInteger(totalChunks) ||
        totalChunks < 1 ||
        index > totalChunks ||
        !rows
      ) {
        return json({
          ok: false,
          error: 'Chunk inválido.'
        }, 400);
      }

      if (rows.length > 1200) {
        return json({
          ok: false,
          error: 'Chunk acima do limite de 1200 registros.'
        }, 413);
      }

      await writeJson(
        stagePath(batchId, index),
        {
          batchId,
          index,
          totalChunks,
          rows,
          receivedAt: new Date().toISOString()
        }
      );

      return json({
        ok: true,
        staged: true,
        batchId,
        index,
        totalChunks,
        rows: rows.length
      });
    }

    if (mode !== 'commit') {
      return json({
        ok: false,
        error: 'mode deve ser chunk ou commit.'
      }, 400);
    }

    const totalChunks = Number(
      payload?.totalChunks || 0
    );

    const expectedRows = Number(
      payload?.expectedRows || 0
    );

    const replaceDates = [
      ...new Set(
        (
          Array.isArray(payload?.replaceDates)
            ? payload.replaceDates
            : []
        )
          .map(String)
          .filter(validDateKey)
      )
    ].sort();

    if (
      !Number.isInteger(totalChunks) ||
      totalChunks < 1 ||
      !replaceDates.length
    ) {
      return json({
        ok: false,
        error:
          'Commit inválido: totalChunks e replaceDates são obrigatórios.'
      }, 400);
    }

    const stagedRows = [];
    const missingChunks = [];

    for (let i = 1; i <= totalChunks; i++) {
      const stage = await readJson(
        stagePath(batchId, i),
        null
      );

      if (
        !stage ||
        Number(stage.index || 0) !== i
      ) {
        missingChunks.push(i);
        continue;
      }

      stagedRows.push(
        ...(Array.isArray(stage.rows)
          ? stage.rows
          : [])
      );
    }

    if (missingChunks.length) {
      return json({
        ok: false,
        error: 'Commit bloqueado: faltam chunks.',
        missingChunks,
        stagedRows: stagedRows.length
      }, 409);
    }

    const snapshotRows = dedupeRows(
      stagedRows
    );

    if (
      Number.isFinite(expectedRows) &&
      expectedRows >= 0 &&
      snapshotRows.length !== expectedRows
    ) {
      return json({
        ok: false,
        error:
          'Commit bloqueado: total recebido diverge do total validado no Apps Script.',
        expectedRows,
        stagedRows: stagedRows.length,
        dedupedRows: snapshotRows.length
      }, 409);
    }

    const allowedDates = new Set(
      replaceDates
    );

    const invalidRows = snapshotRows.filter(
      row => !allowedDates.has(rowDateKey(row))
    );

    if (invalidRows.length) {
      return json({
        ok: false,
        error:
          'Commit bloqueado: existem registros fora das datas solicitadas.',
        invalidRows: invalidRows.length
      }, 409);
    }

    const incomingByMonth = new Map();

    for (const row of snapshotRows) {
      const dateKey = rowDateKey(row);

      const month = monthKeyFromDateKey(
        dateKey
      );

      if (!month) continue;

      if (!incomingByMonth.has(month)) {
        incomingByMonth.set(month, []);
      }

      incomingByMonth
        .get(month)
        .push(row);
    }

    const affectedMonths = [
      ...new Set(
        replaceDates
          .map(monthKeyFromDateKey)
          .filter(Boolean)
      )
    ].sort();

    const previousMeta = await readJson(
      META_PATH,
      {
        version: '6.10',
        months: [],
        monthStats: {}
      }
    );

    const monthStats = {
      ...(previousMeta?.monthStats || {})
    };

    const now = new Date().toISOString();

    const committedByDate = {};

    for (const month of affectedMonths) {
      const path =
        `misscan/history/${month}.json`;

      const existing = await readJson(
        path,
        { rows: [] }
      );

      const base = (
        Array.isArray(existing?.rows)
          ? existing.rows
          : []
      ).filter(
        row =>
          !allowedDates.has(
            rowDateKey(row)
          )
      );

      const incoming =
        incomingByMonth.get(month) || [];

      const merged = dedupeRows([
        ...base,
        ...incoming
      ]);

      const stats = statsForRows(
        merged
      );

      await writeJson(
        path,
        {
          month,
          rows: merged,
          updatedAt: now,
          stats,
          lastSnapshotBatchId: batchId
        }
      );

      monthStats[month] = stats;
    }

    for (const row of snapshotRows) {
      const key = rowDateKey(row);

      committedByDate[key] =
        (committedByDate[key] || 0) + 1;
    }

    const allMonths = [
      ...new Set([
        ...(
          Array.isArray(
            previousMeta?.months
          )
            ? previousMeta.months
            : []
        ),
        ...Object.keys(monthStats),
        ...affectedMonths
      ])
    ].sort();

    const trackedStats =
      Object.values(monthStats)
        .filter(
          x =>
            x &&
            typeof x === 'object'
        );

    const starts =
      trackedStats
        .map(x => x.start)
        .filter(Boolean)
        .sort();

    const ends =
      trackedStats
        .map(x => x.end)
        .filter(Boolean)
        .sort();

    const historyStart =
      starts[0] || '';

    const historyEnd =
      ends.at(-1) || '';

    const historyRows =
      trackedStats.reduce(
        (sum, x) =>
          sum + Number(x.rows || 0),
        0
      );

    const historyActiveDays =
      trackedStats.reduce(
        (sum, x) =>
          sum + Number(x.activeDays || 0),
        0
      );

    const meta = {
      ...previousMeta,
      ...(payload?.meta || {}),

      version: '6.10',

      architecture:
        'TRANSACTIONAL_EXACT_DATE_SNAPSHOT',

      receivedAt: now,
      updatedAt: now,

      historyStart,
      historyEnd,
      historyRows,
      historyActiveDays,

      historyCalendarDays:
        daysInclusive(
          historyStart,
          historyEnd
        ),

      months: allMonths,
      monthStats,

      lastSnapshot: {
        batchId,
        replaceDates,
        expectedRows,

        stagedRows:
          stagedRows.length,

        committedRows:
          snapshotRows.length,

        byDate:
          committedByDate,

        committedAt: now
      }
    };

    await writeJson(
      META_PATH,
      meta
    );

    await cleanupStage(
      batchId,
      totalChunks
    );

    return json({
      ok: true,
      committed: true,
      version: '6.10',
      batchId,
      replaceDates,
      totalChunks,

      stagedRows:
        stagedRows.length,

      committedRows:
        snapshotRows.length,

      expectedRows,

      byDate:
        committedByDate,

      historyRows,
      receivedAt: now
    });

  } catch (error) {
    console.error(
      'SNAPSHOT_SYNC_V610_ERROR',
      error
    );

    return json({
      ok: false,
      error:
        error?.message ||
        'Falha no snapshot transacional.'
    }, error?.status || 500);
  }
}
