// js/auth.js
// ─────────────────────────────────────────────────────────────────────────────
// Pass 4: Supabase auth core.
//
// window.rcAuth owns:
//   - Supabase client bootstrap (via /api/public-config)
//   - auth state: session, user
//   - sign up / sign in / sign out
//   - rc:auth-changed event emission
//   - getClient() for sync seam access (js/sync.js)
//
// window.rcAuth does NOT own reading progress or settings persistence.
// Those belong to js/sync.js which listens for rc:auth-changed and operates
// against the client exposed by getClient().
//
// Interim (Pass 4):
//   Email/password auth only. Google OAuth is out of scope for this pass.
//   Entitlement resolution from Supabase (Stripe-backed plan) is Pass 5.
// ─────────────────────────────────────────────────────────────────────────────

window.rcAuth = (function () {
  let _client      = null;
  let _session     = null;
  let _user        = null;
  let _initDone    = false;
  let _initPromise = null;

  // ── Internal helpers ────────────────────────────────────────────────────

  function _emit(name, detail) {
    const ev = { detail };
    try { document.dispatchEvent(new CustomEvent(name, ev)); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent(name, ev));   } catch (_) {}
  }

  async function _fetchConfig() {
    try {
      const resp = await fetch('/api/public-config', { cache: 'no-store' });
      if (!resp.ok) return null;
      const data = await resp.json();
      return data && data.configured ? data : null;
    } catch (_) { return null; }
  }

  // ── Init ────────────────────────────────────────────────────────────────

  async function _doInit() {
    if (_initDone) return;
    _initDone = true;

    const config = await _fetchConfig();
    if (!config) {
      // Supabase not configured for this environment.
      // Free-path reading still works; durable sync does not run.
      _emit('rc:auth-changed', {
        user: null, session: null, signedIn: false, source: 'init-unconfigured',
      });
      return;
    }

    try {
      // window.supabase is the UMD global from the CDN script loaded in index.html.
      _client = window.supabase.createClient(config.url, config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
    } catch (_e) {
      _emit('rc:auth-changed', {
        user: null, session: null, signedIn: false, source: 'init-client-error',
      });
      return;
    }

    // Restore existing session from Supabase's own localStorage keys.
    try {
      const { data } = await _client.auth.getSession();
      _session = data.session ?? null;
      _user    = _session?.user ?? null;
    } catch (_) {}

    _emit('rc:auth-changed', {
      user:     _user ? { id: _user.id, email: _user.email } : null,
      session:  _session,
      signedIn: !!_user,
      source:   'init',
    });

    // Watch for future auth changes (token refresh, sign-out from another tab).
    _client.auth.onAuthStateChange((event, session) => {
      _session = session ?? null;
      _user    = _session?.user ?? null;
      _emit('rc:auth-changed', {
        user:     _user ? { id: _user.id, email: _user.email } : null,
        session:  _session,
        signedIn: !!_user,
        source:   event,
      });
    });
  }

  function init() {
    if (_initPromise) return _initPromise;
    _initPromise = _doInit().catch(() => {});
    return _initPromise;
  }

  // ── Public auth operations ───────────────────────────────────────────────

  function isSignedIn() { return !!_user; }

  function getUser() {
    return _user ? { id: _user.id, email: _user.email } : null;
  }

  function getSession() {
    return _session ? { ..._session } : null;
  }

  // Exposed for the sync seam (js/sync.js) only.
  // Other callers should use the auth operation methods below.
  function getClient() { return _client; }

  async function signUp(email, password) {
    if (!_client) return { error: { message: 'Auth not initialized — check Supabase configuration.' } };
    return _client.auth.signUp({ email, password });
  }

  async function signIn(email, password) {
    if (!_client) return { error: { message: 'Auth not initialized — check Supabase configuration.' } };
    return _client.auth.signInWithPassword({ email, password });
  }

  async function signOut() {
    if (!_client) return;
    try { await _client.auth.signOut(); } catch (_) {}
  }

  // ── Public API ──────────────────────────────────────────────────────────
  return {
    init,
    isSignedIn,
    getUser,
    getSession,
    getClient,
    signUp,
    signIn,
    signOut,
  };
})();

// Auto-initialize on load.
// Shell and runtime (including js/sync.js) listen for rc:auth-changed.
window.rcAuth.init();
