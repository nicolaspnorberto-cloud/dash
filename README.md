# Mis-Scan Control Center V3 — Calendarização Inteligente

## Modelo da projeção

A projeção agora deixa de usar apenas uma taxa manual.

### Capacidade
Capacidade = HC planejado × horas produtivas × produtividade por HC/hora

### Carga
Carga = Volume previsto / Capacidade

### Fator de carga
- até 90% de carga: 0,95x
- acima de 90% até 100%: 1,00x
- acima de 100% até 110%: 1,10x
- acima de 110%: 1,25x

### Cenários
- Otimista: 0,90x
- Base: 1,00x
- Conservador: 1,15x

### Taxa projetada
Taxa projetada = taxa histórica base do turno × fator de carga × fator do cenário

### Fechamento projetado
(Misscan realizado + Misscan futuro estimado) /
(Volume realizado + Volume futuro)

## Referência de produtividade usada
Período 27/07/2026 a 18/08/2026:
- Geral: 2.496,4 mil / meta 3.005,8 mil / aderência 83,1%
- T1: 737,7 mil / meta 991,8 mil / aderência 74,4%
- T2: 745,2 mil / meta 924,6 mil / aderência 80,6%
- T3: 1.013,5 mil / meta 1.089,5 mil / aderência 93,0%

## Importante
As taxas históricas por turno estão inicialmente em 0,94%.
Quando a base histórica completa de Misscan + volume por turno estiver consolidada,
substitua T1/T2/T3/T4/T5 pelos valores reais.

## Publicação
Substitua os arquivos do mesmo repositório GitHub:
- index.html
- styles.css
- app.js
- misscan.json
- hc.json

Faça Commit. A Vercel fará um novo deploy automaticamente.


## V4 — Tratativas por colaborador

- Corte padrão: indicador > 0,88%.
- A base padrão `tratativas.json` foi gerada a partir da W34 enviada e usa o campo `Share` como indicador importado de demonstração.
- É possível substituir por um CSV real usando o botão **Carregar Indicadores**. Recomenda-se ter as colunas `Colaborador`, `Indicador`, `Miss Scan`, `Operação` e `Período`.
- Turno, setor, líder e tipo HC são enriquecidos pela Base HC.
- O foco visual da tratativa é o colaborador; liderança fica apenas como metadado no detalhe.

### Fluxo
1. Indicador > 0,88% -> 1º Diálogo.
2. 1ª Reciclagem exige informações + pelo menos uma evidência + assinatura do colaborador + assinatura do responsável.
3. Após conclusão, o colaborador fica em monitoramento.
4. O botão `+ Reincidência` abre o 2º ciclo e depois o 3º ciclo.

### Evidências e assinaturas
A V4 estática salva anexos e assinaturas no **IndexedDB do navegador**. Isso torna o fluxo funcional no mesmo dispositivo, mas **não compartilha os arquivos entre usuários**.

Para produção multiusuário, o próximo passo é conectar:
- Vercel -> API/backend;
- arquivos -> Google Drive ou storage corporativo;
- progresso -> Google Sheets/DB;
- autenticação corporativa.


## V4.1 — Ajuste visual e de rolagem
- Paleta padronizada no modelo Live Prod HC: azul-marinho, azul operacional e laranja Shopee.
- Removido roxo das ações principais.
- Botões e filtros reduzidos para uso mais compacto.
- Tratativas e Calendarização usam cards brancos em vez de grandes blocos azuis.
- Tabela de Tratativas não possui mais rolagem vertical interna.
- A página controla a rolagem vertical; a tabela usa apenas rolagem horizontal quando necessário.
- Área útil ampliada em monitores grandes.
