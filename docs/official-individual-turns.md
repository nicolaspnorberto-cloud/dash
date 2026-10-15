# Colaboradores oficiais por turno

OUT_05_COLABORADOR_DIA mantém os totais diários. OUT_04_COLABORADOR_RANK detalha parte de “Demais colaboradores” por semana e mês. A integração subtrai os valores individuais já presentes em OUT_05, valida os totais por área e usa somente a diferença conciliada. Turno, setor e líder vêm do HC Matinal; T4 corresponde a T2 e T5 a T3.

O detalhe semanal só é exibido quando todo o período está selecionado. Não recebe data diária inventada e não alimenta cobranças diárias. `/api/dados?individualize=1` entrega `individualizedRows` separadamente de `misscan`, que continua diário. A evolução semanal também usa os detalhes conciliados.

Os detalhes ficam no armazenamento existente do dashboard, recebidos pela integração autenticada. Nenhum snapshot com dados individuais é incluído no repositório. Cada período tem uma impressão SHA-256 dos registros diários; qualquer alteração na fonte impede a aplicação de um detalhe antigo.

`OFFICIAL_MG4_SYNC.gs` envia `weeklyRows` para gerar detalhes atualizados no servidor. A cópia instalada no Apps Script precisa incorporar essa versão para ativar e atualizar os períodos. Integrações antigas permanecem compatíveis, mas não fornecem a recuperação semanal.

Pessoas sem cadastro ou sem turno permanecem como pendências individuais. Agregados sem nomes ficam como “Sem detalhamento individual” e não são considerados colaboradores no ranking ou nas pendências de HC.
