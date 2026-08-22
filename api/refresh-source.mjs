import {
  json,
  readJson,
  writeJson
} from '../lib/blob-store.mjs';

const QUEUE_PATH = 'misscan/refresh-queue.json';
const MAX_ITEMS = 80;
const ACTIVE_TTL_MS = 8 * 60 * 1000;
const COOLDOWN_MS = 20 * 1000;

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clean(items = []) {
  return items
    .sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    )
    .slice(-MAX_ITEMS);
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const requestId = String(
      url.searchParams.get('requestId') || ''
    ).trim();

    if (!requestId) {
      return json({
        ok: true,
        route: '/api/refresh-source',
        version: '6.7',
        mode: 'private-queue',
        configured: Boolean(
          String(process.env.EMAIL_WEBHOOK_TOKEN || '').trim()
        ),
        appsScriptPublicWebAppRequired: false,
        pollInterval: '1 minute'
      });
    }

    const queue = await readJson(
      QUEUE_PATH,
      { items: [] }
    );

    const item = (queue?.items || []).find(
      x => String(x.id || '') === requestId
    );

    if (!item) {
      return json({
        ok: false,
        requestId,
        error: 'Pedido não encontrado.'
      }, 404);
    }

    return json({
      ok: true,
      request: item
    });

  } catch (error) {
    return json({
      ok: false,
      error: error?.message || 'Falha ao consultar pedido.'
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

    const now = new Date();
    const nowMs = now.getTime();

    const queue = await readJson(
      QUEUE_PATH,
      { items: [] }
    );

    let items = clean(
      Array.isArray(queue?.items)
        ? queue.items
        : []
    );

    const active = [...items].reverse().find(item => {
      const status = String(
        item.status || ''
      ).toUpperCase();

      const createdMs = Date.parse(
        item.createdAt || 0
      );

      return (
        ['PENDING', 'RUNNING'].includes(status) &&
        Number.isFinite(createdMs) &&
        nowMs - createdMs < ACTIVE_TTL_MS
      );
    });

    if (active) {
      return json({
        ok: true,
        accepted: true,
        alreadyRunning: true,
        requestId: active.id,
        requestedAt: active.createdAt,
        status: active.status,
        mode: 'private-queue'
      });
    }

    const latest = items.at(-1);
    const latestMs = Date.parse(
      latest?.createdAt || 0
    );

    if (
      latest &&
      Number.isFinite(latestMs) &&
      nowMs - latestMs < COOLDOWN_MS
    ) {
      return json({
        ok: true,
        accepted: true,
        alreadyRunning: true,
        requestId: latest.id,
        requestedAt: latest.createdAt,
        status: latest.status,
        mode: 'private-queue'
      });
    }

    const item = {
      id: uid(),
      action,
      status: 'PENDING',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      startedAt: '',
      finishedAt: '',
      result: null,
      error: '',
      source: 'dashboard'
    };

    items.push(item);
    items = items.slice(-MAX_ITEMS);

    await writeJson(QUEUE_PATH, {
      updatedAt: now.toISOString(),
      items
    });

    return json({
      ok: true,
      accepted: true,
      alreadyRunning: false,
      requestId: item.id,
      requestedAt: item.createdAt,
      status: item.status,
      mode: 'private-queue'
    });

  } catch (error) {
    console.error(
      'REFRESH_SOURCE_V67_ERROR',
      error
    );

    return json({
      ok: false,
      error: error?.message || 'Falha ao criar pedido.'
    }, 500);
  }
}
