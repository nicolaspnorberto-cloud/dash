import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('function officialTOCount('),source.indexOf('function renderOfficialDetails('));
function count(rows,complete=false){const scope={state:{officialDetails:{available:true,meta:{coverage:{complete}}},rankArea:'EXPEDIÇÃO'},filteredOfficialDetails:()=>rows,normalizeName:x=>String(x).toUpperCase(),fmtInt:new Intl.NumberFormat('pt-BR')};vm.createContext(scope);vm.runInContext(fn,scope);return scope.officialTOCount({opsid:'OPS1',name:'TESTE'});}
const row={opsid:'OPS1',operator_name:'TESTE',responsabilidade:'EXPEDIÇÃO',socpacked_tonumber:'TO_TESTE'};
test('ausência de cobertura ou de código não é apresentada como zero TOs',()=>{assert.equal(count([]),'Sem dados');assert.equal(count([{...row,socpacked_tonumber:''}]),'Não informada');});
test('TO repetida conta uma vez e cobertura parcial é explícita',()=>{assert.equal(count([row,row]),'1*');assert.equal(count([row,row],true),'1');assert.equal(count([{...row,responsabilidade:'ESTEIRA'}]),'Sem dados');});
