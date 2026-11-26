/** Produção individual: somente leitura da planilha de produtividade. */
function montarProducaoIndividualMG4_(){
  var book=SpreadsheetApp.openById('149QIaAKlVpq28Nm_zPYMb3l0n8LY2ssUpLRC5ShatD8');
  var today=Utilities.formatDate(new Date(),'America/Sao_Paulo','yyyy-MM-dd');
  var payload=consolidarProducaoIndividualMG4_(book,today);
  payload.productionOnly=true;
  payload.source='produtividade hc esteiras | prod_hist + prod_d0 | packing por OPSID/data';
  payload.unit='BIPES';
  return payload;
}
function consolidarProducaoIndividualMG4_(book,today){
  var byDay={};
  ['prod_hist','prod_d0'].forEach(function(tab){
    var sheet=book.getSheetByName(tab);if(!sheet)throw new Error('Aba de produção ausente: '+tab);
    var grid=sheet.getDataRange().getValues();if(grid.length<2)throw new Error('Produção vazia: '+tab);
    var headers=grid[0].map(function(v){return String(v).trim();}),ix={};
    ['date','station_name','workstation_id','_hour','operator_id','packing'].forEach(function(k){ix[k]=headers.indexOf(k);if(ix[k]<0)throw new Error('Coluna ausente: '+tab+'/'+k);});
    var records={},localDays={};
    grid.slice(1).forEach(function(r){
      if(!r.some(function(v){return v!==''&&v!==null;}))return;
      if(String(r[ix.station_name]).trim()!=='SoC_MG_Contagem_Industrial')return;
      var raw=r[ix.date],day=raw instanceof Date?Utilities.formatDate(raw,'America/Sao_Paulo','yyyy-MM-dd'):String(raw).slice(0,10);
      var id=String(r[ix.operator_id]||'').trim().toUpperCase(),bipes=Number(r[ix.packing]);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^OPS\d+$/.test(id)||!Number.isSafeInteger(bipes)||bipes<0||r[ix.packing]==='')throw new Error('Registro de produção inválido em '+tab+'.');
      var hour=r[ix._hour] instanceof Date?Utilities.formatDate(r[ix._hour],'America/Sao_Paulo','yyyy-MM-dd HH:mm:ss'):String(r[ix._hour]).trim();
      var ws=String(r[ix.workstation_id]).trim();if(!hour||!ws)throw new Error('Hora/posto ausente em '+tab+'.');
      var key=[day,ws,hour,id].join('|');if(Object.prototype.hasOwnProperty.call(records,key)){if(records[key].bipes!==bipes)throw new Error('Produção conflitante para OPSID/posto/hora em '+tab+'.');return;}
      records[key]={date:day,opsid:id,bipes:bipes};localDays[day]=true;
    });
    // D0 substitui a mesma data do histórico; nunca somar snapshots sobrepostos.
    Object.keys(localDays).forEach(function(day){byDay[day]={};});
    Object.keys(records).forEach(function(key){var r=records[key],group=byDay[r.date];if(!group[r.opsid])group[r.opsid]={date:r.date,opsid:r.opsid,bipes:0};group[r.opsid].bipes+=r.bipes;});
  });
  var rows=[],allDays=Object.keys(byDay).sort();allDays.forEach(function(day){Object.keys(byDay[day]).sort().forEach(function(id){rows.push(byDay[day][id]);});});
  if(!rows.length)throw new Error('Nenhuma produção válida encontrada.');
  return {rows:rows,days:allDays.filter(function(day){return day<today;}),partialDays:allDays.filter(function(day){return day>=today;})};
}
function validarProducaoIndividualMG4(){
  var p=montarProducaoIndividualMG4_(),totals={};p.rows.forEach(function(r){if(!totals[r.date])totals[r.date]={bipes:0,pessoas:0};totals[r.date].bipes+=r.bipes;totals[r.date].pessoas++;});
  Logger.log(JSON.stringify({validado:true,envioRealizado:false,porDia:totals,diasFechados:p.days,diasParciais:p.partialDays}));
}
function sincronizarProducaoIndividualMG4(){
  var lock=LockService.getScriptLock();if(!lock.tryLock(5000))throw new Error('Outra sincronização em andamento.');
  try{
    var token=PropertiesService.getScriptProperties().getProperty('WEBHOOK_TOKEN');if(!token)throw new Error('WEBHOOK_TOKEN existente não configurado.');
    var payload=montarProducaoIndividualMG4_();
    var response=UrlFetchApp.fetch('https://dash.cop-mg4.workers.dev/api/operator-volume',{method:'post',contentType:'application/json',headers:{'X-Sync-Token':token},payload:JSON.stringify(payload),muteHttpExceptions:true});
    var result;try{result=JSON.parse(response.getContentText());}catch(e){throw new Error('Endpoint de produção não disponível: HTTP '+response.getResponseCode());}
    if(response.getResponseCode()!==200||!result.ok)throw new Error(result.error||'Falha ao sincronizar produção: HTTP '+response.getResponseCode());
    Logger.log('Produção individual sincronizada: '+result.rows+' linhas. Atualizada em '+result.updatedAt);return result;
  }finally{lock.releaseLock();}
}
function instalarProducaoIndividualMG4(){
  sincronizarProducaoIndividualMG4();
  var exists=ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='sincronizarProducaoIndividualMG4';});
  if(!exists)ScriptApp.newTrigger('sincronizarProducaoIndividualMG4').timeBased().everyMinutes(10).create();
  Logger.log('Produção individual: sincronização periódica configurada a cada 10 minutos.');
}
