
import { json, withCors, readJsonBody } from './http.js';
import { getAllowedBrowserOrigins } from './origins.js';
import { buildMarkdownBookFromSections, splitRawTextToPages } from './content-page-break-core.js';

function toInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : fallback;
}

export default async function handler(req, res) {
  const allowed = getAllowedBrowserOrigins();
  if (withCors(req, res, allowed)) return;

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed. Use POST.' });
  }

  const body = await readJsonBody(req);
  const kind = String(body?.kind || '').trim().toLowerCase();
  const pageSize = toInt(body?.options?.pageSize, 1600);
  const breakByPageNumber = body?.options?.breakByPageNumber !== false;

  try {
    if (kind === 'sections') {
      const sections = Array.isArray(body?.sections) ? body.sections : [];
      return json(res, 200, buildMarkdownBookFromSections(sections, { pageSize, breakByPageNumber }));
    }

    if (kind === 'text') {
      const raw = String(body?.raw || '');
      return json(res, 200, splitRawTextToPages(raw, { pageSize, breakByPageNumber }));
    }

    return json(res, 400, { error: 'Unknown page-break kind.', expected: ['sections', 'text'] });
  } catch (error) {
    return json(res, 500, { error: 'Page breaking failed.', detail: String(error?.message || error) });
  }
}
