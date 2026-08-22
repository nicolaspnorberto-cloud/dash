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


HOTFIX V6.5.1
- Corrige erro de frontend `Cannot set properties of null (setting textContent)`.
- Apps Script V6.5 permanece válido; não precisa reinstalar gatilhos.


HOTFIX V6.5.2
- Forecast da Calendarização passa a usar somente `origin_type = INTER-SOC`.
- Volume diário = `Total` da coluna F da linha INTER-SOC.
- Não soma FMH, FULL, PUDO SVP, BIG SELLER ou demais origens.
- Exemplo de validação: 13/08/2026 = 205.541.


HOTFIX V6.5.3
- Corrige o histórico REAL: SOC_Packed agora usa somente previous_station_type = Inter-SOC.
- Forecast continua usando somente origin_type = INTER-SOC e Total da coluna F.
- Exemplo 13/08/2026: REAL = 205.809; Forecast = 205.541.


V6.6
- `Atualizar agora` passa a sincronizar Matinal/LM + GEROT de verdade.
- Nova API `/api/refresh-source`.
- Requer Apps Script Web App e `APPS_SCRIPT_REFRESH_URL` na Vercel.
- Taxa geral diária passa a usar `db_volume_forecast`, `INTER-SOC`, `Total (F)`.
- O clique faz sync rápido dos últimos 3 dias da LM para trazer hoje/ontem.


V6.7
- Atualizar agora via fila privada.
- Sem Apps Script Web App público.
- Apps Script consulta pedidos a cada 1 minuto.
- Nova rota protegida /api/refresh-queue.


V6.8
- LM por snapshot integral da data.
- Deduplicação data + shipment_id.
- Atualizar agora envia o período selecionado.
- Substitui snapshots parciais no Blob.
