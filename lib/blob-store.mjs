import { get, put } from '@vercel/blob';
import { createReadCache } from './read-cache.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';

const readCache=createReadCache();
const requestContext=new AsyncLocalStorage();
const cacheable=/^misscan\/(?:hc|history-meta|gerot|producao-real|calendarizacao)\.json$|^misscan\/history\/\d{4}-\d{2}\.json$/;
let version=0;
export function currentReadVersion(){return version;}
export function invalidateReadCache(){readCache.clear();version++;}
export function withReadContext(options,run){return requestContext.run(options,run);}

async function loadJson(pathname,fresh=false){
  const result = await get(pathname, { access: 'private', ...(fresh?{useCache:false}:{}) });
  if(!result || result.statusCode===404)return {missing:true};
  if(result.statusCode!==200 || !result.stream){
    const error=new Error('Falha ao ler a base privada.');error.status=503;throw error;
  }
  const text = await new Response(result.stream).text();
  if(!text)return {missing:true};
  return {missing:false,data:JSON.parse(text)};
}

export async function readJson(pathname, fallback = null) {
  const fresh=requestContext.getStore()?.fresh===true;
  const value=!fresh&&cacheable.test(pathname)
    ? await readCache.read(pathname,()=>loadJson(pathname))
    : await loadJson(pathname,fresh);
  return value.missing?structuredClone(fallback):value.data;
}

export async function writeJson(pathname, data) {
  invalidateReadCache();
  try{return await put(pathname, JSON.stringify(data), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json; charset=utf-8',
    cacheControlMaxAge: 60
  });}finally{invalidateReadCache();}
}

export function sharedToken(request) {
  return String(request.headers.get('x-sync-token') || '').trim();
}

export function assertSyncToken(request) {
  const expected = String(process.env.EMAIL_WEBHOOK_TOKEN || '').trim();
  const received = sharedToken(request);

  if (!expected) {
    const error = new Error('EMAIL_WEBHOOK_TOKEN não configurado na Vercel.');
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
