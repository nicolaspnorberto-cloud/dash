import { json } from '../lib/blob-store.mjs';

export async function GET() {
  return json({
    ok: true,
    service: 'misscan-v6.7',
    version: '6.7',
    architecture: 'vercel-private-queue + apps-script-polling',
    features: [
      'atualizar-agora-fila-privada',
      'sem-apps-script-publico',
      'matinal-lm',
      'gerot',
      'target-0.88',
      'email-queue'
    ],
    timestamp: new Date().toISOString()
  });
}
