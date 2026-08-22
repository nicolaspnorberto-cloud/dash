# V6.8 — correção definitiva da LM por data

## Problema corrigido

Em 21/08/2026 a LM possui 7.020 linhas físicas do dia, com o bloco duplicado.
O total correto é 3.510 BR únicos. O dashboard estava com snapshot parcial (952).

## Nova regra

Ao clicar **Atualizar agora**:

1. o dashboard envia a data inicial/final selecionada;
2. o Apps Script varre TODA a aba LM;
3. filtra exatamente a data solicitada;
4. mantém somente `is_misscan = Sim`;
5. ignora cabeçalhos repetidos;
6. deduplica por `data + shipment_id`;
7. a API remove o snapshot antigo dessa data;
8. grava o snapshot completo e só depois o dashboard recarrega.

## GitHub/Vercel

Suba todos os arquivos da V6.8:

```bash
git add -A
git commit -m "V6.8 corrige LM exata por data"
git push origin main
```

Teste:

`https://dash-b52u.vercel.app/api/ping`

Esperado: `"service":"misscan-v6.8"`.

## Apps Script

Cole `BackendV68.gs` inteiro e salve.

Execute UMA VEZ:

`instalarFilaAtualizacaoV68`

Esse comando remove o gatilho antigo V6.7 da fila e cria o V6.8 a cada 1 minuto.

## Validação antes do dashboard

Execute:

`testarLM21082026V68`

Esperado no log:

`V6.8 VALIDAÇÃO OK: 21/08/2026 = 3510 BR únicos.`

Também deverá mostrar aproximadamente:
- `matchingDateRows: 7020`
- `uniqueRows: 3510`
- `duplicatesRemoved: 3510`

## Teste final

No dashboard:

1. selecione **Ontem / 21/08/2026**;
2. clique **Atualizar agora**;
3. aguarde `Na fila → Sincronizando → Dados online`;
4. BR MISSCAN deve ficar em **3.510**.

A V6.8 substitui os dados antigos de 21/08, então os 952 do snapshot parcial não permanecem no Blob.
