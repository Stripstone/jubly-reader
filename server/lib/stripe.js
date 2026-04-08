import crypto from 'crypto';
import { requiredEnv } from './env.js';

export function getPlanConfig(planRaw) {
  const plan = String(planRaw || '').trim().toLowerCase();
  if (plan === 'pro' || plan === 'paid') {
    const priceId = process.env.STRIPE_PRICE_PRO_MONTHLY || process.env.STRIPE_PRICE_PAID || process.env.STRIPE_PRICE_PRO;
    if (!priceId) throw new Error('Missing Stripe price configuration for Pro plan');
    return { planId: 'pro', tier: 'paid', priceId };
  }
  if (plan === 'premium') {
    const priceId = process.env.STRIPE_PRICE_PREMIUM_MONTHLY || process.env.STRIPE_PRICE_PREMIUM;
    if (!priceId) throw new Error('Missing Stripe price configuration for Premium plan');
    return { planId: 'premium', tier: 'premium', priceId };
  }
  throw new Error(`Unsupported plan: ${planRaw}`);
}

export function derivePlanFromPriceId(priceIdRaw) {
  const priceId = String(priceIdRaw || '').trim();
  if (!priceId) return null;
  const pro = process.env.STRIPE_PRICE_PRO_MONTHLY || process.env.STRIPE_PRICE_PAID || process.env.STRIPE_PRICE_PRO;
  const premium = process.env.STRIPE_PRICE_PREMIUM_MONTHLY || process.env.STRIPE_PRICE_PREMIUM;
  if (priceId === pro) return { planId: 'pro', tier: 'paid', priceId };
  if (priceId === premium) return { planId: 'premium', tier: 'premium', priceId };
  return null;
}


let _publicPlanCatalogCache = null;
let _publicPlanCatalogAt = 0;
const PUBLIC_PLAN_CATALOG_TTL_MS = 5 * 60 * 1000;

function normalizePublicPrice(priceId, data, fallbackLabel) {
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
    available: !!priceId,
    id: priceId,
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

  const proPriceId = process.env.STRIPE_PRICE_PRO_MONTHLY || process.env.STRIPE_PRICE_PAID || process.env.STRIPE_PRICE_PRO || '';
  const premiumPriceId = process.env.STRIPE_PRICE_PREMIUM_MONTHLY || process.env.STRIPE_PRICE_PREMIUM || '';

  const fetchPrice = async (priceId, fallbackLabel) => {
    if (!priceId) return normalizePublicPrice('', null, fallbackLabel);
    try {
      const data = await stripeRequest(`/prices/${encodeURIComponent(priceId)}`, { method: 'GET' });
      return normalizePublicPrice(priceId, data, fallbackLabel);
    } catch (_) {
      return normalizePublicPrice(priceId, null, fallbackLabel);
    }
  };

  const [pro, premium] = await Promise.all([
    fetchPrice(proPriceId, '$9'),
    fetchPrice(premiumPriceId, '$19'),
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

export function entitlementFromStripeStatus(statusRaw) {
  const status = String(statusRaw || '').trim().toLowerCase();
  if (status === 'active' || status === 'trialing') return 'active';
  if (status === 'canceled') return 'canceled';
  return 'inactive';
}
