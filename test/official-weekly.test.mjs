import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {buildOfficialWeeklyDetails,individualizeOfficialPeriod,prepareOfficialDisplayRow} from '../lib/official-weekly.mjs';
import {normalizeOfficial,OFFICIAL_SHEET,MATINAL_SHEET,OFFICIAL_PATH} from '../lib/official-source.mjs';
import {configureRuntimeEnv} from '../lib/blob-store.mjs';
import {GET} from '../api/dados.mjs';
import '../date-loader.js';
const row=(date,name,count,area='Esteira')=>({data_ref:date,soc:'MG4',station_id:'13812',colaborador:name,is_colaborador_identificado:'1',tipo_operacao:area,qtd_miss_scan:count});
function fixture(){return normalizeOfficial({source:{spreadsheetId:OFFICIAL_SHEET,sheet:'OUT_05_COLABORADOR_DIA'},hcSource:{spreadsheetId:MATINAL_SHEET,sheet:'Base de HC 26'},rows:[row('2026-10-12','[OPS1]MARIA',5),row('2026-10-12','Demais colaboradores',10),row('2026-10-13','Demais colaboradores',8)],hc:[{colaborador:'MARIA',opsid:'OPS1',turno:'T5'},{colaborador:'JOAO',opsid:'OPS2',turno:'T4'}]});}
const rank=(name,count)=>({mes_ref:'2026-10',data_semana_ini:'2026-10-12',soc:'MG4',station_id:'13812',colaborador:name,qtd_miss_scan:count,miss_esteira:count,miss_expedicao:0,miss_padrao:0});
const rankings=()=>[rank('[OPS1]MARIA',9),rank('OPS2',6),rank('Demais colaboradores',8)];
test('individualiza somente o período inteiro, preservando totais e sem inventar dia',()=>{
 const data=fixture(),details=buildOfficialWeeklyDetails(data,rankings());
 const result=individualizeOfficialPeriod(data,'2026-10-12','2026-10-13',details);
 assert.equal(result.meta.recoveredOccurrences,10);assert.equal(result.meta.remainingGrouped,8);
 assert.equal(result.rows.reduce((n,r)=>n+r.official_count,0),23);
 const joao=result.rows.find(r=>r.operator_fail==='[OPS2]JOAO');assert.equal(joao.lmreceived_date,'');assert.equal(joao.official_period_start,'2026-10-12');assert.equal(joao.official_period_end,'2026-10-13');
 for(const [from,to]of[['2026-10-12','2026-10-12'],['2026-10-13','2026-10-13']])assert.equal(individualizeOfficialPeriod(data,from,to,details).meta.recoveredOccurrences,0);
});
test('rejeita ranking divergente, redistribuição entre áreas e snapshot antigo',()=>{
 const data=fixture();assert.equal(buildOfficialWeeklyDetails(data,[rank('JOAO',24)]).periods.length,0);
 const wrong=rankings();wrong[0].miss_esteira=8;wrong[0].miss_expedicao=1;assert.equal(buildOfficialWeeklyDetails(data,wrong).periods.length,0);
 const details=buildOfficialWeeklyDetails(data,rankings());data.rows[0].operator_fail='[OPS3]OUTRO';data.rows[0].official_collaborator='[OPS3]OUTRO';assert.equal(individualizeOfficialPeriod(data,'2026-10-12','2026-10-13',details).meta.recoveredOccurrences,0);
 assert.throws(()=>buildOfficialWeeklyDetails(fixture(),[{...rank('MARIA',23),soc:'SP1'}]));
});
test('API mantém dados diários para tratativas e fornece detalhe separado sob demanda',async()=>{
 const data=fixture();data.weeklyDetails=buildOfficialWeeklyDetails(data,rankings());configureRuntimeEnv({MISSCAN_DATA:{get:async key=>key===OFFICIAL_PATH?data:null}});
 const daily=await(await GET(new Request('https://test/api/dados?from=2026-10-12&to=2026-10-13'))).json();assert.equal(daily.individualizedRows,undefined);assert.equal(daily.misscan.length,3);assert.equal(daily.misscan[1].official_grouped,true);
 const result=await(await GET(new Request('https://test/api/dados?from=2026-10-12&to=2026-10-13&individualize=1'))).json();assert.equal(result.meta.individualization.recoveredOccurrences,10);assert.deepEqual(result.misscan,daily.misscan);assert.equal(result.individualizedRows.reduce((s,r)=>s+r.official_count,0),23);
});
test('turnos seguem HC; grupo não é pessoa; totais semanais não alimentam cobrança diária',()=>{
 const get=()=>({value:'',innerHTML:'',textContent:''});const context=vm.createContext({window:{},MisscanDateLoader:globalThis.MisscanDateLoader,document:{getElementById:get},localStorage:{getItem(){return null;}},Intl,Map,Set,Date,Number,String,Math,AbortController,DOMException,setTimeout,clearTimeout,console});
 const run=code=>vm.runInContext(code,context);run(readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/boot\(\);\s*$/,''));
 const data=fixture(),detail=individualizeOfficialPeriod(data,'2026-10-12','2026-10-13',buildOfficialWeeklyDetails(data,rankings()));
 context.data=data;context.detail=detail;run(`buildHCMap(data.hc);state.liveMeta={official:true,periodStart:'2026-10-12',periodEnd:'2026-10-13'};state.raw=detail.rows.map(enrich);state.filtered=state.raw;state.dailyRaw=data.rows.map(enrich);`);
 const people=JSON.parse(run('JSON.stringify(ranking().map(r=>({name:r.name,turno:dominant(r.turnos),q:metricCount(r.br)})))'));
 assert.deepEqual(people,[{name:'MARIA',turno:'T3',q:9},{name:'JOAO',turno:'T2',q:6}]);
 assert.equal(run('hcPendingRows().length'),0);assert.equal(run('liveTreatmentRows()[0].miss_scan'),5);assert.equal(run('liveTreatmentRows().length'),1);
 run(`state.liveMeta.periodEnd='2026-10-12'`);assert.equal(run('ranking()[0].br.officialTotal'),5);
 const unknown=prepareOfficialDisplayRow({...data.rows[0],operator_fail:'OPS99'},data.hc);assert.equal(unknown.operator_fail,'OPS99');
});
