import { json } from '../lib/blob-store.mjs';

export async function GET() {
  return json({
    ok: true,
    service: 'misscan-v6.1',
    architecture: 'apps-script-push + monthly-private-history',
    features: ['historico', 'filtro-data', 'tratativas', 'email-queue'],
    route: '/api/ping',
    timestamp: new Date().toISOString()
  });
}
