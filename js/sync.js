// js/sync.js
// ─────────────────────────────────────────────────────────────────────────────
// Pass 4: Durable sync seam.
//
// window.rcSync owns:
//   - reading progress sync (write on navigation, read on book open)
//   - settings/prefs sync (write on change, read on sign-in)
//   - sync scheduling and debounce
//   - Supabase table operations for durable user state
//
// This module does NOT own auth state or the Supabase client.
// It borrows the authenticated client from rcAuth.getClient() and reads
// the current user from rcAuth.getUser(). Auth events come via rc:auth-changed.
//
// Table shape is provisional — not frozen here. The progress schema maps
// to runtime source truth (bookId, chapterIndex, pageIndex) but the exact
// column names and composite key should be verified against the live
// Supabase schema before marking this seam stable.
//
// Interim (Pass 4):
//   Durable sync runs only when rcAuth is configured and the user is signed in.
//   Local reading behavior is unaffected when signed out or when Supabase
//   is not configured for the current environment.
// ─────────────────────────────────────────────────────────────────────────────

window.rcSync = (function () {
  let _progressTimer = null;

  // ── Internal helpers ────────────────────────────────────────────────────

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

  // ── Reading progress ────────────────────────────────────────────────────

  // Called after each page navigation. Debounced 500 ms to avoid flooding
  // on rapid next/prev presses. bookId and chapterIndex identify the source;
  // pageIndex is the 0-based page the user reached.
  function scheduleProgressSync(bookId, chapterIndex, pageIndex) {
    if (!_ready()) return;
    if (_progressTimer) clearTimeout(_progressTimer);
    _progressTimer = setTimeout(() => {
      _progressTimer = null;
      _writeProgress(bookId, chapterIndex, pageIndex);
    }, 500);
  }

  async function _writeProgress(bookId, chapterIndex, pageIndex) {
    const c = _client();
    const u = _user();
    if (!c || !u) return;
    try {
      await c.from('reading_progress').upsert({
        user_id:       u.id,
        book_id:       String(bookId || ''),
        chapter_index: Number.isFinite(Number(chapterIndex)) ? Number(chapterIndex) : -1,
        page_index:    Number.isFinite(Number(pageIndex)) && Number(pageIndex) >= 0 ? Number(pageIndex) : 0,
        updated_at:    new Date().toISOString(),
      }, { onConflict: 'user_id,book_id,chapter_index' });
    } catch (_) {}
  }

  // Returns { pageIndex, updatedAt } or null if no record exists.
  // Caller decides whether to apply the durable position.
  async function getReadingProgress(bookId, chapterIndex) {
    const c = _client();
    const u = _user();
    if (!c || !u) return null;
    try {
      const { data, error } = await c
        .from('reading_progress')
        .select('page_index, updated_at')
        .eq('user_id',       u.id)
        .eq('book_id',       String(bookId || ''))
        .eq('chapter_index', Number.isFinite(Number(chapterIndex)) ? Number(chapterIndex) : -1)
        .maybeSingle();
      if (error || !data) return null;
      const idx = Number(data.page_index);
      return Number.isFinite(idx) && idx >= 0 ? { pageIndex: idx, updatedAt: data.updated_at } : null;
    } catch (_) { return null; }
  }

  // ── Settings / preferences ──────────────────────────────────────────────
  // prefs shape: { theme: {...}, appearance: {...} }
  // Callers snapshot current local prefs before passing; rcSync writes them.

  async function syncSettings(prefs) {
    const c = _client();
    const u = _user();
    if (!c || !u || !prefs || typeof prefs !== 'object') return;
    try {
      await c.from('user_settings').upsert({
        user_id:    u.id,
        prefs:      prefs,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    } catch (_) {}
  }

  // Returns stored prefs object or null if none exist yet.
  async function getSettings() {
    const c = _client();
    const u = _user();
    if (!c || !u) return null;
    try {
      const { data, error } = await c
        .from('user_settings')
        .select('prefs')
        .eq('user_id', u.id)
        .maybeSingle();
      if (error || !data) return null;
      return data.prefs && typeof data.prefs === 'object' ? data.prefs : null;
    } catch (_) { return null; }
  }

  // ── Sign-in handler: pull and apply durable settings ───────────────────
  // Called automatically when rc:auth-changed fires with signedIn: true.
  // Pulls settings from Supabase and applies via rcTheme / rcAppearance.
  // If no durable settings exist yet, pushes current local settings to seed them.

  async function _onSignIn() {
    // Pull durable settings.
    const remote = await getSettings();

    if (remote) {
      // Apply remote theme prefs if present.
      try {
        if (remote.theme && window.rcTheme && typeof window.rcTheme.applyPrefs === 'function') {
          window.rcTheme.applyPrefs(remote.theme);
        }
      } catch (_) {}
      // Apply remote appearance prefs if present.
      try {
        if (remote.appearance && window.rcAppearance && typeof window.rcAppearance.applyPrefs === 'function') {
          window.rcAppearance.applyPrefs(remote.appearance);
        }
      } catch (_) {}
    } else {
      // No remote settings yet — push current local prefs to seed the record.
      try {
        const localPrefs = _collectLocalPrefs();
        if (localPrefs) await syncSettings(localPrefs);
      } catch (_) {}
    }
  }

  function _collectLocalPrefs() {
    const prefs = {};
    try {
      if (window.rcTheme && typeof window.rcTheme.getPrefs === 'function') {
        prefs.theme = window.rcTheme.getPrefs();
      }
    } catch (_) {}
    try {
      if (window.rcAppearance && typeof window.rcAppearance.getPrefs === 'function') {
        prefs.appearance = window.rcAppearance.getPrefs();
      }
    } catch (_) {}
    return Object.keys(prefs).length ? prefs : null;
  }

  // ── Listen for auth events ──────────────────────────────────────────────

  function _handleAuthChanged(e) {
    const { signedIn, source } = e.detail || {};
    if (signedIn && source !== 'init-unconfigured' && source !== 'init-client-error') {
      // Give runtime a tick to finish applying session state before pulling prefs.
      setTimeout(() => { _onSignIn().catch(() => {}); }, 0);
    }
  }

  try {
    document.addEventListener('rc:auth-changed', _handleAuthChanged);
  } catch (_) {}

  // ── Listen for prefs-changed events ────────────────────────────────────
  // state.js dispatches rc:prefs-changed after every saveThemePrefs /
  // saveAppearancePrefs call. rcSync pushes the combined snapshot to Supabase
  // when the user is signed in. No-ops silently when signed out.

  let _prefsSyncTimer = null;

  function _handlePrefsChanged() {
    if (!_ready()) return;
    // Debounce: theme + appearance saves can fire in quick succession.
    if (_prefsSyncTimer) clearTimeout(_prefsSyncTimer);
    _prefsSyncTimer = setTimeout(() => {
      _prefsSyncTimer = null;
      const prefs = _collectLocalPrefs();
      if (prefs) syncSettings(prefs).catch(() => {});
    }, 400);
  }

  try {
    document.addEventListener('rc:prefs-changed', _handlePrefsChanged);
  } catch (_) {}

  // ── Public API ──────────────────────────────────────────────────────────
  return {
    scheduleProgressSync,
    getReadingProgress,
    syncSettings,
    getSettings,
  };
})();
