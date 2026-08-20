import { json } from '../lib/blob-store.mjs';
export async function GET(){return json({
  ok:true,service:'misscan-v6.3',architecture:'apps-script-push + private-history + real-rate-engine',
  features:['historico','filtro-data','calendarizacao-automatica','taxa-real-automatica','T4->T2','T5->T3','email-queue'],
  route:'/api/ping',timestamp:new Date().toISOString()
});}
