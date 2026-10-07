import { envValue, json, readJson } from '../lib/blob-store.mjs';
import { PRESENCE_PATH, selectPresentTreatments } from '../lib/abs-presence.mjs';
import {
  resolveSeatalkGroup,
  seatalkConfigured,
  seatalkDestinationName,
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
  const presence = await readJson(PRESENCE_PATH, null);
  const presenceHealth = selectPresentTreatments([], presence);
  // Public status confirms the active reminder destination after each deploy.
  return json({
    ok: true,
    configured: seatalkConfigured(),
    route: '/api/seatalk',
    destination: seatalkDestinationName(),
    presenceSync: { available: presenceHealth.available, dateKey: presence?.dateKey || '', generatedAt: presence?.generatedAt || '', reason: presenceHealth.reason || '' },
    dailyReminder: {
      enabled: true,
      start: '13:00',
      end: '23:00',
      frequency: 'HOURLY_UNTIL_22_AND_CLOSING_AT_23',
      closingReport: '23:00',
      timezone: 'America/Sao_Paulo',
      target: 0.88,
      preset: 'YESTERDAY',
      recurrence: 'NEXT_DAILY_OCCURRENCE',
      presence: { required: true, source: 'ABS', identity: 'OPSID', date: 'TODAY_SAO_PAULO', maxAgeMinutes: 60, unconfirmed: 'SKIP_CHARGE' },
      treatmentFlow: [
        '1º diálogo',
        '1ª reciclagem',
        '2º diálogo',
        '2ª reciclagem',
        '3º diálogo',
        '3ª reciclagem'
      ]
    },
    message: 'Integração de alertas do SeaTalk.'
  });
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || 'test').toLowerCase();
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
