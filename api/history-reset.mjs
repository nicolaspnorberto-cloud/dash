import {
  assertSyncToken,
  json,
  readJson,
  writeJson
} from '../lib/blob-store.mjs';

const META_PATH = 'misscan/history-meta.json';

export async function GET() {
  return json({
    ok: true,
    route: '/api/history-reset',
    version: '6.4',
    method: 'POST',
    message: 'Reinicia o índice mensal antes do backfill completo da LM.'
  });
}

export async function POST(request) {
  try {
    assertSyncToken(request);

    let body = {};
    try { body = await request.json(); } catch {}

    const previous = await readJson(META_PATH, { months: [] });
    const months = Array.isArray(previous?.months) ? previous.months : [];
    const now = new Date().toISOString();

    // Em vez de deletar objetos, esvazia os meses conhecidos.
    // Isso evita resíduos da versão anterior sem depender de operação de delete.
    for (const month of months) {
      if (!/^\d{4}-\d{2}$/.test(month)) continue;
      await writeJson(`misscan/history/${month}.json`, {
        month,
        rows: [],
        updatedAt: now,
        resetAt: now
      });
    }

    const meta = {
      version: '6.4',
      architecture: 'PUSH_PRIVADO_V6_4_DYNAMIC_LM_HISTORY',
      receivedAt: now,
      updatedAt: now,
      historyStart: '',
      historyEnd: '',
      historyRows: 0,
      historyActiveDays: 0,
      historyCalendarDays: 0,
      months: [],
      monthStats: {},
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
      startedAt: meta.backfill.startedAt
    });

  } catch (error) {
    console.error('HISTORY_RESET_V64_ERROR', error);
    return json({
      ok: false,
      error: error?.message || 'Falha ao reiniciar histórico.'
    }, error?.status || 500);
  }
}
