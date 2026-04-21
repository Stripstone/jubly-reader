import crypto from 'crypto';
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



const TRIAL_CLAIM_SELECT = 'id,user_id,tier,ip_fingerprint_hash,claim_status,claimed_at,expires_at,notes,created_at,updated_at';

function normalizeTierForTrial(tier) {
  const normalized = String(tier || '').trim().toLowerCase();
  return normalized === 'premium' ? 'premium' : normalized === 'pro' ? 'pro' : '';
}

function sanitizeTrialClaim(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: row.id || null,
    user_id: row.user_id || null,
    tier: row.tier || null,
    ip_fingerprint_hash: row.ip_fingerprint_hash || null,
    claim_status: row.claim_status || null,
    claimed_at: row.claimed_at || null,
    expires_at: row.expires_at || null,
    notes: row.notes || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function hashTrialIpFootprint(value) {
  const secret = supabaseServiceKey();
  return crypto
    .createHmac('sha256', secret)
    .update(`jubly-trial-ip:${String(value || '').trim()}`)
    .digest('hex');
}

export async function getTrialClaimForUserTier(userId, tier) {
  const id = String(userId || '').trim();
  const normalizedTier = normalizeTierForTrial(tier);
  if (!id || !normalizedTier) return null;
  const data = await supabaseRest(
    `/rest/v1/user_trial_claims?user_id=eq.${encodeURIComponent(id)}&tier=eq.${encodeURIComponent(normalizedTier)}&select=${encodeURIComponent(TRIAL_CLAIM_SELECT)}&order=claimed_at.desc&limit=1`,
    {
      method: 'GET',
      asService: true,
      headers: { Prefer: 'count=exact' },
    }
  );
  return Array.isArray(data) && data[0] ? sanitizeTrialClaim(data[0]) : null;
}

export async function getTrialClaimForIpTier(tier, ipFingerprintHash) {
  const normalizedTier = normalizeTierForTrial(tier);
  const hash = String(ipFingerprintHash || '').trim();
  if (!normalizedTier || !hash) return null;
  const data = await supabaseRest(
    `/rest/v1/user_trial_claims?tier=eq.${encodeURIComponent(normalizedTier)}&ip_fingerprint_hash=eq.${encodeURIComponent(hash)}&select=${encodeURIComponent(TRIAL_CLAIM_SELECT)}&order=claimed_at.desc&limit=1`,
    {
      method: 'GET',
      asService: true,
      headers: { Prefer: 'count=exact' },
    }
  );
  return Array.isArray(data) && data[0] ? sanitizeTrialClaim(data[0]) : null;
}

export async function createTrialClaim({ userId, tier, ipFingerprintHash, expiresAt = null, notes = '' } = {}) {
  const id = String(userId || '').trim();
  const normalizedTier = normalizeTierForTrial(tier);
  const hash = String(ipFingerprintHash || '').trim();
  if (!id || !normalizedTier || !hash) throw new Error('Trial claim requires user, tier, and IP footprint.');
  const now = new Date().toISOString();
  const payload = {
    user_id: id,
    tier: normalizedTier,
    ip_fingerprint_hash: hash,
    claim_status: 'granted',
    claimed_at: now,
    expires_at: expiresAt || null,
    notes: notes || null,
    created_at: now,
    updated_at: now,
  };
  const data = await supabaseRest('/rest/v1/user_trial_claims', {
    method: 'POST',
    asService: true,
    headers: { Prefer: 'return=representation' },
    body: payload,
  });
  return Array.isArray(data) && data[0] ? sanitizeTrialClaim(data[0]) : sanitizeTrialClaim(data);
}

createTrialClaim.ipFingerprintHash = hashTrialIpFootprint;

export async function deleteTrialClaimById(claimId) {
  const id = String(claimId || '').trim();
  if (!id) return null;
  return supabaseRest(`/rest/v1/user_trial_claims?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    asService: true,
  });
}

export async function findAuthUserByEmail(email) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return null;
  const perPage = 1000;
  const maxPages = 5;
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetch(`${supabaseBaseUrl()}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
      method: 'GET',
      headers: {
        apikey: supabaseServiceKey(),
        Authorization: `Bearer ${supabaseServiceKey()}`,
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const error = new Error(`Supabase Auth admin lookup failed (${response.status})${text ? ` – ${text}` : ''}`);
      error.status = response.status;
      throw error;
    }
    const data = await response.json().catch(() => null);
    const users = Array.isArray(data) ? data : (Array.isArray(data?.users) ? data.users : []);
    const match = users.find((user) => String(user?.email || '').trim().toLowerCase() === target);
    if (match) return match;
    if (users.length < perPage) break;
  }
  return null;
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
    const detail = (data && typeof data === 'object')
      ? (data.message || data.hint || data.details || data.error || JSON.stringify(data))
      : (typeof data === 'string' ? data : '');
    const error = new Error(`Supabase REST ${response.status}${detail ? ` – ${detail}` : ''}`);
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
  const query = `/rest/v1/user_entitlements?or=(${filters.join(',')})&select=${encodeURIComponent(ENTITLEMENT_SELECT)}&order=updated_at.desc&limit=1`;
  const data = await supabaseRest(query, {
    method: 'GET',
    asService: true,
    headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  const row = Array.isArray(data) && data[0] ? data[0] : null;
  return sanitizeEntitlementRow(row);
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
