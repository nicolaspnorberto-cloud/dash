import { envValue, json, runtimeBinding } from '../lib/blob-store.mjs';

let schemaReady = null;

function db() {
  const value = runtimeBinding('MISSCAN_DB');
  if (!value) {
    const error = new Error('Banco compartilhado MISSCAN_DB não configurado.');
    error.status = 503;
    throw error;
  }
  return value;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = db().prepare(`
      CREATE TABLE IF NOT EXISTS misscan_treatment_state (
        scope TEXT NOT NULL,
        id TEXT NOT NULL,
        payload TEXT NOT NULL,
        client_updated_at TEXT NOT NULL,
        server_updated_at TEXT NOT NULL,
        PRIMARY KEY (scope, id)
      )
    `).run().catch(error => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

function assertWritePin(request) {
  const expected = envValue('TREATMENT_WRITE_PIN');
  if (!expected) {
    const error = new Error('Defina o segredo TREATMENT_WRITE_PIN no Cloudflare para liberar gravações compartilhadas.');
    error.status = 503;
    throw error;
  }
  const received = String(request.headers.get('x-treatment-pin') || '').trim();
  if (!received || received !== expected) {
    const error = new Error('PIN de gravação inválido.');
    error.status = 401;
    throw error;
  }
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function recordTimestamp(value) {
  const candidates = [value?.updatedAt, value?.lastSeen, value?.completedAt];
  for (const item of value?.history || []) candidates.push(item?.at);
  for (let cycle = 1; cycle <= 3; cycle++) {
    candidates.push(value?.[`dialogue${cycle}`]?.updatedAt);
    candidates.push(value?.[`recycle${cycle}`]?.updatedAt);
    candidates.push(value?.[`recycle${cycle}`]?.completedAt);
  }
  return candidates.filter(Boolean).sort().at(-1) || new Date(0).toISOString();
}

async function readAll() {
  const result = await db().prepare(`
    SELECT scope, id, payload, client_updated_at, server_updated_at
    FROM misscan_treatment_state
    WHERE scope IN ('progress', 'archive')
  `).all();
  const progress = {};
  const archive = {};
  let updatedAt = '';
  for (const row of result.results || []) {
    try {
      const payload = JSON.parse(row.payload || '{}');
      if (row.scope === 'progress') progress[row.id] = payload;
      if (row.scope === 'archive') archive[row.id] = payload;
      if (String(row.server_updated_at || '') > updatedAt) updatedAt = row.server_updated_at;
    } catch {}
  }
  return { progress, archive, updatedAt };
}

async function upsertScope(scope, records) {
  const entries = Object.entries(safeObject(records)).slice(0, 2500);
  if (!entries.length) return 0;
  const now = new Date().toISOString();
  let saved = 0;
  for (let offset = 0; offset < entries.length; offset += 75) {
    const statements = entries.slice(offset, offset + 75).map(([rawId, rawPayload]) => {
      const id = String(rawId || '').trim().slice(0, 240);
      const payload = safeObject(rawPayload);
      const clientUpdatedAt = recordTimestamp(payload);
      if (!id || JSON.stringify(payload).length > 300_000) return null;
      return db().prepare(`
        INSERT INTO misscan_treatment_state
          (scope, id, payload, client_updated_at, server_updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(scope, id) DO UPDATE SET
          payload = excluded.payload,
          client_updated_at = excluded.client_updated_at,
          server_updated_at = excluded.server_updated_at
        WHERE excluded.client_updated_at >= misscan_treatment_state.client_updated_at
      `).bind(scope, id, JSON.stringify(payload), clientUpdatedAt, now);
    }).filter(Boolean);
    if (statements.length) {
      await db().batch(statements);
      saved += statements.length;
    }
  }
  return saved;
}

export async function GET() {
  await ensureSchema();
  const data = await readAll();
  return json({ ok: true, shared: true, ...data });
}

export async function POST(request) {
  assertWritePin(request);
  await ensureSchema();
  const body = await request.json().catch(() => ({}));
  if (!['merge', 'save'].includes(body.action)) {
    return json({ ok: false, error: 'Ação inválida.' }, 400);
  }
  const progress = safeObject(body.progress);
  const archive = safeObject(body.archive);
  const serializedSize = JSON.stringify({ progress, archive }).length;
  if (serializedSize > 8_000_000) {
    return json({ ok: false, error: 'Histórico acima do limite de sincronização.' }, 413);
  }
  const savedProgress = await upsertScope('progress', progress);
  const savedArchive = await upsertScope('archive', archive);
  return json({
    ok: true,
    shared: true,
    saved: savedProgress + savedArchive,
    updatedAt: new Date().toISOString()
  });
}
