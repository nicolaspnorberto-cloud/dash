import { json, readJson } from '../lib/blob-store.mjs';

export async function GET() {
  try {
    const data = await readJson('misscan/live.json', null);

    if (!data) {
      return json({
        ok: false,
        error: 'Ainda não existe sincronização. Execute sincronizarDados() no Apps Script V6.'
      }, 503);
    }

    const last = new Date(data?.meta?.receivedAt || data?.meta?.generatedAt || 0);
    const ageMinutes = Number.isFinite(last.getTime())
      ? Math.round((Date.now() - last.getTime()) / 60000)
      : null;

    return json({
      ...data,
      ok: true,
      meta: {
        ...(data.meta || {}),
        ageMinutes,
        stale: ageMinutes === null ? true : ageMinutes > 90
      }
    });
  } catch (error) {
    console.error('MISSCAN_DATA_READ_ERROR', error);
    return json({
      ok: false,
      error: error?.message || 'Falha ao ler a base sincronizada.'
    }, 500);
  }
}
