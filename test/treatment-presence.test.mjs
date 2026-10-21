import '../official-share.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {POST,presenceForTreatments} from '../api/treatment-presence.mjs';
import {PRESENCE_SOURCE} from '../lib/abs-presence.mjs';
import {configureRuntimeEnv} from '../lib/blob-store.mjs';
import '../presence-ui.js';
import '../date-loader.js';

const now=new Date('2026-10-19T19:40:00Z');
test('arquivos JavaScript da página estão incluídos na publicação do Cloudflare',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const assets=readFileSync(new URL('../.assetsignore',import.meta.url),'utf8').split(/\r?\n/);
  for(const match of html.matchAll(/<script\s+src="([^"?]+)(?:\?[^"]*)?"/g)){
    assert.ok(assets.includes('!'+match[1]),'Arquivo não publicado: '+match[1]);
  }
});
const snapshot=(overrides={})=>({source:PRESENCE_SOURCE,dateKey:'2026-10-19',generatedAt:'2026-10-19T19:29:43Z',rows:[
  {opsid:'OPS1',status:'P',disabled:false},{opsid:'OPS2',status:'DSR',disabled:false},
  {opsid:'OPS3',status:'P',disabled:true},{opsid:'OPS4',status:'',disabled:false},
  {opsid:'OPS5',status:'TM',disabled:false}
],...overrides});

test('presença individual não expõe motivo, sigla de ausência ou outras pessoas',()=>{
  const result=presenceForTreatments([{opsid:'OPS1',turno:'T2'},{opsid:'OPS2',turno:'T2'}],snapshot(),now);
  assert.deepEqual(result.map(r=>r.status),['PRESENT','ABSENT']);
  assert.equal(result.length,2);
  assert.doesNotMatch(JSON.stringify(result),/DSR|disabled|OPS3|spreadsheetId/);
});
test('cadastro ausente, desligado ou sem presença confirmada nunca aparece presente',()=>{
  const result=presenceForTreatments([3,4,5,99].map(i=>({opsid:'OPS'+i,turno:'T2'})),snapshot(),now);
  assert.deepEqual(result.map(r=>r.status),['ABSENT','UNKNOWN','UNKNOWN','UNKNOWN']);
});
test('fonte errada, dia errado, ABS vencido ou indisponível produz não confirmada',()=>{
  for(const value of [null,snapshot({source:{}}),snapshot({dateKey:'2026-10-18'}),snapshot({generatedAt:'2026-10-19T17:00:00Z'})]){
    const result=presenceForTreatments([{opsid:'OPS1',turno:'T2'}],value,now)[0];
    assert.equal(result.status,'UNKNOWN');
    assert.ok(Date.parse(result.validUntil)<=now.getTime());
  }
});
test('T3/T5 usa presença do início da noite e a indicação vence às 06h',()=>{
  const nightNow=new Date('2026-10-20T08:30:00Z');
  const old=snapshot({generatedAt:'2026-10-20T08:20:00Z'});
  const current=snapshot({dateKey:'2026-10-20',generatedAt:'2026-10-20T08:20:00Z',rows:[{opsid:'OPS1',status:'DSR',disabled:false}],previousDay:old});
  for(const value of [old,current]){
    const result=presenceForTreatments([{opsid:'OPS1',turno:'T5'}],value,nightNow)[0];
    assert.equal(result.status,'PRESENT');
    assert.equal(result.dateKey,'2026-10-19');
    assert.equal(result.validUntil,'2026-10-20T09:00:00.000Z');
  }
  assert.equal(presenceForTreatments([{opsid:'OPS1',turno:'T2'}],current,nightNow)[0].status,'ABSENT');
});
test('consulta sem PIN ou com PIN errado falha antes de ler o banco',async()=>{
  configureRuntimeEnv({TREATMENT_WRITE_PIN:'teste',MISSCAN_DB:{prepare(){throw new Error('Não ler');}}});
  for(const pin of ['', 'incorreto']){
    const response=await POST(new Request('https://test/api/treatment-presence',{method:'POST',headers:{'x-treatment-pin':pin},body:'{}'}));
    assert.equal(response.status,401);
  }
});
test('consulta autenticada retorna somente IDs solicitados, sem cache ou gravação',async()=>{
  const instant=new Date();
  const dateKey=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(instant);
  const value=snapshot({dateKey,generatedAt:instant.toISOString()});
  configureRuntimeEnv({TREATMENT_WRITE_PIN:'teste',MISSCAN_DB:{prepare(){return{bind(){return this;},async first(){return{value:JSON.stringify(value)};}};}}});
  const response=await POST(new Request('https://test/api/treatment-presence',{method:'POST',headers:{'x-treatment-pin':'teste'},body:JSON.stringify({entries:[{opsid:'OPS1',turno:'T2'}]})}));
  assert.equal(response.status,200);
  assert.match(response.headers.get('cache-control'),/private.*no-store/);
  const result=await response.json();
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].status,'PRESENT');
});
test('badge expira sem continuar mostrando presença antiga e filtro respeita pendência',()=>{
  const api=globalThis.MisscanPresenceUI,row={opsid:'OPS1',turno:'T2'};
  const records={'OPS1|T2':{status:'PRESENT',dateKey:'2026-10-19',validUntil:'2026-10-19T20:00:00Z'}};
  const present=api.info(row,records,now.getTime());
  assert.equal(present.label,'Presente');
  assert.equal(api.matches('PENDING_PRESENT',present,true),true);
  assert.equal(api.matches('PENDING_PRESENT',present,false),false);
  assert.equal(api.info(row,records,Date.parse('2026-10-19T20:00:00Z')).status,'UNKNOWN');
});
test('tratativas preservam OPSID e combinam filtro de presença com turno e status',()=>{
  const elements=new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:''});return elements.get(id);};
  const context=vm.createContext({window:{},MisscanOfficialShare:globalThis.MisscanOfficialShare,MisscanDateLoader:globalThis.MisscanDateLoader,MisscanPresenceUI:globalThis.MisscanPresenceUI,document:{getElementById:get},Intl,Map,Set,Date,Number,String,Math,AbortController,DOMException,setTimeout,clearTimeout,console});
  const run=code=>vm.runInContext(code,context);
  run(readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/boot\(\);\s*$/,''));
  assert.equal(run("enrichTreatmentRow({colaborador:'Teste',opsid:'OPS1',turno:'T2'}).opsid"),'OPS1');
  run(`state.dailyRaw=[{official_aggregate:true,official_count:1000,turno:'T2'}];state.treatmentSource=[{id:'A',colaborador:'A',opsid:'OPS1',turno:'T2',indicador:2,miss_scan:10},{id:'B',colaborador:'B',opsid:'OPS2',turno:'T2',indicador:1,miss_scan:5}];
    state.treatmentPresence={'OPS1|T2':{status:'PRESENT',dateKey:'2026-10-19',validUntil:'2099-01-01T00:00:00Z'},'OPS2|T2':{status:'ABSENT',dateKey:'2026-10-19',validUntil:'2099-01-01T00:00:00Z'}};`);
  get('treatPresenceFilter').value='PENDING_PRESENT';
  assert.equal(run('filteredTreatments().length'),1);
  assert.equal(run('filteredTreatments()[0].opsid'),'OPS1');
  get('treatTurnoFilter').value='T3';assert.equal(run('filteredTreatments().length'),0);
});
