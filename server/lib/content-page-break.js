import { json, withCors, readJsonBody } from './http.js';
import { getAllowedBrowserOrigins } from './origins.js';
import { buildMarkdownBookFromSections } from './content-page-break-core.js';

export default async function handler(req, res) {
  const allowedOrigins = getAllowedBrowserOrigins();
  if (withCors(req, res, allowedOrigins)) return;

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed. Use POST.' });
  }

  const body = await readJsonBody(req);
  const kind = String(body?.kind || '').trim().toLowerCase();

  try {
    if (kind === 'sections') {
      const sections = Array.isArray(body?.sections) ? body.sections : [];
      const options = body?.options && typeof body.options === 'object' ? body.options : {};
      return json(res, 200, buildMarkdownBookFromSections(sections, options));
    }
    return json(res, 400, { error: 'Unknown page-break kind.', expected: ['sections'] });
  } catch (error) {
    return json(res, 500, { error: 'Page breaking failed.', detail: String(error?.message || error) });
  }
}
