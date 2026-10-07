import {assertSyncToken,json,readJson,writeJson} from '../lib/blob-store.mjs';
import {ABS_SOURCE,validateRoster} from '../lib/training.mjs';
export async function POST(request){
  try {
    assertSyncToken(request);
    const text=await request.text();if(text.length>3000000)return json({ok:false,error:'Lista acima do limite.'},413);
    const body=JSON.parse(text);
    if(body.source?.spreadsheetId!==ABS_SOURCE.spreadsheetId||body.source?.sheetId!==ABS_SOURCE.sheetId||body.source?.sheet!==ABS_SOURCE.sheet)throw new Error('Fonte ABS divergente.');
    const rows=validateRoster(body.rows);
    const stamp=String(body.generatedAt||'');const time=Date.parse(stamp);
    if(!Number.isFinite(time)||Math.abs(Date.now()-time)>60*60*1000)throw new Error('Data da sincronização inválida ou desatualizada.');
    const previous=await readJson('misscan/training-roster.json',null);
    if(previous?.generatedAt && stamp<previous.generatedAt)return json({ok:false,error:'Sincronização anterior à lista atual.'},409);
    const roster={rows,source:ABS_SOURCE,generatedAt:stamp,updatedAt:new Date().toISOString(),syncMethod:'APPS_SCRIPT',intervalMinutes:30};
    await writeJson('misscan/training-roster.json',roster);
    return json({ok:true,records:rows.length,updatedAt:roster.updatedAt});
  }catch(e){return json({ok:false,error:e.message},e.status||400);}
}
