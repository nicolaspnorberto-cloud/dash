import {
  assertSyncToken,
  deleteJson,
  json,
  readJson,
  writeJson
} from '../blob-store.mjs';

const META_PATH = 'misscan/history-meta.json';

export async function GET() {
  return json({
    ok: true,
    route: '/api/history-reset',
    version: '7.1',
    method: 'POST',
    message: 'Reinicia o histórico em blocos semanais antes do backfill completo da LM.'
  });
}

export async function POST(request) {
  try {
    assertSyncToken(request);

    let body = {};
    try { body = await request.json(); } catch {}

    const previous = await readJson(META_PATH, { months: [], shards: [] });
    const months = Array.isArray(previous?.months) ? previous.months : [];
    const shards = Array.isArray(previous?.shards) ? previous.shards : [];
    const now = new Date().toISOString();

    const oldPaths = [
      ...months
        .filter(month => /^\d{4}-\d{2}$/.test(month))
        .map(month => `misscan/history/${month}.json`),
      ...shards
        .filter(shard => /^\d{4}-\d{2}-\d{2}$/.test(shard))
        .map(shard => `misscan/history-shards/${shard}.json`)
    ];
    if (oldPaths.length) await deleteJson(oldPaths);

    const meta = {
      version: '7.1',
      architecture: 'CLOUDFLARE_D1_ISO_WEEK_SHARDS',
      storageGranularity: 'iso-week-v1',
      receivedAt: now,
      updatedAt: now,
      historyStart: '',
      historyEnd: '',
      historyRows: 0,
      historyActiveDays: 0,
      historyCalendarDays: 0,
      months: [],
      monthStats: {},
      shards: [],
      shardStats: {},
      backfill: {
        status: 'RUNNING',
        startedAt: body?.startedAt || now,
        sourceLastRow: Number(body?.sourceLastRow || 0),
        reason: String(body?.reason || 'FULL_REBUILD')
      }
    };

    await writeJson(META_PATH, meta);

    return json({
      ok: true,
      reset: true,
      clearedMonths: months.length,
      clearedShards: shards.length,
      startedAt: meta.backfill.startedAt
    });

  } catch (error) {
    console.error('HISTORY_RESET_V71_ERROR', error);
    return json({
      ok: false,
      error: error?.message || 'Falha ao reiniciar histórico.'
    }, error?.status || 500);
  }
}
