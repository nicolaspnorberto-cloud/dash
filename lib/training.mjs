export const ABS_SOURCE = {spreadsheetId:'1ltU2eLkym-ERSNyzvFsK0EyvKZT5kKUiHcY6PNiOxR8', sheetId:942845654, sheet:'COPPIT - ABS'};
export function parseCSV(text) {
  const rows=[]; let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++) { const c=text[i];
    if(c==='"') { if(quoted && text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted; }
    else if(c===','&&!quoted){row.push(cell);cell='';}
    else if(c==='\n'&&!quoted){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw new Error('CSV incompleto.');
  if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
  return rows;
}
export function validateRoster(rows) {
  if(!Array.isArray(rows)||!rows.length||rows.length>10000)throw new Error('Lista ABS inválida.');
  const seen=new Set();
  return rows.map(r=>{
    const p={name:String(r.name||'').trim(),opsid:String(r.opsid||'').trim().toUpperCase(),shift:String(r.shift||'').trim(),sector:String(r.sector||'').trim(),leader:String(r.leader||'').trim()};
    if(!p.name||!/^OPS\d+$/.test(p.opsid)||Object.values(p).some(v=>v.length>240))throw new Error('Nome ou OPSID inválido na lista ABS.');
    if(seen.has(p.opsid))throw new Error('OPSID duplicado na lista ABS: '+p.opsid);
    seen.add(p.opsid);return p;
  });
}
export function validateEvent(body,roster) {
  const field=k=>String(body[k]||'').trim();
  const id=field('id');if(!/^[\w-]{16,80}$/.test(id))throw new Error('Identificador inválido.');
  if(!field('topic')||!field('instructor')||!field('area'))throw new Error('Informe tema, instrutor e área.');
  const date=field('date');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw new Error('Data inválida.');
  if(!['Reciclagem','Treinamento','Orientação'].includes(body.type))throw new Error('Tipo inválido.');
  if(!Array.isArray(body.participants))throw new Error('Lista de participantes inválida.');
  const ids=[...new Set(body.participants)];if(!ids.length||ids.length>10000||body.presenceConfirmed!==true)throw new Error('Selecione e confirme os participantes.');
  const map=new Map(roster.map(p=>[p.opsid,p]));if(ids.some(id=>!map.has(id)))throw new Error('Participante não encontrado na lista ABS atual. Atualize a lista.');
  for(const key of ['topic','instructor','area','reason','notes'])if(field(key).length>2000)throw new Error('Campo acima do limite.');
  return {id,topic:field('topic'),instructor:field('instructor'),area:field('area'),reason:field('reason'),notes:field('notes'),type:body.type,date,participants:ids.map(id=>map.get(id)),createdAt:new Date().toISOString(),status:'Realizada',source:ABS_SOURCE};
}
