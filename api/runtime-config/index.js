import { json, withCors } from "../_lib/http.js";
import { getAllowedBrowserOrigins } from "../_lib/origins.js";
import { buildRuntimePolicy, getDefaultRuntimeTier, isRuntimeTierSimulationAllowed, resolveRuntimeTier } from "../_lib/runtime-policy.js";

function getTierFromReq(req) {
  try {
    const q = req?.query?.tier;
    if (typeof q === 'string' && q.trim()) return resolveRuntimeTier(q);
  } catch (_) {}
  try {
    const url = new URL(req.url, 'http://localhost');
    return resolveRuntimeTier(url.searchParams.get('tier'));
  } catch (_) {
    return 'free';
  }
}

export default async function handler(req, res) {
  const allowed = getAllowedBrowserOrigins();
  if (withCors(req, res, allowed)) return;

  if (req.method !== 'GET') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  const simulationAllowed = isRuntimeTierSimulationAllowed(req);
  const requestedTier = getTierFromReq(req);
  const tier = simulationAllowed ? requestedTier : getDefaultRuntimeTier();
  const policy = {
    ...buildRuntimePolicy(tier),
    simulationAllowed,
  };
  return json(res, 200, {
    ok: true,
    policy,
    meta: {
      requestedTier,
      effectiveTier: tier,
      simulationAllowed,
      tierSource: simulationAllowed ? 'requested' : 'server-default',
    },
  });
}
