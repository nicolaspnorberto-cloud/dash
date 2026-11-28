/** Importa a LM manual como evidência unitária. Não altera totais, ofensor oficial ou bot. */
function importarValidacaoUnitariaLM(){
  var lock=LockService.getScriptLock();if(!lock.tryLock(5000))throw new Error('Outra sincronização em andamento.');
  try{
    var token=PropertiesService.getScriptProperties().getProperty('WEBHOOK_TOKEN');if(!token)throw new Error('WEBHOOK_TOKEN existente não configurado.');
    var source={spreadsheetId:'1fwe4cFmYxLgdUmTqtDa6l9lF8WKmpIXE0MCtsWlA4rA',sheet:'LM'};
    var sheet=SpreadsheetApp.openById(source.spreadsheetId).getSheetByName(source.sheet);
    var headers=['shipment_id','lmreceived_date','lmreceived_station','last_soc_name','last_status','socpacked_date','socpacked_operator','socpacked_tonumber','step_fail','process_fail','operator_fail','to_mis_status','is_misscan','is_misroute'];
    var actual=sheet.getRange(1,1,1,14).getDisplayValues()[0];headers.forEach(function(h,i){if(actual[i]!==h)throw new Error('Coluna LM divergente: '+h);});
    var grid=sheet.getRange(2,1,sheet.getLastRow()-1,14).getDisplayValues(),shards=Array.from({length:32},function(){return [];}),ignored=0,total=0;
    grid.forEach(function(values,i){
      var br=String(values[0]||'').trim().toUpperCase();if(!/^BR[A-Z0-9]+$/.test(br)){ignored++;return;}
      var hash=0;for(var j=0;j<br.length;j++)hash=(Math.imul(hash,31)+br.charCodeAt(j))>>>0;
      shards[hash%32].push({sourceRow:i+2,values:values});total++;
    });
    if(!total)throw new Error('LM sem BRs válidos; banco anterior preservado.');
    var generation=Date.now()+'-'+Utilities.getUuid().replace(/-/g,'').slice(0,8);
    function send(payload){var r=UrlFetchApp.fetch('https://dash.cop-mg4.workers.dev/api/unit-validation',{method:'post',contentType:'application/json',headers:{'X-Sync-Token':token},payload:JSON.stringify(payload),muteHttpExceptions:true}),v;try{v=JSON.parse(r.getContentText());}catch(e){throw new Error('Importação: HTTP '+r.getResponseCode());}if(r.getResponseCode()!==200||!v.ok)throw new Error(v.error||'Falha HTTP '+r.getResponseCode());return v;}
    shards.forEach(function(rows,shard){send({action:'batch',source:source,generation:generation,shard:shard,rows:rows});Logger.log('LM: partição '+(shard+1)+'/32 importada ('+rows.length+' registros).');});
    var result=send({action:'commit',generation:generation,records:total});
    Logger.log(JSON.stringify({ok:result.ok,records:result.records,ignoredNonBR:ignored,receivedAt:result.receivedAt,officialTotalsUnchanged:true}));return result;
  }finally{lock.releaseLock();}
}
