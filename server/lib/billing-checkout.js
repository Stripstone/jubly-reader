import { json, readJsonBody, withCors } from './http.js';
import { optionalEnv, requestOrigin } from './env.js';
import { getAllowedBrowserOrigins } from './origins.js';
import { deleteTrialClaimById, createTrialClaim, getTrialClaimForIpTier, getTrialClaimForUserTier, getActiveEntitlement, getUserFromAccessToken } from './supabase.js';
import { getPlanConfig, stripeRequest } from './stripe.js';

function envBool(name, fallback = false) {
  const raw = String(optionalEnv(name, '')).trim().toLowerCase();
  if (!raw) return !!fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return !!fallback;
}

function envInt(name, fallback = 0) {
  const raw = String(optionalEnv(name, '')).trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
}

function normalizeMissingPaymentMethodBehavior() {
  const raw = String(optionalEnv('PLAN_TRIAL_MISSING_PAYMENT_METHOD_BEHAVIOR', 'cancel')).trim().toLowerCase();
  if (raw === 'pause' || raw === 'create_invoice') return raw;
  return 'cancel';
}

function blockingSubscriptionExists(entitlement) {
  if (!entitlement || typeof entitlement !== 'object') return false;
  const provider = String(entitlement.provider || '').trim().toLowerCase();
  const status = String(entitlement.status || '').trim().toLowerCase();
  if (provider !== 'stripe') return false;
  return status === 'active' || status === 'trialing';
}

function trialDaysForTier(tier) {
  const normalized = String(tier || '').trim().toLowerCase();
  if (normalized === 'premium') return envInt('PLAN_PREMIUM_TRIAL_DAYS', 0);
  if (normalized === 'pro') return envInt('PLAN_PRO_TRIAL_DAYS', 0);
  return 0;
}

function getClientIp(req) {
  const headers = req?.headers || {};
  const candidates = [
    headers['x-vercel-forwarded-for'],
    headers['x-forwarded-for'],
    headers['cf-connecting-ip'],
    headers['x-real-ip'],
    req?.socket?.remoteAddress,
  ];
  for (const candidate of candidates) {
    const first = String(candidate || '').split(',')[0].trim();
    if (first) return first;
  }
  return '';
}

async function resolveTrialGrant(req, user, plan, requestedTrialDays) {
  if (!requestedTrialDays || requestedTrialDays < 1) {
    return { granted: false, days: 0, reason: 'no-trial-configured', claim: null };
  }

  const priorUserClaim = await getTrialClaimForUserTier(user.id, plan.tier);
  if (priorUserClaim) {
    return { granted: false, days: 0, reason: 'prior-account-claim', claim: priorUserClaim };
  }

  let ipFingerprintHash = '';
  if (envBool('PLAN_TRIAL_REQUIRE_UNIQUE_IP', false)) {
    const clientIp = getClientIp(req);
    if (!clientIp) {
      return { granted: false, days: 0, reason: 'missing-ip-footprint', claim: null };
    }
    ipFingerprintHash = createTrialClaim.ipFingerprintHash(clientIp);
    const priorIpClaim = await getTrialClaimForIpTier(plan.tier, ipFingerprintHash);
    if (priorIpClaim) {
      return { granted: false, days: 0, reason: 'prior-ip-claim', claim: priorIpClaim };
    }
  } else {
    ipFingerprintHash = createTrialClaim.ipFingerprintHash(`user:${user.id}:${plan.tier}`);
  }

  const now = Date.now();
  const claim = await createTrialClaim({
    userId: user.id,
    tier: plan.tier,
    ipFingerprintHash,
    expiresAt: new Date(now + requestedTrialDays * 24 * 60 * 60 * 1000).toISOString(),
    notes: 'checkout-session-created',
  });
  return { granted: true, days: requestedTrialDays, reason: 'granted', claim };
}

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
    if (trialGrant?.granted && trialGrant?.claim?.id) {
      await deleteTrialClaimById(trialGrant.claim.id).catch(() => null);
    }
    return json(res, error.status || 500, { error: error.message || 'Unable to create checkout session.' });
  }
}
