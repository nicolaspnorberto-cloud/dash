import {
  assertSyncToken,
  json,
  readJson,
  writeJson
} from '../lib/blob-store.mjs';

const QUEUE_PATH = 'misscan/email-queue.json';

export async function GET(request) {
  try {
    assertSyncToken(request);

    const queue = await readJson(QUEUE_PATH, { items: [] });
    const pending = (queue?.items || [])
      .filter(x => x.status === 'PENDING')
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .slice(0, 25);

    return json({
      ok: true,
      count: pending.length,
      items: pending
    });
  } catch (error) {
    return json({
      ok: false,
      error: error?.message || 'Falha ao ler a fila.'
    }, error?.status || 500);
  }
}

export async function PATCH(request) {
  try {
    assertSyncToken(request);

    const body = await request.json();
    const results = Array.isArray(body?.results) ? body.results : [];

    if (!results.length) {
      return json({ ok: true, updated: 0 });
    }

    const queue = await readJson(QUEUE_PATH, { items: [] });
    const byId = new Map(results.map(x => [String(x.id || ''), x]));
    let updated = 0;

    const items = (queue?.items || []).map(item => {
      const result = byId.get(String(item.id || ''));
      if (!result) return item;

      updated++;
      return {
        ...item,
        status: result.status === 'SENT' ? 'SENT' : 'ERROR',
        attempts: Number(item.attempts || 0) + 1,
        sentAt: result.status === 'SENT' ? (result.sentAt || new Date().toISOString()) : item.sentAt,
        updatedAt: new Date().toISOString(),
        error: result.status === 'SENT' ? '' : String(result.error || 'Falha não especificada')
      };
    });

    await writeJson(QUEUE_PATH, {
      updatedAt: new Date().toISOString(),
      items
    });

    return json({ ok: true, updated });
  } catch (error) {
    return json({
      ok: false,
      error: error?.message || 'Falha ao atualizar a fila.'
    }, error?.status || 500);
  }
}
