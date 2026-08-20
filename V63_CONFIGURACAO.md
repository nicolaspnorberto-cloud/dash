# MIS-SCAN V6.3 — TAXA REAL AUTOMÁTICA

## Regra operacional oficial

- T1 → bloco T1
- T2 + T4 → bloco T2
- T3 + T5 → bloco T3

A taxa usa sempre PRODUÇÃO REAL, nunca Meta Operação.

Taxa T1 = Misscan T1 / Produção Real T1 × 100
Taxa T2 = (Misscan T2 + T4) / Produção Real T2 × 100
Taxa T3 = (Misscan T3 + T5) / Produção Real T3 × 100

A média da Calendarização é ponderada pelo volume e pode usar 7, 14 ou 30 dias.

## 1. GitHub

Suba a V6.3 preservando:

api/
- calendar-sync.mjs
- calendarizacao.mjs
- dados.mjs
- email-queue.mjs
- notificar.mjs
- ping.mjs
- producao-sync.mjs
- sync.mjs
- taxas.mjs

lib/
- blob-store.mjs

Também substitua app.js, index.html, styles.css, package.json e vercel.json.

Teste depois do deploy:
https://dash-b52u.vercel.app/api/ping

Esperado: `"service":"misscan-v6.3"`

## 2. Apps Script

Substitua o código por BackendV63.gs. As propriedades anteriores permanecem.

A nova integração conhece a página:
https://oraculo-mg4.vercel.app/historico-packing

Execute primeiro:
`descobrirFonteOraculoV63`

A função inspeciona a página e os bundles JavaScript, procura a rota JSON de produção e salva automaticamente a propriedade:
`ORACULO_PROD_API_URL`

Se o endpoint for encontrado, execute:
`testarProducaoRealV63`

O registro deve mostrar linhas com:
`date`, `turno`, `real`, `meta`.

## 3. Backfill de produção real

Execute uma vez:
`sincronizarHistoricoProducaoInicialV63`

Ela busca até 35 dias e salva no Blob privado.

Depois teste:
https://dash-b52u.vercel.app/api/taxas?days=14

Esperado:
- rates.T1
- rates.T2
- rates.T3
- volumeReal
- misscan
- rate

## 4. Instalar automações

Execute uma vez:
`instalarAutomacoesV63`

A cada 30 minutos:
- Misscan / HC
- planejamento de calendarização
- produção real
- taxa automática

A cada 5 minutos:
- fila de e-mails

## 5. Dashboard

Na Calendarização, a taxa manual deixa de ser a referência oficial.
O modo Automático usa `/api/taxas`.

Há seletor:
- 7 dias
- 14 dias (padrão)
- 30 dias

T4 é incorporado ao numerador de T2 e T5 ao numerador de T3.

## Se a descoberta automática não encontrar a API do Oráculo

Abra o Registro de execução de `descobrirFonteOraculoV63`.
A função lista as rotas candidatas encontradas nos bundles.
Se necessário, crie manualmente a Script Property `ORACULO_PROD_API_URL` com a rota /api que retorna os dados do Histórico Prod Esteiras. Depois execute `testarProducaoRealV63` novamente.
