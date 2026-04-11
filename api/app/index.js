import { json } from '../../server/lib/http.js';

function getKind(req) {
  try {
    if (typeof req?.query?.kind === 'string' && req.query.kind.trim()) return req.query.kind.trim().toLowerCase();
  } catch (_) {}
  try {
    const url = new URL(req.url, 'http://localhost');
    return String(url.searchParams.get('kind') || '').trim().toLowerCase();
  } catch (_) { return ''; }
}

const HANDLERS = {
  'public-config': () => import('../../server/lib/app-public-config.js'),
  'runtime-config': () => import('../../server/lib/app-runtime-config.js'),
  'health': () => import('../../server/lib/app-health.js'),
  'usage-check': () => import('../../server/lib/app-usage-check.js'),
  'usage-consume': () => import('../../server/lib/app-usage-consume.js'),
  'import-capacity': () => import('../../server/lib/app-import-capacity.js'),
  'dev-tools': () => import('../../server/lib/app-dev-tools.js'),
  'durable-sync': () => import('../../server/lib/app-durable-sync.js'),
};

export default async function handler(req, res) {
  const kind = getKind(req) || 'health';
  const loader = HANDLERS[kind];
  if (!loader) {
    return json(res, 400, { error: 'Unknown app endpoint kind.', expected: ['public-config','runtime-config','health','usage-check','usage-consume','import-capacity','dev-tools','durable-sync'] });
  }
  const mod = await loader();
  return mod.default(req, res);
}
