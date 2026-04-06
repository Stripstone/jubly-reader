import { json, withCors } from "../_lib/http.js";
import { getAllowedBrowserOrigins } from "../_lib/origins.js";
import { buildRuntimePolicy, resolveRuntimeTier } from "../_lib/runtime-policy.js";

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

  const tier = getTierFromReq(req);
  const policy = buildRuntimePolicy(tier);
  return json(res, 200, { ok: true, policy });
}
