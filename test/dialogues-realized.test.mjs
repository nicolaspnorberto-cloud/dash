import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDialogueDate,
  normalizeDialogueRecord,
  normalizeOpsId
} from '../lib/dialogues-realized.mjs';

test('normaliza OpsID e datas da planilha de diálogos', () => {
  assert.equal(normalizeOpsId('Ops:463058'), 'OPS463058');
  assert.equal(normalizeOpsId('475187'), 'OPS475187');
  assert.equal(normalizeDialogueDate('29/09/2026'), '2026-09-29');
});

test('aceita somente diálogo de desenvolvimento sobre Miss Scan do SOC-MG4', () => {
  const base = {
    idNC: 'abc123',
    Data: '29/09/2026',
    'Operação': 'SOC-MG4',
    'E-mail Colaborador': 'Ops430790',
    'Tipo de Diálogo': 'Desenvolvimento',
    Motivo: '[DES] Erro na expedição da carga (Miss Scan)'
  };
  assert.equal(normalizeDialogueRecord(base)?.opsid, 'OPS430790');
  assert.equal(normalizeDialogueRecord({ ...base, 'Tipo de Diálogo': 'Reconhecimento' }), null);
  assert.equal(normalizeDialogueRecord({ ...base, Motivo: '[DES] Produtividade' }), null);
});

