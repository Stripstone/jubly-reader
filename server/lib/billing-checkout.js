import { json, readJsonBody, withCors } from './http.js';
import { requestOrigin } from './env.js';
import { getAllowedBrowserOrigins } from './origins.js';
import { getActiveEntitlement, getUserFromAccessToken } from './supabase.js';
import { getCheckoutBillingConfig, getPlanConfig, stripeRequest } from './stripe.js';

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

  const body = await readJsonBody(req);
  let plan;
  try {
    plan = await getPlanConfig(body?.plan);
  } catch (error) {
    return json(res, 400, { error: error.message || 'Invalid plan.' });
  }

  const existing = await getActiveEntitlement(user.id).catch(() => null);
  const billing = getCheckoutBillingConfig(plan.tier);
  const existingLifecycle = String(existing?.status || '').trim().toLowerCase();
  const hasCurrentStripeSubscription = existing?.provider === 'stripe'
    && ['active', 'trialing', 'past_due'].includes(existingLifecycle)
    && !!(existing?.stripe_customer_id || existing?.stripe_subscription_id);
  if (billing.limitOneSubscription && hasCurrentStripeSubscription) {
    return json(res, 409, {
      error: 'This account already has a billing profile. Use Manage Billing to update the current subscription.',
      code: 'subscription_exists',
    });
  }

  const origin = requestOrigin(req);
  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('success_url', `${origin}/?checkout=success`);
  form.set('cancel_url', `${origin}/?checkout=cancel`);
  form.set('client_reference_id', user.id);
  form.set('line_items[0][price]', plan.priceId);
  form.set('line_items[0][quantity]', '1');
  form.set('allow_promotion_codes', billing.allowPromotionCodes ? 'true' : 'false');
  form.set('payment_method_collection', billing.paymentMethodCollection);
  if (billing.automaticTax) form.set('automatic_tax[enabled]', 'true');
  form.set('metadata[user_id]', user.id);
  form.set('metadata[tier]', plan.tier);
  form.set('subscription_data[metadata][user_id]', user.id);
  form.set('subscription_data[metadata][tier]', plan.tier);
  if (billing.trialDays > 0) {
    form.set('subscription_data[trial_period_days]', String(billing.trialDays));
    form.set('subscription_data[trial_settings][end_behavior][missing_payment_method]', billing.missingPaymentMethodBehavior);
  }
  if (existing?.stripe_customer_id) form.set('customer', existing.stripe_customer_id);
  else if (user.email) form.set('customer_email', user.email);

  try {
    const session = await stripeRequest('/checkout/sessions', { method: 'POST', body: form });
    return json(res, 200, { ok: true, url: session?.url || '', id: session?.id || '' });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'Unable to create checkout session.' });
  }
}
