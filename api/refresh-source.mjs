import {
  json,
  readJson,
  writeJson
} from '../lib/blob-store.mjs';

const REQUEST_PATH = 'misscan/refresh-current.json';

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const requestId = String(url.searchParams.get('requestId') || '').trim();

    const current = await readJson(REQUEST_PATH, null);

    if (!requestId) {
      return json({
        ok: true,
        route: '/api/refresh-source',
        version: '6.9',
        mode: 'single-private-request',
        configured: Boolean(
          String(process.env.EMAIL_WEBHOOK_TOKEN || '').trim()
        ),
        appsScriptPublicWebAppRequired: false,
        current: current
          ? {
              id: current.id || '',
              status: current.status || '',
              createdAt: current.createdAt || '',
              updatedAt: current.updatedAt || ''
            }
          : null
      });
    }

    if (!current || String(current.id || '') !== requestId) {
      return json({
        ok: false,
        requestId,
        error: 'Pedido não encontrado ou já substituído por um pedido mais novo.'
      }, 404);
    }

    return json({
      ok: true,
      request: current
    });

  } catch (error) {
    return json({
      ok: false,
      error: error?.message || 'Falha ao consultar atualização.'
    }, 500);
  }
}

export async function POST(request) {
  try {
    let body = {};
    try {
      body = await request.json();
    } catch {}

    const action = ['all', 'lm', 'gerot'].includes(
      String(body?.action || 'all').toLowerCase()
    )
      ? String(body.action || 'all').toLowerCase()
      : 'all';

    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.from || ''))
      ? String(body.from)
      : '';

    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.to || ''))
      ? String(body.to)
      : '';

    const now = new Date().toISOString();

    // V6.9: TODO clique cria um pedido novo.
    // Não reutiliza PENDING/RUNNING antigo e não usa cooldown.
    const item = {
      id: uid(),
      action,
      from,
      to,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
      startedAt: '',
      finishedAt: '',
      result: null,
      error: '',
      source: 'dashboard-v6.9'
    };

    await writeJson(REQUEST_PATH, item);

    return json({
      ok: true,
      accepted: true,
      requestId: item.id,
      requestedAt: item.createdAt,
      status: item.status,
      mode: 'single-private-request'
    });

  } catch (error) {
    console.error('REFRESH_SOURCE_V69_ERROR', error);

    return json({
      ok: false,
      error: error?.message || 'Falha ao criar pedido de atualização.'
    }, 500);
  }
}
