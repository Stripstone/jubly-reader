import { json, withCors, readJsonBody } from './http.js';
import { getAllowedBrowserOrigins } from './origins.js';
import { getUserFromAccessToken, supabaseRest } from './supabase.js';

function getBearerToken(req) {
  try {
    const auth = String(req?.headers?.authorization || req?.headers?.Authorization || '').trim();
    const match = auth.match(/^Bearer\s+(.+)$/i);
    return match ? String(match[1] || '').trim() : '';
  } catch (_) {
    return '';
  }
}

async function getAuthorizedUser(req) {
  const token = getBearerToken(req);
  if (!token) return { ok: false, reason: 'missing_auth' };
  const user = await getUserFromAccessToken(token).catch(() => null);
  if (!user || !user.id) return { ok: false, reason: 'invalid_auth' };
  return { ok: true, token, user };
}

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
  const raw = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function normalizeBookId(bookId) {
  return String(bookId || '').trim();
}

function normalizeChapterId(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? String(num) : String(value);
}

function inferAuthProvider(user) {
  const explicit = String(user?.app_metadata?.provider || user?.user_metadata?.provider || '').trim();
  if (explicit) return explicit;
  try {
    const identities = Array.isArray(user?.identities) ? user.identities : [];
    const provider = identities[0] && identities[0].provider ? String(identities[0].provider).trim() : '';
    return provider || 'email';
  } catch (_) {
    return 'email';
  }
}

function deriveDisplayName(user) {
  const explicit = String(user?.displayName || user?.user_metadata?.full_name || user?.user_metadata?.name || '').trim();
  if (explicit) return explicit;
  const email = String(user?.email || '').trim();
  if (!email) return 'Account';
  return email.split('@')[0] || email;
}

