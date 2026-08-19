/**
 * MIS-SCAN CONTROL CENTER — BACKEND DE E-MAIL
 *
 * Script Properties obrigatórias:
 * WEBHOOK_TOKEN = token secreto compartilhado com a Vercel.
 *
 * Script Property opcional:
 * SPREADSHEET_ID = ID de uma planilha para registrar EMAIL_LOG.
 */

function doPost(e) {
  try {
    const expectedToken = PropertiesService
      .getScriptProperties()
      .getProperty('WEBHOOK_TOKEN');

    const receivedToken = String((e && e.parameter && e.parameter.token) || '');

    if (!expectedToken || receivedToken !== expectedToken) {
      return json_({ ok: false, error: 'Não autorizado.' });
    }

    const rawPayload = String((e.parameter && e.parameter.payload) || '{}');
    const payload = JSON.parse(rawPayload);

    validarPayload_(payload);

    const recipients = destinatarios_(payload);

    if (!recipients.length) {
      throw new Error(
        'Nenhum destinatário válido. Verifique o e-mail do líder e do instrutor.'
      );
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

function gerarTokenWebhook() {
  const token = (
    Utilities.getUuid() +
    Utilities.getUuid()
  ).replace(/-/g, '');

  Logger.log(token);
  return token;
}

function validarPayload_(p) {
  if (!p) throw new Error('Payload vazio.');

  if (!['DIALOGO', 'RECICLAGEM'].includes(String(p.eventType || ''))) {
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
  const emails = [
    String(p.leaderEmail || '').trim().toLowerCase(),
    String(p.instructorEmail || '').trim().toLowerCase()
  ]
    .filter(emailValido_)
    .filter(function(value, index, array) {
      return array.indexOf(value) === index;
    });

  return emails;
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
    +   '<div style="max-width:720px;margin:auto;background:#fff;border:1px solid #cfdceb;border-radius:14px;overflow:hidden">'
    +     '<div style="background:#0c223b;color:#fff;padding:18px 22px;border-bottom:3px solid #ee4d2d">'
    +       '<div style="font-size:12px;font-weight:700;color:#ff9c88">MIS-SCAN CONTROL CENTER</div>'
    +       '<div style="font-size:22px;font-weight:800;margin-top:4px">' + esc_(action) + '</div>'
    +     '</div>'
    +     '<div style="padding:22px">'
    +       linha_('Colaborador', p.collaborator || '—')
    +       linha_('Indicador', numeroPct_(p.indicator))
    +       linha_('Miss Scan', String(p.missScan || 0))
    +       linha_('Turno', p.turno || '—')
    +       linha_('Setor', p.setor || '—')
    +       linha_('Líder', p.leaderName || '—')
    +       linha_('Instrutor / responsável', p.instructorName || '—')
    +       linha_('E-mail do instrutor', p.instructorEmail || '—')
    +       linha_('Data da ação', d.date || '—')
    +       extra
    +       '<div style="margin-top:18px;padding:12px 14px;background:#eef5fd;border-radius:9px;color:#486783;font-size:12px">'
    +         'Notificação automática gerada após o registro da tratativa no Mis-Scan Control Center.'
    +       '</div>'
    +     '</div>'
    +   '</div>'
    + '</div>';
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
    'E-mail do instrutor: ' + (p.instructorEmail || '—'),
    'Data: ' + (d.date || '—'),
    p.eventType === 'DIALOGO'
      ? 'Registro: ' + (d.notes || '—')
      : 'Tema: ' + (d.topic || '—') +
        '\nCausa: ' + (d.cause || '—') +
        '\nOrientação: ' + (d.orientation || '—') +
        '\nObservações: ' + (d.notes || '—') +
        '\nEvidências: ' + (d.evidenceCount || 0)
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
  const spreadsheetId = PropertiesService
    .getScriptProperties()
    .getProperty('SPREADSHEET_ID');

  if (!spreadsheetId) return;

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
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
