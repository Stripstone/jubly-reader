import { json, withCors, readJsonBody } from './http.js';
import { getAllowedBrowserOrigins } from './origins.js';
import { getUsageRow, supabaseRest } from './supabase.js';
import { getResolvedRuntimePolicyForRequest } from './runtime-policy.js';
import { getAuthorizedUser } from './dev-tools.js';

function toText(value, fallback = null) {
  const out = String(value == null ? '' : value).trim();
  return out ? out : fallback;
}

function toInt(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : fallback;
}


async function getUsersRow(userId) {
  const data = await supabaseRest(`/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=id,display_name,email,auth_provider,status,created_at,updated_at&limit=1`, {
    method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function getSettingsRow(userId) {
  const data = await supabaseRest(`/rest/v1/user_settings?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`, {
    method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function getProgressRows(userId) {
  const data = await supabaseRest(`/rest/v1/user_progress?user_id=eq.${encodeURIComponent(userId)}&select=*&order=updated_at.desc&limit=100`, {
    method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) ? data : [];
}

async function getSessionRows(userId) {
  const data = await supabaseRest(`/rest/v1/user_sessions?user_id=eq.${encodeURIComponent(userId)}&select=*&order=ended_at.desc.nullslast,updated_at.desc&limit=500`, {
    method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) ? data : [];
}

function computeUsageSummary(usageRow, limit) {
  const hasRow = !!(usageRow && typeof usageRow === 'object');
  const usageDailyLimit = hasRow && Number.isFinite(Number(limit)) ? Math.max(0, Number(limit)) : null;
  const usedUnits = hasRow ? Math.max(0, toInt(usageRow?.used_units, 0)) : 0;
  return {
    row: hasRow ? usageRow : null,
    remaining: hasRow && usageDailyLimit != null ? Math.max(0, usageDailyLimit - usedUnits) : null,
    limit: hasRow ? usageDailyLimit : null,
    usedApiCalls: hasRow ? Math.max(0, toInt(usageRow?.used_api_calls, 0)) : 0,
  };
}

async function buildSnapshot(req, user) {
  const [usersRow, settingsRow, progressRows, sessionRows, usageRow, resolved] = await Promise.all([
    getUsersRow(user.id),
    getSettingsRow(user.id),
    getProgressRows(user.id),
    getSessionRows(user.id),
    getUsageRow(user.id).catch(() => null),
    getResolvedRuntimePolicyForRequest(req).catch(() => null),
  ]);
  const activeProgressRows = (Array.isArray(progressRows) ? progressRows : []).filter((row) => row && row.is_active !== false);
  return {
    usersRow,
    settingsRow,
    progress: {
      rows: activeProgressRows,
      latest: activeProgressRows[0] || null,
    },
    sessions: {
      rows: sessionRows || [],
      latest: Array.isArray(sessionRows) && sessionRows[0] ? sessionRows[0] : null,
      totalSessions: Array.isArray(sessionRows) ? sessionRows.length : 0,
    },
    usage: computeUsageSummary(usageRow, resolved?.policy?.usageDailyLimit),
  };
}

async function upsertUsersRow(user, row) {
  const payload = {
    id: user.id,
    display_name: toText(row?.display_name, toText(user?.user_metadata?.full_name, toText(user?.user_metadata?.name, (String(user.email || '').split('@')[0] || 'Account')))),
    email: toText(row?.email, toText(user.email, null)),
    auth_provider: toText(row?.auth_provider, toText(user?.app_metadata?.provider, 'email')),
    status: toText(row?.status, 'active'),
    updated_at: new Date().toISOString(),
  };
  const data = await supabaseRest('/rest/v1/users?on_conflict=id', {
    method: 'POST',
    asService: true,
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: payload,
  });
  return Array.isArray(data) && data[0] ? data[0] : payload;
}

async function upsertSettingsRow(user, row) {
  const payload = { ...(row || {}), user_id: user.id, updated_at: new Date().toISOString() };
  const data = await supabaseRest('/rest/v1/user_settings?on_conflict=user_id', {
    method: 'POST',
    asService: true,
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: payload,
  });
  return Array.isArray(data) && data[0] ? data[0] : payload;
}

async function findProgressRow(userId, row) {
  const filters = [
    `user_id=eq.${encodeURIComponent(userId)}`,
    `book_id=eq.${encodeURIComponent(String(row.book_id || ''))}`,
    `source_type=eq.${encodeURIComponent(String(row.source_type || 'book'))}`,
    `source_id=eq.${encodeURIComponent(String(row.source_id || row.book_id || ''))}`,
  ];
  if (row.chapter_id == null || row.chapter_id === '') filters.push('chapter_id=is.null');
  else filters.push(`chapter_id=eq.${encodeURIComponent(String(row.chapter_id))}`);
  const data = await supabaseRest(`/rest/v1/user_progress?${filters.join('&')}&select=*&limit=1`, {
    method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function writeProgressRow(user, row) {
  const payload = {
    user_id: user.id,
    book_id: toText(row?.book_id, ''),
    source_type: toText(row?.source_type, 'book'),
    source_id: toText(row?.source_id, toText(row?.book_id, '')),
    chapter_id: row?.chapter_id == null || row?.chapter_id === '' ? null : String(row.chapter_id),
    page_count: Math.max(0, toInt(row?.page_count, 0)),
    last_page_index: Math.max(0, toInt(row?.last_page_index, 0)),
    last_read_at: toText(row?.last_read_at, new Date().toISOString()),
    updated_at: new Date().toISOString(),
    is_active: row?.is_active === false ? false : true,
    session_version: Math.max(1, toInt(row?.session_version, 1)),
  };
  if (!payload.book_id) throw new Error('book_id is required');
  const existing = await findProgressRow(user.id, payload);
  if (existing && existing.id) {
    const data = await supabaseRest(`/rest/v1/user_progress?id=eq.${encodeURIComponent(existing.id)}`, {
      method: 'PATCH',
      asService: true,
      headers: { Prefer: 'return=representation' },
      body: payload,
    }).catch(() => null);
    return Array.isArray(data) && data[0] ? data[0] : { ...existing, ...payload };
  }
  const data = await supabaseRest('/rest/v1/user_progress', {
    method: 'POST',
    asService: true,
    headers: { Prefer: 'return=representation' },
    body: payload,
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : payload;
}

async function insertSessionRow(user, row) {
  const payload = {
    user_id: user.id,
    pages_completed: Math.max(0, toInt(row?.pages_completed, 0)),
    minutes_listened: Math.max(0, toInt(row?.minutes_listened, 0)),
    elapsed_seconds: Math.max(0, toInt(row?.elapsed_seconds, Math.max(0, toInt(row?.minutes_listened, 0)) * 60)),
    source_type: toText(row?.source_type, 'book'),
    source_id: toText(row?.source_id, toText(row?.book_id, '')),
    book_id: toText(row?.book_id, ''),
    chapter_id: row?.chapter_id == null || row?.chapter_id === '' ? null : String(row.chapter_id),
    mode: toText(row?.mode, 'reading'),
    tts_seconds: Math.max(0, toInt(row?.tts_seconds, 0)),
    completed: !!row?.completed,
    started_at: toText(row?.started_at, new Date().toISOString()),
    ended_at: toText(row?.ended_at, new Date().toISOString()),
    updated_at: new Date().toISOString(),
  };
  if (!payload.book_id) throw new Error('book_id is required');
  const data = await supabaseRest('/rest/v1/user_sessions', {
    method: 'POST',
    asService: true,
    headers: { Prefer: 'return=representation' },
    body: payload,
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : payload;
}

export default async function handler(req, res) {
  const allowedOrigins = getAllowedBrowserOrigins();
  if (withCors(req, res, allowedOrigins)) return;
  const auth = await getAuthorizedUser(req);
  if (!auth.ok) return json(res, 401, { ok: false, error: auth.reason || 'Unauthorized.' });
  if (req.method === 'GET') {
    return json(res, 200, { ok: true, snapshot: await buildSnapshot(req, auth.user) });
  }
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed.' });
  const body = await readJsonBody(req);
  const action = String(body?.action || '').trim().toLowerCase();
  const payload = body?.payload || {};
  try {
    let row = null;
    if (action === 'sync_user_row') row = await upsertUsersRow(auth.user, payload?.row || {});
    else if (action === 'sync_settings') row = await upsertSettingsRow(auth.user, payload?.row || {});
    else if (action === 'write_progress') row = await writeProgressRow(auth.user, payload?.row || {});
    else if (action === 'record_session') row = await insertSessionRow(auth.user, payload?.row || {});
    else return json(res, 400, { ok: false, error: 'Unsupported durable sync action.' });
    return json(res, 200, { ok: true, action, row, snapshot: await buildSnapshot(req, auth.user) });
  } catch (error) {
    return json(res, 400, { ok: false, error: String(error?.message || error || 'Durable sync failed.') });
  }
}
