import crypto from 'crypto';
import { optionalEnv, requiredEnv } from './env.js';

function getConfiguredPlanRef(plan) {
  if (plan === 'pro' || plan === 'paid') return String(process.env.STRIPE_PRICE_PRO_MONTHLY || process.env.STRIPE_PRICE_PAID || process.env.STRIPE_PRICE_PRO || '').trim();
  if (plan === 'premium') return String(process.env.STRIPE_PRICE_PREMIUM_MONTHLY || process.env.STRIPE_PRICE_PREMIUM || '').trim();
  return '';
}

function isPriceId(ref) { return String(ref || '').trim().startsWith('price_'); }
function isProductId(ref) { return String(ref || '').trim().startsWith('prod_'); }

const _resolvedPlanRefCache = new Map();
const RESOLVED_PLAN_REF_TTL_MS = 5 * 60 * 1000;

async function fetchStripePrice(priceId) {
  return stripeRequest(`/prices/${encodeURIComponent(priceId)}`, { method: 'GET' });
}

async function resolvePriceFromProduct(productId) {
  try {
    const product = await stripeRequest(`/products/${encodeURIComponent(productId)}?expand[]=default_price`, { method: 'GET' });
    const defaultPrice = product?.default_price || null;
    if (defaultPrice && typeof defaultPrice === 'object' && defaultPrice.id && defaultPrice.recurring?.interval === 'month' && defaultPrice.active !== false) {
      return { priceId: defaultPrice.id, price: defaultPrice, productId };
    }
    if (typeof defaultPrice === 'string' && defaultPrice) {
      const price = await fetchStripePrice(defaultPrice);
      if (price?.id) return { priceId: price.id, price, productId };
    }
  } catch (_) {}

  const listing = await stripeRequest(`/prices?product=${encodeURIComponent(productId)}&active=true&type=recurring&limit=100`, { method: 'GET' });
  const prices = Array.isArray(listing?.data) ? listing.data : [];
  const monthly = prices.find((item) => item?.recurring?.interval === 'month' && item?.active !== false);
  const anyRecurring = prices.find((item) => item?.recurring && item?.active !== false);
  const chosen = monthly || anyRecurring || null;
  return chosen?.id ? { priceId: chosen.id, price: chosen, productId } : { priceId: '', price: null, productId };
}

async function resolveConfiguredPlan(plan) {
  const normalized = String(plan || '').trim().toLowerCase();
  const configuredRef = getConfiguredPlanRef(normalized);
  if (!configuredRef) throw new Error(`Missing Stripe price configuration for ${normalized === 'premium' ? 'Premium' : 'Pro'} plan`);

  const cached = _resolvedPlanRefCache.get(`${normalized}:${configuredRef}`);
  const now = Date.now();
  if (cached && (now - cached.at) < RESOLVED_PLAN_REF_TTL_MS) return cached.value;

  let value = null;
  if (isPriceId(configuredRef)) {
    const price = await fetchStripePrice(configuredRef);
    value = {
      planId: normalized === 'paid' ? 'pro' : normalized,
      tier: normalized === 'premium' ? 'premium' : 'pro',
      priceId: price?.id || configuredRef,
      configuredRef,
      price,
    };
  } else if (isProductId(configuredRef)) {
    const resolved = await resolvePriceFromProduct(configuredRef);
    if (!resolved?.priceId) throw new Error(`No active recurring price found for product ${configuredRef}`);
    value = {
      planId: normalized === 'paid' ? 'pro' : normalized,
      tier: normalized === 'premium' ? 'premium' : 'pro',
      priceId: resolved.priceId,
      configuredRef,
      price: resolved.price,
      productId: configuredRef,
    };
  } else {
    throw new Error(`Stripe plan configuration must be a price_ or prod_ id for ${normalized}`);
  }

  _resolvedPlanRefCache.set(`${normalized}:${configuredRef}`, { at: now, value });
  return value;
}

export async function getPlanConfig(planRaw) {
  const plan = String(planRaw || '').trim().toLowerCase();
  if (plan === 'pro' || plan === 'paid') return resolveConfiguredPlan('pro');
  if (plan === 'premium') return resolveConfiguredPlan('premium');
  throw new Error(`Unsupported plan: ${planRaw}`);
}

export async function derivePlanFromPriceId(priceIdRaw) {
  const priceId = String(priceIdRaw || '').trim();
  if (!priceId) return null;
  const [pro, premium] = await Promise.all([
    resolveConfiguredPlan('pro').catch(() => null),
    resolveConfiguredPlan('premium').catch(() => null),
  ]);
  if (priceId === pro?.priceId) return { planId: 'pro', tier: 'pro', priceId };
  if (priceId === premium?.priceId) return { planId: 'premium', tier: 'premium', priceId };
  return null;
}


let _publicPlanCatalogCache = null;
let _publicPlanCatalogAt = 0;
const PUBLIC_PLAN_CATALOG_TTL_MS = 5 * 60 * 1000;

