// js/sync.js
// ─────────────────────────────────────────────────────────────────────────────
// Durable sync seam.
//
// window.rcSync owns:
//   - reading progress sync against public.user_progress
//   - settings sync against public.user_settings
//   - durable session sync against public.user_sessions
//   - durable account row sync against public.users
//   - sign-in pull/apply handshake for durable records
//   - quiet degradation when Supabase is unavailable or the user is signed out
//
// This module does NOT own auth state or runtime truth. It borrows the client
// from rcAuth and persists runtime-owned values through thin adapters.
// ─────────────────────────────────────────────────────────────────────────────

window.rcSync = (function () {
  let _progressTimer = null;
  let _prefsSyncTimer = null;
  let _remoteSettingsRow = null;
  let _remoteProgressRows = [];
  let _remoteSessions = [];
  let _remoteProfileMetrics = null;

  const RC_THEME_PREFS_KEY = 'rc_theme_prefs';
  const RC_APPEARANCE_PREFS_KEY = 'rc_appearance_prefs';

  const WATCHED_SETTING_IDS = new Set([
    'shell-speed',
    'voiceFemaleSelect',
    'voiceMaleSelect',
    'autoplayToggle',
    'vol_voice',
  ]);

  function _client() {
    try { return window.rcAuth && typeof window.rcAuth.getClient === 'function' ? window.rcAuth.getClient() : null; } catch (_) { return null; }
  }

  function _user() {
    try { return window.rcAuth && typeof window.rcAuth.getUser === 'function' ? window.rcAuth.getUser() : null; } catch (_) { return null; }
  }

  function _ready() {
    const c = _client();
    const u = _user();
    return !!(c && u && u.id);
  }

  function _emitHydrated(kind) {
    try { document.dispatchEvent(new CustomEvent('rc:durable-data-hydrated', { detail: { kind: String(kind || 'sync') } })); } catch (_) {}
  }

  function _readLocalJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) { return {}; }
  }

  function _writeLocalJson(key, payload) {
    const safe = (payload && typeof payload === 'object') ? payload : {};
    try { localStorage.setItem(key, JSON.stringify(safe)); } catch (_) {}
    return safe;
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

  function _inferAuthProvider(user) {
    const explicit = String((user && (user.app_metadata?.provider || user.user_metadata?.provider)) || '').trim();
    if (explicit) return explicit;
    try {
      const identities = Array.isArray(user?.identities) ? user.identities : [];
      const provider = identities[0] && identities[0].provider ? String(identities[0].provider).trim() : '';
      return provider || 'email';
    } catch (_) {
      return 'email';
    }
  }

  function _deriveDisplayName(user) {
    const explicit = String((user && (user.displayName || user?.user_metadata?.full_name || user?.user_metadata?.name)) || '').trim();
    if (explicit) return explicit;
    const email = String((user && user.email) || '').trim();
    if (!email) return 'Account';
    return email.split('@')[0] || email;
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
      music_profile_id: typeof themeSettings.music === 'string' ? themeSettings.music : null,
      particles_enabled: typeof themeSettings.embersOn === 'boolean' ? !!themeSettings.embersOn : null,
      particle_preset_id: themeSettings.emberPreset ? String(themeSettings.emberPreset) : null,
      use_source_page_numbers: typeof theme.use_source_page_numbers === 'boolean' ? !!theme.use_source_page_numbers : null,
      appearance_mode: appearance && appearance.appearance ? String(appearance.appearance) : null,
      daily_goal_minutes: Number.isFinite(Number(profile.dailyGoalMinutes)) ? Math.max(5, Math.min(300, Math.round(Number(profile.dailyGoalMinutes)))) : null,
      last_goal_celebrated_on: typeof profile.lastGoalCelebratedOn === 'string' && profile.lastGoalCelebratedOn ? profile.lastGoalCelebratedOn : null,
      explorer_accent_swatch: themeSettings.accentSwatch ? String(themeSettings.accentSwatch) : null,
      explorer_background_mode: themeSettings.backgroundMode ? String(themeSettings.backgroundMode) : null,
      updated_at: new Date().toISOString(),
    };

    Object.keys(row).forEach((key) => {
      if (row[key] === undefined) delete row[key];
    });
    return row;
  }

  function _applyRemoteSettingsRow(row) {
    if (!row || typeof row !== 'object') return;
    _remoteSettingsRow = row;

    const localTheme = _currentThemePrefs();
    const nextTheme = Object.assign({}, localTheme || {});
    if (row.theme_id) nextTheme.theme_id = String(row.theme_id);
    nextTheme.theme_settings = Object.assign({}, nextTheme.theme_settings || {});
    if (row.font_id) nextTheme.theme_settings.font = String(row.font_id);
    if (typeof row.music_enabled === 'boolean' && !row.music_enabled) nextTheme.theme_settings.music = 'off';
    if (typeof row.music_profile_id === 'string' && row.music_profile_id) nextTheme.theme_settings.music = row.music_profile_id;
    if (typeof row.particles_enabled === 'boolean') nextTheme.theme_settings.embersOn = !!row.particles_enabled;
    if (row.particle_preset_id) nextTheme.theme_settings.emberPreset = String(row.particle_preset_id);
    if (typeof row.use_source_page_numbers === 'boolean') nextTheme.use_source_page_numbers = !!row.use_source_page_numbers;
    if (row.explorer_accent_swatch) nextTheme.theme_settings.accentSwatch = String(row.explorer_accent_swatch);
    if (row.explorer_background_mode) nextTheme.theme_settings.backgroundMode = String(row.explorer_background_mode);
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

    if (row.daily_goal_minutes != null || row.last_goal_celebrated_on != null) {
      try {
        if (window.rcPrefs && typeof window.rcPrefs.saveProfilePrefs === 'function') {
          window.rcPrefs.saveProfilePrefs({
            dailyGoalMinutes: row.daily_goal_minutes != null ? Number(row.daily_goal_minutes) : undefined,
            lastGoalCelebratedOn: row.last_goal_celebrated_on != null ? String(row.last_goal_celebrated_on) : undefined,
          });
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
  }

  async function syncSettings() {
    const c = _client();
    const u = _user();
    if (!c || !u) return;
    const payload = Object.assign({ user_id: u.id }, _collectSettingsRow());
    try {
      await c.from('user_settings').upsert(payload, { onConflict: 'user_id' });
      _remoteSettingsRow = payload;
    } catch (_) {}
  }

  async function getSettings() {
    const c = _client();
    const u = _user();
    if (!c || !u) return null;
    try {
      const { data, error } = await c
        .from('user_settings')
        .select('user_id,theme_id,font_id,text_size,line_spacing,page_turn_sound_id,tts_speed,tts_voice_id,tts_volume,autoplay_enabled,music_enabled,music_profile_id,particles_enabled,particle_preset_id,use_source_page_numbers,appearance_mode,daily_goal_minutes,last_goal_celebrated_on,explorer_accent_swatch,explorer_background_mode,updated_at')
        .eq('user_id', u.id)
        .maybeSingle();
      if (error || !data) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  async function _syncUserRow() {
    const c = _client();
    const u = _user();
    if (!c || !u || !u.id) return;
    const payload = {
      id: u.id,
      display_name: _deriveDisplayName(u),
      email: String(u.email || '').trim() || null,
      auth_provider: _inferAuthProvider(u),
      status: 'active',
      updated_at: new Date().toISOString(),
    };
    try { await c.from('users').upsert(payload, { onConflict: 'id' }); } catch (_) {}
  }

  function _collectProgressIdentity(bookId, chapterIndex) {
    const target = window.__rcReadingTarget || {};
    const normalizedBookId = _normalizeBookId(bookId || target.bookId || target.sourceId || '');
    const sourceType = String(target.sourceType || 'book');
    const sourceId = String(target.bookId || normalizedBookId || '');
    const chapterId = Number.isFinite(Number(chapterIndex)) ? String(Number(chapterIndex)) : (target.chapterIndex != null ? String(target.chapterIndex) : null);
    const pageCount = document.querySelectorAll('.page').length || null;
    return {
      user_id: (_user() || {}).id,
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

  function _applyProgressRows(rows) {
    _remoteProgressRows = Array.isArray(rows) ? rows.slice() : [];
  }

  async function _loadProgressCache() {
    const c = _client();
    const u = _user();
    if (!c || !u || !u.id) { _applyProgressRows([]); return []; }
    try {
      const { data, error } = await c
        .from('user_progress')
        .select('id,book_id,last_page_index,updated_at,source_type,source_id,chapter_id,page_count,last_read_at,is_active,session_version')
        .eq('user_id', u.id)
        .eq('is_active', true)
        .order('updated_at', { ascending: false });
      if (error || !Array.isArray(data)) { _applyProgressRows([]); return []; }
      _applyProgressRows(data);
      return data;
    } catch (_) {
      _applyProgressRows([]);
      return [];
    }
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
      lastGoalCelebratedOn: String((_remoteSettingsRow && _remoteSettingsRow.last_goal_celebrated_on) || profile.lastGoalCelebratedOn || ''),
      todayIso: today,
    };
    return _remoteProfileMetrics;
  }

  async function _loadSessionCache() {
    const c = _client();
    const u = _user();
    if (!c || !u || !u.id) { _remoteSessions = []; _remoteProfileMetrics = null; return []; }
    try {
      const { data, error } = await c
        .from('user_sessions')
        .select('id,book_id,chapter_id,source_type,source_id,pages_completed,minutes_listened,elapsed_seconds,mode,tts_seconds,completed,started_at,ended_at,updated_at')
        .eq('user_id', u.id)
        .order('ended_at', { ascending: false })
        .limit(500);
      _remoteSessions = (!error && Array.isArray(data)) ? data : [];
      _deriveRemoteProfileMetrics();
      return _remoteSessions;
    } catch (_) {
      _remoteSessions = [];
      _remoteProfileMetrics = null;
      return [];
    }
  }

  async function _onSignIn() {
    await _syncUserRow();
    const remote = await getSettings();
    if (remote) {
      _applyRemoteSettingsRow(remote);
    } else {
      await syncSettings();
    }
    await _loadProgressCache();
    await _loadSessionCache();
    _emitHydrated('signin');
  }

  function scheduleProgressSync(bookId, chapterIndex, pageIndex) {
    if (!_ready()) return;
    if (_progressTimer) clearTimeout(_progressTimer);
    _progressTimer = setTimeout(() => {
      _progressTimer = null;
      _writeProgress(bookId, chapterIndex, pageIndex).catch(() => {});
    }, 500);
  }

  async function _findProgressRow(identity) {
    const c = _client();
    if (!c || !identity || !identity.user_id || !identity.book_id) return null;
    try {
      let query = c
        .from('user_progress')
        .select('id,book_id,last_page_index,updated_at,chapter_id,page_count,last_read_at,source_type,source_id,is_active,session_version')
        .eq('user_id', identity.user_id)
        .eq('book_id', identity.book_id)
        .eq('source_type', identity.source_type)
        .eq('source_id', identity.source_id)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (identity.chapter_id != null) query = query.eq('chapter_id', identity.chapter_id);
      const { data, error } = await query;
      if (error || !Array.isArray(data) || !data[0]) return null;
      return data[0];
    } catch (_) {
      return null;
    }
  }

  async function _writeProgress(bookId, chapterIndex, pageIndex) {
    const c = _client();
    const u = _user();
    if (!c || !u) return;
    const identity = _collectProgressIdentity(bookId, chapterIndex);
    const payload = Object.assign({}, identity, {
      last_page_index: Number.isFinite(Number(pageIndex)) && Number(pageIndex) >= 0 ? Number(pageIndex) : 0,
      last_read_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    try {
      const existing = await _findProgressRow(identity);
      if (existing && existing.id) {
        await c.from('user_progress').update(payload).eq('id', existing.id);
      } else {
        await c.from('user_progress').insert(payload);
      }
      const merged = Object.assign({}, existing || {}, payload);
      _remoteProgressRows = (_remoteProgressRows || []).filter((row) => String(row.id || '') !== String(existing?.id || ''));
      _remoteProgressRows.unshift(merged);
      _emitHydrated('progress');
    } catch (_) {}
  }

  async function getReadingProgress(bookId, chapterIndex) {
    const cached = _findCachedProgressRow(bookId, chapterIndex);
    if (cached) {
      const idx = Number(cached.last_page_index);
      return Number.isFinite(idx) && idx >= 0 ? { pageIndex: idx, updatedAt: cached.updated_at || cached.last_read_at || null } : null;
    }
    const identity = _collectProgressIdentity(bookId, chapterIndex);
    const existing = await _findProgressRow(identity);
    if (!existing) return null;
    const idx = Number(existing.last_page_index);
    return Number.isFinite(idx) && idx >= 0 ? { pageIndex: idx, updatedAt: existing.updated_at || existing.last_read_at || null } : null;
  }

  async function getRestoreProgress(bookId) {
    const normalizedBookId = _normalizeBookId(bookId);
    if (!normalizedBookId || !_ready()) return null;
    const cached = _findLatestCachedBookProgress(normalizedBookId);
    if (cached) {
      const idx = Number(cached.last_page_index);
      return Number.isFinite(idx) && idx >= 0 ? {
        pageIndex: idx,
        chapterIndex: _normalizeChapterId(cached.chapter_id) != null ? Number(cached.chapter_id) : null,
        updatedAt: cached.updated_at || cached.last_read_at || null,
      } : null;
    }
    const c = _client();
    const u = _user();
    if (!c || !u || !u.id) return null;
    try {
      const { data, error } = await c
        .from('user_progress')
        .select('book_id,last_page_index,updated_at,chapter_id,last_read_at')
        .eq('user_id', u.id)
        .eq('book_id', normalizedBookId)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (error || !Array.isArray(data) || !data[0]) return null;
      const row = data[0];
      const idx = Number(row.last_page_index);
      if (!Number.isFinite(idx) || idx < 0) return null;
      return {
        pageIndex: idx,
        chapterIndex: _normalizeChapterId(row.chapter_id) != null ? Number(row.chapter_id) : null,
        updatedAt: row.updated_at || row.last_read_at || null,
      };
    } catch (_) {
      return null;
    }
  }

  async function recordReadingSession(entry) {
    const c = _client();
    const u = _user();
    if (!c || !u || !u.id || !entry || !entry.bookId) return;
    const target = window.__rcReadingTarget || {};
    const elapsedSeconds = Math.max(0, Math.round(Number(entry.elapsedSeconds || 0)));
    const payload = {
      user_id: u.id,
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
      updated_at: new Date().toISOString(),
    };
    try {
      const { data, error } = await c.from('user_sessions').insert(payload).select('id,book_id,chapter_id,source_type,source_id,pages_completed,minutes_listened,elapsed_seconds,mode,tts_seconds,completed,started_at,ended_at,updated_at').limit(1);
      if (!error) {
        if (Array.isArray(data) && data[0]) _remoteSessions.unshift(data[0]);
        else _remoteSessions.unshift(payload);
        _deriveRemoteProfileMetrics();
        _emitHydrated('sessions');
      }
    } catch (_) {}
  }

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

  function _clearRemoteState() {
    _remoteSettingsRow = null;
    _remoteProgressRows = [];
    _remoteSessions = [];
    _remoteProfileMetrics = null;
  }

  function _queueSettingsSync() {
    if (!_ready()) return;
    if (_prefsSyncTimer) clearTimeout(_prefsSyncTimer);
    _prefsSyncTimer = setTimeout(() => {
      _prefsSyncTimer = null;
      syncSettings().catch(() => {});
    }, 400);
  }

  function _handleAuthChanged(e) {
    const { signedIn, source } = e.detail || {};
    if (signedIn && source !== 'init-unconfigured' && source !== 'init-client-error') {
      setTimeout(() => { _onSignIn().catch(() => {}); }, 0);
      return;
    }
    if (!signedIn) {
      _clearRemoteState();
      _emitHydrated('signout');
    }
  }

  function _handlePrefsChanged() {
    _queueSettingsSync();
  }

  function _handleSettingsControlEvent(event) {
    const id = String(event?.target?.id || '').trim();
    if (!WATCHED_SETTING_IDS.has(id)) return;
    _queueSettingsSync();
  }

  try { document.addEventListener('rc:auth-changed', _handleAuthChanged); } catch (_) {}
  try { document.addEventListener('rc:prefs-changed', _handlePrefsChanged); } catch (_) {}
  try { document.addEventListener('change', _handleSettingsControlEvent, true); } catch (_) {}
  try { document.addEventListener('input', _handleSettingsControlEvent, true); } catch (_) {}

  return {
    scheduleProgressSync,
    getReadingProgress,
    getRestoreProgress,
    recordReadingSession,
    getRemoteReadingBookSummary,
    getRemoteProfileMetrics,
    syncSettings,
    getSettings,
  };
})();
