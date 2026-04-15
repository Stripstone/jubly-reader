// js/interaction.js
// ─────────────────────────────────────────────────────────────────────────────
// Shared interaction banner.
//
// The single surface where the shell surfaces pending, success, and
// recoverable-error states for async operations. Shell presents — it does
// NOT own auth, billing, or runtime truth.
//
// Rules (from product docs):
//   - never stack multiple banners
//   - newest higher-severity message replaces the older one
//   - same-key message always replaces, regardless of severity
//   - pending can upgrade to success or error
//   - success auto-dismisses (~2.2s)
//   - recoverable error stays visible until dismissed or retried
//   - blocking error keeps the action locked until the user acts
//   - copy must describe the user-visible state, not an internal cause
//
// API:
//   window.rcInteraction.pending(key, message)
//   window.rcInteraction.success(key, message)
//   window.rcInteraction.error(key, message, { actions?: [{label, onClick}], blocking?: bool })
//   window.rcInteraction.clear(key)
//   window.rcInteraction.clearAll()
// ─────────────────────────────────────────────────────────────────────────────

window.rcInteraction = (function () {

  // Severity order — higher number wins when two keys compete for the banner
  const SEV = { pending: 0, success: 1, error: 2, blocking: 3 };

  // Single active slot
  let _active = null;  // { key, sevName, severity, message, actions, timer }
  let _el = null;

  // ── DOM ───────────────────────────────────────────────────────────────────

  function _ensureEl() {
    if (_el && _el.isConnected) return _el;
    _el = document.createElement('div');
    _el.id = 'rc-interaction-banner';
    _el.setAttribute('role', 'status');
    _el.setAttribute('aria-live', 'polite');
    _el.setAttribute('aria-atomic', 'true');
    document.body.appendChild(_el);
    return _el;
  }

  function _render() {
    const el = _ensureEl();
    if (!_active) {
      el.removeAttribute('data-sev');
      el.classList.remove('rc-banner--visible');
      el.innerHTML = '';
      return;
    }

    el.setAttribute('data-sev', _active.sevName);
    el.classList.add('rc-banner--visible');
    el.innerHTML = '';

    const msgEl = document.createElement('span');
    msgEl.className = 'rc-banner__message';
    msgEl.textContent = _active.message;
    el.appendChild(msgEl);

    if (_active.actions && _active.actions.length) {
      const actionsEl = document.createElement('span');
      actionsEl.className = 'rc-banner__actions';
      _active.actions.forEach((action) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rc-banner__action-btn';
        btn.textContent = action.label;
        btn.addEventListener('click', () => {
          try { action.onClick(); } catch (_) {}
        });
        actionsEl.appendChild(btn);
      });
      el.appendChild(actionsEl);
    }

    // Dismiss is always available except on blocking errors
    if (_active.sevName !== 'blocking') {
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'rc-banner__close';
      closeBtn.setAttribute('aria-label', 'Dismiss');
      closeBtn.textContent = '×';
      const capturedKey = _active.key;
      closeBtn.addEventListener('click', () => clear(capturedKey));
      el.appendChild(closeBtn);
    }
  }

  // ── Core show logic ───────────────────────────────────────────────────────

  function _show(key, sevName, message, actions) {
    const sev = SEV[sevName] ?? 0;

    // A different key at higher severity keeps its banner — do not override
    if (_active && _active.key !== key && sev < _active.severity) return;

    // Clear any existing auto-dismiss timer
    if (_active && _active.timer) {
      clearTimeout(_active.timer);
      _active = Object.assign({}, _active, { timer: null });
    }

    _active = {
      key,
      sevName,
      severity: sev,
      message,
      actions: Array.isArray(actions) ? actions : [],
      timer: null,
    };

    if (sevName === 'success') {
      _active.timer = setTimeout(() => {
        if (_active && _active.key === key && _active.sevName === 'success') {
          _active = null;
          _render();
        }
      }, 2200);
    }

    _render();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function pending(key, message) {
    _show(key, 'pending', message);
  }

  function success(key, message) {
    _show(key, 'success', message);
  }

  function error(key, message, opts) {
    const blocking = !!(opts && opts.blocking);
    const actions = opts && Array.isArray(opts.actions) ? opts.actions : [];
    _show(key, blocking ? 'blocking' : 'error', message, actions);
  }

  function clear(key) {
    if (!_active) return;
    if (!key || _active.key === key) {
      if (_active.timer) clearTimeout(_active.timer);
      _active = null;
      _render();
    }
  }

  function clearAll() {
    if (_active && _active.timer) clearTimeout(_active.timer);
    _active = null;
    _render();
  }

  return { pending, success, error, clear, clearAll };
})();
