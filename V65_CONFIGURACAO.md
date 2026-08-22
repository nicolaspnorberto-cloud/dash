# MIS-SCAN V6.5 — Calendarização GEROT

## Regra fechada

### Histórico real
- Fonte de Misscan: Matinal / aba LM.
- Fonte de processado: `GEROT - MG4` → `db_volume_overall`.
- Campo de processado: `SOC_Packed`.
- O casamento é sempre pela **mesma data**.
- A semana (`Semana`) serve apenas para agrupar os dias.

### Blocos históricos
- T1 → T1.
- T2 → T2 + T4.
- T3 → T3 + T5.
- Os blocos são usados somente para entender a taxa histórica.
- O forecast futuro NÃO é dividido artificialmente entre T1/T2/T3.

### Planejado futuro
- Fonte: `GEROT - MG4` → `db_volume_forecast`.
- Site: `SOC-MG4`.
- Campo usado: `Total`, coluna F.
- O Apps Script soma o Total das linhas do mesmo dia e entrega um volume planejado diário.

### Target
- Target Misscan fixo: **0,88%**.

### Fórmulas

Taxa histórica geral:

`Σ Misscan dos dias válidos ÷ Σ SOC_Packed dos mesmos dias × 100`

Projeção diária:

`Forecast Total do dia × taxa histórica geral`

Limite diário do target:

`Forecast Total do dia × 0,88%`

Gap diário:

`Misscan projetado - limite a 0,88%`

## Fontes GEROT confirmadas

Spreadsheet:

`GEROT - MG4`

ID padrão:

`1eqUi2AobaaBhhg29UfWLuFcKpZmkDEE0r8_kmUs9n74`

Abas:
- `db_volume_overall`
- `db_volume_forecast`

## Arquivos novos/alterados

### Apps Script
- `BackendV65.gs`

### Vercel
- `api/gerot-sync.mjs` — recebe snapshot Packed + Forecast.
- `api/taxas.mjs` — calcula taxa histórica com Matinal + SOC_Packed.
- `api/calendarizacao.mjs` — devolve forecast diário Total (F).
- `api/ping.mjs` — identifica V6.5.
- `app.js`, `index.html`, `styles.css` — nova interface.

## Publicação

### 1. GitHub / Vercel

Suba todos os arquivos desta pasta para o repositório.

No terminal:

```bash
git add -A
git status
git commit -m "V6.5 calendarizacao GEROT"
git push origin main
```

Depois teste:

`https://dash-b52u.vercel.app/api/ping`

Esperado:

`"service":"misscan-v6.5"`

### 2. Apps Script

Substitua o código atual pelo conteúdo de:

`BackendV65.gs`

Salve.

### 3. Teste a leitura da GEROT

Execute:

`testarGerotV65`

O log deve mostrar:
- linhas de Packed agregadas por data + turno;
- Forecast agregado por dia;
- exemplos das duas fontes.

### 4. Sincronize a GEROT

Execute:

`sincronizarGerotV65`

Esperado:

`V6.5 GEROT OK`

### 5. Teste APIs

Taxa:

`https://dash-b52u.vercel.app/api/taxas?days=14`

Calendarização:

`https://dash-b52u.vercel.app/api/calendarizacao?days=21`

### 6. Instale os gatilhos V6.5

Execute uma vez:

`instalarAutomacoesV65`

A rotina final fica:
- HC + LM: 30 min.
- GEROT Packed + Forecast: 30 min.
- E-mails: 5 min.

A V6.5 não depende do Oráculo e não usa mais `Hc x Posto de Trabalho` como fonte do volume planejado da Calendarização.

## Propriedade opcional

Se for necessário trocar a planilha GEROT no futuro, crie em Script Properties:

`GEROT_SPREADSHEET_ID`

Se a propriedade não existir, o backend usa o ID padrão acima.

## Aba de Ambiguidade

A interface não possui aba de Ambiguidade. A regra de segurança continua internamente para evitar atribuição incorreta quando houver mais de um colaborador/turno conflitante no HC.
