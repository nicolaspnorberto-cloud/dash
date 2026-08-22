import { json, readJson } from '../lib/blob-store.mjs';

const PATH = 'misscan/gerot.json';
const TARGET = 0.88;

function saoPauloDateKey() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(key, days) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function GET(request) {
  try {
    const data = await readJson(PATH, null);
    if (!data) {
      return json({ ok: false, error: 'GEROT ainda não sincronizada. Execute sincronizarGerotV65() no Apps Script.' }, 503);
    }

    const url = new URL(request.url);
    const days = Math.max(1, Math.min(60, Number(url.searchParams.get('days') || 21)));
    const today = saoPauloDateKey();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(url.searchParams.get('from') || ''))
      ? String(url.searchParams.get('from'))
      : today;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(url.searchParams.get('to') || ''))
      ? String(url.searchParams.get('to'))
      : addDays(from, days - 1);

    const rows = (data.forecast || [])
      .filter(r => r.date >= from && r.date <= to && Number(r.total || 0) > 0)
      .map(r => ({
        id: `GEROT_${r.date}`,
        source: 'GEROT',
        sourceLabel: 'GEROT • db_volume_forecast • INTER-SOC • Total',
        date: r.date,
        week: r.week || '',
        volume: Number(r.total || 0),
        originType: String(r.originType || 'INTER-SOC'),
        total: Number(r.total || 0),
        direct: Number(r.direct || 0),
        transhipment: Number(r.transhipment || 0)
      }));

    return json({
      ok: true,
      version: '6.6',
      targetMisscan: TARGET,
      rows,
      meta: {
        ...(data.meta || {}),
        periodStart: from,
        periodEnd: to,
        targetMisscan: TARGET,
        source: 'GEROT - MG4',
        sourceSheet: 'db_volume_forecast',
        sourceColumn: 'Total (F)',
        sourceOriginType: 'INTER-SOC',
        daysRequested: days
      }
    });
  } catch (error) {
    console.error('CALENDAR_V65_ERROR', error);
    return json({ ok: false, error: error?.message || 'Falha ao ler Calendarização V6.5.' }, 500);
  }
}
