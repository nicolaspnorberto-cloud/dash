(()=>{
 const count=(rows,key,fallback='Não informado')=>{const map=new Map();for(const row of rows){const label=String(row[key]||fallback);map.set(label,(map.get(label)||0)+1);}return [...map].map(([label,total])=>({label,total})).sort((a,b)=>b.total-a.total||a.label.localeCompare(b.label,'pt-BR'));};
 function series(rows,key){const map=new Map();for(const r of rows){const label=key(r);map.set(label,(map.get(label)||0)+1);}return [...map].map(([label,total])=>({label,total})).sort((a,b)=>a.label.localeCompare(b.label));}
 function isoWeek(day){const d=new Date(day+'T00:00:00Z');const wd=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()+4-wd);const year=d.getUTCFullYear(),first=new Date(Date.UTC(year,0,1));return `${year}-W${String(Math.ceil((((d-first)/86400000)+1)/7)).padStart(2,'0')}`;}
 function build(rows=[],ranking=[]){const byLeader=count(rows,'leader'),byProcess=count(rows,'process'),byReporter=count(rows,'reporter');const repeated=new Map();for(const group of ranking)repeated.set(group.process,(repeated.get(group.process)||0)+(group.repeats||0));
  const processes=[...repeated].map(([label,total])=>({label,total})).filter(r=>r.total>0).sort((a,b)=>b.total-a.total);
  const weekdays=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];const wd=new Map();for(const r of rows){const i=(new Date(r.observedDate+'T12:00:00Z').getUTCDay()+6)%7;wd.set(i,(wd.get(i)||0)+1);}
  return{byLeader,byProcess,byReporter,repeatedProcesses:processes,monthly:series(rows,r=>r.observedDate.slice(0,7)),weekly:series(rows,r=>isoWeek(r.observedDate)),dayOfMonth:series(rows,r=>r.observedDate.slice(8,10)),weekday:weekdays.map((label,i)=>({label,total:wd.get(i)||0})),topActivity:ranking.find(r=>r.repeats>0)||null};
 }
 globalThis.MisscanAnomalyPresentation={build,isoWeek};
})();
