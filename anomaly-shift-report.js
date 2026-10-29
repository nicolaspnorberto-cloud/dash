(function(global){
 const statuses={OPEN:'Aberta',IN_PROGRESS:'Em andamento',WAITING:'Aguardando validação',CLOSED:'Concluída'};
 const shiftOf=v=>v==='T4'?'T2':v==='T5'?'T3':v;
 const clean=v=>String(v??'').trim(),line=v=>clean(v).replace(/[\r\n]+/g,' / ');
 const key=v=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ');
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const stamp=v=>new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
 function period({start,end,shift}){
  const parse=value=>{if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value||''))throw new Error('Informe início e fim do recorte.');const at=Date.parse(value+'-03:00');if(!Number.isFinite(at)||new Date(at-3*3600000).toISOString().slice(0,16)!==value)throw new Error('Data ou horário inválido.');return at;};
  const from=parse(start),to=parse(end)+59999,normalized=shiftOf(shift);
  if(!['T1','T2','T3'].includes(normalized))throw new Error('Selecione o turno do relatório.');
  if(to<from||to-from>36*3600000)throw new Error('Use um intervalo de até 36 horas, com fim após o início.');
  return {start,end,shift:normalized,from,to};
 }
 function build(rows,options){
  const p=period(options),generatedAt=options.generatedAt||new Date().toISOString();
  const ids=new Set(),selected=[];
  for(const row of rows){if(shiftOf(row.shift)!==p.shift)continue;const at=Date.parse(row.observedAt);if(!Number.isFinite(at))throw new Error('Registro sem data válida. Revise a base antes de gerar o relatório.');if(at<p.from||at>p.to)continue;if(ids.has(row.id))throw new Error('Registro duplicado na consulta. Atualize antes de gerar o relatório.');ids.add(row.id);selected.push(row);}
  selected.sort((a,b)=>a.observedAt.localeCompare(b.observedAt)||a.id.localeCompare(b.id));
  const areas=new Map(),processes=new Map(),groups=new Map(),instructors=new Set(),people=new Set();let signed=0,orientationDeclared=0;
  const signedRows=new Set();
  for(const r of selected){const area=clean(r.area)||'Não informada',process=clean(r.process)||'Não informado';areas.set(area,(areas.get(area)||0)+1);processes.set(process,(processes.get(process)||0)+1);const k=[r.area,r.process,r.activity].map(key).join('|');if(!groups.has(k))groups.set(k,{area,process,activity:clean(r.activity)||'Não informada',total:0});groups.get(k).total++;if(clean(r.reporter))instructors.add(clean(r.reporter));
   if(r.orientationPerformed){orientationDeclared++;const sign=r.signatures,names=r.oriented||[];const valid=s=>!!clean(s?.name)&&Array.isArray(s.strokes)&&s.strokes.some(stroke=>stroke.length>=2);
    if(names.length&&valid(sign?.instructor)&&sign.instructor.name===r.reporter&&Array.isArray(sign.recipients)&&sign.recipients.length===names.length&&names.every((name,i)=>sign.recipients[i]?.name===name&&valid(sign.recipients[i]))){signed++;signedRows.add(r.id);names.forEach(name=>people.add(name));}
   }
  }
  const pending=selected.filter(r=>r.status!=='CLOSED'),closed=selected.length-pending.length,critical=pending.filter(r=>r.priority==='CRITICAL').length;
  const repeats=[...groups.values()].filter(g=>g.total>1).sort((a,b)=>b.total-a.total||a.activity.localeCompare(b.activity,'pt-BR'));
  const rank=map=>[...map].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'pt-BR')).map(([name,n])=>`• ${line(name)}: ${n}`);
  const label=p.shift==='T2'?'T2 + T4':p.shift==='T3'?'T3 + T5':'T1';
  const out=[`📋 RELATÓRIO DE GEMBA | COP MG4 | ${label}`,`Recorte: ${stamp(p.from)} a ${stamp(p.to)} · horário de São Paulo`,`Consulta: ${stamp(generatedAt)}`,'','🎯 RESUMO',`• Anomalias registradas: ${selected.length}`,`• Concluídas: ${closed}`,`• Pendentes: ${pending.length}`,`• Pendentes com prioridade crítica: ${critical}`,`• Áreas com registros: ${areas.size}`,`• Instrutores com registros: ${[...instructors].map(line).join('; ')||'Não informados'}`];
  if(!selected.length)out.push('','Nenhum registro de anomalia encontrado neste recorte e turno. Isso não confirma ausência de desvios ou realização de Gemba.');
  else{
   out.push('','📍 ÁREAS COM REGISTROS',...rank(areas),'','⚠️ PROCESSOS COM MAIS REGISTROS',...rank(processes),'','🔄 ATIVIDADES REPETIDAS NO RECORTE',...(repeats.length?repeats.map(g=>`• ${line(g.activity)} | ${line(g.area)} | ${line(g.process)}: ${g.total} registros; ${g.total-1} repetição(ões).`):['Nenhuma repetição da mesma área + processo + atividade neste recorte.']),'','🎓 ORIENTAÇÕES',`• Registros com orientação e assinaturas completas: ${signed}`,`• Orientações declaradas sem assinaturas completas: ${orientationDeclared-signed}`,`• Pessoas orientadas com assinatura: ${people.size} nomes distintos (sem deduplicação por OPSID).`);
   if(people.size)out.push(`• Nomes: ${[...people].map(line).join('; ')}`);
   out.push('','📝 OCORRÊNCIAS E AÇÕES REGISTRADAS');
   selected.forEach((r,i)=>{out.push('',`${i+1}. ${line(r.activity)} | #${r.id}`,`Data/hora: ${stamp(r.observedAt)} | Área: ${line(r.area)||'Não informada'}`,`Processo: ${line(r.process)||'Não informado'}`,`Fato/impacto: ${clean(r.description)||'Não informado'}`,`Situação atual: ${statuses[r.status]||'Não informada'}`,`Instrutor: ${line(r.reporter)||'Não informado'}`,`Responsável pela correção: ${line(r.leader)||'Não informado'}`,`Ação registrada: ${clean(r.resolution)||'Não informada'}`,`Evidência da correção: ${clean(r.evidence)||'Não informada'}`,`Orientação: ${signedRows.has(r.id)?'registrada com assinaturas completas':r.orientationPerformed?'declarada, assinaturas incompletas':'não confirmada no registro'}`,`Orientados informados: ${(r.oriented||[]).map(line).join('; ')||'Não informados'}`,`Anexos do registro: ${(r.attachments||[]).length}`);if(r.afterClosure)out.push('Base sinaliza ocorrência após conclusão anterior do mesmo grupo.');});
   out.push('','➡️ PASSAGEM DE TURNO — PENDÊNCIAS DESTE RECORTE',...(pending.length?pending.map(r=>`• #${r.id} | ${line(r.activity)} | ${line(r.area)||'Área não informada'} | ${statuses[r.status]||'Situação não informada'} | Responsável: ${line(r.leader)||'não informado'} | Ação registrada: ${line(r.resolution)||'não informada'}`):['Nenhuma pendência entre os registros deste recorte.']));
  }
  out.push('','ℹ️ CRITÉRIOS','Fonte: base própria de Anomalias MG4. Recorte pela data/hora da ocorrência e pelo turno informado. T4 consolidado no T2; T5 no T3. Outros filtros do painel não são aplicados.','Situações e ações refletem a consulta atual; não reconstituem o status no encerramento de um turno histórico. Pendências limitadas às ocorrências do recorte. Áreas listadas são áreas com registros, não comprovação de todas as áreas acompanhadas.','Repetição: mesma área + processo + atividade (letras, acentos e espaços normalizados). Orientados únicos por nome exato informado. Assinaturas e anexos permanecem na aba protegida.','Prévia para revisão do instrutor antes do envio.');
  return {text:out.join('\n'),total:selected.length,pending:pending.length,signed,people:people.size,period:p,shiftLabel:label};
 }
 function printMarkup(text){return `<article><header><span>COP MG4 · INSTRUTORIA DE PROCESSOS</span><h1>Relatório de Gemba</h1></header><pre>${esc(text)}</pre></article>`;}
 global.MisscanAnomalyShiftReport={period,build,printMarkup};
})(globalThis);
