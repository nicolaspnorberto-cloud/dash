# V6.5.1 — Correção do erro textContent

Erro corrigido:

`Cannot set properties of null (setting 'textContent')`

## Causa

A V6.5 removeu da interface um KPI antigo com id `projMisscan`, mas o `app.js`
ainda tentava executar:

`$('projMisscan').textContent = ...`

Como o elemento não existe mais no HTML, o navegador interrompia a atualização
automática logo após carregar os dados.

## Correção

- removida a referência antiga a `projMisscan`;
- `renderPending()` e `renderLeaders()` também foram protegidos contra elementos
  legados ausentes;
- nenhuma alteração é necessária no Apps Script/BackendV65.gs.

## Instalação

Você pode substituir somente:
- `app.js`

Ou subir o ZIP completo da V6.5.1.

Depois:
1. `git add -A`
2. `git commit -m "V6.5.1 corrige frontend"`
3. `git push origin main`
4. aguarde a Vercel;
5. teste `/api/ping`, que deve mostrar `misscan-v6.5.1`;
6. recarregue o dashboard com Ctrl+F5.
