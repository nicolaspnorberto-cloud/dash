# MIS-SCAN V6.1 — HISTÓRICO + FILTRO DE DATA

## Objetivo
Transformar a planilha Matinal em histórico permanente do Misscan e permitir análise por período no dashboard.

## Como o histórico é armazenado
Os Misscans deixam de depender de um único snapshot e passam a ser consolidados por mês no Blob privado:

- misscan/history/2026-04.json
- misscan/history/2026-05.json
- misscan/history/2026-06.json
- etc.

A Base HC fica em arquivo privado separado e é atualizada em cada sincronização.

## Filtro global
A barra de período vale para todas as análises do dashboard:
- Produtividade
- Ranking de ofensores
- Tratativas
- Calendarização baseada no realizado

Atalhos:
- Hoje
- Ontem
- Semana atual
- Semana anterior
- Últimos 7 dias
- Últimos 30 dias
- Todo histórico
- Personalizado

## Tratativas
Trocar o período muda o ranking/indicador do recorte analisado.
O histórico já salvo de diálogos, reciclagens, evidências e reincidências não é apagado.

## Instalação

### 1. GitHub
Substitua os arquivos pela V6.1 preservando as pastas `api/` e `lib/`.

### 2. Vercel
Use o mesmo Blob privado da V6.
Não é necessário criar outro armazenamento.

Após o novo deployment, teste:
https://dash-b52u.vercel.app/api/ping

Esperado:
"service":"misscan-v6.1"

### 3. Apps Script
Substitua o código atual pelo arquivo `BackendV61.gs`.

As propriedades continuam:
- WEBHOOK_TOKEN
- VERCEL_BASE_URL
- SPREADSHEET_ID opcional

Não publicar como Web App.

### 4. Backfill inicial
Execute UMA VEZ:
sincronizarHistoricoInicialV61

Essa rotina lê até 180 dias anteriores da Matinal e cria os arquivos mensais históricos no Blob.

Depois teste:
https://dash-b52u.vercel.app/api/dados?preset=ALL

### 5. Instalar gatilhos
Execute UMA VEZ:
instalarAutomacoesV61

Ela remove gatilhos antigos da V6 e cria:
- sincronizarDadosV61 — a cada 30 minutos
- processarFilaEmailsV61 — a cada 5 minutos

## Funcionamento incremental
A sincronização regular lê uma janela recente da LM.
A Vercel faz merge por shipment_id dentro do mês correspondente.

Assim:
- registros antigos permanecem;
- duplicatas são consolidadas;
- correções recentes podem atualizar o mesmo BR;
- o histórico cresce sem reprocessar todos os meses em cada execução.

## Próxima evolução
A arquitetura já fica pronta para:
Marco Zero × Semana Atual × Semana Anterior × Ganho acumulado.
