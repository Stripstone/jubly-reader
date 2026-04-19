import { json } from '../../../server/lib/http.js';
import { requiredEnv } from '../../../server/lib/env.js';
import { getEntitlementByStripeRefs, upsertEntitlement } from '../../../server/lib/supabase.js';
import { derivePlanFromPriceId, entitlementFromStripeStatus, stripeRequest, verifyStripeSignature } from '../../../server/lib/stripe.js';

export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function normalizePeriod(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

async function applyEntitlementFromSubscription(subscription, fallback = {}) {
  if (!subscription) return null;
  const metadata = subscription.metadata || {};
  const firstItem = subscription.items?.data?.[0];
  const priceId = firstItem?.price?.id || fallback.priceId || '';
  const pricePlan = await derivePlanFromPriceId(priceId).catch(() => null) || null;
  const customerId = subscription.customer || fallback.customerId || null;
  const subscriptionId = subscription.id || fallback.subscriptionId || null;
  const existing = await getEntitlementByStripeRefs({ customerId, subscriptionId }).catch(() => null);
  const tier = metadata.tier || fallback.tier || pricePlan?.tier || existing?.tier || 'basic';
  const userId = metadata.user_id || fallback.userId || fallback.clientReferenceId || existing?.user_id || null;
  if (!userId) return null;

  return upsertEntitlement({
    user_id: userId,
    provider: 'stripe',
    tier,
    status: entitlementFromStripeStatus(subscription.status),
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    period_start: normalizePeriod(subscription.current_period_start),
    period_end: normalizePeriod(subscription.current_period_end),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed. Use POST.' });

  const rawBody = await readRawBody(req);
  const signature = req.headers['stripe-signature'];
  const secret = requiredEnv('STRIPE_WEBHOOK_SECRET');
  if (!verifyStripeSignature(rawBody, signature, secret)) {
    return json(res, 400, { error: 'Invalid Stripe signature.' });
  }

  let event = null;
  try {
    event = JSON.parse(rawBody);
  } catch (_) {
    return json(res, 400, { error: 'Invalid JSON body.' });
  }

  try {
    switch (event?.type) {
      case 'checkout.session.completed': {
        const session = event?.data?.object;
        if (session?.mode === 'subscription' && session?.subscription) {
          const subscription = await stripeRequest(`/subscriptions/${session.subscription}`, { method: 'GET' });
          await applyEntitlementFromSubscription(subscription, {
            userId: session.client_reference_id || session.metadata?.user_id || null,
            customerId: session.customer || null,
            tier: session.metadata?.tier || null,
            subscriptionId: session.subscription,
          });
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event?.data?.object;
        await applyEntitlementFromSubscription(subscription);
        break;
      }
      default:
        break;
    }
    return json(res, 200, { received: true });
  } catch (error) {
    console.error("[stripe-webhook]", error);
    return json(res, 500, { error: error.message || 'Webhook processing failed.' });
  }
}
