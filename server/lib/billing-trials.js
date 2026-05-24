import { optionalEnv } from './env.js';
import { createTrialClaim, deleteTrialClaimById, getTrialClaimForIpTier, getTrialClaimForUserTier } from './supabase.js';

export function envBool(name, fallback = false) {
  const raw = String(optionalEnv(name, '')).trim().toLowerCase();
  if (!raw) return !!fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return !!fallback;
}

export function envInt(name, fallback = 0) {
  const raw = String(optionalEnv(name, '')).trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
}

export function normalizeMissingPaymentMethodBehavior() {
  const raw = String(optionalEnv('PLAN_TRIAL_MISSING_PAYMENT_METHOD_BEHAVIOR', 'cancel')).trim().toLowerCase();
  if (raw === 'pause' || raw === 'create_invoice') return raw;
  return 'cancel';
}

export function blockingSubscriptionExists(entitlement) {
  if (!entitlement || typeof entitlement !== 'object') return false;
  const provider = String(entitlement.provider || '').trim().toLowerCase();
  const status = String(entitlement.status || '').trim().toLowerCase();
  if (provider !== 'stripe') return false;
  return status === 'active' || status === 'trialing';
}

export function trialDaysForTier(tier) {
  const normalized = String(tier || '').trim().toLowerCase();
  if (normalized === 'premium') return envInt('PLAN_PREMIUM_TRIAL_DAYS', 0);
  if (normalized === 'pro') return envInt('PLAN_PRO_TRIAL_DAYS', 0);
  return 0;
}

export function getClientIp(req) {
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

function normalizePlanTier(tier) {
  const normalized = String(tier || '').trim().toLowerCase();
  return normalized === 'premium' ? 'premium' : normalized === 'pro' ? 'pro' : '';
}

function publicEligibilityResult({ tier, eligible, resolved, days = 0, reason = '', ipFingerprintHash = '' }) {
  return {
    tier: normalizePlanTier(tier),
    eligible: !!eligible,
    resolved: !!resolved,
    days: eligible ? Math.max(0, Math.trunc(Number(days) || 0)) : 0,
    reason: reason || (eligible ? 'eligible' : 'not-eligible'),
    ipFingerprintHash,
  };
}

export async function resolveTrialEligibility(req, user, plan, requestedTrialDays = trialDaysForTier(plan?.tier)) {
  const tier = normalizePlanTier(plan?.tier);
  const days = Math.max(0, Math.trunc(Number(requestedTrialDays) || 0));
  if (!tier || days < 1) {
    return publicEligibilityResult({ tier, eligible: false, resolved: true, reason: 'no-trial-configured' });
  }

  const userId = String(user?.id || '').trim();
  if (userId) {
    const priorUserClaim = await getTrialClaimForUserTier(userId, tier);
    if (priorUserClaim) {
      return publicEligibilityResult({ tier, eligible: false, resolved: true, reason: 'prior-account-claim' });
    }
  }

  let ipFingerprintHash = '';
  if (envBool('PLAN_TRIAL_REQUIRE_UNIQUE_IP', false)) {
    const clientIp = getClientIp(req);
    if (!clientIp) {
      return publicEligibilityResult({ tier, eligible: false, resolved: true, reason: 'missing-ip-footprint' });
    }
    ipFingerprintHash = createTrialClaim.ipFingerprintHash(clientIp);
    const priorIpClaim = await getTrialClaimForIpTier(tier, ipFingerprintHash);
    if (priorIpClaim) {
      return publicEligibilityResult({ tier, eligible: false, resolved: true, reason: 'prior-ip-claim' });
    }
  } else if (userId) {
    ipFingerprintHash = createTrialClaim.ipFingerprintHash(`user:${userId}:${tier}`);
  }

  return publicEligibilityResult({
    tier,
    eligible: true,
    resolved: !!userId || envBool('PLAN_TRIAL_REQUIRE_UNIQUE_IP', false),
    days,
    reason: userId ? 'eligible' : 'eligibility-unresolved',
    ipFingerprintHash,
  });
}

export async function resolveTrialGrant(req, user, plan, requestedTrialDays = trialDaysForTier(plan?.tier)) {
  const eligibility = await resolveTrialEligibility(req, user, plan, requestedTrialDays);
  if (!eligibility.eligible || eligibility.days < 1) {
    return { granted: false, days: 0, reason: eligibility.reason, claim: null };
  }

  const userId = String(user?.id || '').trim();
  if (!userId) {
    return { granted: false, days: 0, reason: 'auth-required', claim: null };
  }

  const ipFingerprintHash = eligibility.ipFingerprintHash || createTrialClaim.ipFingerprintHash(`user:${userId}:${eligibility.tier}`);
  const now = Date.now();
  const claim = await createTrialClaim({
    userId,
    tier: eligibility.tier,
    ipFingerprintHash,
    expiresAt: new Date(now + eligibility.days * 24 * 60 * 60 * 1000).toISOString(),
    notes: 'checkout-session-created',
  });
  return { granted: true, days: eligibility.days, reason: 'granted', claim };
}

export async function rollbackTrialGrant(claimId) {
  const id = String(claimId || '').trim();
  if (!id) return null;
  return deleteTrialClaimById(id).catch(() => null);
}
