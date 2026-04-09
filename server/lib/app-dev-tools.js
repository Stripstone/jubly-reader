import { json, withCors, readJsonBody } from './http.js';
import { getAllowedBrowserOrigins } from './origins.js';
import { getResolvedRuntimePolicyForRequest } from './runtime-policy.js';
import { getActiveEntitlement, getUsageRow, supabaseRest, upsertEntitlement, upsertUsageRow } from './supabase.js';
import { getAuthorizedDevUser } from './dev-tools.js';

function toText(value, fallback = null) {
  const out = String(value == null ? '' : value).trim();
  return out ? out : fallback;
}

function toInt(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : fallback;
}

function toBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value == null || value === '') return fallback;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return fallback;
}

function utcWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

async function getUsersRow(userId) {
  const data = await supabaseRest(`/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=id,display_name,email,auth_provider,status,created_at,updated_at&limit=1`, {
    method: 'GET',
    asService: true,
    headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function getSettingsRow(userId) {
  const data = await supabaseRest(`/rest/v1/user_settings?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`, {
    method: 'GET',
    asService: true,
    headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function getProgressRows(userId) {
  const data = await supabaseRest(`/rest/v1/user_progress?user_id=eq.${encodeURIComponent(userId)}&select=*&order=updated_at.desc&limit=50`, {
    method: 'GET',
    asService: true,
    headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) ? data : [];
}

async function getSessionRows(userId) {
  const data = await supabaseRest(`/rest/v1/user_sessions?user_id=eq.${encodeURIComponent(userId)}&select=*&order=ended_at.desc.nullslast,updated_at.desc&limit=50`, {
    method: 'GET',
    asService: true,
    headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) ? data : [];
}

function summarizeSessions(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  let minutesListened = 0;
  let pagesCompleted = 0;
  let completedCount = 0;
  for (const row of list) {
    minutesListened += Math.max(0, toInt(row?.minutes_listened, 0));
    pagesCompleted += Math.max(0, toInt(row?.pages_completed, 0));
    if (row?.completed) completedCount += 1;
  }
  return {
    totalSessions: list.length,
    minutesListened,
    pagesCompleted,
    completedCount,
    latest: list[0] || null,
  };
}

function computeUsageSummary(usageRow, limit) {
  const usageDailyLimit = Number.isFinite(Number(limit)) ? Math.max(0, Number(limit)) : null;
  const usedUnits = Math.max(0, toInt(usageRow?.used_units, 0));
  return {
    row: usageRow || null,
    remaining: usageDailyLimit == null ? null : Math.max(0, usageDailyLimit - usedUnits),
    limit: usageDailyLimit,
    usedApiCalls: Math.max(0, toInt(usageRow?.used_api_calls, 0)),
  };
}

async function buildSnapshot(req, user) {
  const [usersRow, settingsRow, entitlementRow, usageRow, progressRows, sessionRows, resolved] = await Promise.all([
    getUsersRow(user.id),
    getSettingsRow(user.id),
    getActiveEntitlement(user.id),
    getUsageRow(user.id),
    getProgressRows(user.id),
    getSessionRows(user.id),
    getResolvedRuntimePolicyForRequest(req),
  ]);

  const activeProgressRows = (progressRows || []).filter((row) => row && row.is_active !== false);
  const latestProgress = activeProgressRows[0] || progressRows[0] || null;
  const sessions = summarizeSessions(sessionRows);
  return {
    usersRow,
    settingsRow,
    entitlementRow,
    usage: computeUsageSummary(usageRow, resolved?.policy?.usageDailyLimit),
    progress: {
      latest: latestProgress,
      rows: progressRows || [],
      activeRows: activeProgressRows,
    },
    sessions,
    policy: resolved?.policy || null,
    policyMeta: {
      effectiveTier: resolved?.effectiveTier || 'free',
      resolutionMode: resolved?.resolutionMode || 'production',
    },
  };
}

async function upsertSettings(userId, patch) {
  const existing = await getSettingsRow(userId).catch(() => null);
  const payload = {
    ...(existing || {}),
    user_id: userId,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  const data = await supabaseRest('/rest/v1/user_settings?on_conflict=user_id', {
    method: 'POST',
    asService: true,
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: payload,
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : payload;
}

async function clearSettings(userId) {
  await supabaseRest(`/rest/v1/user_settings?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    asService: true,
  }).catch(() => null);
}

async function setPlan(userId, payload) {
  const tierInput = String(payload?.tier || 'free').trim().toLowerCase();
  const tier = tierInput === 'pro' ? 'paid' : tierInput;
  const planId = toText(payload?.plan_id, tier === 'premium' ? 'premium' : tier === 'paid' ? 'pro' : 'free');
  const status = toText(payload?.status, 'active');
  const existing = await getActiveEntitlement(userId).catch(() => null);
  return upsertEntitlement({
    ...(existing || {}),
    user_id: userId,
    provider: toText(payload?.provider, existing?.provider || 'debug'),
    plan_id: planId,
    tier,
    status,
    stripe_customer_id: existing?.stripe_customer_id || null,
    stripe_subscription_id: existing?.stripe_subscription_id || null,
    period_start: existing?.period_start || null,
    period_end: existing?.period_end || null,
    created_at: existing?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

async function setUsage(req, userId, payload) {
  const resolved = await getResolvedRuntimePolicyForRequest(req);
  const limit = Number(resolved?.policy?.usageDailyLimit ?? 0) || 0;
  const now = new Date();
  const window = utcWindow(now);
  const existing = await getUsageRow(userId).catch(() => null);
  const remainingProvided = payload && Object.prototype.hasOwnProperty.call(payload, 'remaining');
  const usedUnits = remainingProvided
    ? Math.max(0, limit - Math.max(0, toInt(payload?.remaining, limit)))
    : Math.max(0, toInt(payload?.used_units, existing?.used_units || 0));
  const usedApiCalls = Math.max(0, toInt(payload?.used_api_calls, existing?.used_api_calls || 0));
  const row = await upsertUsageRow({
    ...(existing || {}),
    user_id: userId,
    window_start: toText(payload?.window_start, existing?.window_start || window.start.toISOString()),
    window_end: toText(payload?.window_end, existing?.window_end || window.end.toISOString()),
    used_units: usedUnits,
    used_api_calls: usedApiCalls,
    last_consumed_at: payload?.last_consumed_at === null ? null : toText(payload?.last_consumed_at, existing?.last_consumed_at || now.toISOString()),
    created_at: existing?.created_at || now.toISOString(),
    updated_at: now.toISOString(),
  });
  return computeUsageSummary(row, limit);
}

async function resetUsageWindow(req, userId) {
  return setUsage(req, userId, { used_units: 0, used_api_calls: 0, last_consumed_at: null });
}

async function setProgress(userId, payload) {
  const bookId = toText(payload?.book_id || payload?.bookId, '');
  if (!bookId) throw new Error('book_id is required');
  const sourceType = toText(payload?.source_type || payload?.sourceType, 'book');
  const sourceId = toText(payload?.source_id || payload?.sourceId, bookId);
  const chapterId = payload?.chapter_id == null && payload?.chapterId == null ? null : String(payload?.chapter_id ?? payload?.chapterId);
  const existingRows = await getProgressRows(userId);
  const match = (existingRows || []).find((row) => String(row.book_id || '') === bookId && String(row.source_type || '') === sourceType && String(row.source_id || '') === sourceId && String(row.chapter_id ?? '') === String(chapterId ?? ''));
  const nowIso = new Date().toISOString();
  const base = {
    user_id: userId,
    book_id: bookId,
    source_type: sourceType,
    source_id: sourceId,
    chapter_id: chapterId,
    page_count: Math.max(0, toInt(payload?.page_count ?? payload?.pageCount, match?.page_count || 0)),
    last_page_index: Math.max(0, toInt(payload?.last_page_index ?? payload?.pageIndex, match?.last_page_index || 0)),
    last_read_at: nowIso,
    updated_at: nowIso,
    is_active: payload?.is_active == null && payload?.isActive == null ? true : toBool(payload?.is_active ?? payload?.isActive, true),
    session_version: Math.max(1, toInt(payload?.session_version ?? payload?.sessionVersion, match?.session_version || 1)),
  };
  if (match?.id) {
    const data = await supabaseRest(`/rest/v1/user_progress?id=eq.${encodeURIComponent(match.id)}&select=*`, {
      method: 'PATCH',
      asService: true,
      headers: { Prefer: 'return=representation' },
      body: base,
    }).catch(() => null);
    return Array.isArray(data) && data[0] ? data[0] : { ...match, ...base };
  }
  const data = await supabaseRest('/rest/v1/user_progress', {
    method: 'POST',
    asService: true,
    headers: { Prefer: 'return=representation' },
    body: base,
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : base;
}

async function clearProgress(userId, payload) {
  const filters = [`user_id=eq.${encodeURIComponent(userId)}`];
  const bookId = toText(payload?.book_id || payload?.bookId, '');
  const sourceType = toText(payload?.source_type || payload?.sourceType, '');
  const sourceId = toText(payload?.source_id || payload?.sourceId, '');
  const chapterId = payload?.chapter_id == null && payload?.chapterId == null ? '' : String(payload?.chapter_id ?? payload?.chapterId);
  if (bookId) filters.push(`book_id=eq.${encodeURIComponent(bookId)}`);
  if (sourceType) filters.push(`source_type=eq.${encodeURIComponent(sourceType)}`);
  if (sourceId) filters.push(`source_id=eq.${encodeURIComponent(sourceId)}`);
  if (chapterId !== '') filters.push(`chapter_id=eq.${encodeURIComponent(chapterId)}`);
  await supabaseRest(`/rest/v1/user_progress?${filters.join('&')}`, {
    method: 'DELETE',
    asService: true,
  }).catch(() => null);
}

async function addSession(userId, payload) {
  const now = new Date();
  const minutesListened = Math.max(0, toInt(payload?.minutes_listened ?? payload?.minutesListened, 0));
  const elapsedSeconds = Math.max(0, toInt(payload?.elapsed_seconds ?? payload?.elapsedSeconds, minutesListened * 60));
  const startedAt = toText(payload?.started_at || payload?.startedAt, new Date(now.getTime() - elapsedSeconds * 1000).toISOString());
  const endedAt = toText(payload?.ended_at || payload?.endedAt, now.toISOString());
  const row = {
    user_id: userId,
    pages_completed: Math.max(0, toInt(payload?.pages_completed ?? payload?.pagesCompleted, 0)),
    minutes_listened: minutesListened,
    source_type: toText(payload?.source_type || payload?.sourceType, 'book'),
    source_id: toText(payload?.source_id || payload?.sourceId, toText(payload?.book_id || payload?.bookId, '')),
    book_id: toText(payload?.book_id || payload?.bookId, ''),
    chapter_id: payload?.chapter_id == null && payload?.chapterId == null ? null : String(payload?.chapter_id ?? payload?.chapterId),
    mode: toText(payload?.mode, 'reading'),
    tts_seconds: Math.max(0, toInt(payload?.tts_seconds ?? payload?.ttsSeconds, 0)),
    completed: toBool(payload?.completed, false),
    started_at: startedAt,
    ended_at: endedAt,
    updated_at: now.toISOString(),
    elapsed_seconds: elapsedSeconds,
  };
  const data = await supabaseRest('/rest/v1/user_sessions', {
    method: 'POST',
    asService: true,
    headers: { Prefer: 'return=representation' },
    body: row,
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : row;
}

async function resetSessions(userId) {
  await supabaseRest(`/rest/v1/user_sessions?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    asService: true,
  }).catch(() => null);
}

async function applyAction(req, user, action, payload) {
  switch (action) {
    case 'set_plan':
      await setPlan(user.id, payload || {});
      break;
    case 'set_usage':
      await setUsage(req, user.id, payload || {});
      break;
    case 'reset_usage_window':
      await resetUsageWindow(req, user.id);
      break;
    case 'set_progress':
      await setProgress(user.id, payload || {});
      break;
    case 'clear_progress':
      await clearProgress(user.id, payload || {});
      break;
    case 'add_session':
      await addSession(user.id, payload || {});
      break;
    case 'reset_sessions':
      await resetSessions(user.id);
      break;
    case 'set_settings':
      await upsertSettings(user.id, payload || {});
      break;
    case 'clear_settings':
      await clearSettings(user.id);
      break;
    default:
      throw new Error(`Unsupported dev action: ${action}`);
  }
}

export default async function handler(req, res) {
  const allowedOrigins = getAllowedBrowserOrigins();
  if (withCors(req, res, allowedOrigins)) return;

  const auth = await getAuthorizedDevUser(req);
  if (!auth.ok) {
    const status = auth.reason === 'missing_auth' || auth.reason === 'invalid_auth' ? 401 : 403;
    return json(res, status, { ok: false, allowed: false, reason: auth.reason });
  }

  if (req.method === 'GET') {
    const snapshot = await buildSnapshot(req, auth.user);
    return json(res, 200, { ok: true, allowed: true, email: auth.user.email || '', snapshot });
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const action = String(body?.action || '').trim().toLowerCase();
    if (!action) return json(res, 400, { ok: false, error: 'Missing action.' });
    try {
      await applyAction(req, auth.user, action, body?.payload || {});
      const snapshot = await buildSnapshot(req, auth.user);
      return json(res, 200, { ok: true, allowed: true, email: auth.user.email || '', snapshot });
    } catch (error) {
      return json(res, 400, { ok: false, error: String(error?.message || error || 'Dev action failed.') });
    }
  }

  return json(res, 405, { ok: false, error: 'Method not allowed.' });
}
