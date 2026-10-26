import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
test('lista da tratativa usa colaborador e dados do formulário sem salvar nem concluir',()=>{
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('window.printRecycleAttendance=()=>{'),source.indexOf('async function saveRecycleInfo(){'));
 let printed;const fields={recycleTopic:'Regras de Ouro',recycleDate:'2026-10-26',recycleResponsible:'Instrutor',recycleOrientation:'Bipagem e conferência',recycleStartTime:'15:00',recycleVenue:'SOC MG4',recycleDuration:'60',recycleAssessment:'no',recycleAttendanceRole:''};
 const context={window:{},state:{treatmentMode:'recycle'},modalRow:()=>({colaborador:'NOME EXATO DE TESTE',opsid:'OPS123'}),$:id=>({value:fields[id]}),MisscanAttendance:{print:event=>printed=event}};
 vm.runInNewContext(code,context);context.window.printRecycleAttendance();
 assert.equal(printed.topic,fields.recycleTopic);assert.equal(printed.notes,fields.recycleOrientation);assert.equal(printed.startTime,'15:00');assert.equal(printed.duration,'60');assert.equal(printed.participants.length,1);assert.equal(printed.participants[0].name,'NOME EXATO DE TESTE');assert.equal(printed.attendanceRole,'');
 printed=null;context.state.treatmentMode='dialogue';context.window.printRecycleAttendance();assert.equal(printed,null);
});
