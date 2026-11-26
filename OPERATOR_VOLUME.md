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
