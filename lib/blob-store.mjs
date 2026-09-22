import { createReadCache } from './read-cache.mjs';

// Cloudflare runtime bindings are injected by worker/index.mjs on every request.
// D1 is the preferred persistent store. KV remains supported as an optional
// compatibility path, while the checked-in JSON files provide a read-only
// bootstrap during the migration.
const readCache = createReadCache();
const cacheable = /^misscan\/(?:hc|history-meta|gerot|producao-real|calendarizacao|live)\.json$|^misscan\/history\/\d{4}-\d{2}\.json$/;
let version = 0;
let runtimeEnv = {};
let runtimeOrigin = 'https://local.invalid';
let tableReady = null;
let seedPromise = null;

export function configureRuntimeEnv(env = {}, request = null) {
  runtimeEnv = env || {};
  if (request?.url) runtimeOrigin = new URL(request.url).origin;
}

export function envValue(name) {
  return String(runtimeEnv?.[name] || '').trim();
}

export function currentReadVersion() { return version; }
export function invalidateReadCache() { readCache.clear(); version++; }
export function withReadContext(_options, run) { return run(); }

function clone(value) {
  return value == null ? value : structuredClone(value);
}

async function ensureTable() {
  const db = runtimeEnv?.MISSCAN_DB;
  if (!db) return null;
  if (!tableReady) {
    tableReady = db.prepare(`
      CREATE TABLE IF NOT EXISTS misscan_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `).run().catch(error => {
      tableReady = null;
      throw error;
    });
  }
  await tableReady;
  return db;
}

async function assetJson(pathname) {
  const assets = runtimeEnv?.ASSETS;
  if (!assets) return null;
  const url = new URL(`/${String(pathname).replace(/^\/+/, '')}`, runtimeOrigin);
  const response = await assets.fetch(new Request(url, { headers: { accept: 'application/json' } }));
  if (!response.ok) return null;
  return response.json();
}

function seedStats(rows = []) {
  const dates = rows.map(rowDateKey).filter(Boolean).sort();
  return {
    rows: rows.length,
    activeDays: new Set(dates).size,
    start: dates[0] || '',
    end: dates.at(-1) || ''
  };
}

