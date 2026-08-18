const state = {
  sourceRows: 0,
  raw: [],
  filtered: [],
  hcRecords: [],
  hcMap: new Map(),
  rankArea: 'all',
  forecast: []
};

const $ = id => document.getElementById(id);
const fmtInt = new Intl.NumberFormat('pt-BR');
const fmtPct = v => Number.isFinite(v)
  ? `${v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}%`
  : '—';

function escapeHtml(v=''){
  return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function removeAccents(v=''){
  return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

function normalizeName(v=''){
  return removeAccents(String(v||''))
    .replace(/\[Ops\d+\]/gi,' ')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function csvRowsParse(text){
  const rows=[]; let row=[], field='', quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i], n=text[i+1];
    if(quoted){
      if(c==='"'&&n==='"'){field+='"';i++;}
      else if(c==='"') quoted=false;
      else field+=c;
    } else {
      if(c==='"') quoted=true;
      else if(c===','){row.push(field);field='';}
      else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}
      else field+=c;
    }
  }
  if(field||row.length){row.push(field);rows.push(row)}
  return rows;
}

function csvParse(text){
  const rows=csvRowsParse(text).filter(r=>r.some(x=>String(x||'').trim()));
  const headers=(rows.shift()||[]).map(x=>x.trim());
  return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,(r[i]??'').trim()])));
}

function leaderFromEmail(email=''){
  const local=String(email||'').split('@')[0];
  if(!local) return 'Não cadastrado';
  return local.replaceAll('.',' ').split(/\s+/).filter(Boolean).map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join(' ');
}

function buildHCMap(records){
  state.hcRecords=records;
  state.hcMap=new Map(records.filter(x=>x.norm).map(x=>[x.norm,x]));
}

function parseHCUpload(text){
  const rows=csvRowsParse(text);
  const headerIndex=rows.findIndex(r=>String(r[0]||'').trim().toLowerCase()==='colaborador');
  if(headerIndex<0) throw new Error('Não encontrei o cabeçalho "colaborador" na Base HC.');
  const source=rows.slice(headerIndex+1).filter(r=>String(r[0]||'').trim());
  const grouped=new Map();
  source.forEach(r=>{
    const colaborador=String(r[0]||'').trim();
    if(!colaborador) return;
    const norm=normalizeName(colaborador);
    const turno=String(r[1]||'').trim()||'Não cadastrado';
    const setor=String(r[2]||'').trim()||'Não cadastrado';
    const lider_email=String(r[3]||'').trim().toLowerCase()||'Não cadastrado';
    const lider_nome=String(r[4]||'').trim()||leaderFromEmail(lider_email);
    if(!grouped.has(norm)) grouped.set(norm,{norm,colaborador,turnos:new Set(),setores:new Set(),emails:new Set(),lideres:new Set(),rows:0});
    const g=grouped.get(norm);g.turnos.add(turno);g.setores.add(setor);g.emails.add(lider_email);g.lideres.add(lider_nome);g.rows++;
  });
  return [...grouped.values()].map(g=>({
    norm:g.norm,colaborador:g.colaborador,
    turno:[...g.turnos].join(' / '),setor:[...g.setores].join(' / '),
    lider_email:[...g.emails].join(' / '),lider_nome:[...g.lideres].join(' / '),
    ambiguous:g.turnos.size>1||g.setores.size>1||g.emails.size>1,
    source_rows:g.rows
  }));
}

function responsibility(r){
  const pf=String(r.process_fail||'').trim();
  const tm=String(r.to_mis_status||'').trim();
  if(pf==='Packed TO') return 'EXPEDIÇÃO';
  if(pf.startsWith('Extra Parcel')) return 'ESTEIRA';
  if(tm==='Whole TO') return 'EXPEDIÇÃO';
  if(tm==='Extra Parcel') return 'ESTEIRA';
  return 'NA';
}

function parseOperators(raw=''){
  const text=String(raw||'').trim();
  if(!text) return [];
  return text.split(/\s*,\s*/).map(x=>x.trim()).filter(Boolean);
}

