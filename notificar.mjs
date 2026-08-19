function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export async function GET() {
  return json({
    ok: true,
    service: "misscan-email-api",
    route: "/api/notificar",
    methods: ["POST"],
    message: "Rota publicada corretamente. Use POST para enviar notificações."
  });
}

export async function POST(request) {
  const endpoint = process.env.APPS_SCRIPT_EMAIL_URL;
  const token = process.env.EMAIL_WEBHOOK_TOKEN;

  if (!endpoint || !token) {
    return json({
      ok: false,
      error: "Variáveis APPS_SCRIPT_EMAIL_URL e/ou EMAIL_WEBHOOK_TOKEN não configuradas na Vercel."
    }, 500);
  }

  if (!String(endpoint).includes("script.google.com") || !String(endpoint).endsWith("/exec")) {
    return json({
      ok: false,
      error: "APPS_SCRIPT_EMAIL_URL inválida. Use a URL publicada do Apps Script terminando em /exec."
    }, 500);
  }

  try {
    const payload = await request.json();

    const form = new URLSearchParams();
    form.set("token", token);
    form.set("payload", JSON.stringify(payload));

    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
      },
      body: form.toString(),
      redirect: "follow"
    });

    const text = await upstream.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return json({
        ok: false,
        error: "O Apps Script não retornou JSON. Confirme a implantação como Web App e a URL /exec.",
        upstreamStatus: upstream.status,
        upstreamPreview: text.slice(0, 300)
      }, 502);
    }

    if (!upstream.ok || !data.ok) {
      return json({
        ok: false,
        error: data.error || `Apps Script retornou HTTP ${upstream.status}.`,
        upstreamStatus: upstream.status
      }, 502);
    }

    return json({
      ok: true,
      recipients: data.recipients || [],
      subject: data.subject || "",
      quotaRemaining: data.quotaRemaining ?? null
    });
  } catch (error) {
    console.error("MISSCAN_EMAIL_API_ERROR", error);

    return json({
      ok: false,
      error: error?.message || "Falha interna ao processar a notificação."
    }, 500);
  }
}
