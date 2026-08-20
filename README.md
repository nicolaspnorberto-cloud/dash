MIS-SCAN CONTROL CENTER V6

Versão sem Google Cloud e sem Apps Script público.

Arquitetura:
- Apps Script privado lê Google Sheets.
- Apps Script envia dados para Vercel.
- Vercel armazena o snapshot em Blob privado.
- Dashboard lê o snapshot.
- Tratativas colocam e-mails em fila privada.
- Apps Script envia a fila via MailApp.

Arquivos principais:
- BackendV6.gs
- V6_CONFIGURACAO.md
- api/sync.mjs
- api/dados.mjs
- api/notificar.mjs
- api/email-queue.mjs
- lib/blob-store.mjs
