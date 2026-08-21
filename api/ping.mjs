import { json } from '../lib/blob-store.mjs';

export async function GET() {
  return json({
    ok: true,
    service: 'misscan-v6.4',
    architecture: 'apps-script-push + dynamic-lm-history + isolated-syncs',
    features: [
      'historico-lm-completo',
      'backfill-retomavel',
      'incremental-sem-depender-da-ordem-da-LM',
      'filtro-data',
      'calendarizacao-independente',
      'tratativas',
      'email-queue',
      'taxa-real-preparada'
    ],
    route: '/api/ping',
    timestamp: new Date().toISOString()
  });
}
