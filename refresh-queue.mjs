import {
  assertSyncToken,
  json,
  readJson,
  writeJson
} from '../lib/blob-store.mjs';

const QUEUE_PATH = 'misscan/refresh-queue.json';
const MAX_ITEMS = 80;

function clean(items = []) {
  return items
    .sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    )
    .slice(-MAX_ITEMS);
}

export async function GET(request) {
  try {
    assertSyncToken(request);

    const queue = await readJson(
      QUEUE_PATH,
      { items: [] }
    );

    const items = clean(
      Array.isArray(queue?.items)
        ? queue.items
        : []
    );

    const item = items.find(
      x =>
        String(x.status || '').toUpperCase() === 'PENDING'
    ) || null;

    return json({
      ok: true,
      count: item ? 1 : 0,
      item
    });

  } catch (error) {
    return json({
      ok: false,
      error:
        error?.message ||
        'Falha ao ler fila de atualização.'
    }, error?.status || 500);
  }
}

export async function PATCH(request) {
  try {
    assertSyncToken(request);

    const body = await request.json();
    const id = String(body?.id || '').trim();
    const patch =
      body?.patch &&
      typeof body.patch === 'object'
        ? body.patch
        : {};

    if (!id) {
      return json({
        ok: false,
        error: 'id obrigatório.'
      }, 400);
    }

    const queue = await readJson(
      QUEUE_PATH,
      { items: [] }
    );

    let found = false;

    const items = clean(
      (
        Array.isArray(queue?.items)
          ? queue.items
          : []
      ).map(item => {
        if (String(item.id || '') !== id) {
          return item;
        }

        found = true;

        return {
          ...item,
          ...patch,
          id: item.id,
          updatedAt: new Date().toISOString()
        };
      })
    );

    if (!found) {
      return json({
        ok: false,
        error: 'Pedido não encontrado.'
      }, 404);
    }

    await writeJson(QUEUE_PATH, {
      updatedAt: new Date().toISOString(),
      items
    });

    return json({
      ok: true,
      updated: true,
      request:
        items.find(
          x => String(x.id || '') === id
        ) || null
    });

  } catch (error) {
    return json({
      ok: false,
      error:
        error?.message ||
        'Falha ao atualizar fila.'
    }, error?.status || 500);
  }
}
