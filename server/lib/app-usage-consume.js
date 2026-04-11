// server/lib/app-usage-consume.js
// Durable usage consume. Writes usage units after a successful action commit.
//
// This is the only path that increments user_usage. It must be called AFTER
// the action has successfully completed (e.g. after localBookPut succeeds),
// not before or during. This ensures:
//   - failed imports do not consume units
//   - retried imports do not double-charge
//   - aborted flows do not charge at all
//
// If the server is unreachable at commit time, the client treats the import
// as uncharged for this session. The discrepancy is acceptable for a local-
// first app — books are stored on-device and the server will eventually
// reconcile on the next durable sync.

import { json, withCors, readJsonBody } from "./http.js";
import { getAllowedBrowserOrigins } from "./origins.js";
import { getResolvedRuntimePolicyForRequest } from "./runtime-policy.js";
import { getUserFromAccessToken, getUsageRow, upsertUsageRow } from "./supabase.js";

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

async function consumeDurableUsage(userId, cost, usageDailyLimit) {
  const now = new Date();
  const { start, end } = getUtcWindow(now);
  const current = await getUsageRow(userId).catch(() => null);
  const currentEnd = current?.window_end ? new Date(current.window_end) : null;
  const expired = !current || !(currentEnd instanceof Date) || Number.isNaN(currentEnd.getTime()) || now >= currentEnd;

  const base = expired
    ? {
        user_id: userId,
        window_start: start.toISOString(),
        window_end: end.toISOString(),
        used_units: 0,
        used_api_calls: 0,
        last_consumed_at: null,
        created_at: current?.created_at || now.toISOString(),
      }
    : {
        ...current,
        user_id: userId,
        used_units: Math.max(0, toNumber(current?.used_units)),
        used_api_calls: Math.max(0, toNumber(current?.used_api_calls)),
      };

  const nextUsedUnits = base.used_units + cost;
  const allowed = nextUsedUnits <= usageDailyLimit;
  const payload = { ...base, updated_at: now.toISOString() };

  if (allowed) {
    payload.used_units = nextUsedUnits;
    payload.used_api_calls = base.used_api_calls + 1;
    payload.last_consumed_at = now.toISOString();
  }
  // Always upsert when window expired (to reset the window) or when allowed (to record spend).
  if (expired || allowed) {
    await upsertUsageRow(payload).catch(() => null);
  }

  return {
    allowed,
    reason: allowed ? 'ok' : 'daily_limit_reached',
    used_units: allowed ? nextUsedUnits : base.used_units,
    remaining_units: Math.max(0, usageDailyLimit - (allowed ? nextUsedUnits : base.used_units)),
    usage_daily_limit: usageDailyLimit,
    used_api_calls: allowed ? base.used_api_calls + 1 : base.used_api_calls,
    window_start: payload.window_start,
    window_end: payload.window_end,
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
  if (!token) {
    // No token on a consume path. Guest usage is tracked client-side only —
    // there is no durable row to write.
    return json(res, 200, {
      ok: false, allowed: false, action, cost,
      totalSpent: null, remaining: null, limit: usageDailyLimit,
      meta: { resolutionMode: resolved.resolutionMode, policySource: 'server-guest', reason: 'auth_required' },
    });
  }

  const user = await getUserFromAccessToken(token).catch(() => null);
  if (!user?.id) {
    return json(res, 200, {
      ok: false, allowed: false, action, cost,
      totalSpent: null, remaining: null, limit: usageDailyLimit,
      meta: { resolutionMode: resolved.resolutionMode, policySource: 'server-durable', reason: 'auth_required' },
    });
  }

  const verdict = await consumeDurableUsage(user.id, cost, usageDailyLimit).catch(() => null);
  if (!verdict) {
    return json(res, 500, {
      ok: false, allowed: false, action, cost,
      totalSpent: null, remaining: null, limit: usageDailyLimit,
      meta: { resolutionMode: resolved.resolutionMode, policySource: 'server-durable', reason: 'server_error' },
    });
  }

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
