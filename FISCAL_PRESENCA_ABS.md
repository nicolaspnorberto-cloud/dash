# Fiscal: cobrança condicionada à presença

A cobrança de tratativas pendentes agora cruza o OPSID com a aba **ABS** da planilha `[SOC-MG4] Controle de Absenteísmo 26 Ver1.1`, para o dia atual em `America/Sao_Paulo`. O período do MIS SCAN continua D-1. O cadastro de reciclagens continua na COPPIT - ABS.

## Regra

- `P`, `S2` (sinergia recebida) e `ON` (presente no onboarding): presença confirmada conforme descrições da aba Apoio, desde que não desligado.
- Falta, folga, atestado, férias, afastamento, desligamento, sinergia enviada e transferência: sem cobrança durante a ausência.
- OPSID não localizado ou duplicado, marca em branco, sigla sem confirmação de presença (`PR`, `TM`, `INT` etc.): sem cobrança até confirmação.
- Snapshot de outro dia, com mais de 60 minutos, ou fonte ausente: envio interrompido, inclusive envio forçado. Retorno `presence-unavailable-or-stale` permite diagnóstico sem mandar mensagem ao grupo.
- Não conclui, exclui ou altera tratativas. Quando a presença volta a ser confirmada, uma tratativa que estiver no acompanhamento volta a ser elegível para cobrança. Não adiciona persistência de ocorrências fora do recorte D-1 existente.
- O fechamento informa quantidade aguardando presença; esses casos não entram como faltantes executáveis nem como realizados.

## Ativação (duas partes necessárias)

1. Publicar os arquivos do Worker desta alteração, incluindo `/api/presence-sync`.
2. No projeto Apps Script que já executa `sincronizarABSReciclagens`, substituir **ABS_Reciclagens_Auto.gs** pela versão deste commit e executar `instalarSincronizacaoABSReciclagens` uma vez. Usa o `WEBHOOK_TOKEN` já configurado e o gatilho de 30 minutos existente, sem criar gatilho duplicado.
3. Verificar a propriedade `ABS_PRESENCA_LAST_SYNC` e o resultado `presence` da execução. A coluna diária é encontrada pela data real do cabeçalho, incluindo mês e ano, e não por índice fixo.

Não é necessário novo deploy de web app do Apps Script para funções executadas pelo gatilho; é necessário salvar o código e executar a sincronização inicial.

Sem a segunda parte, o Worker não terá presença confirmada e irá suspender cobranças. Coordenar o deploy do Worker com a atualização do Apps Script e a primeira sincronização de presença. Nenhum alerta de teste precisa ser enviado ao grupo.

## Validação

Teste de datas em São Paulo, ausência, retorno, OPSID duplicado, desligados, siglas desconhecidas, snapshot vencido, proteção por token e fechamento. Testes executam apenas dados fictícios e não enviam mensagens ao SeaTalk.