function parseSingleOperator(raw=''){
  const text=String(raw||'').trim();
  const opsMatch=text.match(/\[(Ops\d+)\]/i);
  const opsid=opsMatch?opsMatch[1]:(/^Ops\d+$/i.test(text)?text:'');
  const name=text.replace(/\[Ops\d+\]/gi,'').trim();
  const norm=normalizeName(name);
  const invalid=!name || /^OPS\d+$/i.test(text) || /@/.test(name) || norm==='NOT IDENTIFIED' || norm==='NA';
  return {opsid,name:invalid?'':name,norm:invalid?'':norm,invalid};
}

function enrich(r){
  const operators=parseOperators(r.operator_fail);
  const multi=operators.length>1;
  const single=operators.length===1?parseSingleOperator(operators[0]):{opsid:'',name:'',norm:'',invalid:true};
  const identified=!multi && operators.length===1 && !single.invalid;
  const hc=identified?state.hcMap.get(single.norm):null;
  let hcStatus='Não aplicável', turno='Não identificado', setor='Não identificado', liderNome='Não identificado', liderEmail='Não identificado', tipoHC='Não identificado';
  if(identified && hc){
    hcStatus=hc.ambiguous?'Ambíguo':'OK'; turno=hc.turno; setor=hc.setor; liderNome=hc.lider_nome; liderEmail=hc.lider_email; tipoHC='Fixo';
  } else if(identified){
    hcStatus='Não cadastrado'; turno='Não cadastrado'; setor='Não cadastrado'; liderNome='Não cadastrado'; liderEmail='Não cadastrado'; tipoHC='Diarista';
  }
  return {
    ...r,
    responsabilidade:responsibility(r),
    identificacao:identified?'IDENTIFICADO':'NÃO IDENTIFICADO',
    operator_count:operators.length,
    operator_name:identified?single.name:'NÃO IDENTIFICADO',
    opsid:identified?single.opsid:'',
    operator_original:String(r.operator_fail||''),
    turno,setor,lider_nome:liderNome,lider_email:liderEmail,tipo_hc:tipoHC,hc_status:hcStatus
  };
}

function dedupeBR(rows){
  const map=new Map();
  rows.forEach(r=>{
    const key=String(r.shipment_id||'').trim()||`ROW_${map.size}`;
    const score=(r.responsabilidade!=='NA'?10:0)+(r.identificacao==='IDENTIFICADO'?4:0)+(r.process_fail?2:0)+(r.to_mis_status?1:0);
    const dt=Date.parse(r.lmreceived_date||'')||0;
    const current=map.get(key);
    if(!current || score>current.__score || (score===current.__score && dt>current.__dt)) map.set(key,{...r,__score:score,__dt:dt});
  });
  return [...map.values()].map(({__score,__dt,...r})=>r);
}

function loadMisscanRows(rows){
  state.sourceRows=rows.length;
  const enriched=rows.map(enrich);
  state.raw=dedupeBR(enriched);
  state.filtered=[...state.raw];
  setupFilters();
  resetFilterValues(false);
  renderAll();
}

