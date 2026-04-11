import { json } from '../../server/lib/http.js';

function getAction(req) {
  try {
    if (typeof req?.query?.action === 'string' && req.query.action.trim()) return req.query.action.trim().toLowerCase();
  } catch (_) {}
  try {
    const url = new URL(req.url, 'http://localhost');
    return String(url.searchParams.get('action') || '').trim().toLowerCase();
  } catch (_) { return ''; }
}

const HANDLERS = {
  'book-import': () => import('../../server/lib/content-book-import.js'),
};

export default async function handler(req, res) {
  const action = getAction(req) || 'book-import';
  const loader = HANDLERS[action];
  if (!loader) {
    return json(res, 400, { error: 'Unknown content action.', expected: ['book-import'] });
  }
  const mod = await loader();
  return mod.default(req, res);
}
