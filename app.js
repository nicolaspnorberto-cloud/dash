// MIS-SCAN CONTROL CENTER V6.12 — Whole TO atribuído por TO
const state = {
  sourceRows: 0,
  raw: [],
  filtered: [],
  hcRecords: [],
  hcMap: new Map(),
  rankArea: 'all',
  forecast: [],
  forecastAuto: [],
  calendarMeta: null,
  calendarMode: 'auto',
  rateWindowDays: 14,
  autoRates: null,
  autoRateMeta: null,
  treatmentSource: [],
  treatmentThreshold: 0.88,
  treatmentProgress: {},
  treatmentCurrent: null,
  treatmentMode: null,
  treatmentCycle: 1,
  treatmentFiltered: [],
  liveMeta: null,
  liveRefreshing: false,
  forceRefreshing: false,
  datePreset: 'LAST_7',
  dateFrom: '',
  dateTo: ''
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
    operator_original:String(r.operator_fail_original||r.operator_fail||''),
    attribution_source:String(r.attribution_source||'DIRECT'),
    turno,setor,lider_nome:liderNome,lider_email:liderEmail,tipo_hc:tipoHC,hc_status:hcStatus
  };
}

function dedupeBR(rows){
  const map=new Map();
  rows.forEach(r=>{
    const dateKey=String(r.lmreceived_date||'').slice(0,10);
    const shipment=String(r.shipment_id||'').trim();
    const key=shipment?`${dateKey}|${shipment}`:`${dateKey}|ROW_${map.size}`;
    const score=(r.responsabilidade!=='NA'?10:0)+(r.identificacao==='IDENTIFICADO'?4:0)+(r.process_fail?2:0)+(r.to_mis_status?1:0);
    const dt=Date.parse(r.lmreceived_date||'')||0;
    const current=map.get(key);
    if(!current || score>current.__score || (score===current.__score && dt>current.__dt)) map.set(key,{...r,__score:score,__dt:dt});
  });
  return [...map.values()].map(({__score,__dt,...r})=>r);
}

function canonicalOperatorTokenV612(token=''){
  const parsed=parseSingleOperator(String(token||'').trim());
  if(parsed.invalid)return null;
  const key=(parsed.opsid||parsed.norm||'').toUpperCase();
  if(!key)return null;
  return {
    key,
    opsid:parsed.opsid||'',
    name:parsed.name||'',
    raw:`${parsed.opsid?`[${parsed.opsid}]`:''}${parsed.name||''}`
  };
}

function operatorSetV612(raw=''){
  const map=new Map();
  parseOperators(raw).forEach(token=>{
    const op=canonicalOperatorTokenV612(token);
    if(op)map.set(op.key,op);
  });
  return map;
}

function canonicalizeAndAttributeV612(rows=[]){
  // 1) Um único registro por DATA + shipment_id.
  //    Duplicidades físicas da LM nunca podem aumentar o BR.
  const groups=new Map();

  rows.forEach(raw=>{
    const dateKey=String(raw?.lmreceived_date||'').slice(0,10);
    const shipment=String(raw?.shipment_id||'').trim();
    if(!shipment)return;

    const key=`${dateKey}|${shipment}`;
    if(!groups.has(key))groups.set(key,{rows:[],operators:new Map()});
    const g=groups.get(key);
    g.rows.push(raw);

    parseOperators(raw?.operator_fail||'').forEach(token=>{
      const op=canonicalOperatorTokenV612(token);
      if(op)g.operators.set(op.key,op);
    });
  });

  const canonical=[];

  groups.forEach(g=>{
    const ranked=[...g.rows].sort((a,b)=>{
      const score=x=>
        (responsibility(x)!=='NA'?10:0)+
        (x?.process_fail?3:0)+
        (x?.to_mis_status?2:0)+
        (x?.socpacked_tonumber?1:0);
      const delta=score(b)-score(a);
      if(delta)return delta;
      return (Date.parse(b?.lmreceived_date||'')||0)-
        (Date.parse(a?.lmreceived_date||'')||0);
    });

    const base={...(ranked[0]||g.rows[0]||{})};
    const operators=[...g.operators.values()];

    base.operator_fail_original=String(
      base.operator_fail_original||base.operator_fail||'NA'
    );

    if(operators.length===0){
      base.operator_fail='NA';
      base.attribution_source='NO_OPERATOR';
    }else if(operators.length===1){
      base.operator_fail=operators[0].raw;
      base.attribution_source='DIRECT_OPERATOR_FAIL';
    }else{
      // 2+ colaboradores NO MESMO BR = NÃO IDENTIFICADO.
      base.operator_fail=operators.map(x=>x.raw).join(',');
      base.attribution_source='MULTI_OPERATOR_NOT_IDENTIFIED';
    }

    if(!base.socpacked_tonumber){
      base.socpacked_tonumber=
        ranked.find(x=>String(x?.socpacked_tonumber||'').trim())
          ?.socpacked_tonumber||'';
    }
    if(!base.process_fail){
      base.process_fail=
        ranked.find(x=>String(x?.process_fail||'').trim())?.process_fail||'';
    }
    if(!base.to_mis_status){
      base.to_mis_status=
        ranked.find(x=>String(x?.to_mis_status||'').trim())?.to_mis_status||'';
    }

    canonical.push(base);
  });

  // 2) Whole TO: usamos o operator_fail como fonte da responsabilidade.
  //    Se um BR do TO está NA, ele herda o operador quando o TO possui
  //    exatamente UM operador válido nas linhas identificadas.
  //    BR com 2+ operadores permanece NÃO IDENTIFICADO e não contamina
  //    os outros BR do mesmo TO.
  const toContext=new Map();

  canonical.forEach(row=>{
    if(String(row?.to_mis_status||'').trim()!=='Whole TO')return;
    const to=String(row?.socpacked_tonumber||'').trim();
    if(!to)return;
    const dateKey=String(row?.lmreceived_date||'').slice(0,10);
    const key=`${dateKey}|${to}`;
    if(!toContext.has(key))toContext.set(key,{single:new Map(),rows:0,multi:0});
    const ctx=toContext.get(key);
    ctx.rows++;
    const ops=operatorSetV612(row.operator_fail);
    if(ops.size===1){
      const op=[...ops.values()][0];
      ctx.single.set(op.key,op);
    }else if(ops.size>1){
      ctx.multi++;
    }
  });

  canonical.forEach(row=>{
    if(String(row?.to_mis_status||'').trim()!=='Whole TO')return;
    const to=String(row?.socpacked_tonumber||'').trim();
    if(!to)return;

    const ops=operatorSetV612(row.operator_fail);
    if(ops.size>0)return; // direto ou multi: não mexe.

    const dateKey=String(row?.lmreceived_date||'').slice(0,10);
    const ctx=toContext.get(`${dateKey}|${to}`);
    if(!ctx)return;

    if(ctx.single.size===1){
      const op=[...ctx.single.values()][0];
      row.operator_fail=op.raw;
      row.attribution_source='WHOLE_TO_INHERITED';
      row.attribution_to=to;
    }else if(ctx.single.size>1){
      row.attribution_source='WHOLE_TO_CONFLICT_NOT_IDENTIFIED';
    }else{
      row.attribution_source='WHOLE_TO_NO_OPERATOR_NOT_IDENTIFIED';
    }
  });

  return canonical.sort((a,b)=>
    String(a?.lmreceived_date||'').localeCompare(String(b?.lmreceived_date||''))
  );
}

function scopeRowsToLivePeriodV612(rows=[]){
  const from=String(
    state.liveMeta?.periodStart||
    $('dateFrom')?.value||
    ''
  );
  const to=String(
    state.liveMeta?.periodEnd||
    $('dateTo')?.value||
    ''
  );

  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||
     !/^\d{4}-\d{2}-\d{2}$/.test(to)){
    return rows;
  }

  return rows.filter(r=>{
    const d=String(r?.lmreceived_date||'').slice(0,10);
    return d>=from&&d<=to;
  });
}

function loadMisscanRows(rows){
  state.sourceRows=rows.length;

  // V6.12: consolida o BR físico e aplica a regra de Whole TO antes do HC.
  // NA em Whole TO herda o único operator_fail válido do TO;
  // BR com 2+ operadores continua NÃO IDENTIFICADO.
  const canonical=canonicalizeAndAttributeV612(rows);
  const scoped=scopeRowsToLivePeriodV612(canonical);
  const enriched=scoped.map(enrich);

  state.raw=enriched;
  state.filtered=[...state.raw];

  state.v612Integrity={
    apiRows:rows.length,
    canonicalBR:canonical.length,
    periodBR:scoped.length,
    periodStart:state.liveMeta?.periodStart||'',
    periodEnd:state.liveMeta?.periodEnd||''
  };

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
  const colors={'ESTEIRA':'#ee4d2d','EXPEDIÇÃO':'#184a86','NA':'#9aa8bb','Extra Parcel - normal flow':'#ee4d2d','Extra Parcel - abnormal flow':'#ff7b5f','Packed TO':'#184a86'};
  $(id).innerHTML=entries.slice(0,limit).map(([label,val],i)=>`<div class="bar-row"><div class="bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(1,val/max*100)}%;background:${colors[label]||['#184a86','#ee4d2d','#00a66a','#9aa8bb'][i%4]}"></div></div><div class="bar-value">${fmtInt.format(val)} <span style="color:#999;font-weight:650">${(val/total*100).toFixed(1)}%</span></div></div>`).join('')||'<div class="empty">Sem dados para os filtros selecionados.</div>';
}

