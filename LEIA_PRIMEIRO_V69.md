# V6.9 — fila simples

Esta versão elimina a lista/cooldown/reaproveitamento da fila.

Cada clique em Atualizar agora cria UM pedido novo em:
`misscan/refresh-current.json`

O Apps Script lê esse pedido e o status passa:
PENDING -> RUNNING -> DONE/PARTIAL/ERROR.

## 1. GitHub/Vercel

Substitua:
- `api/refresh-source.mjs`
- `api/refresh-queue.mjs`

pelos arquivos deste pacote.

Depois:

git add -A
git commit -m "V6.9 simplifica fila do atualizar agora"
git push origin main

Não precisa trocar app.js.

## 2. Apps Script

Cole `PATCH_APPS_SCRIPT_V690.gs` no FINAL do Código.gs.

Execute uma vez:

`instalarAtualizacaoV690`

Nos acionadores deve ficar:
`processarAtualizacaoV690` a cada 1 minuto.

Os handlers antigos V67/V68/V683 são removidos pela instalação.

## 3. Teste

No dashboard:
- selecione 21/08/2026
- clique Atualizar agora

Logo depois execute:

`diagnosticarAtualizacaoV690`

Esperado:
`count:1`
e `latest.status:"PENDING"`.

Depois execute manualmente:

`processarAtualizacaoV690`

Esperado:
- V6.9 FILA HTTP 200
- V6.9: processando ...
- V6.9 LM OK ...
- uniqueRows: 3510
- V6.9 FINAL: DONE

## Correção imediata 21/08

Se quiser atualizar 21/08 sem esperar o botão:

`forcarLM21082026V690`

Esperado:
`V6.9 OK: 21/08/2026 enviado com 3510 BR únicos.`
