import { json } from '../_lib/http.js';

function getAction(req) {
  try {
    if (typeof req?.query?.action === 'string' && req.query.action.trim()) return req.query.action.trim().toLowerCase();
  } catch (_) {}
  try {
    const url = new URL(req.url, 'http://localhost');
    return String(url.searchParams.get('action') || '').trim().toLowerCase();
  } catch (_) {
    return '';
  }
}

const HANDLERS = {
  anchors: () => import('../_lib/ai-anchors.js'),
  evaluate: () => import('../_lib/ai-evaluate.js'),
  summary: () => import('../_lib/ai-summary.js'),
};

export default async function handler(req, res) {
  const action = getAction(req);
  const loader = HANDLERS[action];
  if (!loader) {
    return json(res, 400, {
      error: 'Unknown AI action.',
      expected: ['anchors', 'evaluate', 'summary'],
    });
  }
  const mod = await loader();
  return mod.default(req, res);
}
