// Não persiste dados pessoais. A revisão vive apenas nesta aba.
globalThis.MisscanRefreshPolicy={
  create({check,refresh,visible=()=>true,blocked=()=>false,onError=()=>{},revision=''}){
    let current=revision,running=false;
    return {
      async tick(){
        if(running||!visible()||blocked())return false;
        running=true;
        try{
          const next=await check();
          if(!next)throw new Error('Versão da base indisponível.');
          if(next===current)return false;
          if(!visible()||blocked())return false;
          if(await refresh()===true){current=next;return true;}
          return false;
        }catch(error){onError(error);return false;}
        finally{running=false;}
      },
      invalidate(){current='';}
    };
  }
};
