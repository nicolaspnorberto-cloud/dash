/**
 * MIS-SCAN CONTROL CENTER V5
 * Backend unificado:
 * - GET  -> HC + Misscan automáticos
 * - POST -> notificação por e-mail das tratativas
 *
 * SCRIPT PROPERTIES:
 * WEBHOOK_TOKEN   = mesmo valor de EMAIL_WEBHOOK_TOKEN na Vercel
 * SPREADSHEET_ID  = opcional. Se vazio, usa o ID padrão abaixo.
 * EMAIL_LOG_SPREADSHEET_ID = opcional. Se vazio, tenta usar SPREADSHEET_ID.
 */

const DEFAULT_SPREADSHEET_ID = '1fwe4cFmYxLgdUmTqtDa6l9lF8WKmpIXE0MCtsWlA4rA';
const HC_SHEET = 'Base de HC 26';
const MISSCAN_SHEET = 'LM';

function doGet(e) {
  try {
    validarToken_(e);

    const action = String((e.parameter && e.parameter.action) || 'health').toLowerCase();

    if (action === 'health') {
      return json_({
        ok: true,
        service: 'misscan-v5-backend',
        generatedAt: new Date().toISOString()
      });
    }

    if (action !== 'data') {
      throw new Error('Ação inválida.');
    }

    const days = Math.max(1, Math.min(90, Number(e.parameter.days || 35)));
    const ss = SpreadsheetApp.openById(spreadsheetId_());

    const hc = lerHC_(ss);
    const misscanResult = lerMisscanRecente_(ss, days);

    return json_({
      ok: true,
      hc: hc,
      misscan: misscanResult.rows,
      meta: {
        generatedAt: new Date().toISOString(),
        spreadsheetId: spreadsheetId_(),
        hcSheet: HC_SHEET,
        misscanSheet: MISSCAN_SHEET,
        hcRecords: hc.length,
        misscanRecords: misscanResult.rows.length,
        misscanSourceLastRow: misscanResult.lastRow,
        days: days,
        periodStart: misscanResult.periodStart,
        periodEnd: misscanResult.periodEnd,
        periodLabel: misscanResult.periodLabel
      }
    });

  } catch (error) {
    return json_({
      ok: false,
      error: String(error.message || error)
    });
  }
}

function doPost(e) {
  try {
    validarToken_(e);

    const rawPayload = String((e.parameter && e.parameter.payload) || '{}');
    const payload = JSON.parse(rawPayload);

    validarPayloadEmail_(payload);

    const recipients = destinatarios_(payload);

    if (!recipients.length) {
      throw new Error('Nenhum destinatário válido. Verifique líder e instrutor.');
    }

    const subject = assunto_(payload);
    const htmlBody = corpoHtml_(payload);
    const body = corpoTexto_(payload);

    MailApp.sendEmail({
      to: recipients.join(','),
      subject: subject,
      body: body,
      htmlBody: htmlBody,
      name: 'Mis-Scan Control Center'
    });

    registrarLog_(payload, recipients, 'ENVIADO', '');

    return json_({
      ok: true,
      recipients: recipients,
      subject: subject,
      quotaRemaining: MailApp.getRemainingDailyQuota()
    });

  } catch (error) {
    try {
      const payload = JSON.parse(
        String((e && e.parameter && e.parameter.payload) || '{}')
      );
      registrarLog_(payload, [], 'ERRO', String(error.message || error));
    } catch (_) {}

    return json_({
      ok: false,
      error: String(error.message || error)
    });
  }
}

/* ========================= SEGURANÇA ========================= */

function validarToken_(e) {
  const expected = PropertiesService.getScriptProperties().getProperty('WEBHOOK_TOKEN');
  const received = String((e && e.parameter && e.parameter.token) || '');

  if (!expected) {
    throw new Error('WEBHOOK_TOKEN não configurado nas Propriedades do Script.');
  }

  if (received !== expected) {
    throw new Error('Não autorizado.');
  }
}

function spreadsheetId_() {
  return PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')
    || DEFAULT_SPREADSHEET_ID;
}

/* ========================= HC ========================= */

