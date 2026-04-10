// js/sync.js
// ─────────────────────────────────────────────────────────────────────────────
// Durable sync seam.
//
// window.rcSync owns:
//   - server-authoritative durable sync for user/settings/progress/sessions
//   - cached last-confirmed durable snapshot for signed-in refresh responsiveness
//   - optimistic projection of persistent-looking UI while durable writes confirm
//   - restore lookups against durable progress
//   - sync diagnostics visibility for runtime validation
//
// This module does NOT own auth state, shell truth, or live reading behavior.
// Runtime still owns reading entry/apply timing and current page truth.
//
// localStorage cache (rc_durable_snapshot_v1:<userId>):
//   - Written on every confirmed server snapshot
//   - Applied on sign-in before server responds (display projection only)
//   - NEVER used as restore authority — restore always hits the server
//   - NEVER used as a first-entry position guess
// ─────────────────────────────────────────────────────────────────────────────

window.rcSync = (function () {
  let _progressTimer = null;
  let _prefsSyncTimer = null;
  let _remoteUsersRow = null;
  let _remoteSettingsRow = null;
  let _remoteProgressRows = [];
  let _remoteSessions = [];
  let _remoteProfileMetrics = null;
  let _remoteUsageSummary = null;
  let _remoteEntitlement = null;
  let _hydrationState = { inFlight: false, users: false, settings: false, progress: false, sessions: false, usage: false };
  let _lastSyncSnapshotAt = null;
  let _syncDiagnostics = { users: null, settings: null, progress: null, sessions: null, restore: null, snapshot: null };
  let _requestSeq = 0;
  let _appliedSeq = 0;
  let _applyingRemoteSettings = false;

  const RC_THEME_PREFS_KEY = 'rc_theme_prefs';
  const RC_APPEARANCE_PREFS_KEY = 'rc_appearance_prefs';
  const RC_DURABLE_CACHE_PREFIX = 'rc_durable_snapshot_v1:';

  const WATCHED_SETTING_IDS = new Set([
    'shell-speed',
    'voiceFemaleSelect',
    'voiceMaleSelect',
    'autoplayToggle',
    'vol_voice',
  ]);

  function _user() {
    try { return window.rcAuth && typeof window.rcAuth.getUser === 'function' ? window.rcAuth.getUser() : null; } catch (_) { return null; }
  }

  function _accessToken() {
    try { return window.rcAuth && typeof window.rcAuth.getAccessToken === 'function' ? String(window.rcAuth.getAccessToken() || '').trim() : ''; } catch (_) { return ''; }
  }

  function _ready() {
    const u = _user();
    return !!(u && u.id && _accessToken());
  }

  function _emitHydrated(kind) {
    try { document.dispatchEvent(new CustomEvent('rc:durable-data-hydrated', { detail: { kind: String(kind || 'sync') } })); } catch (_) {}
  }

  function _recordSync(kind, status, detail = {}) {
    _syncDiagnostics[kind] = Object.assign({ status: String(status || 'idle'), at: new Date().toISOString() }, detail || {});
    try { if (typeof window.updateDiagnostics === 'function') window.updateDiagnostics(); } catch (_) {}
    return _syncDiagnostics[kind];
  }

  function _cacheKey(userId) {
    return `${RC_DURABLE_CACHE_PREFIX}${String(userId || '').trim()}`;
  }

  function _readLocalJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) { return {}; }
  }

  function _writeLocalJson(key, payload) {
    const safe = (payload && typeof payload === 'object') ? payload : {};
    try { localStorage.setItem(key, JSON.stringify(safe)); } catch (_) {}
    return safe;
  }

  function _readDurableCache(userId) {
    const key = _cacheKey(userId);
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
  }

  function _writeDurableCache(userId, snapshot) {
    const key = _cacheKey(userId);
    try { localStorage.setItem(key, JSON.stringify({ savedAt: new Date().toISOString(), snapshot: snapshot || null })); } catch (_) {}
  }

  function _currentThemePrefs() {
    const stored = _readLocalJson(RC_THEME_PREFS_KEY);
    try {
      if (window.rcTheme && typeof window.rcTheme.get === 'function') {
        const state = window.rcTheme.get() || {};
        const themeId = String(state.themeId || stored.theme_id || 'default');
        const settings = (state.settings && typeof state.settings === 'object') ? state.settings : (stored.theme_settings || {});
        return {
          theme_id: themeId,
          theme_settings: Object.assign({}, stored.theme_settings || {}, settings || {}),
        };
      }
    } catch (_) {}
    return stored;
  }

  function _currentAppearancePrefs() {
    const stored = _readLocalJson(RC_APPEARANCE_PREFS_KEY);
    try {
      if (window.rcAppearance && typeof window.rcAppearance.get === 'function') {
        return { appearance: window.rcAppearance.get() };
      }
    } catch (_) {}
    return stored;
  }

  function _currentProfilePrefs() {
    try {
      if (window.rcPrefs && typeof window.rcPrefs.loadProfilePrefs === 'function') {
        return window.rcPrefs.loadProfilePrefs() || {};
      }
    } catch (_) {}
    return {};
  }

  function _normalizeBookId(bookId) {
    return String(bookId || '').trim();
  }

  function _normalizeChapterId(value) {
    if (value == null || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? String(num) : String(value);
  }

  function _collectSettingsRow() {
    const theme = _currentThemePrefs();
    const appearance = _currentAppearancePrefs();
    const profile = _currentProfilePrefs();
    const themeSettings = (theme.theme_settings && typeof theme.theme_settings === 'object') ? theme.theme_settings : {};
    const speedEl = document.getElementById('shell-speed');
    const voiceVolumeEl = document.getElementById('vol_voice');
    const autoplayToggle = document.getElementById('autoplayToggle');
    const selectedVoice = (() => {
      try { return String(window.__rcSessionVoiceSelection || '').trim(); } catch (_) { return ''; }
    })();

    const row = {
      theme_id: String(theme.theme_id || 'default'),
      font_id: themeSettings.font ? String(themeSettings.font) : null,
      tts_speed: speedEl && speedEl.value !== '' ? Number(speedEl.value) : null,
      tts_voice_id: selectedVoice || null,
      tts_volume: voiceVolumeEl && voiceVolumeEl.value !== '' ? Number(voiceVolumeEl.value) : null,
      autoplay_enabled: autoplayToggle ? !!autoplayToggle.checked : null,
      music_enabled: typeof themeSettings.music === 'string' ? themeSettings.music !== 'off' : null,
      particles_enabled: typeof themeSettings.embersOn === 'boolean' ? !!themeSettings.embersOn : null,
      use_source_page_numbers: typeof theme.use_source_page_numbers === 'boolean' ? !!theme.use_source_page_numbers : null,
      appearance_mode: appearance && appearance.appearance ? String(appearance.appearance) : null,
      daily_goal_minutes: Number.isFinite(Number(profile.dailyGoalMinutes)) ? Math.max(5, Math.min(300, Math.round(Number(profile.dailyGoalMinutes)))) : null,
      updated_at: new Date().toISOString(),
    };

    Object.keys(row).forEach((key) => {
      if (row[key] === undefined) delete row[key];
    });
    return row;
  }

  function _deriveRemoteProfileMetrics() {
    const profile = _currentProfilePrefs();
    const goal = _remoteSettingsRow && Number.isFinite(Number(_remoteSettingsRow.daily_goal_minutes))
      ? Math.max(5, Math.min(300, Math.round(Number(_remoteSettingsRow.daily_goal_minutes))))
      : Math.max(5, Math.min(300, Math.round(Number(profile.dailyGoalMinutes || 15))));
    const today = (window.rcReadingMetrics && typeof window.rcReadingMetrics.getTodayIsoDate === 'function')
      ? window.rcReadingMetrics.getTodayIsoDate()
      : new Date().toISOString().slice(0, 10);
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - (6 * 24 * 60 * 60 * 1000));
    let dailySeconds = 0;
    let weeklySeconds = 0;
    let sessionsCompleted = 0;
    (_remoteSessions || []).forEach((entry) => {
      if (!entry?.ended_at) return;
      const ended = new Date(entry.ended_at);
      if (Number.isNaN(ended.getTime())) return;
      const seconds = Number.isFinite(Number(entry.elapsed_seconds))
        ? Math.max(0, Math.round(Number(entry.elapsed_seconds)))
        : Math.max(0, Math.round((Number(entry.minutes_listened || 0) * 60) + Number(entry.tts_seconds || 0)));
      if (ended.toISOString().slice(0, 10) === today) dailySeconds += seconds;
      if (ended >= sevenDaysAgo) weeklySeconds += seconds;
      sessionsCompleted += 1;
    });
    _remoteProfileMetrics = {
      dailyGoalMinutes: goal,
      dailyMinutes: Math.round(dailySeconds / 60),
      weeklyMinutes: Math.round(weeklySeconds / 60),
      sessionsCompleted,
      progressPct: goal > 0 ? Math.max(0, Math.min(100, Math.round((dailySeconds / (goal * 60)) * 100))) : 0,
      lastGoalCelebratedOn: String(profile.lastGoalCelebratedOn || ''),
      todayIso: today,
    };
    return _remoteProfileMetrics;
  }

  function _applyRemoteSettingsRow(row) {
    if (!row || typeof row !== 'object') return;
    _remoteSettingsRow = row;
    _applyingRemoteSettings = true;
    try {
      const localTheme = _currentThemePrefs();
      const nextTheme = Object.assign({}, localTheme || {});
      if (row.theme_id) nextTheme.theme_id = String(row.theme_id);
      nextTheme.theme_settings = Object.assign({}, nextTheme.theme_settings || {});
      if (row.font_id) nextTheme.theme_settings.font = String(row.font_id);
      if (typeof row.music_enabled === 'boolean' && !row.music_enabled) nextTheme.theme_settings.music = 'off';
      if (typeof row.particles_enabled === 'boolean') nextTheme.theme_settings.embersOn = !!row.particles_enabled;
      if (typeof row.use_source_page_numbers === 'boolean') nextTheme.use_source_page_numbers = !!row.use_source_page_numbers;
      _writeLocalJson(RC_THEME_PREFS_KEY, nextTheme);
      try { if (window.rcTheme && typeof window.rcTheme.load === 'function') window.rcTheme.load(); } catch (_) {}

      if (row.appearance_mode) {
        try {
          if (window.rcPrefs && typeof window.rcPrefs.saveAppearancePrefs === 'function') {
            window.rcPrefs.saveAppearancePrefs({ appearance: String(row.appearance_mode) });
          } else {
            _writeLocalJson(RC_APPEARANCE_PREFS_KEY, { appearance: String(row.appearance_mode) });
          }
        } catch (_) {}
        try { if (window.rcAppearance && typeof window.rcAppearance.load === 'function') window.rcAppearance.load(); } catch (_) {}
      }

      if (row.daily_goal_minutes != null) {
        try {
          if (window.rcPrefs && typeof window.rcPrefs.saveProfilePrefs === 'function') {
            window.rcPrefs.saveProfilePrefs({ dailyGoalMinutes: Number(row.daily_goal_minutes) });
          }
        } catch (_) {}
      }

      if (row.tts_speed != null) {
        const speedEl = document.getElementById('shell-speed');
        if (speedEl) speedEl.value = String(row.tts_speed);
        try { if (typeof window.shellSetSpeed === 'function') window.shellSetSpeed(row.tts_speed); } catch (_) {}
      }

      if (row.tts_voice_id) {
        try { window.__rcSessionVoiceSelection = String(row.tts_voice_id); } catch (_) {}
        const female = document.getElementById('voiceFemaleSelect');
        const male = document.getElementById('voiceMaleSelect');
        [female, male].forEach((select) => {
          if (!select) return;
          const exists = Array.from(select.options || []).some((opt) => String(opt.value) === String(row.tts_voice_id));
          if (exists) select.value = String(row.tts_voice_id);
        });
      }

      if (row.tts_volume != null) {
        const voiceVolumeEl = document.getElementById('vol_voice');
        if (voiceVolumeEl) {
          voiceVolumeEl.value = String(row.tts_volume);
          try { voiceVolumeEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
        }
      }

      if (typeof row.autoplay_enabled === 'boolean') {
        const autoplayToggle = document.getElementById('autoplayToggle');
        if (autoplayToggle) autoplayToggle.checked = !!row.autoplay_enabled;
        try { localStorage.setItem('rc_autoplay', row.autoplay_enabled ? '1' : '0'); } catch (_) {}
      }
    } finally {
      _applyingRemoteSettings = false;
    }
    _deriveRemoteProfileMetrics();
  }

  // Bulk-apply a server snapshot to all in-memory state. Rejects stale responses
  // via seq ordering. Persists to localStorage as last-confirmed projection.
  function _applySnapshot(snapshot, options = {}) {
    const seq = Number(options.seq || 0);
    if (seq && seq < _appliedSeq) return false;
    if (seq) _appliedSeq = seq;
    const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
    _remoteUsersRow = snap.usersRow || null;
    _remoteSettingsRow = snap.settingsRow || null;
    _remoteProgressRows = Array.isArray(snap.progressRows) ? snap.progressRows.slice() : [];
    const sessionRows = snap.sessions && Array.isArray(snap.sessions.rows) ? snap.sessions.rows.slice() : [];
    _remoteSessions = sessionRows;
    _remoteUsageSummary = snap.usage || null;
    _remoteEntitlement = snap.entitlement || null;
    _hydrationState = { inFlight: false, users: true, settings: true, progress: true, sessions: true, usage: !!snap.usage };
    _lastSyncSnapshotAt = new Date().toISOString();
    if (_remoteSettingsRow) _applyRemoteSettingsRow(_remoteSettingsRow);
    else _deriveRemoteProfileMetrics();
    try {
      if (window.rcUsage && typeof window.rcUsage.applySnapshot === 'function' && snap.usage) {
        window.rcUsage.applySnapshot({
          remaining: snap.usage.remaining,
          limit: snap.usage.limit,
          authoritative: !!snap.usage.authoritative,
          source: options.fromCache ? 'server-cache' : 'server-sync',
        });
      }
    } catch (_) {}
    // Apply server-resolved runtime policy from snapshot.
    // buildSnapshot() on the server already resolves the correct policy for this user.
    // Applying it here keeps tier/entitlement state current after every durable sync —
    // not only on auth events (which refresh policy via billing.js separately).
    // Guard: skip cached snapshots to avoid applying a potentially stale tier from storage.
    // The rc:runtime-policy-changed event dispatched by applyResolvedRuntimePolicy()
    // triggers shell UI updates (tier pill, explorer gating, etc.) automatically.
    if (!options.fromCache && snap.runtimePolicy && typeof snap.runtimePolicy === 'object') {
      try {
        if (window.rcPolicy && typeof window.rcPolicy.apply === 'function') {
          window.rcPolicy.apply(snap.runtimePolicy);
        }
      } catch (_) {}
    }
    // Persist as last-confirmed display projection (not restore authority).
    try {
      const u = _user();
      if (options.persist !== false && u && u.id) _writeDurableCache(u.id, snap);
    } catch (_) {}
    return true;
  }

  // Apply last-confirmed snapshot from localStorage for immediate display on refresh.
  // This is a projection ONLY — it paints the UI without blocking on the server.
  // It must NOT be used as a restore position source.
  function _applyCachedSnapshotForUser(userId) {
    const cached = _readDurableCache(userId);
    if (!cached || !cached.snapshot) return false;
    const applied = _applySnapshot(cached.snapshot, { seq: 0, persist: false, fromCache: true });
    if (applied) {
      _recordSync('snapshot', 'cache', { cachedAt: cached.savedAt || null });
      _emitHydrated('cache');
    }
    return applied;
  }

  // Optimistic projection: write current local settings to _remoteSettingsRow
  // so the UI doesn't flash back to stale server values between saves.
  function _projectCurrentSettingsLocal() {
    if (!_ready()) return null;
    const u = _user();
    if (!u || !u.id) return null;
    const projected = Object.assign({}, _remoteSettingsRow || {}, { user_id: u.id }, _collectSettingsRow());
    _remoteSettingsRow = projected;
    _deriveRemoteProfileMetrics();
    _recordSync('settings', 'projected', { row: projected });
    _emitHydrated('settings-projected');
    return projected;
  }

  // Generic server fetch against /api/app?kind=durable-sync.
  // Returns { seq, data } where seq is a monotonic counter for stale-rejection.
  async function _serverSync(scope = 'snapshot', init = {}) {
    const token = _accessToken();
    if (!token) throw new Error('Missing auth token.');
    const method = String(init.method || 'GET').toUpperCase();
    const url = new URL('/api/app', window.location.origin);
    url.searchParams.set('kind', 'durable-sync');
    url.searchParams.set('scope', String(scope || 'snapshot'));
    if (init.params && typeof init.params === 'object') {
      Object.entries(init.params).forEach(([key, value]) => {
        if (value == null || value === '') return;
        url.searchParams.set(String(key), String(value));
      });
    }
    const seq = ++_requestSeq;
    const resp = await fetch(url.toString(), {
      method,
      cache: 'no-store',
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(typeof init.body !== 'undefined' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: typeof init.body !== 'undefined' ? JSON.stringify(init.body) : undefined,
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data || data.ok === false) {
      throw new Error(String((data && (data.error || data.reason)) || `Durable sync ${resp.status}`));
    }
    return { seq, data };
  }

  // ── Sign-in bootstrap ─────────────────────────────────────────────────────
  // 1. Paint cached snapshot immediately (display projection only)
  // 2. POST sync_user → returns full snapshot → apply
  // 3. If settingsRow === null (confirmed empty), seed from local
  async function _onSignIn() {
    const u = _user();
    _hydrationState = { inFlight: true, users: false, settings: false, progress: false, sessions: false, usage: false };
    if (u && u.id) _applyCachedSnapshotForUser(u.id);
    _recordSync('snapshot', 'pending', { reason: 'signin' });
    try {
      const { seq, data } = await _serverSync('snapshot', { method: 'POST', body: { action: 'sync_user', payload: {} } });
      if (data && data.snapshot) {
        _applySnapshot(data.snapshot, { seq, persist: true });
        // Seed settings only when server explicitly confirmed no settings row.
        if (data.snapshot.settingsRow === null) {
          await syncSettings().catch(() => {});
        }
      }
      _recordSync('snapshot', 'success', { reason: 'signin', snapshotAt: _lastSyncSnapshotAt });
      _emitHydrated('signin');
    } catch (error) {
      _hydrationState.inFlight = false;
      _recordSync('snapshot', 'error', { reason: 'signin', message: String(error?.message || error || 'signin hydration failed') });
    }
  }

  // ── Settings sync ─────────────────────────────────────────────────────────
  async function syncSettings() {
    if (!_ready()) return null;
    // Capture last confirmed row before optimistic projection so we can snap back on failure.
    const _prevSettingsRow = _remoteSettingsRow;
    const payload = _collectSettingsRow();
    _projectCurrentSettingsLocal();
    _recordSync('settings', 'pending', { payload });
    try {
      const { seq, data } = await _serverSync('snapshot', { method: 'POST', body: { action: 'sync_settings', payload } });
      if (data && data.snapshot) _applySnapshot(data.snapshot, { seq, persist: true });
      _recordSync('settings', 'success', { row: data && data.row ? data.row : null, snapshotAt: _lastSyncSnapshotAt });
      _emitHydrated('settings');
      return data && data.row ? data.row : null;
    } catch (error) {
      _recordSync('settings', 'error', { message: String(error?.message || error || 'settings sync failed') });
      // Snap-back: revert to last confirmed state.
      // Non-null _prevSettingsRow: revert _remoteSettingsRow AND re-apply confirmed state
      // to local/runtime prefs (theme prefs, DOM controls, appearance).
      // _applyRemoteSettingsRow uses _applyingRemoteSettings guard to prevent the re-apply
      // from retriggering another sync cycle.
      // Null _prevSettingsRow (first-write failure): revert _remoteSettingsRow to null
      // and re-derive metrics. Local prefs remain correct because _projectCurrentSettingsLocal
      // never writes to localStorage — only _remoteSettingsRow (in-memory) was projected.
      // Leaving _remoteSettingsRow at the projected value would be "doing nothing" —
      // this branch ensures the projected value is cleared even when there is no prior row.
      if (_prevSettingsRow) {
        _remoteSettingsRow = _prevSettingsRow;
        _applyRemoteSettingsRow(_prevSettingsRow);
      } else {
        _remoteSettingsRow = null;
        _deriveRemoteProfileMetrics();
        _emitHydrated('settings-snapback');
      }
      return null;
    }
  }

  async function getSettings() {
    if (_remoteSettingsRow) return _remoteSettingsRow;
    if (!_ready()) return null;
    try {
      const { seq, data } = await _serverSync('snapshot');
      if (data && data.snapshot) _applySnapshot(data.snapshot, { seq, persist: true });
      return _remoteSettingsRow;
    } catch (error) {
      _recordSync('settings', 'error', { message: String(error?.message || error || 'settings fetch failed') });
      return null;
    }
  }

  // ── User row sync ─────────────────────────────────────────────────────────
  async function _syncUserRow() {
    if (!_ready()) return null;
    _recordSync('users', 'pending');
    try {
      const { seq, data } = await _serverSync('snapshot', { method: 'POST', body: { action: 'sync_user', payload: {} } });
      if (data && data.snapshot) _applySnapshot(data.snapshot, { seq, persist: true });
      _recordSync('users', 'success', { row: data && data.row ? data.row : null });
      return data && data.row ? data.row : null;
    } catch (error) {
      _recordSync('users', 'error', { message: String(error?.message || error || 'user sync failed') });
      return null;
    }
  }

  // ── Progress identity ─────────────────────────────────────────────────────
  function _collectProgressIdentity(bookId, chapterIndex) {
    const target = window.__rcReadingTarget || {};
    const normalizedBookId = _normalizeBookId(bookId || target.bookId || target.sourceId || '');
    const sourceType = String(target.sourceType || 'book');
    const sourceId = String(target.bookId || normalizedBookId || '');
    const chapterId = Number.isFinite(Number(chapterIndex)) ? String(Number(chapterIndex)) : (target.chapterIndex != null ? String(target.chapterIndex) : null);
    const pageCount = document.querySelectorAll('.page').length || null;
    return {
      book_id: normalizedBookId,
      source_type: sourceType,
      source_id: sourceId,
      chapter_id: chapterId,
      page_count: pageCount,
      is_active: true,
      session_version: 1,
    };
  }

  function _findCachedProgressRow(bookId, chapterIndex) {
    const normalizedBookId = _normalizeBookId(bookId);
    const normalizedChapterId = _normalizeChapterId(chapterIndex);
    if (!normalizedBookId) return null;
    let best = null;
    for (const row of _remoteProgressRows) {
      if (_normalizeBookId(row.book_id) !== normalizedBookId) continue;
      if (normalizedChapterId != null && _normalizeChapterId(row.chapter_id) !== normalizedChapterId) continue;
      if (!best) { best = row; continue; }
      const currentTime = Date.parse(best.updated_at || best.last_read_at || 0) || 0;
      const rowTime = Date.parse(row.updated_at || row.last_read_at || 0) || 0;
      if (rowTime > currentTime) best = row;
    }
    return best;
  }

  function _findLatestCachedBookProgress(bookId) {
    return _findCachedProgressRow(bookId, null);
  }

  // ── Progress write ────────────────────────────────────────────────────────
  function scheduleProgressSync(bookId, chapterIndex, pageIndex, meta = {}) {
    if (!_ready()) return;
    if (_progressTimer) clearTimeout(_progressTimer);
    _progressTimer = setTimeout(() => {
      _progressTimer = null;
      _writeProgress(bookId, chapterIndex, pageIndex, meta).catch(() => {});
    }, 450);
  }

  async function _writeProgress(bookId, chapterIndex, pageIndex, meta = {}) {
    const u = _user();
    if (!_ready() || !u) return null;
    const identity = _collectProgressIdentity(bookId, chapterIndex);
    const payload = Object.assign({}, identity, {
      last_page_index: Number.isFinite(Number(pageIndex)) && Number(pageIndex) >= 0 ? Number(pageIndex) : 0,
      last_read_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    _recordSync('progress', 'pending', { payload, reason: String(meta.reason || 'write') });
    try {
      const { seq, data } = await _serverSync('snapshot', { method: 'POST', body: { action: 'write_progress', payload } });
      if (data && data.snapshot) _applySnapshot(data.snapshot, { seq, persist: true });
      const row = data && data.row ? data.row : payload;
      _recordSync('progress', 'success', { row, reason: String(meta.reason || 'write') });
      _emitHydrated('progress');
      return row;
    } catch (error) {
      _recordSync('progress', 'error', { message: String(error?.message || error || 'progress write failed'), payload, reason: String(meta.reason || 'write') });
      return null;
    }
  }

  // Flush any pending debounced progress write immediately.
  async function saveProgressNow(bookId, chapterIndex, pageIndex, meta = {}) {
    if (_progressTimer) {
      clearTimeout(_progressTimer);
      _progressTimer = null;
    }
    return _writeProgress(bookId, chapterIndex, pageIndex, meta);
  }

  // Flush progress for the current __rcReadingTarget before switching books.
  async function flushProgressSync() {
    if (_progressTimer) {
      clearTimeout(_progressTimer);
      _progressTimer = null;
    }
    const target = window.__rcReadingTarget || {};
    if (!target || !target.bookId) return null;
    return _writeProgress(target.bookId, target.chapterIndex, target.pageIndex, { reason: 'flush-current-target' });
  }

  // ── Progress reads ────────────────────────────────────────────────────────
  async function getReadingProgress(bookId, chapterIndex) {
    const cached = _findCachedProgressRow(bookId, chapterIndex);
    if (cached) {
      const idx = Number(cached.last_page_index);
      return Number.isFinite(idx) && idx >= 0 ? { pageIndex: idx, updatedAt: cached.updated_at || cached.last_read_at || null } : null;
    }
    const identity = _collectProgressIdentity(bookId, chapterIndex);
    const existing = _findCachedProgressRow(identity.book_id, identity.chapter_id != null ? identity.chapter_id : null);
    if (!existing) return null;
    const idx = Number(existing.last_page_index);
    return Number.isFinite(idx) && idx >= 0 ? { pageIndex: idx, updatedAt: existing.updated_at || existing.last_read_at || null } : null;
  }

  // Restore: trust in-memory cache only if _hydrationState.progress === true
  // (meaning server confirmed this session). Otherwise always fetch the server.
  // localStorage cache is NEVER used as restore source.
  async function getRestoreProgress(bookId) {
    const normalizedBookId = _normalizeBookId(bookId);
    if (!normalizedBookId || !_ready()) return null;

    // Cache hit only when server has confirmed progress this session.
    if (_hydrationState.progress === true) {
      const cached = _findLatestCachedBookProgress(normalizedBookId);
      if (cached) {
        const idx = Number(cached.last_page_index);
        if (Number.isFinite(idx) && idx >= 0) {
          const result = {
            pageIndex: idx,
            chapterIndex: _normalizeChapterId(cached.chapter_id) != null ? Number(cached.chapter_id) : null,
            updatedAt: cached.updated_at || cached.last_read_at || null,
          };
          _recordSync('restore', 'cache-hit', { bookId: normalizedBookId, result });
          return result;
        }
      }
    }

    // Always fetch server for restore when cache is not confirmed.
    _recordSync('restore', 'pending', { bookId: normalizedBookId });
    try {
      const { data } = await _serverSync('restore', { params: { book_id: normalizedBookId } });
      const row = data && data.row ? data.row : null;
      if (!row) {
        _recordSync('restore', 'empty', { bookId: normalizedBookId });
        return null;
      }
      // Merge fetched row into in-memory progress cache.
      _remoteProgressRows = [row, ...(_remoteProgressRows || []).filter((entry) => String(entry.id || '') !== String(row.id || ''))];
      try {
        const u = _user();
        if (u && u.id) {
          _writeDurableCache(u.id, {
            usersRow: _remoteUsersRow,
            settingsRow: _remoteSettingsRow,
            progressRows: _remoteProgressRows,
            sessions: { rows: _remoteSessions, latest: _remoteSessions[0] || null, totalSessions: (_remoteSessions || []).length },
            usage: _remoteUsageSummary,
            entitlement: _remoteEntitlement,
          });
        }
      } catch (_) {}
      const idx = Number(row.last_page_index);
      if (!Number.isFinite(idx) || idx < 0) {
        _recordSync('restore', 'empty', { bookId: normalizedBookId });
        return null;
      }
      const result = {
        pageIndex: idx,
        chapterIndex: _normalizeChapterId(row.chapter_id) != null ? Number(row.chapter_id) : null,
        updatedAt: row.updated_at || row.last_read_at || null,
      };
      _recordSync('restore', 'success', { bookId: normalizedBookId, result });
      return result;
    } catch (error) {
      _recordSync('restore', 'error', { bookId: normalizedBookId, message: String(error?.message || error || 'restore lookup failed') });
      return null;
    }
  }

  // ── Session record ────────────────────────────────────────────────────────
  async function recordReadingSession(entry) {
    const u = _user();
    if (!_ready() || !u || !entry || !entry.bookId) return null;
    const target = window.__rcReadingTarget || {};
    const elapsedSeconds = Math.max(0, Math.round(Number(entry.elapsedSeconds || 0)));
    const payload = {
      pages_completed: Math.max(0, Math.round(Number(entry.pagesAdvanced || 0))),
      minutes_listened: Math.max(0, Math.round(elapsedSeconds / 60)),
      source_type: String(target.sourceType || 'book'),
      source_id: String(target.bookId || entry.bookId || ''),
      book_id: String(entry.bookId || ''),
      chapter_id: target.chapterIndex != null ? String(target.chapterIndex) : null,
      mode: typeof window.appMode === 'string' ? String(window.appMode) : 'reading',
      tts_seconds: 0,
      completed: !!entry.completed,
      started_at: entry.startedAt || new Date().toISOString(),
      ended_at: entry.endedAt || new Date().toISOString(),
      elapsed_seconds: elapsedSeconds,
    };
    _recordSync('sessions', 'pending', { payload });
    try {
      const { seq, data } = await _serverSync('snapshot', { method: 'POST', body: { action: 'record_session', payload } });
      if (data && data.snapshot) _applySnapshot(data.snapshot, { seq, persist: true });
      _recordSync('sessions', 'success', { row: data && data.row ? data.row : payload });
      _emitHydrated('sessions');
      return data && data.row ? data.row : payload;
    } catch (error) {
      _recordSync('sessions', 'error', { message: String(error?.message || error || 'session write failed'), payload });
      return null;
    }
  }

  // ── Profile metrics ───────────────────────────────────────────────────────
  function getRemoteReadingBookSummary(bookId, totalPagesHint) {
    if (!_ready()) return null;
    const row = _findLatestCachedBookProgress(bookId);
    if (!row) return null;
    const key = _normalizeBookId(bookId);
    const totalPages = Number.isFinite(Number(totalPagesHint)) && Number(totalPagesHint) > 0
      ? Number(totalPagesHint)
      : Math.max(0, Number(row.page_count || 0));
    const lastPageIndex = Math.max(0, Number(row.last_page_index || 0));
    const totalReadingSeconds = (_remoteSessions || []).reduce((sum, entry) => {
      if (_normalizeBookId(entry.book_id) !== key) return sum;
      return sum + (Number.isFinite(Number(entry.elapsed_seconds)) ? Math.max(0, Math.round(Number(entry.elapsed_seconds))) : Math.max(0, Math.round((Number(entry.minutes_listened || 0) * 60) + Number(entry.tts_seconds || 0))));
    }, 0);
    const completed = !!((_remoteSessions || []).find((entry) => _normalizeBookId(entry.book_id) === key && entry.completed));
    return {
      bookId: key,
      totalPages,
      lastPageIndex,
      totalReadingSeconds,
      lastOpenedAt: row.last_read_at || row.updated_at || null,
      completed: completed || (totalPages > 0 && lastPageIndex >= Math.max(0, totalPages - 1)),
      completedAt: null,
    };
  }

  function getRemoteProfileMetrics() {
    return _ready() ? (_remoteProfileMetrics || _deriveRemoteProfileMetrics()) : null;
  }

  // ── State clearing ────────────────────────────────────────────────────────
  function _clearRemoteState() {
    _remoteUsersRow = null;
    _remoteSettingsRow = null;
    _remoteProgressRows = [];
    _remoteSessions = [];
    _remoteProfileMetrics = null;
    _remoteUsageSummary = null;
    _remoteEntitlement = null;
    _hydrationState = { inFlight: false, users: false, settings: false, progress: false, sessions: false, usage: false };
    _lastSyncSnapshotAt = null;
    _requestSeq = 0;
    _appliedSeq = 0;
    // Clear session tokens so a stale usage count from the previous session does not
    // leak into the next user's projection window. The usage pill is hidden when not
    // authed, so this does not create a visible blank state for the current user.
    // When the next user signs in, their cached or server-confirmed usage replaces this.
    try {
      if (window.rcUsage && typeof window.rcUsage.applySnapshot === 'function') {
        window.rcUsage.applySnapshot({ remaining: null, limit: null, authoritative: false, source: 'signout' });
      }
    } catch (_) {}
  }

  async function rehydrateDurableData() {
    if (!_ready()) {
      _clearRemoteState();
      _emitHydrated('signout');
      return;
    }
    await _onSignIn();
  }

  // ── Settings queue ────────────────────────────────────────────────────────
  function _queueSettingsSync() {
    if (!_ready()) return;
    if (_prefsSyncTimer) clearTimeout(_prefsSyncTimer);
    _prefsSyncTimer = setTimeout(() => {
      _prefsSyncTimer = null;
      syncSettings().catch(() => {});
    }, 350);
  }

  // ── Event handlers ────────────────────────────────────────────────────────
  function _handleAuthChanged(e) {
    const { signedIn, source } = e.detail || {};
    if (signedIn && source !== 'init-unconfigured' && source !== 'init-client-error') {
      const u = _user();
      _hydrationState = { inFlight: true, users: false, settings: false, progress: false, sessions: false, usage: false };
      if (u && u.id) _applyCachedSnapshotForUser(u.id);
      setTimeout(() => { _onSignIn().catch(() => {}); }, 0);
      return;
    }
    if (!signedIn) {
      _clearRemoteState();
      _emitHydrated('signout');
    }
  }

  function _handlePrefsChanged() {
    if (_applyingRemoteSettings) return;
    _projectCurrentSettingsLocal();
    _queueSettingsSync();
  }

  function _handleSettingsControlEvent(event) {
    if (_applyingRemoteSettings) return;
    const id = String(event?.target?.id || '').trim();
    if (!WATCHED_SETTING_IDS.has(id)) return;
    _projectCurrentSettingsLocal();
    _queueSettingsSync();
  }

  try { document.addEventListener('rc:auth-changed', _handleAuthChanged); } catch (_) {}
  try { document.addEventListener('rc:prefs-changed', _handlePrefsChanged); } catch (_) {}
  try { document.addEventListener('change', _handleSettingsControlEvent, true); } catch (_) {}
  try { document.addEventListener('input', _handleSettingsControlEvent, true); } catch (_) {}

  return {
    scheduleProgressSync,
    saveProgressNow,
    flushProgressSync,
    getReadingProgress,
    getRestoreProgress,
    recordReadingSession,
    getRemoteReadingBookSummary,
    getRemoteProfileMetrics,
    syncSettings,
    getSettings,
    rehydrateDurableData,
    getRemoteUsersRow: () => _remoteUsersRow,
    getRemoteUsageSummary: () => _remoteUsageSummary,
    getHydrationState: () => ({ ..._hydrationState }),
    getDiagnosticsSnapshot: () => ({
      sync: { ..._syncDiagnostics },
      hydrated: { ..._hydrationState },
      snapshotAt: _lastSyncSnapshotAt,
      usersRow: _remoteUsersRow,
      settingsRow: _remoteSettingsRow,
      usage: _remoteUsageSummary,
      progressCount: (_remoteProgressRows || []).length,
      sessionCount: (_remoteSessions || []).length,
    }),
  };
})();
