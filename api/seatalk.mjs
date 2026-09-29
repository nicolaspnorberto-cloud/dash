import { envValue, json, readJson, writeJson } from '../lib/blob-store.mjs';
import {
  resolveSeatalkGroup,
  seatalkConfigured,
  sendSeatalkText
} from '../lib/seatalk.mjs';
import { sendDailyDialogueReminder } from '../lib/seatalk-reminders.mjs';

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
    dailyReminder: {
      enabled: true,
      time: '13:00',
      timezone: 'America/Sao_Paulo',
      target: 0.88,
      preset: 'LAST_7'
    },
    message: 'Integração de alertas do SeaTalk.'
  });
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || 'test').toLowerCase();
    if (action === 'one-time-test') {
      const token = String(request.headers.get('x-seatalk-onetime-token') || '').trim();
      if (token !== '8e0fdf521d35f39c9ff6ff9667695266aba43ada83d03b60') {
        return json({ ok: false, error: 'Token de teste inválido.' }, 401);
      }

      const statePath = 'misscan/seatalk-onetime-test.json';
      const state = await readJson(statePath, null);
      if (state?.sentAt) {
        return json({ ok: false, error: 'O teste único já foi enviado.', sentAt: state.sentAt }, 409);
      }

      const result = await sendSeatalkText(
        '🐕 Fiscal de Misscan MG4\n\n✅ Teste concluído: o dashboard está conectado ao grupo TESTE BOT.\n\nAs cobranças automáticas de diálogos serão enviadas diariamente às 13h00.'
      );
      await writeJson(statePath, {
        sentAt: new Date().toISOString(),
        group: result?.group || 'TESTE BOT',
        messageId: result?.messageId || ''
      });
      return json(result);
    }

    assertWritePin(request);
    if (action === 'status') {
      const group = await resolveSeatalkGroup();
      return json({ ok: true, configured: true, group: group.name });
    }
    if (action === 'daily-dialogues') {
      return json(await sendDailyDialogueReminder({ force: true }));
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