function lerHC_(ss) {
  const sh = ss.getSheetByName(HC_SHEET);
  if (!sh) throw new Error('Aba "' + HC_SHEET + '" não encontrada.');

  const lastRow = sh.getLastRow();
  if (lastRow < 4) return [];

  // A:E => colaborador, Turno, Setor, líder email, líder nome
  const values = sh.getRange(4, 1, lastRow - 3, 5).getDisplayValues();
  const groups = {};

  values.forEach(function(r) {
    const colaborador = String(r[0] || '').trim();
    if (!colaborador) return;

    const norm = normalizarNome_(colaborador);
    if (!norm) return;

    const turno = String(r[1] || '').trim() || 'Não cadastrado';
    const setor = String(r[2] || '').trim() || 'Não cadastrado';
    const liderEmail = String(r[3] || '').trim().toLowerCase() || 'Não cadastrado';
    const liderNome = String(r[4] || '').trim() || liderPorEmail_(liderEmail);

    if (!groups[norm]) {
      groups[norm] = {
        norm: norm,
        colaborador: colaborador,
        turnos: {},
        setores: {},
        emails: {},
        lideres: {},
        rows: 0
      };
    }

    const g = groups[norm];
    g.turnos[turno] = true;
    g.setores[setor] = true;
    g.emails[liderEmail] = true;
    g.lideres[liderNome] = true;
    g.rows++;
  });

  return Object.keys(groups).map(function(norm) {
    const g = groups[norm];
    const turnos = Object.keys(g.turnos);
    const setores = Object.keys(g.setores);
    const emails = Object.keys(g.emails);
    const lideres = Object.keys(g.lideres);

    return {
      norm: g.norm,
      colaborador: g.colaborador,
      turno: turnos.join(' / '),
      setor: setores.join(' / '),
      lider_email: emails.join(' / '),
      lider_nome: lideres.join(' / '),
      ambiguous: turnos.length > 1 || setores.length > 1 || emails.length > 1,
      source_rows: g.rows
    };
  });
}

/* ========================= MISSCAN ========================= */

function lerMisscanRecente_(ss, days) {
  const sh = ss.getSheetByName(MISSCAN_SHEET);
  if (!sh) throw new Error('Aba "' + MISSCAN_SHEET + '" não encontrada.');

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return {
      rows: [],
      lastRow: lastRow,
      periodStart: '',
      periodEnd: '',
      periodLabel: 'Sem dados'
    };
  }

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (days - 1));

  const chunkSize = 5000;
  const raw = [];
  let cursor = lastRow;
  let encontrouRecente = false;
  let deveParar = false;
  let safety = 0;

  // A:N. Lemos de baixo para cima, assumindo que a LM recebe dados em ordem de carga.
  while (cursor >= 2 && !deveParar && safety < 80) {
    safety++;

    const start = Math.max(2, cursor - chunkSize + 1);
    const count = cursor - start + 1;
    const values = sh.getRange(start, 1, count, 14).getDisplayValues();

    let chunkTemRecente = false;
    let chunkTemAntigo = false;

    for (let i = values.length - 1; i >= 0; i--) {
      const r = values[i];

      const dt = parseDataLM_(r[1]);
      if (!dt) continue;

      if (dt >= cutoff) {
        chunkTemRecente = true;
        encontrouRecente = true;

        if (normalizarSimNao_(r[12]) !== 'SIM') continue;

        raw.push({
          shipment_id: String(r[0] || '').trim(),
          lmreceived_date: formatDataLM_(dt, r[1]),
          lmreceived_station: String(r[2] || '').trim(),
          last_status: String(r[4] || '').trim(),
          socpacked_tonumber: String(r[7] || '').trim(),
          process_fail: String(r[9] || '').trim(),
          operator_fail: String(r[10] || '').trim(),
          to_mis_status: String(r[11] || '').trim(),
          is_misscan: String(r[12] || '').trim()
        });
      } else {
        chunkTemAntigo = true;
      }
    }

    if (encontrouRecente && !chunkTemRecente && chunkTemAntigo) {
      deveParar = true;
    }

    cursor = start - 1;
  }

  const dedup = dedupeMisscan_(raw);
  dedup.sort(function(a, b) {
    return String(a.lmreceived_date).localeCompare(String(b.lmreceived_date));
  });

  const dates = dedup
    .map(function(r) { return parseDataLM_(r.lmreceived_date); })
    .filter(Boolean)
    .sort(function(a, b) { return a - b; });

  const periodStart = dates.length ? formatDia_(dates[0]) : formatDia_(cutoff);
  const periodEnd = dates.length ? formatDia_(dates[dates.length - 1]) : formatDia_(new Date());

  return {
    rows: dedup,
    lastRow: lastRow,
    periodStart: periodStart,
    periodEnd: periodEnd,
    periodLabel: periodStart + ' a ' + periodEnd
  };
}

