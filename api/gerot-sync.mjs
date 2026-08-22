import { assertSyncToken, json, writeJson } from '../lib/blob-store.mjs';

const PATH = 'misscan/gerot.json';
const TARGET = 0.88;

function cleanProcessed(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const date = String(row?.date || '');
    const turno = String(row?.turno || '').toUpperCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^T[1-5]$/.test(turno)) continue;
    const key = `${date}|${turno}`;
    map.set(key, {
      date,
      turno,
      week: String(row?.week || ''),
      socPacked: Math.max(0, Number(row?.socPacked || 0)),
      lastUpdate: String(row?.lastUpdate || '')
    });
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.turno.localeCompare(b.turno));
}

function cleanForecast(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const date = String(row?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    map.set(date, {
      date,
      week: String(row?.week || ''),
      destination: String(row?.destination || 'SOC-MG4'),
      originType: String(row?.originType || 'INTER-SOC'),
      total: Math.max(0, Number(row?.total || 0)),
      direct: Math.max(0, Number(row?.direct || 0)),
      transhipment: Math.max(0, Number(row?.transhipment || 0))
    });
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function bounds(rows = []) {
  const dates = rows.map(r => r.date).filter(Boolean).sort();
  return { start: dates[0] || '', end: dates.at(-1) || '' };
}

export async function GET() {
  return json({
    ok: true,
    route: '/api/gerot-sync',
    version: '6.5.3',
    method: 'POST',
    targetMisscan: TARGET
  });
}

export async function POST(request) {
  try {
    assertSyncToken(request);
    const payload = await request.json();
    if (!Array.isArray(payload?.processed) || !Array.isArray(payload?.forecast)) {
      return json({ ok: false, error: 'Payload inválido: processed e forecast precisam ser arrays.' }, 400);
    }

    const processed = cleanProcessed(payload.processed);
    const forecast = cleanForecast(payload.forecast);
    const processedBounds = bounds(processed);
    const forecastBounds = bounds(forecast);
    const now = new Date().toISOString();

    const stored = {
      ok: true,
      version: '6.5.3',
      targetMisscan: TARGET,
      processed,
      forecast,
      meta: {
        ...(payload.meta || {}),
        source: 'GEROT - MG4',
        processedSource: 'db_volume_overall • Inter-SOC • SOC_Packed',
        forecastSource: 'db_volume_forecast • INTER-SOC • Total (F)',
        processedStart: processedBounds.start,
        processedEnd: processedBounds.end,
        forecastStart: forecastBounds.start,
        forecastEnd: forecastBounds.end,
        processedRows: processed.length,
        forecastRows: forecast.length,
        receivedAt: now
      }
    };

    await writeJson(PATH, stored);

    return json({
      ok: true,
      stored: true,
      version: '6.5.3',
      processedRows: processed.length,
      forecastRows: forecast.length,
      processedStart: processedBounds.start,
      processedEnd: processedBounds.end,
      forecastStart: forecastBounds.start,
      forecastEnd: forecastBounds.end,
      receivedAt: now
    });
  } catch (error) {
    console.error('GEROT_SYNC_V65_ERROR', error);
    return json({ ok: false, error: error?.message || 'Falha ao sincronizar GEROT.' }, error?.status || 500);
  }
}
