# MIS-SCAN V5 — AUTOMAÇÃO DE HC E MISSCAN

## O que mudou

A V5 remove o carregamento manual das bases:

- HC vem automaticamente da aba `Base de HC 26`.
- Misscan vem automaticamente da aba `LM`.
- O dashboard consulta os dados ao abrir.
- Enquanto a página estiver aberta, atualiza novamente a cada 15 minutos.
- Existe o botão `Atualizar agora`, que apenas força uma nova leitura — não há upload de arquivo.
- Tratativas são recalculadas automaticamente com os Misscan identificados.
- E-mails de diálogo/reciclagem continuam sendo enviados pelo mesmo backend.

## Fonte já configurada no código

Planilha:
`Misscan- Matinal SoC-MG04`

ID padrão:
`1fwe4cFmYxLgdUmTqtDa6l9lF8WKmpIXE0MCtsWlA4rA`

Abas:
- `Base de HC 26`
- `LM`

## PASSO 1 — GitHub / Vercel

Substitua o projeto pelos arquivos deste ZIP.

Confirme que a estrutura contém:

api/
  dados.mjs
  notificar.mjs
  ping.mjs

Na Vercel mantenha:
- Framework Preset: Other
- Root Directory: raiz do repositório
- Build Command: vazio
- Output Directory: vazio

As variáveis que você já criou continuam sendo usadas:
- `APPS_SCRIPT_EMAIL_URL`
- `EMAIL_WEBHOOK_TOKEN`

## PASSO 2 — Atualizar o Apps Script

No MESMO projeto de Apps Script usado para o e-mail:

1. Abra o editor.
2. Apague o código antigo do `Code.gs` ou crie um arquivo novo.
3. Cole TODO o conteúdo de `BackendV5.gs`.
4. Salve.

Em Configurações do projeto > Propriedades do script, confirme:
- `WEBHOOK_TOKEN` = mesmo valor de `EMAIL_WEBHOOK_TOKEN` da Vercel.

Opcional:
- `SPREADSHEET_ID` = `1fwe4cFmYxLgdUmTqtDa6l9lF8WKmpIXE0MCtsWlA4rA`

Se `SPREADSHEET_ID` não for criado, o código já usa esse ID como padrão.

## PASSO 3 — CRÍTICO: atualizar a implantação

No Apps Script:
1. Implantar > Gerenciar implantações.
2. Edite a implantação existente.
3. Em Versão, escolha `Nova versão`.
4. Implantar.

NÃO precisa trocar a Environment Variable da Vercel se a URL `/exec` continuar a mesma.

## PASSO 4 — teste do backend de dados

Depois do redeploy da Vercel, abra:

`https://SEU-DOMINIO.vercel.app/api/dados?days=35`

Resultado esperado:
- `"ok": true`
- campos `hc`, `misscan` e `meta`

## PASSO 5 — dashboard

Abra o dashboard.

No cabeçalho deve aparecer:
- `Dados online`
- horário da última atualização

Na tela de Produtividade deve aparecer:
- quantidade de colaboradores recebidos da Base HC
- quantidade de BR recebidos da LM
- janela de datas utilizada

## REGRA DE PERFORMANCE

A LM possui muitas linhas. Para evitar levar toda a planilha para o navegador, o backend:
- lê a LM de baixo para cima;
- usa janela padrão de 35 dias;
- considera somente `is_misscan = Sim`;
- deduplica por `shipment_id`;
- devolve somente as colunas necessárias.

## TRATATIVAS

A V5 gera o indicador automático como:

`Misscan do colaborador / total de Misscan identificados × 100`

Esse valor é um SHARE dos Misscan identificados.

IMPORTANTE:
ele NÃO é a taxa individual `Misscan / volume processado pelo colaborador`.
Quando o denominador oficial de produtividade/volume individual for integrado, podemos substituir o Share pela taxa oficial mantendo a mesma tela de tratativas.
