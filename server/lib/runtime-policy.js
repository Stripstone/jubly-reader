import { getActiveEntitlement, getUserFromAccessToken } from './supabase.js';

const VALID_TIERS = new Set(['basic', 'pro', 'premium']);
const LEGACY_TIER_ALIASES = new Map([['free', 'basic'], ['paid', 'pro']]);
const CANONICAL_PRODUCTION_HOSTS = new Set(['jubly-reader.vercel.app']);

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/:\d+$/, '');
}

function getRequestHost(req) {
  return normalizeHost(
    req?.headers?.['x-forwarded-host']
    || req?.headers?.host
    || ''
  );
}

function isLocalHost(host) {
  return host === 'localhost' || host === '127.0.0.1';
}

function isCanonicalProductionHost(host) {
  return CANONICAL_PRODUCTION_HOSTS.has(host);
}

function isPreviewHost(host) {
  return !!host && host.endsWith('.vercel.app') && !isCanonicalProductionHost(host);
}

function getAuthorizationBearer(req) {
  const header = String(req?.headers?.authorization || req?.headers?.Authorization || '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

function normalizeTierAlias(value) {
  const tier = String(value || '').trim().toLowerCase();
  return LEGACY_TIER_ALIASES.get(tier) || tier;
}

function normalizeEntitlementTier(row) {
  if (!row || typeof row !== 'object') return 'basic';
  const directTier = resolveRuntimeTier(row.tier, '');
  if (directTier) return directTier;
  const mappedPlanTier = resolveRuntimeTier(row.plan_id, '');
  if (mappedPlanTier) return mappedPlanTier;
  return 'basic';
}

function normalizeEntitlementSnapshot(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    userId: row.user_id || null,
    provider: row.provider || null,
    planId: row.plan_id || null,
    tier: normalizeEntitlementTier(row),
    status: row.status || null,
    stripeCustomerId: row.stripe_customer_id || null,
    stripeSubscriptionId: row.stripe_subscription_id || null,
    periodStart: row.period_start || null,
    periodEnd: row.period_end || null,
    updatedAt: row.updated_at || null,
  };
}

export function resolveRuntimeTier(value, fallback = 'basic') {
  const tier = normalizeTierAlias(value);
  return VALID_TIERS.has(tier) ? tier : fallback;
}

export function isRuntimeTierSimulationAllowed(req) {
  const envValue = String(process.env.ALLOW_TIER_SIMULATION || '').trim().toLowerCase();
  if (envValue === '1' || envValue === 'true' || envValue === 'yes') return true;
  const host = getRequestHost(req);
  return isLocalHost(host) || isPreviewHost(host);
}

export function getDefaultRuntimeTier() {
  return resolveRuntimeTier(process.env.RUNTIME_DEFAULT_TIER || 'basic');
}

function getDeveloperOverrideTier(req) {
  if (!isRuntimeTierSimulationAllowed(req)) return '';
  const value = String(process.env.DEVELOPER_TIER_OVERRIDE || '').trim().toLowerCase();
  return resolveRuntimeTier(value, '');
}


function hasRequestedRuntimeTier(req) {
  try {
    const q = req?.query?.tier;
    if (typeof q === 'string') return !!q.trim();
  } catch (_) {}
  try {
    const url = new URL(req.url, 'http://localhost');
    return url.searchParams.has('tier');
  } catch (_) {
    return false;
  }
}

export function getRequestedRuntimeTier(req) {
  try {
    const q = req?.query?.tier;
    if (typeof q === 'string' && q.trim()) return resolveRuntimeTier(q);
  } catch (_) {}
  try {
    const url = new URL(req.url, 'http://localhost');
    return resolveRuntimeTier(url.searchParams.get('tier'));
  } catch (_) {
    return 'basic';
  }
}

export function buildRuntimePolicy(inputTier = 'basic') {
  const tier = resolveRuntimeTier(inputTier);
  const elevated = tier !== 'basic';

  const usageDailyLimit = tier === 'premium'
    ? 10000
    : tier === 'pro'
      ? 1000
      : 100;

  const importSlotLimit = tier === 'premium'
    ? null
    : tier === 'pro'
      ? 5
      : 2;

  return {
    version: 1,
    tier,
    simulationAllowed: false,
    usageDailyLimit,
    importSlotLimit,
    features: {
      modes: {
        reading: true,
        comprehension: elevated,
        research: elevated,
      },
      aiEvaluate: elevated,
      anchors: elevated,
      cloudVoices: elevated,
      themes: {
        explorer: elevated,
        customMusic: elevated,
      },
    },
  };
}

export async function getResolvedRuntimePolicyForRequest(req) {
  const simulationAllowed = isRuntimeTierSimulationAllowed(req);
  const requestedTier = getRequestedRuntimeTier(req);
  const requestedTierPresent = hasRequestedRuntimeTier(req);
  const developerOverrideTier = getDeveloperOverrideTier(req);
  const bearer = getAuthorizationBearer(req);

  let entitlementSnapshot = null;
  if (bearer) {
    try {
      const user = await getUserFromAccessToken(bearer);
      if (user?.id) {
        const entitlement = await getActiveEntitlement(user.id);
        entitlementSnapshot = normalizeEntitlementSnapshot(entitlement);
      }
    } catch (_) {
      entitlementSnapshot = null;
    }
  }

  let effectiveTier = getDefaultRuntimeTier();
  let resolutionMode = 'production';
  let tierSource = 'server-default';

  if (developerOverrideTier) {
    effectiveTier = developerOverrideTier;
    resolutionMode = 'developer-override';
    tierSource = 'developer-override';
  } else if (entitlementSnapshot && entitlementSnapshot.status === 'active') {
    effectiveTier = resolveRuntimeTier(entitlementSnapshot.tier);
    resolutionMode = 'entitlement';
    tierSource = 'entitlement';
  } else if (simulationAllowed && requestedTierPresent) {
    effectiveTier = requestedTier;
    resolutionMode = 'simulation';
    tierSource = 'requested';
  }

  const policy = {
    ...buildRuntimePolicy(effectiveTier),
    simulationAllowed,
  };

  return {
    requestedTier,
    effectiveTier,
    simulationAllowed,
    resolutionMode,
    tierSource,
    entitlementSnapshot,
    policy,
  };
}
