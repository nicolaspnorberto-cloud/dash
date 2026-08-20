# MIS-SCAN V6.2 — CALENDARIZAÇÃO AUTOMÁTICA

Fonte: **Hc x Posto de Trabalho**, aba semanal Wxx encontrada automaticamente.

A rotina captura Forecast, Processar, Capacidade, Backlog D+1, HC Plano, HC Esteira, HC Apoio, HC Expedição e produtividade T1/T2/T3.

### Regra
`peso turno = HC Plano × produtividade`

`volume turno = Processar × peso turno / soma dos pesos`

`capacidade turno = HC Plano × produtividade por HC/turno`

### Instalação
1. Suba V6.2 no GitHub preservando `api/` e `lib/`.
2. Teste `/api/ping` → `misscan-v6.2`.
3. No Apps Script use `BackendV62.gs`.
4. Propriedades atuais continuam. `PLANNING_SPREADSHEET_ID` é opcional.
5. Execute `testarCalendarizacaoV62()`.
6. Execute `sincronizarCalendarizacaoV62()`.
7. Teste `/api/calendarizacao`.
8. Execute `instalarAutomacoesV62()` uma vez. Histórico/HC/Misscan + calendarização passam a sincronizar a cada 30 min; fila de e-mail a cada 5 min.

A aba Calendarização abre em modo **Automático**, mas mantém modo **Manual** para simulações.
