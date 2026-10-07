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
    props.setProperty('ABS_RECICLAGENS_LAST_SYNC',result.updatedAt);
    props.setProperty('ABS_RECICLAGENS_RECORDS',String(result.records));
    Logger.log('ABS sincronizado: '+result.records+' colaboradores; '+result.updatedAt);
    return result;
  } finally {lock.releaseLock();}
}
