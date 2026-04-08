// api/import-capacity/index.js
// ─────────────────────────────────────────────────────────────────────────────
// INTERIM server-owned import capacity seam (Pass 3).
//
// Ownership model:
//   The policy limit (importSlotLimit) is server-owned.
//   On production, tier is always RUNTIME_DEFAULT_TIER (env var) — the client
//   cannot inflate the limit by claiming a higher tier in the request.
//   On preview/local, tier simulation is honored via ?tier= (same as runtime-config).
//
// Interim status:
//   `count` is client-provided (honest but not verified against durable storage).
//   The server trusts the count the client sends.
//   Pass 4 (Supabase) will replace client-provided count with durable records,
//   at which point this endpoint can verify count independently and the client
//   count parameter becomes redundant.
//
// Retirement condition:
//   Retire or narrow this endpoint when Pass 4 provides durable import tracking.
//   At that point, the server owns both limit AND count, making the request body
//   optional (or replaced by an identity-keyed lookup).
//
// Usage:
//   POST /api/import-capacity
//   Body: { count: N }
//   Response: { ok, hasCapacity, count, limit, meta }
//     meta: { resolutionMode, simulationAllowed, policySource }
// ─────────────────────────────────────────────────────────────────────────────

import { json, withCors, readJsonBody } from "../_lib/http.js";
import { getAllowedBrowserOrigins } from "../_lib/origins.js";
import { getResolvedRuntimePolicyForRequest } from "../_lib/runtime-policy.js";

export default async function handler(req, res) {
  const allowed = getAllowedBrowserOrigins();
  if (withCors(req, res, allowed)) return;

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed. Use POST.' });
  }

  const body = await readJsonBody(req);
  const rawCount = body?.count;
  const count = Number(rawCount);
  if (!Number.isFinite(count) || count < 0) {
    return json(res, 400, { error: 'count must be a non-negative number', received: rawCount });
  }

  const resolved = await getResolvedRuntimePolicyForRequest(req);
  const { importSlotLimit } = resolved.policy;

  // null importSlotLimit = unlimited (premium tier).
  const hasCapacity = importSlotLimit == null ? true : Math.floor(count) < importSlotLimit;

  return json(res, 200, {
    ok: true,
    hasCapacity,
    count: Math.floor(count),
    limit: importSlotLimit,
    meta: {
      resolutionMode: resolved.resolutionMode,
      simulationAllowed: resolved.simulationAllowed,
      // INTERIM: policySource confirms limit is server-owned; count is client-provided.
      policySource: 'server-interim',
    },
  });
}
