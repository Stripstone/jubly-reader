import { json } from '../_lib/http.js';

function getKind(req) {
  try {
    if (typeof req?.query?.kind === 'string' && req.query.kind.trim()) return req.query.kind.trim().toLowerCase();
  } catch (_) {}
  try {
    const url = new URL(req.url, 'http://localhost');
    return String(url.searchParams.get('kind') || '').trim().toLowerCase();
  } catch (_) {
    return '';
  }
}

const HANDLERS = {
  'public-config': () => import('../_lib/app-public-config.js'),
  'runtime-config': () => import('../_lib/app-runtime-config.js'),
  health: () => import('../_lib/app-health.js'),
};

export default async function handler(req, res) {
  const kind = getKind(req) || 'health';
  const loader = HANDLERS[kind];
  if (!loader) {
    return json(res, 400, {
      error: 'Unknown app endpoint kind.',
      expected: ['public-config', 'runtime-config', 'health'],
    });
  }
  const mod = await loader();
  return mod.default(req, res);
}
