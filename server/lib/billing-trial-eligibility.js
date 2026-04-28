import { json, withCors } from './http.js';
import { getAllowedBrowserOrigins } from './origins.js';
import { getPlanConfig } from './stripe.js';
import { getUserFromAccessToken } from './supabase.js';
import { resolveTrialEligibility, trialDaysForTier } from './billing-trials.js';

function getBearer(req) {
  const header = String(req?.headers?.authorization || req?.headers?.Authorization || '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

function getPlan(req) {
  try {
    if (typeof req?.query?.plan === 'string' && req.query.plan.trim()) return req.query.plan.trim().toLowerCase();
  } catch (_) {}
  try {
    const url = new URL(req.url, 'http://localhost');
    return String(url.searchParams.get('plan') || '').trim().toLowerCase();
  } catch (_) { return ''; }
}

export default async function handler(req, res) {
  const allowed = getAllowedBrowserOrigins();
  if (withCors(req, res, allowed)) return;

  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed. Use GET.' });

  let plan;
  try {
    plan = await getPlanConfig(getPlan(req));
  } catch (error) {
    return json(res, 400, { error: error.message || 'Invalid plan.' });
  }

  const token = getBearer(req);
  const user = token ? await getUserFromAccessToken(token).catch(() => null) : null;
  if (token && !user?.id) return json(res, 401, { error: 'Invalid session.' });

  let eligibility;
  try {
    eligibility = await resolveTrialEligibility(req, user, plan, trialDaysForTier(plan.tier));
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'Unable to verify trial eligibility.' });
  }

  return json(res, 200, {
    ok: true,
    plan: plan.tier,
    signedIn: !!user?.id,
    trial: {
      eligible: !!eligibility.eligible,
      resolved: !!eligibility.resolved,
      days: eligibility.days || 0,
      reason: eligibility.reason,
    },
  });
}
