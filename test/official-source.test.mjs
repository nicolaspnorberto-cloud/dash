import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOfficial,OFFICIAL_SHEET,MATINAL_SHEET,OFFICIAL_PATH} from '../lib/official-source.mjs';
import {configureRuntimeEnv} from '../lib/blob-store.mjs';
import {GET} from '../api/dados.mjs';
import {buildDialogueStatusRows} from '../lib/seatalk-reminders.mjs';
const row={data_ref:'2026-10-13',soc:'MG4',station_id:'13812',colaborador:'[OPS123]PESSOA TESTE',is_colaborador_identificado:'1',tipo_operacao:'Expedição',qtd_miss_scan:12,turno:'T1'};
const body=()=>({source:{spreadsheetId:OFFICIAL_SHEET,sheet:'OUT_05_COLABORADOR_DIA'},hcSource:{spreadsheetId:MATINAL_SHEET,sheet:'Base de HC 26'},rows:[row,{...row,turno:'T2',qtd_miss_scan:8},{...row,colaborador:'Not Identified',is_colaborador_identificado:'0',qtd_miss_scan:80}],hc:[{colaborador:'PESSOA TESTE',opsid:'OPS123',turno:'T3',setor:'Outbound',lider_nome:'Líder HC'}]});
test('consolida quantidades oficiais sem usar turno externo nem criar BRs',()=>{
 const data=normalizeOfficial(body());assert.equal(data.rows.length,2);assert.equal(data.meta.historyRows,100);assert.equal(data.rows[0].official_count,20);assert.equal(data.rows[0].process_fail,'Expedição');assert.equal(data.rows[0].shipment_id,'');assert.equal(data.rows[0].turno,undefined);
 const [person]=buildDialogueStatusRows({misscan:data.rows,hc:data.hc,targetTurn:'T3'});assert.equal(person.missScan,20);assert.equal(person.indicator,20);assert.equal(person.turn,'T3');
 assert.equal(buildDialogueStatusRows({misscan:data.rows,hc:data.hc,targetTurn:'T2'}).length,0);
});
test('rejeita outro SOC, outra fonte e quantidades inválidas',()=>{
 for(const patch of [{soc:'SP24'},{station_id:'15002'},{qtd_miss_scan:-1},{qtd_miss_scan:1.2}]){const input=body();input.rows=[{...row,...patch}];assert.throws(()=>normalizeOfficial(input));}
});
test('API entrega a fonte oficial agregada e HC Matinal no período solicitado',async()=>{
 const data=normalizeOfficial(body());configureRuntimeEnv({MISSCAN_DATA:{get:async key=>key===OFFICIAL_PATH?data:null}});
 const result=await (await GET(new Request('https://test/api/dados?from=2026-10-13&to=2026-10-13'))).json();
 assert.equal(result.meta.official,true);assert.equal(result.misscan[0].process_fail,'Expedição');assert.equal(result.hc[0].turno,'T3');assert.equal(result.misscan.reduce((sum,r)=>sum+r.official_count,0),100);
 const empty=await (await GET(new Request('https://test/api/dados?from=2026-10-12&to=2026-10-12'))).json();assert.equal(empty.misscan.length,0);
});

test('rótulos de Process Fail cobrem as três categorias oficiais',()=>{
 const input=body();input.rows=['Esteira','Expedição','Padrão'].map(tipo_operacao=>({...row,tipo_operacao}));
 assert.deepEqual(normalizeOfficial(input).rows.map(r=>r.process_fail),['Esteira','Expedição','Padrão/Não identificado']);
});
