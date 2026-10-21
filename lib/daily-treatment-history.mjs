import {readDailyDialogueRegistry} from './daily-dialogue-history.mjs';
import {runtimeBinding,readJson,writeJson,normalizeName} from './blob-store.mjs';
import {OFFICIAL_PATH,officialWeight} from './official-source.mjs';
import {normalizeOpsId,normalizeDialogueDate} from './dialogues-realized.mjs';
import {saoPauloPresenceDate} from './abs-presence.mjs';
import {validOperators} from '../api/dados.mjs';

export const DAILY_CONFIG='misscan/daily-treatment-history-config.json';
const turn=value=>String(value||'').trim().toUpperCase().replace(/^T4$/,'T2').replace(/^T5$/,'T3');
const validDay=text=>/^\d{4}-\d{2}-\d{2}$/.test(text)&&Number.isFinite(Date.parse(text+'T12:00:00Z'))&&new Date(text+'T12:00:00Z').toISOString().slice(0,10)===text;
const day=value=>{
  const text=String(value||'');
  if(!text)return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(text)||/^\d{2}\/\d{2}\/\d{4}$/.test(text)){const result=normalizeDialogueDate(text);return validDay(result)?result:'';}
  const time=Date.parse(text);return Number.isFinite(time)?saoPauloPresenceDate(new Date(time)):'';
};
export const actionText=(type,cycle)=>type==='dialogue'?`${cycle}º Diálogo de Performance`:`${cycle}ª Reciclagem`;
export async function dailySchema(){
  const db=runtimeBinding('MISSCAN_DB');if(!db)throw new Error('Banco compartilhado indisponível.');
  await db.prepare(`CREATE TABLE IF NOT EXISTS misscan_daily_treatments (
    id TEXT PRIMARY KEY, occurrence_date TEXT NOT NULL, opsid TEXT NOT NULL,
    metadata TEXT NOT NULL, state TEXT NOT NULL, action_type TEXT NOT NULL,
    cycle INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 0, in_source INTEGER NOT NULL DEFAULT 1,
    evidence_key TEXT UNIQUE, evidence TEXT, audit TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`).run();
  return db;
}
function unpack(row){return {...JSON.parse(row.metadata),id:row.id,date:row.occurrence_date,opsid:row.opsid,state:row.state,actionType:row.action_type,cycle:row.cycle,version:row.version,inSource:!!row.in_source,evidence:row.evidence?JSON.parse(row.evidence):null,audit:JSON.parse(row.audit),createdAt:row.created_at,updatedAt:row.updated_at};}
export async function dailyRows(db){const result=await db.prepare('SELECT * FROM misscan_daily_treatments ORDER BY occurrence_date DESC, opsid').all();return(result.results||[]).map(unpack);}
async function optionalRows(db,sql){try{return(await db.prepare(sql).all()).results||[];}catch(error){if(/no such table/i.test(error.message))return[];throw error;}}

function identityFromMatches(matches){
  const ids=new Set(matches.map(p=>normalizeOpsId(p.opsid)).filter(Boolean));
  if(ids.size!==1)return null;
  const profiles=new Set(matches.map(p=>JSON.stringify([turn(p.turno),p.lider_nome||'',p.setor||''])));
  if(profiles.size!==1)return null;
  return {...matches[0],opsid:[...ids][0],turno:turn(matches[0].turno)};
}
export function hcIdentity(hc,name,opsid=''){
  return identityFromMatches(opsid?hc.filter(p=>normalizeOpsId(p.opsid)===opsid):hc.filter(p=>normalizeName(p.colaborador)===normalizeName(name)));
}
function identityLookup(hc){
  const byName=new Map(),byOps=new Map();
  for(const person of hc){
    for(const [map,key]of [[byName,normalizeName(person.colaborador)],[byOps,normalizeOpsId(person.opsid)]]){
      if(!map.has(key))map.set(key,[]);map.get(key).push(person);
    }
  }
  // Resolve duplicidades com os mesmos critérios da busca individual.
  for(const map of [byName,byOps])for(const [key,matches]of map)map.set(key,identityFromMatches(matches));
  return (name,opsid='')=>opsid?byOps.get(opsid):byName.get(normalizeName(name));
}
export function nextDailyAction(progress={},prior=[],date){
  const withdrawn=progress.removedFromScanning===true||progress.suspended===true||/retirad[oa].{0,80}(bip|process)|removid[oa].{0,80}(bip|process)/i.test(JSON.stringify(progress.history||[]));
  if(withdrawn)return {type:'dialogue',cycle:Math.max(1,Number(progress.requiredCycle)||1),review:'Histórico de retirada/suspensão do processo: validar antes de nova tratativa.',withdrawn:true};
  let next=0;
  for(let cycle=1;cycle<=3;cycle++)for(const type of ['dialogue','recycle']){
    const item=progress[type+cycle]||{};
    if(!item.done)continue;
    const dateDone=day(item.date||item.completedAt||item.updatedAt);
    if(!dateDone||dateDone>=date)return {type,cycle,review:'Tratativa existente sem sequência temporal suficiente para esta ocorrência.'};
    const index=(cycle-1)*2+(type==='recycle'?1:0);
    if(index>next)return {type,cycle,review:'Sequência anterior de tratativas incompleta; validar ciclo.'};
    next=Math.max(next,index+1);
  }
  for(const row of prior.filter(r=>r.state==='CLOSED'&&r.evidence?.date<date))next=Math.max(next,(row.cycle-1)*2+(row.actionType==='recycle'?2:1));
  if(next>=6)return {type:'recycle',cycle:3,terminal:true,review:'Três ciclos concluídos: validar a destinação operacional; não reiniciar o fluxo.'};
  if(Number(progress.requiredCycle)>Math.floor(next/2)+1)return {type:'dialogue',cycle:Number(progress.requiredCycle),review:'Ciclo registrado exige conferência do histórico anterior.'};
  return {type:next%2?'recycle':'dialogue',cycle:Math.floor(next/2)+1,review:''};
}

