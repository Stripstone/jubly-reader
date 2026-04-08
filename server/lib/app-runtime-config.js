import { json, withCors } from "./http.js";
import { getAllowedBrowserOrigins } from "./origins.js";
import { getResolvedRuntimePolicyForRequest } from "./runtime-policy.js";


export default async function handler(req, res) {
  const allowed = getAllowedBrowserOrigins();
  if (withCors(req, res, allowed)) return;

  if (req.method !== 'GET') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  const resolved = await getResolvedRuntimePolicyForRequest(req);
  return json(res, 200, {
    ok: true,
    policy: resolved.policy,
    meta: {
      requestedTier: resolved.requestedTier,
      effectiveTier: resolved.effectiveTier,
      simulationAllowed: resolved.simulationAllowed,
      resolutionMode: resolved.resolutionMode,
      tierSource: resolved.tierSource,
      entitlement: resolved.entitlementSnapshot,
    },
  });
}