function normalizePublicPrice(priceId, data, fallbackLabel, configuredRef = '') {
  const amountCents = Number.isFinite(Number(data?.unit_amount)) ? Number(data.unit_amount) : null;
  const currency = String(data?.currency || '').trim().toUpperCase() || 'USD';
  const interval = String(data?.recurring?.interval || '').trim().toLowerCase() || 'month';
  const nickname = String(data?.nickname || '').trim();
  const amount = amountCents == null ? null : amountCents / 100;
  let amountLabel = fallbackLabel || 'Configured in Stripe';
  if (amount != null) {
    try {
      amountLabel = new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
    } catch (_) {
      amountLabel = `${amount.toFixed(2)} ${currency}`;
    }
  }
  return {
    available: !!priceId || !!configuredRef,
    id: priceId,
    configuredRef,
    amountCents,
    amountLabel,
    currency,
    interval,
    intervalLabel: interval === 'month' ? '/mo' : interval ? `/${interval}` : '',
    nickname,
  };
}

export async function getPublicPlanCatalog(force = false) {
  const now = Date.now();
  if (!force && _publicPlanCatalogCache && (now - _publicPlanCatalogAt) < PUBLIC_PLAN_CATALOG_TTL_MS) return _publicPlanCatalogCache;

  const fetchPlan = async (planKey, fallbackLabel) => {
    const configuredRef = getConfiguredPlanRef(planKey);
    if (!configuredRef) return normalizePublicPrice('', null, fallbackLabel, '');
    try {
      const resolved = await resolveConfiguredPlan(planKey);
      return normalizePublicPrice(resolved.priceId, resolved.price, fallbackLabel, configuredRef);
    } catch (_) {
      return normalizePublicPrice('', null, fallbackLabel, configuredRef);
    }
  };

  const [pro, premium] = await Promise.all([
    fetchPlan('pro', 'Configured in Stripe'),
    fetchPlan('premium', 'Configured in Stripe'),
  ]);
  _publicPlanCatalogCache = { pro, premium };
  _publicPlanCatalogAt = now;
  return _publicPlanCatalogCache;
}

export async function stripeRequest(path, { method = 'POST', body, headers = {} } = {}) {
  const secret = requiredEnv('STRIPE_SECRET_KEY');
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...headers,
    },
    body: body ? (body instanceof URLSearchParams ? body.toString() : new URLSearchParams(body).toString()) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Stripe ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export function verifyStripeSignature(rawBody, signatureHeader, secret) {
  const header = String(signatureHeader || '').trim();
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((part) => {
    const idx = part.indexOf('=');
    return idx === -1 ? [part.trim(), ''] : [part.slice(0, idx).trim(), part.slice(idx + 1).trim()];
  }));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch (_) {
    return false;
  }
}

function parseBooleanEnv(name, fallback = false) {
  const value = String(optionalEnv(name, '') || '').trim().toLowerCase();
  if (!value) return !!fallback;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return !!fallback;
}

function parseIntegerEnv(name, fallback = 0) {
  const value = Number(optionalEnv(name, ''));
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : Math.max(0, Math.trunc(fallback || 0));
}

function normalizeMissingPaymentMethodBehavior(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['cancel', 'pause', 'create_invoice'].includes(normalized) ? normalized : 'cancel';
}

export function getCheckoutBillingConfig(planRaw) {
  const plan = String(planRaw || '').trim().toLowerCase() === 'premium' ? 'premium' : 'pro';
  const trialDays = plan === 'premium'
    ? parseIntegerEnv('PLAN_PREMIUM_TRIAL_DAYS', 0)
    : parseIntegerEnv('PLAN_PRO_TRIAL_DAYS', 0);
  const requireCard = parseBooleanEnv('PLAN_REQUIRE_CARD', false);
  return {
    allowPromotionCodes: parseBooleanEnv('PLAN_ALLOW_PROMOTION_CODES', true),
    automaticTax: parseBooleanEnv('STRIPE_AUTOMATIC_TAX', true),
    limitOneSubscription: parseBooleanEnv('PLAN_LIMIT_ONE_SUBSCRIPTION', true),
    requireCard,
    trialDays,
    missingPaymentMethodBehavior: normalizeMissingPaymentMethodBehavior(optionalEnv('PLAN_TRIAL_MISSING_PAYMENT_METHOD_BEHAVIOR', 'cancel')),
    paymentMethodCollection: (!requireCard && trialDays > 0) ? 'if_required' : 'always',
  };
}

export function entitlementFromStripeStatus(statusRaw) {
  const status = String(statusRaw || '').trim().toLowerCase();
  if (status === 'active') return 'active';
  if (status === 'trialing') return 'trialing';
  if (status === 'past_due') return 'past_due';
  if (status === 'canceled' || status === 'unpaid' || status === 'incomplete' || status === 'incomplete_expired' || status === 'paused') return 'inactive';
  return 'inactive';
}
