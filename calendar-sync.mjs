import { assertSyncToken, json, writeJson } from '../lib/blob-store.mjs';
const PATH='misscan/calendarizacao.json';
export async function GET(){return json({ok:true,route:'/api/calendar-sync',method:'POST',version:'6.2'});}
export async function POST(request){
  try{
    assertSyncToken(request);
    const payload=await request.json();
    if(!payload||!Array.isArray(payload.rows))return json({ok:false,error:'Payload inválido: rows precisa ser array.'},400);
    const stored={ok:true,rows:payload.rows,meta:{...(payload.meta||{}),receivedAt:new Date().toISOString(),version:'6.2'}};
    await writeJson(PATH,stored);
    return json({ok:true,stored:true,rows:stored.rows.length,receivedAt:stored.meta.receivedAt});
  }catch(error){
    console.error('CALENDAR_SYNC_ERROR',error);
    return json({ok:false,error:error?.message||'Falha ao sincronizar calendarização.'},error?.status||500);
  }
}