function dominant(map){return [...map.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||'NA'}

function ranking(){
  let scoped=scopeRowsToLivePeriodV612(state.filtered);

  if(state.rankArea!=='all'){
    scoped=scoped.filter(r=>r.responsabilidade===state.rankArea);
  }

  const data=scoped.filter(r=>r.identificacao==='IDENTIFICADO');
  const m=new Map();

  data.forEach(r=>{
    // Usa OPSID como identidade primária. Nome é apenas fallback.
    const key=String(r.opsid||normalizeName(r.operator_name)||'')
      .trim()
      .toUpperCase();

    if(!key)return;

    if(!m.has(key)){
      m.set(key,{
        name:r.operator_name,
        opsid:r.opsid||'',
        br:new Set(),
        to:new Set(),
        areas:new Map(),
        turnos:new Map(),
        setores:new Map(),
        lideres:new Map(),
        tipos:new Map()
      });
    }

    const x=m.get(key);
    if(r.shipment_id)x.br.add(String(r.shipment_id).trim());
    if(r.socpacked_tonumber)x.to.add(String(r.socpacked_tonumber).trim());

    [
      ['areas',r.responsabilidade],
      ['turnos',r.turno],
      ['setores',r.setor],
      ['lideres',r.lider_nome],
      ['tipos',r.tipo_hc]
    ].forEach(([prop,val])=>{
      x[prop].set(val,(x[prop].get(val)||0)+1);
    });
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
  const body=$('pendingBody');
  if(!body)return;
  const rows=hcPendingRows();
  body.innerHTML=rows.map((x,i)=>`<tr><td>${i+1}</td><td><strong>${escapeHtml(x.name)}</strong></td><td>${escapeHtml(x.opsid||'—')}</td><td>${fmtInt.format(x.br.size)}</td><td><span class="tag ${x.status==='Ambíguo'?'tag-ambiguous':'tag-pending'}">${escapeHtml(x.status)}</span></td><td>${escapeHtml(x.turno)}</td><td>${escapeHtml(x.setor)}</td><td>${escapeHtml(x.lider)}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">Nenhuma pendência de HC nos filtros atuais.</td></tr>';
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
  const body=$('leaderBody');
  if(!body)return;
  const rows=leaderSummary();
  body.innerHTML=rows.map((x,i)=>`<tr><td>${i+1}</td><td><strong>${escapeHtml(x.leader)}</strong></td><td>${fmtInt.format(x.br.size)}</td><td>${fmtInt.format(x.to.size)}</td><td>${fmtInt.format(x.ops.size)}</td><td>${fmtInt.format(x.esteira.size)}</td><td>${fmtInt.format(x.exp.size)}</td><td>${escapeHtml([...x.turnos].sort().join(', '))}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">Sem liderança para exibir.</td></tr>';
}

function renderKPIs(){
  const scoped=scopeRowsToLivePeriodV612(state.filtered);
  const total=new Set(
    scoped.map(r=>String(r.shipment_id||'').trim()).filter(Boolean)
  ).size;
  const areas=Object.fromEntries(countBy('responsabilidade',scoped));
  const est=areas.ESTEIRA||0,exp=areas['EXPEDIÇÃO']||0;
  const unidentified=scoped.filter(r=>r.identificacao==='NÃO IDENTIFICADO').length;
  const tos=new Set(scoped.map(r=>r.socpacked_tonumber).filter(Boolean));
  const operators=new Set(scoped.filter(r=>r.identificacao==='IDENTIFICADO').map(r=>r.opsid||normalizeName(r.operator_name)).filter(Boolean));
  const pending=hcPendingRows().length;
  $('kBR').textContent=fmtInt.format(total);$('kTO').textContent=fmtInt.format(tos.size);$('kEsteira').textContent=fmtInt.format(est);$('kExpedicao').textContent=fmtInt.format(exp);$('kUnidentified').textContent=fmtInt.format(unidentified);$('kOperators').textContent=fmtInt.format(operators.size);$('kHCPending').textContent=fmtInt.format(pending);
  $('pEsteira').textContent=total?fmtPct(est/total*100):'—';$('pExpedicao').textContent=total?fmtPct(exp/total*100):'—';$('pUnidentified').textContent=total?fmtPct(unidentified/total*100):'—';
  const dates=scoped.map(r=>String(r.lmreceived_date||'').slice(0,10)).filter(Boolean).sort();
  $('kDate').textContent=dates.length?`${dates[0].split('-').reverse().join('/')} ${dates.at(-1)!==dates[0]?'→ '+dates.at(-1).split('-').reverse().join('/'):''}`:'sem data';
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
  renderRanking();renderTreatments();renderProjection();
  const duplicateNote=state.sourceRows-state.raw.length;
  $('dataNote').textContent=`${fmtInt.format(state.filtered.length)} de ${fmtInt.format(state.raw.length)} BR únicos exibidos • ${fmtInt.format(state.sourceRows)} linhas de origem${duplicateNote>0?` • ${duplicateNote} duplicidade(s) de BR consolidada(s)`:''}. Regras: Packed TO = Expedição • Extra Parcel = Esteira • Whole TO/NA herda o único operator_fail válido do TO • 2+ operadores no mesmo BR = não identificado.`;
}

function exportCSV(rows,filename){
  if(!rows.length)return alert('Não há dados para exportar.');
  const headers=Object.keys(rows[0]);const esc=v=>`"${String(v??'').replaceAll('"','""')}"`;
  const csv=[headers.map(esc).join(','),...rows.map(r=>headers.map(h=>esc(r[h])).join(','))].join('\r\n');
  const blob=new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();URL.revokeObjectURL(a.href);
}

function exportFiltered(){
  exportCSV(state.filtered.map(r=>({shipment_id:r.shipment_id,socpacked_tonumber:r.socpacked_tonumber,process_fail:r.process_fail,to_mis_status:r.to_mis_status,responsabilidade:r.responsabilidade,operator_fail:r.operator_original,operator_fail_efetivo:r.operator_fail,regra_atribuicao:r.attribution_source,identificacao:r.identificacao,colaborador:r.operator_name,opsid:r.opsid,turno:r.turno,setor:r.setor,lider:r.lider_nome,tipo_hc:r.tipo_hc,hc_status:r.hc_status,destino:r.lmreceived_station,last_status:r.last_status})),'misscan_tratado_filtrado.csv');
}

function exportPending(){
  exportCSV(hcPendingRows().map(x=>({colaborador:x.name,opsid:x.opsid,br:x.br.size,status_hc:x.status,turno:x.turno,setor:x.setor,lider:x.lider})),'pendencias_base_hc.csv');
}


// ========================= TRATATIVAS V4 =========================
const TREATMENT_STORAGE='misscanTreatmentProgressV4';
const TREATMENT_DB='misscanTreatmentEvidenceV4';
const TREATMENT_STORE='files';

function treatmentKey(name=''){return normalizeName(name)||String(name)}
function nowISO(){return new Date().toISOString()}
function brDate(v){if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?v:d.toLocaleString('pt-BR')}

function loadTreatmentProgress(){
  try{state.treatmentProgress=JSON.parse(localStorage.getItem(TREATMENT_STORAGE)||'{}')}catch{state.treatmentProgress={}}
}
function saveTreatmentProgress(){localStorage.setItem(TREATMENT_STORAGE,JSON.stringify(state.treatmentProgress))}

function baseProgress(){
  return {requiredCycle:1,history:[],dialogue1:{},recycle1:{signatures:{}},dialogue2:{},recycle2:{signatures:{}},dialogue3:{},recycle3:{signatures:{}}};
}
function progressFor(id){
  if(!state.treatmentProgress[id])state.treatmentProgress[id]=baseProgress();
  const p=state.treatmentProgress[id];
  p.requiredCycle=Math.min(3,Math.max(1,Number(p.requiredCycle)||1));
  p.history=p.history||[];
  [1,2,3].forEach(c=>{p[`dialogue${c}`]=p[`dialogue${c}`]||{};p[`recycle${c}`]=p[`recycle${c}`]||{};p[`recycle${c}`].signatures=p[`recycle${c}`].signatures||{};});
  return p;
}
function addTreatmentHistory(id,title,detail=''){
  const p=progressFor(id);p.history.unshift({at:nowISO(),title,detail});p.history=p.history.slice(0,100);saveTreatmentProgress();
}

function enrichTreatmentRow(r){
  const name=String(r.colaborador||r.Colaborador||r.nome||r.Nome||'').trim();
  const norm=treatmentKey(name);
  const hc=state.hcMap.get(norm);
  let rawInd=r.indicador??r.Indicador??r.share??r.Share??r['Indicador (%)']??0;
  if(typeof rawInd==='string')rawInd=rawInd.replace('%','').replace(',','.').trim();
  const indicator=Number(rawInd)||0;
  const miss=Number(r.miss_scan??r['Miss Scan']??r.ocorrencias??r.Ocorrencias??r.ocorr??0)||0;
  return {
    id:norm,
    colaborador:name||'Não identificado',
    indicador:indicator,
    miss_scan:miss,
    operacao:String(r.operacao||r['Operação dominante']||r.responsabilidade||'NA'),
    periodo:String(r.periodo||r.Periodo||r.Semana||''),
    fonte_indicador:String(r.fonte_indicador||r.Fonte||'Indicador importado'),
    turno:hc?hc.turno:'Não cadastrado',
    setor:hc?hc.setor:'Não cadastrado',
    lider:hc?hc.lider_nome:'Não cadastrado',
    lider_email:hc?hc.lider_email:'Não cadastrado',
    tipo_hc:hc?'Fixo':'Diarista',
    hc_status:hc?(hc.ambiguous?'Ambíguo':'OK'):'Não cadastrado'
  };
}

function loadTreatmentRows(rows){
  state.treatmentSource=(rows||[]).map(enrichTreatmentRow).filter(x=>x.id&&x.colaborador!=='Não identificado');
  loadTreatmentProgress();
  setupTreatmentFilters();
  renderTreatments();
}

function setupTreatmentFilters(){
  if(!$('treatTurnoFilter'))return;
  const turns=[...new Set(state.treatmentSource.map(x=>x.turno).filter(Boolean))].sort();
  const sectors=[...new Set(state.treatmentSource.map(x=>x.setor).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  fillSelect('treatTurnoFilter',turns,'Todos');
  fillSelect('treatSetorFilter',sectors,'Todos');
}

function cycleComplete(p,c){return !!p[`dialogue${c}`]?.done && !!p[`recycle${c}`]?.done}
function treatmentStatus(row){
  const p=progressFor(row.id), c=p.requiredCycle;
  const d=p[`dialogue${c}`]||{}, r=p[`recycle${c}`]||{};
  if(!d.done)return {group:'PENDENTE',text:`Realizar ${c}º Diálogo de Perf.`,className:'status-link'};
  if(!r.done)return {group:'PENDENTE',text:`Realizar ${c}ª Reciclagem`,className:'status-link'};
  return {group:'MONITORAMENTO',text:'Em monitoramento',className:'status-monitor'};
}

function filteredTreatments(){
  if(!$('treatmentThreshold'))return [];
  const threshold=Number($('treatmentThreshold').value)||0.88;
  state.treatmentThreshold=threshold;
  const turno=$('treatTurnoFilter').value;
  const setor=$('treatSetorFilter').value;
  const status=$('treatStatusFilter').value;
  const q=$('treatSearch').value.trim().toLowerCase();
  return state.treatmentSource.filter(x=>{
    const st=treatmentStatus(x);
    return x.indicador>threshold && (!turno||x.turno===turno) && (!setor||x.setor===setor) && (!status||st.group===status) && (!q||`${x.colaborador} ${x.turno} ${x.setor}`.toLowerCase().includes(q));
  }).sort((a,b)=>b.indicador-a.indicador||b.miss_scan-a.miss_scan);
}

function dialogueButton(row,c){
  const p=progressFor(row.id),d=p[`dialogue${c}`],enabled=c<=p.requiredCycle;
  if(!enabled)return `<button class="step-btn disabled" disabled>—</button>`;
  return `<button class="step-btn ${d.done?'done':'pending'}" onclick="openDialogue('${row.id}',${c})">${d.done?'Realizado':'Não realizado'}</button>`;
}
function recycleLabel(r){
  if(r.done)return ['Concluída','done'];
  if(r.infoSaved||r.evidenceCount||r.signatures?.colaborador||r.signatures?.responsavel)return ['Em andamento','recycle-ready'];
  return ['Não realizada','pending'];
}
function recycleButton(row,c){
  const p=progressFor(row.id),r=p[`recycle${c}`],enabled=c<=p.requiredCycle && !!p[`dialogue${c}`]?.done;
  if(!enabled)return `<button class="step-btn disabled" disabled>—</button>`;
  const [label,cls]=recycleLabel(r);
  return `<button class="step-btn ${cls}" onclick="openRecycle('${row.id}',${c})">${label}</button>`;
}

function renderTreatments(){
  if(!$('treatmentBody'))return;
  state.treatmentFiltered=filteredTreatments();
  const rows=state.treatmentFiltered;
  const pending=rows.filter(x=>treatmentStatus(x).group==='PENDENTE').length;
  const monitoring=rows.filter(x=>treatmentStatus(x).group==='MONITORAMENTO').length;
  const repeats=rows.filter(x=>progressFor(x.id).requiredCycle>1).length;
  const above1=rows.filter(x=>x.indicador>1).length;
  $('treatTotal').textContent=fmtInt.format(rows.length);$('treatPending').textContent=fmtInt.format(pending);$('treatMonitoring').textContent=fmtInt.format(monitoring);$('treatRepeat').textContent=fmtInt.format(repeats);$('treatAbove1').textContent=fmtInt.format(above1);
  $('treatCountLabel').textContent=`${rows.length} colaborador(es) acima de ${fmtPct(state.treatmentThreshold)} nos filtros atuais`;
  $('treatFooterCount').textContent=`${rows.length} colaboradores`;$('treatUpdatedAt').textContent=`Atualizado ${new Date().toLocaleString('pt-BR')}`;
  $('treatmentBody').innerHTML=rows.map((x,i)=>{
    const p=progressFor(x.id),st=treatmentStatus(x),rateCls=x.indicador>1?'':'near';
    return `<tr>
      <td>${i+1}</td>
      <td><strong>${escapeHtml(x.colaborador)}</strong><div class="cell-sub">${escapeHtml(x.operacao)} • ${escapeHtml(x.tipo_hc)}</div></td>
      <td><span class="metric-rate ${rateCls}">${fmtPct(x.indicador)}</span></td>
      <td><strong>${fmtInt.format(x.miss_scan)}</strong></td>
      <td><span class="tag tag-good">${escapeHtml(x.turno)}</span></td>
      <td>${escapeHtml(x.setor)}</td>
      <td>${dialogueButton(x,1)}</td><td>${recycleButton(x,1)}</td>
      <td>${dialogueButton(x,2)}</td><td>${recycleButton(x,2)}</td>
      <td>${dialogueButton(x,3)}</td><td>${recycleButton(x,3)}</td>
      <td><span class="${st.className}">${escapeHtml(st.text)}</span></td>
      <td><button class="mini-action" onclick="registerRecurrence('${x.id}')">+ Reincidência</button></td>
    </tr>`;
  }).join('')||'<tr><td colspan="14" class="empty">Nenhum colaborador acima da meta nos filtros atuais.</td></tr>';
}

window.registerRecurrence=id=>{
  const row=state.treatmentSource.find(x=>x.id===id);if(!row)return;
  const p=progressFor(id);
  if(!cycleComplete(p,p.requiredCycle))return alert('Conclua o ciclo atual antes de registrar uma reincidência.');
  if(p.requiredCycle>=3)return alert('O colaborador já está no 3º ciclo de tratativa.');
  p.requiredCycle++;
  addTreatmentHistory(id,'Reincidência registrada',`Novo ciclo: ${p.requiredCycle}`);
  saveTreatmentProgress();renderTreatments();
};

function modalRow(){return state.treatmentSource.find(x=>x.id===state.treatmentCurrent)}
function showModal(){const m=$('treatmentModal');m.classList.add('open');m.setAttribute('aria-hidden','false');document.body.style.overflow='hidden'}
function closeModal(){const m=$('treatmentModal');m.classList.remove('open');m.setAttribute('aria-hidden','true');document.body.style.overflow='';state.treatmentCurrent=null;state.treatmentMode=null}
function modalHeader(row,cycle,label){$('modalEyebrow').textContent=`${label} • CICLO ${cycle}`;$('modalTitle').textContent=row.colaborador;$('modalMeta').textContent=`Indicador ${fmtPct(row.indicador)} • ${row.turno} • ${row.setor} • Líder: ${row.lider}`}

window.openDialogue=(id,cycle)=>{
  const row=state.treatmentSource.find(x=>x.id===id);if(!row)return;
  state.treatmentCurrent=id;state.treatmentMode='dialogue';state.treatmentCycle=cycle;
  const d=progressFor(id)[`dialogue${cycle}`]||{};
  modalHeader(row,cycle,'DIÁLOGO DE PERFORMANCE');
  $('dialogueEditor').classList.remove('hidden');$('recycleEditor').classList.add('hidden');
  $('dialogueDate').value=d.date||new Date().toISOString().slice(0,10);
  $('dialogueResponsible').value=d.responsible||'';
  $('dialogueInstructorEmail').value=d.instructorEmail||localStorage.getItem('lastTreatmentInstructorEmail')||'';
  $('dialogueNotes').value=d.notes||'';
  showModal();
};

window.openRecycle=async(id,cycle)=>{
  const row=state.treatmentSource.find(x=>x.id===id);if(!row)return;
  state.treatmentCurrent=id;state.treatmentMode='recycle';state.treatmentCycle=cycle;
  const r=progressFor(id)[`recycle${cycle}`]||{};
  modalHeader(row,cycle,'RECICLAGEM');
  $('dialogueEditor').classList.add('hidden');$('recycleEditor').classList.remove('hidden');
  document.querySelectorAll('.inner-tab').forEach((b,i)=>b.classList.toggle('active',i===0));document.querySelectorAll('.inner-view').forEach((v,i)=>v.classList.toggle('active',i===0));
  $('recycleDate').value=r.date||new Date().toISOString().slice(0,10);
  $('recycleResponsible').value=r.responsible||'';
  $('recycleInstructorEmail').value=r.instructorEmail||localStorage.getItem('lastTreatmentInstructorEmail')||'';
  $('recycleTopic').value=r.topic||'';
  $('recycleCause').value=r.cause||'';
  $('recycleOrientation').value=r.orientation||'';
  $('recycleNotes').value=r.notes||'';
  await refreshEvidenceList();refreshSignatureStatus();renderTreatmentHistory();renderRecycleChecklist();prepareSignatureCanvas();showModal();
};


function isValidTreatmentEmail(value){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||'').trim());
}

async function notifyTreatmentEmail({row,eventType,cycle,instructorName,instructorEmail,details}){
  const payload={
    eventType,
    cycle,
    collaborator:row.colaborador,
    indicator:row.indicador,
    missScan:row.miss_scan,
    turno:row.turno,
    setor:row.setor,
    leaderName:row.lider,
    leaderEmail:row.lider_email,
    instructorName,
    instructorEmail,
    details:details||{},
    occurredAt:nowISO()
  };

  const response=await fetch('/api/notificar',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });

  let data={};
  try{data=await response.json()}catch{}
  if(!response.ok||!data.ok){
    throw new Error(data.error||`Falha no serviço de e-mail (${response.status}).`);
  }
  return data;
}

function emailRecipientsDescription(row,instructorEmail){
  const list=[];
  if(isValidTreatmentEmail(row.lider_email)) list.push(`líder: ${row.lider_email}`);
  if(isValidTreatmentEmail(instructorEmail) && !list.includes(`líder: ${instructorEmail}`)) list.push(`instrutor: ${instructorEmail}`);
  return list.join(' • ')||'nenhum destinatário válido';
}

async function saveDialogue(){
  const row=modalRow();if(!row)return;
  const p=progressFor(row.id),c=state.treatmentCycle,d=p[`dialogue${c}`];

  d.date=$('dialogueDate').value;
  d.responsible=$('dialogueResponsible').value.trim();
  d.instructorEmail=$('dialogueInstructorEmail').value.trim().toLowerCase();
  d.notes=$('dialogueNotes').value.trim();

  if(!d.date||!d.responsible||!d.notes||!d.instructorEmail)
    return alert('Preencha data, instrutor/responsável, e-mail do instrutor e registro do diálogo.');
  if(!isValidTreatmentEmail(d.instructorEmail))
    return alert('Informe um e-mail válido para o instrutor.');

  localStorage.setItem('lastTreatmentInstructorEmail',d.instructorEmail);

  d.done=true;
  d.updatedAt=nowISO();
  addTreatmentHistory(row.id,`${c}º diálogo realizado`,`${d.responsible} • ${d.date}`);
  saveTreatmentProgress();

  try{
    const mail=await notifyTreatmentEmail({
      row,
      eventType:'DIALOGO',
      cycle:c,
      instructorName:d.responsible,
      instructorEmail:d.instructorEmail,
      details:{date:d.date,notes:d.notes}
    });
    d.emailQueued=true;
    d.emailSent=false;
    d.emailQueuedAt=nowISO();
    d.emailRecipients=mail.recipients||[];
    addTreatmentHistory(
      row.id,
      `E-mail na fila — ${c}º diálogo`,
      (mail.recipients||[]).join(', ')||emailRecipientsDescription(row,d.instructorEmail)
    );
  }catch(err){
    d.emailSent=false;
    d.emailError=err.message;
    addTreatmentHistory(row.id,`Falha no e-mail — ${c}º diálogo`,err.message);
    alert(`O diálogo foi salvo, mas não foi possível colocar o e-mail na fila:\n${err.message}`);
  }

  saveTreatmentProgress();
  closeModal();
  renderTreatments();
}

function saveRecycleInfo(){
  const row=modalRow();if(!row)return;
  const p=progressFor(row.id),c=state.treatmentCycle,r=p[`recycle${c}`];
  Object.assign(r,{
    date:$('recycleDate').value,
    responsible:$('recycleResponsible').value.trim(),
    instructorEmail:$('recycleInstructorEmail').value.trim().toLowerCase(),
    topic:$('recycleTopic').value.trim(),
    cause:$('recycleCause').value.trim(),
    orientation:$('recycleOrientation').value.trim(),
    notes:$('recycleNotes').value.trim()
  });
  if(!r.date||!r.responsible||!r.instructorEmail||!r.topic||!r.orientation)
    return alert('Preencha data, instrutor/responsável, e-mail do instrutor, tema e orientação aplicada.');
  if(!isValidTreatmentEmail(r.instructorEmail))
    return alert('Informe um e-mail válido para o instrutor.');
  localStorage.setItem('lastTreatmentInstructorEmail',r.instructorEmail);
  r.infoSaved=true;r.updatedAt=nowISO();addTreatmentHistory(row.id,`${c}ª reciclagem — informações salvas`,`${r.responsible} • ${r.topic}`);saveTreatmentProgress();renderRecycleChecklist();
}
function recycleRequirements(r){return {info:!!r.infoSaved,evidence:(Number(r.evidenceCount)||0)>0,colab:!!r.signatures?.colaborador,resp:!!r.signatures?.responsavel}}
function renderRecycleChecklist(){
  const row=modalRow();if(!row||state.treatmentMode!=='recycle')return;const r=progressFor(row.id)[`recycle${state.treatmentCycle}`],q=recycleRequirements(r);
  $('recycleChecklist').innerHTML=`<strong>Requisitos para conclusão</strong><br><span class="${q.info?'check-ok':'check-bad'}">${q.info?'✓':'✕'} Informações da reciclagem</span><br><span class="${q.evidence?'check-ok':'check-bad'}">${q.evidence?'✓':'✕'} Pelo menos 1 evidência / lista anexada</span><br><span class="${q.colab?'check-ok':'check-bad'}">${q.colab?'✓':'✕'} Assinatura do colaborador</span><br><span class="${q.resp?'check-ok':'check-bad'}">${q.resp?'✓':'✕'} Assinatura do responsável</span>`;
}
async function completeRecycle(){
  const row=modalRow();if(!row)return;
  const p=progressFor(row.id),c=state.treatmentCycle,r=p[`recycle${c}`],q=recycleRequirements(r);

  if(!Object.values(q).every(Boolean))
    return alert('A reciclagem só pode ser concluída após informações, evidência e as duas assinaturas.');
  if(!r.instructorEmail||!isValidTreatmentEmail(r.instructorEmail))
    return alert('Informe e salve o e-mail do instrutor antes de concluir a reciclagem.');

  r.done=true;
  r.completedAt=nowISO();
  addTreatmentHistory(row.id,`${c}ª reciclagem concluída`,'Evidência e assinaturas validadas.');
  saveTreatmentProgress();

  try{
    const mail=await notifyTreatmentEmail({
      row,
      eventType:'RECICLAGEM',
      cycle:c,
      instructorName:r.responsible,
      instructorEmail:r.instructorEmail,
      details:{
        date:r.date,
        topic:r.topic,
        cause:r.cause,
        orientation:r.orientation,
        notes:r.notes,
        evidenceCount:Number(r.evidenceCount)||0
      }
    });
    r.emailQueued=true;
    r.emailSent=false;
    r.emailQueuedAt=nowISO();
    r.emailRecipients=mail.recipients||[];
    addTreatmentHistory(
      row.id,
      `E-mail na fila — ${c}ª reciclagem`,
      (mail.recipients||[]).join(', ')||emailRecipientsDescription(row,r.instructorEmail)
    );
  }catch(err){
    r.emailSent=false;
    r.emailError=err.message;
    addTreatmentHistory(row.id,`Falha no e-mail — ${c}ª reciclagem`,err.message);
    alert(`A reciclagem foi concluída, mas não foi possível colocar o e-mail na fila:\n${err.message}`);
  }

  saveTreatmentProgress();
  closeModal();
  renderTreatments();
}

function openEvidenceDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(TREATMENT_DB,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(TREATMENT_STORE)){const s=db.createObjectStore(TREATMENT_STORE,{keyPath:'id'});s.createIndex('treatmentCycle',['treatmentId','cycle']);}};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);})}
async function dbPut(record){const db=await openEvidenceDB();return new Promise((resolve,reject)=>{const tx=db.transaction(TREATMENT_STORE,'readwrite');tx.objectStore(TREATMENT_STORE).put(record);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)})}
async function dbDelete(id){const db=await openEvidenceDB();return new Promise((resolve,reject)=>{const tx=db.transaction(TREATMENT_STORE,'readwrite');tx.objectStore(TREATMENT_STORE).delete(id);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)})}
async function dbGet(id){const db=await openEvidenceDB();return new Promise((resolve,reject)=>{const tx=db.transaction(TREATMENT_STORE,'readonly'),req=tx.objectStore(TREATMENT_STORE).get(id);req.onsuccess=()=>{db.close();resolve(req.result)};req.onerror=()=>reject(req.error)})}
async function dbList(treatmentId,cycle){const db=await openEvidenceDB();return new Promise((resolve,reject)=>{const tx=db.transaction(TREATMENT_STORE,'readonly'),req=tx.objectStore(TREATMENT_STORE).index('treatmentCycle').getAll([treatmentId,cycle]);req.onsuccess=()=>{db.close();resolve(req.result||[])};req.onerror=()=>reject(req.error)})}

