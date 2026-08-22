import { json } from '../lib/blob-store.mjs';

export async function GET() {
  return json({
    ok: true,
    service: 'misscan-v6.8',
    version: '6.8',
    architecture: 'vercel-private-queue + exact-lm-date-snapshot',
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
