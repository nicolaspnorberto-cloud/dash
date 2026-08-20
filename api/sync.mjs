import { assertSyncToken, json, writeJson } from '../lib/blob-store.mjs';

export async function GET() {
  return json({
    ok: true,
    route: '/api/sync',
    method: 'POST',
    message: 'Endpoint de sincronização do Apps Script.'
  });
}

export async function POST(request) {
  try {
    assertSyncToken(request);

    const payload = await request.json();

    if (!payload || !Array.isArray(payload.hc) || !Array.isArray(payload.misscan)) {
      return json({
        ok: false,
        error: 'Payload inválido: hc e misscan precisam ser arrays.'
      }, 400);
    }

    // Proteção simples contra payload acidentalmente gigantesco.
    if (payload.hc.length > 30000 || payload.misscan.length > 100000) {
      return json({
        ok: false,
        error: 'Payload acima do limite operacional esperado.'
      }, 413);
    }

    const stored = {
      ok: true,
      hc: payload.hc,
      misscan: payload.misscan,
      meta: {
        ...(payload.meta || {}),
        receivedAt: new Date().toISOString(),
        architecture: 'PUSH_PRIVADO_V6'
      }
    };

    await writeJson('misscan/live.json', stored);

    return json({
      ok: true,
      stored: true,
      hcRecords: stored.hc.length,
      misscanRecords: stored.misscan.length,
      receivedAt: stored.meta.receivedAt
    });
  } catch (error) {
    console.error('MISSCAN_SYNC_ERROR', error);
    return json({
      ok: false,
      error: error?.message || 'Falha ao sincronizar.'
    }, error?.status || 500);
  }
}