function dedupeMisscan_(rows) {
  const map = {};

  rows.forEach(function(r, index) {
    const key = String(r.shipment_id || '').trim() || ('ROW_' + index);
    const resp = responsabilidade_(r);
    const identified = operadorIdentificado_(r.operator_fail);

    const score =
      (resp !== 'NA' ? 10 : 0) +
      (identified ? 4 : 0) +
      (r.process_fail ? 2 : 0) +
      (r.to_mis_status ? 1 : 0);

    const dt = parseDataLM_(r.lmreceived_date);
    const ts = dt ? dt.getTime() : 0;
    const current = map[key];

    if (!current || score > current.__score || (score === current.__score && ts > current.__ts)) {
      map[key] = Object.assign({}, r, { __score: score, __ts: ts });
    }
  });

  return Object.keys(map).map(function(k) {
    const x = map[k];
    delete x.__score;
    delete x.__ts;
    return x;
  });
}

function responsabilidade_(r) {
  const pf = String(r.process_fail || '').trim();
  const tm = String(r.to_mis_status || '').trim();

  if (pf === 'Packed TO') return 'EXPEDIÇÃO';
  if (pf.indexOf('Extra Parcel') === 0) return 'ESTEIRA';
  if (tm === 'Whole TO') return 'EXPEDIÇÃO';
  if (tm === 'Extra Parcel') return 'ESTEIRA';
  return 'NA';
}

function operadorIdentificado_(raw) {
  const text = String(raw || '').trim();
  if (!text) return false;

  const parts = text.split(/\s*,\s*/).filter(Boolean);
  if (parts.length !== 1) return false;

  const cleaned = parts[0].replace(/\[Ops\d+\]/gi, '').trim();
  const norm = normalizarNome_(cleaned);

  if (!cleaned || !norm || /@/.test(cleaned)) return false;
  if (norm === 'NA' || norm === 'NOT IDENTIFIED' || norm === 'NAO IDENTIFICADO') return false;

  return true;
}

/* ========================= DATAS / NORMALIZAÇÃO ========================= */

function parseDataLM_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return new Date(value.getTime());
  }

  const s = String(value || '').trim();
  if (!s) return null;

  // yyyy-MM-dd HH:mm:ss
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4] || 0),
      Number(m[5] || 0),
      Number(m[6] || 0)
    );
  }

  // dd/MM/yyyy HH:mm:ss
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return new Date(
      Number(m[3]),
      Number(m[2]) - 1,
      Number(m[1]),
      Number(m[4] || 0),
      Number(m[5] || 0),
      Number(m[6] || 0)
    );
  }

  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function formatDataLM_(dateObj, original) {
  if (String(original || '').trim()) return String(original).trim();

  return Utilities.formatDate(
    dateObj,
    Session.getScriptTimeZone() || 'America/Sao_Paulo',
    'yyyy-MM-dd HH:mm:ss'
  );
}

function formatDia_(dateObj) {
  return Utilities.formatDate(
    dateObj,
    Session.getScriptTimeZone() || 'America/Sao_Paulo',
    'dd/MM/yyyy'
  );
}

function normalizarSimNao_(value) {
  return removerAcentos_(String(value || '')).trim().toUpperCase();
}

