/* Handwritten signatures stay in memory until the anomaly is saved to the protected API. */
(function(global){
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function attach(root,{instructor,recipients,busy=()=>false}){
  const $=id=>root.querySelector('[data-sign="'+id+'"]');
  const canvas=$('canvas'),ctx=canvas.getContext('2d');let saved=new Map(),strokes=[],stroke=null,active='';
  const people=()=>[{key:'instructor',name:instructor().trim(),role:'Quem orientou'},...[...new Set(recipients().split(/[\r\n]+/).map(n=>n.trim()).filter(Boolean))].map(name=>({key:'recipient:'+name,name,role:'Quem recebeu'}))];
  function clear(){strokes=[];stroke=null;ctx.clearRect(0,0,900,260);}
  function valid(strokes){return strokes.reduce((sum,s)=>sum+s.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-s[i][0],p[1]-s[i][1]),0),0)>=10;}
  function refresh(){const list=people(),current=$('person').value;for(const [key,value] of saved)if(!list.some(p=>p.key===key&&p.name===value.name))saved.delete(key);
   $('person').innerHTML=list.map(p=>`<option value="${esc(p.key)}">${esc(p.role)}: ${esc(p.name||'Preencha o nome do instrutor')}${saved.has(p.key)?' · Assinado':''}</option>`).join('');
   $('person').value=list.some(p=>p.key===current)?current:'instructor';if(active!==$('person').value){active=$('person').value;clear();}
   $('status').textContent=`${saved.size}/${list.length} assinaturas salvas nesta ficha. Alterar um nome exige nova assinatura dessa pessoa.`;
   $('preview').innerHTML=list.filter(p=>saved.has(p.key)).map(p=>signatureMarkup(saved.get(p.key),p.role)).join('');
  }
  function point(e){const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;const p=[Math.round(Math.max(0,Math.min(900,(e.clientX-r.left)*900/r.width))),Math.round(Math.max(0,Math.min(260,(e.clientY-r.top)*260/r.height)))];const last=stroke.at(-1);if(last&&last[0]===p[0]&&last[1]===p[1])return;stroke.push(p);if(last){ctx.beginPath();ctx.moveTo(...last);ctx.lineTo(...p);ctx.stroke();}}
  ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#0b1f35';
  canvas.onpointerdown=e=>{if(busy()||e.button>0)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);stroke=[];strokes.push(stroke);point(e);};
  canvas.onpointermove=e=>{if(!stroke||busy())return;e.preventDefault();point(e);};
  canvas.onpointerup=canvas.onpointercancel=()=>{stroke=null;};
  $('clear').onclick=()=>{if(!busy())clear();};$('person').onchange=()=>{active=$('person').value;clear();};
  $('save').onclick=()=>{if(busy())return;const person=people().find(p=>p.key===$('person').value),validStrokes=strokes.filter(s=>s.length>=2);if(!person?.name||!valid(validStrokes)){$('status').textContent='Preencha o nome e desenhe a assinatura antes de salvar.';return;}saved.set(person.key,{name:person.name,strokes:validStrokes.map(s=>s.map(p=>[...p]))});clear();refresh();};
  $('enabled').onchange=()=>{$('fields').hidden=!$('enabled').checked;if(!$('enabled').checked){saved.clear();clear();}refresh();};
  refresh();
  return{refresh,collect(){refresh();if(!$('enabled').checked)return {orientationPerformed:false};const list=people();if(list.length<2)throw new Error('Informe os nomes de quem recebeu a orientação.');if(list.some(p=>!p.name||!saved.has(p.key)))throw new Error('Salve a assinatura de quem orientou e de cada orientado antes de registrar.');return {orientationPerformed:true,signatures:{instructor:saved.get('instructor'),recipients:list.slice(1).map(p=>saved.get(p.key))}};}};
 }
 function signatureMarkup(s,role){return `<figure class="an-signature-preview"><figcaption><strong>${esc(role)}</strong><span>${esc(s.name)}</span>${s.recordedAt?`<small>${esc(new Date(s.recordedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}))}</small>`:''}</figcaption><svg viewBox="0 0 900 260" role="img" aria-label="Assinatura de ${esc(s.name)}">${s.strokes.map(stroke=>`<polyline points="${esc(stroke.map(p=>p.join(',')).join(' '))}" fill="none" stroke="#0b1f35" stroke-width="3" stroke-linecap="round"/>`).join('')}</svg></figure>`;}
 const render=signatures=>signatures?`<details class="an-signed-record"><summary>Assinaturas da orientação (${1+signatures.recipients.length})</summary><div class="an-signature-previews">${signatureMarkup(signatures.instructor,'Quem orientou')}${signatures.recipients.map(s=>signatureMarkup(s,'Quem recebeu a orientação')).join('')}</div></details>`:'<p class="an-muted">Sem assinaturas de orientação registradas.</p>';
 const form=`<section id="anSignatureSection" class="an-signature-section"><h3>Assinaturas da orientação</h3><label class="an-signature-toggle"><input type="checkbox" data-sign="enabled"> Orientação realizada — registrar assinaturas</label><p class="an-muted">Assinatura de quem orientou e de cada pessoa informada em “Nomes dos orientados”. Registre sem marcar se a orientação ainda não ocorreu.</p><div data-sign="fields" hidden><label>Quem vai assinar<select data-sign="person"></select></label><p>Assine com o dedo, caneta ou mouse no campo abaixo.</p><canvas data-sign="canvas" width="900" height="260" aria-label="Campo para desenhar a assinatura"></canvas><div class="an-actions"><button type="button" data-sign="clear">Limpar campo</button><button type="button" data-sign="save">Salvar assinatura na ficha</button></div><p data-sign="status" role="status" aria-live="polite"></p><div data-sign="preview" class="an-signature-previews"></div></div></section>`;
 global.MisscanAnomalySignatures={attach,render,form};
})(globalThis);