async function getUsersRow(userId) {
  const data = await supabaseRest(`/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=id,display_name,email,auth_provider,status,created_at,updated_at&limit=1`, {
    method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function upsertUsersRow(user) {
  const payload = {
    id: user.id,
    display_name: deriveDisplayName(user),
    email: String(user.email || '').trim() || null,
    auth_provider: inferAuthProvider(user),
    status: 'active',
    updated_at: new Date().toISOString(),
  };
  const data = await supabaseRest('/rest/v1/users?on_conflict=id', {
    method: 'POST',
    asService: true,
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: payload,
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : payload;
}

async function getSettingsRow(userId) {
  const data = await supabaseRest(`/rest/v1/user_settings?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`, {
    method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function upsertSettings(userId, patch) {
  const existing = await getSettingsRow(userId).catch(() => null);
  const payload = { ...(existing || {}), user_id: userId, ...(patch || {}), updated_at: new Date().toISOString() };
  const data = await supabaseRest('/rest/v1/user_settings?on_conflict=user_id', {
    method: 'POST', asService: true,
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: payload,
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : payload;
}

async function getProgressRows(userId) {
  const data = await supabaseRest(`/rest/v1/user_progress?user_id=eq.${encodeURIComponent(userId)}&select=*&order=updated_at.desc&limit=100`, {
    method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) ? data : [];
}

async function getRestoreRow(userId, bookId) {
  const normalizedBookId = normalizeBookId(bookId);
  if (!normalizedBookId) return null;
  const data = await supabaseRest(`/rest/v1/user_progress?user_id=eq.${encodeURIComponent(userId)}&book_id=eq.${encodeURIComponent(normalizedBookId)}&is_active=eq.true&select=book_id,last_page_index,updated_at,chapter_id,last_read_at,source_type,source_id,page_count,session_version&order=updated_at.desc&limit=1`, {
    method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function findProgressRow(userId, identity) {
  const rows = await getProgressRows(userId).catch(() => []);
  return (rows || []).find((row) => (
    normalizeBookId(row.book_id) === normalizeBookId(identity.book_id)
    && String(row.source_type || '') === String(identity.source_type || '')
    && String(row.source_id || '') === String(identity.source_id || '')
    && String(normalizeChapterId(row.chapter_id) ?? '') === String(normalizeChapterId(identity.chapter_id) ?? '')
  )) || null;
}

async function upsertProgress(userId, patch) {
  const identity = {
    user_id: userId,
    book_id: normalizeBookId(patch?.book_id || patch?.bookId),
    source_type: toText(patch?.source_type || patch?.sourceType, 'book'),
    source_id: toText(patch?.source_id || patch?.sourceId, normalizeBookId(patch?.book_id || patch?.bookId)),
    chapter_id: normalizeChapterId(patch?.chapter_id ?? patch?.chapterId),
  };
  if (!identity.book_id) throw new Error('book_id is required');
  const existing = await findProgressRow(userId, identity).catch(() => null);
  const payload = {
    ...(existing || {}),
    ...identity,
    page_count: Math.max(0, toInt(patch?.page_count ?? patch?.pageCount, existing?.page_count || 0)),
    last_page_index: Math.max(0, toInt(patch?.last_page_index ?? patch?.pageIndex, existing?.last_page_index || 0)),
    last_read_at: toText(patch?.last_read_at || patch?.lastReadAt, new Date().toISOString()),
    updated_at: new Date().toISOString(),
    is_active: patch?.is_active == null && patch?.isActive == null ? true : toBool(patch?.is_active ?? patch?.isActive, true),
    session_version: Math.max(1, toInt(patch?.session_version ?? patch?.sessionVersion, existing?.session_version || 1)),
  };
  if (existing?.id) {
    const data = await supabaseRest(`/rest/v1/user_progress?id=eq.${encodeURIComponent(existing.id)}&select=*`, {
      method: 'PATCH', asService: true, headers: { Prefer: 'return=representation' }, body: payload,
    }).catch(() => null);
    return Array.isArray(data) && data[0] ? data[0] : { ...existing, ...payload };
  }
  const data = await supabaseRest('/rest/v1/user_progress', {
    method: 'POST', asService: true, headers: { Prefer: 'return=representation' }, body: { user_id: userId, ...payload },
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : { user_id: userId, ...payload };
}

async function getSessionRows(userId) {
  const data = await supabaseRest(`/rest/v1/user_sessions?user_id=eq.${encodeURIComponent(userId)}&select=*&order=ended_at.desc.nullslast,updated_at.desc&limit=500`, {
    method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) ? data : [];
}

async function addSession(userId, patch) {
  const now = new Date();
  const minutesListened = Math.max(0, toInt(patch?.minutes_listened ?? patch?.minutesListened, 0));
  const elapsedSeconds = Math.max(0, toInt(patch?.elapsed_seconds ?? patch?.elapsedSeconds, minutesListened * 60));
  const row = {
    user_id: userId,
    pages_completed: Math.max(0, toInt(patch?.pages_completed ?? patch?.pagesCompleted, 0)),
    minutes_listened: minutesListened,
    source_type: toText(patch?.source_type || patch?.sourceType, 'book'),
    source_id: toText(patch?.source_id || patch?.sourceId, toText(patch?.book_id || patch?.bookId, '')),
    book_id: toText(patch?.book_id || patch?.bookId, ''),
    chapter_id: patch?.chapter_id == null && patch?.chapterId == null ? null : String(patch?.chapter_id ?? patch?.chapterId),
    mode: toText(patch?.mode, 'reading'),
    tts_seconds: Math.max(0, toInt(patch?.tts_seconds ?? patch?.ttsSeconds, 0)),
    completed: toBool(patch?.completed, false),
    started_at: toText(patch?.started_at || patch?.startedAt, new Date(now.getTime() - elapsedSeconds * 1000).toISOString()),
    ended_at: toText(patch?.ended_at || patch?.endedAt, now.toISOString()),
    updated_at: now.toISOString(),
    elapsed_seconds: elapsedSeconds,
  };
  const data = await supabaseRest('/rest/v1/user_sessions', {
    method: 'POST', asService: true, headers: { Prefer: 'return=representation' }, body: row,
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : row;
}

function summarizeSessions(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  let dailySeconds = 0;
  let weeklySeconds = 0;
  let sessionsCompleted = 0;
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - (6 * 24 * 60 * 60 * 1000));
  for (const row of list) {
    const endedAt = row?.ended_at ? new Date(row.ended_at) : null;
    if (!endedAt || Number.isNaN(endedAt.getTime())) continue;
    const seconds = Math.max(0, toInt(row?.elapsed_seconds, Math.max(0, toInt(row?.minutes_listened, 0) * 60)));
    if (endedAt.toISOString().slice(0, 10) === today) dailySeconds += seconds;
    if (endedAt >= sevenDaysAgo) weeklySeconds += seconds;
    sessionsCompleted += 1;
  }
  return {
    rows: list,
    totalSessions: list.length,
    dailyMinutes: Math.round(dailySeconds / 60),
    weeklyMinutes: Math.round(weeklySeconds / 60),
    sessionsCompleted,
    latest: list[0] || null,
  };
}

async function buildSnapshot(user) {
  const [usersRow, settingsRow, progressRows, sessionRows] = await Promise.all([
    getUsersRow(user.id),
    getSettingsRow(user.id),
    getProgressRows(user.id),
    getSessionRows(user.id),
  ]);
  return {
    usersRow,
    settingsRow,
    progressRows,
    sessions: summarizeSessions(sessionRows),
  };
}

function getScope(req) {
  try {
    if (typeof req?.query?.scope === 'string' && req.query.scope.trim()) return req.query.scope.trim().toLowerCase();
  } catch (_) {}
  try {
    const url = new URL(req.url, 'http://localhost');
    return String(url.searchParams.get('scope') || '').trim().toLowerCase();
  } catch (_) { return ''; }
}

function getParam(req, key) {
  try {
    if (req?.query && typeof req.query[key] === 'string' && req.query[key].trim()) return req.query[key].trim();
  } catch (_) {}
  try {
    const url = new URL(req.url, 'http://localhost');
    return String(url.searchParams.get(key) || '').trim();
  } catch (_) { return ''; }
}

export default async function handler(req, res) {
  const allowedOrigins = getAllowedBrowserOrigins();
  if (withCors(req, res, allowedOrigins)) return;

  const auth = await getAuthorizedUser(req);
  if (!auth.ok) {
    const status = auth.reason === 'missing_auth' || auth.reason === 'invalid_auth' ? 401 : 403;
    return json(res, status, { ok: false, reason: auth.reason });
  }

  if (req.method === 'GET') {
    const scope = getScope(req) || 'snapshot';
    if (scope === 'restore') {
      const bookId = getParam(req, 'book_id');
      const row = await getRestoreRow(auth.user.id, bookId).catch(() => null);
      return json(res, 200, { ok: true, row });
    }
    const snapshot = await buildSnapshot(auth.user);
    return json(res, 200, { ok: true, snapshot });
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const action = String(body?.action || '').trim().toLowerCase();
    try {
      let row = null;
      switch (action) {
        case 'sync_user':
          row = await upsertUsersRow(auth.user);
          break;
        case 'sync_settings':
          row = await upsertSettings(auth.user.id, body?.payload || {});
          break;
        case 'write_progress':
          row = await upsertProgress(auth.user.id, body?.payload || {});
          break;
        case 'record_session':
          row = await addSession(auth.user.id, body?.payload || {});
          break;
        default:
          throw new Error('Unsupported sync action.');
      }
      const snapshot = await buildSnapshot(auth.user);
      return json(res, 200, { ok: true, row, snapshot });
    } catch (error) {
      return json(res, 400, { ok: false, error: String(error?.message || error || 'Sync failed.') });
    }
  }

  return json(res, 405, { ok: false, error: 'Method not allowed.' });
}
