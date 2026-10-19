import {readJson,writeJson} from './blob-store.mjs';
import {normalizeDialogueRecord,readDialogueRegistry} from './dialogues-realized.mjs';
import {saoPauloPresenceDate} from './abs-presence.mjs';
export const DAILY_DIALOGUES_PATH='misscan/daily-dialogue-history-import.json';
export const DAILY_DIALOGUES_SOURCE=Object.freeze({spreadsheetId:'1FcE0aiNzk4UZU5p0uGPikm8WWBrvpupF6_uBu-gLGd4',sheet:'Sheet1'});
export async function importDailyDialogues(snapshot,now=new Date()){
  if(!snapshot||Object.entries(DAILY_DIALOGUES_SOURCE).some(([k,v])=>snapshot.source?.[k]!==v))throw new Error('Utilize a planilha de Diálogos de Performance SOC MG4.');
  const valid=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  if(!valid(snapshot.from)||!valid(snapshot.to)||snapshot.from>snapshot.to||snapshot.to>=saoPauloPresenceDate(now))throw new Error('O histórico importado deve terminar até ontem; o dia atual vem da sincronização automática.');
  const span=Math.round((Date.parse(snapshot.to)-Date.parse(snapshot.from))/86400000)+1;
  const checked=Date.parse(snapshot.checkedAt);
  if(span>119||!Number.isFinite(checked)||checked>now.getTime()+300000||now.getTime()-checked>86400000)throw new Error('Leitura histórica inválida ou com mais de 24 horas.');
  if(!Array.isArray(snapshot.records)||snapshot.records.length>5000||snapshot.complete!==true)throw new Error('Informe uma leitura completa da planilha, com até 5.000 registros.');
  const byDate={};for(let time=Date.parse(snapshot.from+'T12:00:00Z');time<=Date.parse(snapshot.to+'T12:00:00Z');time+=86400000)byDate[new Date(time).toISOString().slice(0,10)]=[];
  const seen=new Set();let imported=0;
  for(const raw of snapshot.records){const record=normalizeDialogueRecord(raw);if(!record||!byDate[record.dateKey])continue;const key=record.dateKey+'|'+record.id;if(seen.has(key))continue;seen.add(key);byDate[record.dateKey].push(record);imported++;}
  await writeJson(DAILY_DIALOGUES_PATH,{source:DAILY_DIALOGUES_SOURCE,from:snapshot.from,to:snapshot.to,checkedAt:snapshot.checkedAt,byDate,imported});
  return {imported,coveredDays:span,checkedAt:snapshot.checkedAt};
}
export async function readDailyDialogueRegistry(){
  const live=await readDialogueRegistry(),historical=await readJson(DAILY_DIALOGUES_PATH,null);
  // A leitura histórica é completa até ontem; o dia atual e os novos dias
  // continuam vindo da sincronização já existente, sem alterar a base do bot.
  const byDate={...live.byDate,...historical?.byDate};
  return {byDate,updatedAt:live.updatedAt||historical?.checkedAt||'',historical:historical?{from:historical.from,to:historical.to,checkedAt:historical.checkedAt,imported:historical.imported}:null};
}
