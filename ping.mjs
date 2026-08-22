import { json } from '../lib/blob-store.mjs';

export async function GET() {
  return json({
    ok: true,
    service: 'misscan-v6.5.3.2',
    architecture: 'lm-history + gerot-packed + gerot-forecast + isolated-syncs',
    features: [
      'historico-lm-dinamico',
      'soc-packed-diario-por-turno',
      'taxa-historica-dia-com-dia',
      'forecast-diario-gerot-total-coluna-f',
      'target-fixo-0.88',
      'blocos-somente-historico',
      'calendarizacao-diaria',
      'tratativas',
      'email-queue'
    ],
    route: '/api/ping',
    timestamp: new Date().toISOString()
  });
}
