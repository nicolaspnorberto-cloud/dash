# Anomalias e recorrências MG4

Aba Anomalias no dashboard existente. Base própria, inicialmente vazia, em D1
MISSCAN_DB. Não depende do Apps Script de origem, não importa seus registros e não
altera os dados ou regras de MIS SCAN.

## Uso

A abertura da aba e a consulta da API exigem o PIN da Instrutoria. A tela de
bloqueio é exibida antes de carregar qualquer registro ou indicador. Ao sair da
aba, o PIN em memória e os dados exibidos são limpos. Registrar anomalia e
atualizar tratativa também exigem a tela de PIN da Instrutoria. O PIN também protege o download de
fotos/PDFs. A validação de escrita ocorre no servidor.

Registro: data/hora da ocorrência em São Paulo, turno informado, área, processo,
atividade/desvio, tema opcional, prioridade, líder/responsável opcional, prazo
combinado opcional, descrição/impacto, instrutor e até três evidências de até 4 MB.
Não é criado prazo automático. Ausência de líder ou turno permanece explícita.
T4 é consolidado no T2; T5 no T3. A ocorrência inicia Aberta.

Atualização: Aberta, Em andamento, Aguardando validação ou Concluída. Exige nome do
responsável pela atualização. Concluir exige ação e evidência descritiva/link;
reabrir exige motivo. Cada atualização mantém o histórico e usa versão otimista
para impedir sobrescrever alterações feitas por outra pessoa.

## Recorrências

Grupo = área + processo + atividade, normalizados por caixa, acentos e espaços.
Não usa apenas o processo nem agrupa descrições diferentes por aproximação.
Padronize a atividade: reutilize o mesmo nome para o mesmo desvio.

Repetições no filtro = max(quantidade do grupo - 1, 0). A primeira ocorrência não
conta como repetição. Após conclusão = uma nova ocorrência cuja data/hora real
seja posterior a uma conclusão registrada de outra ocorrência do mesmo grupo.
Uma inclusão retroativa com data anterior à conclusão não é considerada uma nova
falha após tratativa. Reaberturas mantêm o histórico da conclusão anterior.

Atraso = prazo informado anterior ao dia atual em São Paulo e situação diferente
de Concluída. Data de registro, data da ocorrência e data da conclusão têm papéis
distintos. O painel tem período próprio e filtros independentes do MIS SCAN.

## Persistência e limites

Tabelas misscan_anomalies, misscan_anomaly_files e
misscan_anomaly_file_chunks. Arquivos validados pelo conteúdo e armazenados em
blocos de 500 KB. Cadastro e anexos são gravados na mesma transação; erro de
arquivo não deixa ocorrência parcial. IDs de cadastro são idempotentes.

Consultas têm limite explícito de 10 mil registros, sem totais parciais
silenciosos. A versão inicial não envia avisos de anomalias ao SeaTalk.

Rotas: GET/POST /api/anomalias e GET /api/anomaly-files?id=...

## Cockpit e navegação

Acesso pelo menu separado Operacional > Anomalias e recorrências. A aba exige
PIN para consultar a base e preserva o bloqueio ao sair.

Estrutura: menu lateral, filtros avançados, seis indicadores de concentração,
resumo de situação, evolução por mês/semana ISO/dia do mês/dia da semana,
rankings de turnos, lideranças, áreas, repetições por processo e atividades,
além da tabela base com descrição e histórico expansíveis.

Filtros adicionais: instrutor/auditor (campo reporter), tema e sinergia.
Sinergia e nomes de orientados são opcionais no novo registro. Ausência de nomes
é apresentada como não informada, não como zero participantes confirmados.
A coluna Reinc. informa o número de ocorrências anteriores do mesmo grupo
na seleção atual (primeira = 0), não o total genérico do processo.
Os indicadores de líderes/turnos mostram associação dos registros, não comprovam
responsabilidade causal. Campos ausentes continuam explícitos.

## Assinaturas de orientação
Na ficha de nova anomalia, marque “Orientação realizada — registrar assinaturas”. Preencha o instrutor e um nome completo por linha em orientados. Selecione cada signatário, assine com dedo/caneta/mouse e clique em “Salvar assinatura na ficha”. São exigidas a assinatura do instrutor e a de cada orientado. Alterar nomes invalida as respectivas assinaturas.

Os traçados e os nomes são validados no servidor e persistidos no payload D1 da ocorrência com horário de registro do servidor. A consulta protegida exibe as assinaturas no detalhe do registro. As atualizações de situação preservam as assinaturas originais. Não há armazenamento local ou envio ao SeaTalk. Registros sem orientação realizada e registros antigos continuam permitidos e são apresentados sem assinaturas, sem presunção de orientação.

## Seleção de processo
Novas anomalias oferecem as 29 opções de processo informadas pelo COP (numeração original 1–22 e 24–30), mais “Outros”. A opção Outros exibe um motivo obrigatório de até 232 caracteres, validado também na API; o processo é salvo como “Outros: [motivo]” para manter a descrição nos filtros, detalhes e exportação. Os processos de registros anteriores são preservados.

## Abertura da ficha de registro
Depois de desbloquear a aba Anomalias, “Registrar anomalia” abre a ficha sem pedir o PIN novamente. O salvamento continua autenticado com o PIN validado da aba, mantido apenas em memória. Ao sair/bloquear a aba, a ficha e a autorização são limpas. A confirmação adicional das atualizações e dos anexos permanece.

## Uso no celular / Gemba
A ficha não solicita Sinergia nem Prazo nos novos registros. Os valores históricos são preservados. No celular (até 600 px), a ficha ocupa a tela, com campos em uma coluna e rolagem própria; cabeçalho e ações de cancelar/salvar permanecem visíveis. Campos com fonte de 16 px, botões de pelo menos 44–48 px e espaço seguro inferior favorecem uso por toque. A assinatura permite desenho no campo sem rolar a página.

## Relatório de Gemba por turno
Na aba protegida, use “Gerar relatório do turno”. Informe início e fim do recorte em horário de São Paulo e o turno. Ajuste a data final se o turno atravessar a meia-noite. O intervalo máximo é de 36 horas, com os minutos inicial e final incluídos. A consulta usa a API autenticada, independe dos filtros do painel e aplica o horário exato no relatório. T4 é consolidado no T2; T5 no T3.

A prévia reúne resumo, áreas com registros, processos, repetições da mesma área/processo/atividade, orientações assinadas, descrição/ações de cada ocorrência e pendências do recorte. Não comprova a cobertura de Gemba em áreas sem registros nem reconstrói o status no fechamento histórico: reflete a situação atual na consulta. Orientados são nomes exatos, sem deduplicação por OPSID. Orientação declarada só entra como assinada quando há assinatura do instrutor e de cada orientado.

Revise/edite o texto na prévia. “Copiar mensagem” e “Imprimir / Salvar PDF” usam o texto revisado. A impressão usa o diálogo do navegador, com opção Salvar como PDF. Não há envio automático, agendamento, gravação do rascunho nem alteração dos registros. Ao mudar o recorte, fechar o relatório ou bloquear/sair da aba, o texto é descartado. Respostas atrasadas são ignoradas. A API não é consultada sem a aba desbloqueada.

Validação: testes de madrugada, minutos de fronteira, consolidação de turnos, validação do intervalo, duplicados, contagens e assinaturas, base vazia, escape de HTML, consulta com PIN e recorte independente, cópia/impressão da revisão, invalidação e bloqueio com resposta atrasada.