async function addEvidenceFile(file){
  const row=modalRow();if(!row||!file)return;const c=state.treatmentCycle,id=crypto.randomUUID();
  await dbPut({id,treatmentId:row.id,cycle:c,kind:'evidence',name:file.name,type:file.type||'application/octet-stream',size:file.size,createdAt:nowISO(),blob:file});
  const r=progressFor(row.id)[`recycle${c}`];r.evidenceCount=(Number(r.evidenceCount)||0)+1;addTreatmentHistory(row.id,`Evidência anexada — ${c}ª reciclagem`,file.name);saveTreatmentProgress();await refreshEvidenceList();renderRecycleChecklist();
}
async function refreshEvidenceList(){
  const row=modalRow();if(!row||state.treatmentMode!=='recycle')return;const items=(await dbList(row.id,state.treatmentCycle)).filter(x=>x.kind==='evidence');
  $('evidenceBadge').textContent=items.length;const r=progressFor(row.id)[`recycle${state.treatmentCycle}`];r.evidenceCount=items.length;saveTreatmentProgress();
  $('evidenceList').innerHTML=items.map(x=>`<div class="evidence-item"><div><strong>${escapeHtml(x.name)}</strong><small>${escapeHtml(x.type||'arquivo')} • ${Math.max(1,Math.round((x.size||0)/1024))} KB • ${brDate(x.createdAt)}</small></div><div class="evidence-item-actions"><button onclick="viewTreatmentFile('${x.id}')">Visualizar</button><button onclick="deleteTreatmentFile('${x.id}')">Excluir</button></div></div>`).join('')||'<div class="empty">Nenhuma evidência anexada neste ciclo.</div>';
}
window.viewTreatmentFile=async id=>{const x=await dbGet(id);if(!x?.blob)return;const url=URL.createObjectURL(x.blob);window.open(url,'_blank');setTimeout(()=>URL.revokeObjectURL(url),60000)};
window.deleteTreatmentFile=async id=>{if(!confirm('Excluir este arquivo?'))return;await dbDelete(id);const row=modalRow();if(row)addTreatmentHistory(row.id,'Evidência removida',id);await refreshEvidenceList();renderRecycleChecklist()};

