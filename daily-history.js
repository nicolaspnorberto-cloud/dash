(()=>{
  const host=document.getElementById('dailyTreatmentView');if(!host)return;
  host.innerHTML=`<div class="treatment-hero"><div><span class="eyebrow">COP MG4 • HISTÓRICO DIÁRIO</span><h1>Pendências, dia após dia</h1><p>Ocorrências oficiais por dia e OPSID, com vínculo individual da tratativa realizada.</p></div></div>
    <div class="panel daily-history-intro"><strong>Histórico preservado, independente do período do painel</strong><p>Entrada: share diário acima de 0,88%, com contagem oficial MG4 e cadastro da HC Matinal. Registros anteriores à ativação exigem conferência: não são considerados pendências automaticamente. Ausência não encerra uma pendência. Cada linha acompanha uma ação para uma ocorrência diária; concluir uma linha não conclui todo o ciclo.</p></div>
    <form id="dhAccess" class="daily-history-access panel"><label>PIN das tratativas<input id="dhPin" type="password" autocomplete="off" placeholder="Mesmo PIN de tratativas"></label><button id="dhLoad" class="action-btn blue" type="submit">Carregar / atualizar histórico</button></form>
    <p id="dhMessage" role="status" class="daily-history-message">Carregue os registros para iniciar o acompanhamento persistente.</p>
    <div class="panel daily-history-filters"><label>De<input id="dhFrom" type="date"></label><label>Até<input id="dhTo" type="date"></label><label>Turno<select id="dhTurn"><option value="">Todos</option></select></label><label>Líder<select id="dhLeader"><option value="">Todos</option></select></label><label>Status<select id="dhStatus"><option value="">Todos</option><option value="PENDING">Ação pendente</option><option value="REVIEW">Histórico não confirmado</option><option value="CLOSED">Tratativa vinculada</option></select></label><label>Presença atual<select id="dhPresence"><option value="">Todos</option><option value="PENDING_PRESENT">Pendentes presentes</option><option value="PRESENT">Presentes</option><option value="ABSENT">Ausentes</option><option value="UNKNOWN">Não confirmada</option></select></label><label>Colaborador / OPSID<input id="dhSearch" type="search"></label><label>Revisadas na fonte<input id="dhRevised" type="checkbox"></label><button id="dhAllDates" type="button" class="action-btn blue">Todo histórico</button><button id="dhExport" type="button" class="action-btn orange">Exportar recorte</button></div>
    <div id="dhSummary" class="daily-history-summary" aria-live="polite"></div>
    <div id="dhDetail" class="panel daily-history-detail" hidden></div>
    <article class="treatment-table-card"><div class="table-wrap"><table class="daily-history-table"><thead><tr><th>Dia da ocorrência</th><th>Colaborador / OPSID</th><th>Turno / líder HC</th><th>Miss Scans / share diário</th><th>Ação acompanhada</th><th>Status do histórico</th><th>Tempo pendente</th><th>Presença atual ABS</th><th>Registro vinculado</th><th>Conferência</th></tr></thead><tbody id="dhBody"></tbody></table></div></article>`;
  const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=value=>String(value||'').split('-').reverse().join('/');
  const pinKey='misscanTreatmentWritePinV1';
  const labels={PENDING:'Ação pendente',REVIEW:'Histórico não confirmado',CLOSED:'Tratativa vinculada'};
  const auditLabels={IMPORTED:'Ocorrência importada',LINKED:'Tratativa vinculada',PENDING_CONFIRMED:'Pendência validada',SOURCE_REVISED:'Fonte revisada'};
  const model={rows:[],evidence:[],config:null,loading:false,selected:null,checkedAt:''};
  const nowDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  $('dhFrom').value=nowDay().slice(0,7)+'-01';$('dhTo').value=nowDay();
  const action=(type,cycle)=>type==='dialogue'?`${cycle}º Diálogo de Performance`:`${cycle}ª Reciclagem`;
  function presence(row){return MisscanPresenceUI.info(row,row.presence?{[MisscanPresenceUI.key(row)]:row.presence}:{});}
  function filtered(){
    const from=$('dhFrom').value,to=$('dhTo').value;if(from&&to&&from>to)return [];
    const q=$('dhSearch').value.trim().toUpperCase();
    return model.rows.filter(r=>(!from||r.date>=from)&&(!to||r.date<=to)&&(!$('dhTurn').value||r.turno===$('dhTurn').value)&&(!$('dhLeader').value||r.leader===$('dhLeader').value)&&(!$('dhStatus').value||r.state===$('dhStatus').value)&&($('dhRevised').checked||r.inSource)&&(!q||`${r.name} ${r.opsid}`.toUpperCase().includes(q))&&MisscanPresenceUI.matches($('dhPresence').value,presence(r),r.state==='PENDING'));
  }
  function options(id,values){const value=$(id).value;$(id).innerHTML='<option value="">Todos</option>'+[...new Set(values)].filter(Boolean).sort().map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');$(id).value=[...new Set(values)].includes(value)?value:'';}
  function render(){
    const rows=filtered(),pending=rows.filter(r=>r.state==='PENDING');
    $('dhSummary').innerHTML=[['Registros diários',rows.length],['Pessoas com pendência',new Set(pending.map(r=>r.opsid)).size],['Ações pendentes',pending.length],['Históricos não confirmados',rows.filter(r=>r.state==='REVIEW').length],['Tratativas vinculadas',rows.filter(r=>r.state==='CLOSED').length]].map(([label,n])=>`<div><span>${label}</span><strong>${n}</strong></div>`).join('');
    let last='';$('dhBody').innerHTML=rows.map(r=>{
      const p=presence(r),group=r.date!==last?`<tr class="daily-date-group"><th colspan="10">${date(r.date)} • ${rows.filter(x=>x.date===r.date).length} registro(s) individual(is)</th></tr>`:'';last=r.date;
      const status=!r.inSource?'Revisada na fonte':labels[r.state];
      return `${group}<tr><td>${date(r.date)}</td><td><strong>${esc(r.name)}</strong><div class="cell-sub">${esc(r.opsid||'OPSID não confirmado')}</div></td><td>${esc(r.turno)}<div class="cell-sub">${esc(r.leader)}</div></td><td>${r.count} • ${Number(r.indicator).toFixed(2).replace('.',',')}%</td><td>${r.state==='REVIEW'?'A validar':esc(action(r.actionType,r.cycle))}</td><td><span class="daily-state ${r.state.toLowerCase()}">${status}</span></td><td>${r.state==='PENDING'?r.ageDays+' dia(s)':'—'}</td><td><span class="presence-badge ${p.className}">${p.label}</span><div class="cell-sub">${esc(p.detail)}</div></td><td>${r.evidence?esc(r.evidence.source)+' • '+date(r.evidence.date)+(r.evidenceCurrent?'':' • conferir fonte atual'):'Sem vínculo confirmado'}</td><td><button class="mini-action" data-daily-id="${esc(r.id)}">${r.state==='CLOSED'?'Ver vínculo':'Conferir'}</button></td></tr>`;
    }).join('')||'<tr><td colspan="10" class="empty">Nenhum registro carregado neste recorte. Datas invertidas ou filtros restritos podem ocultar registros.</td></tr>';
    $('dhExport').disabled=!rows.length;
  }
  async function request(action,extra={}){
    const pin=$('dhPin').value.trim()||sessionStorage.getItem(pinKey)||'';
    if(!pin)throw new Error('Informe o PIN das tratativas para consultar o histórico.');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
    try{
      const response=await fetch('/api/daily-treatments',{method:'POST',cache:'no-store',signal:controller.signal,headers:{'content-type':'application/json','x-treatment-pin':pin},body:JSON.stringify({action,...extra})});
      const data=await response.json().catch(()=>null);if(!response.ok||!data?.ok){if(response.status===401)sessionStorage.removeItem(pinKey);throw new Error(data?.error||`Falha no servidor ao consultar histórico (HTTP ${response.status}). Atualize a página e tente novamente. Se persistir, informe este código.`);}
      sessionStorage.setItem(pinKey,pin);$('dhPin').value='';return data;
    }finally{clearTimeout(timer);}
  }
  async function load(action='refresh',extra={}){
    if(model.loading)return;model.loading=true;$('dhLoad').disabled=true;$('dhMessage').textContent='Consultando histórico, tratativas registradas e presença ABS…';
    try{
      let data=await request(action,extra);
      const cursors=new Set();
      while(action==='refresh'&&data.continuation){
        if(cursors.has(data.continuation)||cursors.size>=200)throw new Error('A importação não avançou. Atualize a página para retomar com segurança.');
        cursors.add(data.continuation);
        $('dhMessage').textContent=`Importando histórico por etapas… Conferido até ${date(data.through)}.`;
        data=await request('refresh',{...extra,cursor:data.continuation});
      }
      if(action==='refresh'&&data.importComplete)data=await request('list');
      model.rows=data.rows||[];model.evidence=data.evidence||[];model.config=data.config;model.checkedAt=data.checkedAt;
      options('dhTurn',model.rows.map(r=>r.turno));options('dhLeader',model.rows.map(r=>r.leader));
      $('dhMessage').textContent=data.config?`Acompanhamento iniciado em ${date(data.config.trackingStart)}. Fonte oficial atualizada ${new Date(data.sourceUpdatedAt).toLocaleString('pt-BR')}. Consulta ${new Date(data.checkedAt).toLocaleString('pt-BR')}. Presença é atual, não a do dia da ocorrência.`:'Histórico ainda não ativado. Clique em Carregar / atualizar histórico para importar e iniciar o acompanhamento.';
      $('dhDetail').hidden=true;model.selected=null;render();
    }catch(error){$('dhMessage').textContent=error.name==='AbortError'?'A consulta demorou além do limite. Tente atualizar novamente.':error.message;}
    finally{model.loading=false;$('dhLoad').disabled=false;}
  }
  function showDetail(id){
    const row=model.rows.find(r=>r.id===id);if(!row)return;model.selected=row;
    $('dhDetail').hidden=false;
    const audit=(row.audit||[]).map(e=>`<li>${new Date(e.at).toLocaleString('pt-BR')} — ${esc(auditLabels[e.action]||'Atualização registrada')}${e.actor?' • Responsável informado: '+esc(e.actor):''}${e.note?' • '+esc(e.note):e.detail?' • '+esc(e.detail):''}</li>`).join('');
    $('dhDetail').innerHTML=`<div class="daily-detail-head"><h2>${esc(row.name)} • ${date(row.date)}</h2><button id="dhCloseDetail" class="mini-action" type="button">Fechar conferência</button></div><p>${esc(row.opsid||'OPSID não confirmado')} • ${labels[row.state]}${row.state==='REVIEW'?' • '+esc(row.proposal.review):''}${!row.inSource?' • Revisada na fonte atual.':''}</p><p>Um vínculo atende somente esta ocorrência. Não conclui outras datas nem altera os registros originais de diálogo/reciclagem.</p><ul>${audit}</ul>`;
    $('dhCloseDetail').onclick=()=>{$('dhDetail').hidden=true;model.selected=null;};
    if(row.state==='CLOSED'||!row.opsid||!row.inSource||row.proposal.withdrawn||row.proposal.terminal)return;
    const types=[1,2,3].flatMap(c=>['dialogue','recycle'].map(type=>({type,cycle:c})));
    $('dhDetail').insertAdjacentHTML('beforeend',`<form id="dhReviewForm" class="daily-review-form"><label>Ação conferida<select id="dhAction" ${row.state==='PENDING'?'disabled':''}>${types.map(s=>`<option value="${s.type}|${s.cycle}" ${s.type===row.actionType&&s.cycle===row.cycle?'selected':''}>${action(s.type,s.cycle)}</option>`).join('')}</select></label><label>Tratativa já registrada<select id="dhEvidence"></select></label><label>Responsável pela conferência<input id="dhActor" maxlength="120" required></label><label class="daily-wide">Justificativa / resultado da conferência<textarea id="dhNote" minlength="10" maxlength="1000" required></textarea></label><label class="daily-wide daily-confirm"><input id="dhConfirmed" type="checkbox" required>Conferi OPSID, data e histórico para esta ocorrência, respeitando os ciclos e eventuais retiradas do processo.</label><div class="daily-wide">${row.state==='REVIEW'?'<button id="dhConfirmPending" type="submit" class="action-btn orange">Confirmar que esta ação está pendente</button>':''} <button id="dhLinkEvidence" type="submit" class="action-btn blue">Vincular tratativa registrada</button></div></form>`);
    function evidenceOptions(){
      const [type,cycle]=$('dhAction').value.split('|');
      const available=model.evidence.filter(e=>e.opsid===row.opsid&&e.type===type&&(!e.cycle||e.cycle===Number(cycle))&&e.date>=row.date&&!model.rows.some(r=>r.evidence?.key===e.key));
      $('dhEvidence').innerHTML='<option value="">Selecione um registro compatível</option>'+available.map(e=>`<option value="${esc(e.id)}">${date(e.date)} • ${esc(e.source)} • ${esc(e.title)}</option>`).join('');
      $('dhLinkEvidence').disabled=!available.length;
    }
    $('dhAction').onchange=evidenceOptions;evidenceOptions();
    $('dhReviewForm').onsubmit=event=>{
      event.preventDefault();const [type,cycle]=$('dhAction').value.split('|');const operation=event.submitter?.id==='dhConfirmPending'?'confirm-pending':'link';
      return load(operation,{id:row.id,version:row.version,type,cycle:Number(cycle),evidenceId:$('dhEvidence').value,actor:$('dhActor').value,note:$('dhNote').value,confirmed:$('dhConfirmed').checked});
    };
  }
  $('dhAccess').onsubmit=event=>{event.preventDefault();return load();};
  host.addEventListener('click',event=>{const button=event.target.closest('[data-daily-id]');if(button)showDetail(button.dataset.dailyId);});
  ['dhFrom','dhTo','dhTurn','dhLeader','dhStatus','dhPresence','dhRevised'].forEach(id=>$(id).addEventListener('change',render));$('dhSearch').oninput=render;
  $('dhAllDates').onclick=()=>{$('dhFrom').value=model.rows.map(r=>r.date).sort()[0]||'';$('dhTo').value=nowDay();render();};
  $('dhExport').onclick=()=>exportCSV(filtered().map(r=>({data_ocorrencia:r.date,colaborador:r.name,opsid:r.opsid,turno_hc:r.turno,lider_hc:r.leader,miss_scans:r.count,share_diario_pct:r.indicator,acao:r.state==='REVIEW'?'A validar':action(r.actionType,r.cycle),status:labels[r.state],dias_pendentes:r.ageDays??'',presenca_atual:presence(r).label,data_abs:r.presence?.dateKey||'',fonte_tratativa:r.evidence?.source||'',data_tratativa:r.evidence?.date||'',revisada_na_fonte:!r.inSource})),'historico_diario_tratativas.csv');
  function tab(history){$('currentTreatmentView').hidden=history;host.hidden=!history;$('dailyCurrentTab').setAttribute('aria-pressed',String(!history));$('dailyHistoryTab').setAttribute('aria-pressed',String(history));if(history&&sessionStorage.getItem(pinKey)&&!model.rows.length)load('list');}
  $('dailyCurrentTab').onclick=()=>tab(false);$('dailyHistoryTab').onclick=()=>tab(true);
  setInterval(()=>{if(!document.hidden&&!host.hidden&&$('tratativas').classList.contains('active')){render();if(sessionStorage.getItem(pinKey)&&!model.selected)load('list');}},60000);
  render();
})();
