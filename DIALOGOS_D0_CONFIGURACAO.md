# Diálogos de Performance D-0

O dashboard cruza os ofensores D-1 com os diálogos realizados no dia atual.

## Fonte

- Planilha: `Diálogos de Performance SOC MG4`
- Aba: `Sheet1`
- Identificador: coluna `E-mail Colaborador` (OpsID)
- Data: coluna `Data`

## Regra

Um registro retira o colaborador das cobranças do bot quando:

- a data é o dia atual em `America/Sao_Paulo`;
- a operação é `SOC-MG4`;
- o tipo de diálogo é `Desenvolvimento`;
- o motivo contém `Miss Scan`;
- o OpsID coincide com o OpsID do ofensor.

## Instalação no Apps Script

1. Cole `PATCH_APPS_SCRIPT_DIALOGOS_D0.gs` no final do Apps Script atual.
2. Salve.
3. Execute `instalarSincronizacaoDialogosD0` uma única vez.
4. Autorize o acesso solicitado pelo Google.

Depois disso, a base será sincronizada a cada cinco minutos. O bot continuará
rodando de hora em hora, mas excluirá da próxima mensagem quem já possuir um
diálogo D-0 válido.
