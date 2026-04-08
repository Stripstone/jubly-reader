// js/sync.js
// ─────────────────────────────────────────────────────────────────────────────
// Durable sync seam.
//
// window.rcSync owns:
//   - reading progress sync against public.user_progress
//   - settings sync against public.user_settings
//   - sign-in pull/apply handshake
//   - quiet degradation when Supabase is unavailable or the user is signed out
//
// This module does NOT own auth state or runtime truth. It borrows the client
// from rcAuth and persists runtime-owned values through thin adapters.
// ─────────────────────────────────────────────────────────────────────────────

window.rcSync = (function () {
  let _progressTimer = null;
  let _prefsSyncTimer = null;

  const RC_THEME_PREFS_KEY = 'rc_theme_prefs';
  const RC_APPEARANCE_PREFS_KEY = 'rc_appearance_prefs';
  const RC_DIAGNOSTICS_PREFS_KEY = 'rc_diagnostics_prefs';

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
          diagnostics_enabled: typeof stored.diagnostics_enabled === 'boolean' ? stored.diagnostics_enabled : undefined,
          diagnostics_mode: typeof stored.diagnostics_mode === 'string' ? stored.diagnostics_mode : undefined,
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

  function _currentDiagnosticsPrefs() {
    return _readLocalJson(RC_DIAGNOSTICS_PREFS_KEY);
  }

  function _collectSettingsRow() {
    const theme = _currentThemePrefs();
    const appearance = _currentAppearancePrefs();
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
      updated_at: new Date().toISOString(),
    };

    Object.keys(row).forEach((key) => {
      if (row[key] === undefined) delete row[key];
    });
    return row;
  }

  function _applyRemoteSettingsRow(row) {
    if (!row || typeof row !== 'object') return;

    const localTheme = _currentThemePrefs();
    const nextTheme = Object.assign({}, localTheme || {});
    if (row.theme_id) nextTheme.theme_id = String(row.theme_id);
    nextTheme.theme_settings = Object.assign({}, nextTheme.theme_settings || {});
    if (row.font_id) nextTheme.theme_settings.font = String(row.font_id);
    if (typeof row.music_profile_id === 'string' && row.music_profile_id) nextTheme.theme_settings.music = row.music_profile_id;
    if (typeof row.particles_enabled === 'boolean') nextTheme.theme_settings.embersOn = !!row.particles_enabled;
    if (row.particle_preset_id) nextTheme.theme_settings.emberPreset = String(row.particle_preset_id);
    if (typeof row.use_source_page_numbers === 'boolean') nextTheme.use_source_page_numbers = !!row.use_source_page_numbers;
    _writeLocalJson(RC_THEME_PREFS_KEY, nextTheme);
    try { if (window.rcTheme && typeof window.rcTheme.load === 'function') window.rcTheme.load(); } catch (_) {}

    // Appearance is not represented in the current Supabase user_settings schema,
    // so local appearance remains the source of truth for now.
    const appearance = _currentAppearancePrefs();
    _writeLocalJson(RC_APPEARANCE_PREFS_KEY, appearance);
    try { if (window.rcAppearance && typeof window.rcAppearance.load === 'function') window.rcAppearance.load(); } catch (_) {}

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
    } catch (_) {}
  }

  async function getSettings() {
    const c = _client();
    const u = _user();
    if (!c || !u) return null;
    try {
      const { data, error } = await c
        .from('user_settings')
        .select('user_id,theme_id,font_id,text_size,line_spacing,page_turn_sound_id,tts_speed,tts_voice_id,tts_volume,autoplay_enabled,music_enabled,music_profile_id,particles_enabled,particle_preset_id,use_source_page_numbers,updated_at')
        .eq('user_id', u.id)
        .maybeSingle();
      if (error || !data) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  async function _onSignIn() {
    const remote = await getSettings();
    if (remote) {
      _applyRemoteSettingsRow(remote);
    } else {
      await syncSettings();
    }
  }

  function _collectProgressIdentity(bookId, chapterIndex) {
    const target = window.__rcReadingTarget || {};
    const normalizedBookId = String(bookId || target.bookId || target.sourceId || '');
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

  async function _findProgressRow(identity) {
    const c = _client();
    if (!c || !identity || !identity.user_id || !identity.book_id) return null;
    try {
      let query = c
        .from('user_progress')
        .select('id,last_page_index,updated_at,chapter_id')
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

  function scheduleProgressSync(bookId, chapterIndex, pageIndex) {
    if (!_ready()) return;
    if (_progressTimer) clearTimeout(_progressTimer);
    _progressTimer = setTimeout(() => {
      _progressTimer = null;
      _writeProgress(bookId, chapterIndex, pageIndex).catch(() => {});
    }, 500);
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
    } catch (_) {}
  }

  async function getReadingProgress(bookId, chapterIndex) {
    const identity = _collectProgressIdentity(bookId, chapterIndex);
    const existing = await _findProgressRow(identity);
    if (!existing) return null;
    const idx = Number(existing.last_page_index);
    return Number.isFinite(idx) && idx >= 0 ? { pageIndex: idx, updatedAt: existing.updated_at || null } : null;
  }

  function _handleAuthChanged(e) {
    const { signedIn, source } = e.detail || {};
    if (signedIn && source !== 'init-unconfigured' && source !== 'init-client-error') {
      setTimeout(() => { _onSignIn().catch(() => {}); }, 0);
    }
  }

  function _handlePrefsChanged() {
    if (!_ready()) return;
    if (_prefsSyncTimer) clearTimeout(_prefsSyncTimer);
    _prefsSyncTimer = setTimeout(() => {
      _prefsSyncTimer = null;
      syncSettings().catch(() => {});
    }, 400);
  }

  try { document.addEventListener('rc:auth-changed', _handleAuthChanged); } catch (_) {}
  try { document.addEventListener('rc:prefs-changed', _handlePrefsChanged); } catch (_) {}

  return {
    scheduleProgressSync,
    getReadingProgress,
    syncSettings,
    getSettings,
  };
})();
