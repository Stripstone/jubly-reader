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

function normalizeBookId(bookId) {
  return String(bookId || '').trim();
}

function normalizeChapterId(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? String(num) : String(value);
}

function inferSourceKindFromStorageRef(storageRef, patch = {}) {
  const explicit = toText(patch?.source_kind || patch?.sourceType || patch?.sourceKind, null);
  if (explicit) return explicit;
  const importKind = toText(patch?.import_kind || patch?.importKind, '').toLowerCase();
  const ref = String(storageRef || '');
  if (/^local:text-/i.test(ref) || importKind === 'text') return 'pasted_text';
  if (/^local:/i.test(ref)) return 'upload_file';
  return 'embedded_book';
}

function inferStorageKindFromStorageRef(storageRef, patch = {}) {
  const explicit = toText(patch?.storage_kind || patch?.storageKind, null);
  if (explicit) return explicit;
  return /^local:/i.test(String(storageRef || '').trim()) ? 'device_local' : 'embedded';
}

function inferImportKind(storageRef, patch = {}) {
  const explicit = toText(patch?.import_kind || patch?.importKind, null);
  if (explicit) return explicit;
  const ref = String(storageRef || '');
  if (/^local:text-/i.test(ref)) return 'text';
  if (/^local:/i.test(ref)) return 'epub';
  return 'embedded';
}

const ALLOWED_SETTINGS_FIELDS = [
  'user_id',
  'theme_id',
  'font_id',
  'tts_voice_id',
  'tts_volume',
  'autoplay_enabled',
  'music_enabled',
  'particles_enabled',
  'daily_goal_minutes',
  'created_at',
  'updated_at',
];

function sanitizeSettingsRow(row = null) {
  if (!row || typeof row !== 'object') return null;
  const sanitized = {};
  for (const key of ALLOWED_SETTINGS_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(row, key) && row[key] !== undefined) {
      sanitized[key] = row[key];
    }
  }
  return sanitized;
}

function normalizeVoiceId(value) {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > 128) return null;
  if (/[\x00-\x1f\x7f]/.test(v)) return null;
  return v;
}

function canonicalizeSettingsRow(existing = {}, patch = {}) {
  const current = sanitizeSettingsRow(existing) || {};
  const next = {
    user_id: String(current.user_id || patch.user_id || '').trim(),
    theme_id: toText(patch.theme_id, toText(current.theme_id, 'default')),
    font_id: toText(patch.font_id, toText(current.font_id, 'Lora')),
    tts_voice_id: normalizeVoiceId(patch.tts_voice_id != null ? patch.tts_voice_id : current.tts_voice_id),
    tts_volume: Number.isFinite(Number(patch.tts_volume)) ? Number(patch.tts_volume) : (Number.isFinite(Number(current.tts_volume)) ? Number(current.tts_volume) : 0.50),
    autoplay_enabled: patch.autoplay_enabled == null ? toBool(current.autoplay_enabled, false) : toBool(patch.autoplay_enabled, false),
    music_enabled: patch.music_enabled == null ? toBool(current.music_enabled, true) : toBool(patch.music_enabled, true),
    particles_enabled: patch.particles_enabled == null ? toBool(current.particles_enabled, true) : toBool(patch.particles_enabled, true),
    daily_goal_minutes: Math.max(5, Math.min(300, toInt(patch.daily_goal_minutes, toInt(current.daily_goal_minutes, 15)))),
    updated_at: new Date().toISOString(),
  };
  if (current.created_at) next.created_at = current.created_at;
  return next;
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
  return sanitizeSettingsRow(Array.isArray(data) && data[0] ? data[0] : null);
}

async function upsertSettings(userId, patch) {
  const existing = await getSettingsRow(userId).catch(() => null);
  const payload = canonicalizeSettingsRow(existing || {}, Object.assign({}, patch || {}, { user_id: userId }));
  const data = await supabaseRest('/rest/v1/user_settings?on_conflict=user_id', {
    method: 'POST', asService: true, headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: payload,
  }).catch(() => null);
  return sanitizeSettingsRow(Array.isArray(data) && data[0] ? data[0] : payload);
}

