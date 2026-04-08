// js/auth.js
// ─────────────────────────────────────────────────────────────────────────────
// Pass 4/5: Supabase auth core.
//
// window.rcAuth owns:
//   - Supabase client bootstrap (via /api/app?kind=public-config)
//   - auth hydration / ready state
//   - auth state: session, user
//   - sign up / sign in / sign out
//   - rc:auth-changed event emission
//   - getClient() for sync seam access (js/sync.js)
//
// window.rcAuth does NOT own reading progress or settings persistence.
// Those belong to js/sync.js which listens for rc:auth-changed and operates
// against the client exposed by getClient().
//
// Email/password auth is the active path here. Billing / entitlement truth is
// resolved server-side in Pass 5 and consumed through /api/app?kind=runtime-config.
// ─────────────────────────────────────────────────────────────────────────────

window.rcAuth = (function () {
  let _client = null;
  let _session = null;
  let _user = null;
  let _config = null;
  let _configured = false;
  let _ready = false;
  let _initDone = false;
  let _initPromise = null;

  function _emit(name, detail) {
    const ev = { detail };
    try { document.dispatchEvent(new CustomEvent(name, ev)); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent(name, ev)); } catch (_) {}
  }

  function _safeUser(user) {
    return user ? { id: user.id, email: user.email || '' } : null;
  }

  function _emitAuthChanged(source) {
    _emit('rc:auth-changed', {
      user: _safeUser(_user),
      session: _session,
      signedIn: !!_user,
      configured: _configured,
      ready: _ready,
      source: source || 'unknown',
    });
  }

  async function _fetchConfig() {
    try {
      const resp = await fetch('/api/app?kind=public-config', { cache: 'no-store' });
      if (!resp.ok) return null;
      const data = await resp.json().catch(() => null);
      return data && typeof data === 'object' ? data : null;
    } catch (_) {
      return null;
    }
  }

  async function _doInit() {
    if (_initDone) return;
    _initDone = true;

    _config = await _fetchConfig();
    _configured = !!(_config && _config.configured && _config.url && _config.anonKey);

    if (!_configured) {
      _ready = true;
      _emitAuthChanged('init-unconfigured');
      return;
    }

    try {
      _client = window.supabase.createClient(_config.url, _config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
    } catch (_) {
      _ready = true;
      _emitAuthChanged('init-client-error');
      return;
    }

    try {
      const { data } = await _client.auth.getSession();
      _session = data && data.session ? data.session : null;
      _user = _session && _session.user ? _session.user : null;
    } catch (_) {
      _session = null;
      _user = null;
    }

    _ready = true;
    _emitAuthChanged('init');

    _client.auth.onAuthStateChange((event, session) => {
      _session = session || null;
      _user = _session && _session.user ? _session.user : null;
      _ready = true;
      _emitAuthChanged(event || 'auth-change');
    });
  }

  function init() {
    if (_initPromise) return _initPromise;
    _initPromise = _doInit().catch(() => {
      _ready = true;
      _emitAuthChanged('init-error');
    });
    return _initPromise;
  }

  function isReady() { return !!_ready; }
  function isConfigured() { return !!_configured; }
  function isSignedIn() { return !!_user; }
  function getUser() { return _safeUser(_user); }
  function getSession() { return _session ? { ..._session } : null; }
  function getAccessToken() {
    try { return _session && typeof _session.access_token === 'string' ? _session.access_token : ''; } catch (_) { return ''; }
  }
  function getClient() { return _client; }
  function getConfig() { return _config ? { ..._config } : null; }

  async function signUp(email, password) {
    if (!_client) return { error: { message: 'Auth not initialized — check Supabase configuration.' } };
    const options = {};
    const redirect = String(_config && _config.authRedirectUrl || '').trim();
    if (redirect) options.emailRedirectTo = redirect;
    return _client.auth.signUp({ email, password, options });
  }

  async function signIn(email, password) {
    if (!_client) return { error: { message: 'Auth not initialized — check Supabase configuration.' } };
    return _client.auth.signInWithPassword({ email, password });
  }

  async function signOut() {
    if (!_client) return;
    try { await _client.auth.signOut(); } catch (_) {}
  }

  return {
    init,
    isReady,
    isConfigured,
    isSignedIn,
    getUser,
    getSession,
    getAccessToken,
    getClient,
    getConfig,
    signUp,
    signIn,
    signOut,
  };
})();

window.rcAuth.init();
