import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import '../date-loader.js';

const loader = globalThis.MisscanDateLoader;
function appContext() {
  const elements = new Map();
  const context = vm.createContext({
    window: {}, MisscanDateLoader: loader, Intl, Map, Set, Date, Number, String, Math,
    AbortController, DOMException, setTimeout, clearTimeout, console,
    document: { getElementById: id => {
      if (!elements.has(id)) elements.set(id, { value: '', textContent: '', disabled: false, classList: { remove() {}, add() {} } });
      return elements.get(id);
    } },
    localStorage: { setItem() {}, getItem() { return null; } },
    alert: message => { throw new Error(`Unexpected alert: ${message}`); }
  });
  const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  vm.runInContext(source.replace(/boot\(\);\s*$/, ''), context);
  return { context, elements, run: code => vm.runInContext(code, context) };
}

test('nova seleção cancela a carga anterior e invalida sua resposta', () => {
  const latest = loader.createLatest();
  const first = latest.begin(), second = latest.begin();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.current(), false);
  assert.equal(second.current(), true);
  first.cancel();
  assert.equal(second.signal.aborted, false);
});

test('cache é reutilizado somente enquanto a revisão da fonte não muda', () => {
  const cache = loader.createCache();
  cache.useRevision('a'); cache.put('day', [{ shipment_id: 'TEST' }]);
  assert.equal(cache.get('day').length, 1);
  cache.useRevision('a'); assert.equal(cache.get('day').length, 1);
  cache.useRevision('b'); assert.equal(cache.get('day'), null);
});

test('cache tem limite e remove primeiro o bloco menos usado', () => {
  const cache = loader.createCache({ maxEntries: 2 });
  cache.put('a', []); cache.put('b', []); cache.get('a'); cache.put('c', []);
  assert.equal(cache.get('b'), null);
  assert.deepEqual(cache.get('a'), []);
});

test('requisição travada termina no timeout e não fica carregando indefinidamente', async () => {
  let calls = 0;
  const fetcher = (_, { signal }) => new Promise((resolve, reject) => {
    calls++;
    signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')));
  });
  await assert.rejects(loader.fetchJson('/', {}, 2, {
    fetcher, timeoutMs: 5, retryDelay: async () => {}
  }), /demorou demais/);
  assert.equal(calls, 2);
});

test('cancelamento pelo usuário não provoca novas tentativas', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(loader.fetchJson('/', { signal: controller.signal }, 2, {
    fetcher: async () => { calls++; }
  }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('erro 400 não é repetido; erro temporário pode recuperar', async () => {
  let calls = 0;
  await assert.rejects(loader.fetchJson('/', {}, 2, {
    fetcher: async () => { calls++; return Response.json({ ok: false }, { status: 400 }); }
  }), /400/);
  assert.equal(calls, 1);
  calls = 0;
  const result = await loader.fetchJson('/', {}, 2, {
    retryDelay: async () => {},
    fetcher: async () => ++calls === 1
      ? Response.json({ ok: false }, { status: 503 }) : Response.json({ ok: true })
  });
  assert.equal(result.data.ok, true); assert.equal(calls, 2);
});

test('planejamento não consulta datas fora do histórico ou dias vazios indexados', () => {
  const { run } = appContext();
  const chunks = run(`dataChunksV68({periodStart:'2026-01-01',periodEnd:'2026-10-22',
    historyStart:'2026-10-01',historyEnd:'2026-10-02',storageGranularity:'day-v1',
    days:['2026-10-02'],dayStats:{'2026-10-02':{rows:10}}})`);
  assert.equal(chunks.length, 1); assert.equal(chunks[0].from, '2026-10-02');
  assert.equal(run(`dataChunksV68({periodStart:'2026-10-03',periodEnd:'2026-10-03',
    historyStart:'2026-10-01',historyEnd:'2026-10-02'}).length`), 0);
});

test('período personalizado invertido é normalizado nos campos e na consulta', () => {
  const { run } = appContext();
  run(`$('datePreset').value='CUSTOM';$('dateFrom').value='2026-10-02';
    $('dateTo').value='2026-09-28';refreshLiveData=()=>{};applyPeriodFromControls();`);
  assert.equal(run('periodQuery()'), 'from=2026-09-28&to=2026-10-02');
  assert.equal(run("$('dateFrom').value"), '2026-09-28');
});

test('resposta antiga não sobrescreve período novo e loading termina na última carga', async () => {
  const { context, run } = appContext();
  const pending = [];
  context.fakeLoader = () => new Promise(resolve => pending.push(resolve));
  run(`loadLiveDataV68=fakeLoader;buildHCMap=()=>{};loadMisscanRows=()=>{};
    loadTreatmentRows=()=>{};liveTreatmentRows=()=>[];`);
  const first = run('refreshLiveData({silent:true})');
  const second = run('refreshLiveData({silent:true})');
  pending[1]({ hc: [], misscan: [], meta: { periodStart: '2026-10-02', periodEnd: '2026-10-02' } });
  assert.equal(await second, true);
  pending[0]({ hc: [], misscan: [], meta: { periodStart: '2026-09-01' } });
  assert.equal(await first, false);
  assert.equal(run('state.liveMeta.periodStart'), '2026-10-02');
  assert.equal(run('state.liveRefreshing'), false);
});

test('eventos dos filtros são instalados antes das consultas iniciais', () => {
  const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const boot = source.slice(source.indexOf('async function boot()'));
  assert.ok(boot.indexOf("$('applyPeriodBtn').addEventListener") < boot.indexOf('const [initialLive,initialCalendar]'));
});

test('editar datas durante loading preserva o rascunho e ignora a resposta anterior', async () => {
  const { context, run } = appContext();
  let resolve;
  context.fakeLoader = () => new Promise(done => { resolve = done; });
  run('loadLiveDataV68=fakeLoader;');
  const pending = run('refreshLiveData({silent:true})');
  run("$('dateFrom').value='2026-09-28';cancelLivePeriodEdit();");
  resolve({ hc: [], misscan: [], meta: { periodStart: '2026-10-02' } });
  assert.equal(await pending, false);
  assert.equal(run("$('dateFrom').value"), '2026-09-28');
  assert.equal(run('state.liveRefreshing'), false);
});

test('reabrir período reutiliza blocos; atualização explícita ignora cache e chega a todos os blocos', async () => {
  const { context, run } = appContext();
  let blockCalls = 0;
  const urls = [];
  context.fakeFetch = async url => {
    urls.push(url);
    if (url.includes('meta_only=1')) return { data: { hc: [], meta: {
      periodStart: '2026-10-01', periodEnd: '2026-10-01',
      historyStart: '2026-10-01', historyEnd: '2026-10-01',
      updatedAt: 'revision-a', storageGranularity: 'day-v1',
      days: ['2026-10-01'], dayStats: { '2026-10-01': { rows: 1 } }
    } } };
    blockCalls++;
    return { data: { misscan: [{ shipment_id: 'TEST_A', lmreceived_date: '2026-10-01' }] } };
  };
  run('fetchJsonResilientV68=fakeFetch;');
  const first = await run('loadLiveDataV68()');
  const second = await run('loadLiveDataV68()');
  assert.equal(first.misscan.length, 1);
  assert.equal(second.misscan.length, 1);
  assert.equal(blockCalls, 1);
  await run('loadLiveDataV68({fresh:true})');
  assert.equal(blockCalls, 2);
  assert.ok(urls.at(-1).includes('fresh=1'));
});