function normalizarNome_(value) {
  return removerAcentos_(String(value || ''))
    .replace(/\[Ops\d+\]/gi, ' ')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function removerAcentos_(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function liderPorEmail_(email) {
  const local = String(email || '').split('@')[0];
  if (!local) return 'Não cadastrado';

  return local
    .replace(/\./g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(function(x) {
      return x.charAt(0).toUpperCase() + x.slice(1);
    })
    .join(' ');
}

/* ========================= E-MAIL ========================= */

function validarPayloadEmail_(p) {
  if (!p) throw new Error('Payload vazio.');

  if (['DIALOGO', 'RECICLAGEM'].indexOf(String(p.eventType || '')) < 0) {
    throw new Error('Tipo de evento inválido.');
  }

  if (!String(p.collaborator || '').trim()) {
    throw new Error('Colaborador não informado.');
  }

  if (!String(p.instructorEmail || '').trim()) {
    throw new Error('E-mail do instrutor não informado.');
  }
}

function destinatarios_(p) {
  return [
    String(p.leaderEmail || '').trim().toLowerCase(),
    String(p.instructorEmail || '').trim().toLowerCase()
  ]
    .filter(emailValido_)
    .filter(function(value, index, array) {
      return array.indexOf(value) === index;
    });
}

function emailValido_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

function assunto_(p) {
  const ciclo = Number(p.cycle || 1);
  const acao = p.eventType === 'DIALOGO'
    ? ciclo + 'º Diálogo realizado'
    : ciclo + 'ª Reciclagem concluída';

  return '[MIS-SCAN] ' + acao + ' — ' + String(p.collaborator || '');
}

function corpoHtml_(p) {
  const ciclo = Number(p.cycle || 1);
  const isDialogue = p.eventType === 'DIALOGO';
  const action = isDialogue
    ? ciclo + 'º Diálogo de Performance realizado'
    : ciclo + 'ª Reciclagem concluída';

  const d = p.details || {};

  const extra = isDialogue
    ? linha_('Registro do diálogo', d.notes || '—')
    : [
        linha_('Tema', d.topic || '—'),
        linha_('Causa identificada', d.cause || '—'),
        linha_('Orientação aplicada', d.orientation || '—'),
        linha_('Observações', d.notes || '—'),
        linha_('Evidências anexadas', String(d.evidenceCount || 0))
      ].join('');

  return ''
    + '<div style="font-family:Arial,sans-serif;background:#f4f7fb;padding:24px;color:#0d2f5f">'
    + '<div style="max-width:720px;margin:auto;background:#fff;border:1px solid #cfdceb;border-radius:14px;overflow:hidden">'
    + '<div style="background:#0c223b;color:#fff;padding:18px 22px;border-bottom:3px solid #ee4d2d">'
    + '<div style="font-size:12px;font-weight:700;color:#ff9c88">MIS-SCAN CONTROL CENTER</div>'
    + '<div style="font-size:22px;font-weight:800;margin-top:4px">' + esc_(action) + '</div>'
    + '</div>'
    + '<div style="padding:22px">'
    + linha_('Colaborador', p.collaborator || '—')
    + linha_('Indicador', numeroPct_(p.indicator))
    + linha_('Miss Scan', String(p.missScan || 0))
    + linha_('Turno', p.turno || '—')
    + linha_('Setor', p.setor || '—')
    + linha_('Líder', p.leaderName || '—')
    + linha_('Instrutor / responsável', p.instructorName || '—')
    + linha_('E-mail do instrutor', p.instructorEmail || '—')
    + linha_('Data da ação', d.date || '—')
    + extra
    + '<div style="margin-top:18px;padding:12px 14px;background:#eef5fd;border-radius:9px;color:#486783;font-size:12px">'
    + 'Notificação automática gerada pelo Mis-Scan Control Center.'
    + '</div>'
    + '</div></div></div>';
}

function corpoTexto_(p) {
  const ciclo = Number(p.cycle || 1);
  const acao = p.eventType === 'DIALOGO'
    ? ciclo + 'º Diálogo de Performance realizado'
    : ciclo + 'ª Reciclagem concluída';

  const d = p.details || {};

  return [
    'MIS-SCAN CONTROL CENTER',
    '',
    acao,
    '',
    'Colaborador: ' + (p.collaborator || '—'),
    'Indicador: ' + numeroPct_(p.indicator),
    'Miss Scan: ' + (p.missScan || 0),
    'Turno: ' + (p.turno || '—'),
    'Setor: ' + (p.setor || '—'),
    'Líder: ' + (p.leaderName || '—'),
    'Instrutor: ' + (p.instructorName || '—'),
    'Data: ' + (d.date || '—')
  ].join('\n');
}

function linha_(label, value) {
  return '<div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid #edf2f7">'
    + '<div style="width:180px;color:#7c8da5;font-size:12px;font-weight:700">' + esc_(label) + '</div>'
    + '<div style="flex:1;color:#0d2f5f;font-size:13px;font-weight:700">' + esc_(value) + '</div>'
    + '</div>';
}

function numeroPct_(value) {
  const n = Number(value || 0);
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + '%';
}

function esc_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function registrarLog_(payload, recipients, status, errorMessage) {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId =
    props.getProperty('EMAIL_LOG_SPREADSHEET_ID') ||
    props.getProperty('SPREADSHEET_ID') ||
    DEFAULT_SPREADSHEET_ID;

  if (!spreadsheetId) return;

  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    let sh = ss.getSheetByName('EMAIL_LOG');

    if (!sh) {
      sh = ss.insertSheet('EMAIL_LOG');
      sh.appendRow([
        'DATA_HORA',
        'EVENTO',
        'CICLO',
        'COLABORADOR',
        'INDICADOR',
        'TURNO',
        'SETOR',
        'LIDER',
        'LIDER_EMAIL',
        'INSTRUTOR',
        'INSTRUTOR_EMAIL',
        'DESTINATARIOS',
        'STATUS',
        'ERRO'
      ]);
    }

    sh.appendRow([
      new Date(),
      payload.eventType || '',
      payload.cycle || '',
      payload.collaborator || '',
      payload.indicator || '',
      payload.turno || '',
      payload.setor || '',
      payload.leaderName || '',
      payload.leaderEmail || '',
      payload.instructorName || '',
      payload.instructorEmail || '',
      (recipients || []).join(', '),
      status || '',
      errorMessage || ''
    ]);
  } catch (_) {
    // O envio de e-mail não deve falhar por causa do log.
  }
}

/* ========================= UTILITÁRIOS ========================= */

function gerarTokenWebhook() {
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  Logger.log(token);
  return token;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