function uniq(field){
  return [...new Set(state.raw.map(r=>r[field]).filter(v=>v && !['Não identificado'].includes(v)))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
}

function fillSelect(id,values,allLabel){
  $(id).innerHTML=`<option value="">${allLabel}</option>`+values.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
}

function setupFilters(){
  fillSelect('areaFilter',uniq('responsabilidade'),'Todas');
  fillSelect('processFilter',uniq('process_fail'),'Todos');
  fillSelect('identFilter',uniq('identificacao'),'Todas');
  fillSelect('turnoFilter',uniq('turno'),'Todos');
  fillSelect('setorFilter',uniq('setor'),'Todos');
  fillSelect('liderFilter',uniq('lider_nome'),'Todos');
  fillSelect('tipoFilter',uniq('tipo_hc'),'Todos');
  fillSelect('stationFilter',uniq('lmreceived_station'),'Todos');
}

const filterIds=['areaFilter','processFilter','identFilter','turnoFilter','setorFilter','liderFilter','tipoFilter','stationFilter'];

function resetFilterValues(render=true){
  filterIds.forEach(id=>$(id).value='');
  $('operatorSearch').value='';
  if(render) applyFilters();
}

function applyFilters(){
  const vals=Object.fromEntries(filterIds.map(id=>[id,$(id).value]));
  const q=$('operatorSearch').value.trim().toLowerCase();
  state.filtered=state.raw.filter(r=>
    (!vals.areaFilter||r.responsabilidade===vals.areaFilter)&&
    (!vals.processFilter||r.process_fail===vals.processFilter)&&
    (!vals.identFilter||r.identificacao===vals.identFilter)&&
    (!vals.turnoFilter||r.turno===vals.turnoFilter)&&
    (!vals.setorFilter||r.setor===vals.setorFilter)&&
    (!vals.liderFilter||r.lider_nome===vals.liderFilter)&&
    (!vals.tipoFilter||r.tipo_hc===vals.tipoFilter)&&
    (!vals.stationFilter||r.lmreceived_station===vals.stationFilter)&&
    (!q||`${r.operator_name} ${r.operator_original} ${r.opsid} ${r.lider_nome}`.toLowerCase().includes(q))
  );
  renderAll();
}

function countBy(field,data=state.filtered){
  const m=new Map();
  data.forEach(r=>{const k=r[field]||'NA';m.set(k,(m.get(k)||0)+1)});
  return [...m.entries()].sort((a,b)=>b[1]-a[1]);
}

function renderBars(id,entries,limit=10){
  const max=Math.max(1,...entries.map(x=>x[1]));
  const total=entries.reduce((a,b)=>a+b[1],0)||1;
  const colors={'ESTEIRA':'#f4c542','EXPEDIÇÃO':'#7656d8','NA':'#9ca3af','Extra Parcel - normal flow':'#f4c542','Extra Parcel - abnormal flow':'#e3aa18','Packed TO':'#7656d8'};
  $(id).innerHTML=entries.slice(0,limit).map(([label,val],i)=>`<div class="bar-row"><div class="bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(1,val/max*100)}%;background:${colors[label]||['#161616','#61656d','#a2a6ae','#6860b9'][i%4]}"></div></div><div class="bar-value">${fmtInt.format(val)} <span style="color:#999;font-weight:650">${(val/total*100).toFixed(1)}%</span></div></div>`).join('')||'<div class="empty">Sem dados para os filtros selecionados.</div>';
}

function dominant(map){return [...map.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||'NA'}

function ranking(){
  const data=(state.rankArea==='all'?state.filtered:state.filtered.filter(r=>r.responsabilidade===state.rankArea)).filter(r=>r.identificacao==='IDENTIFICADO');
  const m=new Map();
  data.forEach(r=>{
    const key=normalizeName(r.operator_name)||r.operator_name;
    if(!m.has(key)) m.set(key,{name:r.operator_name,opsid:r.opsid||'',br:new Set(),to:new Set(),areas:new Map(),turnos:new Map(),setores:new Map(),lideres:new Map(),tipos:new Map()});
    const x=m.get(key);x.br.add(r.shipment_id);if(r.socpacked_tonumber)x.to.add(r.socpacked_tonumber);
    [['areas',r.responsabilidade],['turnos',r.turno],['setores',r.setor],['lideres',r.lider_nome],['tipos',r.tipo_hc]].forEach(([prop,val])=>x[prop].set(val,(x[prop].get(val)||0)+1));
  });
  return [...m.values()].sort((a,b)=>b.br.size-a.br.size);
}

function renderRanking(){
  const rows=ranking().slice(0,80);
  $('rankingBody').innerHTML=rows.map((x,i)=>{
    const area=dominant(x.areas),cls=area==='ESTEIRA'?'tag-esteira':area==='EXPEDIÇÃO'?'tag-expedicao':'tag-na';
    return `<tr><td>${i+1}</td><td><strong>${escapeHtml(x.name)}</strong></td><td>${escapeHtml(x.opsid||'—')}</td><td><strong>${fmtInt.format(x.br.size)}</strong></td><td>${fmtInt.format(x.to.size)}</td><td>${escapeHtml(dominant(x.turnos))}</td><td>${escapeHtml(dominant(x.setores))}</td><td>${escapeHtml(dominant(x.lideres))}</td><td>${escapeHtml(dominant(x.tipos))}</td><td><span class="tag ${cls}">${escapeHtml(area)}</span></td></tr>`;
  }).join('')||'<tr><td colspan="10" class="empty">Sem ofensores identificados para exibir.</td></tr>';
}

function hcPendingRows(){
  const m=new Map();
  state.filtered.filter(r=>r.identificacao==='IDENTIFICADO'&&r.hc_status!=='OK').forEach(r=>{
    const key=normalizeName(r.operator_name)||r.operator_original;
    if(!m.has(key))m.set(key,{name:r.operator_name,opsid:r.opsid,br:new Set(),status:r.hc_status,turno:r.turno,setor:r.setor,lider:r.lider_nome});
    m.get(key).br.add(r.shipment_id);
  });
  return [...m.values()].sort((a,b)=>b.br.size-a.br.size);
}

function renderPending(){
  const rows=hcPendingRows();
  $('pendingBody').innerHTML=rows.map((x,i)=>`<tr><td>${i+1}</td><td><strong>${escapeHtml(x.name)}</strong></td><td>${escapeHtml(x.opsid||'—')}</td><td>${fmtInt.format(x.br.size)}</td><td><span class="tag ${x.status==='Ambíguo'?'tag-ambiguous':'tag-pending'}">${escapeHtml(x.status)}</span></td><td>${escapeHtml(x.turno)}</td><td>${escapeHtml(x.setor)}</td><td>${escapeHtml(x.lider)}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">Nenhuma pendência de HC nos filtros atuais.</td></tr>';
}

function leaderSummary(){
  const m=new Map();
  state.filtered.filter(r=>r.identificacao==='IDENTIFICADO'&&r.lider_nome&&!['Não cadastrado','Não identificado'].includes(r.lider_nome)).forEach(r=>{
    const key=r.lider_nome;
    if(!m.has(key))m.set(key,{leader:key,br:new Set(),to:new Set(),ops:new Set(),esteira:new Set(),exp:new Set(),turnos:new Set()});
    const x=m.get(key);x.br.add(r.shipment_id);if(r.socpacked_tonumber)x.to.add(r.socpacked_tonumber);x.ops.add(normalizeName(r.operator_name));x.turnos.add(r.turno);
    if(r.responsabilidade==='ESTEIRA')x.esteira.add(r.shipment_id);if(r.responsabilidade==='EXPEDIÇÃO')x.exp.add(r.shipment_id);
  });
  return [...m.values()].sort((a,b)=>b.br.size-a.br.size);
}

function renderLeaders(){
  const rows=leaderSummary();
  $('leaderBody').innerHTML=rows.map((x,i)=>`<tr><td>${i+1}</td><td><strong>${escapeHtml(x.leader)}</strong></td><td>${fmtInt.format(x.br.size)}</td><td>${fmtInt.format(x.to.size)}</td><td>${fmtInt.format(x.ops.size)}</td><td>${fmtInt.format(x.esteira.size)}</td><td>${fmtInt.format(x.exp.size)}</td><td>${escapeHtml([...x.turnos].sort().join(', '))}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">Sem liderança para exibir.</td></tr>';
}

function renderKPIs(){
  const total=state.filtered.length;
  const areas=Object.fromEntries(countBy('responsabilidade'));
  const est=areas.ESTEIRA||0,exp=areas['EXPEDIÇÃO']||0;
  const unidentified=state.filtered.filter(r=>r.identificacao==='NÃO IDENTIFICADO').length;
  const tos=new Set(state.filtered.map(r=>r.socpacked_tonumber).filter(Boolean));
  const operators=new Set(state.filtered.filter(r=>r.identificacao==='IDENTIFICADO').map(r=>normalizeName(r.operator_name)).filter(Boolean));
  const pending=hcPendingRows().length;
  $('kBR').textContent=fmtInt.format(total);$('kTO').textContent=fmtInt.format(tos.size);$('kEsteira').textContent=fmtInt.format(est);$('kExpedicao').textContent=fmtInt.format(exp);$('kUnidentified').textContent=fmtInt.format(unidentified);$('kOperators').textContent=fmtInt.format(operators.size);$('kHCPending').textContent=fmtInt.format(pending);
  $('pEsteira').textContent=total?fmtPct(est/total*100):'—';$('pExpedicao').textContent=total?fmtPct(exp/total*100):'—';$('pUnidentified').textContent=total?fmtPct(unidentified/total*100):'—';
  const dates=state.filtered.map(r=>String(r.lmreceived_date||'').slice(0,10)).filter(Boolean).sort();
  $('kDate').textContent=dates.length?`${dates[0].split('-').reverse().join('/')} ${dates.at(-1)!==dates[0]?'→ '+dates.at(-1).split('-').reverse().join('/'):''}`:'sem data';
  $('projMisscan').textContent=fmtInt.format(total);
}

function renderAll(){
  renderKPIs();
  renderBars('areaBars',countBy('responsabilidade'),8);
  renderBars('processBars',countBy('process_fail'),8);
  renderBars('turnoBars',countBy('turno',state.filtered.filter(r=>r.identificacao==='IDENTIFICADO')),8);
  renderBars('setorBars',countBy('setor',state.filtered.filter(r=>r.identificacao==='IDENTIFICADO')),8);
  renderBars('liderBars',countBy('lider_nome',state.filtered.filter(r=>r.identificacao==='IDENTIFICADO')),10);
  renderBars('statusBars',countBy('last_status'),10);
  renderBars('stationBars',countBy('lmreceived_station'),10);
  renderRanking();renderLeaders();renderPending();renderProjection();
  const duplicateNote=state.sourceRows-state.raw.length;
  $('dataNote').textContent=`${fmtInt.format(state.filtered.length)} de ${fmtInt.format(state.raw.length)} BR únicos exibidos • ${fmtInt.format(state.sourceRows)} linhas de origem${duplicateNote>0?` • ${duplicateNote} duplicidade(s) de BR consolidada(s)`:''}. Regras: Packed TO = Expedição • Extra Parcel = Esteira • múltiplos operadores = não identificado.`;
}

function exportCSV(rows,filename){
  if(!rows.length)return alert('Não há dados para exportar.');
  const headers=Object.keys(rows[0]);const esc=v=>`"${String(v??'').replaceAll('"','""')}"`;
  const csv=[headers.map(esc).join(','),...rows.map(r=>headers.map(h=>esc(r[h])).join(','))].join('\r\n');
  const blob=new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();URL.revokeObjectURL(a.href);
}

function exportFiltered(){
  exportCSV(state.filtered.map(r=>({shipment_id:r.shipment_id,socpacked_tonumber:r.socpacked_tonumber,process_fail:r.process_fail,to_mis_status:r.to_mis_status,responsabilidade:r.responsabilidade,operator_fail:r.operator_original,identificacao:r.identificacao,colaborador:r.operator_name,opsid:r.opsid,turno:r.turno,setor:r.setor,lider:r.lider_nome,tipo_hc:r.tipo_hc,hc_status:r.hc_status,destino:r.lmreceived_station,last_status:r.last_status})),'misscan_tratado_filtrado.csv');
}

function exportPending(){
  exportCSV(hcPendingRows().map(x=>({colaborador:x.name,opsid:x.opsid,br:x.br.size,status_hc:x.status,turno:x.turno,setor:x.setor,lider:x.lider})),'pendencias_base_hc.csv');
}

function loadForecast(){
  try{state.forecast=JSON.parse(localStorage.getItem('misscanForecastV2')||'[]')}catch{state.forecast=[]}
  const av=localStorage.getItem('actualVolumeV2');if(av)$('actualVolume').value=av;
  const tr=localStorage.getItem('targetRateV2');if(tr)$('targetRate').value=tr;
  renderForecastTable();
}
function saveForecast(){localStorage.setItem('misscanForecastV2',JSON.stringify(state.forecast));localStorage.setItem('actualVolumeV2',$('actualVolume').value);localStorage.setItem('targetRateV2',$('targetRate').value)}
function renderProjection(){
  const actualVol=Number($('actualVolume').value)||0,target=Number($('targetRate').value)||0,miss=state.filtered.length,current=actualVol?miss/actualVol*100:NaN;
  const futVol=state.forecast.reduce((a,x)=>a+x.volume,0),futMiss=state.forecast.reduce((a,x)=>a+x.volume*x.rate/100,0),forecast=(actualVol+futVol)?(miss+futMiss)/(actualVol+futVol)*100:NaN;
  $('currentRate').textContent=fmtPct(current);$('targetCard').textContent=fmtPct(target);$('forecastRate').textContent=fmtPct(forecast);$('forecastGap').textContent=Number.isFinite(forecast)?`${forecast-target>=0?'+':''}${(forecast-target).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} p.p. vs meta`:'Informe volume realizado';
  const gauge=$('projectionGauge'),value=Number.isFinite(forecast)?forecast:0,max=Math.max(target*1.7,value*1.2,1),angle=Math.min(360,value/max*360),ok=Number.isFinite(forecast)&&forecast<=target;
  gauge.innerHTML=`<div class="gauge-ring" style="background:conic-gradient(${ok?'#2f9e6f':'#d94b4b'} ${angle}deg,#eceef1 ${angle}deg)"><div class="gauge-text"><strong>${fmtPct(forecast)}</strong><span>${Number.isFinite(forecast)?(ok?'Dentro da meta':'Acima da meta'):'Aguardando volume'}</span></div></div>`;
}
function addForecast(){const date=$('futureDate').value,volume=Number($('futureVolume').value),rate=Number($('futureRate').value);if(!date||!volume||rate<0)return alert('Preencha data, volume e taxa esperada.');state.forecast.push({id:crypto.randomUUID(),date,volume,rate});state.forecast.sort((a,b)=>a.date.localeCompare(b.date));saveForecast();renderForecastTable();renderProjection();$('futureVolume').value=''}
function renderForecastTable(){const target=Number($('targetRate').value)||0;$('forecastBody').innerHTML=state.forecast.map(x=>{const miss=x.volume*x.rate/100,ok=x.rate<=target;return `<tr><td>${x.date.split('-').reverse().join('/')}</td><td>${fmtInt.format(x.volume)}</td><td>${fmtPct(x.rate)}</td><td>${fmtInt.format(Math.round(miss))}</td><td><span class="tag ${ok?'tag-good':'tag-bad'}">${ok?'Dentro da meta':'Risco'}</span></td><td><button class="ghost-dark" onclick="removeForecast('${x.id}')">Excluir</button></td></tr>`}).join('')||'<tr><td colspan="6" class="empty">Nenhum dia futuro adicionado.</td></tr>'}
window.removeForecast=id=>{state.forecast=state.forecast.filter(x=>x.id!==id);saveForecast();renderForecastTable();renderProjection()}

function tabs(){
  document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));
    document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===b.dataset.tab));
    if(b.dataset.tab==='calendarizacao')renderProjection();
  }));
}