let sigCtx=null,sigDrawing=false,sigDirty=false;
function prepareSignatureCanvas(){
  const canvas=$('signatureCanvas');if(!canvas)return;sigCtx=canvas.getContext('2d');sigCtx.lineWidth=3;sigCtx.lineCap='round';sigCtx.strokeStyle='#0b1f35';clearSignature();
}
function canvasPoint(ev){const c=$('signatureCanvas'),r=c.getBoundingClientRect(),p=ev.touches?.[0]||ev;return {x:(p.clientX-r.left)*c.width/r.width,y:(p.clientY-r.top)*c.height/r.height}}
function sigStart(ev){ev.preventDefault();sigDrawing=true;sigDirty=true;const p=canvasPoint(ev);sigCtx.beginPath();sigCtx.moveTo(p.x,p.y)}
function sigMove(ev){if(!sigDrawing)return;ev.preventDefault();const p=canvasPoint(ev);sigCtx.lineTo(p.x,p.y);sigCtx.stroke()}
function sigEnd(){sigDrawing=false}
function clearSignature(){const c=$('signatureCanvas');if(!c||!sigCtx)return;sigCtx.clearRect(0,0,c.width,c.height);sigDirty=false}
async function saveSignature(){
  const row=modalRow();if(!row||!sigDirty)return alert('Faça a assinatura no campo antes de salvar.');const c=state.treatmentCycle,type=$('signatureType').value,canvas=$('signatureCanvas');
  const blob=await new Promise(res=>canvas.toBlob(res,'image/png'));const id=`sig-${row.id}-${c}-${type}`;await dbPut({id,treatmentId:row.id,cycle:c,kind:'signature',signatureType:type,name:`assinatura_${type}.png`,type:'image/png',size:blob.size,createdAt:nowISO(),blob});
  const r=progressFor(row.id)[`recycle${c}`];r.signatures=r.signatures||{};r.signatures[type]=true;r.signatures[`${type}At`]=nowISO();addTreatmentHistory(row.id,`Assinatura registrada — ${type}`,`${c}ª reciclagem`);saveTreatmentProgress();clearSignature();refreshSignatureStatus();renderRecycleChecklist();
}
function refreshSignatureStatus(){
  const row=modalRow();if(!row)return;const r=progressFor(row.id)[`recycle${state.treatmentCycle}`],s=r.signatures||{};
  $('sigStatusColab').textContent=`Colaborador: ${s.colaborador?'assinado':'pendente'}`;$('sigStatusColab').classList.toggle('signed',!!s.colaborador);$('sigStatusResp').textContent=`Responsável: ${s.responsavel?'assinado':'pendente'}`;$('sigStatusResp').classList.toggle('signed',!!s.responsavel);
}
function renderTreatmentHistory(){
  const row=modalRow();if(!row)return;const hist=progressFor(row.id).history||[];$('treatmentHistory').innerHTML=hist.map(x=>`<div class="history-item"><strong>${escapeHtml(x.title)}</strong><span>${brDate(x.at)}</span><p>${escapeHtml(x.detail||'')}</p></div>`).join('')||'<div class="empty">Ainda não há histórico registrado.</div>';
}

