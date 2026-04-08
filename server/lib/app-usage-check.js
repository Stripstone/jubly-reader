// server/lib/app-usage-check.js
// ─────────────────────────────────────────────────────────────────────────────
// Interim server-owned usage capacity seam (Pass 3).
//
// Ownership model:
//   usageDailyLimit and per-action TOKEN_COSTS are server-owned.
//   The client cannot inflate the limit by claiming a higher tier — tier is
//   always resolved server-side from RUNTIME_DEFAULT_TIER (production) or
//   ?tier= (preview/local simulation).
//
// Interim status:
//   `spent` is client-reported (self-reported session token state).
//   The server validates against server-owned limits; the count itself is not
//   yet verified against durable storage. Pass 4 (Supabase) will replace
//   client-reported spend with durable server-side records, at which point
//   the `spent` request field becomes redundant.
//
// Usage:
//   POST /api/usage-check
//   Body: { action: 'tts'|'evaluate'|'anchors'|'research', spent: { tts, evaluate, anchors, research } }
//   Response: { ok, allowed, action, cost, totalSpent, remaining, limit, meta }
//     meta: { resolutionMode, policySource, simulationAllowed }
//
//   null limit = unlimited (premium); in that case remaining = null, allowed = true.
// ─────────────────────────────────────────────────────────────────────────────

import { json, withCors, readJsonBody } from "./http.js";
import { getAllowedBrowserOrigins } from "./origins.js";
import { getResolvedRuntimePolicyForRequest } from "./runtime-policy.js";

// Token costs are server-owned. Client must not maintain an independent cost
// matrix — it treats the backend verdict as truth.
const TOKEN_COSTS = {
  tts:      1,
  evaluate: 2,
  anchors:  1,
  research: 3,
};

const VALID_ACTIONS = new Set(Object.keys(TOKEN_COSTS));

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

  // Validate and floor client-reported spend state.
  const rawSpent = body?.spent && typeof body.spent === 'object' ? body.spent : {};
  const spent = {
    tts:      Math.max(0, Math.floor(Number(rawSpent.tts)      || 0)),
    evaluate: Math.max(0, Math.floor(Number(rawSpent.evaluate) || 0)),
    anchors:  Math.max(0, Math.floor(Number(rawSpent.anchors)  || 0)),
    research: Math.max(0, Math.floor(Number(rawSpent.research) || 0)),
  };

  const resolved = await getResolvedRuntimePolicyForRequest(req);
  const { usageDailyLimit } = resolved.policy;
  const cost = TOKEN_COSTS[action];

  const totalSpent = Object.values(spent).reduce((a, b) => a + b, 0);

  // null usageDailyLimit = unlimited. Guard for future unlimited tiers.
  let remaining, allowed_verdict;
  if (usageDailyLimit == null) {
    remaining = null;
    allowed_verdict = true;
  } else {
    remaining = Math.max(0, usageDailyLimit - totalSpent);
    allowed_verdict = remaining >= cost;
  }

  return json(res, 200, {
    ok: true,
    allowed: allowed_verdict,
    action,
    cost,
    totalSpent,
    remaining,
    limit: usageDailyLimit,
    meta: {
      resolutionMode: resolved.resolutionMode,
      simulationAllowed: resolved.simulationAllowed,
      // INTERIM: policySource confirms limit is server-owned; spend is client-reported.
      policySource: 'server-interim',
    },
  });
}
