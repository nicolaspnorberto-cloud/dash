(function(root){
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('/'):value||'';
  function render(event={}){
    const participants=Array.isArray(event.participants)?event.participants:[];
    // Modelo oficial: revisão fixa; dados da atividade variam sem reutilizar os do exemplo.
    const notes=String(event.notes||'');
    // Cabeçalhos extensos recebem menos linhas para preservar texto e espaço de assinatura.
    const extraLines=Math.max(0,Math.ceil(String(event.topic||'').length/110)-1)+Math.max(0,Math.ceil(String(event.instructor||'').length/70)-1)+Math.max(0,Math.ceil(String(event.venue||'').length/35)-1)+Math.max(0,Math.ceil(notes.length/130)-2);
    const pageSize=Math.max(8,22-Math.ceil(extraLines/2));
    const pages=Math.max(1,Math.ceil(participants.length/pageSize));
    const assessment=event.assessment==='yes'?'[ X ] Sim [   ] Não':event.assessment==='no'?'[   ] Sim [ X ] Não':'[   ] Sim [   ] Não';
    return Array.from({length:pages},(_,page)=>{
      const slice=participants.slice(page*pageSize,(page+1)*pageSize);
      const cells=Array.from({length:pageSize},(_,i)=>{
        const p=slice[i];return `<tr><td>${page*pageSize+i+1}</td><td>${escape(p?.name)}</td><td>${escape(p?.role||event.attendanceRole||'')}</td><td></td></tr>`;
      }).join('');
      return `<section class="attendance-page"><table class="attendance-heading"><colgroup><col style="width:67%"><col style="width:11%"><col style="width:7%"><col style="width:15%"></colgroup><tbody><tr><th rowspan="2" class="attendance-title">LISTA DE PRESENÇA</th><th>Data Revisão</th><th>Revisão</th><th>Página</th></tr><tr><td>06/01/2026</td><td>02</td><td>${page+1}</td></tr></tbody></table><table class="attendance-details"><colgroup><col style="width:46%"><col style="width:21.5%"><col style="width:32.5%"></colgroup><tbody><tr><td colspan="3">Título do Treinamento: ${escape(event.topic)}</td></tr><tr><td>Data: ${escape(date(event.date))}</td><td>Horário início: ${escape(event.startTime)}</td><td>Carga Horária: ${event.duration?escape(event.duration)+' min':''}</td></tr><tr><td>Instrutor: ${escape(event.instructor)}</td><td>Local: ${escape(event.venue)}</td><td>Avaliação? ${assessment}</td></tr></tbody></table><div class="attendance-subjects">Assuntos Abordados: ${escape(notes)}</div><table class="attendance-participants"><colgroup><col style="width:4.2%"><col style="width:41.5%"><col style="width:21.5%"><col style="width:32.8%"></colgroup><thead><tr class="attendance-band"><td colspan="4"></td></tr><tr><th></th><th>Nome</th><th>Função</th><th>Assinatura</th></tr></thead><tbody>${cells}</tbody></table><div class="attendance-footer">${page+1}</div></section>`;
    }).join('');
  }
  root.MisscanAttendance={render};
})(globalThis);
