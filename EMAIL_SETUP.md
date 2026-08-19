# V4.2 — Configuração das notificações por e-mail

A V4.2 envia e-mail automaticamente quando:

1. um Diálogo de Performance é marcado como realizado;
2. uma Reciclagem é concluída.

Destinatários:
- líder do colaborador tratado (obtido da Base HC);
- instrutor/responsável que realizou a ação (e-mail informado no modal).

## 1. Criar o Apps Script de e-mail

1. Abra https://script.google.com
2. Crie um novo projeto.
3. Apague o conteúdo do `Code.gs`.
4. Cole todo o conteúdo do arquivo `EmailBackend.gs`.
5. Salve.

## 2. Criar um token secreto

No Apps Script:

1. Execute a função `gerarTokenWebhook`.
2. Abra o Registro de execução.
3. Copie o token gerado.

Depois:

1. Abra **Configurações do projeto** no Apps Script.
2. Em **Propriedades do script**, adicione:
   - `WEBHOOK_TOKEN` = token copiado.

Opcional, para registrar auditoria:
- `SPREADSHEET_ID` = ID da planilha onde você quer criar a aba `EMAIL_LOG`.

## 3. Implantar o Apps Script

1. Clique em **Implantar > Nova implantação**.
2. Tipo: **Aplicativo da Web**.
3. Executar como: **Eu**.
4. Quem tem acesso: **Qualquer pessoa** (se a política corporativa permitir).
5. Clique em **Implantar**.
6. Copie a URL que termina em `/exec`.

> O endpoint é protegido pelo token secreto. Não coloque o token no GitHub.

## 4. Configurar a Vercel

Na Vercel:

1. Abra o projeto do dashboard.
2. Vá em **Settings > Environment Variables**.
3. Crie:
   - `APPS_SCRIPT_EMAIL_URL` = URL `/exec` do Apps Script.
   - `EMAIL_WEBHOOK_TOKEN` = o mesmo token salvo no Apps Script.
4. Marque pelo menos **Production**.
5. Salve.
6. Faça um novo deploy/redeploy.

## 5. Subir a V4.2 no GitHub

Envie ao mesmo repositório:
- `index.html`
- `styles.css`
- `app.js`
- `tratativas.json`
- pasta `api/` com `notificar.js`

Os arquivos `EmailBackend.gs` e `EMAIL_SETUP.md` podem ficar no repositório como documentação, mas não são usados diretamente pelo navegador.

## Funcionamento

### Diálogo
Ao clicar em "Salvar e marcar realizado":
- salva o diálogo;
- lê o e-mail do líder na Base HC;
- usa o e-mail informado do instrutor;
- chama `/api/notificar`;
- a Vercel encaminha o evento ao Apps Script;
- o Apps Script envia o e-mail para líder + instrutor.

### Reciclagem
O e-mail só é enviado quando a reciclagem é concluída, depois de:
- informações preenchidas;
- pelo menos uma evidência;
- assinatura do colaborador;
- assinatura do responsável.

## Se o líder não tiver e-mail válido
O sistema ainda tenta enviar ao instrutor.

## Se o e-mail falhar
A tratativa continua salva e o histórico registra a falha de envio.

## Restrição corporativa
Se sua organização não permitir publicar Apps Script para "Qualquer pessoa",
será necessário trocar esse backend por Gmail API ou outro serviço de e-mail autenticado.
