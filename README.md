MIS-SCAN CONTROL CENTER V6.1

Versão com histórico permanente e filtro global de data.

Arquitetura:
Google Sheets privado
→ Apps Script privado
→ Vercel API
→ Blob privado mensal
→ Dashboard com filtro de período

Arquivos principais:
- BackendV61.gs
- V61_CONFIGURACAO.md
- api/sync.mjs
- api/dados.mjs
- api/ping.mjs
- lib/blob-store.mjs
- index.html
- app.js
- styles.css

Após publicar:
1. execute sincronizarHistoricoInicialV61 uma vez;
2. execute instalarAutomacoesV61 uma vez.
