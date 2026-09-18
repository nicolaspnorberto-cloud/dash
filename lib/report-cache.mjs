import { createReadCache } from './read-cache.mjs';
import { withReadContext, currentReadVersion, invalidateReadCache } from './blob-store.mjs';

// Cache de servidor por função/processo. Nunca habilita CDN público para dados pessoais.
export function withReportCache(handler,{ttlMs=120000,maxBytes=32*1024*1024}={}){
  const cache=createReadCache({ttlMs,maxBytes});
  return async function(request){
    const url=new URL(request.url);
    const fresh=url.searchParams.get('fresh')==='1';
    if(fresh){
      cache.clear();invalidateReadCache();
      return withReadContext({fresh:true},()=>handler(request));
    }
    const params=new URLSearchParams(url.searchParams);
    params.delete('t');params.sort();
    // Inclui dia para períodos móveis não cruzarem a meia-noite com resposta de ontem.
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const key=JSON.stringify([currentReadVersion(),day,url.pathname,params.toString(),
      request.headers.get('authorization')||'',request.headers.get('cookie')||'']);
    try{
      const result=await cache.read(key,async()=>{
        const response=await withReadContext({fresh:false},()=>handler(request));
        if(!response.ok){const error=new Error('Resposta não armazenável.');error.response=response;throw error;}
        return {status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()};
      });
      return new Response(result.body,{status:result.status,headers:result.headers});
    }catch(error){if(error.response)return error.response.clone();throw error;}
  };
}
