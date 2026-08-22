# V6.7 — Atualizar agora via fila privada

A organização bloqueia Apps Script Web Apps públicos.
A V6.7 não usa mais esse caminho.

## Fluxo

Dashboard
→ cria pedido PENDING no Vercel Blob
→ Apps Script consulta a fila a cada 1 minuto
→ Matinal/LM + GEROT são relidos
→ dados são enviados para a Vercel
→ pedido vira DONE
→ dashboard recarrega

## GitHub/Vercel

Suba a V6.7:

git add -A
git commit -m "V6.7 atualizar agora fila privada"
git push origin main

Teste:

https://dash-b52u.vercel.app/api/ping

Esperado:
"service":"misscan-v6.7"

Depois:

https://dash-b52u.vercel.app/api/refresh-source

Esperado:
"version":"6.7"
"mode":"private-queue"
"configured":true
"appsScriptPublicWebAppRequired":false

`APPS_SCRIPT_REFRESH_URL` não é mais utilizada.

## Apps Script

Substitua pelo `BackendV67.gs`.

Salve e execute UMA VEZ:

instalarFilaAtualizacaoV67

Esse comando adiciona somente:

processarFilaAtualizacaoV67
→ a cada 1 minuto

Não mexe nos demais gatilhos já instalados.

Depois execute:

testarFilaAtualizacaoV67

Esperado:
HTTP 200

## Teste do botão

Selecione Ontem e clique Atualizar agora.

Estados esperados:

Solicitando...
→ Na fila...
→ Sincronizando...
→ Dados online

O tempo normal é de alguns segundos até cerca de 2 minutos,
porque o Apps Script verifica a fila uma vez por minuto.

## Importante

O Web App público da V6.6 deixa de ser necessário.
Pode manter a implantação antiga sem uso ou removê-la depois.

A rota privada `/api/refresh-queue` é protegida pelo mesmo token:
Apps Script `WEBHOOK_TOKEN`
=
Vercel `EMAIL_WEBHOOK_TOKEN`
