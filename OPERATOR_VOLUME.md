# Erro por volume bipado — integração

A aba está integrada à navegação existente e não modifica share oficial, target, bot ou tratativas.

## Situação da fonte
O aplicativo de produtividade informado mostra OPSID, total de bipes e filtros de período. O link de execução não confirmou uma API de exportação, a planilha de origem ou se os bipes são BRs únicos. A conexão automática depende do Code/Index ou da planilha de origem. Não há scraping automático nem números de exemplo na dashboard.

## Contrato de sincronização
POST /api/operator-volume usa a autenticação X-Sync-Token já existente. Substitui um snapshot completo, não soma a importações anteriores. Os dias de cobertura devem incluir somente dias integralmente apurados. Consolidar a produção por OPSID e data antes do envio.

Formato JSON (valores ilustrativos, nunca enviados em produção):

```json
{
  "source": "Produtividade Esteiras SPX",
  "unit": "BIPES",
  "days": ["2026-11-20"],
  "rows": [{"date": "2026-11-20", "opsid": "OPS123", "bipes": 5000}],
  "errorSource": "Base oficial por data real de processamento",
  "errorDays": ["2026-11-20"],
  "processingErrors": [{"date": "2026-11-20", "opsid": "OPS123", "br": "BR123456"}]
}
```

Usar BR_UNICOS somente após confirmar a deduplicação na origem. Não converter volume de TO/gaiolas em volume de pacotes. Os erros devem ser BRs únicos confirmados pela regra oficial, sem misrouting e sem fallback de atribuição. A data deve ser a data real de processamento desse BR; a data de recebimento LM e o evento probabilístico de um BR par não substituem essa data.

Sem errorSource e errorDays completos, a produção pode aparecer, mas as taxas permanecem indisponíveis. Não substituir os agregados OUT_05/OUT_12 por listas de exemplos de BR. A extração dos erros por processamento ainda precisa ser conectada à fonte detalhada oficial.

GET /api/operator-volume?from=AAAA-MM-DD&to=AAAA-MM-DD retorna o snapshot no intervalo. A primeira carga da aba e o botão Atualizar consultam esse endpoint. Não há agendamento automático configurado enquanto a fonte não for validada.

Turno/líder/nome vêm da HC Matinal da dashboard pelo OPSID. Cadastros duplicados ficam sem atribuição. Colaboradores novos participam deste painel normalmente. Percentuais dependem de cobertura integral das duas fontes; não significam taxa oficial de MIS SCAN por recebimento LM.

## Validação
Testes unitários cobrem cálculo, ausência versus zero, cobertura parcial, deduplicação/conflito de BR, duplicação de produção, datas inválidas, divisão por zero, erros acima do volume e HC ambígua. A publicação Cloudflare e a carga real devem ser confirmadas separadamente.

## Fonte conectada em 26/11/2026

Planilha: 149QIaAKlVpq28Nm_zPYMb3l0n8LY2ssUpLRC5ShatD8. Usar prod_hist (gid 0) e prod_d0 (gid 36257454); campo packing, data date, identidade operator_id. packed/packed_d0 contam TOs e gaiolas e não entram neste denominador. Consulta pública sem autenticação respondeu 401; preservar os acessos existentes.

PRODUTIVIDADE_HC_SYNC.gs realiza leitura autenticada no Apps Script existente da dashboard. Nenhuma modificação é feita na planilha de origem. D0 substitui a data sobreposta ao histórico. Deduplica registros idênticos por data/posto/hora/OPSID, rejeita contagem conflitante, soma produção por pessoa/dia e identifica o dia atual como parcial. Este volume é bipes, sem confirmação de BRs únicos. O POST productionOnly preserva a fonte de erros previamente carregada.

Validação em Apps Script confirmou extração de 11 a 26/11, com dia 26 parcial. Instalar o acionador somente após primeira sincronização HTTP bem-sucedida. A ativação e publicação precisam ser confirmadas por logs e pela API. Os erros por processamento permanecem uma integração separada; não inventar taxas com agregados por recebimento LM.

## Comparativo oficial de período (OUT_05)

A leitura de erros passou a usar exclusivamente misscan/official-mg4.json, sincronizado da OUT_05_COLABORADOR_DIA do SoC a SoC BR. Filtro obrigatório ESTЕIRA/MG4. O numerador utiliza official_count e a data_ref oficial, sem reconstruir BRs de exemplo e sem usar Matinal/LM. OPSID direto da identidade oficial; nomes exatos só são associados pela HC Matinal quando unívocos. Quantidades sem identidade confirmada são informadas separadamente.

O percentual compara erros oficiais recebidos no período com produção bipada nesse período. Não é a taxa oficial do SOC nem comprova que o erro é dos mesmos pacotes produzidos nessa janela. A interface e o CSV identificam essa referência. A data real de processamento permanece distinta; não usar data_hora_evento_atribuicao de BR par como substituição. A quantidade agregada oficial é suficiente para este comparativo, sem exigir a lista BR a BR.
