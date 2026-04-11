// server/lib/app-usage-check.js
// Server-owned usage capacity gate.
//
// Authenticated users resolve usage against durable user_usage records.
// Guests fall back to server-owned limits with client-reported spend for the
// current session only. The browser is never the authority for durable spend.

import { json, withCors, readJsonBody } from "./http.js";
import { getAllowedBrowserOrigins } from "./origins.js";
import { getResolvedRuntimePolicyForRequest } from "./runtime-policy.js";
import { getUserFromAccessToken, getUsageRow, supabaseRest, upsertUsageRow } from "./supabase.js";

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
  try {
    const rpc = await supabaseRest('/rest/v1/rpc/consume_user_usage', {
      method: 'POST',
      asService: true,
      body: { user_id: userId, cost, reset_tz: 'UTC' },
    }).catch(() => null);
    if (rpc && typeof rpc.allowed === 'boolean') {
      return {
        allowed: rpc.allowed,
        reason: rpc.reason || (rpc.allowed ? 'ok' : 'daily_limit_reached'),
        used_units: toNumber(rpc.used_units),
        remaining_units: toNumber(rpc.remaining_units),
        usage_daily_limit: toNumber(rpc.usage_daily_limit, usageDailyLimit),
        used_api_calls: toNumber(rpc.used_api_calls),
        window_start: rpc.window_start || null,
        window_end: rpc.window_end || null,
      };
    }
  } catch (_) {}

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
  const payload = {
    ...base,
    updated_at: now.toISOString(),
  };
  if (allowed) {
    payload.used_units = nextUsedUnits;
    payload.used_api_calls = base.used_api_calls + 1;
    payload.last_consumed_at = now.toISOString();
  }
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
  if (token) {
    const user = await getUserFromAccessToken(token).catch(() => null);
    if (user?.id) {
      const verdict = await consumeDurableUsage(user.id, cost, usageDailyLimit).catch(() => null);
      if (verdict) {
        return json(res, 200, {
          ok: true,
          allowed: verdict.allowed,
          action,
          cost,
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
  }

  const rawSpent = body?.spent && typeof body.spent === 'object' ? body.spent : {};
  const totalSpent = Math.max(0, Math.floor(Object.values(rawSpent).reduce((a, b) => a + (Number(b) || 0), 0)));
  const remaining = Math.max(0, usageDailyLimit - totalSpent);
  const allowedVerdict = remaining >= cost;

  return json(res, 200, {
    ok: true,
    allowed: allowedVerdict,
    action,
    cost,
    totalSpent,
    remaining,
    limit: usageDailyLimit,
    meta: { resolutionMode: resolved.resolutionMode, policySource: 'server-guest' },
  });
}
