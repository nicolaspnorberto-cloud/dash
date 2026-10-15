/** Fonte dos ofensores: oficial OUT_05 MG4; cadastro/turno: HC Matinal. */
function sincronizarOfensoresOficiaisMG4(){
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(5000))throw new Error('Outra sincronização em andamento; próxima execução tentará novamente.');
  try{
    var token=PropertiesService.getScriptProperties().getProperty('WEBHOOK_TOKEN');
    if(!token)throw new Error('WEBHOOK_TOKEN existente não configurado.');
    var officialId='1nubTPlSulT2LY9ZlKkemvjyhlGlYqWIl-eyBlDVRft8';
    var hcId='1fwe4cFmYxLgdUmTqtDa6l9lF8WKmpIXE0MCtsWlA4rA';
    var sheet=SpreadsheetApp.openById(officialId).getSheetByName('OUT_05_COLABORADOR_DIA');
    if(!sheet)throw new Error('OUT_05 não encontrada.');
    var width=sheet.getLastColumn(),last=sheet.getLastRow();
    var headers=sheet.getRange(1,1,1,width).getDisplayValues()[0];
    var required=['data_ref','soc','station_id','colaborador','is_colaborador_identificado','tipo_operacao','qtd_miss_scan'];
    var ix={};required.forEach(function(k){ix[k]=headers.indexOf(k);if(ix[k]<0)throw new Error('Coluna oficial ausente: '+k);});
    var hits=sheet.getRange(2,ix.soc+1,last-1,1).createTextFinder('MG4').matchEntireCell(true).matchCase(true).useRegularExpression(false).findAll().map(function(r){return r.getRow();}).sort(function(a,b){return a-b;});
    var blocks=[];hits.forEach(function(n){var p=blocks[blocks.length-1];if(p&&n-p.end<=6&&n-p.start<1500)p.end=n;else blocks.push({start:n,end:n});});
    var rows=[];blocks.forEach(function(block){sheet.getRange(block.start,1,block.end-block.start+1,width).getValues().forEach(function(line){
      if(String(line[ix.soc]).trim()!=='MG4')return;
      var row={};required.forEach(function(k){var v=line[ix[k]];row[k]=v instanceof Date?Utilities.formatDate(v,'America/Sao_Paulo','yyyy-MM-dd'):v;});rows.push(row);
    });});
    var hs=SpreadsheetApp.openById(hcId).getSheetByName('Base de HC 26');
    if(!hs)throw new Error('Base HC Matinal ausente.');
    var head=hs.getRange(3,1,1,6).getDisplayValues()[0];
    if(String(head[0]).trim().toLowerCase()!=='colaborador'||String(head[5]).trim().toUpperCase()!=='OPSID')throw new Error('Cabeçalho HC mudou.');
    var hc=hs.getRange(4,1,hs.getLastRow()-3,6).getDisplayValues().filter(function(r){return String(r[0]).trim();}).map(function(r){return{colaborador:r[0],turno:r[1],setor:r[2],lider_email:r[3],lider_nome:r[4],opsid:r[5]};});
    var weeklyRows=lerRankingOficialMG4_(officialId);
    var payload={source:{spreadsheetId:officialId,sheet:'OUT_05_COLABORADOR_DIA'},hcSource:{spreadsheetId:hcId,sheet:'Base de HC 26'},rows:rows,hc:hc,weeklyRows:weeklyRows};
    var response=UrlFetchApp.fetch('https://dash.nicolas-pnorberto.workers.dev/api/official-sync',{method:'post',contentType:'application/json',headers:{'X-Sync-Token':token},payload:JSON.stringify(payload),muteHttpExceptions:true});
    var result=JSON.parse(response.getContentText());
    if(response.getResponseCode()!==200||!result.ok)throw new Error(result.error||'Falha na sincronização oficial.');
    Logger.log('Ofensores oficiais MG4: '+result.records+' grupos diários; '+result.meta.historyRows+' ocorrências. HC exclusivamente Matinal: '+result.hc+'.');
    PropertiesService.getScriptProperties().setProperty('OFICIAL_MG4_LAST_SYNC',result.meta.receivedAt);
    return result;
  }finally{lock.releaseLock();}
}
function instalarOfensoresOficiaisMG4(){
  sincronizarOfensoresOficiaisMG4();
  if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='sincronizarOfensoresOficiaisMG4';}))ScriptApp.newTrigger('sincronizarOfensoresOficiaisMG4').timeBased().everyHours(1).create();
}

// Sem turno externo: cadastro e turno continuam exclusivamente na HC Matinal.
function lerRankingOficialMG4_(spreadsheetId){
  var sheet=SpreadsheetApp.openById(spreadsheetId).getSheetByName('OUT_04_COLABORADOR_RANK');
  if(!sheet)throw new Error('OUT_04 não encontrada.');
  var width=sheet.getLastColumn(),last=sheet.getLastRow();
  var headers=sheet.getRange(1,1,1,width).getDisplayValues()[0];
  var required=['mes_ref','data_semana_ini','soc','station_id','colaborador','qtd_miss_scan','miss_esteira','miss_expedicao','miss_padrao'];
  var ix={};required.forEach(function(k){ix[k]=headers.indexOf(k);if(ix[k]<0)throw new Error('Coluna OUT_04 ausente: '+k);});
  var hits=sheet.getRange(2,ix.soc+1,last-1,1).createTextFinder('MG4').matchEntireCell(true).matchCase(true).useRegularExpression(false).findAll().map(function(r){return r.getRow();}).sort(function(a,b){return a-b;});
  var blocks=[];hits.forEach(function(n){var p=blocks[blocks.length-1];if(p&&n-p.end<=6&&n-p.start<1000)p.end=n;else blocks.push({start:n,end:n});});
  var rows=[];blocks.forEach(function(block){sheet.getRange(block.start,1,block.end-block.start+1,width).getValues().forEach(function(line){
    if(String(line[ix.soc]).trim()!=='MG4')return;
    var row={};required.forEach(function(k){var v=line[ix[k]];row[k]=v instanceof Date?Utilities.formatDate(v,'America/Sao_Paulo',k==='mes_ref'?'yyyy-MM':'yyyy-MM-dd'):v;});rows.push(row);
  });});
  return rows;
}