function parseTreatmentCSV(text){
  const first=(text.split(/\r?\n/)[0]||'');const delimiter=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':',';
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(quoted){if(c==='"'&&n==='"'){field+='"';i++}else if(c==='"')quoted=false;else field+=c}else{if(c==='"')quoted=true;else if(c===delimiter){row.push(field);field=''}else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field=''}else field+=c}}
  if(field||row.length){row.push(field);rows.push(row)}
  const clean=rows.filter(r=>r.some(x=>String(x).trim()));const headers=(clean.shift()||[]).map(x=>x.trim());return clean.map(r=>Object.fromEntries(headers.map((h,i)=>[h,(r[i]??'').trim()])));
}

function exportTreatmentList(){exportCSV(state.treatmentFiltered.map(x=>{const p=progressFor(x.id),st=treatmentStatus(x);return {colaborador:x.colaborador,indicador_pct:x.indicador,miss_scan:x.miss_scan,turno:x.turno,setor:x.setor,tipo_hc:x.tipo_hc,ciclo:p.requiredCycle,status:st.text,periodo:x.periodo,fonte:x.fonte_indicador}}),'tratativas_colaboradores.csv')}
function generateTreatmentReport(){
  const rows=state.treatmentFiltered;if(!rows.length)return alert('Não há colaboradores para o relatório.');const body=rows.map((x,i)=>{const p=progressFor(x.id),st=treatmentStatus(x);return `<tr><td>${i+1}</td><td>${escapeHtml(x.colaborador)}</td><td>${fmtPct(x.indicador)}</td><td>${x.miss_scan}</td><td>${escapeHtml(x.turno)}</td><td>${escapeHtml(x.setor)}</td><td>${p.requiredCycle}</td><td>${escapeHtml(st.text)}</td></tr>`}).join('');const w=window.open('','_blank');w.document.write(`<!doctype html><html><head><title>Relatório de Tratativas</title><style>body{font-family:Arial;padding:30px;color:#10233f}h1{margin-bottom:4px}p{color:#667}table{width:100%;border-collapse:collapse;margin-top:20px}th{background:#184a86;color:white}th,td{padding:9px;border:1px solid #ddd;text-align:left}</style></head><body><h1>Relatório de Tratativas Mis-Scan</h1><p>Meta de corte: ${fmtPct(state.treatmentThreshold)} • Gerado em ${new Date().toLocaleString('pt-BR')}</p><table><thead><tr><th>#</th><th>Colaborador</th><th>Indicador</th><th>Miss Scan</th><th>Turno</th><th>Setor</th><th>Ciclo</th><th>Status</th></tr></thead><tbody>${body}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close();
}
function openFirstPendingEvidence(){
  const row=state.treatmentFiltered.find(x=>{const p=progressFor(x.id),c=p.requiredCycle;return p[`dialogue${c}`]?.done&&!p[`recycle${c}`]?.done})||state.treatmentFiltered[0];if(!row)return alert('Nenhum colaborador em tratativa.');const p=progressFor(row.id),c=p.requiredCycle;if(!p[`dialogue${c}`]?.done)return openDialogue(row.id,c);openRecycle(row.id,c);
}

const TARGET_MISSCAN = 0.88;

function rateBlock(turno){
  if(turno==='T4') return 'T2';
  if(turno==='T5') return 'T3';
  return turno;
}

function updateRateWindowButtons(){
  document.querySelectorAll('.rate-window-btn').forEach(b=>{
    b.classList.toggle('active',Number(b.dataset.days)===Number(state.rateWindowDays));
  });
}

function loadCalendarPreferences(){
  state.rateWindowDays=Number(localStorage.getItem('misscanRateWindowV65')||14);
  if(![7,14,30].includes(state.rateWindowDays)) state.rateWindowDays=14;
  updateRateWindowButtons();
}

function saveCalendarPreferences(){
  localStorage.setItem('misscanRateWindowV65',String(state.rateWindowDays||14));
}

function riskForRate(rate,target=TARGET_MISSCAN){
  if(!Number.isFinite(rate)) return {key:'na',label:'Sem cálculo',cls:'tag-na'};
  if(rate<=target) return {key:'good',label:'Dentro da meta',cls:'tag-good'};
  return {key:'bad',label:'Acima da meta',cls:'tag-bad'};
}

function renderCalendarSourceStatus(mode='ok',message='',detail=''){
  const dot=$('calendarLiveDot');
  if(dot){
    dot.classList.remove('loading','error');
    if(mode==='loading')dot.classList.add('loading');
    if(mode==='error')dot.classList.add('error');
  }
  if($('calendarSource'))$('calendarSource').textContent=message||'GEROT automática';
  if($('calendarUpdated'))$('calendarUpdated').textContent=detail||'db_volume_overall + db_volume_forecast';
}

function renderAutoRates(){
  ['T1','T2','T3'].forEach(t=>{
    const r=state.autoRates?.[t];
    const rateEl=$(`autoRate${t}`),detail=$(`autoRate${t}Detail`);
    if(rateEl) rateEl.textContent=r&&Number.isFinite(r.rate)?fmtPct(r.rate):'—';
    if(detail){
      detail.textContent=r
        ?`${fmtInt.format(r.misscan||0)} Misscan ÷ ${fmtInt.format(Math.round(r.volumeReal||0))} SOC_Packed`
        :'Aguardando histórico';
    }
  });

  const g=state.autoRateMeta?.general;
  if($('autoRateGeneral')) $('autoRateGeneral').textContent=g&&Number.isFinite(g.rate)?fmtPct(g.rate):'—';
  if($('autoRateGeneralDetail')){
    $('autoRateGeneralDetail').textContent=g
      ?`${fmtInt.format(g.misscan||0)} Misscan ÷ ${fmtInt.format(Math.round(g.volumeReal||0))} Forecast INTER-SOC`
      :'Aguardando histórico';
  }

  if($('autoRateMeta')){
    const m=state.autoRateMeta||{};
    const pending=Number(m.general?.pendingMisscanNoProcessed||0);
    $('autoRateMeta').textContent=m.periodLabel
      ?`Base ${m.days} dias • ${m.periodLabel} • Matinal/LM ÷ Forecast INTER-SOC Total (F)${pending?` • ${fmtInt.format(pending)} Misscan sem volume do dia`:''}`
      :'Fonte: Matinal/LM + GEROT db_volume_forecast • INTER-SOC • Total (F)';
  }

  updateRateWindowButtons();
  renderCalendarHistory();
  renderCalendarWeeks();
}

async function loadAutoRates({silent=true}={}){
  try{
    const res=await fetch(`/api/taxas?days=${encodeURIComponent(state.rateWindowDays)}&t=${Date.now()}`,{cache:'no-store'});
    let data={};try{data=await res.json()}catch{}
    if(!res.ok||!data.ok)throw new Error(data.error||`Falha (${res.status})`);
    state.autoRates=data.rates||null;
    state.autoRateMeta={
      days:data.days,
      start:data.start,
      end:data.end,
      periodLabel:data.periodLabel,
      target:Number(data.target??TARGET_MISSCAN),
      source:data.source||'GEROT - MG4',
      general:data.general||null,
      daily:data.daily||[],
      weekly:data.weekly||[],
      productionMeta:data.productionMeta||{},
      mapping:data.mapping||{}
    };
    renderAutoRates();
    renderForecastTable();
    renderProjection();
  }catch(err){
    console.error('Taxa automática V6.5',err);
    state.autoRates=null;
    state.autoRateMeta=null;
    renderAutoRates();
    renderForecastTable();
    renderProjection();
    if(!silent)alert(`Falha ao carregar taxa real automática:
${err.message}`);
  }
}

function calcForecastDay(x){
  const baseRate=Number(state.autoRateMeta?.general?.rate);
  const volume=Number(x?.volume||x?.total||0);
  const projectedMiss=Number.isFinite(baseRate)?volume*baseRate/100:NaN;
  const allowedMiss=volume*TARGET_MISSCAN/100;
  const gap=Number.isFinite(projectedMiss)?projectedMiss-allowedMiss:NaN;
  return {...x,volume,baseRate,projectedMiss,allowedMiss,gap};
}

function renderCalendarHistory(){
  if(!$('calendarHistoryBody'))return;
  const rows=[...(state.autoRateMeta?.daily||[])].reverse();
  $('calendarHistoryBody').innerHTML=rows.map(d=>{
    const risk=riskForRate(Number(d.rate),TARGET_MISSCAN);
    const t1=Number(d.blocks?.T1?.volumeReal||0);
    const t2=Number(d.blocks?.T2?.volumeReal||0);
    const t3=Number(d.blocks?.T3?.volumeReal||0);
    return `<tr>
      <td><strong>${escapeHtml(String(d.date||'').split('-').reverse().join('/'))}</strong></td>
      <td>${escapeHtml(d.week||'—')}</td>
      <td>${fmtInt.format(Number(d.misscan||0))}</td>
      <td>${fmtInt.format(Math.round(Number(d.volumeReal||0)))}</td>
      <td><strong>${fmtPct(Number(d.rate))}</strong></td>
      <td>${fmtInt.format(Math.round(t1))}</td>
      <td>${fmtInt.format(Math.round(t2))}</td>
      <td>${fmtInt.format(Math.round(t3))}</td>
      <td><span class="tag ${risk.cls}">${risk.label}</span></td>
    </tr>`;
  }).join('')||'<tr><td colspan="9" class="empty">Ainda não há casamento diário entre Matinal e Forecast INTER-SOC.</td></tr>';
}

function renderCalendarWeeks(){
  if(!$('calendarWeekBody'))return;
  const rows=[...(state.autoRateMeta?.weekly||[])].reverse();
  $('calendarWeekBody').innerHTML=rows.map(w=>{
    const risk=riskForRate(Number(w.rate),TARGET_MISSCAN);
    return `<tr>
      <td><strong>${escapeHtml(w.week||'—')}</strong></td>
      <td>${fmtInt.format(Number(w.misscan||0))}</td>
      <td>${fmtInt.format(Math.round(Number(w.volumeReal||0)))}</td>
      <td><span class="tag ${risk.cls}">${fmtPct(Number(w.rate))}</span></td>
      <td>${fmtPct(TARGET_MISSCAN)}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="5" class="empty">Sem semanas consolidadas.</td></tr>';
}

function renderForecastTable(){
  if(!$('forecastBody'))return;
  const rows=(state.forecastAuto||[]).map(calcForecastDay);
  $('forecastBody').innerHTML=rows.map(x=>{
    const risk=riskForRate(x.baseRate,TARGET_MISSCAN);
    const gapText=Number.isFinite(x.gap)
      ?`${x.gap>=0?'+':''}${fmtInt.format(Math.round(x.gap))}`
      :'—';
    return `<tr>
      <td><strong>${escapeHtml(String(x.date||'').split('-').reverse().join('/'))}</strong></td>
      <td>${escapeHtml(x.week||'—')}</td>
      <td>${fmtInt.format(Math.round(x.volume||0))}</td>
      <td><strong>${fmtPct(x.baseRate)}</strong></td>
      <td>${Number.isFinite(x.projectedMiss)?fmtInt.format(Math.round(x.projectedMiss)):'—'}</td>
      <td>${fmtInt.format(Math.round(x.allowedMiss||0))}</td>
      <td><strong class="${Number.isFinite(x.gap)?(x.gap>0?'gap-positive':'gap-negative'):''}">${gapText}</strong></td>
      <td><span class="tag ${risk.cls}">${risk.label}</span></td>
    </tr>`;
  }).join('')||'<tr><td colspan="8" class="empty">Nenhum Forecast futuro disponível na GEROT.</td></tr>';
}

function renderProjection(){
  const rows=(state.forecastAuto||[]).map(calcForecastDay);
  const historicalRate=Number(state.autoRateMeta?.general?.rate);
  const futureVolume=rows.reduce((sum,x)=>sum+Number(x.volume||0),0);
  const projected=rows.reduce((sum,x)=>sum+(Number.isFinite(x.projectedMiss)?x.projectedMiss:0),0);
  const allowed=rows.reduce((sum,x)=>sum+Number(x.allowedMiss||0),0);
  const gap=Number.isFinite(historicalRate)?projected-allowed:NaN;
  const riskDays=Number.isFinite(historicalRate)?(historicalRate>TARGET_MISSCAN?rows.length:0):null;

  if($('calTarget'))$('calTarget').textContent=fmtPct(TARGET_MISSCAN);
  if($('calHistoricalRate'))$('calHistoricalRate').textContent=fmtPct(historicalRate);
  if($('calFutureVolume'))$('calFutureVolume').textContent=fmtInt.format(Math.round(futureVolume));
  if($('calProjectedMiss'))$('calProjectedMiss').textContent=Number.isFinite(historicalRate)?fmtInt.format(Math.round(projected)):'—';
  if($('calAllowedMiss'))$('calAllowedMiss').textContent=fmtInt.format(Math.round(allowed));
  if($('calGap')){
    $('calGap').textContent=Number.isFinite(gap)?`${gap>=0?'+':''}${fmtInt.format(Math.round(gap))}`:'—';
    $('calGap').classList.toggle('gap-positive',Number.isFinite(gap)&&gap>0);
    $('calGap').classList.toggle('gap-negative',Number.isFinite(gap)&&gap<=0);
  }
  if($('calGapDetail'))$('calGapDetail').textContent=Number.isFinite(gap)?(gap>0?'Misscans acima do limite':'folga vs limite'):'aguardando histórico';
  if($('calRiskDays'))$('calRiskDays').textContent=riskDays===null?'—':fmtInt.format(riskDays);

  if($('calendarSummaryText')){
    const hist=state.autoRateMeta?.periodLabel||'histórico ainda indisponível';
    const future=state.calendarMeta?.periodStart&&state.calendarMeta?.periodEnd
      ?`${state.calendarMeta.periodStart.split('-').reverse().join('/')} a ${state.calendarMeta.periodEnd.split('-').reverse().join('/')}`
      :'forecast futuro';
    $('calendarSummaryText').textContent=`Histórico ${hist} • Forecast ${future} • Meta fixa ${fmtPct(TARGET_MISSCAN)}`;
  }
}

async function loadCalendarizationAuto({silent=true}={}){
  renderCalendarSourceStatus('loading','Atualizando GEROT...','Lendo Forecast Total diário');
  try{
    const res=await fetch(`/api/calendarizacao?days=21&t=${Date.now()}`,{cache:'no-store'});
    let data={};try{data=await res.json()}catch{}
    if(!res.ok||!data.ok)throw new Error(data.error||`Falha (${res.status})`);
    state.forecastAuto=data.rows||[];
    state.calendarMeta=data.meta||{};
    const updated=state.calendarMeta.receivedAt?new Date(state.calendarMeta.receivedAt).toLocaleString('pt-BR'):'—';
    renderCalendarSourceStatus(
      'ok',
      `${state.forecastAuto.length} dia(s) planejado(s) • GEROT`,
      `db_volume_forecast • INTER-SOC • Total (F) • atualizado ${updated}`
    );
    renderForecastTable();
    renderProjection();
  }catch(err){
    console.error('Calendarização V6.5',err);
    state.forecastAuto=[];
    renderCalendarSourceStatus('error','GEROT indisponível',err.message);
    renderForecastTable();
    renderProjection();
    if(!silent)alert(`Falha na Calendarização V6.5:
${err.message}`);
  }
}

async function refreshCalendarizationV65({silent=true}={}){
  await loadCalendarizationAuto({silent});
  await loadAutoRates({silent});
}


function tabs(){
  document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));
    document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===b.dataset.tab));
    if(b.dataset.tab==='calendarizacao'){refreshCalendarizationV65({silent:true})}
    if(b.dataset.tab==='tratativas')renderTreatments();
  }));
}



