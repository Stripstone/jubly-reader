// js/help.js
// Browser-compatible support wiring for Pass 6.
(function () {
  const APP_ID = 'tcbyw789';
  let _loaderPromise = null;

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

  async function syncIdentity() {
    const Intercom = await loadMessenger();
    if (typeof Intercom !== 'function') return false;
    const user = (window.rcAuth && typeof window.rcAuth.getUser === 'function') ? window.rcAuth.getUser() : null;
    const session = (window.rcAuth && typeof window.rcAuth.getSession === 'function') ? window.rcAuth.getSession() : null;
    const payload = { app_id: APP_ID, hide_default_launcher: true };
    if (user && user.id) {
      payload.user_id = user.id;
      payload.email = user.email || '';
      payload.name = deriveName(user);
      const createdAt = Number(session && session.user && session.user.created_at ? Date.parse(session.user.created_at) / 1000 : 0);
      if (Number.isFinite(createdAt) && createdAt > 0) payload.created_at = Math.floor(createdAt);
    }
    try {
      Intercom('boot', payload);
    } catch (_) {
      try { Intercom('update', payload); } catch (_) { return false; }
    }
    return true;
  }

  async function openMessenger() {
    const ok = await syncIdentity();
    if (!ok) return false;
    try { window.Intercom('show'); } catch (_) { return false; }
    return true;
  }

  function shutdownMessenger() {
    try { if (typeof window.Intercom === 'function') window.Intercom('shutdown'); } catch (_) {}
  }

  window.rcHelp = {
    syncIdentity,
    openChat: openMessenger,
    openFeedback: openMessenger,
    shutdown: shutdownMessenger,
  };
})();
