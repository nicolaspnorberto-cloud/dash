import test from 'node:test';import assert from 'node:assert/strict';import '../anomaly-shift-report.js';
const api=globalThis.MisscanAnomalyShiftReport;
const options={start:'2026-10-28T21:30',end:'2026-10-29T05:30',shift:'T3',generatedAt:'2026-10-29T09:00:00Z'};
const row=(id,patch={})=>({id,observedAt:'2026-10-29T01:00:00.000Z',shift:'T3',area:'Esteiras',process:'Processo A',activity:'Saca sem atrelamento',reporter:'Instrutor A',leader:'',description:'Fato confirmado',status:'OPEN',priority:'NORMAL',oriented:null,history:[],...patch});
const signature=name=>({name,strokes:[[[20,20],[90,90]]]});
test('recorte de madrugada cruza datas em São Paulo e respeita minutos e T3/T5',()=>{
 const result=api.build([row('start',{observedAt:'2026-10-29T00:30:00Z'}),row('end',{observedAt:'2026-10-29T08:30:59.999Z',shift:'T5'}),row('early',{observedAt:'2026-10-29T00:29:59Z'}),row('late',{observedAt:'2026-10-29T08:31:00Z'}),row('other',{shift:'T2'}),row('unknown',{shift:''})],options);
 assert.equal(result.total,2);assert.match(result.text,/#start/);assert.match(result.text,/#end/);for(const id of ['early','late','other','unknown'])assert.doesNotMatch(result.text,new RegExp('#'+id));assert.match(result.text,/T3 \+ T5/);
 assert.equal(api.build([row('t4',{shift:'T4'})],{...options,shift:'T2'}).total,1);
});
test('datas inválidas, recorte excessivo, duplicados e falta de turno não geram resumo enganoso',()=>{
 for(const patch of [{start:'2026-02-30T00:00'},{end:'2026-10-28T20:00'},{end:'2026-10-31T23:59'},{shift:''},{shift:'unknown'},{start:'2026-10-28T25:00'}])assert.throws(()=>api.build([],{...options,...patch}));
 assert.throws(()=>api.build([row('a'),row('a')],options),/duplicado/);assert.throws(()=>api.build([row('a',{observedAt:'invalid'})],options),/data válida/);
});
test('resumo diferencia orientação assinada, nomes informados e pendências atuais sem inventar ação ou responsável',()=>{
 const signed={orientationPerformed:true,oriented:['Pessoa A'],signatures:{instructor:signature('Instrutor A'),recipients:[signature('Pessoa A')]}};
 const result=api.build([row('a',signed),row('b',{...signed,status:'CLOSED',resolution:'Conferência realizada',evidence:'Registro da conferência'}),row('c',{orientationPerformed:true,oriented:['Pessoa B'],priority:'CRITICAL'}),row('d',{oriented:['Pessoa C'],status:'IN_PROGRESS',activity:'Outro desvio'})],options);
 assert.equal(result.total,4);assert.equal(result.pending,3);assert.equal(result.signed,2);assert.equal(result.people,1);assert.match(result.text,/Orientações declaradas sem assinaturas completas: 1/);assert.match(result.text,/Pendentes com prioridade crítica: 1/);assert.match(result.text,/3 registros; 2 repetição/);assert.match(result.text,/Ação registrada: Não informada/);assert.match(result.text,/Responsável pela correção: Não informado/);assert.match(result.text,/não reconstituem o status/);
 const pending=result.text.split('➡️ PASSAGEM DE TURNO')[1];assert.doesNotMatch(pending,/#b \|/);assert.match(pending,/#a \|/);assert.match(result.text,/Orientados informados: Pessoa C/);assert.match(result.text,/Orientação: não confirmada/);
});
test('base vazia sinaliza falta de registros e texto para impressão escapa HTML',()=>{
 const result=api.build([],options);assert.equal(result.total,0);assert.match(result.text,/não confirma ausência de desvios/);const print=api.printMarkup('Texto revisado <img src=x onerror=alert(1)> &');assert.doesNotMatch(print,/<img/);assert.match(print,/&lt;img/);assert.match(print,/Texto revisado/);
});
