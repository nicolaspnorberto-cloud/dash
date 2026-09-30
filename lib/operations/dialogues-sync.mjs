import { assertSyncToken, json } from '../blob-store.mjs';
import { mergeDialogueRecords, readDialogueRegistry } from '../dialogues-realized.mjs';

export async function GET() {
  const registry = await readDialogueRegistry();
  const dates = Object.keys(registry.byDate || {}).sort();
  const latestDate = dates.at(-1) || '';
  return json({
    ok: true,
    updatedAt: registry.updatedAt,
    latestDate,
    latestCount: latestDate ? (registry.byDate[latestDate] || []).length : 0
  });
}

export async function POST(request) {
  assertSyncToken(request);
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.records)) {
    return json({ ok: false, error: 'records deve ser uma lista.' }, 400);
  }
  if (body.records.length > 5000) {
    return json({ ok: false, error: 'Limite de 5.000 diálogos por sincronização.' }, 413);
  }
  return json({
    ok: true,
    ...(await mergeDialogueRecords(body.records, { replaceDates: [body.dateKey] }))
  });
}
