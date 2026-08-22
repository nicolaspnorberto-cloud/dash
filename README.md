# MIS-SCAN CONTROL CENTER V6.5

Versão focada na nova Calendarização automática usando GEROT.

## Fontes

- Matinal / LM → Misscan diário.
- GEROT `db_volume_overall` → processado real via `SOC_Packed`.
- GEROT `db_volume_forecast` → planejado diário via `Total` da coluna F.
- Base HC → turno do colaborador para os blocos históricos.

## Regra principal

O histórico é calculado **dia com dia**.

A semana é somente agrupador.

Blocos históricos:
- T1.
- T2 + T4.
- T3 + T5.

O forecast futuro é diário e não é dividido entre blocos.

Target Misscan fixo: **0,88%**.

## Arquivo principal do Apps Script

`BackendV65.gs`

## Primeira validação

1. Publicar os arquivos no GitHub/Vercel.
2. Confirmar `/api/ping` com `misscan-v6.5`.
3. Colar `BackendV65.gs` no Apps Script.
4. Executar `testarGerotV65`.
5. Executar `sincronizarGerotV65`.
6. Validar `/api/taxas?days=14`.
7. Validar `/api/calendarizacao?days=21`.
8. Executar `instalarAutomacoesV65`.

Detalhes: `V65_CONFIGURACAO.md`.
