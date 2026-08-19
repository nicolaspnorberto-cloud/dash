function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store, max-age=0"
    }
  });
}

export async function GET(request){
  const endpoint=process.env.APPS_SCRIPT_EMAIL_URL;
  const token=process.env.EMAIL_WEBHOOK_TOKEN;

  if(!endpoint||!token){
    return json({
      ok:false,
      error:"Variáveis APPS_SCRIPT_EMAIL_URL e/ou EMAIL_WEBHOOK_TOKEN não configuradas."
    },500);
  }

  try{
    const reqUrl=new URL(request.url);
    const days=Math.max(1,Math.min(90,Number(reqUrl.searchParams.get("days")||35)));

    const upstreamUrl=new URL(endpoint);
    upstreamUrl.searchParams.set("action","data");
    upstreamUrl.searchParams.set("token",token);
    upstreamUrl.searchParams.set("days",String(days));
    upstreamUrl.searchParams.set("_t",String(Date.now()));

    const upstream=await fetch(upstreamUrl.toString(),{
      method:"GET",
      headers:{"accept":"application/json"},
      redirect:"follow",
      cache:"no-store"
    });

    const text=await upstream.text();
    let data;

    try{
      data=JSON.parse(text);
    }catch{
      return json({
        ok:false,
        error:"Apps Script não retornou JSON. Atualize a implantação com o Backend V5 e confirme a URL /exec.",
        upstreamStatus:upstream.status,
        upstreamPreview:text.slice(0,300)
      },502);
    }

    if(!upstream.ok||!data.ok){
      return json({
        ok:false,
        error:data.error||`Apps Script retornou HTTP ${upstream.status}.`
      },502);
    }

    return json(data,200);
  }catch(error){
    console.error("MISSCAN_DATA_API_ERROR",error);
    return json({
      ok:false,
      error:error?.message||"Falha ao consultar dados automáticos."
    },500);
  }
}
