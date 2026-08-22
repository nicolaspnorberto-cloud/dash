import { json } from '../lib/blob-store.mjs';

export async function GET() {
  return json({
    ok: true,
    service: 'misscan-v6.6',
    version: '6.6',
    architecture: 'apps-script-push + dynamic-lm-history + gerot + real-refresh-button',
    features: [
      'historico-lm-dinamico',
      'atualizar-agora-real',
      'refresh-matinal-e-gerot',
      'taxa-geral-forecast-inter-soc-total-f',
      'blocos-historicos-packed-inter-soc',
      'target-0.88',
      'tratativas',
      'email-queue'
    ],
    route: '/api/ping',
    timestamp: new Date().toISOString()
  });
}
