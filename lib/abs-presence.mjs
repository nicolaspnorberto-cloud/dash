import { normalizeOpsId } from './dialogues-realized.mjs';

export const PRESENCE_SOURCE = Object.freeze({
  spreadsheetId: '1ltU2eLkym-ERSNyzvFsK0EyvKZT5kKUiHcY6PNiOxR8',
  sheetId: 1890690219,
  sheet: 'ABS'
});
export const PRESENCE_PATH = 'misscan/abs-presence.json';
export const PRESENCE_MAX_AGE_MS = 60 * 60 * 1000;
// Siglas conferidas na aba Apoio. ON descreve presença no onboarding;
// S2 descreve sinergia recebida. As demais não confirmam presença no MG4.
const PRESENT = new Set(['P', 'S2', 'ON']);
const ABSENT = new Set(['AF','AL','AM','BH','DF','DP','DSR','DV','F','FE','FJ','FO','NC','S1','TR','SU','ONF']);
const statusCode = value => String(value || '').trim().toUpperCase();

export function saoPauloPresenceDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}

export function validatePresence(body, now = new Date()) {
  for (const [key, value] of Object.entries(PRESENCE_SOURCE)) {
    if (body.source?.[key] !== value) throw new Error('Fonte de presença ABS divergente.');
  }
  if (body.dateKey !== saoPauloPresenceDate(now)) throw new Error('Presença deve corresponder ao dia atual em São Paulo.');
  const generated = Date.parse(body.generatedAt);
  if (!Number.isFinite(generated) || generated > now.getTime() + 5 * 60 * 1000 || now.getTime() - generated > PRESENCE_MAX_AGE_MS) {
    throw new Error('Sincronização de presença desatualizada ou inválida.');
  }
  if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 10000) throw new Error('Lista de presença inválida.');
  const seen = new Set();
  const rows = body.rows.map(row => {
    const opsid = normalizeOpsId(row.opsid);
    if (!/^OPS\d+$/.test(opsid) || seen.has(opsid)) throw new Error('OPSID inválido ou duplicado na presença ABS.');
    seen.add(opsid);
    const status = statusCode(row.status);
    if (status.length > 32 || typeof row.disabled !== 'boolean') throw new Error('Status de presença inválido.');
    return { opsid, status, disabled: row.disabled };
  });
  return { source: PRESENCE_SOURCE, dateKey: body.dateKey, generatedAt: new Date(generated).toISOString(), rows };
}

export function selectPresentTreatments(rows, snapshot, { dateKey = saoPauloPresenceDate(), now = new Date() } = {}) {
  const generated = Date.parse(snapshot?.generatedAt);
  const sourceMatches = Object.entries(PRESENCE_SOURCE).every(([key, value]) => snapshot?.source?.[key] === value);
  if (!sourceMatches || snapshot?.dateKey !== dateKey || !Array.isArray(snapshot?.rows) || !snapshot.rows.length ||
      !Number.isFinite(generated) || generated > now.getTime() + 5 * 60 * 1000 || now.getTime() - generated > PRESENCE_MAX_AGE_MS) {
    return { available: false, reason: 'presence-unavailable-or-stale', eligible: [], deferred: rows.filter(r => !r.done).map(r => ({ ...r, presenceReason: 'not-confirmed' })) };
  }
  const byOpsId = new Map();
  for (const item of snapshot.rows) {
    const id = normalizeOpsId(item.opsid);
    // Ambiguidade nunca autoriza cobrança.
    byOpsId.set(id, byOpsId.has(id) ? null : item);
  }
  const eligible = [], deferred = [];
  for (const row of rows) {
    if (row.done) { eligible.push(row); continue; }
    const person = byOpsId.get(normalizeOpsId(row.opsid));
    const status = statusCode(person?.status);
    if (person && person.disabled === false && PRESENT.has(status)) eligible.push(row);
    else deferred.push({ ...row, presenceReason: person?.disabled || ABSENT.has(status) ? 'absent' : 'not-confirmed' });
  }
  return { available: true, eligible, deferred };
}
