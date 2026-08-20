import { json } from '../lib/blob-store.mjs';
export async function GET(){return json({ok:true,service:'misscan-v6.2',architecture:'apps-script-push + private-history + auto-calendar',features:['historico','filtro-data','calendarizacao-automatica','tratativas','email-queue'],route:'/api/ping',timestamp:new Date().toISOString()});}
