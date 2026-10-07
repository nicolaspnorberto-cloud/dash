/** Sincronização privada COPPIT - ABS → dashboard Cloudflare. */
function instalarSincronizacaoABSReciclagens() {
  sincronizarABSReciclagens();
  var handlers = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === 'sincronizarABSReciclagens';
  });
  if (!handlers.length) {
    ScriptApp.newTrigger('sincronizarABSReciclagens').timeBased().everyMinutes(30).create();
  }
  Logger.log('ABS: sincronização inicial concluída; atualização automática a cada 30 minutos.');
}

function sincronizarABSReciclagens() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Outra sincronização em andamento. Tente novamente.');
  try {
    var props = PropertiesService.getScriptProperties();
    var token = String(props.getProperty('WEBHOOK_TOKEN') || '').trim();
    if (!token) throw new Error('WEBHOOK_TOKEN não configurado no projeto existente.');
    var source = {spreadsheetId:'1ltU2eLkym-ERSNyzvFsK0EyvKZT5kKUiHcY6PNiOxR8',sheetId:942845654,sheet:'COPPIT - ABS'};
    var ss = SpreadsheetApp.openById(source.spreadsheetId);
    var sheet = ss.getSheetByName(source.sheet);
    if (!sheet || sheet.getSheetId() !== source.sheetId) throw new Error('Aba COPPIT - ABS não encontrada.');
    var header = sheet.getRange(4,1,1,15).getDisplayValues()[0];
    [[2,'Colaborador'],[6,'Turno'],[10,'Setor'],[13,'lider'],[14,'Ops ID']].forEach(function(h){
      if(String(header[h[0]]).trim().toLowerCase() !== h[1].toLowerCase()) throw new Error('Colunas do ABS alteradas. Revise o cabeçalho antes de sincronizar.');
    });
    var count = Math.min(sheet.getLastRow(),5000)-4;
    if(count<1)throw new Error('Lista ABS vazia. A lista anterior será preservada.');
    var columns = [3,7,11,14,15].map(function(col){return sheet.getRange(5,col,count,1).getDisplayValues();});
    var seen = {}, rows=[];
    for(var i=0;i<count;i++){
      var name=String(columns[0][i][0]||'').trim();if(!name)continue;
      var opsid=String(columns[4][i][0]||'').trim().toUpperCase();
      if(!/^OPS\d+$/.test(opsid))throw new Error('OPSID inválido na linha '+(i+5)+'. Lista anterior preservada.');
      if(seen[opsid])throw new Error('OPSID duplicado na linha '+(i+5)+'. Lista anterior preservada.');
      seen[opsid]=true;
      rows.push({name:name,opsid:opsid,shift:String(columns[1][i][0]||'').trim(),sector:String(columns[2][i][0]||'').trim(),leader:String(columns[3][i][0]||'').trim()});
    }
    if(!rows.length)throw new Error('Nenhum colaborador válido. Lista anterior preservada.');
    var response = UrlFetchApp.fetch('https://dash.nicolas-pnorberto.workers.dev/api/training-sync',{
      method:'post',contentType:'application/json',headers:{'X-Sync-Token':token},
      payload:JSON.stringify({rows:rows,source:source,generatedAt:new Date().toISOString()}),muteHttpExceptions:true
    });
    var result;try{result=JSON.parse(response.getContentText());}catch(e){throw new Error('Resposta inválida do dashboard. HTTP '+response.getResponseCode());}
    if(response.getResponseCode()>=300||!result.ok)throw new Error(result.error||'Falha ao sincronizar ABS.');
    var presenceResult = sincronizarPresencaFiscalABS_(ss, token);
    props.setProperty('ABS_RECICLAGENS_LAST_SYNC',result.updatedAt);
    props.setProperty('ABS_RECICLAGENS_RECORDS',String(result.records));
    Logger.log('ABS sincronizado: '+result.records+' colaboradores; '+result.updatedAt);
    return {roster:result,presence:presenceResult};
  } finally {lock.releaseLock();}
}

