import { json } from '../blob-store.mjs';

export async function GET() {
  return json({
    ok: true,
    service: 'misscan-cloudflare-v7',
    version: '7.0',
    architecture: 'cloudflare-worker + d1 + exact-lm-date-snapshot',
    features: [
      'lm-full-scan-exact-date',
      'dedupe-date-shipment-id',
      'replace-date-snapshot',
      'private-refresh-queue',
      'gerot',
      'target-0.88'
    ],
    timestamp: new Date().toISOString()
  });
}
