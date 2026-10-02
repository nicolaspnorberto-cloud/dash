import test from 'node:test';
import assert from 'node:assert/strict';
import { configureRuntimeEnv } from '../lib/blob-store.mjs';
import { GET } from '../api/dados.mjs';
import { readFileSync } from 'node:fs';
const baseline = JSON.parse(readFileSync(new URL('./fixtures/date-attribution-baseline.json', import.meta.url), 'utf8'));

test('consulta de período conserva atribuição e não grava cache no banco', async () => {
  const rows = [
    { shipment_id: 'TEST_A', lmreceived_date: '2026-10-01', process_fail: 'Packed TO', operator_fail: '[Ops123]PESSOA TESTE' },
    { shipment_id: 'TEST_B', lmreceived_date: '2026-10-02', process_fail: 'Extra Parcel', operator_fail: '[Ops456]OUTRA PESSOA' }
  ];
  const store = new Map([
    ['misscan/history-meta.json', { historyStart: '2026-10-01', historyEnd: '2026-10-02',
      storageGranularity: 'day-v1', days: ['2026-10-01', '2026-10-02'], updatedAt: '2026-10-02T12:00:00Z' }],
    ['misscan/hc.json', { rows: [{ colaborador: 'PESSOA TESTE', turno: 'T2' }] }],
    ['misscan/history-days/2026-10-01.json', { rows: [rows[0]] }],
    ['misscan/history-days/2026-10-02.json', { rows: [rows[1]] }]
  ]);
  let reads = 0, writes = 0;
  configureRuntimeEnv({ MISSCAN_DATA: {
    get: async key => { reads++; return structuredClone(store.get(key) ?? null); },
    put: async () => { writes++; }
  } });
  const response = await GET(new Request('https://local.invalid/api/dados?from=2026-10-02&to=2026-10-01&include_hc=0'));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result.misscan, baseline);
  assert.equal(result.meta.periodStart, '2026-10-01');
  assert.equal(result.meta.periodEnd, '2026-10-02');
  assert.equal(result.hc.length, 0);
  assert.equal(reads, 3); // índice e dois dias; nenhum snapshot de relatório.
  assert.equal(writes, 0);
});
