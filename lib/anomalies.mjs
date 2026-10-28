export const ANOMALY_STATUSES={OPEN:'Aberta',IN_PROGRESS:'Em andamento',WAITING:'Aguardando validação',CLOSED:'Concluída'};
export const ANOMALY_PRIORITIES={NORMAL:'Normal',HIGH:'Alta',CRITICAL:'Crítica'};
export const anomalyKey=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
export function saoPauloDay(value=new Date()){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));const get=k=>parts.find(p=>p.type===k).value;return `${get('year')}-${get('month')}-${get('day')}`;
}
const validDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const text=(value,max=240)=>{const v=String(value||'').trim();if(v.length>max)throw new Error('Campo acima do limite.');return v;};
export function validateAnomalySignatures(body,reporter,oriented,now){
 const performed=body.orientationPerformed===true;
 if(body.orientationPerformed!=null&&typeof body.orientationPerformed!=='boolean')throw new Error('Informe se a orientação foi realizada.');
 if(!performed){if(body.signatures!=null)throw new Error('Confirme a orientação realizada antes de assinar.');return {orientationPerformed:false,signatures:null};}
 if(!oriented?.length)throw new Error('Informe o nome de quem recebeu a orientação.');
 let points=0;
 const signature=(value,name)=>{
  if(!value||value.name!==name||!Array.isArray(value.strokes)||!value.strokes.length||value.strokes.length>200)throw new Error('Assinatura obrigatória: '+name);
  let distance=0;
  const strokes=value.strokes.map(stroke=>{
   if(!Array.isArray(stroke)||stroke.length<2||stroke.length>2000)throw new Error('Traçado de assinatura inválido.');
   return stroke.map((p,i)=>{
    if(++points>20000||!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<0||p[0]>900||p[1]<0||p[1]>260)throw new Error('Assinatura inválida ou acima do limite.');
    if(i)distance+=Math.hypot(p[0]-stroke[i-1][0],p[1]-stroke[i-1][1]);return [...p];
   });
  });
  if(distance<10)throw new Error('Faça uma assinatura legível: '+name);
  return {name,strokes,recordedAt:now.toISOString()};
 };
 return {orientationPerformed:true,signatures:{instructor:signature(body.signatures?.instructor,reporter),recipients:oriented.map((name,i)=>signature(body.signatures?.recipients?.[i],name))}};
}
// Server timestamps do not participate in idempotent create comparisons.
export const anomalySignatureContent=value=>value?{instructor:{name:value.instructor.name,strokes:value.instructor.strokes},recipients:value.recipients.map(s=>({name:s.name,strokes:s.strokes}))}:null;
export function validateAnomaly(body,now=new Date()){
 const id=text(body.id,80);if(!/^[\w-]{16,80}$/.test(id))throw new Error('Identificador inválido.');
 const area=text(body.area),process=text(body.process),activity=text(body.activity),description=text(body.description,4000),reporter=text(body.reporter),leader=text(body.leader),theme=text(body.theme);
 if(!area||!process||!activity||!description||!reporter)throw new Error('Preencha área, processo, atividade, descrição e instrutor.');
 const raw=String(body.observedAt||'');if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(raw)||Number.isNaN(Date.parse(raw))||!validDay(raw.slice(0,10)))throw new Error('Data/hora da ocorrência inválida.');
 const observedAt=new Date(raw).toISOString();if(Date.parse(observedAt)>now.getTime()+60000)throw new Error('A ocorrência não pode estar no futuro.');
 const shift=String(body.shift||'').toUpperCase().trim();if(!['','T1','T2','T3','T4','T5'].includes(shift))throw new Error('Turno inválido.');
 const synergy=text(body.synergy);let oriented=null;
 if(body.oriented){const names=Array.isArray(body.oriented)?body.oriented:String(body.oriented).split(/[\r\n]+/);oriented=[...new Set(names.map(n=>text(n)).filter(Boolean))];if(oriented.length>100)throw new Error('Use até 100 nomes de orientados por registro.');if(!oriented.length)oriented=null;}
 const priority=body.priority||'NORMAL';if(!Object.hasOwn(ANOMALY_PRIORITIES,priority))throw new Error('Prioridade inválida.');
 const dueDate=text(body.dueDate);if(dueDate&&!validDay(dueDate))throw new Error('Prazo inválido.');
 const orientation=validateAnomalySignatures(body,reporter,oriented,now);
 return{...orientation,id,area,process,activity,theme,synergy,oriented,description,reporter,leader,shift:shift==='T4'?'T2':shift==='T5'?'T3':shift,priority,dueDate,observedAt,observedDate:saoPauloDay(observedAt),status:'OPEN',resolution:'',evidence:'',version:1,createdAt:now.toISOString(),updatedAt:now.toISOString(),history:[]};
}
export function updateAnomaly(row,body,now=new Date()){
 if(Number(body.version)!==row.version)throw Object.assign(new Error('Registro atualizado por outra pessoa. Recarregue antes de salvar.'),{status:409});
 const status=body.status,actor=text(body.actor),resolution=text(body.resolution,4000),evidence=text(body.evidence,2000);
 if(!Object.hasOwn(ANOMALY_STATUSES,status)||!actor)throw new Error('Informe situação e responsável pela atualização.');
 if(status==='CLOSED'&&(!resolution||!evidence))throw new Error('Para concluir, informe a ação realizada e a evidência da correção.');
 if(row.status==='CLOSED'&&status!=='CLOSED'&&!resolution)throw new Error('Informe o motivo da reabertura no campo de ação.');
 const at=now.toISOString(),item={at,actor,from:row.status,to:status,resolution,evidence};
 return{...row,status,resolution,evidence,version:row.version+1,updatedAt:at,history:[...(row.history||[]),item]};
}
export const anomalyGroup=row=>[row.area,row.process,row.activity].map(anomalyKey).join('|');
export function anomalyReport(rows,history=rows,{today=saoPauloDay()}={}){
 const groups=new Map(),shift=new Map(),area=new Map(),trend=new Map();let closed=0,overdue=0,afterClosure=0;
 const closures=new Map();for(const r of history){const k=anomalyGroup(r);if(!closures.has(k))closures.set(k,[]);for(const h of r.history||[])if(h.to==='CLOSED')closures.get(k).push({id:r.id,at:h.at});}
 const output=rows.map(r=>{
  const k=anomalyGroup(r),after=(closures.get(k)||[]).some(c=>c.id!==r.id&&c.at<r.observedAt);
  if(after)afterClosure++;if(r.status==='CLOSED')closed++;if(r.status!=='CLOSED'&&r.dueDate&&r.dueDate<today)overdue++;
  if(!groups.has(k))groups.set(k,{key:k,area:r.area,process:r.process,activity:r.activity,total:0,open:0,afterClosure:0,latest:'',days:new Set()});const g=groups.get(k);g.total++;g.open+=r.status!=='CLOSED'?1:0;g.afterClosure+=after?1:0;g.days.add(r.observedDate);if(r.observedAt>g.latest)g.latest=r.observedAt;
  for(const [map,key] of [[shift,r.shift||'Não informado'],[area,r.area],[trend,r.observedDate]])map.set(key,(map.get(key)||0)+1);
  return{...r,afterClosure:after,overdue:r.status!=='CLOSED'&&!!r.dueDate&&r.dueDate<today};
 });
 const ranking=[...groups.values()].map(g=>({...g,days:g.days.size,repeats:Math.max(0,g.total-1)})).sort((a,b)=>b.total-a.total||b.latest.localeCompare(a.latest));
 const series=map=>[...map].map(([label,total])=>({label,total})).sort((a,b)=>b.total-a.total);
 return{rows:output,summary:{total:rows.length,open:rows.length-closed,closed,overdue,repeatedActivities:ranking.filter(g=>g.total>1).length,repeats:ranking.reduce((n,g)=>n+g.repeats,0),afterClosure,withoutShift:shift.get('Não informado')||0},ranking,byShift:series(shift),byArea:series(area),trend:series(trend).sort((a,b)=>a.label.localeCompare(b.label)),definition:'Repetição: mesma área + processo + atividade, após normalização de letras/acentos/espaços. Após conclusão: nova ocorrência com data posterior à conclusão registrada de outra ocorrência do mesmo grupo. Não compara apenas o nome do processo.'};
}
export function validateAnomalyPeriod(from,to){if((from&&!validDay(from))||(to&&!validDay(to))||(from&&to&&from>to))throw new Error('Período inválido.');}
