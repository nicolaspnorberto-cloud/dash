import {
  assertSyncToken,
  json,
  readJson,
  writeJson
} from '../lib/blob-store.mjs';

const REQUEST_PATH = 'misscan/refresh-current.json';

export async function GET(request) {
  try {
    assertSyncToken(request);

    const current = await readJson(REQUEST_PATH, null);
    const isPending =
      current &&
      String(current.status || '').toUpperCase() === 'PENDING';

    return json({
      ok: true,
      count: isPending ? 1 : 0,
      item: isPending ? current : null,
      latest: current || null
    });

  } catch (error) {
    return json({
      ok: false,
      error: error?.message || 'Falha ao ler pedido de atualização.'
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

    const current = await readJson(REQUEST_PATH, null);

    if (!current || String(current.id || '') !== id) {
      return json({
        ok: false,
        error: 'Pedido não encontrado ou substituído por pedido mais novo.'
      }, 404);
    }

    const updated = {
      ...current,
      ...patch,
      id: current.id,
      updatedAt: new Date().toISOString()
    };

    await writeJson(REQUEST_PATH, updated);

    return json({
      ok: true,
      updated: true,
      request: updated
    });

  } catch (error) {
    return json({
      ok: false,
      error: error?.message || 'Falha ao atualizar pedido.'
    }, error?.status || 500);
  }
}
