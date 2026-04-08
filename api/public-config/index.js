// api/public-config/index.js
// ─────────────────────────────────────────────────────────────────────────────
// Public browser bootstrap config.
//
// Exposes only public values:
//   - Supabase URL + anon key
//   - derived app/auth redirect URLs
//   - Stripe plan availability flags (not secrets, not price IDs)
//
// Secrets never leave the server.
// ─────────────────────────────────────────────────────────────────────────────

import { json, withCors } from '../_lib/http.js';
import { requestOrigin } from '../_lib/env.js';
import { getAllowedBrowserOrigins } from '../_lib/origins.js';

export default async function handler(req, res) {
  const allowed = getAllowedBrowserOrigins();
  if (withCors(req, res, allowed)) return;

  if (req.method !== 'GET') {
    return json(res, 405, { error: 'Method not allowed. Use GET.' });
  }

  const url = String(process.env.SUPABASE_URL || '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  const appBaseUrl = requestOrigin(req);
  const authRedirectUrl = `${appBaseUrl}/`;
  const stripe = {
    plans: {
      pro: !!(process.env.STRIPE_PRICE_PRO_MONTHLY || process.env.STRIPE_PRICE_PAID || process.env.STRIPE_PRICE_PRO),
      premium: !!(process.env.STRIPE_PRICE_PREMIUM_MONTHLY || process.env.STRIPE_PRICE_PREMIUM),
    },
  };

  if (!url || !anonKey) {
    return json(res, 200, {
      configured: false,
      url: '',
      anonKey: '',
      appBaseUrl,
      authRedirectUrl,
      stripe,
    });
  }

  return json(res, 200, {
    configured: true,
    url,
    anonKey,
    appBaseUrl,
    authRedirectUrl,
    stripe,
  });
}
