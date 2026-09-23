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
    version: '7.2',
    method: 'POST',
    message: 'Prepara o histórico diário antes do backfill completo da LM, preservando os blocos semanais como contingência.'
  });
}

export async function POST(request) {
  try {
    assertSyncToken(request);

    let body = {};
    try { body = await request.json(); } catch {}

    const previous = await readJson(META_PATH, { months: [], shards: [], days: [] });
    const months = Array.isArray(previous?.months) ? previous.months : [];
    const shards = Array.isArray(previous?.shards) ? previous.shards : [];
    const legacyShards = previous?.storageGranularity === 'iso-week-v1'
      ? shards
      : (previous?.legacyShards || []);
    const legacyShardStats = previous?.storageGranularity === 'iso-week-v1'
      ? (previous?.shardStats || {})
      : (previous?.legacyShardStats || {});
    const days = Array.isArray(previous?.days) ? previous.days : [];
    const now = new Date().toISOString();
    const legacyStats = Object.values(legacyShardStats).filter(Boolean);
    const legacyStarts = legacyStats.map(x => x?.start).filter(Boolean).sort();
    const legacyEnds = legacyStats.map(x => x?.end).filter(Boolean).sort();

    const oldPaths = [
      ...months
        .filter(month => /^\d{4}-\d{2}$/.test(month))
        .map(month => `misscan/history/${month}.json`),
      ...days
        .filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day))
        .map(day => `misscan/history-days/${day}.json`)
    ];
    if (oldPaths.length) await deleteJson(oldPaths);

    const meta = {
      version: '7.2',
      architecture: legacyShards.length
        ? 'CLOUDFLARE_D1_HYBRID_DAY_WEEK_SHARDS'
        : 'CLOUDFLARE_D1_DAY_SHARDS',
      storageGranularity: legacyShards.length ? 'hybrid-day-week-v1' : 'day-v1',
      receivedAt: now,
      updatedAt: now,
      historyStart: legacyStarts[0] || '',
      historyEnd: legacyEnds.at(-1) || '',
      historyRows: legacyShards.length ? Number(previous?.historyRows || 0) : 0,
      historyActiveDays: legacyShards.length ? Number(previous?.historyActiveDays || 0) : 0,
      historyCalendarDays: legacyShards.length ? Number(previous?.historyCalendarDays || 0) : 0,
      months: [],
      monthStats: {},
      days: [],
      dayStats: {},
      legacyShards,
      legacyShardStats,
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
      preservedLegacyShards: legacyShards.length,
      clearedDays: days.length,
      startedAt: meta.backfill.startedAt
    });

  } catch (error) {
    console.error('HISTORY_RESET_V72_ERROR', error);
    return json({
      ok: false,
      error: error?.message || 'Falha ao reiniciar histórico.'
    }, error?.status || 500);
  }
}
