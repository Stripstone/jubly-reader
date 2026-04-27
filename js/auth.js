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

  function _deriveDisplayName(user) {
    const meta = user && user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
    const explicit = String(meta.full_name || meta.name || '').trim();
    if (explicit) return explicit;
    const email = String(user && user.email || '').trim();
    if (!email) return '';
    return email.split('@')[0] || email;
  }

  function _safeUser(user) {
    return user ? { id: user.id, email: user.email || '', displayName: _deriveDisplayName(user), user_metadata: user.user_metadata || {} } : null;
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

    try {
      const params = new URLSearchParams(window.location.search || '');
      const view = String(params.get('view') || '').trim().toLowerCase();
      const authState = String(params.get('auth') || '').trim().toLowerCase();
      let type = String(params.get('type') || '').trim().toLowerCase();
      if (!type) {
        try {
          const hashParams = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
          type = String(hashParams.get('type') || '').trim().toLowerCase();
        } catch (_) {}
      }
      const isRecoveryReturn = view === 'reset-password' || type === 'recovery';
      const isAuthReturn = view === 'auth-callback' || authState === 'verified';
      if (isAuthReturn && !isRecoveryReturn && _session) {
        // Supabase may create a browser session during email confirmation.
        // Jubly's verified continuation contract returns to Login first so paid
        // intent is preserved but the user explicitly signs in before checkout.
        try { await _client.auth.signOut({ scope: 'local' }); } catch (_) { try { await _client.auth.signOut(); } catch (__) {} }
        _session = null;
        _user = null;
      }
    } catch (_) {}

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


  function _emailValidationMessage(email) {
    const value = String(email || '').trim();
    if (!value || value.length > 254) return 'Enter a valid email address.';
    const at = value.indexOf('@');
    if (at <= 0 || at !== value.lastIndexOf('@')) return 'Enter a valid email address.';

    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    if (!local || !domain || local.length > 64) return 'Enter a valid email address.';
    if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return 'Enter a valid email address.';
    if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return 'Enter a valid email address.';

    if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return 'Enter a valid email address.';
    const labels = domain.split('.');
    if (labels.length < 2) return 'Enter a valid email address.';
    for (const label of labels) {
      if (!label || label.length > 63) return 'Enter a valid email address.';
      if (label.startsWith('-') || label.endsWith('-')) return 'Enter a valid email address.';
      if (!/^[A-Za-z0-9-]+$/.test(label)) return 'Enter a valid email address.';
    }
    const tld = labels[labels.length - 1] || '';
    if (!/^[A-Za-z]{2,24}$/.test(tld)) return 'Enter a valid email address.';
    return '';
  }

  function looksLikeEmail(email) {
    return !_emailValidationMessage(email);
  }

  async function inspectEmail(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!looksLikeEmail(normalized)) {
      return { ok: false, exists: false, error: { message: 'Enter a valid email address.' } };
    }
    try {
      const resp = await fetch(`/api/app?kind=auth-email-check&email=${encodeURIComponent(normalized)}`, { cache: 'no-store' });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data || typeof data !== 'object') {
        return { ok: false, exists: false, error: { message: 'Unable to verify email yet.' } };
      }
      return { ok: !!data.ok, exists: !!data.exists, error: data.ok ? null : { message: String(data.error || 'Unable to verify email yet.') } };
    } catch (_) {
      return { ok: false, exists: false, error: { message: 'Unable to verify email yet.' } };
    }
  }

  async function signUp(email, password, username, authOptions) {
    if (!_client) return { error: { message: 'Auth not initialized — check Supabase configuration.' } };
    const normalizedEmail = String(email || '').trim();
    const emailError = _emailValidationMessage(normalizedEmail);
    if (emailError) return { error: { message: emailError } };
    const options = {};
    const requestedRedirect = authOptions && typeof authOptions === 'object' ? String(authOptions.emailRedirectTo || '').trim() : '';
    const redirect = requestedRedirect || String(_config && _config.authRedirectUrl || '').trim();
    if (redirect) options.emailRedirectTo = redirect;
    const name = String(username || '').trim();
    if (name) options.data = { full_name: name, name };
    return _client.auth.signUp({ email: normalizedEmail, password, options });
  }

  async function signIn(email, password) {
    if (!_client) return { error: { message: 'Auth not initialized — check Supabase configuration.' } };
    const normalizedEmail = String(email || '').trim();
    const emailError = _emailValidationMessage(normalizedEmail);
    if (emailError) return { error: { message: emailError } };
    return _client.auth.signInWithPassword({ email: normalizedEmail, password });
  }

  async function resendSignupVerification(email, authOptions) {
    if (!_client) return { error: { message: 'Auth not initialized — check Supabase configuration.' } };
    const normalizedEmail = String(email || '').trim();
    const emailError = _emailValidationMessage(normalizedEmail);
    if (emailError) return { error: { message: emailError } };
    if (!_client.auth || typeof _client.auth.resend !== 'function') {
      return { error: { message: 'Verification resend is not available in this environment.' } };
    }

    const options = {};
    const requestedRedirect = authOptions && typeof authOptions === 'object' ? String(authOptions.emailRedirectTo || '').trim() : '';
    const redirect = requestedRedirect || String(_config && _config.authRedirectUrl || '').trim();
    if (redirect) options.emailRedirectTo = redirect;

    return _client.auth.resend({
      type: 'signup',
      email: normalizedEmail,
      options,
    });
  }

  async function requestPasswordReset(email, authOptions) {
    if (!_client) return { error: { message: 'Auth not initialized — check Supabase configuration.' } };
    const normalizedEmail = String(email || '').trim();
    const emailError = _emailValidationMessage(normalizedEmail);
    if (emailError) return { error: { message: emailError } };
    if (!_client.auth || typeof _client.auth.resetPasswordForEmail !== 'function') {
      return { error: { message: 'Password reset is not available in this environment.' } };
    }

    const options = {};
    const requestedRedirect = authOptions && typeof authOptions === 'object'
      ? String(authOptions.redirectTo || authOptions.emailRedirectTo || '').trim()
      : '';
    const fallbackRedirect = String((_config && (_config.authCallbackUrl || _config.resetPasswordRedirectUrl || (_config.appBaseUrl ? `${String(_config.appBaseUrl).replace(/\/$/, '')}/?view=auth-callback` : ''))) || '').trim();
    const redirect = requestedRedirect || fallbackRedirect;
    if (redirect) options.redirectTo = redirect;

    return _client.auth.resetPasswordForEmail(normalizedEmail, options);
  }

  async function signOut() {
    if (!_client) return { ok: true };
    let signOutError = null;
    try {
      const result = await _client.auth.signOut();
      if (result && result.error) signOutError = result.error;
    } catch (e) {
      signOutError = e;
    }
    try { if (window.rcHelp && typeof window.rcHelp.shutdown === 'function') window.rcHelp.shutdown(); } catch (_) {}
    return signOutError
      ? { ok: false, error: String(signOutError.message || 'Sign-out failed.') }
      : { ok: true };
  }

  async function updateDisplayName(displayName) {
    if (!_client) return { error: { message: 'Auth not initialized — check Supabase configuration.' } };
    const nextName = String(displayName || '').trim();
    if (!nextName) return { error: { message: 'Username is required.' } };
    const result = await _client.auth.updateUser({ data: { full_name: nextName, name: nextName } });
    if (!result?.error && result?.data?.user) {
      _user = result.data.user;
      if (_session && typeof _session === 'object') _session = { ..._session, user: result.data.user };
      _emitAuthChanged('profile-update');
    }
    return result;
  }

  async function changePassword(nextPassword) {
    if (!_client) return { error: { message: 'Auth not initialized — check Supabase configuration.' } };
    const password = String(nextPassword || '');
    if (password.length < 8) return { error: { message: 'Password must be at least 8 characters.' } };
    const result = await _client.auth.updateUser({ password });
    if (!result?.error && result?.data?.user) {
      _user = result.data.user;
      if (_session && typeof _session === 'object') _session = { ..._session, user: result.data.user };
      _emitAuthChanged('password-update');
    }
    return result;
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
    resendSignupVerification,
    requestPasswordReset,
    signOut,
    looksLikeEmail,
    inspectEmail,
    updateDisplayName,
    changePassword,
  };
})();

window.rcAuth.init();
