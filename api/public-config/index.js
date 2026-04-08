// api/public-config/index.js
// ─────────────────────────────────────────────────────────────────────────────
// Pass 4: Returns public bootstrap config to the browser client.
//
// Currently returns the Supabase public URL and anon key so rcAuth can
// initialize the Supabase client. Both are public by design — Supabase
// restricts data access via Row Level Security, not by keeping the key secret.
//
// SUPABASE_SECRET_KEY is never returned here. It is backend-only.
//
// If env vars are absent (local dev without Supabase configured), returns
// configured: false so rcAuth degrades gracefully — free-path reading
// still works; durable sync simply does not run.
//
// Interim (Pass 4):
//   Entitlement resolution from Supabase (Stripe-backed plan) is Pass 5.
//   This endpoint only gates whether auth is configured at all.
// ─────────────────────────────────────────────────────────────────────────────

import { json, withCors } from '../_lib/http.js';
import { getAllowedBrowserOrigins } from '../_lib/origins.js';

export default async function handler(req, res) {
  const allowed = getAllowedBrowserOrigins();
  if (withCors(req, res, allowed)) return;

  if (req.method !== 'GET') {
    return json(res, 405, { error: 'Method not allowed. Use GET.' });
  }

  const url     = String(process.env.SUPABASE_URL      || '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();

  if (!url || !anonKey) {
    // Not configured — client degrades to signed-out mode gracefully.
    return json(res, 200, { configured: false, url: '', anonKey: '' });
  }

  return json(res, 200, { configured: true, url, anonKey });
}
