import { readJson, writeJson } from './blob-store.mjs';

const REGISTRY_PATH = 'misscan/dialogues-realized.json';
const MAX_DAYS = 120;

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function normalizeOpsId(value = '') {
  const text = String(value || '').trim().toUpperCase();
  const match = text.match(/OPS\s*:?\s*(\d+)/i) || text.match(/^\s*(\d+)\s*$/);
  return match ? `OPS${match[1]}` : '';
}

export function normalizeDialogueDate(value = '') {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

export function normalizeDialogueRecord(value = {}) {
  const dateKey = normalizeDialogueDate(value.dateKey || value.date || value.Data);
  const opsid = normalizeOpsId(
    value.opsid || value.collaboratorId || value['E-mail Colaborador']
  );
  const operation = String(value.operation || value.Operacao || value['Operação'] || '').trim();
  const dialogueType = String(value.dialogueType || value['Tipo de Diálogo'] || '').trim();
  const reason = String(value.reason || value.Motivo || '').trim();
  const normalizedReason = normalizeText(reason).replace(/[^A-Z0-9]+/g, ' ');
  const qualifies =
    normalizeText(operation) === 'SOC-MG4' &&
    normalizeText(dialogueType) === 'DESENVOLVIMENTO' &&
    /\bMISS\s*SCAN\b/.test(normalizedReason);

  if (!dateKey || !opsid || !qualifies) return null;
  const idNC = String(value.idNC || value.id || '').trim().slice(0, 120);
  const manager = String(value.manager || value['Nome Gestor'] || '').trim().slice(0, 180);
  return {
    id: idNC || `${dateKey}|${opsid}|${manager}|${normalizeText(reason).slice(0, 80)}`,
    dateKey,
    opsid,
    operation: 'SOC-MG4',
    manager,
    dialogueType: 'Desenvolvimento',
    reason: reason.slice(0, 500),
    recurrent: String(value.recurrent || value['Este diálogo é reincidente?'] || '').trim(),
    hasSignature: Boolean(value.hasSignature)
  };
}

export async function readDialogueRegistry() {
  const value = await readJson(REGISTRY_PATH, { version: 1, byDate: {} });
  return {
    version: 1,
    updatedAt: String(value?.updatedAt || ''),
    byDate: value?.byDate && typeof value.byDate === 'object' ? value.byDate : {}
  };
}

export async function mergeDialogueRecords(records = [], { replaceDates = [] } = {}) {
  const normalized = (records || []).map(normalizeDialogueRecord).filter(Boolean);
  const registry = await readDialogueRegistry();
  const byDate = { ...registry.byDate };
  const touched = new Map();

  for (const value of replaceDates || []) {
    const dateKey = normalizeDialogueDate(value);
    if (dateKey) touched.set(dateKey, new Map());
  }

  for (const item of normalized) {
    if (!touched.has(item.dateKey)) touched.set(item.dateKey, new Map());
    touched.get(item.dateKey).set(item.id, item);
  }

  for (const [dateKey, items] of touched) {
    // A sincronização de uma data é um snapshot completo daquela data. Assim,
    // correções ou exclusões feitas na planilha também chegam ao dashboard.
    byDate[dateKey] = [...items.values()];
  }

  const keepDates = Object.keys(byDate).sort().slice(-MAX_DAYS);
  const compact = Object.fromEntries(keepDates.map(dateKey => [dateKey, byDate[dateKey]]));
  const updatedAt = new Date().toISOString();
  await writeJson(REGISTRY_PATH, { version: 1, updatedAt, byDate: compact });
  return {
    updatedAt,
    imported: normalized.length,
    dates: [...touched.keys()].sort(),
    completedOpsIds: [...new Set(normalized.map(item => item.opsid))].sort()
  };
}

export async function completedOpsIdsForDate(dateKey) {
  const registry = await readDialogueRegistry();
  return [...new Set(
    (registry.byDate?.[dateKey] || []).map(item => normalizeOpsId(item?.opsid)).filter(Boolean)
  )];
}

export async function dialogueCompletionsByOpsId(throughDate = '9999-12-31') {
  const registry = await readDialogueRegistry();
  const result = {};
  for (const dateKey of Object.keys(registry.byDate || {}).sort()) {
    if (dateKey > throughDate) continue;
    for (const item of registry.byDate[dateKey] || []) {
      const opsid = normalizeOpsId(item?.opsid);
      if (!opsid) continue;
      if (!result[opsid]) result[opsid] = [];
      if (!result[opsid].includes(dateKey)) result[opsid].push(dateKey);
    }
  }
  return result;
}
