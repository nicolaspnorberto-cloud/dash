# V6.5.3 — INTER-SOC no REAL e no FORECAST

A divergência de 13/08/2026 foi identificada.

O valor `270.877` era a soma de SOC_Packed de todos os `previous_station_type` do dia.

Na V6.5.3:

## Histórico / realizado
Fonte: `db_volume_overall`

Filtro:
- `previous_station_type = Inter-SOC`

Volume:
- `SOC_Packed`

Exemplo 13/08/2026:
- T1 = 65.843
- T2 = 59.216
- T3 = 80.750
- Total real INTER-SOC = **205.809**

## Forecast
Fonte: `db_volume_forecast`

Filtro:
- `destination = SOC-MG4`
- `origin_type = INTER-SOC`

Volume:
- `Total` coluna F

Exemplo 13/08/2026:
- Forecast INTER-SOC = **205.541**

## Teste no Apps Script
Cole `BackendV653.gs` e execute:

`testarInterSocV653`

Depois:

`sincronizarGerotV65`

Não precisa refazer o histórico LM nem reinstalar os gatilhos, pois o gatilho existente já chama `sincronizarGerotV65`.
