// js/help.js
// Browser-compatible support wiring for Pass 6.
(function () {
  const APP_ID = 'tcbyw789';
  let _loaderPromise = null;
  let _booted = false;

  function loadMessenger() {
    if (_loaderPromise) return _loaderPromise;
    _loaderPromise = new Promise((resolve) => {
      if (typeof window.Intercom === 'function') {
        resolve(window.Intercom);
        return;
      }
      const script = document.createElement('script');
      script.async = true;
      script.src = `https://widget.intercom.io/widget/${APP_ID}`;
      script.onload = () => resolve(window.Intercom || null);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
    return _loaderPromise;
  }

  function deriveName(user) {
    const email = String((user && user.email) || '').trim();
    if (!email) return 'Visitor';
    return email.split('@')[0] || 'Visitor';
  }

  function buildPayload() {
    const user = (window.rcAuth && typeof window.rcAuth.getUser === 'function') ? window.rcAuth.getUser() : null;
    const session = (window.rcAuth && typeof window.rcAuth.getSession === 'function') ? window.rcAuth.getSession() : null;
    const payload = { app_id: APP_ID, hide_default_launcher: true };
    if (user && user.id) {
      payload.user_id = user.id;
      payload.email = user.email || '';
      payload.name = user.displayName || deriveName(user);
      const createdAt = Number(session && session.user && session.user.created_at ? Date.parse(session.user.created_at) / 1000 : 0);
      if (Number.isFinite(createdAt) && createdAt > 0) payload.created_at = Math.floor(createdAt);
    }
    return payload;
  }

  async function syncIdentity() {
    if (!_booted) return true;
    const Intercom = await loadMessenger();
    if (typeof Intercom !== 'function') return false;
    try {
      Intercom('update', buildPayload());
      return true;
    } catch (_) {
      return false;
    }
  }

  async function ensureBooted() {
    const Intercom = await loadMessenger();
    if (typeof Intercom !== 'function') return false;
    const payload = buildPayload();
    if (_booted) {
      try { Intercom('update', payload); } catch (_) {}
      return true;
    }
    try {
      Intercom('boot', payload);
      _booted = true;
      return true;
    } catch (_) {
      return false;
    }
  }

  async function openMessenger() {
    const ok = await ensureBooted();
    if (!ok) return false;
    try { window.Intercom('show'); } catch (_) { return false; }
    return true;
  }

  function shutdown() {
    try { if (typeof window.Intercom === 'function') window.Intercom('shutdown'); } catch (_) {}
    _booted = false;
  }

  window.rcHelp = {
    syncIdentity,
    openChat: openMessenger,
    openFeedback: openMessenger,
    shutdown,
  };
})();
