import { envValue } from './blob-store.mjs';

const BASE_URL = 'https://openapi.seatalk.io';
const REQUEST_TIMEOUT_MS = 8_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const GROUP_CACHE_MS = 6 * 60 * 60 * 1000;

let tokenCache = null;
let groupCache = null;

function credentials() {
  return {
    appId: envValue('SEATALK_APP_ID'),
    appSecret: envValue('SEATALK_APP_SECRET')
  };
}

export function seatalkConfigured() {
  const { appId, appSecret } = credentials();
  return Boolean(appId && appSecret);
}

async function fetchJson(path, options = {}, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(options.headers || {})
      },
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    const requestId = response.headers.get('x-rid') || '';
    if (!response.ok) {
      const error = new Error(`SeaTalk respondeu HTTP ${response.status}${requestId ? ` (x-rid: ${requestId})` : ''}.`);
      error.status = response.status;
      throw error;
    }
    if (Number(data?.code || 0) !== 0) {
      throw new Error(`SeaTalk recusou a solicitação: código ${data.code}${data.message ? ` — ${data.message}` : ''}.`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function expiryTimestamp(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return Date.now() + 60 * 60 * 1000;
  // SeaTalk normally returns an absolute Unix timestamp. Supporting a relative
  // lifetime as well keeps the client compatible with older tenants.
  return parsed > 10_000_000_000
    ? parsed
    : parsed > 1_000_000_000
      ? parsed * 1000
      : Date.now() + parsed * 1000;
}

async function accessToken(fetchImpl = fetch) {
  const { appId, appSecret } = credentials();
  if (!appId || !appSecret) {
    throw new Error('Integração SeaTalk não configurada no Cloudflare.');
  }

  const key = `${appId}\u0000${appSecret}`;
  if (tokenCache?.key === key && tokenCache.expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS) {
    return tokenCache.value;
  }

  const data = await fetchJson('/auth/app_access_token', {
    method: 'POST',
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  }, fetchImpl);
  const value = String(data?.app_access_token || '').trim();
  if (!value) throw new Error('SeaTalk não retornou o token de acesso.');
  tokenCache = { key, value, expiresAt: expiryTimestamp(data?.expire) };
  return value;
}

async function apiRequest(path, options = {}, fetchImpl = fetch) {
  const token = await accessToken(fetchImpl);
  return fetchJson(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  }, fetchImpl);
}

function groupName(value) {
  return String(
    value?.group_name || value?.name || value?.chat_name || value?.title || ''
  ).trim();
}

export function collectGroups(value, output = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return output;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectGroups(item, output, seen);
    return output;
  }

  const groupId = String(value.group_id || value.groupId || '').trim();
  if (groupId) {
    output.push({ id: groupId, name: groupName(value), raw: value });
  }
  for (const nested of Object.values(value)) collectGroups(nested, output, seen);
  return output;
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function joinedGroupIds(data) {
  const raw = data?.joined_group_chats?.group_id;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(value => String(value || '').trim()).filter(Boolean))];
}

export async function listJoinedSeatalkGroups(fetchImpl = fetch) {
  const data = await apiRequest('/messaging/v2/group_chat/joined?page_size=100', {
    method: 'GET'
  }, fetchImpl);
  const groups = collectGroups(data);
  const ids = joinedGroupIds(data);
  for (const id of ids) {
    try {
      const info = await apiRequest(
        `/messaging/v2/group_chat/info?group_id=${encodeURIComponent(id)}`,
        { method: 'GET' },
        fetchImpl
      );
      const name = groupName(info) || groupName(info?.group) ||
        collectGroups(info).find(group => group.name)?.name || '';
      const existing = groups.find(group => group.id === id);
      if (existing) existing.name = name;
      else groups.push({ id, name, raw: info });
    } catch {}
  }
  return [...new Map(groups.map(group => [group.id, {
    id: group.id,
    name: group.name || ''
  }])).values()];
}

