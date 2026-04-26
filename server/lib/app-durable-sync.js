import { json, withCors, readJsonBody } from './http.js';
import { getAllowedBrowserOrigins } from './origins.js';
import { resolveImportCapacity } from './app-import-capacity.js';
import { getResolvedRuntimePolicyForRequest } from './runtime-policy.js';
import { getUserFromAccessToken, getUsageRow, supabaseRest, upsertUsageRow } from './supabase.js';

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

function getUtcWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function inferSourceKindFromStorageRef(storageRef, patch = {}) {
  const explicit = toText(patch?.source_kind || patch?.sourceKind, null);
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
  const ref = String(storageRef || '');
  if (/^local:/i.test(ref)) return 'device_local';
  return 'embedded';
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
  if (!next.user_id) delete next.user_id;
  return next;
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
  return sanitizeSettingsRow(Array.isArray(data) && data[0] ? data[0] : null);
}

async function upsertSettings(userId, patch) {
  const existing = await getSettingsRow(userId).catch(() => null);
  const payload = canonicalizeSettingsRow(existing || {}, Object.assign({}, patch || {}, { user_id: userId }));
  const data = await supabaseRest('/rest/v1/user_settings?on_conflict=user_id', {
    method: 'POST', asService: true,
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: payload,
  }).catch(() => null);
  return sanitizeSettingsRow(Array.isArray(data) && data[0] ? data[0] : payload);
}

