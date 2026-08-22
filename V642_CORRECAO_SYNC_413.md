# V6.4.2 — Correção do 413 na sincronização recorrente

## O que aconteceu

O backfill já estava usando lotes menores, mas `sincronizarHCeMisscanV64()` ainda enviava toda a janela recente de Misscan em uma única requisição.

Por isso `instalarAutomacoesV64()` chamou a sincronização inicial e recebeu:

`413 Request Entity Too Large / FUNCTION_PAYLOAD_TOO_LARGE`

## Correção

A sincronização recorrente agora divide os Misscans em lotes de 1.000 registros por requisição.

O HC vai somente no primeiro lote.

## O que fazer depois de colar BackendV642.gs

1. Execute `removerAutomacoesV64()` para apagar gatilhos que possam ter sido criados pela tentativa anterior.
2. Execute `statusHistoricoLMV64()`.

Se status = RUNNING:
- execute `retomarHistoricoLMV641()` somente se o backfill não estiver avançando sozinho;
- aguarde status = DONE.

Se status = DONE:
- execute `instalarAutomacoesV642()`.

## Importante

Não execute `instalarAutomacoesV64()` novamente.
Na V6.4.2 use `instalarAutomacoesV642()`.

Não é necessário novo deploy no GitHub/Vercel para este hotfix; a mudança é somente no Apps Script.
