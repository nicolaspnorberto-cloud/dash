import { envValue, json } from '../lib/blob-store.mjs';
import {
  resolveSeatalkGroup,
  seatalkConfigured,
  sendSeatalkText
} from '../lib/seatalk.mjs';

function assertWritePin(request) {
  const expected = envValue('TREATMENT_WRITE_PIN');
  const received = String(request.headers.get('x-treatment-pin') || '').trim();
  if (!expected) {
    const error = new Error('TREATMENT_WRITE_PIN não configurado.');
    error.status = 503;
    throw error;
  }
  if (!received || received !== expected) {
    const error = new Error('PIN de gravação inválido.');
    error.status = 401;
    throw error;
  }
}

export async function GET() {
  return json({
    ok: true,
    configured: seatalkConfigured(),
    route: '/api/seatalk',
    message: 'Integração de alertas do SeaTalk.'
  });
}

export async function POST(request) {
  try {
    assertWritePin(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || 'test').toLowerCase();
    if (action === 'status') {
      const group = await resolveSeatalkGroup();
      return json({ ok: true, configured: true, group: group.name });
    }
    if (action !== 'test') {
      return json({ ok: false, error: 'Ação inválida.' }, 400);
    }
    const result = await sendSeatalkText(
      '🐕 Fiscal de Misscan MG4\n\n✅ Integração concluída. O dashboard já pode enviar alertas de diálogos e reciclagens.'
    );
    return json(result);
  } catch (error) {
    console.error('SEATALK_TEST_ERROR', error);
    return json({ ok: false, error: error?.message || 'Falha no teste do SeaTalk.' }, Number(error?.status || 500));
  }
}