function periodQuery(){
  const preset=state.datePreset||'LAST_7';
  if(preset==='CUSTOM' && state.dateFrom && state.dateTo){
    return `from=${encodeURIComponent(state.dateFrom)}&to=${encodeURIComponent(state.dateTo)}`;
  }
  return `preset=${encodeURIComponent(preset)}`;
}

function syncPeriodControlsFromMeta(){
  const meta=state.liveMeta||{};

  if(meta.periodPreset) state.datePreset=meta.periodPreset;
  if(meta.periodStart) state.dateFrom=meta.periodStart;
  if(meta.periodEnd) state.dateTo=meta.periodEnd;

  if($('datePreset')) $('datePreset').value=state.datePreset||'LAST_7';
  if($('dateFrom')) $('dateFrom').value=state.dateFrom||'';
  if($('dateTo')) $('dateTo').value=state.dateTo||'';

  if($('periodSummary')) $('periodSummary').textContent=meta.periodLabel||'Período não definido';
  if($('historyBounds')){
    const active=Number(meta.historyActiveDays||0);
    const calendar=Number(meta.historyCalendarDays||0);
    const backfill=meta.backfill||{};
    const progress=backfill.status==='RUNNING' && Number.isFinite(Number(backfill.progressPct))
      ? ` • carga ${Number(backfill.progressPct).toLocaleString('pt-BR')}%`
      : '';
    $('historyBounds').textContent=
      `Histórico LM: ${meta.historyLabel||'—'}${active?` • ${fmtInt.format(active)} dias com Misscan`:''}${calendar?` • ${fmtInt.format(calendar)} dias de intervalo`:''}${progress}`;
  }
}