async function boot(){
  tabs();loadForecast();
  try{
    const [hcRes,missRes]=await Promise.all([fetch('hc.json'),fetch('misscan.json')]);
    buildHCMap(await hcRes.json());
    loadMisscanRows(await missRes.json());
  }catch(e){
    console.error(e);$('dataNote').textContent='Não foi possível carregar os arquivos padrão. Use os botões para carregar os CSVs.';
  }
  filterIds.forEach(id=>$(id).addEventListener('change',applyFilters));
  $('operatorSearch').addEventListener('input',applyFilters);$('resetBtn').addEventListener('click',()=>resetFilterValues(true));$('exportBtn').addEventListener('click',exportFiltered);$('exportPendingBtn').addEventListener('click',exportPending);
  document.querySelectorAll('.rank-pill').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.rank-pill').forEach(x=>x.classList.toggle('active',x===b));state.rankArea=b.dataset.rank;renderRanking()}));
  $('csvUpload').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;const data=csvParse(await f.text());if(!data.length)return alert('CSV de Misscan sem dados.');loadMisscanRows(data)});
  $('hcUpload').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{buildHCMap(parseHCUpload(await f.text()));loadMisscanRows(state.raw.map(r=>{const copy={...r};['responsabilidade','identificacao','operator_count','operator_name','opsid','operator_original','turno','setor','lider_nome','lider_email','tipo_hc','hc_status'].forEach(k=>delete copy[k]);return copy;}));alert('Base HC atualizada e dados reprocessados.')}catch(err){alert(err.message)}});
  $('actualVolume').addEventListener('input',()=>{saveForecast();renderProjection()});$('targetRate').addEventListener('input',()=>{saveForecast();renderForecastTable();renderProjection()});$('addForecastBtn').addEventListener('click',addForecast);$('clearForecastBtn').addEventListener('click',()=>{if(confirm('Limpar toda a calendarização salva?')){state.forecast=[];saveForecast();renderForecastTable();renderProjection()}});
}
boot();
