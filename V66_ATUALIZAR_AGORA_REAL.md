# V6.6 — Atualizar agora REAL

## O que foi corrigido

O botão `Atualizar agora` não buscava Google Sheets.
Ele apenas relia o Vercel Blob.

Na V6.6:

Dashboard
→ `/api/refresh-source`
→ Apps Script Web App protegido por token
→ Matinal/LM + GEROT
→ Vercel Blob
→ dashboard recarrega os dados novos

O clique passa a atualizar a fonte de verdade.

## Correção da base histórica

A taxa geral e o casamento diário agora usam:

`db_volume_forecast`
- destination = SOC-MG4
- origin_type = INTER-SOC
- volume = Total da coluna F

A Matinal/LM é casada pela mesma data.

Os cartões históricos T1 / T2+T4 / T3+T5 continuam usando
`SOC_Packed Inter-SOC` por turno apenas como referência dos blocos.

## 1. GitHub/Vercel

Suba todos os arquivos da V6.6.

Confirme que `app.js` está na RAIZ:

/app.js

e NÃO em:

/api/app.js

Depois:

git add -A
git commit -m "V6.6 atualizar agora real"
git push origin main

Teste:
`https://dash-b52u.vercel.app/api/ping`

Esperado:
`"service":"misscan-v6.6"`

## 2. Apps Script

Cole `BackendV66.gs` inteiro e salve.

Não precisa reinstalar os gatilhos antigos.

## 3. Publicar o Apps Script como Web App

No Apps Script:

Implantar
→ Nova implantação
→ Tipo: App da Web

Executar como:
`Eu`

Quem tem acesso:
`Qualquer pessoa`

Implante e copie a URL terminada em `/exec`.

IMPORTANTE:
O endpoint é protegido pelo mesmo `WEBHOOK_TOKEN`.
O token não fica no navegador.

## 4. Vercel

Project Settings
→ Environment Variables

Crie:

APPS_SCRIPT_REFRESH_URL

Valor:
a URL `/exec` do Web App do Apps Script.

O `EMAIL_WEBHOOK_TOKEN` já existente será usado como segredo
e precisa continuar igual ao `WEBHOOK_TOKEN` do Apps Script.

Depois faça Redeploy.

## 5. Teste

Abra:

`https://dash-b52u.vercel.app/api/refresh-source`

Deve mostrar:
- ok: true
- configured: true

Depois abra o dashboard, filtre `Ontem` e clique `Atualizar agora`.

O botão deverá mostrar:
- Sincronizando...
- Matinal + GEROT
- depois Dados online

A sincronização rápida do clique envia os últimos 3 dias da LM,
portanto inclui hoje e ontem sem reenviar os 45 dias a cada clique.
