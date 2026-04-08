// server/lib/app-usage-check.js
// ─────────────────────────────────────────────────────────────────────────────
// Server-owned usage capacity gate.
//
// Ownership model:
//   Authenticated users: atomic consume via the consume_user_usage() Supabase
//   RPC. The RPC owns window management, daily reset, and the allowed verdict.
//   Client spend state is never used for the enforcement decision.
//
//   Guest/unauthenticated users: server-owned limits, client-reported spend.
//   No user_id — cannot key a durable record.
//
// Table shapes and RPC contract: see JUBLY USAGE / ENTITLEMENT UNIFIED KEY.
//
// Usage:
//   POST /api/app?kind=usage-check
//   Body: { action: 'book_import'|'tts'|'ai'|'anchors'|'evaluate'|..., spent?: {...} }
//   Response: { ok, allowed, action, cost, totalSpent, remaining, limit, meta }
//     meta.policySource: 'server-durable' | 'server-guest' | 'server-unlimited'
// ─────────────────────────────────────────────────────────────────────────────

import { json, withCors, readJsonBody } from "./http.js";
import { getAllowedBrowserOrigins } from "./origins.js";
import { getResolvedRuntimePolicyForRequest } from "./runtime-policy.js";
import { getUserFromAccessToken, supabaseRest } from "./supabase.js";

// Fixed cost per protected API call — matches USAGE_COST_PER_PROTECTED_API_CALL.
const COST_PER_ACTION = 2;

const VALID_ACTIONS = new Set([
  'book_import', 'tts', 'ai', 'summary', 'anchors', 'evaluate',
  // legacy aliases kept for backwards compat during transition
  'import', 'research', 'other_protected_backend_action',
]);

function getBearer(req) {
  const header = String(req?.headers?.authorization || req?.headers?.Authorization || '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

export default async function handler(req, res) {
  const allowed = getAllowedBrowserOrigins();
  if (withCors(req, res, allowed)) return;

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

  // Unlimited tier — allow without touching usage records.
  if (usageDailyLimit == null) {
    return json(res, 200, {
      ok: true, allowed: true, action, cost,
      totalSpent: null, remaining: null, limit: null,
      meta: { resolutionMode: resolved.resolutionMode, policySource: 'server-unlimited' },
    });
  }

  // ── Authenticated path: durable RPC ──────────────────────────────────────
  // The consume_user_usage RPC atomically checks the window, resets if expired,
  // applies the cost, and returns the verdict. No client state is consulted.
  const token = getBearer(req);
  if (token) {
    const user = await getUserFromAccessToken(token).catch(() => null);
    if (user && user.id) {
      const rpc = await supabaseRest('/rest/v1/rpc/consume_user_usage', {
        method: 'POST',
        asService: true,
        body: { user_id: user.id, cost, reset_tz: 'UTC' },
      }).catch(() => null);

      if (rpc && typeof rpc.allowed === 'boolean') {
        return json(res, 200, {
          ok: true,
          allowed: rpc.allowed,
          action,
          cost,
          totalSpent: rpc.used_units,
          remaining: rpc.remaining_units,
          limit: rpc.usage_daily_limit,
          meta: {
            resolutionMode: resolved.resolutionMode,
            policySource: 'server-durable',
            reason: rpc.reason,
            window_start: rpc.window_start,
            window_end: rpc.window_end,
          },
        });
      }
      // RPC unavailable — fall through to guest path rather than blocking.
    }
  }

  // ── Guest path: server-owned limits, client-reported spend ────────────────
  const rawSpent = body?.spent && typeof body.spent === 'object' ? body.spent : {};
  const totalSpent = Math.max(0, Math.floor(
    Object.values(rawSpent).reduce((a, b) => a + (Number(b) || 0), 0)
  ));
  const remaining = Math.max(0, usageDailyLimit - totalSpent);
  const allowed_verdict = remaining >= cost;

  return json(res, 200, {
    ok: true,
    allowed: allowed_verdict,
    action,
    cost,
    totalSpent,
    remaining,
    limit: usageDailyLimit,
    meta: { resolutionMode: resolved.resolutionMode, policySource: 'server-guest' },
  });
}
