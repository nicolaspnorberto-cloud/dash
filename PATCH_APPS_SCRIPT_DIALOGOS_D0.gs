/* =========================================================
   DIÁLOGOS DE PERFORMANCE D-0 — SOC MG4
   Cole este bloco no final do Apps Script atual do dashboard.
========================================================= */

const DIALOGOS_D0_SPREADSHEET_ID = '1FcE0aiNzk4UZU5p0uGPikm8WWBrvpupF6_uBu-gLGd4';
const DIALOGOS_D0_SHEET = 'Sheet1';
const DIALOGOS_D0_HANDLER = 'sincronizarDialogosPerformanceD0';

function instalarSincronizacaoDialogosD0() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === DIALOGOS_D0_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger(DIALOGOS_D0_HANDLER)
    .timeBased()
    .everyMinutes(5)
    .create();

  const result = sincronizarDialogosPerformanceD0();
  Logger.log('Diálogos D-0 instalados: ' + JSON.stringify(result));
  return result;
}

function sincronizarDialogosPerformanceD0() {
  validarConfiguracaoV6_();

  const ss = SpreadsheetApp.openById(DIALOGOS_D0_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(DIALOGOS_D0_SHEET);
  if (!sheet) throw new Error('Aba "' + DIALOGOS_D0_SHEET + '" não encontrada.');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, dateKey: '', records: 0 };

  const tz = Session.getScriptTimeZone() || 'America/Sao_Paulo';
  const now = new Date();
  const displayDate = Utilities.formatDate(now, tz, 'dd/MM/yyyy');
  const dateKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  const values = sheet.getRange(1, 1, lastRow, 16).getDisplayValues();
  const headers = values[0].map(function(value) { return String(value || '').trim(); });
  const indexes = {};
  headers.forEach(function(header, index) { indexes[header] = index; });

  const required = [
    'idNC', 'Data', 'Operação', 'Nome Gestor', 'E-mail Colaborador',
    'Tipo de Diálogo', 'Motivo', 'Este diálogo é reincidente?'
  ];
  required.forEach(function(header) {
    if (indexes[header] == null) throw new Error('Coluna obrigatória ausente: ' + header);
  });

  function norm_(value) {
    return String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ').trim().toUpperCase();
  }

  const records = values.slice(1).filter(function(row) {
    const reason = norm_(row[indexes['Motivo']]).replace(/[^A-Z0-9]+/g, ' ');
    return String(row[indexes['Data']] || '').trim() === displayDate &&
      norm_(row[indexes['Operação']]) === 'SOC-MG4' &&
      norm_(row[indexes['Tipo de Diálogo']]) === 'DESENVOLVIMENTO' &&
      /\bMISS\s*SCAN\b/.test(reason);
  }).map(function(row) {
    return {
      idNC: row[indexes['idNC']],
      dateKey: dateKey,
      operation: row[indexes['Operação']],
      manager: row[indexes['Nome Gestor']],
      collaboratorId: row[indexes['E-mail Colaborador']],
      dialogueType: row[indexes['Tipo de Diálogo']],
      reason: row[indexes['Motivo']],
      recurrent: row[indexes['Este diálogo é reincidente?']],
      hasSignature: Boolean(String(row[8] || '').trim())
    };
  });

  const response = v6Fetch_('/api/dialogues-sync', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ dateKey: dateKey, records: records }),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Diálogos D-0 retornou HTTP ' + code + ': ' + text);
  }
  const result = JSON.parse(text);
  if (!result.ok) throw new Error(result.error || 'Falha ao sincronizar diálogos D-0.');
  PropertiesService.getScriptProperties().setProperty('DIALOGOS_D0_LAST_SYNC', new Date().toISOString());
  return result;
}

