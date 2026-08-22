# V6.4.1 — Correção HTTP 413

O erro:

`Request Entity Too Large / FUNCTION_PAYLOAD_TOO_LARGE`

aconteceu porque a primeira versão da V6.4 processava até 15.000 linhas da LM em um único lote.

## Correção

A V6.4.1 usa:

`V64_BACKFILL_ROWS_PER_RUN = 2000`

## Para o caso em que o erro já aconteceu

1. Substitua o código do Apps Script por `BackendV641.gs`.
2. Salve.
3. Execute `retomarHistoricoLMV641`.
4. O cursor salvo continua da mesma posição; não precisa resetar o histórico.
5. Consulte `statusHistoricoLMV64`.
6. Aguarde `status: DONE`.
7. Só então execute `instalarAutomacoesV64`.

## Observação

Não é necessário alterar GitHub/Vercel para este hotfix, pois a correção é apenas no tamanho do lote enviado pelo Apps Script.
