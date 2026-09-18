// Cache apenas de leitura. Nunca guarda erros nem filas mutáveis.
export function createReadCache({ttlMs=120000, maxBytes=64*1024*1024, maxEntries=128, now=Date.now}={}) {
  const entries=new Map(), pending=new Map();
  let bytes=0, generation=0;
  function clear(){entries.clear();pending.clear();bytes=0;generation++;}
  function remove(key){const entry=entries.get(key);if(entry){bytes-=entry.bytes;entries.delete(key);}}
  async function read(key, loader) {
    const hit=entries.get(key);
    if(hit && hit.expires>now()) {
      entries.delete(key);entries.set(key,hit);
      return JSON.parse(hit.text);
    }
    remove(key);
    let task=pending.get(key);
    if(!task){
      const started=generation;
      task=(async()=>{
        const value=await loader();
        const text=JSON.stringify(value), size=Buffer.byteLength(text)+Buffer.byteLength(String(key));
        if(started===generation && ttlMs>0 && maxEntries>0 && size<=maxBytes){
          for(const [old,e] of entries)if(e.expires<=now())remove(old);
          while((bytes+size>maxBytes || entries.size>=maxEntries) && entries.size)remove(entries.keys().next().value);
          entries.set(key,{text,bytes:size,expires:now()+ttlMs});bytes+=size;
        }
        return text;
      })();
      pending.set(key,task);
      task.finally(()=>{if(pending.get(key)===task)pending.delete(key);}).catch(()=>{});
    }
    return JSON.parse(await task);
  }
  return {read,clear,stats:()=>({entries:entries.size,bytes,pending:pending.size})};
}