async function loadSeed() {
  if (!seedPromise) {
    seedPromise = (async () => {
      const [hc, misscan, production] = await Promise.all([
        assetJson('hc.json'),
        assetJson('misscan.json'),
        assetJson('historico_prod.json')
      ]);
      const hcRows = Array.isArray(hc) ? hc : [];
      const misscanRows = Array.isArray(misscan) ? misscan : [];
      const productionRows = Array.isArray(production) ? production : [];
      const byMonth = new Map();
      for (const row of misscanRows) {
        const month = monthKeyFromDateKey(rowDateKey(row));
        if (!month) continue;
        if (!byMonth.has(month)) byMonth.set(month, []);
        byMonth.get(month).push(row);
      }
      const monthStats = {};
      for (const [month, rows] of byMonth) monthStats[month] = seedStats(rows);
      const allStats = seedStats(misscanRows);
      const now = new Date().toISOString();
      return {
        hcRows,
        misscanRows,
        productionRows,
        byMonth,
        meta: {
          version: 'cloudflare-bootstrap-1',
          architecture: 'CLOUDFLARE_D1_WITH_STATIC_BOOTSTRAP',
          source: 'checked-in migration snapshot',
          receivedAt: now,
          updatedAt: now,
          historyStart: allStats.start,
          historyEnd: allStats.end,
          historyRows: allStats.rows,
          historyActiveDays: allStats.activeDays,
          historyCalendarDays: allStats.start && allStats.end
            ? Math.floor((Date.parse(`${allStats.end}T12:00:00Z`) - Date.parse(`${allStats.start}T12:00:00Z`)) / 86400000) + 1
            : 0,
          months: [...byMonth.keys()].sort(),
          monthStats,
          hcRecords: hcRows.length,
          bootstrap: true
        }
      };
    })().catch(error => {
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}

async function seedFallback(pathname) {
  const seed = await loadSeed();
  if (pathname === 'misscan/hc.json') {
    return { rows: seed.hcRows, source: 'hc.json', bootstrap: true };
  }
  if (pathname === 'misscan/history-meta.json') return seed.meta;
  if (pathname === 'misscan/live.json') {
    return { hc: seed.hcRows, misscan: seed.misscanRows, meta: seed.meta };
  }
  if (pathname === 'misscan/producao-real.json') {
    return { rows: seed.productionRows, meta: { source: 'historico_prod.json', bootstrap: true } };
  }
  const match = /^misscan\/history\/(\d{4}-\d{2})\.json$/.exec(pathname);
  if (match && seed.byMonth.has(match[1])) {
    const rows = seed.byMonth.get(match[1]);
    return { month: match[1], rows, stats: seedStats(rows), bootstrap: true };
  }
  return null;
}

async function loadJson(pathname) {
  const db = await ensureTable();
  if (db) {
    const row = await db.prepare('SELECT value FROM misscan_store WHERE key = ?1')
      .bind(pathname).first();
    if (row?.value) return { missing: false, data: JSON.parse(row.value) };
  }

  const kv = runtimeEnv?.MISSCAN_DATA;
  if (kv) {
    const value = await kv.get(pathname, 'json');
    if (value != null) return { missing: false, data: value };
  }

  const seed = await seedFallback(pathname);
  return seed == null ? { missing: true } : { missing: false, data: seed };
}

export async function readJson(pathname, fallback = null) {
  const value = cacheable.test(pathname)
    ? await readCache.read(pathname, () => loadJson(pathname))
    : await loadJson(pathname);
  return value.missing ? clone(fallback) : value.data;
}

export async function writeJson(pathname, data) {
  invalidateReadCache();
  const text = JSON.stringify(data);
  const now = new Date().toISOString();
  const db = await ensureTable();
  if (db) {
    await db.prepare(`
      INSERT INTO misscan_store (key, value, updated_at)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(pathname, text, now).run();
    invalidateReadCache();
    return { ok: true, key: pathname, storage: 'd1', updatedAt: now };
  }
  const kv = runtimeEnv?.MISSCAN_DATA;
  if (kv) {
    await kv.put(pathname, text);
    invalidateReadCache();
    return { ok: true, key: pathname, storage: 'kv', updatedAt: now };
  }
  const error = new Error('Armazenamento persistente não configurado. Vincule um banco D1 como MISSCAN_DB.');
  error.status = 503;
  throw error;
}

export async function deleteJson(pathnames) {
  const keys = (Array.isArray(pathnames) ? pathnames : [pathnames]).filter(Boolean);
  if (!keys.length) return;
  const db = await ensureTable();
  if (db) {
    await db.batch(keys.map(key => db.prepare('DELETE FROM misscan_store WHERE key = ?1').bind(key)));
  } else if (runtimeEnv?.MISSCAN_DATA) {
    await Promise.all(keys.map(key => runtimeEnv.MISSCAN_DATA.delete(key)));
  }
  invalidateReadCache();
}

export function sharedToken(request) {
  return String(request.headers.get('x-sync-token') || '').trim();
}

export function assertSyncToken(request) {
  const expected = envValue('EMAIL_WEBHOOK_TOKEN');
  const received = sharedToken(request);
  if (!expected) {
    const error = new Error('EMAIL_WEBHOOK_TOKEN não configurado no Cloudflare.');
    error.status = 500;
    throw error;
  }
  if (!received || received !== expected) {
    const error = new Error('Não autorizado.');
    error.status = 401;
    throw error;
  }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0'
    }
  });
}

export function normalizeName(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\[Ops\d+\]/gi, ' ')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isShopeeEmail(value = '') {
  return /^[^\s@]+@shopee\.com$/i.test(String(value || '').trim());
}

export function rowDateKey(row) {
  const raw = String(row?.lmreceived_date || '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export function monthKeyFromDateKey(dateKey) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))
    ? String(dateKey).slice(0, 7)
    : '';
}

export function monthsBetween(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return [];
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const out = [];
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m === 13) { m = 1; y++; }
    if (out.length > 120) break;
  }
  return out;
}
