// server/lib/app-public-config.js
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

import { json, withCors } from './http.js';
import { optionalEnv, requestOrigin } from './env.js';
import { getAllowedBrowserOrigins } from './origins.js';
import { getPublicPlanCatalog } from './stripe.js';


function envInt(name, fallback = 0) {
  const raw = String(optionalEnv(name, '')).trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
}

function attachPublicTrialMetadata(plans) {
  const out = plans && typeof plans === 'object' ? { ...plans } : {};
  out.pro = { ...(out.pro || {}), trialDays: envInt('PLAN_PRO_TRIAL_DAYS', 0) };
  out.premium = { ...(out.premium || {}), trialDays: envInt('PLAN_PREMIUM_TRIAL_DAYS', 0) };
  return out;
}

export default async function handler(req, res) {
  const allowed = getAllowedBrowserOrigins();
  if (withCors(req, res, allowed)) return;

  if (req.method !== 'GET') {
    return json(res, 405, { error: 'Method not allowed. Use GET.' });
  }

  const url = String(process.env.SUPABASE_URL || '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  const appBaseUrl = requestOrigin(req);
  const authRedirectUrl = appBaseUrl ? `${appBaseUrl}/?view=login-page&auth=verified` : '';
  const stripe = {
    plans: attachPublicTrialMetadata(await getPublicPlanCatalog().catch(() => ({
      pro: { available: !!(process.env.STRIPE_PRICE_PRO_MONTHLY || process.env.STRIPE_PRICE_PAID || process.env.STRIPE_PRICE_PRO), amountLabel: 'Configured in Stripe', intervalLabel: '' },
      premium: { available: !!(process.env.STRIPE_PRICE_PREMIUM_MONTHLY || process.env.STRIPE_PRICE_PREMIUM), amountLabel: 'Configured in Stripe', intervalLabel: '' },
    }))),
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
