module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Método não permitido.' });
  }

  const endpoint = process.env.APPS_SCRIPT_EMAIL_URL;
  const token = process.env.EMAIL_WEBHOOK_TOKEN;

  if (!endpoint || !token) {
    return res.status(500).json({
      ok: false,
      error: 'Backend de e-mail não configurado na Vercel.'
    });
  }

  try {
    const payload = req.body || {};

    const form = new URLSearchParams();
    form.set('token', token);
    form.set('payload', JSON.stringify(payload));

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: form.toString(),
      redirect: 'follow'
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Resposta inválida do Apps Script.');
    }

    if (!response.ok || !data.ok) {
      throw new Error(data.error || `Apps Script retornou HTTP ${response.status}.`);
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('EMAIL_NOTIFICATION_ERROR', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Falha ao enviar notificação.'
    });
  }
};
