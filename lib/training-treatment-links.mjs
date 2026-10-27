// Match shared class attendance to an existing individual treatment cycle.
// No name-only participant matching, recurrence advancement or dialogue completion.
// Class attendance counts independently of whether a dialogue was performed.
const key=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\[Ops\d+\]/gi,' ').toUpperCase().replace(/[^A-Z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
const ops=value=>/^OPS\d+$/.test(String(value||'').toUpperCase())?String(value).toUpperCase():'';
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))&&!Number.isNaN(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
export function linkTrainingTreatments({progress={},hc=[],events=[],today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}={}){
  const result=structuredClone(progress),links=[];
  const identities=new Map(),owners=new Map();
  for(const person of hc){const name=key(person.colaborador),id=ops(person.opsid);if(!name||!id)continue;if(!identities.has(name))identities.set(name,new Set());identities.get(name).add(id);if(!owners.has(id))owners.set(id,new Set());owners.get(id).add(name);}
  const eligible=events.filter(e=>e.type==='Reciclagem'&&e.status==='Realizada'&&validDate(e.date)&&e.date<=today&&/\bMIS\s*SCAN\b/.test(key(e.topic))).sort((a,b)=>a.date.localeCompare(b.date)||String(a.createdAt).localeCompare(String(b.createdAt))||String(a.id).localeCompare(String(b.id)));
  // A person may have class attendance before any individual action was saved.
  // Make that evidence visible without adding them to the offender ranking.
  const knownNames=new Set(Object.keys(result).map(key));
  for(const event of eligible)for(const person of event.participants||[]){
    const names=owners.get(ops(person.opsid));if(names?.size!==1)continue;
    const name=[...names][0];if(identities.get(name)?.size!==1||knownNames.has(name))continue;
    result[name]={requiredCycle:1,history:[]};knownNames.add(name);
  }
  const used=new Set();
  for(const p of Object.values(result))for(let c=1;c<=3;c++){const r=p?.['recycle'+c];if(r?.trainingEventId&&r?.trainingOpsid)used.add(r.trainingEventId+'|'+r.trainingOpsid);}
  // Do not pick a treatment arbitrarily if legacy IDs normalize to the same name.
  const idsByName=new Map();for(const id of Object.keys(result)){const name=key(id);if(!idsByName.has(name))idsByName.set(name,[]);idsByName.get(name).push(id);}
  for(const [id,p] of Object.entries(result)){
    if(p.removedFromScanning===true||p.suspended===true||/retirad[oa].{0,80}(bip|process)|removid[oa].{0,80}(bip|process)/i.test(JSON.stringify(p.history||[])))continue;
    const name=key(id),matches=identities.get(name);if(matches?.size!==1||idsByName.get(name)?.length!==1)continue;
    const opsid=[...matches][0];if(owners.get(opsid)?.size!==1)continue;
    const cycle=Number(p.requiredCycle)||1;if(!Number.isInteger(cycle)||cycle<1||cycle>3)continue;
    const d=p['dialogue'+cycle]||{},r=p['recycle'+cycle]||{};
    if(r.done)continue;
    // Earlier recyclings must be complete. A dialogue is an independent action.
    // Older classes cannot close a later recurrence.
    let floor='';let complete=true;
    for(let c=1;c<cycle;c++){const prior=p['recycle'+c]||{};if(!prior.done||!validDate(prior.date)){complete=false;break;}if(prior.date>floor)floor=prior.date;}
    if(!complete)continue;
    const event=eligible.find(e=>(!d.done||!validDate(d.date)||e.date>=d.date)&&(!floor||e.date>floor)&&!used.has(e.id+'|'+opsid)&&e.participants?.filter(person=>ops(person.opsid)===opsid).length===1);
    if(!event)continue;
    const at=event.createdAt||event.date+'T12:00:00Z';
    p['recycle'+cycle]={...r,done:true,infoSaved:true,date:event.date,responsible:event.instructor,topic:event.topic,orientation:event.notes||'',completedAt:at,updatedAt:at,trainingEventId:event.id,trainingOpsid:opsid,source:'TRAINING_ATTENDANCE'};
    // Updated timestamp must survive merging with browsers that already have a draft.
    p['recycle'+cycle].updatedAt=[at,r.updatedAt,d.updatedAt,p.updatedAt].filter(Boolean).sort().at(-1);
    p.updatedAt=[p.updatedAt,p['recycle'+cycle].updatedAt].filter(Boolean).sort().at(-1);
    p.history=[{at,title:`${cycle}ª reciclagem concluída em turma`,detail:`${event.topic} | ${event.date} | ${event.instructor} | Turma ${event.id} | ${opsid}`},...(p.history||[])].slice(0,100);
    used.add(event.id+'|'+opsid);links.push({id,opsid,cycle,eventId:event.id,date:event.date});
  }
  return {progress:result,links};
}
