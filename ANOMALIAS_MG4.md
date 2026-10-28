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
