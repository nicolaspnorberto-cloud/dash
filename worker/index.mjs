import { configureRuntimeEnv, json } from '../lib/blob-store.mjs';
import * as dados from '../api/dados.mjs';
import * as taxas from '../api/taxas.mjs';
import * as calendarizacao from '../api/calendarizacao.mjs';
import * as evolucao from '../api/evolucao.mjs';
import * as refreshSource from '../api/refresh-source.mjs';
import * as notificar from '../api/notificar.mjs';
import * as emailQueue from '../api/email-queue.mjs';
import * as refreshQueue from '../api/refresh-queue.mjs';
import * as operations from '../api/operations.mjs';

const direct = new Map([
  ['dados', dados],
  ['taxas', taxas],
  ['calendarizacao', calendarizacao],
  ['evolucao', evolucao],
  ['refresh-source', refreshSource],
  ['notificar', notificar],
  ['email-queue', emailQueue],
  ['refresh-queue', refreshQueue]
]);

const operationNames = new Set([
  'operations',
  'calendar-sync',
  'gerot-sync',
  'history-reset',
  'ping',
  'producao-sync',
  'snapshot-sync',
  'sync'
]);

async function routeApi(request) {
  const url = new URL(request.url);
  const match = /^\/api\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) return json({ ok: false, error: 'Rota de API não encontrada.' }, 404);

  const name = match[1];
  const module = operationNames.has(name) ? operations : direct.get(name);
  if (!module) return json({ ok: false, error: 'Rota de API não encontrada.' }, 404);

  const method = request.method.toUpperCase();
  const handler = module[method];
  if (typeof handler !== 'function') {
    const response = json({ ok: false, error: 'Método não permitido.' }, 405);
    response.headers.set('Allow', Object.keys(module).filter(key => /^[A-Z]+$/.test(key)).join(', '));
    return response;
  }
  return handler(request);
}

export default {
  async fetch(request, env) {
    configureRuntimeEnv(env, request);
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await routeApi(request);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error('WORKER_REQUEST_ERROR', error);
      return json({
        ok: false,
        error: error?.message || 'Falha interna no dashboard.'
      }, Number(error?.status || 500));
    }
  }
};
