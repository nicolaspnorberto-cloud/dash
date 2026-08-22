import { json } from '../lib/blob-store.mjs';

export async function GET() {
  return json({
    ok: true,
    route: '/api/refresh-source',
    version: '6.6',
    configured: Boolean(
      String(process.env.APPS_SCRIPT_REFRESH_URL || '').trim() &&
      String(process.env.EMAIL_WEBHOOK_TOKEN || '').trim()
    )
  });
}

export async function POST(request) {
  try {
    const appsScriptUrl = String(
      process.env.APPS_SCRIPT_REFRESH_URL || ''
    ).trim();
    const token = String(
      process.env.EMAIL_WEBHOOK_TOKEN || ''
    ).trim();

    if (!appsScriptUrl) {
      return json({
        ok: false,
        error: 'APPS_SCRIPT_REFRESH_URL não configurado na Vercel.'
      }, 500);
    }

    if (!token) {
      return json({
        ok: false,
        error: 'EMAIL_WEBHOOK_TOKEN não configurado na Vercel.'
      }, 500);
    }

    let body = {};
    try {
      body = await request.json();
    } catch {}

    const action = ['all', 'lm', 'gerot'].includes(
      String(body?.action || 'all').toLowerCase()
    )
      ? String(body.action || 'all').toLowerCase()
      : 'all';

    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'accept': 'application/json'
      },
      body: JSON.stringify({
        token,
        action,
        source: 'dash-b52u'
      })
    });

    const text = await response.text();

    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}

    if (!response.ok) {
      return json({
        ok: false,
        error: `Apps Script Web App retornou HTTP ${response.status}.`,
        preview: text.slice(0, 300)
      }, 502);
    }

    if (!data) {
      const looksLikeLogin = /<!doctype|<html|login|accounts\.google/i.test(text);
      return json({
        ok: false,
        error: looksLikeLogin
          ? 'O Web App do Apps Script não está acessível anonimamente pela Vercel. Revise a implantação.'
          : 'Resposta inesperada do Apps Script.',
        preview: text.slice(0, 300)
      }, 502);
    }

    if (!data.ok) {
      return json({
        ok: false,
        error: data.error || 'Apps Script recusou a atualização.'
      }, 502);
    }

    return json({
      ok: true,
      accepted: true,
      version: '6.6',
      requestId: data.requestId || '',
      requestedAt: data.requestedAt || new Date().toISOString(),
      alreadyRunning: Boolean(data.alreadyRunning),
      status: data.status || 'REQUESTED',
      action
    });

  } catch (error) {
    console.error('REFRESH_SOURCE_V66_ERROR', error);
    return json({
      ok: false,
      error: error?.message || 'Falha ao solicitar atualização real.'
    }, 500);
  }
}
