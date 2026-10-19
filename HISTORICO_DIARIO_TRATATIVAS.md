# Histórico diário de tratativas

Na aba Tratativas, os botões alternam entre o acompanhamento atual e o histórico diário. O histórico possui datas e filtros próprios; o período global não encerra nem exclui os registros persistidos.

## Ativação

Após publicar o Worker, abrir Histórico diário de pendências, informar o PIN de tratativas e clicar em Carregar / atualizar histórico. A primeira carga grava a data de ativação em São Paulo e importa os dias completos disponíveis na fonte oficial. As cargas oficiais seguintes alimentam automaticamente o histórico ativado. Também é possível atualizar pela tela.

## Fontes e classificação

- Contagens: OUT_05 MG4, mesma contagem agregada oficial. Entrada quando o share diário ultrapassa 0,88%, considerando no denominador todos os Miss Scans oficiais do dia, inclusive não identificados.
- Identidade e cadastro: OPSID e HC Matinal. Ambiguidade, cadastro ausente ou turno não confirmado exigem conferência.
- Chave: dia da ocorrência + OPSID. Nomes sem identidade confirmada ficam em conferência, sem inventar OPSID.
- O dia atual não é classificado enquanto estiver em andamento.
- Ocorrências anteriores à ativação começam como Histórico não confirmado. Ausência de registro não prova ausência de tratativa.
- Ocorrências novas com histórico suficiente podem entrar como pendentes. Evidência anterior sem vínculo, sequência incompleta, retirada do processo ou fluxo esgotado exigem validação.
- Presença: consulta atual da ABS com a mesma proteção e expiração da aba Tratativas. Ausência não conclui ou apaga uma pendência.

## Conferência e vínculo

O responsável informado confirma OPSID, dia, ação/ciclo e justificativa. Pode validar uma pendência histórica ou vincular um registro real compatível de diálogo, reciclagem MIS SCAN em grupo ou tratativa já registrada. O registro deve ser do mesmo OPSID e da data da ocorrência ou posterior. O vínculo é explícito; coincidência de datas não encerra ocorrências automaticamente.

Uma combinação OPSID + tipo de tratativa + data pode atender somente uma ocorrência. Essa restrição também impede duplicações entre fontes. Reciclagem em grupo possui vínculo individual por participante.

A confirmação não modifica a planilha de diálogos nem os registros originais de reciclagem. Uma linha concluída não significa que todos os passos do ciclo estão concluídos. O robô continua com o funcionamento existente; este histórico não altera seus envios.

## Persistência e revisão

Os registros, vínculos e auditoria ficam na tabela D1 `misscan_daily_treatments`. Gravações usam versão otimista e unicidade da evidência. Fonte corrigida preserva o registro e a auditoria; pendências retiradas da fonte voltam à conferência, sem nova cobrança automática. Registros fora da janela que a fonte ainda disponibiliza permanecem preservados.

Consultas e gravações exigem o PIN existente. As respostas são privadas e sem cache. O PIN compartilhado não identifica uma pessoa: a auditoria registra o nome do responsável informado na conferência.


## Carregamento em etapas

A atualização manual percorre até sete dias da fonte por requisição, com continuação automática e progresso na tela. A listagem só é feita após concluir a importação. É seguro repetir a atualização: os vínculos, estados validados e auditorias são preservados. A revisão da fonte só alcança as datas da etapa processada.

As gravações usam lotes JSON de até 100 registros por consulta D1, inclusive revisões, para evitar uma consulta por ocorrência. A HC e os históricos são indexados uma vez por processamento. Falhas sem JSON exibem o código HTTP, sem expor o conteúdo bruto da resposta do servidor.

## Cruzamento automático de registros

A consulta cruza cada ocorrência com os registros pelo OPSID e compara as datas. Mostra datas dos diálogos e reciclagens posteriores ou do mesmo dia, além dos registros anteriores na conferência. Registro anterior não quita reincidência. Um registro localizado não é um vínculo confirmado, não conclui várias ocorrências e não inicia outro ciclo.

Resultados: tratativa localizada (conferir vínculo), sem diálogo localizado, pendência confirmada, vínculo confirmado, fonte/vínculo a conferir e validação operacional. “Sem diálogo localizado” exige cobertura de todos os dias entre a ocorrência e a consulta; significa ausência de registro na fonte, não prova de que a conversa não aconteceu. Sem cobertura suficiente, continua exigindo conferência.

O histórico da planilha de diálogos pode ser importado, com o PIN existente, a partir de uma leitura completa identificada pelo ID/aba da fonte, período até ontem, instante da leitura e registros. São aceitos até 119 dias e uma leitura de até 24 horas. A qualificação é SOC-MG4, Desenvolvimento e motivo Miss Scan. Assinaturas, descrições livres e dados de outros motivos não são armazenados. O snapshot fica em armazenamento privado separado; não muda a fonte do bot, horários ou envios. O dia atual e os novos dias continuam vindo da sincronização existente. Correções retroativas na planilha exigem nova leitura histórica; o painel mostra o instante de conferência da leitura.

Reciclagens são as registradas nesta dashboard; ausência de registro nela não garante ausência em fontes externas. A idade exibida é o número de dias desde a ocorrência, sem atribuir automaticamente tempo de pendência a registros ainda não validados.
