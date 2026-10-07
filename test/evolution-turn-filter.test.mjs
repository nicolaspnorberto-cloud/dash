import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import '../date-loader.js';

function setup() {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '' });
    return elements.get(id);
  };
  const context = vm.createContext({ window: {}, MisscanDateLoader: globalThis.MisscanDateLoader,
    document: { getElementById: get }, localStorage: { getItem() { return null; }, setItem() {} },
    Intl, Map, Set, Date, Number, String, Math, AbortController, DOMException, setTimeout, clearTimeout, console });
  const run = code => vm.runInContext(code, context);
  run(readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/boot\(\);\s*$/, ''));
  get('evolutionScope').value = 'ALL';
  run(`state.evolutionWeeks=[{week:'W40'},{week:'W41'}];
    state.evolution=[
      {colaborador:'Teste A',turno:'T1',weeks:{W41:{share:1,missScan:10,expedicao:10}}},
      {colaborador:'Teste B',turno:'T2',weeks:{W40:{share:1,missScan:10,expedicao:10},W41:{share:2,missScan:20,expedicao:20}}},
      {colaborador:'Teste C',turno:'T4',weeks:{W41:{share:1,missScan:10,esteira:10}}},
      {colaborador:'Teste D',turno:'T5',weeks:{W41:{share:1,missScan:10,expedicao:10}}},
      {colaborador:'Teste E',turno:'',weeks:{W41:{share:1,missScan:10,expedicao:10}}},
      {colaborador:'Teste F',turno:'T1 / T2',weeks:{W41:{share:1,missScan:10,expedicao:10}}}
    ];`);
  const names = () => JSON.parse(run('JSON.stringify(filteredEvolution().map(r=>r.colaborador))'));
  return {get, run, names};
}

test('turnos filtram sem atribuir turno a cadastro ausente ou combinado', () => {
  const {get,names} = setup();
  assert.equal(names().length,6);
  get('evolutionTurno').value='T1'; assert.deepEqual(names(),['Teste A']);
  get('evolutionTurno').value='T2'; assert.deepEqual(names(),['Teste B','Teste C']);
  get('evolutionTurno').value='T3'; assert.deepEqual(names(),['Teste D']);
  get('evolutionTurno').value='Não cadastrado'; assert.deepEqual(names(),['Teste E']);
  get('evolutionTurno').value='T1 / T2'; assert.deepEqual(names(),['Teste F']);
  get('evolutionTurno').value=''; assert.equal(names().length,6);
});

test('turno combina com operação e busca', () => {
  const {get,names} = setup();
  get('evolutionTurno').value='T2'; get('evolutionOperation').value='EXPEDIÇÃO';
  assert.deepEqual(names(),['Teste B']);
  get('evolutionSearch').value='Teste C'; assert.deepEqual(names(),[]);
});

test('matriz, cartões e CSV usam o mesmo recorte por turno', () => {
  const {get,run} = setup(); get('evolutionTurno').value='T2'; run('renderEvolution()');
  assert.equal(get('evolutionTotal').textContent,'2');
  assert.equal(get('evolutionCurrent').textContent,'2');
  assert.match(get('evolutionBody').innerHTML,/Teste B/);
  assert.match(get('evolutionBody').innerHTML,/Teste C/);
  assert.doesNotMatch(get('evolutionBody').innerHTML,/Teste A|Teste D|Teste E|Teste F/);
  run('var exported; exportCSV=(rows)=>{exported=rows}; exportEvolution()');
  assert.deepEqual(JSON.parse(run('JSON.stringify(exported.map(r=>r.colaborador))')),['Teste B','Teste C']);
});

test('atualização da matriz mantém seleção e oferece cadastros sem turno', () => {
  const {get,run} = setup(); get('evolutionTurno').value='T2'; run('renderEvolutionTurnFilter()');
  assert.equal(get('evolutionTurno').value,'T2');
  assert.match(get('evolutionTurno').innerHTML,/Não cadastrado/);
  run('state.evolution=[]; renderEvolutionTurnFilter()');
  assert.equal(get('evolutionTurno').value,'T2');
});
