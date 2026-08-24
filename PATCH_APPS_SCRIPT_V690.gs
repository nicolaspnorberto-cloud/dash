/* =========================================================
   V6.9 — FILA SIMPLES / PEDIDO ÚNICO
   Cole este bloco NO FINAL do Backend V6.8 atual.
========================================================= */

const V690_QUEUE_HANDLER = 'processarAtualizacaoV690';

function instalarAtualizacaoV690() {
  const antigos = [
    'processarFilaAtualizacaoV67',
    'processarFilaAtualizacaoV68',
    'processarFilaAtualizacaoV683',
    'processarAtualizacaoV690'
  ];

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (antigos.indexOf(trigger.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  PropertiesService
    .getScriptProperties()
    .deleteProperty('V68_QUEUE_RUNNING_AT');

  ScriptApp.newTrigger(V690_QUEUE_HANDLER)
    .timeBased()
    .everyMinutes(1)
    .create();

  Logger.log(
    'V6.9 instalada: pedido único verificado a cada 1 minuto.'
  );
}

function processarAtualizacaoV690() {
  validarConfiguracaoV6_();

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(3000)) {
    Logger.log('V6.9: outra atualização já está em execução.');
    return;
  }

  let itemId = '';

  try {
    const response = v6Fetch_('/api/refresh-queue', {
      method: 'get',
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    const text = response.getContentText();

    Logger.log('V6.9 FILA HTTP ' + code);
    Logger.log(text);

    if (code !== 200) {
      throw new Error(
        'Pedido de atualização retornou ' + code + ': ' + text
      );
    }

    const data = JSON.parse(text);
    const item = data.item || null;

    if (!item || !item.id) {
      const latest = data.latest || null;

      if (latest) {
        Logger.log(
          'V6.9: nenhum PENDING. Último pedido: ' +
          String(latest.id || '') +
          ' | status=' +
          String(latest.status || '')
        );
      } else {
        Logger.log('V6.9: nenhum pedido criado ainda.');
      }

      return;
    }

    itemId = item.id;

    Logger.log(
      'V6.9: processando ' +
      item.id +
      ' | ' +
      String(item.from || '—') +
      ' -> ' +
      String(item.to || '—')
    );

    atualizarStatusFilaV67_(item.id, {
      status: 'RUNNING',
      startedAt: new Date().toISOString()
    });

    const action = String(item.action || 'all').toLowerCase();

    const result = {
      lm: 'SKIPPED',
      gerot: 'SKIPPED',
      lmStats: null,
      errors: []
    };

    if (action === 'all' || action === 'lm') {
      try {
        const lmResult = sincronizarHCeMisscanAgoraV68_(
          item.from,
          item.to
        );

        result.lm = 'OK';
        result.lmStats = lmResult.stats || null;

        Logger.log(
          'V6.9 LM OK: ' +
          JSON.stringify(result.lmStats)
        );

      } catch (error) {
        result.lm = 'ERROR';
        result.errors.push(
          'LM: ' + String(error.message || error)
        );
      }
    }

    if (action === 'all' || action === 'gerot') {
      try {
        sincronizarGerotV65();
        result.gerot = 'OK';
      } catch (error) {
        result.gerot = 'ERROR';
        result.errors.push(
          'GEROT: ' + String(error.message || error)
        );
      }
    }

    const finalStatus =
      result.errors.length === 0
        ? 'DONE'
        : (
            (result.lm === 'OK' || result.gerot === 'OK')
              ? 'PARTIAL'
              : 'ERROR'
          );

    atualizarStatusFilaV67_(item.id, {
      status: finalStatus,
      finishedAt: new Date().toISOString(),
      result: result,
      error: result.errors.join(' | ')
    });

    Logger.log(
      'V6.9 FINAL: ' +
      finalStatus +
      ' | ' +
      JSON.stringify(result)
    );

    return result;

  } catch (error) {
    Logger.log(
      'V6.9 ERRO: ' +
      String(error.message || error)
    );

    if (itemId) {
      try {
        atualizarStatusFilaV67_(itemId, {
          status: 'ERROR',
          finishedAt: new Date().toISOString(),
          error: String(error.message || error)
        });
      } catch (_) {}
    }

    throw error;

  } finally {
    lock.releaseLock();
  }
}

function diagnosticarAtualizacaoV690() {
  const response = v6Fetch_('/api/refresh-queue', {
    method: 'get',
    muteHttpExceptions: true
  });

  const result = {
    http: response.getResponseCode(),
    body: response.getContentText()
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Mantido para correção imediata de 21/08.
 */
function forcarLM21082026V690() {
  const result = sincronizarHCeMisscanAgoraV68_(
    '2026-08-21',
    '2026-08-21'
  );

  Logger.log(JSON.stringify(result, null, 2));

  if (Number(result?.stats?.uniqueRows || 0) !== 3510) {
    throw new Error(
      'Esperado 3510 BR únicos; encontrado ' +
      String(result?.stats?.uniqueRows || 0)
    );
  }

  Logger.log(
    'V6.9 OK: 21/08/2026 enviado com 3510 BR únicos.'
  );

  return result;
}
