import { get, put } from '@vercel/blob';

export async function readJson(pathname, fallback = null) {
  const result = await get(pathname, { access: 'private' });
  if (!result || result.statusCode !== 200 || !result.stream) return fallback;

  const text = await new Response(result.stream).text();
  if (!text) return fallback;
  return JSON.parse(text);
}

export async function writeJson(pathname, data) {
  return put(pathname, JSON.stringify(data), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json; charset=utf-8',
    cacheControlMaxAge: 60
  });
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