function applyPeriodFromControls(){
  const preset=$('datePreset').value||'LAST_7';
  state.datePreset=preset;

  if(preset==='CUSTOM'){
    const from=$('dateFrom').value;
    const to=$('dateTo').value;
    if(!from||!to) return alert('Informe data inicial e data final.');
    state.dateFrom=from;
    state.dateTo=to;
  }

  localStorage.setItem('misscanPeriodPresetV61',state.datePreset);
  localStorage.setItem('misscanPeriodFromV61',state.dateFrom||'');
  localStorage.setItem('misscanPeriodToV61',state.dateTo||'');

  refreshLiveData({silent:false});
}

function restorePeriodPreference(){
  const preset=localStorage.getItem('misscanPeriodPresetV61');
  const from=localStorage.getItem('misscanPeriodFromV61');
  const to=localStorage.getItem('misscanPeriodToV61');

  if(preset) state.datePreset=preset;
  if(from) state.dateFrom=from;
  if(to) state.dateTo=to;
}

function setLiveStatus(mode,text,detail=''){
  const dot=$('liveDot'),status=$('liveStatus'),updated=$('liveUpdated');
  if(dot){
    dot.classList.remove('loading','error');
    if(mode==='loading')dot.classList.add('loading');
    if(mode==='error')dot.classList.add('error');
  }
  if(status)status.textContent=text;
  if(updated)updated.textContent=detail||'Google Sheets • automático';
}

function liveTreatmentRows(){
  const identified=state.raw.filter(r=>r.identificacao==='IDENTIFICADO' && r.responsabilidade!=='NA');
  const total=identified.length||1;
  const groups=new Map();

  identified.forEach(r=>{
    const id=normalizeName(r.operator_name);
    if(!id)return;
    if(!groups.has(id)){
      groups.set(id,{
        colaborador:r.operator_name,
        miss_scan:0,
        areaCounts:{},
        periodo:state.liveMeta?.periodLabel||'Janela automática'
      });
    }
    const g=groups.get(id);
    g.miss_scan++;
    g.areaCounts[r.responsabilidade]=(g.areaCounts[r.responsabilidade]||0)+1;
  });

  return [...groups.values()].map(g=>{
    const operacao=Object.entries(g.areaCounts)
      .sort((a,b)=>b[1]-a[1])[0]?.[0]||'NA';

    return {
      colaborador:g.colaborador,
      miss_scan:g.miss_scan,
      indicador:g.miss_scan/total*100,
      operacao,
      periodo:g.periodo,
      fonte_indicador:'Share Misscan por período'
    };
  });
}


function sleepV67(ms){
  return new Promise(resolve=>setTimeout(resolve,ms));
}

async function forceRefreshSourcesV67({silent=false}={}){
  if(state.forceRefreshing)return;
  state.forceRefreshing=true;

  const btn=$('refreshDataBtn');
  const calBtn=$('refreshCalendarBtn');
  const oldBtnText=btn?.textContent||'Atualizar agora';
  const oldCalText=calBtn?.textContent||'Atualizar Calendarização';

  if(btn){
    btn.disabled=true;
    btn.textContent='Solicitando...';
  }
  if(calBtn){
    calBtn.disabled=true;
    calBtn.textContent='Solicitando...';
  }

  setLiveStatus(
    'loading',
    'Solicitando atualização...',
    'Criando pedido na fila privada'
  );

  try{
    const res=await fetch('/api/refresh-source',{
      method:'POST',
      cache:'no-store',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({action:'all',from:state.dateFrom||'',to:state.dateTo||''})
    });

    let data={};
    try{data=await res.json()}catch{}

    if(!res.ok||!data.ok){
      throw new Error(
        data.error||
        `Falha ao solicitar atualização (${res.status}).`
      );
    }

    const requestId=data.requestId;
    if(!requestId){
      throw new Error(
        'Pedido criado sem requestId.'
      );
    }

    if(btn)btn.textContent='Na fila...';
    if(calBtn)calBtn.textContent='Na fila...';

    let finalRequest=null;

    for(let attempt=1;attempt<=100;attempt++){
      await sleepV67(3000);

      const statusRes=await fetch(
        `/api/refresh-source?requestId=${encodeURIComponent(requestId)}&t=${Date.now()}`,
        {cache:'no-store'}
      );

      let statusData={};
      try{statusData=await statusRes.json()}catch{}

      if(!statusRes.ok||!statusData.ok){
        continue;
      }

      const req=statusData.request||{};
      finalRequest=req;
      const status=String(
        req.status||'PENDING'
      ).toUpperCase();

      if(status==='PENDING'){
        setLiveStatus(
          'loading',
          'Atualização na fila...',
          'Apps Script consulta a fila a cada 1 minuto'
        );
        if(btn)btn.textContent='Na fila...';
        if(calBtn)calBtn.textContent='Na fila...';
      }

      if(status==='RUNNING'){
        setLiveStatus(
          'loading',
          'Sincronizando fontes...',
          'Lendo Matinal/LM + GEROT'
        );
        if(btn)btn.textContent='Sincronizando...';
        if(calBtn)calBtn.textContent='Sincronizando...';
      }

      if(
        ['DONE','PARTIAL','ERROR'].includes(status)
      ){
        break;
      }
    }

    const finalStatus=String(
      finalRequest?.status||''
    ).toUpperCase();

    if(
      ['DONE','PARTIAL'].includes(finalStatus)
    ){
      await refreshLiveData({silent:true});
      await refreshCalendarizationV65({silent:true});

      const result=finalRequest?.result||{};
      const lm=result.lm||'';
      const gerot=result.gerot||'';

      if(finalStatus==='DONE'){
        const uniqueLm=Number(result?.lmStats?.uniqueRows||0);
        setLiveStatus(
          'ok',
          'Dados online',
          `${uniqueLm?`${fmtInt.format(uniqueLm)} BR únicos • `:''}Matinal + GEROT sincronizados ${new Date().toLocaleString('pt-BR')}`
        );
      }else{
        setLiveStatus(
          'loading',
          'Atualização parcial',
          `Matinal: ${lm} • GEROT: ${gerot}`
        );

        if(!silent){
          alert(
            'A atualização terminou parcialmente.\n'+
            `Matinal: ${lm}\n`+
            `GEROT: ${gerot}\n`+
            (finalRequest?.error||'')
          );
        }
      }

    }else if(finalStatus==='ERROR'){
      throw new Error(
        finalRequest?.error||
        'Apps Script não conseguiu atualizar.'
      );
    }else{
      setLiveStatus(
        'loading',
        'Atualização ainda na fila',
        'O pedido continua ativo.'
      );

      if(!silent){
        alert(
          'O pedido foi criado e continua na fila. '+
          'O Apps Script processa automaticamente.'
        );
      }
    }

  }catch(err){
    console.error(
      'Atualizar agora V6.7',
      err
    );

    setLiveStatus(
      'error',
      'Falha ao atualizar',
      err.message
    );

    if(!silent){
      alert(
        `Falha no Atualizar agora:\n${err.message}`
      );
    }
  }finally{
    state.forceRefreshing=false;

    if(btn){
      btn.disabled=false;
      btn.textContent=oldBtnText;
    }

    if(calBtn){
      calBtn.disabled=false;
      calBtn.textContent=oldCalText;
    }
  }
}