async function getLibraryItemsRows(userId, { includeDeleted = true, limit = 500 } = {}) {
  const filters = [`user_id=eq.${encodeURIComponent(userId)}`];
  if (!includeDeleted) filters.push('status=eq.active');
  const data = await supabaseRest(`/rest/v1/user_library_items?${filters.join('&')}&select=*&order=updated_at.desc&limit=${Math.max(1, toInt(limit, 500))}`, {
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

async function findLibraryItemById(userId, libraryItemId) {
  const id = String(libraryItemId || '').trim();
  if (!id) return null;
  const data = await supabaseRest(`/rest/v1/user_library_items?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`, {
    method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : null;
}




function normalizeContentFingerprint(value) {
  return toText(value, null);
}

function getPatchContentFingerprint(patch = {}) {
  return normalizeContentFingerprint(patch?.content_fingerprint || patch?.contentFingerprint || patch?.fingerprint || null);
}

function getPatchLibraryItemId(patch = {}) {
  return toText(patch?.library_item_id || patch?.libraryItemId || patch?.id, null);
}

function compareCanonicalLibraryRows(a, b) {
  const updatedA = Date.parse(a?.updated_at || '') || 0;
  const updatedB = Date.parse(b?.updated_at || '') || 0;
  if (updatedA !== updatedB) return updatedB - updatedA;
  const createdA = Date.parse(a?.created_at || '') || 0;
  const createdB = Date.parse(b?.created_at || '') || 0;
  if (createdA !== createdB) return createdB - createdA;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

function pickCanonicalLibraryRow(rows = [], { preferActive = true } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean).slice();
  if (!list.length) return null;
  if (preferActive) {
    const active = list.filter((row) => String(row?.status || '').trim().toLowerCase() === 'active');
    if (active.length) return active.sort(compareCanonicalLibraryRows)[0] || null;
  }
  return list.sort(compareCanonicalLibraryRows)[0] || null;
}

async function findLibraryItemsByContentFingerprint(userId, fingerprint) {
  const fp = normalizeContentFingerprint(fingerprint);
  if (!fp) return [];
  const data = await supabaseRest(`/rest/v1/user_library_items?user_id=eq.${encodeURIComponent(userId)}&content_fingerprint=eq.${encodeURIComponent(fp)}&select=*&order=updated_at.desc&limit=100`, {
    method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  return Array.isArray(data) ? data : [];
}

async function resolveLibraryIdentityGroup(userId, storageRef, patch = {}, { includeDeleted = true } = {}) {
  const rows = [];
  const seen = new Set();
  const addRows = (incoming) => {
    (Array.isArray(incoming) ? incoming : []).forEach((row) => {
      const id = String(row?.id || '').trim();
      if (!id || seen.has(id)) return;
      const status = String(row?.status || '').trim().toLowerCase();
      if (!includeDeleted && status !== 'active') return;
      seen.add(id);
      rows.push(row);
    });
  };

  const fingerprint = getPatchContentFingerprint(patch);
  if (fingerprint) addRows(await findLibraryItemsByContentFingerprint(userId, fingerprint));

  const ref = normalizeBookId(storageRef || patch?.storage_ref || patch?.storageRef || patch?.book_id || patch?.bookId);
  if (!rows.length && ref) {
    const byRef = await supabaseRest(`/rest/v1/user_library_items?user_id=eq.${encodeURIComponent(userId)}&storage_ref=eq.${encodeURIComponent(ref)}&select=*&order=updated_at.desc&limit=100`, {
      method: 'GET', asService: true, headers: { Prefer: 'count=exact' },
    }).catch(() => null);
    addRows(Array.isArray(byRef) ? byRef : []);
  }

  const explicitId = getPatchLibraryItemId(patch);
  if (!rows.length && explicitId) {
    const byId = await findLibraryItemById(userId, explicitId).catch(() => null);
    addRows(byId ? [byId] : []);
  }

  return rows.sort(compareCanonicalLibraryRows);
}

async function patchLibraryItemById(userId, id, payload) {
  const data = await supabaseRest(`/rest/v1/user_library_items?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&select=*`, {
    method: 'PATCH', asService: true, headers: { Prefer: 'return=representation' }, body: payload,
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function deleteLibraryItemRowById(userId, id) {
  await supabaseRest(`/rest/v1/user_library_items?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'DELETE', asService: true,
  }).catch(() => null);
}

function buildImportCapacityError(result) {
  const body = result?.body || {
    ok: false,
    allowed: false,
    reason: 'server_error',
    count: null,
    limit: null,
    source: 'server-durable',
    stage: 'final-write',
  };
  const error = new Error(String(body.reason || 'import_capacity_blocked'));
  error.importCapacityStatus = result?.status || (body.reason === 'library_full' ? 200 : 500);
  error.importCapacityBody = body;
  return error;
}

async function assertActiveLibrarySlotAvailable(req, userId, { stage = 'final-write' } = {}) {
  const result = await resolveImportCapacity(req, { stage, user: { id: userId } });
  if (!result?.body?.allowed) throw buildImportCapacityError(result);
  return result.body;
}

async function ensureLibraryItem(userId, patch = {}, options = {}) {
  const storageRef = normalizeBookId(patch?.storage_ref || patch?.storageRef || patch?.book_id || patch?.bookId);
  if (!storageRef) throw new Error('storage_ref is required');
  const identityRows = await resolveLibraryIdentityGroup(userId, storageRef, patch, { includeDeleted: true }).catch(() => []);
  const existing = pickCanonicalLibraryRow(identityRows, { preferActive: true });
  const existingStatus = String(existing?.status || '').trim().toLowerCase();
  const wouldConsumeActiveSlot = !existing?.id || existingStatus !== 'active';
  if (wouldConsumeActiveSlot) {
    await assertActiveLibrarySlotAvailable(options?.req, userId, { stage: options?.stage || 'final-write' });
  }
  const status = 'active';
  const titleFallback = inferSourceKindFromStorageRef(storageRef, patch) === 'embedded_book' ? (storageRef || 'Book') : (patch?.source_name || storageRef || 'Book');
  const payload = {
    user_id: userId,
    title: toText(patch?.title, toText(existing?.title, titleFallback)),
    source_kind: inferSourceKindFromStorageRef(storageRef, patch),
    source_name: toText(patch?.source_name || patch?.sourceName, toText(existing?.source_name, null)),
    content_fingerprint: getPatchContentFingerprint(patch) || toText(existing?.content_fingerprint, null),
    storage_kind: inferStorageKindFromStorageRef(storageRef, patch),
    storage_ref: storageRef,
    import_kind: inferImportKind(storageRef, patch),
    byte_size: Math.max(0, toInt(patch?.byte_size ?? patch?.byteSize, toInt(existing?.byte_size, 0))),
    page_count: Math.max(0, toInt(patch?.page_count ?? patch?.pageCount, toInt(existing?.page_count, 0))),
    status,
    deleted_at: null,
    purge_after: null,
    updated_at: new Date().toISOString(),
  };
  if (existing?.id) {
    return await patchLibraryItemById(userId, existing.id, payload) || { ...existing, ...payload };
  }
  const data = await supabaseRest('/rest/v1/user_library_items', {
    method: 'POST', asService: true, headers: { Prefer: 'return=representation' }, body: payload,
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : payload;
}
async function getProgressRowsRaw(userId) {
  const data = await supabaseRest(`/rest/v1/user_progress?user_id=eq.${encodeURIComponent(userId)}&select=*&order=updated_at.desc,last_read_at.desc.nullslast&limit=500`, {
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
    title: item?.title || null,
    source_name: item?.source_name || null,
    content_fingerprint: item?.content_fingerprint || null,
    storage_kind: item?.storage_kind || null,
    import_kind: item?.import_kind || null,
    item_status: item?.status || 'active',
    item_deleted_at: item?.deleted_at || null,
  };
}

async function getBookMetricsRowsRaw(userId) {
  const data = await supabaseRest(`/rest/v1/user_book_metrics?user_id=eq.${encodeURIComponent(userId)}&select=*&order=updated_at.desc,last_opened_at.desc.nullslast&limit=500`, {
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
    source_type: item?.source_kind || 'book',
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

async function getDailyStatsRows(userId, { limit = 120 } = {}) {
  const data = await supabaseRest(`/rest/v1/user_daily_stats?user_id=eq.${encodeURIComponent(userId)}&select=*&order=stat_date.desc&limit=${Math.max(1, toInt(limit, 120))}`, {
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

async function upsertProgress(userId, patch = {}, options = {}) {
  const libraryItem = await ensureLibraryItem(userId, patch, options);
  const existing = await getProgressRowByLibraryItemId(libraryItem.id).catch(() => null);
  const payload = {
    library_item_id: libraryItem.id,
    user_id: userId,
    current_chapter_id: normalizeChapterId(patch?.chapter_id ?? patch?.chapterId),
    current_page_index: Math.max(0, toInt(patch?.last_page_index ?? patch?.pageIndex, toInt(existing?.current_page_index, 0))),
    page_count: Math.max(0, toInt(patch?.page_count ?? patch?.pageCount, toInt(existing?.page_count, libraryItem.page_count || 0))),
    last_read_at: toText(patch?.last_read_at || patch?.lastReadAt, new Date().toISOString()),
    session_version: Math.max(1, toInt(patch?.session_version ?? patch?.sessionVersion, toInt(existing?.session_version, 1))),
    updated_at: new Date().toISOString(),
  };
  if (existing?.library_item_id) {
    const data = await supabaseRest(`/rest/v1/user_progress?library_item_id=eq.${encodeURIComponent(existing.library_item_id)}&select=*`, {
      method: 'PATCH', asService: true, headers: { Prefer: 'return=representation' }, body: payload,
    }).catch(() => null);
    return Array.isArray(data) && data[0] ? serializeProgressRow(data[0], new Map([[String(libraryItem.id), libraryItem]])) : serializeProgressRow({ ...existing, ...payload }, new Map([[String(libraryItem.id), libraryItem]]));
  }
  const data = await supabaseRest('/rest/v1/user_progress', {
    method: 'POST', asService: true, headers: { Prefer: 'return=representation' }, body: payload,
  }).catch(() => null);
  const row = Array.isArray(data) && data[0] ? data[0] : payload;
  return serializeProgressRow(row, new Map([[String(libraryItem.id), libraryItem]]));
}

async function deleteProgressForLibraryItem(libraryItemId) {
  const id = String(libraryItemId || '').trim();
  if (!id) return;
  await supabaseRest(`/rest/v1/user_progress?library_item_id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE', asService: true,
  }).catch(() => null);
}


async function deleteBookMetricsForLibraryItem(libraryItemId) {
  const id = String(libraryItemId || '').trim();
  if (!id) return;
  await supabaseRest(`/rest/v1/user_book_metrics?library_item_id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE', asService: true,
  }).catch(() => null);
}

async function getRestoreRow(userId, storageRef) {
  const item = await findLibraryItemByStorageRef(userId, storageRef, { includeDeleted: false }).catch(() => null);
  if (!item || String(item.status || '') !== 'active') return null;
  const row = await getProgressRowByLibraryItemId(item.id).catch(() => null);
  if (!row) return null;
  return serializeProgressRow(row, new Map([[String(item.id), item]]));
}

async function upsertBookMetricsForSession(userId, libraryItem, patch = {}) {
  const existing = await getBookMetricByLibraryItemId(libraryItem.id).catch(() => null);
  const nowIso = toText(patch?.ended_at || patch?.endedAt, new Date().toISOString());
  const startedAt = toText(patch?.started_at || patch?.startedAt, nowIso);
  const completed = toBool(patch?.completed, false);
  const payload = {
    library_item_id: libraryItem.id,
    user_id: userId,
    minutes_read_total: Math.max(0, toInt(existing?.minutes_read_total, 0) + Math.max(0, toInt(patch?.minutes_listened ?? patch?.minutesListened, 0))),
    pages_completed_total: Math.max(0, toInt(existing?.pages_completed_total, 0) + Math.max(0, toInt(patch?.pages_completed ?? patch?.pagesCompleted, 0))),
    first_opened_at: toText(existing?.first_opened_at, startedAt),
    last_opened_at: nowIso,
    completed_at: completed ? toText(existing?.completed_at, nowIso) : (existing?.completed_at || null),
    completion_count: Math.max(0, toInt(existing?.completion_count, 0) + (completed ? 1 : 0)),
    updated_at: new Date().toISOString(),
  };
  if (existing?.library_item_id) {
    const data = await supabaseRest(`/rest/v1/user_book_metrics?library_item_id=eq.${encodeURIComponent(existing.library_item_id)}&select=*`, {
      method: 'PATCH', asService: true, headers: { Prefer: 'return=representation' }, body: payload,
    }).catch(() => null);
    return Array.isArray(data) && data[0] ? data[0] : { ...existing, ...payload };
  }
  const data = await supabaseRest('/rest/v1/user_book_metrics', {
    method: 'POST', asService: true, headers: { Prefer: 'return=representation' }, body: payload,
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : payload;
}

async function upsertDailyStatsForSession(userId, patch = {}) {
  const endedAtIso = toText(patch?.ended_at || patch?.endedAt, new Date().toISOString());
  const endedAt = new Date(endedAtIso);
  const statDate = Number.isNaN(endedAt.getTime()) ? new Date().toISOString().slice(0, 10) : endedAt.toISOString().slice(0, 10);
  const existing = await getDailyStatRow(userId, statDate).catch(() => null);
  const payload = {
    user_id: userId,
    stat_date: statDate,
    minutes_read: Math.max(0, toInt(existing?.minutes_read, 0) + Math.max(0, toInt(patch?.minutes_listened ?? patch?.minutesListened, 0))),
    pages_read: Math.max(0, toInt(existing?.pages_read, 0) + Math.max(0, toInt(patch?.pages_completed ?? patch?.pagesCompleted, 0))),
    sessions_count: Math.max(0, toInt(existing?.sessions_count, 0) + 1),
    updated_at: new Date().toISOString(),
  };
  if (existing?.user_id) {
    const data = await supabaseRest(`/rest/v1/user_daily_stats?user_id=eq.${encodeURIComponent(userId)}&stat_date=eq.${encodeURIComponent(statDate)}&select=*`, {
      method: 'PATCH', asService: true, headers: { Prefer: 'return=representation' }, body: payload,
    }).catch(() => null);
    return Array.isArray(data) && data[0] ? data[0] : { ...existing, ...payload };
  }
  const data = await supabaseRest('/rest/v1/user_daily_stats', {
    method: 'POST', asService: true, headers: { Prefer: 'return=representation' }, body: payload,
  }).catch(() => null);
  return Array.isArray(data) && data[0] ? data[0] : payload;
}

async function addSession(userId, patch = {}, options = {}) {
  const libraryItem = await ensureLibraryItem(userId, patch, options);
  await Promise.all([
    upsertBookMetricsForSession(userId, libraryItem, patch),
    upsertDailyStatsForSession(userId, patch),
  ]);
  return {
    library_item_id: libraryItem.id,
    book_id: libraryItem.storage_ref,
    title: libraryItem.title,
    minutes_listened: Math.max(0, toInt(patch?.minutes_listened ?? patch?.minutesListened, 0)),
    pages_completed: Math.max(0, toInt(patch?.pages_completed ?? patch?.pagesCompleted, 0)),
    completed: toBool(patch?.completed, false),
    ended_at: toText(patch?.ended_at || patch?.endedAt, new Date().toISOString()),
  };
}

async function setLibraryItemStatus(userId, storageRef, nextStatus, options = {}) {
  const rows = await resolveLibraryIdentityGroup(userId, storageRef, options, { includeDeleted: true }).catch(() => []);
  if (!rows.length) return null;

  const now = new Date();
  const normalizedStatus = String(nextStatus || '').trim().toLowerCase();

  if (normalizedStatus === 'purge') {
    const deletedRows = rows.filter((row) => String(row?.status || '').trim().toLowerCase() === 'deleted');
    if (!deletedRows.length) return null;
    await Promise.all(deletedRows.map((row) => Promise.all([
      deleteProgressForLibraryItem(row.id).catch(() => null),
      deleteBookMetricsForLibraryItem(row.id).catch(() => null),
    ])));
    await Promise.all(deletedRows.map((row) => deleteLibraryItemRowById(userId, row.id)));
    const canonical = pickCanonicalLibraryRow(deletedRows, { preferActive: false });
    return { id: canonical?.id || null, storage_ref: canonical?.storage_ref || storageRef || null, status: 'purged', affected: deletedRows.length };
  }

  if (normalizedStatus === 'deleted') {
    const activeRows = rows.filter((row) => String(row?.status || '').trim().toLowerCase() === 'active');
    if (!activeRows.length) return null;
    await Promise.all(activeRows.map((row) => deleteProgressForLibraryItem(row.id).catch(() => null)));
    const payload = {
      status: 'deleted',
      deleted_at: now.toISOString(),
      purge_after: new Date(now.getTime() + Math.max(1, toInt(options.purgeAfterDays, 30)) * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: now.toISOString(),
    };
    const patched = [];
    for (const row of activeRows) {
      const updated = await patchLibraryItemById(userId, row.id, payload);
      patched.push(updated || { ...row, ...payload });
    }
    return { ...(pickCanonicalLibraryRow(patched, { preferActive: false }) || patched[0]), status: 'deleted', affected: patched.length };
  }

  if (normalizedStatus === 'active') {
    const activeExisting = rows.filter((row) => String(row?.status || '').trim().toLowerCase() === 'active');
    if (activeExisting.length) return pickCanonicalLibraryRow(activeExisting, { preferActive: true });
    const deletedRows = rows.filter((row) => String(row?.status || '').trim().toLowerCase() === 'deleted');
    const item = pickCanonicalLibraryRow(deletedRows, { preferActive: false });
    if (!item) return null;
    await assertActiveLibrarySlotAvailable(options?.req, userId, { stage: options?.stage || 'final-write' });
    const payload = {
      status: 'active',
      deleted_at: null,
      purge_after: null,
      updated_at: now.toISOString(),
    };
    return await patchLibraryItemById(userId, item.id, payload) || { ...item, ...payload };
  }

  return null;
}
function summarizeUsage(usageRow, usageDailyLimit) {
  if (usageDailyLimit == null) {
    return {
      authoritative: false,
      row: usageRow || null,
      used_units: usageRow ? Math.max(0, toInt(usageRow.used_units, 0)) : 0,
      used_api_calls: usageRow ? Math.max(0, toInt(usageRow.used_api_calls, 0)) : 0,
      remaining: null,
      limit: null,
      window_start: usageRow?.window_start || null,
      window_end: usageRow?.window_end || null,
    };
  }
  const now = new Date();
  const { start, end } = getUtcWindow(now);
  const currentEnd = usageRow?.window_end ? new Date(usageRow.window_end) : null;
  const expired = !usageRow || !(currentEnd instanceof Date) || Number.isNaN(currentEnd.getTime()) || now >= currentEnd;
  const activeRow = expired
    ? {
        user_id: usageRow?.user_id || null,
        window_start: start.toISOString(),
        window_end: end.toISOString(),
        used_units: 0,
        used_api_calls: 0,
        last_consumed_at: null,
      }
    : usageRow;
  const used = Math.max(0, toInt(activeRow?.used_units, 0));
  return {
    authoritative: true,
    row: activeRow,
    used_units: used,
    used_api_calls: Math.max(0, toInt(activeRow?.used_api_calls, 0)),
    remaining: Math.max(0, usageDailyLimit - used),
    limit: usageDailyLimit,
    window_start: activeRow?.window_start || null,
    window_end: activeRow?.window_end || null,
    empty_window: expired || !usageRow,
  };
}

function summarizeSessionsFromDailyStats(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = new Date();
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const weekStartIso = weekStart.toISOString().slice(0, 10);
  let dailyMinutes = 0;
  let weeklyMinutes = 0;
  let totalSessions = 0;
  let sessionsCompleted = 0;
  for (const row of list) {
    const statDate = String(row?.stat_date || '');
    const minutes = Math.max(0, toInt(row?.minutes_read, 0));
    const count = Math.max(0, toInt(row?.sessions_count, 0));
    if (statDate === today) dailyMinutes += minutes;
    if (statDate >= weekStartIso) weeklyMinutes += minutes;
    totalSessions += count;
    sessionsCompleted += count;
  }
  return { rows: [], totalSessions, dailyMinutes, weeklyMinutes, sessionsCompleted, latest: null };
}

async function buildSnapshot(req, user) {
  const resolved = await getResolvedRuntimePolicyForRequest(req).catch(() => null);
  const usageDailyLimit = resolved?.policy?.usageDailyLimit ?? null;
  const [usersRow, settingsRow, libraryItemsRaw, progressRowsRaw, bookMetricsRaw, dailyStatsRows, usageRow] = await Promise.all([
    getUsersRow(user.id),
    getSettingsRow(user.id),
    getLibraryItemsRows(user.id, { includeDeleted: true, limit: 500 }),
    getProgressRowsRaw(user.id),
    getBookMetricsRowsRaw(user.id),
    getDailyStatsRows(user.id, { limit: 120 }),
    getUsageRow(user.id).catch(() => null),
  ]);
  const libraryItems = (libraryItemsRaw || []).map(serializeLibraryItemRow).filter(Boolean);
  const libraryItemMap = new Map(libraryItemsRaw.map((row) => [String(row.id), row]));
  const progressRows = (progressRowsRaw || []).map((row) => serializeProgressRow(row, libraryItemMap)).filter(Boolean);
  const bookMetricsRows = (bookMetricsRaw || []).map((row) => serializeBookMetricRow(row, libraryItemMap)).filter(Boolean);
  const serializedDailyStatsRows = (dailyStatsRows || []).map(serializeDailyStatRow).filter(Boolean);
  return {
    usersRow,
    settingsRow,
    libraryItems,
    progressRows,
    bookMetricsRows,
    dailyStatsRows: serializedDailyStatsRows,
    sessions: summarizeSessionsFromDailyStats(serializedDailyStatsRows),
    usage: summarizeUsage(usageRow, usageDailyLimit),
    entitlement: resolved?.entitlementSnapshot || null,
    runtimePolicy: resolved?.policy || null,
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
    const snapshot = await buildSnapshot(req, auth.user).catch(() => null);
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
          row = await upsertProgress(auth.user.id, body?.payload || {}, { req, stage: 'final-write' });
          break;
        case 'record_session':
          row = await addSession(auth.user.id, body?.payload || {}, { req, stage: 'final-write' });
          break;
        case 'delete_library_item': {
          const storageRef = body?.payload?.storage_ref || body?.payload?.storageRef || body?.payload?.book_id || body?.payload?.bookId;
          const purge = toBool(body?.payload?.purge, false);
          row = await setLibraryItemStatus(auth.user.id, storageRef, purge ? 'purge' : 'deleted', body?.payload || {});
          break;
        }
        case 'restore_library_item': {
          const storageRef = body?.payload?.storage_ref || body?.payload?.storageRef || body?.payload?.book_id || body?.payload?.bookId;
          row = await setLibraryItemStatus(auth.user.id, storageRef, 'active', { ...(body?.payload || {}), req, stage: 'final-write' });
          break;
        }
        case 'reset_usage_window': {
          const now = new Date();
          const { start, end } = getUtcWindow(now);
          row = await upsertUsageRow({
            user_id: auth.user.id,
            window_start: start.toISOString(),
            window_end: end.toISOString(),
            used_units: 0,
            used_api_calls: 0,
            last_consumed_at: null,
            updated_at: now.toISOString(),
            created_at: now.toISOString(),
          }).catch(() => null);
          break;
        }
        default:
          throw new Error('Unsupported sync action.');
      }
      const snapshot = await buildSnapshot(req, auth.user).catch(() => null);
      return json(res, 200, { ok: true, row, snapshot });
    } catch (error) {
      if (error?.importCapacityBody) {
        return json(res, error.importCapacityStatus || 200, error.importCapacityBody);
      }
      return json(res, 400, { ok: false, error: String(error?.message || error || 'Sync failed.') });
    }
  }

  return json(res, 405, { ok: false, error: 'Method not allowed.' });
}
