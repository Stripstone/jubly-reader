import { json, withCors } from '../../_lib/http.js';
import { requestOrigin } from '../../_lib/env.js';
import { getAllowedBrowserOrigins } from '../../_lib/origins.js';
import { getActiveEntitlement, getUserFromAccessToken } from '../../_lib/supabase.js';
import { stripeRequest } from '../../_lib/stripe.js';

function getBearer(req) {
  const header = String(req?.headers?.authorization || req?.headers?.Authorization || '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

export default async function handler(req, res) {
  const allowed = getAllowedBrowserOrigins();
  if (withCors(req, res, allowed)) return;

  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed. Use POST.' });

  const token = getBearer(req);
  if (!token) return json(res, 401, { error: 'Sign in required.' });

  const user = await getUserFromAccessToken(token).catch(() => null);
  if (!user?.id) return json(res, 401, { error: 'Invalid session.' });

  const entitlement = await getActiveEntitlement(user.id).catch(() => null);
  if (!entitlement?.stripe_customer_id) {
    return json(res, 409, { error: 'No billing customer record exists for this account yet.' });
  }

  const form = new URLSearchParams();
  form.set('customer', entitlement.stripe_customer_id);
  form.set('return_url', `${requestOrigin(req)}/?portal=return`);

  try {
    const session = await stripeRequest('/billing_portal/sessions', { method: 'POST', body: form });
    return json(res, 200, { ok: true, url: session?.url || '' });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'Unable to open billing portal.' });
  }
}