async function clearSettings(userId) {
  await supabaseRest(`/rest/v1/user_settings?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'DELETE', asService: true,
  }).catch(() => null);
}

async function getLibraryItemsRows(userId, { includeDeleted = true, limit = 200 } = {}) {
  const filters = [`user_id=eq.${encodeURIComponent(userId)}`];
  if (!includeDeleted) filters.push('status=eq.active');
  const data = await supabaseRest(`/rest/v1/user_library_items?${filters.join('&')}&select=*&order=updated_at.desc&limit=${Math.max(1, toInt(limit, 200))}`, {
    method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) ? data : [];
}

async function findLibraryItemByStorageRef(userId, storageRef, { includeDeleted = true } = {}) {
  const ref = normalizeBookId(storageRef);
  if (!ref) return null;
  const filters = [`user_id=eq.${encodeURIComponent(userId)}`, `storage_ref=eq.${encodeURIComponent(ref)}`];
  if (!includeDeleted) filters.push('status=eq.active');
  const data = await supabaseRest(`/rest/v1/user_library_items?${filters.join('&')}&select=*&order=updated_at.desc&limit=20`, {
    method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  const rows = Array.isArray(data) ? data : [];
  const active = rows.find((row) => String(row?.status || '') === 'active');
  return active || rows[0] || null;
}

async function ensureLibraryItem(userId, patch = {}) {
  const storageRef = normalizeBookId(patch?.storage_ref || patch?.storageRef || patch?.book_id || patch?.bookId);
  if (!storageRef) throw new Error('storage_ref is required');
  const existing = await findLibraryItemByStorageRef(userId, storageRef, { includeDeleted: true }).catch(() => null);
  const payload = {
    user_id: userId,
    title: toText(patch?.title, toText(existing?.title, storageRef || 'Book')),
    source_kind: inferSourceKindFromStorageRef(storageRef, patch),
    source_name: toText(patch?.source_name || patch?.sourceName, toText(existing?.source_name, null)),
    content_fingerprint: toText(patch?.content_fingerprint || patch?.contentFingerprint, toText(existing?.content_fingerprint, null)),
    storage_kind: inferStorageKindFromStorageRef(storageRef, patch),
    storage_ref: storageRef,
    import_kind: inferImportKind(storageRef, patch),
    byte_size: Math.max(0, toInt(patch?.byte_size ?? patch?.byteSize, toInt(existing?.byte_size, 0))),
    page_count: Math.max(0, toInt(patch?.page_count ?? patch?.pageCount, toInt(existing?.page_count, 0))),
    status: 'active',
    deleted_at: null,
    purge_after: null,
    updated_at: new Date().toISOString(),
  };
  if (existing?.id) {
    const data = await supabaseRest(`/rest/v1/user_library_items?id=eq.${encodeURIComponent(existing.id)}&select=*`, {
      method: 'PATCH', asService: true, headers: { Prefer: 'return=representation' }, body: payload,
    }).catch(() => null);
    return Array.isArray(data) && data[0] ? data[0] : { ...existing, ...payload };
  }
  const data = await supabaseRest('/rest/v1/user_library_items', {
    method: 'POST', asService: true, headers: { Prefer: 'return=representation' }, body: payload,
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : payload;
}

async function getProgressRowsRaw(userId) {
  const data = await supabaseRest(`/rest/v1/user_progress?user_id=eq.${encodeURIComponent(userId)}&select=*&order=updated_at.desc,last_read_at.desc.nullslast&limit=50`, {
    method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) ? data : [];
}

async function getProgressRowByLibraryItemId(libraryItemId) {
  const id = String(libraryItemId || '').trim();
  if (!id) return null;
  const data = await supabaseRest(`/rest/v1/user_progress?library_item_id=eq.${encodeURIComponent(id)}&select=*&limit=1`, {
    method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

function serializeLibraryItemRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title || 'Book',
    source_kind: row.source_kind || null,
    source_name: row.source_name || null,
    content_fingerprint: row.content_fingerprint || null,
    storage_kind: row.storage_kind || null,
    storage_ref: row.storage_ref || null,
    import_kind: row.import_kind || null,
    byte_size: Math.max(0, toInt(row.byte_size, 0)),
    page_count: Math.max(0, toInt(row.page_count, 0)),
    status: row.status || 'active',
    deleted_at: row.deleted_at || null,
    purge_after: row.purge_after || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function serializeProgressRow(row, libraryItemsMap) {
  if (!row) return null;
  const item = libraryItemsMap && row.library_item_id ? libraryItemsMap.get(String(row.library_item_id)) : null;
  return {
    library_item_id: row.library_item_id,
    user_id: row.user_id,
    book_id: item?.storage_ref || null,
    source_id: item?.storage_ref || null,
    source_type: 'book',
    source_kind: item?.source_kind || null,
    chapter_id: row.current_chapter_id || null,
    page_count: Math.max(0, toInt(row.page_count, 0)),
    last_page_index: Math.max(0, toInt(row.current_page_index, 0)),
    last_read_at: row.last_read_at || null,
    session_version: Math.max(0, toInt(row.session_version, 1)),
    updated_at: row.updated_at || row.last_read_at || null,
    item_status: item?.status || 'active',
    title: item?.title || null,
  };
}

async function getBookMetricsRowsRaw(userId) {
  const data = await supabaseRest(`/rest/v1/user_book_metrics?user_id=eq.${encodeURIComponent(userId)}&select=*&order=updated_at.desc,last_opened_at.desc.nullslast&limit=50`, {
    method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) ? data : [];
}

async function getBookMetricByLibraryItemId(libraryItemId) {
  const id = String(libraryItemId || '').trim();
  if (!id) return null;
  const data = await supabaseRest(`/rest/v1/user_book_metrics?library_item_id=eq.${encodeURIComponent(id)}&select=*&limit=1`, {
    method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

function serializeBookMetricRow(row, libraryItemsMap) {
  if (!row) return null;
  const item = libraryItemsMap && row.library_item_id ? libraryItemsMap.get(String(row.library_item_id)) : null;
  return {
    library_item_id: row.library_item_id,
    user_id: row.user_id,
    book_id: item?.storage_ref || null,
    title: item?.title || null,
    minutes_read_total: Math.max(0, toInt(row.minutes_read_total, 0)),
    pages_completed_total: Math.max(0, toInt(row.pages_completed_total, 0)),
    first_opened_at: row.first_opened_at || null,
    last_opened_at: row.last_opened_at || null,
    completed_at: row.completed_at || null,
    completion_count: Math.max(0, toInt(row.completion_count, 0)),
    updated_at: row.updated_at || null,
  };
}

async function getDailyStatsRows(userId, { limit = 60 } = {}) {
  const data = await supabaseRest(`/rest/v1/user_daily_stats?user_id=eq.${encodeURIComponent(userId)}&select=*&order=stat_date.desc&limit=${Math.max(1, toInt(limit, 60))}`, {
    method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) ? data : [];
}

async function getDailyStatRow(userId, statDate) {
  const dateText = toText(statDate, null);
  if (!dateText) return null;
  const data = await supabaseRest(`/rest/v1/user_daily_stats?user_id=eq.${encodeURIComponent(userId)}&stat_date=eq.${encodeURIComponent(dateText)}&select=*&limit=1`, {
    method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

function serializeDailyStatRow(row) {
  if (!row) return null;
  return {
    user_id: row.user_id,
    stat_date: row.stat_date,
    minutes_read: Math.max(0, toInt(row.minutes_read, 0)),
    pages_read: Math.max(0, toInt(row.pages_read, 0)),
    sessions_count: Math.max(0, toInt(row.sessions_count, 0)),
    updated_at: row.updated_at || null,
  };
}

async function setProgress(userId, payload = {}) {
  const libraryItem = await ensureLibraryItem(userId, payload);
  const existing = await getProgressRowByLibraryItemId(libraryItem.id).catch(() => null);
  const base = {
    library_item_id: libraryItem.id,
    user_id: userId,
    current_chapter_id: normalizeChapterId(payload?.chapter_id ?? payload?.chapterId),
    current_page_index: Math.max(0, toInt(payload?.last_page_index ?? payload?.pageIndex, toInt(existing?.current_page_index, 0))),
    page_count: Math.max(0, toInt(payload?.page_count ?? payload?.pageCount, toInt(existing?.page_count, libraryItem.page_count || 0))),
    last_read_at: new Date().toISOString(),
    session_version: Math.max(1, toInt(payload?.session_version ?? payload?.sessionVersion, toInt(existing?.session_version, 1))),
    updated_at: new Date().toISOString(),
  };
  if (existing?.library_item_id) {
    const data = await supabaseRest(`/rest/v1/user_progress?library_item_id=eq.${encodeURIComponent(existing.library_item_id)}&select=*`, {
      method: 'PATCH', asService: true, headers: { Prefer: 'return=representation' }, body: base,
    }).catch(() => null);
    return Array.isArray(data) && data[0] ? data[0] : { ...existing, ...base };
  }
  const data = await supabaseRest('/rest/v1/user_progress', {
    method: 'POST', asService: true, headers: { Prefer: 'return=representation' }, body: base,
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : base;
}

async function clearProgress(userId, payload = {}) {
  const storageRef = normalizeBookId(payload?.book_id || payload?.bookId || payload?.storage_ref || payload?.storageRef);
  if (!storageRef) {
    await supabaseRest(`/rest/v1/user_progress?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE', asService: true }).catch(() => null);
    return;
  }
  const item = await findLibraryItemByStorageRef(userId, storageRef, { includeDeleted: true }).catch(() => null);
  if (!item?.id) return;
  await supabaseRest(`/rest/v1/user_progress?library_item_id=eq.${encodeURIComponent(item.id)}`, {
    method: 'DELETE', asService: true,
  }).catch(() => null);
}

