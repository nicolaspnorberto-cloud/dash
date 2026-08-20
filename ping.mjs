import { json } from '../lib/blob-store.mjs';

export async function GET() {
  return json({
    ok: true,
    service: 'misscan-v6',
    architecture: 'apps-script-push + private-blob',
    route: '/api/ping',
    timestamp: new Date().toISOString()
  });
}
