import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../ABS_Reciclagens_Auto.gs', import.meta.url), 'utf8');

function fixture() {
  const properties = new Map();
  const scriptProperties = new Map([['WEBHOOK_TOKEN', 'token-ficticio']]);
  const triggers = [];
  const delays = [];
  const logs = [];
  let locked = false, busy = false, calls = 0, fail = false;
  const props = map => ({
    getProperty: key => map.get(key) ?? null,
    setProperty(key, value) { map.set(key, value); },
    deleteProperty(key) { map.delete(key); }
  });
  const context = vm.createContext({
    Logger: { log: message => logs.push(message) },
    LockService: {
      getScriptLock() { throw new Error('Carga oficial mantém ScriptLock: ABS não pode disputá-lo.'); },
      getUserLock() { return {
        tryLock() { if (busy || locked) return false; locked = true; return true; },
        releaseLock() { locked = false; }
      }; }
    },
    PropertiesService: {
      getUserProperties: () => props(properties),
      getScriptProperties: () => props(scriptProperties)
    },
    ScriptApp: {
      getProjectTriggers: () => [...triggers],
      deleteTrigger(trigger) { triggers.splice(triggers.indexOf(trigger), 1); },
      newTrigger(handler) {
        let delay;
        return {
          timeBased() { return this; },
          after(value) { delay = value; return this; },
          create() {
            delays.push(delay);
            const trigger = { getHandlerFunction: () => handler };
            triggers.push(trigger);
            return trigger;
          }
        };
      }
    }
  });
  vm.runInContext(source, context);
  const realSync = context.executarSincronizacaoABS_;
  context.executarSincronizacaoABS_ = () => {
    calls++;
    if (fail) throw new Error('Falha transitória simulada');
    return { presence: { ok: true }, roster: { ok: true } };
  };
  return {
    context, properties, triggers, delays, logs, realSync,
    setBusy: value => { busy = value; },
    setFailure: value => { fail = value; },
    get calls() { return calls; },
    get locked() { return locked; }
  };
}

test('ABS sincroniza mesmo enquanto a carga oficial detém ScriptLock', () => {
  const f = fixture();
  assert.equal(f.context.sincronizarABSReciclagens().presence.ok, true);
  assert.equal(f.calls, 1);
  assert.equal(f.locked, false);
  assert.equal(f.triggers.length, 0);
});

test('duas execuções ABS do mesmo usuário não sincronizam em paralelo', () => {
  const f = fixture();
  f.setBusy(true);
  assert.equal(f.context.sincronizarABSReciclagens().reason, 'abs-already-running');
  assert.equal(f.calls, 0);
  assert.equal(f.triggers.length, 0);
});

test('falhas geram no máximo três retentativas, após 2, 4 e 8 minutos', () => {
  const f = fixture();
  const regular = { getHandlerFunction: () => 'sincronizarABSReciclagens' };
  const other = { getHandlerFunction: () => 'sincronizarOfensoresOficiaisMG4' };
  f.triggers.push(regular, other);
  f.setFailure(true);
  assert.throws(() => f.context.sincronizarABSReciclagens(), /simulada/);
  assert.equal(f.triggers.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.throws(() => f.context.repetirSincronizacaoABSReciclagens(), /simulada/);
    assert.equal(f.locked, false);
  }
  assert.deepEqual(f.delays, [120000, 240000, 480000]);
  assert.deepEqual(f.triggers, [regular, other]);
});

test('sucesso na retentativa limpa estado e não mantém acionador temporário', () => {
  const f = fixture();
  f.setFailure(true);
  assert.throws(() => f.context.sincronizarABSReciclagens());
  f.setFailure(false);
  assert.equal(f.context.repetirSincronizacaoABSReciclagens().presence.ok, true);
  assert.equal(f.properties.has('ABS_SYNC_RETRY_COUNT'), false);
  assert.equal(f.triggers.length, 0);
});

test('novo ciclo regular substitui retentativa pendente e reinicia orçamento', () => {
  const f = fixture();
  f.setFailure(true);
  assert.throws(() => f.context.sincronizarABSReciclagens());
  assert.throws(() => f.context.repetirSincronizacaoABSReciclagens());
  assert.throws(() => f.context.sincronizarABSReciclagens());
  assert.equal(f.triggers.length, 1);
  assert.deepEqual(f.delays, [120000, 240000, 120000]);
  assert.equal(f.properties.get('ABS_SYNC_RETRY_COUNT'), '1');
});

test('presença válida é publicada antes da validação do cadastro COPPIT', () => {
  const f = fixture();
  let presenceCalled = false;
  f.context.SpreadsheetApp = { openById: () => ({
    getSheetByName() {
      assert.equal(presenceCalled, true);
      return null; // Cadastro inválido não pode impedir a presença.
    }
  }) };
  f.context.sincronizarPresencaFiscalABS_ = () => {
    presenceCalled = true;
    return { ok: true };
  };
  assert.throws(() => f.realSync(), /COPPIT - ABS não encontrada/);
  assert.equal(presenceCalled, true);
});
