import { json, withCors } from './http.js';
import { getAllowedBrowserOrigins } from './origins.js';
import { findAuthUserByEmail } from './supabase.js';

function readEmail(req) {
  try {
    if (typeof req?.query?.email === 'string' && req.query.email.trim()) return req.query.email.trim();
  } catch (_) {}
  try {
    const url = new URL(req.url, 'http://localhost');
    return String(url.searchParams.get('email') || '').trim();
  } catch (_) {
    return '';
  }
}

export default async function handler(req, res) {
  const allowed = getAllowedBrowserOrigins();
  if (withCors(req, res, allowed)) return;

  if (req.method !== 'GET') {
    return json(res, 405, { error: 'Method not allowed. Use GET.' });
  }

  const email = readEmail(req).toLowerCase();
  if (!email) return json(res, 400, { error: 'Email is required.' });

  try {
    const user = await findAuthUserByEmail(email);
    return json(res, 200, { ok: true, email, exists: !!user });
  } catch (error) {
    return json(res, 200, { ok: false, email, exists: false, error: String(error?.message || 'Unable to verify email yet.') });
  }
}