async function refreshLiveData({silent=false}={}){
  if(state.liveRefreshing)return;
  state.liveRefreshing=true;

  const btn=$('refreshDataBtn');
  if(btn)btn.disabled=true;
  setLiveStatus('loading','Atualizando...','Consultando histórico dinâmico da LM');

  try{
    const response=await fetch(`/api/dados?${periodQuery()}&t=${Date.now()}`,{
      headers:{'Accept':'application/json'},
      cache:'no-store'
    });

    let data={};
    try{data=await response.json()}catch{}

    if(!response.ok||!data.ok){
      throw new Error(data.error||`Falha ao carregar dados (${response.status}).`);
    }

    state.liveMeta=data.meta||{};
    syncPeriodControlsFromMeta();

    buildHCMap(data.hc||[]);
    loadTreatmentProgress();
    loadMisscanRows(data.misscan||[]);
    loadTreatmentRows(liveTreatmentRows());

    const syncStamp=
      state.liveMeta.receivedAt||
      state.liveMeta.updatedAt||
      state.liveMeta.generatedAt;
    const generated=syncStamp
      ?new Date(syncStamp).toLocaleString('pt-BR')
      :new Date().toLocaleString('pt-BR');

    setLiveStatus('ok','Dados online',`Atualizado ${generated}`);

    if($('hcSourceInfo')){
      $('hcSourceInfo').textContent=
        `${fmtInt.format(state.liveMeta.hcRecords??(data.hc||[]).length)} colaboradores • Base de HC 26`;
    }

    if($('misscanSourceInfo')){
      $('misscanSourceInfo').textContent=
        `${fmtInt.format((data.misscan||[]).length)} BR • LM`;
    }

    if($('dataWindowInfo')){
      $('dataWindowInfo').textContent=
        state.liveMeta.periodLabel||'período selecionado';
    }

    if($('historySourceInfo')){
      const active=Number(state.liveMeta.historyActiveDays||0);
      const totalRows=Number(state.liveMeta.historyRows||0);
      $('historySourceInfo').textContent=
        `${state.liveMeta.historyLabel||'—'}${active?` • ${fmtInt.format(active)} dias`:''}${totalRows?` • ${fmtInt.format(totalRows)} BR históricos`:''}`;
    }

    if($('dataNote')){
      const active=Number(state.liveMeta.historyActiveDays||0);
      const calendar=Number(state.liveMeta.historyCalendarDays||0);
      const months=Number(state.liveMeta.historyMonths||state.liveMeta.months?.length||0);
      const backfill=state.liveMeta.backfill||{};
      const backfillText=backfill.status==='RUNNING'
        ? ` • reconstrução do histórico em andamento${Number.isFinite(Number(backfill.progressPct))?` (${Number(backfill.progressPct).toLocaleString('pt-BR')}%)`:''}`
        : '';
      $('dataNote').textContent=
        `Histórico LM V6.12. ${fmtInt.format(state.raw.length)} BR únicos canônicos no período ${state.liveMeta?.periodLabel||'selecionado'}${active?` • ${fmtInt.format(active)} dias com Misscan no histórico`:''}${calendar?` • ${fmtInt.format(calendar)} dias de intervalo`:''}${months?` • ${fmtInt.format(months)} mês(es) indexado(s)`:''}${backfillText}.`;
    }
  }catch(err){
    console.error(err);
    setLiveStatus('error','Falha na atualização',err.message);
    if($('dataNote')){
      $('dataNote').textContent=
        `Não foi possível atualizar automaticamente: ${err.message}`;
    }
    if(!silent)alert(`Falha na atualização automática:\n${err.message}`);
  }finally{
    state.liveRefreshing=false;
    if(btn)btn.disabled=false;
  }
}

async function boot(){
  tabs();loadCalendarPreferences();restorePeriodPreference();
  await refreshLiveData({silent:true});
  await refreshCalendarizationV65({silent:true});
  filterIds.forEach(id=>$(id).addEventListener('change',applyFilters));
  $('operatorSearch').addEventListener('input',applyFilters);$('resetBtn').addEventListener('click',()=>resetFilterValues(true));$('exportBtn').addEventListener('click',exportFiltered);
  $('refreshDataBtn').addEventListener('click',()=>forceRefreshSourcesV67({silent:false}));
  $('applyPeriodBtn').addEventListener('click',applyPeriodFromControls);
  $('datePreset').addEventListener('change',()=>{
    state.datePreset=$('datePreset').value;
    if(state.datePreset!=='CUSTOM') applyPeriodFromControls();
  });
  ['dateFrom','dateTo'].forEach(id=>$(id).addEventListener('change',()=>{
    $('datePreset').value='CUSTOM';
    state.datePreset='CUSTOM';
  }));
  setInterval(()=>refreshLiveData({silent:true}),5*60*1000);
  document.querySelectorAll('.rank-pill').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.rank-pill').forEach(x=>x.classList.toggle('active',x===b));state.rankArea=b.dataset.rank;renderRanking()}));


  // Tratativas V4
  ['treatmentThreshold','treatTurnoFilter','treatSetorFilter','treatStatusFilter'].forEach(id=>$(id).addEventListener('change',renderTreatments));
  $('treatSearch').addEventListener('input',renderTreatments);
  $('treatResetBtn').addEventListener('click',()=>{$('treatmentThreshold').value='0.88';$('treatTurnoFilter').value='';$('treatSetorFilter').value='';$('treatStatusFilter').value='';$('treatSearch').value='';renderTreatments()});

  $('exportTreatBtn').addEventListener('click',exportTreatmentList);
  $('generateReportBtn').addEventListener('click',generateTreatmentReport);
  $('registerEvidenceBtn').addEventListener('click',openFirstPendingEvidence);
  $('closeTreatmentModal').addEventListener('click',closeModal);
  $('treatmentModal').addEventListener('click',e=>{if(e.target===$('treatmentModal'))closeModal()});
  $('saveDialogueBtn').addEventListener('click',saveDialogue);
  $('saveRecycleInfoBtn').addEventListener('click',saveRecycleInfo);
  $('completeRecycleBtn').addEventListener('click',completeRecycle);
  $('evidenceFile').addEventListener('change',async e=>{const f=e.target.files[0];if(f)await addEvidenceFile(f);e.target.value=''});
  document.querySelectorAll('.inner-tab').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.inner-tab').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.inner-view').forEach(v=>v.classList.toggle('active',v.id===b.dataset.inner));if(b.dataset.inner==='recycleEvidence')refreshEvidenceList();if(b.dataset.inner==='recycleHistory')renderTreatmentHistory();if(b.dataset.inner==='recycleSignatures'){refreshSignatureStatus();prepareSignatureCanvas()}}));
  const sigCanvas=$('signatureCanvas');['pointerdown'].forEach(ev=>sigCanvas.addEventListener(ev,sigStart));['pointermove'].forEach(ev=>sigCanvas.addEventListener(ev,sigMove));['pointerup','pointercancel','pointerleave'].forEach(ev=>sigCanvas.addEventListener(ev,sigEnd));
  $('clearSignatureBtn').addEventListener('click',clearSignature);$('saveSignatureBtn').addEventListener('click',saveSignature);

  $('refreshCalendarBtn').addEventListener('click',()=>forceRefreshSourcesV67({silent:false}));
  document.querySelectorAll('.rate-window-btn').forEach(b=>b.addEventListener('click',()=>{
    state.rateWindowDays=Number(b.dataset.days)||14;
    saveCalendarPreferences();
    updateRateWindowButtons();
    loadAutoRates({silent:false});
  }));
}
boot();
