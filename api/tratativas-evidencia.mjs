const json=(res,status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body));};
function cfg(){const url=(process.env.SUPABASE_URL||'').replace(/\/$/,'');const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';return {url,key,ok:!!(url&&key)};}
function h(key,extra={}){return {apikey:key,Authorization:`Bearer ${key}`,...extra};}
function safe(v=''){return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,100);}
async function q(path,opt={}){const c=cfg();if(!c.ok)throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY na Vercel.');return fetch(`${c.url}${path}`,{...opt,headers:{...h(c.key),...(opt.headers||{})}});}
export default async function handler(req,res){
  try{
    const c=cfg();if(!c.ok)throw new Error('Supabase não configurado para evidências.');
    if(req.method==='GET'){
      const id=String(req.query?.id||'');
      if(id){
        let r=await q(`/rest/v1/misscan_treatment_evidence?select=*&id=eq.${encodeURIComponent(id)}&limit=1`,{method:'GET'});let rows=await r.json();if(!r.ok)throw new Error(rows?.message||'Falha ao consultar evidência');const item=rows?.[0];if(!item)return json(res,404,{ok:false,error:'Arquivo não encontrado'});
        const out={id:item.id,treatmentId:item.treatment_id,cycle:item.cycle,kind:item.kind,signatureType:item.signature_type,name:item.name,type:item.mime_type,size:item.size,createdAt:item.created_at,storagePath:item.storage_path};
        if(String(req.query?.includeFile||'')==='1'){
          r=await q(`/storage/v1/object/misscan-evidencias/${item.storage_path}`,{method:'GET'});if(!r.ok)throw new Error('Falha ao baixar evidência');const buf=Buffer.from(await r.arrayBuffer());out.fileBase64=buf.toString('base64');
        }
        return json(res,200,{ok:true,item:out});
      }
      const tid=String(req.query?.treatmentId||'');const cycle=Number(req.query?.cycle||0);if(!tid||!cycle)return json(res,400,{ok:false,error:'treatmentId e cycle são obrigatórios'});
      const r=await q(`/rest/v1/misscan_treatment_evidence?select=*&treatment_id=eq.${encodeURIComponent(tid)}&cycle=eq.${cycle}&order=created_at.desc`,{method:'GET'});const rows=await r.json();if(!r.ok)throw new Error(rows?.message||'Falha ao listar evidências');
      return json(res,200,{ok:true,items:(rows||[]).map(item=>({id:item.id,treatmentId:item.treatment_id,cycle:item.cycle,kind:item.kind,signatureType:item.signature_type,name:item.name,type:item.mime_type,size:item.size,createdAt:item.created_at,storagePath:item.storage_path}))});
    }
    if(req.method!=='POST')return json(res,405,{ok:false,error:'Método não permitido'});
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    if(body.action==='delete'){
      let r=await q(`/rest/v1/misscan_treatment_evidence?select=storage_path&id=eq.${encodeURIComponent(body.id)}&limit=1`,{method:'GET'});let rows=await r.json();const path=rows?.[0]?.storage_path;if(path)await q('/storage/v1/object/misscan-evidencias',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[path]})});
      r=await q(`/rest/v1/misscan_treatment_evidence?id=eq.${encodeURIComponent(body.id)}`,{method:'DELETE'});if(!r.ok)throw new Error('Falha ao excluir metadado');return json(res,200,{ok:true});
    }
    if(body.action!=='save')return json(res,400,{ok:false,error:'Ação inválida'});
    if(!body.id||!body.treatmentId||!body.cycle||!body.fileBase64)return json(res,400,{ok:false,error:'Dados da evidência incompletos'});
    const bytes=Buffer.from(body.fileBase64,'base64');
    if(bytes.length>4*1024*1024)return json(res,413,{ok:false,error:'Arquivo acima de 4 MB. Reduza o arquivo antes de enviar.'});
    const path=`${safe(body.treatmentId)}/ciclo_${Number(body.cycle)}/${safe(body.id)}_${safe(body.name||'arquivo')}`;
    let r=await q(`/storage/v1/object/misscan-evidencias/${path}`,{method:'POST',headers:{'Content-Type':body.type||'application/octet-stream','x-upsert':'true'},body:bytes});if(!r.ok){const t=await r.text();throw new Error(t||'Falha no upload ao Storage');}
    const row={id:String(body.id),treatment_id:String(body.treatmentId),cycle:Number(body.cycle),kind:String(body.kind||'evidence'),signature_type:body.signatureType||null,name:String(body.name||'arquivo'),mime_type:String(body.type||'application/octet-stream'),size:Number(body.size||bytes.length),storage_path:path,created_at:body.createdAt||new Date().toISOString()};
    r=await q('/rest/v1/misscan_treatment_evidence?on_conflict=id',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(row)});if(!r.ok){const t=await r.text();throw new Error(t||'Falha ao salvar metadados');}
    return json(res,200,{ok:true,item:{id:row.id,treatmentId:row.treatment_id,cycle:row.cycle,kind:row.kind,signatureType:row.signature_type,name:row.name,type:row.mime_type,size:row.size,createdAt:row.created_at,storagePath:path}});
  }catch(err){return json(res,503,{ok:false,error:err.message||String(err)});}
};