export async function resolveSeatalkGroup(fetchImpl = fetch) {
  const configuredId = envValue('SEATALK_GROUP_ID');
  const configuredName = envValue('SEATALK_GROUP_NAME') || 'TESTE BOT';
  if (configuredId) return { id: configuredId, name: configuredName, source: 'env' };

  const cacheKey = normalize(configuredName);
  if (groupCache?.key === cacheKey && groupCache.expiresAt > Date.now()) {
    return groupCache.value;
  }

  const data = await apiRequest('/messaging/v2/group_chat/joined?page_size=100', {
    method: 'GET'
  }, fetchImpl);
  const groups = collectGroups(data);
  const ids = joinedGroupIds(data);

  // The joined-groups endpoint currently returns the identifiers as a parallel
  // array, without names. Resolve each identifier through the group-info API
  // before matching the configured group name.
  if (!groups.some(group => group.name) && ids.length) {
    for (const id of ids) {
      try {
        const info = await apiRequest(
          `/messaging/v2/group_chat/info?group_id=${encodeURIComponent(id)}`,
          { method: 'GET' },
          fetchImpl
        );
        const detailed = collectGroups(info);
        const name = groupName(info) || groupName(info?.group) ||
          detailed.find(group => group.name)?.name || '';
        const existing = groups.find(group => group.id === id);
        if (existing) existing.name = name;
        else groups.push({ id, name, raw: info });
      } catch {
        // A tenant can allow joined-group listing while denying group details.
        // Group identity must still be confirmed before any message is sent.
      }
    }
  }

  const match = groups.find(group => normalize(group.name) === cacheKey);
  if (!match) {
    const available = [...new Set(groups.map(group => group.name).filter(Boolean))].slice(0, 10);
    throw new Error(
      `O bot não encontrou o grupo “${configuredName}”.` +
      (available.length ? ` Grupos disponíveis: ${available.join(', ')}.` : '')
    );
  }
  const value = {
    id: match.id,
    name: match.name || configuredName,
    source: match.source || 'joined-list'
  };
  groupCache = { key: cacheKey, value, expiresAt: Date.now() + GROUP_CACHE_MS };
  return value;
}

export async function sendSeatalkText(content, { fetchImpl = fetch } = {}) {
  if (!seatalkConfigured()) {
    return { ok: false, skipped: true, reason: 'not-configured' };
  }
  const text = String(content || '').trim();
  if (!text) throw new Error('Mensagem do SeaTalk vazia.');
  const group = await resolveSeatalkGroup(fetchImpl);
  const data = await apiRequest('/messaging/v2/group_chat', {
    method: 'POST',
    body: JSON.stringify({
      group_id: group.id,
      message: {
        tag: 'text',
        text: { content: text.slice(0, 8_000) }
      }
    })
  }, fetchImpl);
  return {
    ok: true,
    group: group.name,
    messageId: String(data?.message_id || '')
  };
}

function number(value, maximumFractionDigits = 2) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString('pt-BR', { maximumFractionDigits })
    : '0';
}

export function treatmentMessage(item = {}) {
  const dialogue = item.eventType === 'DIALOGO';
  const details = item.details || {};
  const lines = [
    '🐕 Fiscal de Misscan MG4',
    '',
    `✅ ${dialogue ? 'Diálogo de Performance' : 'Reciclagem'} registrado(a)`,
    `Colaborador: ${item.collaborator || 'Não informado'}`,
    `Ciclo: ${Number(item.cycle || 1)}`,
    `Indicador: ${number(item.indicator)}%`,
    `Miss Scan: ${number(item.missScan, 0)}`,
    `Turno: ${item.turno || 'Não cadastrado'}`,
    `Setor: ${item.setor || 'Não cadastrado'}`,
    `Líder: ${item.leaderName || 'Não cadastrado'}`,
    `Responsável: ${item.instructorName || 'Não informado'}`,
    `Data: ${details.date || String(item.occurredAt || '').slice(0, 10) || 'Não informada'}`
  ];
  if (!dialogue && details.topic) lines.push(`Tema: ${details.topic}`);
  return lines.join('\n');
}

export async function notifySeatalkTreatment(item, options = {}) {
  return sendSeatalkText(treatmentMessage(item), options);
}

export function resetSeatalkCachesForTests() {
  tokenCache = null;
  groupCache = null;
}
