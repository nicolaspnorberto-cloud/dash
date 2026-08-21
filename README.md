MIS-SCAN CONTROL CENTER V6.4

OBJETIVO PRINCIPAL
A aba LM da Matinal passa a ser a fonte oficial e crescente do histórico de Misscan.

MUDANÇAS DA V6.4
- Backfill completo da LM, sem limite fixo de 180 dias.
- Backfill retomável para bases grandes.
- Sincronização incremental não depende de a LM estar ordenada por data.
- Histórico mensal no Blob continua acumulando dias novos.
- HC + LM possuem gatilho independente.
- Calendarização possui gatilho independente.
- Falha do Oráculo/Calendarização não bloqueia a atualização da LM.
- Dashboard mostra início/fim do histórico, dias com Misscan e intervalo em dias.

ARQUIVO DO APPS SCRIPT
BackendV64.gs

PRIMEIRA EXECUÇÃO APÓS PUBLICAR
1. testarConexaoV64()
2. sincronizarHistoricoCompletoLMV64()
3. acompanhar com statusHistoricoLMV64()
4. quando terminar, instalarAutomacoesV64()

ROTINA AUTOMÁTICA
- HC + LM: a cada 30 minutos
- Calendarização: a cada 30 minutos, separada
- E-mails: a cada 5 minutos
- Oráculo: não é instalado automaticamente enquanto a fonte exigir login
