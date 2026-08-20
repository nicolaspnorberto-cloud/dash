/**
 * MIS-SCAN CONTROL CENTER V6.1
 *
 * ARQUITETURA:
 * Google Sheets privado -> Apps Script privado -> Vercel /api/sync -> Vercel Blob privado -> Dashboard
 *
 * E-MAIL:
 * Dashboard -> fila Vercel -> Apps Script privado (gatilho) -> MailApp
 *
 * Não precisa publicar o Apps Script como Web App.
 *
 * SCRIPT PROPERTIES:
 * WEBHOOK_TOKEN    = mesmo valor de EMAIL_WEBHOOK_TOKEN na Vercel
 * VERCEL_BASE_URL  = https://dash-b52u.vercel.app
 * SPREADSHEET_ID   = opcional; já existe ID padrão abaixo
 */

const V6_DEFAULT_SPREADSHEET_ID = '1fwe4cFmYxLgdUmTqtDa6l9lF8WKmpIXE0MCtsWlA4rA';
const V6_HC_SHEET = 'Base de HC 26';
const V6_MISSCAN_SHEET = 'LM';
const V6_DATA_DAYS = 35;

/* =========================================================
   INSTALAÇÃO
========================================================= */

function instalarAutomacoesV6() {
  validarConfiguracaoV6_();

  const handlers = ['sincronizarDadosV6', 'processarFilaEmailsV6'];

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // 30 min mantém a quantidade de gravações dentro de um uso operacional enxuto.
  ScriptApp.newTrigger('sincronizarDadosV6')
    .timeBased()
    .everyMinutes(30)
    .create();

  // E-mails: checagem mais frequente.
  ScriptApp.newTrigger('processarFilaEmailsV6')
    .timeBased()
    .everyMinutes(5)
    .create();

  // Primeira carga imediata.
  sincronizarDadosV6();

  Logger.log('V6 instalada com sucesso.');
}

function removerAutomacoesV6() {
  const handlers = ['sincronizarDadosV6', 'processarFilaEmailsV6'];

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  Logger.log('Gatilhos V6 removidos.');
}

function testarConexaoV6() {
  const base = vercelBaseUrlV6_();
  const response = UrlFetchApp.fetch(base + '/api/ping', {
    method: 'get',
    muteHttpExceptions: true
  });

  Logger.log(response.getResponseCode());
  Logger.log(response.getContentText());
  return response.getContentText();
}

/* =========================================================
   PUSH DE HC + MISSCAN
========================================================= */

function sincronizarDadosV6() {
  validarConfiguracaoV6_();

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    const ss = SpreadsheetApp.openById(spreadsheetIdV6_());
    const hc = lerHCV6_(ss);
    const misscanResult = lerMisscanRecenteV6_(ss, V6_DATA_DAYS);

    const payload = {
      hc: hc,
      misscan: misscanResult.rows,
      meta: {
        generatedAt: new Date().toISOString(),
        spreadsheetId: spreadsheetIdV6_(),
        hcSheet: V6_HC_SHEET,
        misscanSheet: V6_MISSCAN_SHEET,
        hcRecords: hc.length,
        misscanRecords: misscanResult.rows.length,
        misscanSourceLastRow: misscanResult.lastRow,
        days: V6_DATA_DAYS,
        periodStart: misscanResult.periodStart,
        periodEnd: misscanResult.periodEnd,
        periodLabel: misscanResult.periodLabel,
        source: 'Apps Script Push V6'
      }
    };

    const response = v6Fetch_('/api/sync', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    const text = response.getContentText();

    if (code < 200 || code >= 300) {
      throw new Error('Vercel /api/sync retornou ' + code + ': ' + text);
    }

    const data = JSON.parse(text);
    if (!data.ok) throw new Error(data.error || 'Falha na sincronização.');

    PropertiesService.getScriptProperties()
      .setProperty('V6_LAST_SYNC', new Date().toISOString());

    Logger.log(
      'V6 sync OK: ' +
      data.hcRecords + ' HC / ' +
      data.misscanRecords + ' Misscan'
    );

  } finally {
    lock.releaseLock();
  }
}

/* =========================================================
   FILA DE E-MAIL
========================================================= */

function processarFilaEmailsV6() {
  validarConfiguracaoV6_();

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    const response = v6Fetch_('/api/email-queue', {
      method: 'get',
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      throw new Error(
        'Fila retornou ' +
        response.getResponseCode() +
        ': ' +
        response.getContentText()
      );
    }

    const data = JSON.parse(response.getContentText());
    const items = data.items || [];

    if (!items.length) return;

    const results = [];

    items.forEach(function(item) {
      try {
        enviarEmailTratativaV6_(item);
        results.push({
          id: item.id,
          status: 'SENT',
          sentAt: new Date().toISOString()
        });
      } catch (error) {
        results.push({
          id: item.id,
          status: 'ERROR',
          error: String(error.message || error)
        });
      }
    });

    const ack = v6Fetch_('/api/email-queue', {
      method: 'patch',
      contentType: 'application/json',
      payload: JSON.stringify({ results: results }),
      muteHttpExceptions: true
    });

    if (ack.getResponseCode() < 200 || ack.getResponseCode() >= 300) {
      throw new Error(
        'Falha ao atualizar fila: ' +
        ack.getResponseCode() +
        ' ' +
        ack.getContentText()
      );
    }

  } finally {
    lock.releaseLock();
  }
}

