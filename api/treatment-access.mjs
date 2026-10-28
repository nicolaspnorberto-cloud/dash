import {envValue,json} from '../lib/blob-store.mjs';
// Validate the existing write PIN before exposing an individual editor.
// No treatment state is read or changed by this endpoint.
export async function POST(request){
  const expected=envValue('TREATMENT_WRITE_PIN');
  if(!expected)return json({ok:false,error:'Acesso não configurado. Procure o responsável pelo dashboard.'},503);
  const pin=String(request.headers.get('x-treatment-pin')||'').trim();
  if(!pin||pin!==expected)return json({ok:false,error:'PIN inválido. Tente novamente.'},401);
  return json({ok:true});
}
