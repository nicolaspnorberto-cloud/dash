# Correção do filtro de datas — V7.0.22

Base: ZIP dash-restore-6365535, package.json V7.0.21.
Esta alteração foi preparada e testada localmente; ainda não está publicada.

## Aplicação no GitHub

1. Extraia este ZIP.
2. No repositório nicolaspnorberto-cloud/dash, na branch vinculada à Cloudflare,
   substitua app.js, index.html, api/dados.mjs, .assetsignore, package.json
   e package-lock.json. Adicione date-loader.js na raiz.
3. Inclua os arquivos de test/ para manter os testes de regressão.
4. Faça commit de todos os arquivos juntos. O index.html agora depende de date-loader.js.
5. Se a Cloudflare estiver configurada para build automático da branch, aguarde
   o deploy bem-sucedido. Caso contrário, publique pelo procedimento já usado
   no projeto (npx wrangler deploy).
6. Recarregue o dashboard com Ctrl+Shift+R.

Não é necessário alterar o Apps Script, o banco D1 ou os segredos.
Não substitua o restante do repositório por este pacote: ele contém apenas a correção.

## Comportamento corrigido

- Eventos dos controles são registrados antes das consultas iniciais.
- Ao aplicar outro período, a carga anterior é cancelada e não sobrescreve a nova.
- Editar datas durante uma carga preserva os campos até clicar Aplicar período.
- Intervalos invertidos são ordenados nos campos e na consulta.
- Cada tentativa tem timeout de 20 segundos; no máximo duas tentativas.
- A carga do período tem limite total de dois minutos e exibe erro recuperável.
- Progresso de carregamento por blocos.
- Cache limitado a 24 MB de JSON / 80 blocos, somente em memória desta aba,
  invalidado quando os metadados de sincronização mudam.
- Atualização explícita fresh=1 chega também aos blocos, ignorando esse cache.
- Datas fora do histórico não geram consultas desnecessárias; períodos acima de
  730 dias não são truncados silenciosamente.
- Consultas de relatório não gravam mais snapshots de relatório no D1,
  evitando consultas extras e invalidação do cache a cada GET.

## Validação local

node --test test/date-loader.test.mjs test/date-api.test.mjs

Resultado: 13 testes passaram. Sintaxe de 37 arquivos JS/MJS validada sem erros.
Os testes de atribuição usam um resultado capturado do código original.
A suite anterior tem duas falhas conhecidas de SeaTalk/completedOpsIds;
essas falhas continuam fora do escopo e não foram ocultadas ou alteradas.
Não há medição do tempo da versão corrigida em produção: ela ainda não foi publicada.

## Conferência após publicação

- Abrir dashboard e usar o filtro antes das consultas iniciais terminarem.
- Escolher Ontem; depois Últimos 7 dias; trocar rapidamente entre os períodos.
- Informar período personalizado, inclusive data inicial maior que a final.
- Editar as datas enquanto um período carrega: os campos devem ser preservados.
- Retornar ao mesmo período sem mudança da fonte e conferir reutilização de blocos.
- Testar Hoje quando não houver registros: painel vazio com período correto.
- Conferir os BRs de uma data conhecida com a fonte oficial.
- Conferir a aba Network: include_hc=0 nos blocos e fresh=1 quando solicitado.

## Reversão

Restaurar os seis arquivos substituídos usando o commit anterior e publicar novamente.
O arquivo date-loader.js pode ser removido após restaurar o index.html.
Nenhuma migração de banco foi realizada.