/** Usa a data efetiva do cabeçalho, nunca a posição fixa do dia do mês. */
function sincronizarPresencaFiscalABS_(ss, token) {
  var source = {spreadsheetId:'1ltU2eLkym-ERSNyzvFsK0EyvKZT5kKUiHcY6PNiOxR8',sheetId:1890690219,sheet:'ABS'};
  var sheet = ss.getSheetByName(source.sheet);
  if (!sheet || sheet.getSheetId() !== source.sheetId) throw new Error('Aba ABS de presença não encontrada.');
  var day = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
  var width = sheet.getLastColumn();
  var dates = sheet.getRange(4,1,1,width).getValues()[0];
  var labels = sheet.getRange(4,1,1,width).getDisplayValues()[0];
  if (String(labels[14]).trim().toLowerCase() !== 'ops id') throw new Error('Coluna Ops ID do ABS alterada.');
  var dateCols = [];
  dates.forEach(function(value,index) {
    // As datas diárias ficam depois da coluna de referência U.
    if(index >= 21 && value instanceof Date && Utilities.formatDate(value, 'America/Sao_Paulo','yyyy-MM-dd') === day) dateCols.push(index+1);
  });
  if(dateCols.length !== 1) throw new Error('Data atual ausente ou duplicada no cabeçalho ABS. Presença anterior não será atualizada.');
  var disabledIndex = labels.map(function(v){return String(v).trim().toLowerCase();}).indexOf('desligado');
  if(disabledIndex < 0) throw new Error('Coluna Desligado do ABS não encontrada.');
  var count = sheet.getLastRow()-4;
  if(count < 1 || count > 10000) throw new Error('Quantidade de linhas de presença inválida.');
  // Somente identificação e presença; CPF e outros dados pessoais não são enviados.
  var names=sheet.getRange(5,3,count,1).getDisplayValues();
  var ids=sheet.getRange(5,15,count,1).getDisplayValues();
  var codes=sheet.getRange(5,dateCols[0],count,1).getDisplayValues();
  var disabled=sheet.getRange(5,disabledIndex+1,count,1).getDisplayValues();
  var seen={},rows=[];
  for(var i=0;i<count;i++) {
    if(!String(names[i][0]||'').trim()) continue;
    var id=String(ids[i][0]||'').trim().toUpperCase();
    if(!/^OPS\d+$/.test(id) || seen[id]) throw new Error('OPSID inválido ou duplicado na presença ABS: linha '+(i+5));
    seen[id]=true;
    var disabledValue=String(disabled[i][0]||'').trim().toLowerCase();
    // Qualquer marca não reconhecida nesta coluna impede confirmação de presença.
    rows.push({opsid:id,status:String(codes[i][0]||'').trim(),disabled: !['','não','nao','false','0'].includes(disabledValue)});
  }
  var response = UrlFetchApp.fetch('https://dash.nicolas-pnorberto.workers.dev/api/presence-sync', {
    method:'post',contentType:'application/json',headers:{'X-Sync-Token':token},
    payload:JSON.stringify({source:source,dateKey:day,generatedAt:new Date().toISOString(),rows:rows}),muteHttpExceptions:true
  });
  var result;try{result=JSON.parse(response.getContentText());}catch(e){throw new Error('Resposta inválida da presença: HTTP '+response.getResponseCode());}
  if(response.getResponseCode()>=300||!result.ok)throw new Error(result.error||'Falha ao sincronizar presença.');
  PropertiesService.getScriptProperties().setProperty('ABS_PRESENCA_LAST_SYNC',result.updatedAt);
  return result;
}

/** Diagnóstico somente leitura: nunca envia mensagem ao grupo. */
function validarPresencaFiscalABS() {
  var response = UrlFetchApp.fetch('https://dash.nicolas-pnorberto.workers.dev/api/seatalk', {muteHttpExceptions:true});
  var result = JSON.parse(response.getContentText());
  if(response.getResponseCode() !== 200 || !result.ok || !result.dailyReminder.presence.required || !result.presenceSync.available) {
    throw new Error('Presença do fiscal não está pronta: '+JSON.stringify(result.presenceSync || {}));
  }
  Logger.log('Fiscal validado: presença ABS de '+result.presenceSync.dateKey+' disponível; sincronizada em '+result.presenceSync.generatedAt+'. Cobrança exige presença confirmada por OPSID.');
  return result.presenceSync;
}