function enviarEmailTratativaV6_(item) {
  const recipients = (item.recipients || [])
    .map(function(x) { return String(x || '').trim().toLowerCase(); })
    .filter(emailShopeeV6_)
    .filter(function(value, index, arr) {
      return arr.indexOf(value) === index;
    });

  if (!recipients.length) {
    throw new Error('Nenhum destinatário @shopee.com válido.');
  }

  const subject = assuntoEmailV6_(item);
  const body = corpoTextoEmailV6_(item);
  const htmlBody = corpoHtmlEmailV6_(item);

  MailApp.sendEmail({
    to: recipients.join(','),
    subject: subject,
    body: body,
    htmlBody: htmlBody,
    name: 'Mis-Scan Control Center'
  });
}

function assuntoEmailV6_(item) {
  const ciclo = Number(item.cycle || 1);
  const acao = item.eventType === 'DIALOGO'
    ? ciclo + 'º Diálogo realizado'
    : ciclo + 'ª Reciclagem concluída';

  return '[MIS-SCAN] ' + acao + ' — ' + String(item.collaborator || '');
}

function corpoTextoEmailV6_(item) {
  const d = item.details || {};
  const ciclo = Number(item.cycle || 1);
  const acao = item.eventType === 'DIALOGO'
    ? ciclo + 'º Diálogo de Performance realizado'
    : ciclo + 'ª Reciclagem concluída';

  const lines = [
    'MIS-SCAN CONTROL CENTER',
    '',
    acao,
    '',
    'Colaborador: ' + (item.collaborator || '—'),
    'Indicador: ' + numeroPctV6_(item.indicator),
    'Miss Scan: ' + (item.missScan || 0),
    'Turno: ' + (item.turno || '—'),
    'Setor: ' + (item.setor || '—'),
    'Líder: ' + (item.leaderName || '—'),
    'Instrutor: ' + (item.instructorName || '—'),
    'Data: ' + (d.date || '—')
  ];

  if (item.eventType === 'DIALOGO') {
    lines.push('Registro: ' + (d.notes || '—'));
  } else {
    lines.push('Tema: ' + (d.topic || '—'));
    lines.push('Causa: ' + (d.cause || '—'));
    lines.push('Orientação: ' + (d.orientation || '—'));
    lines.push('Observações: ' + (d.notes || '—'));
    lines.push('Evidências: ' + (d.evidenceCount || 0));
  }

  return lines.join('\n');
}

function corpoHtmlEmailV6_(item) {
  const d = item.details || {};
  const ciclo = Number(item.cycle || 1);
  const acao = item.eventType === 'DIALOGO'
    ? ciclo + 'º Diálogo de Performance realizado'
    : ciclo + 'ª Reciclagem concluída';

  let extra = '';

  if (item.eventType === 'DIALOGO') {
    extra = linhaHtmlV6_('Registro do diálogo', d.notes || '—');
  } else {
    extra =
      linhaHtmlV6_('Tema', d.topic || '—') +
      linhaHtmlV6_('Causa identificada', d.cause || '—') +
      linhaHtmlV6_('Orientação aplicada', d.orientation || '—') +
      linhaHtmlV6_('Observações', d.notes || '—') +
      linhaHtmlV6_('Evidências anexadas', String(d.evidenceCount || 0));
  }

  return ''
    + '<div style="font-family:Arial,sans-serif;background:#f4f7fb;padding:24px;color:#0d2f5f">'
    + '<div style="max-width:720px;margin:auto;background:#fff;border:1px solid #cfdceb;border-radius:14px;overflow:hidden">'
    + '<div style="background:#0c223b;color:#fff;padding:18px 22px;border-bottom:3px solid #ee4d2d">'
    + '<div style="font-size:12px;font-weight:700;color:#ff9c88">MIS-SCAN CONTROL CENTER</div>'
    + '<div style="font-size:22px;font-weight:800;margin-top:4px">' + escHtmlV6_(acao) + '</div>'
    + '</div>'
    + '<div style="padding:22px">'
    + linhaHtmlV6_('Colaborador', item.collaborator || '—')
    + linhaHtmlV6_('Indicador', numeroPctV6_(item.indicator))
    + linhaHtmlV6_('Miss Scan', String(item.missScan || 0))
    + linhaHtmlV6_('Turno', item.turno || '—')
    + linhaHtmlV6_('Setor', item.setor || '—')
    + linhaHtmlV6_('Líder', item.leaderName || '—')
    + linhaHtmlV6_('Instrutor / responsável', item.instructorName || '—')
    + linhaHtmlV6_('Data da ação', d.date || '—')
    + extra
    + '<div style="margin-top:18px;padding:12px 14px;background:#eef5fd;border-radius:9px;color:#486783;font-size:12px">'
    + 'Notificação automática processada pela rotina privada do Mis-Scan Control Center.'
    + '</div>'
    + '</div></div></div>';
}

/* =========================================================
   HC
========================================================= */

