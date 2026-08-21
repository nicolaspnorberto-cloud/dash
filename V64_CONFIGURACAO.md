# V6.4 — HISTÓRICO LM DINÂMICO

## O problema corrigido

As versões anteriores tinham:
- sincronização recorrente limitada a uma janela fixa;
- backfill inicial de até 180 dias;
- leitura recente que podia presumir datas recentes nas últimas linhas;
- gatilho combinado com outras rotinas.

Na V6.4, a aba `LM` passa a comandar o histórico.

## 1. GitHub / Vercel

Substitua os arquivos pelo conteúdo deste ZIP.

Novidade importante:
`api/history-reset.mjs`

Depois do deployment, teste:

`https://dash-b52u.vercel.app/api/ping`

Esperado:

`"service":"misscan-v6.4"`

## 2. Apps Script

Substitua o código pelo arquivo:

`BackendV64.gs`

As propriedades continuam:
- WEBHOOK_TOKEN
- VERCEL_BASE_URL
- SPREADSHEET_ID (opcional)

## 3. Reconstrução completa da LM — executar uma vez

Execute:

`sincronizarHistoricoCompletoLMV64`

A função:
1. reinicia o índice histórico no Blob;
2. começa na linha 2 da LM;
3. processa a LM em lotes;
4. continua automaticamente se a base for grande;
5. grava meses e dias encontrados;
6. termina com status DONE.

Para consultar:

`statusHistoricoLMV64`

Se quiser cancelar:

`cancelarHistoricoCompletoLMV64`

## 4. Validar Todo histórico

Abra:

`https://dash-b52u.vercel.app/api/dados?preset=ALL`

Confira:
- historyStart
- historyEnd
- historyActiveDays
- historyCalendarDays
- historyRows
- months

No dashboard, selecione `Todo histórico`.

## 5. Instalar automações

Depois do backfill terminar, execute:

`instalarAutomacoesV64`

Serão criados gatilhos independentes:

- `sincronizarHCeMisscanV64` — 30 min
- `sincronizarCalendarizacaoV64` — 30 min
- `processarFilaEmailsV64` — 5 min

A produção do Oráculo não entra no gatilho automático enquanto a API exigir sessão de login.

## 6. Como novos dias entram

A cada 30 minutos:
- o Apps Script lê a LM de forma segura;
- filtra a janela recente;
- envia os Misscans;
- `/api/sync` faz merge por shipment_id;
- dias novos são acrescentados;
- meses antigos não são apagados.

## 7. IMPORTRANGE / ordem das linhas

A V6.4 não depende mais de a data mais recente estar no final da LM.
Isso é importante quando a LM é alimentada por IMPORTRANGE, QUERY ou fórmulas que podem reorganizar linhas.
