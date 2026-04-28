import { json, readJsonBody, withCors } from './http.js';
import { requestOrigin } from './env.js';
import { getAllowedBrowserOrigins } from './origins.js';
import { getActiveEntitlement, getUserFromAccessToken } from './supabase.js';
import { getPlanConfig, stripeRequest } from './stripe.js';
import { blockingSubscriptionExists, envBool, normalizeMissingPaymentMethodBehavior, resolveTrialGrant, rollbackTrialGrant, trialDaysForTier } from './billing-trials.js';

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
  if (envBool('PLAN_LIMIT_ONE_SUBSCRIPTION', true) && blockingSubscriptionExists(existing)) {
    return json(res, 409, { error: 'An active paid subscription already exists for this account. Use Manage Billing to change it.' });
  }

  const origin = requestOrigin(req);
  const allowPromotionCodes = envBool('PLAN_ALLOW_PROMOTION_CODES', true);
  const requireCard = envBool('PLAN_REQUIRE_CARD', false);
  const configuredTrialDays = trialDaysForTier(plan.tier);
  let trialGrant;
  try {
    trialGrant = await resolveTrialGrant(req, user, plan, configuredTrialDays);
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'Unable to verify trial eligibility.' });
  }

  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('success_url', `${origin}/?checkout=success&checkout_plan=${encodeURIComponent(plan.tier)}`);
  form.set('cancel_url', `${origin}/?checkout=cancel`);
  form.set('client_reference_id', user.id);
  form.set('line_items[0][price]', plan.priceId);
  form.set('line_items[0][quantity]', '1');
  form.set('allow_promotion_codes', allowPromotionCodes ? 'true' : 'false');
  form.set('payment_method_collection', requireCard ? 'always' : 'if_required');
  form.set('metadata[user_id]', user.id);
  form.set('metadata[tier]', plan.tier);
  form.set('metadata[trial_granted]', trialGrant.granted ? 'true' : 'false');
  form.set('metadata[trial_reason]', trialGrant.reason);
  form.set('subscription_data[metadata][user_id]', user.id);
  form.set('subscription_data[metadata][tier]', plan.tier);
  form.set('subscription_data[metadata][trial_granted]', trialGrant.granted ? 'true' : 'false');
  form.set('subscription_data[metadata][trial_reason]', trialGrant.reason);
  if (trialGrant.granted && trialGrant.claim?.id) {
    form.set('metadata[trial_claim_id]', trialGrant.claim.id);
    form.set('subscription_data[metadata][trial_claim_id]', trialGrant.claim.id);
  }
  if (trialGrant.granted && trialGrant.days > 0) {
    form.set('subscription_data[trial_period_days]', String(trialGrant.days));
    form.set('subscription_data[trial_settings][end_behavior][missing_payment_method]', normalizeMissingPaymentMethodBehavior());
  }
  if (existing?.stripe_customer_id) form.set('customer', existing.stripe_customer_id);
  else if (user.email) form.set('customer_email', user.email);

  try {
    const session = await stripeRequest('/checkout/sessions', { method: 'POST', body: form });
    return json(res, 200, { ok: true, url: session?.url || '', id: session?.id || '' });
  } catch (error) {
    console.error("[billing-checkout]", error);
    if (trialGrant?.granted && trialGrant?.claim?.id) {
      await rollbackTrialGrant(trialGrant.claim.id);
    }
    return json(res, error.status || 500, { error: error.message || 'Unable to create checkout session.' });
  }
}
