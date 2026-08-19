# MIS-SCAN V4.2.2 — SUBSTITUIÇÃO TOTAL

Esta versão corrige a publicação da API de e-mail na Vercel.

## Estrutura OBRIGATÓRIA do GitHub

Os arquivos abaixo precisam ficar DIRETAMENTE na raiz do repositório:

index.html
styles.css
app.js
tratativas.json
package.json
vercel.json
EmailBackend.gs
EMAIL_SETUP.md
README.md

api/
  ping.mjs
  notificar.mjs

Não coloque esses arquivos dentro de outra pasta.

## Como substituir

1. Faça backup do repositório atual.
2. No GitHub, apague os arquivos antigos do projeto ou substitua todos pelos arquivos deste ZIP.
3. Confirme que `api` aparece como uma PASTA na raiz do GitHub.
4. Faça Commit.
5. Na Vercel:
   - Framework Preset: Other
   - Root Directory: vazio / raiz do repositório
   - Build Command: vazio
   - Output Directory: vazio
6. Confirme as Environment Variables:
   - APPS_SCRIPT_EMAIL_URL = URL do Apps Script terminando em /exec
   - EMAIL_WEBHOOK_TOKEN = mesmo token salvo como WEBHOOK_TOKEN no Apps Script
7. Faça Redeploy.

## Teste 1 — API da Vercel

Abra:
https://SEU-DOMINIO.vercel.app/api/ping

Resultado esperado:
{
  "ok": true,
  "service": "misscan-email-api"
}

Depois abra:
https://SEU-DOMINIO.vercel.app/api/notificar

Resultado esperado:
JSON informando que a rota está publicada e aceita POST.

Se qualquer uma dessas duas URLs retornar 404, o problema é Root Directory / estrutura do GitHub, e não o Apps Script.

## Teste 2 — Apps Script

A variável APPS_SCRIPT_EMAIL_URL deve ser a URL de IMPLANTAÇÃO do Web App e terminar em `/exec`.
Não use `/dev`.

## Teste 3 — Dashboard

Depois que `/api/ping` funcionar, registre um diálogo.
O e-mail deve ser enviado ao líder do colaborador e ao instrutor.
