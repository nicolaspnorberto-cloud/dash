# Reciclagens: listas de presença e navegação

A aba agora separa registro e histórico por botões, mantém a identidade laranja Shopee e azul-marinho sobre fundo branco e organiza o cadastro em informações da turma, participantes, anexos e conferência. O painel lateral reúne tema, data, área e participantes selecionados. No celular, ele fica abaixo do formulário.

## Lista de presença

- Até 3 arquivos por turma: PDF, JPG ou PNG, até 4 MB cada.
- Anexar ao registrar ou depois, no histórico. Downloads exigem o mesmo PIN das tratativas; os arquivos não têm URL pública de conteúdo.
- Registro inicial e anexos são gravados em uma transação no D1. Se houver falha, nenhum registro parcial é criado.
- Arquivos são guardados em blocos binários de até 500.000 bytes para respeitar o limite de linha do D1. Reenviar o mesmo arquivo com a mesma turma e nome não duplica o anexo.
- O nome e o tamanho aparecem no histórico. O PDF/foto não altera a lista selecionada nem confirma assinaturas automaticamente.
- Botão para imprimir a lista dos participantes selecionados, ou de uma turma completa do histórico, com espaços para assinaturas. Nenhuma assinatura é gerada pelo sistema.

## Outras melhorias

Cartões com totais reais; visualização de selecionados; remoção individual na conferência; observações em várias linhas; duração opcional; filtros do histórico por data, turno, tipo, participante/instrutor e presença de anexo. CSV respeita os filtros e inclui duração e nomes dos anexos. O filtro geral de período MIS SCAN fica oculto nesta aba, que usa suas próprias datas de capacitação.

Registros anteriores continuam acessíveis. A fonte de participantes continua COPPIT - ABS, com nomes e turnos preservados. Capacitações não encerram automaticamente tratativas individuais. A sincronização ABS e o fiscal de MIS SCAN permanecem no fluxo existente.

## Publicação

O Worker cria automaticamente as tabelas e o índice de anexos sem alterar os registros antigos. Usa o MISSCAN_DB e o TREATMENT_WRITE_PIN já existentes; não exige novo Apps Script, banco, bucket ou segredo. Os assets training.js e training.css passam para v7.2.0.

## Validação

Testes de gravação/download binário, transação e reversão de falha, limite de arquivos, idempotência, proteção por PIN, anexos posteriores, compatibilidade JSON, seleção persistente entre filtros e falhas, além da suíte anterior de datas, evolução, ABS e fiscal.
