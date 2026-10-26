import test from 'node:test';import assert from 'node:assert/strict';
import '../attendance-template.js';
import {validateEvent} from '../lib/training.mjs';
const render=globalThis.MisscanAttendance.render;
const participant={name:'Pessoa de Teste',opsid:'OPS123',shift:'T2',sector:'Outbound',leader:'Lider'};
test('modelo oficial tem 22 linhas e somente Nome/Função/Assinatura, sem dados do exemplo',()=>{
 const html=render({topic:'Reciclagem de Teste',participants:[participant]});
 assert.equal((html.match(/<tr><td>\d+<\/td><td>/g)||[]).length,22);
 assert.match(html,/06\/01\/2026/);assert.match(html,/>02</);assert.match(html,/<th>Função<\/th>/);
 assert.doesNotMatch(html,/OPS123|Outbound|23\/10\/2026|Nicolas|Escola de Captação/);
 assert.match(html,/Pessoa de Teste<\/td><td><\/td><td><\/td>/);
});
test('23 nomes geram duas páginas com cabeçalho repetido e assinaturas em branco',()=>{
 const html=render({participants:Array.from({length:23},(_,i)=>({name:'Pessoa '+(i+1)}))});
 assert.equal((html.match(/class="attendance-page"/g)||[]).length,2);
 assert.equal((html.match(/LISTA DE PRESENÇA/g)||[]).length,2);
 assert.match(html,/<td>23<\/td><td>Pessoa 23<\/td>/);
});
test('cabeçalho escapa HTML, mantém conteúdo e não pressupõe avaliação ou função',()=>{
 const html=render({topic:'<script>teste</script>',notes:'Conferência & bipagem',participants:[participant]});
 assert.match(html,/&lt;script&gt;/);assert.match(html,/Conferência &amp; bipagem/);
 assert.match(html,/\[   \] Sim \[   \] Não/);
});
test('campos oficiais opcionais persistem e não alteram eventos antigos',()=>{
 const event={id:'1234567890123456',topic:'Teste',instructor:'Teste',area:'Outbound',type:'Treinamento',date:'2026-10-26',participants:['OPS123'],presenceConfirmed:true};
 const saved=validateEvent({...event,startTime:'15:00',venue:'SOC MG4',assessment:'no',attendanceRole:'Função informada'},[participant]);
 assert.equal(saved.startTime,'15:00');assert.equal(saved.venue,'SOC MG4');assert.equal(saved.assessment,'no');assert.equal(saved.attendanceRole,'Função informada');
 assert.equal(validateEvent(event,[participant]).startTime,'');
 assert.throws(()=>validateEvent({...event,startTime:'25:00'},[participant]));
});
