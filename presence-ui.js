(function(root){
  const opsid=value=>{
    const match=String(value||'').trim().toUpperCase().match(/^(?:OPS\s*:?\s*)?(\d+)$/);
    return match?'OPS'+match[1]:'';
  };
  const key=row=>opsid(row.opsid)+'|'+String(row.turno||'');
  function info(row,records,now=Date.now()){
    if(!opsid(row.opsid))return {status:'UNKNOWN',label:'Não confirmada',detail:'Sem OPSID válido',className:'unknown'};
    const record=records?.[key(row)];
    if(!record)return {status:'UNKNOWN',label:'Não confirmada',detail:'Consulte a ABS',className:'unknown'};
    if(!Number.isFinite(Date.parse(record.validUntil))||Date.parse(record.validUntil)<=now)return {status:'UNKNOWN',label:'Não confirmada',detail:'Atualize a consulta ABS',className:'unknown'};
    const date=String(record.dateKey||'').split('-').reverse().join('/');
    if(record.status==='PRESENT')return {status:'PRESENT',label:'Presente',detail:'ABS • '+date,className:'present'};
    if(record.status==='ABSENT')return {status:'ABSENT',label:'Ausente',detail:'ABS • '+date,className:'absent'};
    return {status:'UNKNOWN',label:'Não confirmada',detail:'ABS • '+date,className:'unknown'};
  }
  function matches(filter,presence,pending){
    return !filter||(filter==='PENDING_PRESENT'?pending&&presence.status==='PRESENT':presence.status===filter);
  }
  root.MisscanPresenceUI={opsid,key,info,matches};
})(typeof globalThis!=='undefined'?globalThis:window);
