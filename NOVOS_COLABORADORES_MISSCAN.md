# MIS SCAN — Novos colaboradores

A página Novos colaboradores reutiliza os indicadores, filtros e tratativas existentes. Inicia em Tratativas e permite alternar para Indicadores e ranking. O recorte é uma classificação, sem criação de novo cadastro de tratativas, troca de IDs ou exclusão de histórico.

## Regra
- Fonte de admissão: COPPIT - ABS, coluna data_admissao (E), vinculada ao Ops ID (O).
- Turno e líder: HC Matinal atual, sem mudança na origem existente.
- Um mês calendário: a pessoa permanece na página nova desde a admissão até a véspera do aniversário mensal; a partir desse aniversário aparece no principal. Meses sem o mesmo dia usam seu último dia (31/01 → 28/02, ou 29 em ano bissexto).
- Sem data confirmada, inválida, futura ou conflitante: permanece no principal, identificada para validação. Não há inferência pela primeira ocorrência de Miss Scan.
- Classificação pela data atual em São Paulo, inclusive ao consultar histórico. O histórico completo e o progresso compartilham os IDs originais.
- Share mantém o denominador oficial MG4 completo. O bot não foi alterado.
- Dados agregados de destinos não são atribuídos aos novatos: a fonte não permite esse recorte por pessoa.

## Sincronização
ADMISOES_ABS_SYNC.gs é instalado no projeto existente, usa WEBHOOK_TOKEN já configurado e envia apenas OPSID/data para POST /api/admissions. instalarAdmissoesMisscanMG4 faz a carga inicial e instala sincronização a cada 30 minutos. O dashboard consulta o cadastro ao carregar e a cada 5 minutos; reclassifica na mudança do dia (até 1 minuto). Fonte sincronizada e pendências são mostradas na página. Nenhuma data real é salva no Git.

## Validação
Testes cobrem mês calendário, bissextos, fim de mês, fuso, fontes/tokens, conflitos, partição sem duplicidade, denominador MG4 e manutenção das tratativas na passagem de página.
