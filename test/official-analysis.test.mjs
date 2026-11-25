import test from 'node:test';
import assert from 'node:assert/strict';
import '../official-analysis.js';
import {normalizeDetails} from '../lib/official-details.mjs';
const {destinationModel,detailModel}=globalThis.MisscanOfficialAnalysis;
const destinations=[{destination:'HUB-LPI-01',area:'ESTEIRA',count:20},{destination:'HUB-LPI-01',area:'EXPEDIÇÃO',count:10},{destination:'HUB-LPI-02',area:'EXPEDIÇÃO',count:30},{destination:'Demais destinos',area:'EXPEDIÇÃO',count:5}];
test('destinos coalescem operações sem duplicar nomes e mantêm agrupados fora do maior nominal',()=>{
 const m=destinationModel(destinations);assert.equal(m.total,65);assert.equal(m.named.length,2);assert.equal(m.grouped,5);assert.equal(m.all.find(r=>r.name==='HUB-LPI-01').count,30);
});
test('filtro de operação muda denominador; busca de nome não recalcula share',()=>{
 const m=destinationModel(destinations,{area:'EXPEDIÇÃO',query:'lpi-01'});assert.equal(m.total,45);assert.equal(m.rows.length,1);assert.equal(m.rows[0].count,10);assert.equal(destinationModel(destinations,{area:'NA'}).total,0);
});
test('investigação busca TO, LT, BR e OPSID e filtra pelo turno HC',()=>{
 const rows=[{socpacked_tonumber:'TO123',lt_viagem:'LT456',br_examples:['BR789'],opsid:'OPS111',turno:'T2',responsabilidade:'ESTEIRA',official_count:3},{socpacked_tonumber:'TO123',lt_viagem:'LT456',br_examples:[],opsid:'OPS222',turno:'T3',responsabilidade:'EXPEDIÇÃO',official_count:8}];
 for(const query of ['TO123','LT456','BR789','OPS111'])assert.equal(detailModel(rows,{query,turn:'T2'}).length,1);
 assert.equal(detailModel(rows,{area:'EXPEDIÇÃO',turn:'T2'}).length,0);assert.equal(detailModel(rows)[0].official_count,8);
});
test('OUT_12 preserva evento oficial sem transformar BR do evento em exemplo de misscan',()=>{
 const r={soc:'MG4',station_id:'13812',data_ref:'24/11/2026',qtd_miss_scan:7,qtd_brs_distintos:7,colaborador:'[Ops111]PESSOA TESTE',is_colaborador_identificado:1,to_voando:'TO123',br_exemplo_1:'BR111',shipment_evento_atribuicao:'BR222',data_hora_evento_atribuicao:'2026-11-21 22:52:36',explicacao_atribuicao:'Texto da fonte',status_evento_atribuicao:'34',operador_evento_atribuicao:'[Ops111]PESSOA TESTE'};
 const [saved]=normalizeDetails({source:{spreadsheetId:'1nubTPlSulT2LY9ZlKkemvjyhlGlYqWIl-eyBlDVRft8',sheet:'OUT_12_COLABORADOR_LT_TO'},rows:[r]}).rows;
 assert.equal(saved.attribution_shipment,'BR222');assert.deepEqual(saved.br_examples,['BR111']);assert.equal(saved.attribution_datetime,r.data_hora_evento_atribuicao);assert.equal(saved.attribution_explanation,'Texto da fonte');assert.equal(saved.official_count,7);
});
