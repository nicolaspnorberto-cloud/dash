import { assertSyncToken, json, readJson, writeJson } from '../lib/blob-store.mjs';
import { PRESENCE_PATH, validatePresence } from '../lib/abs-presence.mjs';

export async function POST(request) {
  try {
    assertSyncToken(request);
    const text = await request.text();
    if (text.length > 3000000) return json({ ok: false, error: 'Presença acima do limite.' }, 413);
    const snapshot = validatePresence(JSON.parse(text));
    const previous = await readJson(PRESENCE_PATH, null);
    if (previous?.generatedAt && snapshot.generatedAt < previous.generatedAt) return json({ ok: false, error: 'Presença anterior à versão atual.' }, 409);
    snapshot.updatedAt = new Date().toISOString();
    await writeJson(PRESENCE_PATH, snapshot);
    return json({ ok: true, records: snapshot.rows.length, dateKey: snapshot.dateKey, updatedAt: snapshot.updatedAt });
  } catch (error) {
    return json({ ok: false, error: error.message }, error.status || 400);
  }
}
