# V6.5.2 — Forecast somente INTER-SOC

## Correção

A V6.5 somava o `Total` da coluna F de todos os `origin_type` do dia.

Na V6.5.2 a projeção usa somente:

- destination = `SOC-MG4`
- origin_type = `INTER-SOC`
- volume planejado = `Total` da coluna F

Exemplo de 13/08/2026:

`INTER-SOC Total = 205.541`

Esse é o volume que deve aparecer na Calendarização para o dia, sem somar FMH, FULL, PUDO SVP, BIG SELLER etc.

## Instalação

### GitHub / Vercel
Suba os arquivos da V6.5.2 e faça push.

### Apps Script
Substitua pelo `BackendV652.gs`.

Não precisa refazer o histórico LM.

Execute:
1. `testarForecastInterSocV652`
2. `sincronizarGerotV65`

Depois valide:
`/api/calendarizacao?from=2026-08-13&to=2026-08-13`

O volume esperado para 13/08/2026 é `205541`.

Os gatilhos existentes continuam chamando `sincronizarGerotV65`, então não é necessário reinstalá-los se já estão ativos.
