(()=>{
  const $=id=>document.getElementById(id),overlay=$('treatmentAccessOverlay');if(!overlay)return;
  let pending=null,activePin='',epoch=0,previousFocus=null;
  function hide(){overlay.hidden=true;$('treatmentAccessPin').value='';$('treatmentAccessStatus').textContent='';$('treatmentAccessSubmit').disabled=false;document.body.style.overflow='';previousFocus?.focus?.();}
  function release(){epoch++;activePin='';if(pending){const resolve=pending;pending=null;resolve(false);}hide();}
  function request({label='Tratativa',collaborator=''}={}){
    release();previousFocus=document.activeElement;
    $('treatmentAccessTitle').textContent=label;
    $('treatmentAccessPerson').textContent=collaborator;
    overlay.hidden=false;document.body.style.overflow='hidden';$('treatmentAccessPin').focus();
    return new Promise(resolve=>{pending=resolve;});
  }
  $('treatmentAccessForm').onsubmit=async event=>{
    event.preventDefault();if(!pending||$('treatmentAccessSubmit').disabled)return;
    const pin=$('treatmentAccessPin').value.trim();if(!pin){$('treatmentAccessStatus').textContent='Informe o PIN de acesso.';return;}
    const ticket=epoch;$('treatmentAccessSubmit').disabled=true;$('treatmentAccessStatus').textContent='Validando acesso…';
    try{
      const response=await fetch('/api/treatment-access',{method:'POST',headers:{'x-treatment-pin':pin},cache:'no-store',signal:AbortSignal.timeout(12000)});
      const data=await response.json();if(ticket!==epoch)return;
      if(!response.ok||!data.ok)throw new Error(data.error||'Não foi possível validar o acesso.');
      activePin=pin;const resolve=pending;pending=null;hide();resolve(true);
    }catch(error){if(ticket!==epoch)return;$('treatmentAccessPin').value='';$('treatmentAccessStatus').textContent=error.name==='TimeoutError'?'A validação demorou. Tente novamente.':error.message;$('treatmentAccessPin').focus();}
    finally{if(ticket===epoch)$('treatmentAccessSubmit').disabled=false;}
  };
  $('treatmentAccessCancel').onclick=release;$('treatmentAccessClose').onclick=release;
  overlay.addEventListener('click',event=>{if(event.target===overlay)release();});
  overlay.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();release();}
    if(event.key==='Tab'){
      const fields=overlay.querySelectorAll('button:not([disabled]),input');const first=fields[0],last=fields[fields.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',release);
  globalThis.addEventListener?.('pagehide',release);
  globalThis.MisscanTreatmentAccess={request,pin:()=>activePin,release};
})();
