import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCSV,validateRoster,validateEvent} from '../lib/training.mjs';
import {configureRuntimeEnv} from '../lib/blob-store.mjs';
import {POST} from '../api/reciclagens.mjs';
const roster=validateRoster([{name:'Pessoa Teste',opsid:'OPS123',shift:'T4',sector:'Outbound',leader:'lider@example.test'}]);
const event={id:'00000000-0000-4000-8000-000000000001',topic:'Bipe duplo',instructor:'Instrutor teste',area:'Outbound',date:'2026-10-07',type:'Reciclagem',participants:['OPS123','OPS123'],presenceConfirmed:true};
test('preserva turno da fonte e elimina duplicados da turma',()=>{const value=validateEvent(event,roster);assert.equal(value.participants.length,1);assert.equal(value.participants[0].shift,'T4');assert.equal(value.status,'Realizada');assert.equal(value.progress,undefined);});
test('rejeita participante desconhecido e presença não confirmada',()=>{assert.throws(()=>validateEvent({...event,participants:['OPS999']},roster));assert.throws(()=>validateEvent({...event,presenceConfirmed:false},roster));assert.throws(()=>validateEvent({...event,participants:'OPS123'},roster));});
test('não aceita OPSID duplicado ou pessoa sem identificação no ABS',()=>{assert.throws(()=>validateRoster([...roster,...roster]));assert.throws(()=>validateRoster([{name:'Teste'}]));});
test('CSV lê vírgula, aspas e quebra de linha dentro de células',()=>{assert.deepEqual(parseCSV('Nome,Turno\n"Pessoa, Teste","T4"\n"Duplo ""teste""\nNome",T2'),[['Nome','Turno'],['Pessoa, Teste','T4'],['Duplo "teste"\nNome','T2']]);});
test('rejeita data inexistente e campos obrigatórios vazios',()=>{assert.throws(()=>validateEvent({...event,date:'2026-02-30'},roster));assert.throws(()=>validateEvent({...event,instructor:''},roster));});
test('gravação sem PIN falha antes de acessar o banco',async()=>{configureRuntimeEnv({TREATMENT_WRITE_PIN:'unit-test-pin',MISSCAN_DB:{prepare(){throw new Error('Não deve acessar o banco');}}});const response=await POST(new Request('https://test/api/reciclagens',{method:'POST',body:JSON.stringify({action:'create',event})}));assert.equal(response.status,401);});

test('orientação conclui com duas assinaturas sem foto e rejeita assinatura faltante',()=>{
 const signature=name=>({name,strokes:[[[10,10],[40,40]]]});
 const orientation={...event,type:'Orientação',signatures:{instructor:signature(event.instructor),participants:{OPS123:signature(roster[0].name)}}};
 assert.equal(validateEvent(orientation,roster).signatures.participants.OPS123.name,roster[0].name);
 assert.throws(()=>validateEvent({...orientation,signatures:{}},roster));
 assert.throws(()=>validateEvent({...orientation,signatures:{instructor:signature(event.instructor),participants:{}}},roster));
 assert.throws(()=>validateEvent({...orientation,signatures:{...orientation.signatures,instructor:signature('Outra pessoa')}},roster));
});