export function dailyShareTotals(official,identity=identityLookup(official.hc||[])){
  const totals={};
  for(const row of official.rows||[]){
    const date=row.lmreceived_date;if(!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
    const scope=totals[date]||(totals[date]={total:0,turns:{}}),weight=officialWeight(row);scope.total+=weight;
    const operators=validOperators(row.operator_fail);if(operators.length!==1)continue;
    const person=identity(operators[0].name,normalizeOpsId(operators[0].opsid));
    if(person&&/^T[1-3]$/.test(person.turno))scope.turns[person.turno]=(scope.turns[person.turno]||0)+weight;
  }
  return totals;
}
export function dailyCandidates(official,trackingStart,progress={},prior=[],today=saoPauloPresenceDate(),range={}){
  const identity=identityLookup(official.hc||[]),shares=dailyShareTotals(official,identity);
  const totals=new Map(),groups=new Map();
  const byProgressOps=new Map(),byProgressName=new Map(),priorByOps=new Map();
  for(const [key,value]of Object.entries(progress)){
    const entry=[key,value];for(const [map,id]of [[byProgressOps,normalizeOpsId(value.opsid)],[byProgressName,normalizeName(key)]]){if(!map.has(id))map.set(id,[]);map.get(id).push(entry);}
  }
  for(const record of prior){if(!priorByOps.has(record.opsid))priorByOps.set(record.opsid,[]);priorByOps.get(record.opsid).push(record);}
  const validDates=new Map();
  for(const row of official.rows||[]){
    const date=row.lmreceived_date;if(!validDates.has(date))validDates.set(date,validDay(date));
    if(!validDates.get(date)||date>=today||(range.from&&date<range.from)||(range.to&&date>range.to))continue;
    totals.set(date,(totals.get(date)||0)+officialWeight(row));
    const operators=validOperators(row.operator_fail);if(operators.length!==1)continue;
    const op=operators[0],person=identity(op.name,normalizeOpsId(op.opsid));
    const opsid=person?.opsid||'',id=`${date}|${opsid||'NAME:'+normalizeName(op.name)}`;
    if(!groups.has(id))groups.set(id,{id,date,opsid,name:op.name,turno:person?.turno||'Não confirmado',leader:person?.lider_nome||'Não confirmado',sector:person?.setor||'Não confirmado',count:0});
    groups.get(id).count+=officialWeight(row);
  }
  return [...groups.values()].map(row=>{
    const indicator=row.count/(totals.get(row.date)||1)*100;
    const matches=[...new Set([...(row.opsid?byProgressOps.get(row.opsid)||[]:[]),...(byProgressName.get(normalizeName(row.name))||[])])];
    const proposal=nextDailyAction(matches.length===1?matches[0][1]:{},row.opsid?priorByOps.get(row.opsid)||[]:[],row.date);
    const reason=!row.opsid?'OPSID/cadastro HC ausente ou ambíguo.':!/^T[1-3]$/.test(row.turno)?'Turno não confirmado na HC.':row.date<trackingStart?'Histórico anterior à ativação: conferir os registros antes de classificar.':matches.length>1?'Mais de um histórico de tratativas para a mesma identidade.':proposal.review;
    const shareTotal=shares[row.date]||{turns:{}};const turnTotal=shareTotal.turns[row.turno]||0;
    return {...row,indicator,totalDay:shareTotal.total,turnTotal,turnIndicator:turnTotal>0?row.count/turnTotal*100:null,proposal:{...proposal,review:reason},state:reason?'REVIEW':'PENDING'};
  }).filter(row=>row.indicator>0.88||row.turnIndicator>0.88);
}

export async function dailyEvidence(db,official,progressRows){
  const registry=await readDailyDialogueRegistry(),all=[],identity=identityLookup(official.hc||[]),today=saoPauloPresenceDate();
  for(const [date,items]of Object.entries(registry.byDate||{}))for(const item of items){
    const opsid=normalizeOpsId(item.opsid);if(opsid)all.push({id:'dialogue:'+item.id,opsid,type:'dialogue',date,source:'Planilha de Diálogo de Performance',title:'Diálogo MIS SCAN',key:`${opsid}|dialogue|${date}`});
  }
  const trainings=await optionalRows(db,'SELECT payload FROM misscan_training_events');
  for(const value of trainings){const event=JSON.parse(value.payload);if(event.type!=='Reciclagem'||!(/MIS{1,2}\s*[-_]?\s*SCAN/i.test(event.topic+' '+event.reason)))continue;
    for(const person of event.participants||[]){const opsid=normalizeOpsId(person.opsid);if(opsid)all.push({id:`training:${event.id}:${opsid}`,opsid,type:'recycle',date:event.date,source:'Reciclagens',title:event.topic,key:`${opsid}|recycle|${event.date}`});}
  }
  for(const record of progressRows){const value=JSON.parse(record.payload);const person=identity(record.id,normalizeOpsId(value.opsid));if(!person)continue;
    for(let cycle=1;cycle<=3;cycle++)for(const type of ['dialogue','recycle']){const step=value[type+cycle]||{},date=day(step.date||step.completedAt||step.updatedAt);if(step.done&&date)all.push({id:`progress:${record.id}:${type}${cycle}:${date}`,opsid:person.opsid,type,cycle,date,source:'Tratativas registradas',title:actionText(type,cycle),key:`${person.opsid}|${type}|${date}`});}
  }
  const unique=new Map();
  for(const item of all)if(validDay(item.date)&&item.date<=today&&!unique.has(item.key))unique.set(item.key,item);
  return [...unique.values()];
}
export async function syncDailyHistory(official,{activate=false,from,to}={}){
  let config=await readJson(DAILY_CONFIG,null);
  if(!config&&!activate)return {active:false};
  const db=await dailySchema();
  if(!config){config={trackingStart:saoPauloPresenceDate(),createdAt:new Date().toISOString()};await writeJson(DAILY_CONFIG,config);}
  const old=await dailyRows(db),progressRows=await optionalRows(db,"SELECT id,payload FROM misscan_treatment_state WHERE scope='progress'");
  const progress=Object.fromEntries(progressRows.map(r=>[r.id,JSON.parse(r.payload)]));
  const evidence=await dailyEvidence(db,official,progressRows);
  const allocated=new Set(old.map(r=>r.evidence?.key).filter(Boolean));
  const unboundOps=new Set(evidence.filter(e=>!allocated.has(e.key)).map(e=>e.opsid));
  const rows=dailyCandidates(official,config.trackingStart,progress,old,saoPauloPresenceDate(),{from,to}),seen=new Set(rows.map(r=>r.id)),now=new Date().toISOString(),revisions=[],imports=[];
  for(const row of rows){
    // Um registro já existente sem vínculo não é prova de ausência de tratativa.
    if(row.state==='PENDING'&&unboundOps.has(row.opsid)){row.state='REVIEW';row.proposal.review='Há tratativa registrada sem vínculo com uma ocorrência; conferir antes de cobrar.';}
    const metadata=JSON.stringify(row);
    imports.push({id:row.id,date:row.date,opsid:row.opsid,metadata,state:row.state,type:row.proposal.type,cycle:row.proposal.cycle,
      audit:JSON.stringify([{at:now,action:'IMPORTED',detail:row.proposal.review||'Ocorrência capturada após ativação.'}])});
  }
  for(const row of old)if(row.inSource&&!seen.has(row.id)&&row.date>=official.meta.historyStart&&row.date<=official.meta.historyEnd&&(!from||row.date>=from)&&(!to||row.date<=to)){
    const audit=[...row.audit,{at:now,action:'SOURCE_REVISED',detail:'Ocorrência não está acima do corte na fonte atual; validar correção.'}];
    revisions.push({id:row.id,version:row.version,audit:JSON.stringify(audit)});
  }
  // Um parâmetro JSON por lote: centenas de ocorrências não podem gerar
  // centenas de consultas D1 na mesma invocação (limite do plano gratuito).
  for(let i=0;i<imports.length;i+=100)await db.prepare(`INSERT INTO misscan_daily_treatments
    (id,occurrence_date,opsid,metadata,state,action_type,cycle,audit,created_at,updated_at)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.date'),json_extract(value,'$.opsid'),
      json_extract(value,'$.metadata'),json_extract(value,'$.state'),json_extract(value,'$.type'),
      json_extract(value,'$.cycle'),json_extract(value,'$.audit'),?2,?2
    FROM json_each(?1) WHERE true
    ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata,in_source=1
    WHERE misscan_daily_treatments.metadata<>excluded.metadata OR misscan_daily_treatments.in_source<>1`)
    .bind(JSON.stringify(imports.slice(i,i+100)),now).run();
  for(let i=0;i<revisions.length;i+=100)await db.prepare(`WITH revised AS (
    SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.version') AS version,
      json_extract(value,'$.audit') AS audit FROM json_each(?1)
  ) UPDATE misscan_daily_treatments SET in_source=0,state=CASE WHEN state='CLOSED' THEN state ELSE 'REVIEW' END,
    audit=(SELECT audit FROM revised WHERE revised.id=misscan_daily_treatments.id),version=version+1,updated_at=?2
    WHERE EXISTS(SELECT 1 FROM revised WHERE revised.id=misscan_daily_treatments.id AND revised.version=misscan_daily_treatments.version)`)
    .bind(JSON.stringify(revisions.slice(i,i+100)),now).run();
  return {active:true,config,records:rows.length,sourceUpdatedAt:official.meta.receivedAt};
}

export async function changeDailyRecord(db,body,rows,evidence){
  const row=rows.find(r=>r.id===body.id);if(!row)throw new Error('Ocorrência não encontrada.');
  if(row.version!==body.version)throw Object.assign(new Error('Registro atualizado por outra pessoa. Recarregue antes de salvar.'),{status:409});
  if(!row.opsid||!row.inSource||row.proposal.withdrawn||row.proposal.terminal)throw new Error('Identidade/fonte, retirada do processo ou fluxo esgotado exige validação; não iniciar nova cobrança.');
  if(row.state==='CLOSED')throw new Error('Ocorrência já concluída. O vínculo existente será preservado.');
  const actor=String(body.actor||'').trim(),note=String(body.note||'').trim();
  if(actor.length<3||actor.length>120||note.length<10||note.length>1000||body.confirmed!==true)throw new Error('Informe responsável, justificativa e confirmação da conferência.');
  const cycle=Number(body.cycle),type=body.type;
  if(!Number.isInteger(cycle)||cycle<1||cycle>3||!['dialogue','recycle'].includes(type))throw new Error('Tratativa/ciclo inválido.');
  if(row.state==='PENDING'&&(cycle!==row.cycle||type!==row.actionType))throw new Error('A tratativa deve respeitar a ação pendente registrada.');
  const now=new Date().toISOString();let linked=null,state='PENDING';
  if(body.action==='link'){
    linked=evidence.find(e=>e.id===body.evidenceId&&e.opsid===row.opsid&&e.type===type&&(!e.cycle||e.cycle===cycle));
    if(!linked||linked.date<row.date)throw new Error('Selecione uma tratativa válida do mesmo OPSID, compatível e na data da ocorrência ou posterior.');
    if(rows.some(r=>r.evidence?.key===linked.key))throw Object.assign(new Error('Esta tratativa já está vinculada a outra ocorrência.'),{status:409});
    state='CLOSED';
  }else if(body.action!=='confirm-pending'||row.state!=='REVIEW')throw new Error('Ação não permitida para este registro.');
  const audit=[...row.audit,{at:now,action:state==='CLOSED'?'LINKED':'PENDING_CONFIRMED',actor,note,type,cycle,...(linked?{evidenceId:linked.id}:{} )}];
  const saved=await db.prepare(`UPDATE misscan_daily_treatments SET state=?,action_type=?,cycle=?,evidence_key=?,evidence=?,audit=?,version=version+1,updated_at=? WHERE id=? AND version=? RETURNING id`)
    .bind(state,type,cycle,linked?.key||null,linked?JSON.stringify(linked):null,JSON.stringify(audit),now,row.id,row.version).first();
  if(!saved)throw Object.assign(new Error('Conflito de atualização; recarregue o histórico.'),{status:409});
  return {id:row.id,state};
}

export async function dailyContext(db){
  const official=await readJson(OFFICIAL_PATH,null);if(!official?.rows?.length)throw new Error('Fonte oficial MG4 indisponível.');
  const progress=await optionalRows(db,"SELECT id,payload FROM misscan_treatment_state WHERE scope='progress'");
  const registry=await readDailyDialogueRegistry();
  return {official,evidence:await dailyEvidence(db,official,progress),dialogueDates:Object.keys(registry.byDate||{}),dialogueUpdatedAt:registry.updatedAt,dialogueHistorical:registry.historical};
}
