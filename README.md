# Mis-Scan Control Center V2

Dashboard estático para Vercel, com Base de HC integrada e botões/filtros funcionais.

## Regras implementadas

- `shipment_id` = BR.
- `socpacked_tonumber` = TO.
- `process_fail = Packed TO` => EXPEDIÇÃO.
- `process_fail` começando com `Extra Parcel` => ESTEIRA.
- Quando `process_fail` não classifica, `to_mis_status = Whole TO` => EXPEDIÇÃO e `to_mis_status = Extra Parcel` => ESTEIRA.
- `operator_fail` com exatamente um colaborador válido => IDENTIFICADO.
- `operator_fail` com mais de um colaborador => NÃO IDENTIFICADO.
- Valores vazios, `Not Identified`, OPS sem nome ou e-mail técnico => NÃO IDENTIFICADO.
- Colaborador encontrado na Base HC => Fixo + Turno + Setor + Líder.
- Colaborador identificado e não encontrado na Base HC => Diarista / cadastro pendente.
- Registros duplicados de `shipment_id` são consolidados para contar BR único.

## Arquivos

- `index.html` — interface.
- `styles.css` — visual.
- `app.js` — regras, filtros, ranking e projeção.
- `misscan.json` — base Misscan padrão.
- `hc.json` — Base HC tratada.
- `vercel.json` — configuração estática.

## Deploy na Vercel

Envie esta pasta para um projeto Vercel como site estático. Não há etapa de build.

## Atualização das bases

Na própria interface há dois botões:

- **Carregar Misscan**: aceita CSV com as mesmas colunas da base LM.
- **Carregar Base HC**: aceita o CSV da Base de HC contendo o cabeçalho `colaborador`, seguido de Turno, Setor e líder.

O carregamento é feito no navegador para teste. Para produção, a recomendação é conectar uma API/Google Sheets e manter a base HC fora de repositórios públicos.

## Privacidade

A Base HC contém nomes e e-mails corporativos. Não publique `hc.json` ou o CSV bruto em um repositório público ou em um dashboard de acesso aberto. Para produção, use controle de acesso e backend/API.
