import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDestinations,selectDestinations} from '../lib/official-destinations.mjs';
const source=(count=3)=>({soc:'MG4',station_id:'13812',mes_ref:'2026-10',data_semana_ini:'2026-10-12',destino_planejado:'HUB-TESTE',tipo_operacao:'Esteira',qtd_miss_scan:count});
const official={rows:[{lmreceived_date:'2026-10-12',official_count:4},{lmreceived_date:'2026-10-13',official_count:6}],destinationRows:normalizeDestinations([source(),{...source(7),tipo_operacao:'Expedição'}])};
test('destinos mantêm operações sem criar BRs nem alterar total de colaboradores',()=>{
 const result=selectDestinations(official,'2026-10-12','2026-10-13');
 assert.equal(result.available,true);assert.equal(result.rows.reduce((n,r)=>n+r.count,0),10);assert.equal(result.rows[0].destination,'HUB-TESTE');assert.equal(result.rows[1].area,'EXPEDIÇÃO');assert.equal(official.rows.length,2);
});
test('recorte parcial não recebe a quantidade da semana inteira',()=>{
 const result=selectDestinations(official,'2026-10-13','2026-10-13');assert.equal(result.rows.length,0);assert.equal(result.excludedPeriods.length,1);
});
test('carga incompatível e fonte ausente não produzem gráfico incorreto',()=>{
 assert.equal(selectDestinations({...official,destinationRows:normalizeDestinations([source(11)])},'2026-10-12','2026-10-13').rows.length,0);
 assert.equal(selectDestinations({rows:official.rows},'2026-10-12','2026-10-13').available,false);
 for(const patch of [{soc:'MG1'},{station_id:'1'},{qtd_miss_scan:-1},{qtd_miss_scan:0.5}])assert.throws(()=>normalizeDestinations([{...source(),...patch}]));
});
