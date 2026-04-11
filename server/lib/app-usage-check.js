// server/lib/app-usage-check.js
// Read-only usage preflight. Returns whether an action would be allowed
// given the current durable usage state. Does NOT write or consume units.
//
// Use this for advisory preflight before a long operation so the user gets
// early feedback if they are at their daily limit. A successful check does
// not guarantee the subsequent consume will succeed (e.g. concurrent spend
// from another device), but it prevents wasting time on imports that would
// be denied at commit.
//
// For the actual durable write, use app-usage-consume.js (kind=usage-consume).

import { json, withCors, readJsonBody } from "./http.js";
import { getAllowedBrowserOrigins } from "./origins.js";
import { getResolvedRuntimePolicyForRequest } from "./runtime-policy.js";
import { getUserFromAccessToken, getUsageRow } from "./supabase.js";

const COST_PER_ACTION = 2;
const VALID_ACTIONS = new Set([
  'book_import', 'tts', 'ai', 'summary', 'anchors', 'evaluate',
  'import', 'research', 'other_protected_backend_action',
]);

function getBearer(req) {
  const header = String(req?.headers?.authorization || req?.headers?.Authorization || '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

function getUtcWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

// Read-only: fetch current usage row and compute remaining without writing.
async function checkDurableUsage(userId, cost, usageDailyLimit) {
  const now = new Date();
  const { start, end } = getUtcWindow(now);
  const current = await getUsageRow(userId).catch(() => null);
  const currentEnd = current?.window_end ? new Date(current.window_end) : null;
  const expired = !current || !(currentEnd instanceof Date) || Number.isNaN(currentEnd.getTime()) || now >= currentEnd;
  const usedUnits = expired ? 0 : Math.max(0, toNumber(current?.used_units));
  const usedApiCalls = expired ? 0 : toNumber(current?.used_api_calls);
  const remaining = Math.max(0, usageDailyLimit - usedUnits);
  const allowed = remaining >= cost;
  return {
    allowed,
    reason: allowed ? 'ok' : 'daily_limit_reached',
    used_units: usedUnits,
    remaining_units: remaining,
    usage_daily_limit: usageDailyLimit,
    used_api_calls: usedApiCalls,
    window_start: expired ? start.toISOString() : (current?.window_start || start.toISOString()),
    window_end: expired ? end.toISOString() : (current?.window_end || end.toISOString()),
  };
}

export default async function handler(req, res) {
  const allowedOrigins = getAllowedBrowserOrigins();
  if (withCors(req, res, allowedOrigins)) return;

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed. Use POST.' });
  }

  const body = await readJsonBody(req);
  const action = String(body?.action || '').trim().toLowerCase();
  if (!VALID_ACTIONS.has(action)) {
    return json(res, 400, {
      error: `action must be one of: ${[...VALID_ACTIONS].join(', ')}`,
      received: body?.action,
    });
  }

  const resolved = await getResolvedRuntimePolicyForRequest(req);
  const { usageDailyLimit } = resolved.policy;
  const cost = COST_PER_ACTION;

  if (usageDailyLimit == null) {
    return json(res, 200, {
      ok: true, allowed: true, action, cost,
      totalSpent: null, remaining: null, limit: null,
      meta: { resolutionMode: resolved.resolutionMode, policySource: 'server-unlimited' },
    });
  }

  const token = getBearer(req);
  if (token) {
    const user = await getUserFromAccessToken(token).catch(() => null);
    if (!user?.id) {
      // Token was present but could not be resolved to a user. Return auth_required
      // rather than falling through to the guest path — the caller should know
      // that their auth state is the problem, not a daily limit.
      return json(res, 200, {
        ok: false, allowed: false, action, cost,
        totalSpent: null, remaining: null, limit: usageDailyLimit,
        meta: { resolutionMode: resolved.resolutionMode, policySource: 'server-durable', reason: 'auth_required' },
      });
    }
    const verdict = await checkDurableUsage(user.id, cost, usageDailyLimit).catch(() => null);
    if (verdict) {
      return json(res, 200, {
        ok: true,
        allowed: verdict.allowed,
        action, cost,
        totalSpent: verdict.used_units,
        remaining: verdict.remaining_units,
        limit: verdict.usage_daily_limit,
        meta: {
          resolutionMode: resolved.resolutionMode,
          policySource: 'server-durable',
          reason: verdict.reason,
          window_start: verdict.window_start,
          window_end: verdict.window_end,
          used_api_calls: verdict.used_api_calls,
        },
      });
    }
  }

  // No bearer token — guest path. Client-reported spend is advisory only.
  const rawSpent = body?.spent && typeof body.spent === 'object' ? body.spent : {};
  const totalSpent = Math.max(0, Math.floor(Object.values(rawSpent).reduce((a, b) => a + (Number(b) || 0), 0)));
  const remaining = Math.max(0, usageDailyLimit - totalSpent);
  const allowedVerdict = remaining >= cost;

  return json(res, 200, {
    ok: true,
    allowed: allowedVerdict,
    action, cost, totalSpent, remaining,
    limit: usageDailyLimit,
    meta: { resolutionMode: resolved.resolutionMode, policySource: 'server-guest' },
  });
}
