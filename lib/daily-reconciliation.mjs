// Consulta derivada: encontrar uma tratativa não altera os registros originais,
// não conclui outras datas e não inicia um novo ciclo de reincidência.
export function reconcileDailyRows(rows,evidence,{dialogueDates=[],dialogueUpdatedAt='',today}={}){
  const byOps=new Map(),covered=new Set(dialogueDates),allocated=new Map();
  for(const item of evidence){if(!byOps.has(item.opsid))byOps.set(item.opsid,[]);byOps.get(item.opsid).push(item);}
  for(const row of rows)if(row.evidence?.key)allocated.set(row.evidence.key,row.id);
  for(const list of byOps.values())list.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  // Calcula a cobertura contígua uma vez, sem percorrer 120 dias por ocorrência.
  let completeFrom='9999-12-31';
  if(today&&covered.has(today)){
    let time=Date.parse(today+'T12:00:00Z');
    while(covered.has(new Date(time).toISOString().slice(0,10))){completeFrom=new Date(time).toISOString().slice(0,10);time-=86400000;}
  }
  const hasCoverage=from=>!!today&&from>=completeFrom&&from<=today;
  return rows.map(row=>{
    const all=byOps.get(row.opsid)||[];
    const after=all.filter(e=>e.date>=row.date),before=all.filter(e=>e.date<row.date);
    const compatible=after.filter(e=>e.type===row.actionType&&(!e.cycle||e.cycle===row.cycle));
    const unallocated=compatible.filter(e=>!allocated.has(e.key)||allocated.get(e.key)===row.id);
    const coverage=hasCoverage(row.date);
    let status,reason;
    if(!row.inSource){status='BLOCKED';reason='Ocorrência revisada na fonte: conferir antes de cobrar.';}
    else if(!row.opsid||!/^T[1-3]$/.test(row.turno)){status='BLOCKED';reason='OPSID ou turno não confirmado na HC Matinal.';}
    else if(row.proposal?.withdrawn||row.proposal?.terminal){status='BLOCKED';reason=row.proposal.review;}
    else if(row.state==='CLOSED'){
      status=evidence.some(e=>e.key===row.evidence?.key)?'LINKED':'UNKNOWN';
      reason=status==='LINKED'?'Tratativa vinculada a esta ocorrência.':'O vínculo foi preservado, mas a evidência não foi localizada na fonte atual.';
    }else if(unallocated.length){
      status='FOUND';reason='Tratativa localizada pelo mesmo OPSID, na data da ocorrência ou depois. Conferir vínculo/ciclo antes de encerrar; o registro não quita outras datas automaticamente.';
    }else if(compatible.length){
      status='UNKNOWN';reason='Registro compatível já vinculado a outra ocorrência; não reutilizar para encerrar esta data.';
    }else if(after.length){
      status='UNKNOWN';reason='Há tratativa após a ocorrência, mas o tipo ou ciclo exige conferência.';
    }else if(row.state==='PENDING'){
      status='PENDING';reason='Pendência registrada ou confirmada para esta ocorrência. Não foi localizada tratativa compatível nas fontes consultadas.';
    }else if(row.actionType==='dialogue'&&coverage){
      status='NOT_FOUND';reason='Nenhum diálogo MIS SCAN localizado para este OPSID entre a ocorrência e a data da consulta. Isso não comprova que a conversa não aconteceu.';
    }else{
      status='UNKNOWN';reason=row.actionType==='recycle'?'Nenhuma reciclagem compatível localizada na dashboard; conferir registros externos e ciclo.':'A fonte de diálogos ainda não cobre todos os dias entre a ocorrência e a consulta; não confirmar pendência por ausência de registro.';
    }
    const short=e=>({id:e.id,key:e.key,type:e.type,cycle:e.cycle||null,date:e.date,source:e.source,title:e.title,allocatedTo:allocated.get(e.key)||null});
    return {...row,reconciliation:{status,reason,dialogueCoverage:coverage,dialogueUpdatedAt,
      dialogues:after.filter(e=>e.type==='dialogue').map(short),recycles:after.filter(e=>e.type==='recycle').map(short),
      previousDialogues:before.filter(e=>e.type==='dialogue').slice(-3).map(short),previousRecycles:before.filter(e=>e.type==='recycle').slice(-3).map(short),
      compatibleIds:unallocated.map(e=>e.id),checkedThrough:today}};
  });
}
