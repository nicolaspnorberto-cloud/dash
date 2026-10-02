// Dados vivem apenas na memória desta aba; nenhuma informação pessoal é persistida.
globalThis.MisscanDateLoader = {
  createLatest() {
    let generation = 0, controller = null;
    return {
      cancel() { generation++; controller?.abort(); },
      begin() {
        controller?.abort();
        controller = new AbortController();
        const id = ++generation;
        const controllerForLoad = controller;
        return { signal: controller.signal, current: () => id === generation, cancel: () => controllerForLoad.abort() };
      }
    };
  },
  createCache({ maxBytes = 24 * 1024 * 1024, maxEntries = 80 } = {}) {
    const entries = new Map();
    let revision = '', bytes = 0;
    return {
      useRevision(next) {
        if (revision !== next) { entries.clear(); bytes = 0; revision = next; }
      },
      get(key) {
        const entry = entries.get(key);
        if (!entry) return null;
        entries.delete(key); entries.set(key, entry);
        return entry.rows;
      },
      put(key, rows) {
        const size = new TextEncoder().encode(JSON.stringify(rows)).byteLength;
        if (size > maxBytes) return;
        const old = entries.get(key);
        if (old) { bytes -= old.size; entries.delete(key); }
        while (entries.size && (bytes + size > maxBytes || entries.size >= maxEntries)) {
          const oldest = entries.keys().next().value;
          bytes -= entries.get(oldest).size; entries.delete(oldest);
        }
        entries.set(key, { rows, size }); bytes += size;
      }
    };
  },
  async fetchJson(url, options = {}, attempts = 2, {
    fetcher = fetch, timeoutMs = 20000,
    retryDelay = ms => new Promise(resolve => setTimeout(resolve, ms))
  } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (options.signal?.aborted) throw new DOMException('Carga cancelada.', 'AbortError');
      const controller = new AbortController();
      const cancel = () => controller.abort();
      options.signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(cancel, timeoutMs);
      try {
        const response = await fetcher(url, { ...options, signal: controller.signal });
        const data = await response.json();
        if (response.ok && data?.ok !== false) return { response, data };
        const error = new Error(data?.error || `Falha ao carregar dados (${response.status}).`);
        error.status = response.status;
        throw error;
      } catch (error) {
        if (options.signal?.aborted) throw new DOMException('Carga cancelada.', 'AbortError');
        lastError = controller.signal.aborted
          ? new Error('A consulta demorou demais. Tente novamente ou selecione um período menor.')
          : error;
        if (error?.status && ![429, 500, 502, 503, 504].includes(error.status)) throw error;
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', cancel);
      }
      if (attempt < attempts) await retryDelay(500 * attempt);
    }
    throw lastError;
  }
};
