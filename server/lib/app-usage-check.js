// server/lib/app-usage-check.js
// Advisory capacity check only. Does not consume durable usage.
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

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getUtcWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

async function readDurableUsage(userId, usageDailyLimit) {
  const now = new Date();
  const { start, end } = getUtcWindow(now);
  const current = await getUsageRow(userId).catch(() => null);
  const currentEnd = current?.window_end ? new Date(current.window_end) : null;
  const expired = !current || !(currentEnd instanceof Date) || Number.isNaN(currentEnd.getTime()) || now >= currentEnd;
  const usedUnits = expired ? 0 : Math.max(0, toNumber(current?.used_units));
  const usedApiCalls = expired ? 0 : Math.max(0, toNumber(current?.used_api_calls));
  return {
    used_units: usedUnits,
    remaining_units: Math.max(0, usageDailyLimit - usedUnits),
    usage_daily_limit: usageDailyLimit,
    used_api_calls: usedApiCalls,
    window_start: expired ? start.toISOString() : (current?.window_start || start.toISOString()),
    window_end: expired ? end.toISOString() : (current?.window_end || end.toISOString()),
  };
}

export default async function handler(req, res) {
  const allowedOrigins = getAllowedBrowserOrigins();
  if (withCors(req, res, allowedOrigins)) return;
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed. Use POST.' });

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
    return json(res, 200, { ok: true, allowed: true, action, cost, totalSpent: null, remaining: null, limit: null, meta: { resolutionMode: resolved.resolutionMode, policySource: 'server-unlimited' } });
  }

  const token = getBearer(req);
  if (token) {
    const user = await getUserFromAccessToken(token).catch(() => null);
    if (user?.id) {
      const verdict = await readDurableUsage(user.id, usageDailyLimit).catch(() => null);
      if (verdict) {
        return json(res, 200, {
          ok: true,
          allowed: verdict.remaining_units >= cost,
          action,
          cost,
          totalSpent: verdict.used_units,
          remaining: verdict.remaining_units,
          limit: verdict.usage_daily_limit,
          meta: {
            resolutionMode: resolved.resolutionMode,
            policySource: 'server-durable',
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
  return json(res, 200, {
    ok: true,
    allowed: remaining >= cost,
    action,
    cost,
    totalSpent,
    remaining,
    limit: usageDailyLimit,
    meta: { resolutionMode: resolved.resolutionMode, policySource: 'server-guest' },
  });
}
