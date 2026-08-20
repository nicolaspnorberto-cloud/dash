# MIS-SCAN V6 — SEM GOOGLE CLOUD / SEM WEB APP PÚBLICO

## Arquitetura

Google Sheets privado
→ Apps Script privado
→ POST /api/sync na Vercel
→ Vercel Blob privado
→ Dashboard

E-mails:
Dashboard
→ /api/notificar
→ fila privada no Vercel Blob
→ Apps Script privado consulta a fila
→ MailApp envia para líder + instrutor

O Apps Script NÃO precisa ser publicado como Web App.

---

## 1. GitHub

Substitua os arquivos do projeto por esta V6, preservando:

api/
- dados.mjs
- sync.mjs
- notificar.mjs
- email-queue.mjs
- ping.mjs

lib/
- blob-store.mjs

Também envie:
- index.html
- app.js
- styles.css
- package.json
- vercel.json

O arquivo BackendV6.gs é para o Google Apps Script; ele pode ficar no GitHub apenas como backup.

---

## 2. Criar o armazenamento privado na Vercel

No projeto `dash-b52u`:

1. Abra Storage.
2. Create Database / Create Store.
3. Escolha Blob.
4. Crie um store PRIVADO.
5. Vincule ao projeto `dash-b52u`.
6. Garanta que Production esteja selecionado.

A Vercel cria automaticamente:
`BLOB_READ_WRITE_TOKEN`

Não copie esse token para o código.

---

## 3. Variável já existente

A V6 reutiliza:
`EMAIL_WEBHOOK_TOKEN`

Ela funciona como segredo entre o Apps Script e a Vercel.

No Apps Script, o mesmo valor deve estar em:
`WEBHOOK_TOKEN`

A variável antiga `APPS_SCRIPT_EMAIL_URL` não é necessária na V6.

---

## 4. Apps Script

Abra o projeto de Apps Script.

1. Crie ou substitua um arquivo por todo o conteúdo de:
   `BackendV6.gs`
2. Salve.
3. Não precisa implantar como Web App.
4. Em Configurações do projeto > Propriedades do script, tenha:

WEBHOOK_TOKEN
= mesmo token de EMAIL_WEBHOOK_TOKEN na Vercel

VERCEL_BASE_URL
= https://dash-b52u.vercel.app

SPREADSHEET_ID (opcional)
= 1fwe4cFmYxLgdUmTqtDa6l9lF8WKmpIXE0MCtsWlA4rA

---

## 5. Teste antes de instalar gatilhos

No Apps Script execute:

`testarConexaoV6()`

Depois abra o registro de execução.

Esperado:
HTTP 200 e `"ok":true`.

Depois execute:

`sincronizarDadosV6()`

A primeira execução solicitará autorização do Apps Script para acessar a planilha e fazer requisições externas.

Depois teste no navegador:

https://dash-b52u.vercel.app/api/dados

Esperado:
`"ok": true`
com `hc`, `misscan` e `meta`.

---

## 6. Instalar automações

Execute uma única vez no Apps Script:

`instalarAutomacoesV6()`

Isso cria:
- Sincronização HC + Misscan: a cada 30 minutos
- Processamento da fila de e-mail: a cada 5 minutos

A função também faz a primeira sincronização imediatamente.

---

## 7. Funcionamento dos e-mails

Ao concluir diálogo ou reciclagem:
1. O dashboard registra o e-mail em uma fila privada.
2. O líder é validado contra a Base HC sincronizada.
3. O e-mail do instrutor precisa ser `@shopee.com`.
4. O Apps Script privado consulta a fila.
5. MailApp envia o e-mail.
6. A fila é marcada como SENT ou ERROR.

Não é necessário publicar o Apps Script.

---

## 8. Segurança

- Google Sheets continua privado.
- Vercel não possui credencial Google.
- BLOB_READ_WRITE_TOKEN fica apenas nas variáveis da Vercel.
- WEBHOOK_TOKEN fica apenas nas propriedades do Apps Script e na Vercel.
- O Blob deve ser PRIVADO.
- A fila limita solicitações e aceita e-mails de instrutor apenas no domínio @shopee.com.

---

## 9. Testes finais

API:
https://dash-b52u.vercel.app/api/ping

Dados:
https://dash-b52u.vercel.app/api/dados

Sync (abrir no navegador):
https://dash-b52u.vercel.app/api/sync
Deve informar que usa POST.

Depois abra o dashboard e confirme:
- Dados online
- HC carregado
- Misscan carregado
- Última sincronização

Para testar e-mail:
- registre um diálogo controlado
- aguarde até 5 minutos
- confirme recebimento do líder e do instrutor
