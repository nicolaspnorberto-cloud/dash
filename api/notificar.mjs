import {
  json,
  readJson,
  writeJson,
  normalizeName,
  isShopeeEmail
} from '../lib/blob-store.mjs';

const QUEUE_PATH = 'misscan/email-queue.json';

function trimQueue(items) {
  const limitDate = Date.now() - 14 * 24 * 60 * 60 * 1000;
  return (items || [])
    .filter(item => {
      const t = Date.parse(item.createdAt || item.updatedAt || 0);
      return !Number.isFinite(t) || t >= limitDate || item.status === 'PENDING';
    })
    .slice(-500);
}

export async function GET() {
  return json({
    ok: true,
    route: '/api/notificar',
    method: 'POST',
    message: 'Registra uma solicitação de e-mail na fila privada.'
  });
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const eventType = String(payload?.eventType || '').toUpperCase();
    const collaborator = String(payload?.collaborator || '').trim();
    const instructorEmail = String(payload?.instructorEmail || '').trim().toLowerCase();

    if (!['DIALOGO', 'RECICLAGEM'].includes(eventType)) {
      return json({ ok: false, error: 'Tipo de evento inválido.' }, 400);
    }
    if (!collaborator) {
      return json({ ok: false, error: 'Colaborador não informado.' }, 400);
    }
    if (!isShopeeEmail(instructorEmail)) {
      return json({
        ok: false,
        error: 'O e-mail do instrutor precisa ser @shopee.com.'
      }, 400);
    }

    // O líder é resolvido no servidor pela base HC sincronizada.
    const live = await readJson('misscan/live.json', null);
    if (!live) {
      return json({
        ok: false,
        error: 'Base automática ainda não sincronizada.'
      }, 503);
    }

    const norm = normalizeName(collaborator);
    const hc = (live.hc || []).find(x => normalizeName(x?.colaborador || x?.norm || '') === norm);
    const leaderEmail = String(hc?.lider_email || '').split(/\s*\/\s*/)[0].trim().toLowerCase();
    const leaderName = String(hc?.lider_nome || payload?.leaderName || 'Não cadastrado').split(/\s*\/\s*/)[0].trim();

    const recipients = [...new Set([
      isShopeeEmail(leaderEmail) ? leaderEmail : '',
      instructorEmail
    ].filter(Boolean))];

    if (!recipients.length) {
      return json({ ok: false, error: 'Nenhum destinatário corporativo válido.' }, 400);
    }

    const queue = await readJson(QUEUE_PATH, { items: [] });
    const items = trimQueue(queue?.items || []);
    const now = new Date();
    const oneHourAgo = now.getTime() - 60 * 60 * 1000;

    const recentCount = items.filter(x => {
      const t = Date.parse(x.createdAt || 0);
      return Number.isFinite(t) && t >= oneHourAgo;
    }).length;

    if (recentCount >= 50) {
      return json({
        ok: false,
        error: 'Limite de segurança da fila atingido. Tente novamente mais tarde.'
      }, 429);
    }

    const cycle = Number(payload?.cycle || 1);
    const signature = `${eventType}|${cycle}|${norm}|${instructorEmail}`;
    const duplicate = [...items].reverse().find(x => {
      const age = Date.now() - Date.parse(x.createdAt || 0);
      return x.signature === signature && age >= 0 && age < 2 * 60 * 1000;
    });

    if (duplicate) {
      return json({
        ok: true,
        queued: true,
        duplicate: true,
        queueId: duplicate.id,
        recipients: duplicate.recipients || recipients
      });
    }

    const item = {
      id: crypto.randomUUID(),
      signature,
      status: 'PENDING',
      attempts: 0,
      createdAt: now.toISOString(),
      eventType,
      cycle,
      collaborator,
      indicator: Number(payload?.indicator || 0),
      missScan: Number(payload?.missScan || 0),
      turno: String(payload?.turno || hc?.turno || ''),
      setor: String(payload?.setor || hc?.setor || ''),
      leaderName,
      leaderEmail: isShopeeEmail(leaderEmail) ? leaderEmail : '',
      instructorName: String(payload?.instructorName || ''),
      instructorEmail,
      recipients,
      details: payload?.details || {},
      occurredAt: payload?.occurredAt || now.toISOString()
    };

    items.push(item);
    await writeJson(QUEUE_PATH, {
      updatedAt: now.toISOString(),
      items: trimQueue(items)
    });

    return json({
      ok: true,
      queued: true,
      queueId: item.id,
      recipients,
      message: 'E-mail registrado na fila automática.'
    });
  } catch (error) {
    console.error('MISSCAN_EMAIL_QUEUE_ERROR', error);
    return json({
      ok: false,
      error: error?.message || 'Falha ao registrar o e-mail.'
    }, 500);
  }
}
