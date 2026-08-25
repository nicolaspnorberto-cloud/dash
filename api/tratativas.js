const json=(res,status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body));};

function cfg(){
  const url=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_ANON_KEY||'';
  return {url,key,ok:!!(url&&key)};
}
function headers(key,extra={}){return {apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',...extra};}
async function sbFetch(path,options={}){const c=cfg();if(!c.ok)throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY na Vercel.');return fetch(`${c.url}${path}`,{...options,headers:{...headers(c.key),...(options.headers||{})}});}

module.exports=async function handler(req,res){
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end();}
  try{
    if(req.method==='GET'){
      const r=await sbFetch('/rest/v1/misscan_app_state?select=id,payload,updated_at&id=in.(treatment_progress,treatment_archive)',{method:'GET'});
      const rows=await r.json();if(!r.ok)throw new Error(rows?.message||'Falha ao consultar Supabase');
      const map=Object.fromEntries((rows||[]).map(x=>[x.id,x.payload||{}]));
      return json(res,200,{ok:true,progress:map.treatment_progress||{},archive:map.treatment_archive||{},shared:true});
    }
    if(req.method!=='POST')return json(res,405,{ok:false,error:'Método não permitido'});
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    if(body.action!=='save')return json(res,400,{ok:false,error:'Ação inválida'});
    const rows=[
      {id:'treatment_progress',payload:body.progress||{},updated_at:new Date().toISOString()},
      {id:'treatment_archive',payload:body.archive||{},updated_at:new Date().toISOString()}
    ];
    const r=await sbFetch('/rest/v1/misscan_app_state?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(rows)});
    if(!r.ok){const t=await r.text();throw new Error(t||'Falha ao salvar tratativas');}
    return json(res,200,{ok:true,shared:true,updatedAt:new Date().toISOString()});
  }catch(err){return json(res,503,{ok:false,error:err.message||String(err),shared:false});}
};
