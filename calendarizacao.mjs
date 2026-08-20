import { json, readJson } from '../lib/blob-store.mjs';
const PATH='misscan/calendarizacao.json';
export async function GET(){
  try{
    const data=await readJson(PATH,null);
    if(!data)return json({ok:false,error:'Planejamento ainda não sincronizado. Execute sincronizarCalendarizacaoV63() no Apps Script.'},503);
    return json(data,200);
  }catch(error){
    console.error('CALENDAR_READ_ERROR',error);
    return json({ok:false,error:error?.message||'Falha ao ler calendarização.'},500);
  }
}
