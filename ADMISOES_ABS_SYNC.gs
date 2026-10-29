/** COPPIT - ABS: envia somente OPSID e data_admissao; não copia CPF ou outros dados. */
function sincronizarAdmissoesMisscanMG4(){
 var props=PropertiesService.getScriptProperties(),token=props.getProperty('WEBHOOK_TOKEN');
 if(!token)throw new Error('WEBHOOK_TOKEN existente não configurado.');
 var source={spreadsheetId:'1ltU2eLkym-ERSNyzvFsK0EyvKZT5kKUiHcY6PNiOxR8',sheetId:942845654,sheet:'COPPIT - ABS',field:'data_admissao'};
 var sheet=SpreadsheetApp.openById(source.spreadsheetId).getSheetByName(source.sheet);
 if(!sheet||sheet.getSheetId()!==source.sheetId)throw new Error('Fonte ABS divergente.');
 if(String(sheet.getRange(4,5).getDisplayValue()).trim()!=='data_admissao'||String(sheet.getRange(4,15).getDisplayValue()).trim()!=='Ops ID')throw new Error('Cabeçalho ABS de admissões alterado.');
 var count=Math.min(sheet.getLastRow(),5000)-4;if(count<1)throw new Error('Cadastro vazio; anterior preservado.');
 var dates=sheet.getRange(5,5,count,1).getValues(),ids=sheet.getRange(5,15,count,1).getDisplayValues(),rows=[];
 for(var i=0;i<count;i++){var id=String(ids[i][0]||'').trim().toUpperCase();if(!/^OPS\d+$/.test(id))continue;var value=dates[i][0];rows.push({opsid:id,admissionDate:value instanceof Date?Utilities.formatDate(value,'America/Sao_Paulo','yyyy-MM-dd'):String(value||'').trim()});}
 var response=UrlFetchApp.fetch('https://dash.nicolas-pnorberto.workers.dev/api/admissions',{method:'post',contentType:'application/json',headers:{'X-Sync-Token':token},payload:JSON.stringify({source:source,rows:rows,generatedAt:new Date().toISOString()}),muteHttpExceptions:true});
 var data=JSON.parse(response.getContentText());if(response.getResponseCode()!==200||!data.ok)throw new Error(data.error||'Falha ao sincronizar admissões.');
 Logger.log('Admissões: '+data.records+' OPSIDs; '+data.conflicts+' conflito(s).');return data;
}
function instalarAdmissoesMisscanMG4(){
 sincronizarAdmissoesMisscanMG4();
 if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='sincronizarAdmissoesMisscanMG4';}))ScriptApp.newTrigger('sincronizarAdmissoesMisscanMG4').timeBased().everyMinutes(30).create();
 Logger.log('Sincronização de admissões instalada: a cada 30 minutos.');
}
