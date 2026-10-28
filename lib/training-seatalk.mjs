import {runtimeBinding, readJson} from './blob-store.mjs';
import {OFFICIAL_PATH} from './official-source.mjs';
import {seatalkWindowOpen, sendSeatalkText} from './seatalk.mjs';
const schemas=new WeakMap();
const clean=value=>String(value||'').replace(/[\r\n\t]+/g,' ').trim();
const ops=value=>/^OPS\d+$/.test(clean(value).toUpperCase())?clean(value).toUpperCase():'';
const nameKey=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9 ]+/g,' ').replace(/\s+/g,' ');
const shift=value=>({T4:'T2',T5:'T3'}[clean(value).toUpperCase()]||clean(value).toUpperCase());
export function trainingNotificationSchema(db){
  if(schemas.has(db))return schemas.get(db);
  const ready=(async()=>{
    await db.prepare(`CREATE TABLE IF NOT EXISTS misscan_training_notifications (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, turn TEXT NOT NULL,
      content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL, claimed_at TEXT, sent_at TEXT,
      message_id TEXT, last_error TEXT NOT NULL DEFAULT ''
    )`).run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_training_notifications_pending ON misscan_training_notifications(status,turn,created_at)').run();
  })().catch(error=>{schemas.delete(db);throw error;});schemas.set(db,ready);return ready;
}
export async function trainingNotificationHC(){
  const official=await readJson(OFFICIAL_PATH,null);
  if(official)return official.hc||[];
  const legacy=await readJson('misscan/hc.json',null);
  return Array.isArray(legacy)?legacy:legacy?.rows||[];
}
function eligible(event){return event.type==='Reciclagem'&&event.status==='Realizada'&&/\bMIS\s*SCAN\b/.test(nameKey(event.topic));}
export function trainingGroupMessage(event,turn,participants,{part=1,parts=1,total=participants.length}={}){
  const date=/^\d{4}-\d{2}-\d{2}$/.test(event.date)?event.date.split('-').reverse().join('/'):clean(event.date);
  return [
    '🐕 Fiscal de Misscan MG4','', '✅ RECICLAGEM EM TURMA REGISTRADA','',
    `Turno: ${turn==='T3'?'T3 + T5':turn}`,`Data: ${date}`,
    `Tema: ${clean(event.topic)}`,`Instrutor: ${clean(event.instructor)}`,`Área: ${clean(event.area)}`,'',
    `👥 Participantes (${total})${parts>1?` — parte ${part}/${parts}`:''}:`,
    ...participants.map(p=>`• ${clean(p.name)} — ${ops(p.opsid)}`),'',
    '📋 Registro disponível no dashboard de MIS SCAN.',
    'O Diálogo de Performance é acompanhado separadamente.'
  ].join('\n');
}
// Route by the same HC Matinal as the dashboard, never by the ABS roster shift.
export function planTrainingNotifications(event,hc=[]){
  if(!eligible(event))return {messages:[],unrouted:[]};
  const byOps=new Map();for(const p of hc){const id=ops(p.opsid);if(!id)continue;if(!byOps.has(id))byOps.set(id,[]);byOps.get(id).push(p);}
  const groups=new Map(),unrouted=[],seen=new Set();
  for(const p of event.participants||[]){
    const id=ops(p.opsid);if(!id||seen.has(id))continue;seen.add(id);
    const records=byOps.get(id)||[];
    const turns=new Set(records.map(r=>shift(r.turno)));
    const names=new Set(records.map(r=>nameKey(r.colaborador)));
    const turn=[...turns][0];
    if(turns.size!==1||names.size!==1||!['T2','T3'].includes(turn)){unrouted.push({opsid:id,reason:'Turno/grupo não confirmado na HC Matinal'});continue;}
    if(!groups.has(turn))groups.set(turn,[]);groups.get(turn).push({...p,opsid:id});
  }
  const messages=[];
  for(const [turn,people] of groups){
    const chunks=[];let chunk=[];
    for(const p of people){
      const trial=trainingGroupMessage(event,turn,[...chunk,p],{total:people.length,part:999,parts:999});
      if(trial.length>7000&&chunk.length){chunks.push(chunk);chunk=[];}
      chunk.push(p);
      if(trainingGroupMessage(event,turn,chunk,{total:people.length,part:999,parts:999}).length>7000)throw new Error('Dados da turma excedem o limite do aviso SeaTalk.');
    }
    if(chunk.length)chunks.push(chunk);
    chunks.forEach((participants,i)=>messages.push({id:`${event.id}:${turn}:${i+1}`,eventId:event.id,turn,content:trainingGroupMessage(event,turn,participants,{total:people.length,part:i+1,parts:chunks.length})}));
  }
  return {messages,unrouted};
}
export function trainingNotificationStatements(db,plan,createdAt){
  return plan.messages.map(m=>db.prepare('INSERT OR IGNORE INTO misscan_training_notifications (id,event_id,turn,content,status,created_at) VALUES (?,?,?,?,?,?)').bind(m.id,m.eventId,m.turn,m.content,'PENDING',createdAt));
}
export async function trainingNotificationStatuses(db,eventId=''){
  const sql='SELECT id,event_id,turn,status,created_at,claimed_at,sent_at,last_error FROM misscan_training_notifications';
  const query=eventId?db.prepare(sql+' WHERE event_id=? ORDER BY id').bind(eventId):db.prepare(sql+' ORDER BY id');
  return (await query.all()).results||[];
}
export async function dispatchTrainingNotifications({db=runtimeBinding('MISSCAN_DB'),eventId='',turn='',now=new Date(),send=sendSeatalkText}={}){
  if(!db)return {sent:0,skipped:true,reason:'missing-database'};
  await trainingNotificationSchema(db);
  const allowed=['T2','T3'].filter(t=>(!turn||t===turn)&&seatalkWindowOpen(now,{turn:t}));
  if(!allowed.length)return {sent:0,skipped:true,reason:'outside-shift-window'};
  const rows=(await db.prepare("SELECT id,turn,content FROM misscan_training_notifications WHERE status='PENDING' AND turn IN ("+allowed.map(()=>'?').join(',')+")"+(eventId?' AND event_id=?':'')+' ORDER BY created_at,id LIMIT 10').bind(...allowed,...(eventId?[eventId]:[])).all()).results||[];
  let sent=0;
  for(const row of rows){
    // A concurrent request/cron may see the same queue. Claim atomically once.
    // Never automatically resend an ambiguous transmission after a timeout/crash.
    const claimed=await db.prepare("UPDATE misscan_training_notifications SET status='SENDING',claimed_at=? WHERE id=? AND status='PENDING' RETURNING id").bind(now.toISOString(),row.id).first();
    if(!claimed)continue;
    try{
      const result=await send(row.content,{turn:row.turn});
      if(result.ok&&!result.skipped){
        await db.prepare("UPDATE misscan_training_notifications SET status='SENT',sent_at=?,message_id=?,last_error='' WHERE id=?").bind(new Date().toISOString(),result.messageId||'',row.id).run();sent++;
      }else{
        await db.prepare("UPDATE misscan_training_notifications SET status='PENDING',last_error=? WHERE id=?").bind(clean(result.reason||'Envio adiado'),row.id).run();
      }
    }catch(error){
      await db.prepare("UPDATE misscan_training_notifications SET status='REVIEW',last_error=? WHERE id=?").bind(clean(error.message).slice(0,240),row.id).run();
    }
  }
  return {sent,checked:rows.length};
}
