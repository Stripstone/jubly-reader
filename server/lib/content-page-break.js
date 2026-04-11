import { json, withCors, readJsonBody } from './http.js';
import { getAllowedBrowserOrigins } from './origins.js';
import { buildMarkdownBookFromSections } from './content-page-break-core.js';

export default async function handler(req, res) {
  const allowedOrigins = getAllowedBrowserOrigins();
  if (withCors(req, res, allowedOrigins)) return;
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed. Use POST.' });

  const body = await readJsonBody(req);
  const kind = String(body?.kind || '').trim().toLowerCase();

  if (kind === 'text') {
    const raw = String(body?.text || '').replace(/\r\n?/g, '\n').trim();
    if (!raw) return json(res, 400, { error: 'No text provided.' });
    const sections = [{
      title: String(body?.title || 'Imported Text').trim() || 'Imported Text',
      blocks: raw.split(/\n\s*\n+/g).map((s) => String(s || '').trim()).filter(Boolean),
    }];
    const result = buildMarkdownBookFromSections(sections, { breakByPageNumber: false });
    return json(res, 200, { ok: true, ...result, pageCount: result.pageMeta.length });
  }

  const sections = Array.isArray(body?.sections) ? body.sections : null;
  if (!sections || !sections.length) return json(res, 400, { error: 'No sections provided.' });

  const breakByPageNumber = !!body?.breakByPageNumber;
  const result = buildMarkdownBookFromSections(sections, { breakByPageNumber });
  return json(res, 200, { ok: true, ...result, pageCount: result.pageMeta.length });
}
