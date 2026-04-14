import { requiredEnv } from './env.js';

function supabaseBaseUrl() {
  return requiredEnv('SUPABASE_URL').replace(/\/$/, '');
}

function supabaseAnonKey() {
  return requiredEnv('SUPABASE_ANON_KEY');
}

function supabaseServiceKey() {
  return requiredEnv('SUPABASE_SECRET_KEY');
}

export async function getUserFromAccessToken(accessToken) {
  const token = String(accessToken || '').trim();
  if (!token) return null;
  const response = await fetch(`${supabaseBaseUrl()}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: supabaseAnonKey(),
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  return data && data.id ? data : null;
}

export async function supabaseRest(path, opts = {}) {
  const url = `${supabaseBaseUrl()}${path}`;
  const method = opts.method || 'GET';
  const token = String(opts.token || '').trim();
  const asService = !!opts.asService;
  const apiKey = asService ? supabaseServiceKey() : (token ? supabaseAnonKey() : supabaseAnonKey());
  const headers = {
    apikey: apiKey,
    Authorization: token ? `Bearer ${token}` : `Bearer ${apiKey}`,
    ...opts.headers,
  };
  const init = { method, headers };
  if (typeof opts.body !== 'undefined') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }
  const response = await fetch(url, init);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!response.ok) {
    const error = new Error(`Supabase REST ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

const ENTITLEMENT_SELECT = 'user_id,provider,tier,status,stripe_customer_id,stripe_subscription_id,period_start,period_end,created_at,updated_at';
const ENTITLEMENT_FIELDS = [
  'user_id',
  'provider',
  'tier',
  'status',
  'stripe_customer_id',
  'stripe_subscription_id',
  'period_start',
  'period_end',
  'created_at',
  'updated_at',
];

function sanitizeEntitlementRow(row) {
  if (!row || typeof row !== 'object') return null;
  const out = {};
  for (const key of ENTITLEMENT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(row, key) && row[key] !== undefined) out[key] = row[key];
  }
  return out;
}

export async function getActiveEntitlement(userId) {
  const id = String(userId || '').trim();
  if (!id) return null;
  const data = await supabaseRest(
    `/rest/v1/user_entitlements?user_id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(ENTITLEMENT_SELECT)}&order=updated_at.desc&limit=1`,
    {
      method: 'GET',
      asService: true,
      headers: { Prefer: 'count=exact' },
    }
  ).catch(() => null);
  const row = Array.isArray(data) && data[0] ? data[0] : null;
  return sanitizeEntitlementRow(row);
}

export async function getEntitlementByStripeRefs({ customerId = '', subscriptionId = '' } = {}) {
  const customer = String(customerId || '').trim();
  const subscription = String(subscriptionId || '').trim();
  if (!customer && !subscription) return null;

  const filters = [];
  if (subscription) filters.push(`stripe_subscription_id=eq.${encodeURIComponent(subscription)}`);
  if (customer) filters.push(`stripe_customer_id=eq.${encodeURIComponent(customer)}`);
  const query = `/rest/v1/user_entitlements?or=(${filters.join(',')})&select=user_id,provider,plan_id,tier,status,stripe_customer_id,stripe_subscription_id,period_start,period_end,updated_at&order=updated_at.desc&limit=1`;
  const data = await supabaseRest(query, {
    method: 'GET',
    asService: true,
    headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

export async function upsertEntitlement(row) {
  const payload = sanitizeEntitlementRow({ ...row, updated_at: row?.updated_at || new Date().toISOString() }) || {};
  const data = await supabaseRest('/rest/v1/user_entitlements?on_conflict=user_id', {
    method: 'POST',
    asService: true,
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: payload,
  });
  return Array.isArray(data) && data[0] ? sanitizeEntitlementRow(data[0]) : sanitizeEntitlementRow(data);
}


export async function getUsageRow(userId) {
  const id = String(userId || '').trim();
  if (!id) return null;
  const data = await supabaseRest(
    `/rest/v1/user_usage?user_id=eq.${encodeURIComponent(id)}&select=user_id,window_start,window_end,used_units,used_api_calls,last_consumed_at,created_at,updated_at&limit=1`,
    {
      method: 'GET',
      asService: true,
      headers: { Prefer: 'count=exact' },
    }
  ).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

export async function upsertUsageRow(row) {
  const payload = { ...row, updated_at: row?.updated_at || new Date().toISOString() };
  if (!payload.created_at) payload.created_at = payload.updated_at;
  const data = await supabaseRest('/rest/v1/user_usage?on_conflict=user_id', {
    method: 'POST',
    asService: true,
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: payload,
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : data;
}