function lerHCV6_(ss) {
  const sh = ss.getSheetByName(V6_HC_SHEET);
  if (!sh) throw new Error('Aba "' + V6_HC_SHEET + '" não encontrada.');

  const lastRow = sh.getLastRow();
  if (lastRow < 4) return [];

  const values = sh.getRange(4, 1, lastRow - 3, 5).getDisplayValues();
  const groups = {};

  values.forEach(function(r) {
    const colaborador = String(r[0] || '').trim();
    if (!colaborador) return;

    const norm = normalizarNomeV6_(colaborador);
    if (!norm) return;

    const turno = String(r[1] || '').trim() || 'Não cadastrado';
    const setor = String(r[2] || '').trim() || 'Não cadastrado';
    const liderEmail = String(r[3] || '').trim().toLowerCase() || 'Não cadastrado';
    const liderNome = String(r[4] || '').trim() || liderPorEmailV6_(liderEmail);

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

/* =========================================================
   MISSCAN
========================================================= */

function lerMisscanRecenteV6_(ss, days) {
  const sh = ss.getSheetByName(V6_MISSCAN_SHEET);
  if (!sh) throw new Error('Aba "' + V6_MISSCAN_SHEET + '" não encontrada.');

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

  while (cursor >= 2 && !deveParar && safety < 80) {
    safety++;

    const start = Math.max(2, cursor - chunkSize + 1);
    const count = cursor - start + 1;
    const values = sh.getRange(start, 1, count, 14).getDisplayValues();

    let chunkTemRecente = false;
    let chunkTemAntigo = false;

    for (let i = values.length - 1; i >= 0; i--) {
      const r = values[i];
      const dt = parseDataV6_(r[1]);

      if (!dt) continue;

      if (dt >= cutoff) {
        chunkTemRecente = true;
        encontrouRecente = true;

        if (normalizarSimNaoV6_(r[12]) !== 'SIM') continue;

        raw.push({
          shipment_id: String(r[0] || '').trim(),
          lmreceived_date: formatDataV6_(dt, r[1]),
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

  const dedup = dedupeMisscanV6_(raw);
  dedup.sort(function(a, b) {
    return String(a.lmreceived_date).localeCompare(String(b.lmreceived_date));
  });

  const dates = dedup
    .map(function(r) { return parseDataV6_(r.lmreceived_date); })
    .filter(Boolean)
    .sort(function(a, b) { return a - b; });

  const periodStart = dates.length ? formatDiaV6_(dates[0]) : formatDiaV6_(cutoff);
  const periodEnd = dates.length ? formatDiaV6_(dates[dates.length - 1]) : formatDiaV6_(new Date());

  return {
    rows: dedup,
    lastRow: lastRow,
    periodStart: periodStart,
    periodEnd: periodEnd,
    periodLabel: periodStart + ' a ' + periodEnd
  };
}

function dedupeMisscanV6_(rows) {
  const map = {};

  rows.forEach(function(r, index) {
    const key = String(r.shipment_id || '').trim() || ('ROW_' + index);
    const resp = responsabilidadeV6_(r);
    const identified = operadorIdentificadoV6_(r.operator_fail);

    const score =
      (resp !== 'NA' ? 10 : 0) +
      (identified ? 4 : 0) +
      (r.process_fail ? 2 : 0) +
      (r.to_mis_status ? 1 : 0);

    const dt = parseDataV6_(r.lmreceived_date);
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

function responsabilidadeV6_(r) {
  const pf = String(r.process_fail || '').trim();
  const tm = String(r.to_mis_status || '').trim();

  if (pf === 'Packed TO') return 'EXPEDIÇÃO';
  if (pf.indexOf('Extra Parcel') === 0) return 'ESTEIRA';
  if (tm === 'Whole TO') return 'EXPEDIÇÃO';
  if (tm === 'Extra Parcel') return 'ESTEIRA';
  return 'NA';
}

function operadorIdentificadoV6_(raw) {
  const text = String(raw || '').trim();
  if (!text) return false;

  const parts = text.split(/\s*,\s*/).filter(Boolean);
  if (parts.length !== 1) return false;

  const cleaned = parts[0].replace(/\[Ops\d+\]/gi, '').trim();
  const norm = normalizarNomeV6_(cleaned);

  if (!cleaned || !norm || /@/.test(cleaned)) return false;
  if (norm === 'NA' || norm === 'NOT IDENTIFIED' || norm === 'NAO IDENTIFICADO') return false;

  return true;
}

/* =========================================================
   HTTP / CONFIGURAÇÃO
========================================================= */

function v6Fetch_(path, options) {
  options = options || {};
  options.headers = Object.assign({}, options.headers || {}, {
    'X-Sync-Token': webhookTokenV6_()
  });

  return UrlFetchApp.fetch(vercelBaseUrlV6_() + path, options);
}

function validarConfiguracaoV6_() {
  if (!webhookTokenV6_()) {
    throw new Error('Configure WEBHOOK_TOKEN nas Propriedades do Script.');
  }
}

function webhookTokenV6_() {
  return String(
    PropertiesService.getScriptProperties().getProperty('WEBHOOK_TOKEN') || ''
  ).trim();
}

function vercelBaseUrlV6_() {
  const value = String(
    PropertiesService.getScriptProperties().getProperty('VERCEL_BASE_URL') ||
    'https://dash-b52u.vercel.app'
  ).trim();

  return value.replace(/\/+$/, '');
}

function spreadsheetIdV6_() {
  return String(
    PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') ||
    V6_DEFAULT_SPREADSHEET_ID
  ).trim();
}

/* =========================================================
   UTILITÁRIOS
========================================================= */

function parseDataV6_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return new Date(value.getTime());
  }

  const s = String(value || '').trim();
  if (!s) return null;

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

function formatDataV6_(dateObj, original) {
  if (String(original || '').trim()) return String(original).trim();

  return Utilities.formatDate(
    dateObj,
    Session.getScriptTimeZone() || 'America/Sao_Paulo',
    'yyyy-MM-dd HH:mm:ss'
  );
}

function formatDiaV6_(dateObj) {
  return Utilities.formatDate(
    dateObj,
    Session.getScriptTimeZone() || 'America/Sao_Paulo',
    'dd/MM/yyyy'
  );
}

function normalizarSimNaoV6_(value) {
  return removerAcentosV6_(String(value || '')).trim().toUpperCase();
}

function normalizarNomeV6_(value) {
  return removerAcentosV6_(String(value || ''))
    .replace(/\[Ops\d+\]/gi, ' ')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function removerAcentosV6_(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function liderPorEmailV6_(email) {
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

function emailShopeeV6_(email) {
  return /^[^\s@]+@shopee\.com$/i.test(String(email || '').trim());
}

function numeroPctV6_(value) {
  const n = Number(value || 0);
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + '%';
}

function linhaHtmlV6_(label, value) {
  return '<div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid #edf2f7">'
    + '<div style="width:180px;color:#7c8da5;font-size:12px;font-weight:700">' + escHtmlV6_(label) + '</div>'
    + '<div style="flex:1;color:#0d2f5f;font-size:13px;font-weight:700">' + escHtmlV6_(value) + '</div>'
    + '</div>';
}

function escHtmlV6_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


/* =========================================================
   V6.1 — HISTÓRICO + FILTRO DE DATA
========================================================= */

function instalarAutomacoesV61() {
  validarConfiguracaoV6_();

  const handlers = [
    'sincronizarDadosV6',
    'processarFilaEmailsV6',
    'sincronizarDadosV61',
    'processarFilaEmailsV61'
  ];

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('sincronizarDadosV61')
    .timeBased()
    .everyMinutes(30)
    .create();

  ScriptApp.newTrigger('processarFilaEmailsV61')
    .timeBased()
    .everyMinutes(5)
    .create();

  sincronizarDadosV61();

  Logger.log('V6.1 instalada com sucesso.');
}

function removerAutomacoesV61() {
  const handlers = [
    'sincronizarDadosV6',
    'processarFilaEmailsV6',
    'sincronizarDadosV61',
    'processarFilaEmailsV61'
  ];

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  Logger.log('Gatilhos V6/V6.1 removidos.');
}

function testarConexaoV61() {
  return testarConexaoV6();
}

function sincronizarDadosV61() {
  return sincronizarJanelaV61_(V6_DATA_DAYS, 'INCREMENTAL');
}

/**
 * Executar UMA VEZ após publicar a V6.1.
 * Faz o backfill de até 180 dias da Matinal atual.
 */
function sincronizarHistoricoInicialV61() {
  return sincronizarJanelaV61_(180, 'BACKFILL');
}

function sincronizarJanelaV61_(days, mode) {
  validarConfiguracaoV6_();

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    const ss = SpreadsheetApp.openById(spreadsheetIdV6_());
    const hc = lerHCV6_(ss);
    const misscanResult = lerMisscanRecenteV6_(ss, days);

    const payload = {
      hc: hc,
      misscan: misscanResult.rows,
      meta: {
        generatedAt: new Date().toISOString(),
        spreadsheetId: spreadsheetIdV6_(),
        hcSheet: V6_HC_SHEET,
        misscanSheet: V6_MISSCAN_SHEET,
        hcRecords: hc.length,
        misscanRecords: misscanResult.rows.length,
        misscanSourceLastRow: misscanResult.lastRow,
        days: days,
        periodStart: misscanResult.periodStart,
        periodEnd: misscanResult.periodEnd,
        periodLabel: misscanResult.periodLabel,
        source: 'Apps Script Push V6.1 Histórico',
        syncMode: mode
      }
    };

    const response = v6Fetch_('/api/sync', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    const text = response.getContentText();

    if (code < 200 || code >= 300) {
      throw new Error('Vercel /api/sync retornou ' + code + ': ' + text);
    }

    const data = JSON.parse(text);
    if (!data.ok) throw new Error(data.error || 'Falha na sincronização V6.1.');

    PropertiesService.getScriptProperties()
      .setProperty('V61_LAST_SYNC', new Date().toISOString());

    Logger.log(
      'V6.1 ' + mode + ' OK: ' +
      data.hcRecords + ' HC / ' +
      data.incomingMisscanRecords + ' Misscan / meses: ' +
      (data.monthsUpdated || []).join(', ')
    );

    return data;

  } finally {
    lock.releaseLock();
  }
}

function processarFilaEmailsV61() {
  return processarFilaEmailsV6();
}


/* =========================================================
   V6.2 — CALENDARIZAÇÃO AUTOMÁTICA
========================================================= */
const V62_PLANNING_SPREADSHEET_ID = '1bc7VrtFWHNGevKL-Qr67JT_U5yUNQH3UCLMEHmWzJfU';

function instalarAutomacoesV62() {
  validarConfiguracaoV6_();
  const handlers=['sincronizarDadosV6','processarFilaEmailsV6','sincronizarDadosV61','processarFilaEmailsV61','sincronizarTudoV62','processarFilaEmailsV62'];
  ScriptApp.getProjectTriggers().forEach(function(trigger){if(handlers.indexOf(trigger.getHandlerFunction())>=0)ScriptApp.deleteTrigger(trigger);});
  ScriptApp.newTrigger('sincronizarTudoV62').timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('processarFilaEmailsV62').timeBased().everyMinutes(5).create();
  sincronizarTudoV62();
  Logger.log('V6.2 instalada: histórico + calendarização automática + e-mails.');
}
function sincronizarTudoV62(){const dados=sincronizarDadosV61();const calendario=sincronizarCalendarizacaoV62();return {dados:dados,calendario:calendario};}
function processarFilaEmailsV62(){return processarFilaEmailsV61();}
function testarCalendarizacaoV62(){const rows=lerPlanejamentoV62_();Logger.log(JSON.stringify(rows.slice(0,6),null,2));Logger.log('Linhas automáticas: '+rows.length);return rows;}

function sincronizarCalendarizacaoV62(){
  validarConfiguracaoV6_();
  const rows=lerPlanejamentoV62_();
  const props=PropertiesService.getScriptProperties();
  const planningId=String(props.getProperty('PLANNING_SPREADSHEET_ID')||V62_PLANNING_SPREADSHEET_ID).trim();
  const saved=props.getProperty('V62_PLANNING_META');
  const parsed=saved?JSON.parse(saved):{};
  const payload={rows:rows,meta:{generatedAt:new Date().toISOString(),spreadsheetId:planningId,source:'Hc x Posto de Trabalho',weekSheet:parsed.weekSheet||'',sourceDateStart:parsed.sourceDateStart||'',sourceDateEnd:parsed.sourceDateEnd||'',allocationMethod:'Processar distribuído proporcionalmente por HC Plano × Produtividade do turno',capacityMethod:'HC Plano × Produtividade por HC/turno'}};
  const response=v6Fetch_('/api/calendar-sync',{method:'post',contentType:'application/json',payload:JSON.stringify(payload),muteHttpExceptions:true});
  const code=response.getResponseCode(),text=response.getContentText();
  if(code<200||code>=300)throw new Error('Calendar sync retornou '+code+': '+text);
  const data=JSON.parse(text);if(!data.ok)throw new Error(data.error||'Falha na calendarização automática.');
  props.setProperty('V62_LAST_CALENDAR_SYNC',new Date().toISOString());
  Logger.log('V6.2 calendarização OK: '+data.rows+' linhas.');return data;
}

function lerPlanejamentoV62_(){
  const props=PropertiesService.getScriptProperties();
  const planningId=String(props.getProperty('PLANNING_SPREADSHEET_ID')||V62_PLANNING_SPREADSHEET_ID).trim();
  const ss=SpreadsheetApp.openById(planningId),sheet=selecionarAbaPlanejamentoV62_(ss);
  const values=sheet.getRange(1,1,sheet.getLastRow(),Math.min(sheet.getLastColumn(),57)).getDisplayValues();
  const dayRows=[];for(let i=0;i<values.length;i++){if(normV62_(values[i][0])==='DIA')dayRows.push(i);}
  const out=[],dates=[];
  dayRows.forEach(function(dayRow,idx){
    const endRow=idx+1<dayRows.length?dayRows[idx+1]:Math.min(values.length,dayRow+25);
    const date=parsePlanningDateV62_(values[dayRow][1]);if(!date)return;
    const dateKey=Utilities.formatDate(date,Session.getScriptTimeZone()||'America/Sao_Paulo','yyyy-MM-dd');dates.push(dateKey);
    let forecastRow=-1;for(let r=dayRow;r<Math.min(endRow,dayRow+6);r++){if(findLabelIndexV62_(values[r],'FORECAST')>=0){forecastRow=r;break;}}
    if(forecastRow<0)return;
    const row=values[forecastRow];
    const forecastTotal=valueAfterLabelV62_(row,'FORECAST'),processar=valueAfterLabelV62_(row,'PROCESSAR'),capacidadeFonte=valueAfterLabelV62_(row,'CAPACIDADE'),backlog=valueAfterLabelV62_(row,'BACKLOG D+1');
    const turnIdx=findLabelIndexV62_(row,'TURNO'),esteirasIdx=findLabelIndexAfterV62_(row,'ESTEIRAS',turnIdx),apoioIdx=findLabelIndexAfterV62_(row,'APOIO',turnIdx),hcPlanoIdx=findLabelIndexAfterV62_(row,'HC PLANO',turnIdx);
    const prodMap={};
    for(let r=dayRow;r<=forecastRow;r++)['T1','T2','T3'].forEach(function(t){const pos=values[r].findIndex(function(x){return normV62_(x)===t;});if(pos>=0&&pos+1<values[r].length){const n=numV62_(values[r][pos+1]);if(n>0&&!prodMap[t])prodMap[t]=n;}});
    const shiftInfo={};
    if(turnIdx>=0){for(let r=forecastRow+1;r<=Math.min(forecastRow+4,endRow-1);r++){const t=normV62_(values[r][turnIdx]);if(['T1','T2','T3'].indexOf(t)<0)continue;shiftInfo[t]={hc:hcPlanoIdx>=0?numV62_(values[r][hcPlanoIdx]):0,esteirasHC:esteirasIdx>=0?numV62_(values[r][esteirasIdx]):0,apoioHC:apoioIdx>=0?numV62_(values[r][apoioIdx]):0,productivity:prodMap[t]||0,expedicaoHC:0};}}
    for(let r=forecastRow;r<endRow;r++){const expIdx=values[r].findIndex(function(x){return normV62_(x)==='EXPEDICAO';});if(expIdx>=0){['T1','T2','T3'].forEach(function(t,k){if(shiftInfo[t])shiftInfo[t].expedicaoHC=numV62_(values[r][expIdx+1+k]);});break;}}
    const turns=['T1','T2','T3'].filter(function(t){return shiftInfo[t]&&shiftInfo[t].hc>0&&shiftInfo[t].productivity>0;});
    const weightTotal=turns.reduce(function(sum,t){return sum+shiftInfo[t].hc*shiftInfo[t].productivity;},0);
    turns.forEach(function(t){const s=shiftInfo[t],weight=s.hc*s.productivity,volume=weightTotal>0?Math.round(processar*weight/weightTotal):0;out.push({id:'AUTO_'+dateKey+'_'+t,source:'AUTO',sourceLabel:sheet.getName()+' • '+t,date:dateKey,turno:t,area:'OPERAÇÃO',volume:volume,hc:s.hc,hours:1,productivity:s.productivity,productivityUnit:'POR_TURNO',esteirasHC:s.esteirasHC,apoioHC:s.apoioHC,expedicaoHC:s.expedicaoHC,baseRate:0.94,forecastDay:forecastTotal,processarDay:processar,sourceCapacityDay:capacidadeFonte,backlogDay:backlog});});
  });
  dates.sort();props.setProperty('V62_PLANNING_META',JSON.stringify({weekSheet:sheet.getName(),sourceDateStart:dates[0]||'',sourceDateEnd:dates.length?dates[dates.length-1]:''}));return out;
}

function selecionarAbaPlanejamentoV62_(ss){
  const todayKey=Utilities.formatDate(new Date(),Session.getScriptTimeZone()||'America/Sao_Paulo','yyyy-MM-dd');
  const candidates=ss.getSheets().filter(function(sh){return /^W\d+$/i.test(sh.getName());});
  for(let i=0;i<candidates.length;i++){const sh=candidates[i],vals=sh.getRange(1,1,Math.min(sh.getLastRow(),200),2).getDisplayValues();for(let r=0;r<vals.length;r++){if(normV62_(vals[r][0])!=='DIA')continue;const d=parsePlanningDateV62_(vals[r][1]);if(!d)continue;const key=Utilities.formatDate(d,Session.getScriptTimeZone()||'America/Sao_Paulo','yyyy-MM-dd');if(key===todayKey)return sh;}}
  candidates.sort(function(a,b){return Number(b.getName().replace(/\D/g,''))-Number(a.getName().replace(/\D/g,''));});
  if(!candidates.length)throw new Error('Nenhuma aba semanal Wxx encontrada no planejamento.');return candidates[0];
}
function parsePlanningDateV62_(value){const s=normV62_(value).toLowerCase(),m=s.match(/(\d{1,2})\s+([a-z]+)/i);if(!m)return null;const months={janeiro:0,fevereiro:1,marco:2,abril:3,maio:4,junho:5,julho:6,agosto:7,setembro:8,outubro:9,novembro:10,dezembro:11},month=months[m[2]];if(month===undefined)return null;return new Date(new Date().getFullYear(),month,Number(m[1]),12,0,0);}
function findLabelIndexV62_(row,label){const target=normV62_(label);return row.findIndex(function(x){return normV62_(x)===target;});}
function findLabelIndexAfterV62_(row,label,start){const target=normV62_(label);for(let i=Math.max(0,start||0);i<row.length;i++)if(normV62_(row[i])===target)return i;return -1;}
function valueAfterLabelV62_(row,label){const idx=findLabelIndexV62_(row,label);return idx>=0&&idx+1<row.length?numV62_(row[idx+1]):0;}
function numV62_(value){const s=String(value==null?'':value).trim();if(!s||s==='-'||/#DIV\/0!/i.test(s))return 0;const cleaned=s.replace(/\./g,'').replace(/%/g,'').replace(',','.').replace(/[^0-9.-]/g,'');const n=Number(cleaned);return Number.isFinite(n)?n:0;}
function normV62_(value){return removerAcentosV6_(String(value||'')).toUpperCase().replace(/\s+/g,' ').trim();}


/* =========================================================
   V6.3 — PRODUÇÃO REAL + TAXA MISS CAN AUTOMÁTICA
   Regra operacional:
   T1 -> T1
   T2 + T4 -> bloco T2
   T3 + T5 -> bloco T3
========================================================= */
const V63_ORACULO_PAGE_URL = 'https://oraculo-mg4.vercel.app/historico-packing';
const V63_PROD_HISTORY_DAYS = 35;

function instalarAutomacoesV63(){
  validarConfiguracaoV6_();
  const handlers=[
    'sincronizarDadosV6','processarFilaEmailsV6','sincronizarDadosV61','processarFilaEmailsV61',
    'sincronizarTudoV62','processarFilaEmailsV62','sincronizarTudoV63','processarFilaEmailsV63'
  ];
  ScriptApp.getProjectTriggers().forEach(function(trigger){
    if(handlers.indexOf(trigger.getHandlerFunction())>=0)ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('sincronizarTudoV63').timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('processarFilaEmailsV63').timeBased().everyMinutes(5).create();
  sincronizarTudoV63();
  Logger.log('V6.3 instalada: histórico + calendarização + produção real + taxa automática + e-mails.');
}

function sincronizarTudoV63(){
  const dados=sincronizarDadosV61();
  const calendario=sincronizarCalendarizacaoV62();
  let producao=null;
  try{producao=sincronizarProducaoRealV63();}catch(err){Logger.log('Produção real V6.3: '+err.message);}
  return {dados:dados,calendario:calendario,producao:producao};
}
function processarFilaEmailsV63(){return processarFilaEmailsV61();}

/**
 * Execute uma vez. Tenta localizar automaticamente o endpoint JSON usado pelo Oráculo MG4.
 * Se encontrar, salva ORACULO_PROD_API_URL nas propriedades do script.
 */
function descobrirFonteOraculoV63(){
  const props=PropertiesService.getScriptProperties();
  const explicit=String(props.getProperty('ORACULO_PROD_API_URL')||'').trim();
  if(explicit){Logger.log('ORACULO_PROD_API_URL já configurada: '+explicit);return explicit;}

  const found=[];
  try{
    const html=UrlFetchApp.fetch(V63_ORACULO_PAGE_URL,{muteHttpExceptions:true,followRedirects:true}).getContentText();
    const scriptRe=/<script[^>]+src=["']([^"']+\.js[^"']*)["']/gi;
    let m,count=0;
    while((m=scriptRe.exec(html))&&count<30){
      count++;
      let src=m[1];
      if(src.indexOf('http')!==0) src='https://oraculo-mg4.vercel.app'+(src.charAt(0)==='/'?'':'/')+src;
      try{
        const js=UrlFetchApp.fetch(src,{muteHttpExceptions:true,followRedirects:true}).getContentText();
        const apiRe=/["'`]([^"'`]*\/api\/[^"'`]*(?:packing|histor|esteira|prod)[^"'`]*)["'`]/gi;
        let a;while((a=apiRe.exec(js))&&found.length<30){
          let u=a[1].replace(/\\u0026/g,'&');
          if(u.indexOf('http')!==0)u='https://oraculo-mg4.vercel.app'+(u.charAt(0)==='/'?'':'/')+u;
          if(found.indexOf(u)<0)found.push(u);
        }
      }catch(e){}
    }
  }catch(e){Logger.log('Falha ao inspecionar página do Oráculo: '+e.message);}

  const guessed=[
    'https://oraculo-mg4.vercel.app/api/historico-packing',
    'https://oraculo-mg4.vercel.app/api/historico-prod-esteiras',
    'https://oraculo-mg4.vercel.app/api/packing-history',
    'https://oraculo-mg4.vercel.app/api/packing/historico'
  ];
  guessed.forEach(function(u){if(found.indexOf(u)<0)found.push(u);});

  const testDate=Utilities.formatDate(new Date(Date.now()-24*3600*1000),Session.getScriptTimeZone()||'America/Sao_Paulo','yyyy-MM-dd');
  for(let i=0;i<found.length;i++){
    const base=found[i].split('?')[0];
    const variants=[
      base+'?from='+testDate+'&to='+testDate,
      base+'?startDate='+testDate+'&endDate='+testDate,
      base+'?date='+testDate,
      base
    ];
    for(let j=0;j<variants.length;j++){
      try{
        const r=UrlFetchApp.fetch(variants[j],{muteHttpExceptions:true,followRedirects:true,headers:{Accept:'application/json'}});
        const text=r.getContentText();
        if(r.getResponseCode()>=200&&r.getResponseCode()<300&&/^[\s\[{]/.test(text)&&parseProducaoV63_(text,testDate).length){
          props.setProperty('ORACULO_PROD_API_URL',base);
          Logger.log('Fonte automática encontrada: '+base);
          return base;
        }
      }catch(e){}
    }
  }
  Logger.log('Endpoint não encontrado automaticamente. Candidatos: '+JSON.stringify(found));
  throw new Error('Não consegui descobrir o endpoint JSON do Oráculo automaticamente. Veja o Registro de execução; se necessário configure ORACULO_PROD_API_URL com a rota /api usada pelo Histórico Prod Esteiras.');
}

function testarProducaoRealV63(){
  const rows=lerProducaoRealOraculoV63_(3);
  Logger.log(JSON.stringify(rows,null,2));
  Logger.log('Linhas válidas: '+rows.length);
  return rows;
}

function sincronizarHistoricoProducaoInicialV63(){
  const rows=lerProducaoRealOraculoV63_(V63_PROD_HISTORY_DAYS);
  return enviarProducaoRealV63_(rows,'BACKFILL');
}

function sincronizarProducaoRealV63(){
  const rows=lerProducaoRealOraculoV63_(7);
  return enviarProducaoRealV63_(rows,'INCREMENTAL');
}

function enviarProducaoRealV63_(rows,mode){
  if(!rows.length)throw new Error('Nenhuma produção real retornada pelo Oráculo.');
  const payload={rows:rows,meta:{generatedAt:new Date().toISOString(),source:'Oráculo MG4 • Histórico Prod Esteiras',sourceUrl:V63_ORACULO_PAGE_URL,syncMode:mode,mapping:{T1:'T1',T2:'T2 + T4',T3:'T3 + T5'}}};
  const response=v6Fetch_('/api/producao-sync',{method:'post',contentType:'application/json',payload:JSON.stringify(payload),muteHttpExceptions:true});
  const code=response.getResponseCode(),text=response.getContentText();
  if(code<200||code>=300)throw new Error('Produção sync retornou '+code+': '+text);
  const data=JSON.parse(text);if(!data.ok)throw new Error(data.error||'Falha ao salvar produção real.');
  PropertiesService.getScriptProperties().setProperty('V63_LAST_PROD_SYNC',new Date().toISOString());
  Logger.log('V6.3 produção real OK: '+data.incoming+' linhas; total histórico '+data.total+'.');
  return data;
}

function lerProducaoRealOraculoV63_(days){
  const props=PropertiesService.getScriptProperties();
  let api=String(props.getProperty('ORACULO_PROD_API_URL')||'').trim();
  if(!api)api=descobrirFonteOraculoV63();
  const tz=Session.getScriptTimeZone()||'America/Sao_Paulo';
  const end=new Date();end.setHours(12,0,0,0);
  const start=new Date(end.getTime()-(Math.max(1,days)-1)*24*3600*1000);
  const from=Utilities.formatDate(start,tz,'yyyy-MM-dd'),to=Utilities.formatDate(end,tz,'yyyy-MM-dd');
  const variants=[
    api+(api.indexOf('?')>=0?'&':'?')+'from='+from+'&to='+to,
    api+(api.indexOf('?')>=0?'&':'?')+'startDate='+from+'&endDate='+to,
    api+(api.indexOf('?')>=0?'&':'?')+'start='+from+'&end='+to
  ];
  for(let i=0;i<variants.length;i++){
    try{
      const r=UrlFetchApp.fetch(variants[i],{muteHttpExceptions:true,followRedirects:true,headers:{Accept:'application/json'}});
      if(r.getResponseCode()<200||r.getResponseCode()>=300)continue;
      const rows=parseProducaoV63_(r.getContentText(),'');
      if(rows.length)return dedupeProducaoV63_(rows);
    }catch(e){}
  }
  // fallback diário: útil quando a API aceita somente uma data.
  const out=[];
  for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){
    const key=Utilities.formatDate(d,tz,'yyyy-MM-dd');
    const qs=[api+(api.indexOf('?')>=0?'&':'?')+'date='+key,api+(api.indexOf('?')>=0?'&':'?')+'from='+key+'&to='+key];
    for(let i=0;i<qs.length;i++){
      try{
        const r=UrlFetchApp.fetch(qs[i],{muteHttpExceptions:true,followRedirects:true,headers:{Accept:'application/json'}});
        if(r.getResponseCode()<200||r.getResponseCode()>=300)continue;
        const rows=parseProducaoV63_(r.getContentText(),key);if(rows.length){out.push.apply(out,rows);break;}
      }catch(e){}
    }
  }
  return dedupeProducaoV63_(out);
}

function parseProducaoV63_(text,fallbackDate){
  let data;try{data=JSON.parse(text);}catch(e){return [];}
  const out=[];
  function n(v){if(typeof v==='number')return v;const s=String(v==null?'':v).trim().toLowerCase().replace(/mil/g,'').replace(/\./g,'').replace(',','.').replace(/[^0-9.-]/g,'');const x=Number(s);return Number.isFinite(x)?x:NaN;}
  function dateOf(o){const v=o.date||o.data||o.day||o.period||o.periodo||fallbackDate||'';const s=String(v);let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return m[0];m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);if(m)return m[3]+'-'+m[2]+'-'+m[1];return fallbackDate||'';}
  function add(date,turn,real,meta){let r=n(real),m=n(meta);if(!Number.isFinite(r))return;const raw=String(real||'').toLowerCase();if(raw.indexOf('mil')>=0)r*=1000;if(String(meta||'').toLowerCase().indexOf('mil')>=0&&Number.isFinite(m))m*=1000;out.push({date:date,turno:turn,real:Math.round(r),meta:Number.isFinite(m)?Math.round(m):0,source:'Oráculo MG4'});}
  function walk(v,ctxDate){
    if(v==null)return;
    if(Array.isArray(v)){v.forEach(function(x){walk(x,ctxDate);});return;}
    if(typeof v!=='object')return;
    const date=dateOf(v)||ctxDate||fallbackDate||'';
    const turn=String(v.turno||v.shift||v.bloco||v.turn||'').toUpperCase();
    const real=v.real??v.processed??v.processado??v.actual??v.producao_real??v.volume_real;
    const meta=v.meta??v.target??v.meta_operacao??v.operation_target;
    if(['T1','T2','T3'].indexOf(turn)>=0&&real!=null)add(date,turn,real,meta);
    ['T1','T2','T3'].forEach(function(t){const child=v[t]||v[t.toLowerCase()];if(child&&typeof child==='object'){const cr=child.real??child.processed??child.processado??child.actual??child.volume;const cm=child.meta??child.target??child.meta_operacao;if(cr!=null)add(date,t,cr,cm);}});
    Object.keys(v).forEach(function(k){if(typeof v[k]==='object')walk(v[k],date);});
  }
  walk(data,fallbackDate||'');
  return out;
}
function dedupeProducaoV63_(rows){const map={};rows.forEach(function(r){if(r.date&&r.turno&&r.real>=0)map[r.date+'|'+r.turno]=r;});return Object.keys(map).map(function(k){return map[k];}).sort(function(a,b){return a.date.localeCompare(b.date)||a.turno.localeCompare(b.turno);});}
