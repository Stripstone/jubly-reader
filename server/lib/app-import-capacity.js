// server/lib/app-import-capacity.js
// ─────────────────────────────────────────────────────────────────────────────
// Server-owned import capacity gate.
//
// Ownership model:
//   The server resolves the authenticated user, resolves the import slot limit,
//   counts active durable library rows, and returns a capacity verdict. The
//   browser may display local "Saved on this device" cache state, but it is not
//   entitlement or capacity authority.
//
// Usage:
//   POST /api/app?kind=import-capacity
//   Response: { ok, allowed, reason, count, limit, source, stage }
// ─────────────────────────────────────────────────────────────────────────────

import { json, withCors } from "./http.js";
import { getAllowedBrowserOrigins } from "./origins.js";
import { getResolvedRuntimePolicyForRequest } from "./runtime-policy.js";
import { getUserFromAccessToken, supabaseRest } from "./supabase.js";

const IMPORT_CAPACITY_SOURCE = 'server-durable';

function getBearerToken(req) {
  try {
    const auth = String(req?.headers?.authorization || req?.headers?.Authorization || '').trim();
    const match = auth.match(/^Bearer\s+(.+)$/i);
    return match ? String(match[1] || '').trim() : '';
  } catch (_) {
    return '';
  }
}

async function getAuthorizedImportUser(req) {
  const token = getBearerToken(req);
  if (!token) return { ok: false, reason: 'auth_required' };
  const user = await getUserFromAccessToken(token).catch(() => null);
  if (!user || !user.id) return { ok: false, reason: 'auth_required' };
  return { ok: true, token, user };
}

function buildCapacityBody({ ok, allowed, reason, count, limit, stage }) {
  return {
    ok: !!ok,
    allowed: !!allowed,
    reason,
    count: Number.isFinite(Number(count)) ? Math.max(0, Math.trunc(Number(count))) : null,
    limit: limit == null ? null : Math.max(0, Math.trunc(Number(limit))),
    source: IMPORT_CAPACITY_SOURCE,
    stage: String(stage || 'intake'),
  };
}

function normalizeCapacityText(value) {
  return String(value == null ? '' : value).trim();
}

function activeCapacityIdentityKey(row = {}) {
  const fingerprint = normalizeCapacityText(row.content_fingerprint);
  if (fingerprint) return `fp:${fingerprint}`;
  const storageRef = normalizeCapacityText(row.storage_ref);
  if (storageRef) return `sr:${storageRef}`;
  return row.id ? `id:${row.id}` : null;
}

export async function countActiveLibraryItemsForUser(userId) {
  const id = String(userId || '').trim();
  if (!id) throw new Error('user_id is required for active library count');

  // Capacity counts durable active owned-book identities, not raw historical
  // duplicate rows. Deleted rows do not count.
  const data = await supabaseRest(
    `/rest/v1/user_library_items?user_id=eq.${encodeURIComponent(id)}&status=eq.active&select=id,content_fingerprint,storage_ref&limit=10000`,
    {
      method: 'GET',
      asService: true,
      headers: { Prefer: 'count=exact' },
    }
  );
  const seen = new Set();
  for (const row of Array.isArray(data) ? data : []) {
    const key = activeCapacityIdentityKey(row);
    if (key) seen.add(key);
  }
  return seen.size;
}

export async function resolveImportCapacity(req, { stage = 'intake', user = null } = {}) {
  try {
    let activeUser = user && user.id ? user : null;
    if (!activeUser) {
      const auth = await getAuthorizedImportUser(req);
      if (!auth.ok) {
        return {
          status: 401,
          body: buildCapacityBody({
            ok: false,
            allowed: false,
            reason: 'auth_required',
            count: null,
            limit: null,
            stage,
          }),
        };
      }
      activeUser = auth.user;
    }

    const resolved = await getResolvedRuntimePolicyForRequest(req);
    const limit = resolved?.policy?.importSlotLimit ?? null;
    const count = await countActiveLibraryItemsForUser(activeUser.id);
    const allowed = limit == null ? true : count < limit;

    return {
      status: 200,
      body: buildCapacityBody({
        ok: true,
        allowed,
        reason: allowed ? 'allowed' : 'library_full',
        count,
        limit,
        stage,
      }),
    };
  } catch (error) {
    console.error('[app-import-capacity]', error);
    return {
      status: 500,
      body: buildCapacityBody({
        ok: false,
        allowed: false,
        reason: 'server_error',
        count: null,
        limit: null,
        stage,
      }),
    };
  }
}

export default async function handler(req, res) {
  const allowed = getAllowedBrowserOrigins();
  if (withCors(req, res, allowed)) return;

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed. Use POST.' });
  }

  const result = await resolveImportCapacity(req, { stage: 'intake' });
  return json(res, result.status, result.body);
}