async function upsertBookMetricsForSession(userId, libraryItem, payload = {}) {
  const existing = await getBookMetricByLibraryItemId(libraryItem.id).catch(() => null);
  const nowIso = toText(payload?.ended_at || payload?.endedAt, new Date().toISOString());
  const startedAt = toText(payload?.started_at || payload?.startedAt, nowIso);
  const completed = toBool(payload?.completed, false);
  const row = {
    library_item_id: libraryItem.id,
    user_id: userId,
    minutes_read_total: Math.max(0, toInt(existing?.minutes_read_total, 0) + Math.max(0, toInt(payload?.minutes_listened ?? payload?.minutesListened, 0))),
    pages_completed_total: Math.max(0, toInt(existing?.pages_completed_total, 0) + Math.max(0, toInt(payload?.pages_completed ?? payload?.pagesCompleted, 0))),
    first_opened_at: toText(existing?.first_opened_at, startedAt),
    last_opened_at: nowIso,
    completed_at: completed ? toText(existing?.completed_at, nowIso) : (existing?.completed_at || null),
    completion_count: Math.max(0, toInt(existing?.completion_count, 0) + (completed ? 1 : 0)),
    updated_at: new Date().toISOString(),
  };
  if (existing?.library_item_id) {
    const data = await supabaseRest(`/rest/v1/user_book_metrics?library_item_id=eq.${encodeURIComponent(existing.library_item_id)}&select=*`, {
      method: 'PATCH', asService: true, headers: { Prefer: 'return=representation' }, body: row,
    }).catch(() => null);
    return Array.isArray(data) && data[0] ? data[0] : { ...existing, ...row };
  }
  const data = await supabaseRest('/rest/v1/user_book_metrics', {
    method: 'POST', asService: true, headers: { Prefer: 'return=representation' }, body: row,
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : row;
}

async function upsertDailyStatsForSession(userId, payload = {}) {
  const endedAtIso = toText(payload?.ended_at || payload?.endedAt, new Date().toISOString());
  const endedAt = new Date(endedAtIso);
  const statDate = Number.isNaN(endedAt.getTime()) ? new Date().toISOString().slice(0, 10) : endedAt.toISOString().slice(0, 10);
  const existing = await getDailyStatRow(userId, statDate).catch(() => null);
  const row = {
    user_id: userId,
    stat_date: statDate,
    minutes_read: Math.max(0, toInt(existing?.minutes_read, 0) + Math.max(0, toInt(payload?.minutes_listened ?? payload?.minutesListened, 0))),
    pages_read: Math.max(0, toInt(existing?.pages_read, 0) + Math.max(0, toInt(payload?.pages_completed ?? payload?.pagesCompleted, 0))),
    sessions_count: Math.max(0, toInt(existing?.sessions_count, 0) + 1),
    updated_at: new Date().toISOString(),
  };
  if (existing?.user_id) {
    const data = await supabaseRest(`/rest/v1/user_daily_stats?user_id=eq.${encodeURIComponent(userId)}&stat_date=eq.${encodeURIComponent(statDate)}&select=*`, {
      method: 'PATCH', asService: true, headers: { Prefer: 'return=representation' }, body: row,
    }).catch(() => null);
    return Array.isArray(data) && data[0] ? data[0] : { ...existing, ...row };
  }
  const data = await supabaseRest('/rest/v1/user_daily_stats', {
    method: 'POST', asService: true, headers: { Prefer: 'return=representation' }, body: row,
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : row;
}

async function addSession(userId, payload = {}) {
  const libraryItem = await ensureLibraryItem(userId, payload);
  await Promise.all([
    upsertBookMetricsForSession(userId, libraryItem, payload),
    upsertDailyStatsForSession(userId, payload),
  ]);
}

async function resetSessions(userId) {
  await supabaseRest(`/rest/v1/user_book_metrics?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'DELETE', asService: true,
  }).catch(() => null);
  await supabaseRest(`/rest/v1/user_daily_stats?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'DELETE', asService: true,
  }).catch(() => null);
}

function summarizeSessions(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = new Date();
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const weekStartIso = weekStart.toISOString().slice(0, 10);
  let minutesListened = 0;
  let pagesCompleted = 0;
  let totalSessions = 0;
  let completedCount = 0;
  for (const row of list) {
    const statDate = String(row?.stat_date || '');
    const count = Math.max(0, toInt(row?.sessions_count, 0));
    const minutes = Math.max(0, toInt(row?.minutes_read, 0));
    const pages = Math.max(0, toInt(row?.pages_read, 0));
    if (statDate && statDate >= weekStartIso) {
      minutesListened += minutes;
      pagesCompleted += pages;
    }
    totalSessions += count;
    completedCount += count;
  }
  return {
    totalSessions,
    minutesListened,
    pagesCompleted,
    completedCount,
    latest: null,
    todayMinutes: list.find((row) => String(row?.stat_date || '') === today)?.minutes_read || 0,
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
  const [usersRow, settingsRow, entitlementRow, usageRow, libraryItemsRaw, progressRowsRaw, bookMetricsRaw, dailyStatsRowsRaw, resolved] = await Promise.all([
    getUsersRow(user.id),
    getSettingsRow(user.id),
    getActiveEntitlement(user.id),
    getUsageRow(user.id),
    getLibraryItemsRows(user.id, { includeDeleted: true, limit: 200 }),
    getProgressRowsRaw(user.id),
    getBookMetricsRowsRaw(user.id),
    getDailyStatsRows(user.id, { limit: 60 }),
    getResolvedRuntimePolicyForRequest(req),
  ]);

  const libraryItems = (libraryItemsRaw || []).map(serializeLibraryItemRow).filter(Boolean);
  const libraryItemMap = new Map((libraryItemsRaw || []).map((row) => [String(row.id), row]));
  const progressRows = (progressRowsRaw || []).map((row) => serializeProgressRow(row, libraryItemMap)).filter(Boolean);
  const activeProgressRows = (progressRows || []).filter((row) => row && row.item_status !== 'deleted');
  const latestProgress = activeProgressRows[0] || progressRows[0] || null;
  const bookMetricsRows = (bookMetricsRaw || []).map((row) => serializeBookMetricRow(row, libraryItemMap)).filter(Boolean);
  const dailyStatsRows = (dailyStatsRowsRaw || []).map(serializeDailyStatRow).filter(Boolean);
  const sessions = summarizeSessions(dailyStatsRows);
  return {
    usersRow,
    settingsRow,
    entitlementRow,
    usage: computeUsageSummary(usageRow, resolved?.policy?.usageDailyLimit),
    libraryItems,
    progressRows,
    bookMetricsRows,
    dailyStatsRows,
    progress: {
      latest: latestProgress,
      rows: progressRows,
      activeRows: activeProgressRows,
    },
    sessions,
    policy: resolved?.policy || null,
    policyMeta: {
      effectiveTier: resolved?.effectiveTier || 'basic',
      resolutionMode: resolved?.resolutionMode || 'production',
    },
  };
}

async function setPlan(userId, payload) {
  const tierInput = String(payload?.tier || 'basic').trim().toLowerCase();
  const tier = tierInput === 'free' ? 'basic' : tierInput === 'paid' ? 'pro' : tierInput;
  const status = toText(payload?.status, 'active');
  const existing = await getActiveEntitlement(userId).catch(() => null);
  return upsertEntitlement({
    ...(existing || {}),
    user_id: userId,
    provider: toText(payload?.provider, existing?.provider || 'system'),
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
