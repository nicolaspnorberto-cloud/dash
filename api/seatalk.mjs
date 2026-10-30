import { envValue, json, readJson, runtimeBinding } from '../lib/blob-store.mjs';
import { PRESENCE_PATH, selectPresentTreatments } from '../lib/abs-presence.mjs';
import {
  SEATALK_PAUSED,
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

async function recentAttempts(){
  const db=runtimeBinding('MISSCAN_DB');
  if(!db)return [];
  try{
    const result=await db.prepare("SELECT value FROM misscan_store WHERE key LIKE 'misscan/seatalk-attempts/%' ORDER BY updated_at DESC LIMIT 36").all();
    return (result.results||[]).map(row=>{
      const r=JSON.parse(row.value);
      return {turn:r.turn,attemptedAt:r.attemptedAt,finishedAt:r.finishedAt,phase:r.phase,sent:r.sent===true,skipped:r.skipped===true,reason:r.reason||'',pending:r.pending??null,deferred:r.deferred??null,closingReport:r.closingReport===true};
    });
  }catch{return [];}
}
export async function GET() {
  const lastT2Attempt=await readJson('misscan/seatalk-last-attempt-t2.json',null);
  const attempts=await recentAttempts();
  const lastT3Attempt=await readJson('misscan/seatalk-last-attempt-t3.json',null);
  const presence = await readJson(PRESENCE_PATH, null);
  const presenceHealth = selectPresentTreatments([], presence);
  // Public status confirms the active reminder destination after each deploy.
  return json({
    ok: true,
    configured: seatalkConfigured(),
    lastT3Attempt,
    lastT2Attempt,
    recentAttempts:attempts,
    paused: SEATALK_PAUSED,
    route: '/api/seatalk',
    newHireHighlight:{enabled:true,source:'COPPIT - ABS / data_admissao',rule:'FIRST_CALENDAR_MONTH_FROM_ADMISSION',match:'OPSID',messages:['HOURLY','CLOSING'],unconfirmed:'NOT_LABELED_AS_NEW'},
    destination: seatalkDestinationName(),
    presenceSync: { available: presenceHealth.available, dateKey: presence?.dateKey || '', generatedAt: presence?.generatedAt || '', reason: presenceHealth.reason || '' },
    t3Reminder:{enabled:true,destination:'📊 T3 | Gestão de Performance & Tratativas',turns:['T3','T5'],start:'21:30',closing:'05:30',frequency:'HOURLY_AT_30',presence:{required:true,requiredFrom:'23:30',exemptHours:['21:30','22:30']},presenceDate:'SHIFT_START_DATE',nightPresenceReady:!!presence?.previousDay,timezone:'America/Sao_Paulo',blockedAfterClosing:true},
    dailyReminder: {
      enabled: !SEATALK_PAUSED,
      start: '13:00',
      end: '22:59:59',
      blockedFrom: '23:00',
      manualBypassAllowed: false,
      frequency: 'HOURLY_13_TO_22',
      closingReport: null,
      timezone: 'America/Sao_Paulo',
      target: 0.88,
      preset: 'YESTERDAY',
      recurrence: 'NEXT_DAILY_OCCURRENCE',
      presence: { required: true, requiredFrom: '15:00', exemptHours: ['13:00','14:00'], source: 'ABS', identity: 'OPSID', date: 'TODAY_SAO_PAULO', maxAgeMinutes: 60, unconfirmed: 'SKIP_CHARGE' },
      treatmentFlow: [
        '1º diálogo',
        '1ª reciclagem',
        '2º diálogo',
        '2ª reciclagem',
        '3º diálogo',
        '3ª reciclagem'
      ]
    },
    message: SEATALK_PAUSED ? 'Robô de MIS SCAN pausado por solicitação da operação.' : 'Integração de alertas do SeaTalk.'
  });
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || 'test').toLowerCase();
    assertWritePin(request);
    if (action === 'daily-dialogues-t3') {
      return json(await sendDailyDialogueReminder({ force: true, turn: 'T3' }));
    }
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
