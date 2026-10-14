import { configureRuntimeEnv, json, writeJson } from '../lib/blob-store.mjs';
import * as officialSync from '../api/official-sync.mjs';
import * as dados from '../api/dados.mjs';
import * as taxas from '../api/taxas.mjs';
import * as calendarizacao from '../api/calendarizacao.mjs';
import * as evolucao from '../api/evolucao.mjs';
import * as reciclagens from '../api/reciclagens.mjs';
import * as trainingSync from '../api/training-sync.mjs';
import * as presenceSync from '../api/presence-sync.mjs';
import * as trainingFiles from '../api/training-files.mjs';
import * as refreshSource from '../api/refresh-source.mjs';
import * as notificar from '../api/notificar.mjs';
import * as emailQueue from '../api/email-queue.mjs';
import * as refreshQueue from '../api/refresh-queue.mjs';
import * as tratativas from '../api/tratativas.mjs';
import * as tratativasEvidencia from '../api/tratativas-evidencia.mjs';
import * as seatalk from '../api/seatalk.mjs';
import * as operations from '../api/operations.mjs';
import { sendDailyDialogueReminder } from '../lib/seatalk-reminders.mjs';

const direct = new Map([
  ['official-sync', officialSync],
  ['dados', dados],
  ['taxas', taxas],
  ['calendarizacao', calendarizacao],
  ['evolucao', evolucao],
  ['reciclagens', reciclagens],
  ['training-sync', trainingSync],
  ['presence-sync', presenceSync],
  ['training-files', trainingFiles],
  ['refresh-source', refreshSource],
  ['notificar', notificar],
  ['email-queue', emailQueue],
  ['refresh-queue', refreshQueue],
  ['tratativas', tratativas],
  ['tratativas-evidencia', tratativasEvidencia],
  ['seatalk', seatalk]
]);

const operationNames = new Set([
  'operations',
  'calendar-sync',
  'dialogues-sync',
  'gerot-sync',
  'history-reset',
  'ping',
  'producao-sync',
  'snapshot-sync',
  'sync'
]);

async function routeApi(request, executionCtx) {
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
  return handler(request, executionCtx);
}

export default {
  async fetch(request, env, executionCtx) {
    configureRuntimeEnv(env, request);
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await routeApi(request, executionCtx);
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);

      // O dashboard é aberto por vários computadores e alguns navegadores
      // mantinham o HTML/JavaScript antigo por horas. Revalidar os arquivos da
      // aplicação garante que todos recebam a mesma versão após um deploy.
      if (url.pathname === '/' || url.pathname.endsWith('.html')) {
        response.headers.set('cache-control', 'no-store, max-age=0, must-revalidate');
      } else if (/\.(?:js|css)$/i.test(url.pathname)) {
        response.headers.set('cache-control', 'no-cache, max-age=0, must-revalidate');
      }

      return response;
    } catch (error) {
      console.error('WORKER_REQUEST_ERROR', error);
      return json({
        ok: false,
        error: error?.message || 'Falha interna no dashboard.'
      }, Number(error?.status || 500));
    }
  },

  async scheduled(_event, env, executionCtx) {
    configureRuntimeEnv(env, new Request('https://dash.nicolas-pnorberto.workers.dev/'));
    const turn=String(_event.cron||'').startsWith('30 ')?'T3':'T2';
    await (async()=>{
      const attemptedAt=new Date().toISOString();
      const attemptPath=`misscan/seatalk-last-attempt-${turn.toLowerCase()}.json`;
      const historyPath=`misscan/seatalk-attempts/${turn.toLowerCase()}/${attemptedAt.replace(/[:.]/g,'-')}.json`;
      const recordPhase=async phase=>{
        console.log('SEATALK_SCHEDULE_PHASE',JSON.stringify({turn,cron:_event.cron,attemptedAt,phase}));
        const checkpoint={attemptedAt,cron:_event.cron,turn,phase,finishedAt:null,sent:false};
        await writeJson(attemptPath,checkpoint);
        await writeJson(historyPath,checkpoint);
      };
      let result;
      try{
        await recordPhase('started');
        result=await sendDailyDialogueReminder({turn,onPhase:recordPhase});
      }
      catch(error){
        console.error('SEATALK_DAILY_DIALOGUE_REMINDER_ERROR',error);
        result={ok:false,reason:'execution-failed',error:String(error.message||'Falha na execução').slice(0,240)};
      }
      const finalRecord={
        phase:result.sent===true?'sent':result.skipped===true?'skipped':'failed',
        attemptedAt,finishedAt:new Date().toISOString(),cron:_event.cron,turn,
        ok:result.ok===true,sent:result.sent===true,skipped:result.skipped===true,
        reason:result.reason||'',error:result.error||'',pending:result.pending??null,
        deferred:result.deferred??null,closingReport:result.closingReport===true
      };
      await writeJson(attemptPath,finalRecord);
      await writeJson(historyPath,finalRecord);
    })().catch(error=>{console.error('SEATALK_ATTEMPT_RECORD_ERROR',error);throw error;});
  }
};
