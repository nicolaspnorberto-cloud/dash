// Seven existing endpoints share one deployment function. Their handlers,
// authentication and storage paths remain unchanged.
import * as calendar from '../lib/operations/calendar-sync.mjs';
import * as gerot from '../lib/operations/gerot-sync.mjs';
import * as history from '../lib/operations/history-reset.mjs';
import * as ping from '../lib/operations/ping.mjs';
import * as production from '../lib/operations/producao-sync.mjs';
import * as snapshot from '../lib/operations/snapshot-sync.mjs';
import * as sync from '../lib/operations/sync.mjs';
import { json } from '../lib/blob-store.mjs';

const routes = new Map([
  ['calendar-sync', calendar],
  ['gerot-sync', gerot],
  ['history-reset', history],
  ['ping', ping],
  ['producao-sync', production],
  ['snapshot-sync', snapshot],
  ['sync', sync]
]);

async function dispatch(request, method) {
  const url = new URL(request.url);
  // Some runtimes preserve the source URL, others expose the rewrite's URL.
  // Prefer an exact source path, so a user query cannot override its route.
  const source = /^\/api\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  const name = routes.has(source)
    ? source
    : url.pathname === '/api/operations'
      ? url.searchParams.get('__misscan_route')
      : null;
  const route = routes.get(name);
  if (!route) return json({ ok: false, error: 'Rota não encontrada.' }, 404);
  const handler = route[method];
  if (typeof handler !== 'function') {
    const response = json({ ok: false, error: 'Método não permitido.' }, 405);
    response.headers.set('Allow', Object.keys(route).filter(key => /^[A-Z]+$/.test(key)).join(', '));
    return response;
  }
  return handler(request);
}

export async function GET(request) { return dispatch(request, 'GET'); }
export async function POST(request) { return dispatch(request, 'POST'); }
