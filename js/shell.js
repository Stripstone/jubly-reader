// ============================================================
// jubly — Shell + App bridge
// ============================================================
//
// PRE-RUNTIME APPEARANCE BOOTSTRAP RETIRED:
//   index.html is now the only first-paint appearance writer. Runtime/state.js
//   adopts that boot-applied mode. Shell must not apply an appearance fallback
//   or reset appearance during boot/auth transitions.

// ============================================================
// PERMANENT (shell navigation and app wiring):
// ============================================================
//
//   showSection(), initFocusMode(), switchTab(), openModal(),
//   closeModal(), setTheme(), handleExplorerSwatch(),
//   setTier(), updateTierPill(), handlePausePlay(),
//   handleAutoplayToggle(), updateProgressBar(),
//   showSessionComplete(), startReading()
//
// ============================================================

    // =========================================================================
    // SLICE 7 MODULE BOUNDARY 1/6 — Shell Surface Contract & Release Decision
    // Logical boundary declaration only — code not physically separated yet.
    // Primary content: showSection(), releaseDashboardSectionVisibility(),
    //   releaseStandardSectionVisibility(), surface state machine, boot release
    //   transaction, interaction banner. Theme/appearance shell and reading
    //   chrome (TTS bridge, bottom-bar controls) continue later in this file
    //   as part of the presentation layer for this same logical module.
    // =========================================================================

    // ── Boot timing probe — dev-only, removable after Bucket E proof ────────────
    // Proves whether shell's rc:runtime-policy-changed listener is always attached
    // before state.js fires its initial policy event. Required before touching the
    // 500ms boot-order bridge (Bucket E, RUNTIME_PROTECTION_LEDGER.md §15).
    //
    // To enable:  localStorage.setItem('rcBootProbe', '1')  then hard-refresh.
    // To disable: localStorage.removeItem('rcBootProbe')     then hard-refresh.
    // Output: '[rcBootProbe] Boot timing report' in the browser console.
    // Also written to window.__rcBootProbeResult for copy/paste.
    //
    // Remove this block after Bucket E retirement conditions are met.
    const _bootProbe = (function () {
        const enabled = (function () {
            try { return typeof localStorage !== 'undefined' && localStorage.getItem('rcBootProbe') === '1'; } catch (_) { return false; }
        })();
        if (!enabled) return { mark: function () {}, report: function () {} };
        const _marks = [];
        function mark(tag, extra) {
            try { _marks.push(Object.assign({ tag, tMs: Math.round(performance.now()) }, extra || {})); } catch (_) {}
        }
        function report() {
            try {
                const out = { probe: 'rcBootProbe v1', scenario: 'cold-boot', marks: _marks };
                console.group('[rcBootProbe] Boot timing report — copy the JSON below for Bucket E evidence:');
                console.log(JSON.stringify(out, null, 2));
                console.groupEnd();
                window.__rcBootProbeResult = out;
            } catch (_) {}
        }
        return { mark, report };
    })();
    // ─────────────────────────────────────────────────────────────────────────────

    // ── Section routing ──────────────────────────────────────────
    const ALL_SECTIONS     = ['landing-page', 'public-onboarding', 'login-page', 'dashboard', 'profile-page', 'reading-mode'];
    const PUBLIC_SAMPLE_BOOK_ID = 'BOOK_ReadingTraining';
    const SIDEBAR_SECTIONS = ['dashboard', 'profile-page'];
    let _currentSection = 'landing-page';
    let _publicIntroLibraryVisible = false;
    let _publicSampleSessionActive = false;
    const PUBLIC_ONBOARDING_DEFAULTS = Object.freeze({ goal: 'finish', voice: 'mara', theme: 'default', speed: 1 });
    let _publicOnboardingChoices = Object.assign({}, PUBLIC_ONBOARDING_DEFAULTS);
    let _publicOnboardingTimer = null;
    let _shellAuthBootstrapped = false;


    let _bootReleaseComplete = false;
    let _bootPendingMessageTimer = null;
    let _libraryPendingBannerTimer = null;
    let _lastDashboardRelease = {
        requestedSurface: null,
        releasedSurface: null,
        releaseReason: 'boot',
        firstVisibleLibraryState: null,
        source: null,
        ownerReady: false,
        blockedBy: null,
        hiddenSectionOwner: 'releaseDashboardSectionVisibility',
        at: null
    };

// Shell-resident interaction banner
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
//   window.rcInteraction.actions.retry(onClick)
//   window.rcInteraction.actions.refresh()
//   window.rcInteraction.actions.openLogin()
//   window.rcInteraction.actions.dismiss(key)
//   window.rcInteraction.clear(key)
//   window.rcInteraction.clearAll()
// ─────────────────────────────────────────────────────────────────────────────

window.rcInteraction = (function () {

  // Severity order — higher number wins when two keys compete for the banner
  const SEV = { pending: 0, success: 1, error: 2, blocking: 3 };

  // Single active slot
  let _active = null;  // { key, sevName, severity, message, actions, timer }
  let _el = null;

  const PLAYBACK_SURFACE_KEYS = new Set(['tts:cloud-restart']);

  function _isPlaybackSurfaceKey(key) {
    return PLAYBACK_SURFACE_KEYS.has(String(key || ''));
  }

  function _defaultOpenLogin() {
    try {
      if (typeof showSigninPane === 'function') {
        showSigninPane();
        return;
      }
    } catch (_) {}
    try {
      if (typeof showSection === 'function') {
        showSection('login-page');
        return;
      }
    } catch (_) {}
  }

  const actionPresets = {
    retry(onClick) {
      return { label: 'Try again', onClick: typeof onClick === 'function' ? onClick : function () {} };
    },
    refresh() {
      return { label: 'Refresh', onClick: function () { try { window.location.reload(); } catch (_) {} } };
    },
    openLogin(onClick) {
      return { label: 'Open login', onClick: typeof onClick === 'function' ? onClick : _defaultOpenLogin };
    },
    dismiss(key) {
      return { label: 'Dismiss', onClick: function () { clear(key); } };
    },
  };

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

    const hasDismissAction = !!(_active.actions && _active.actions.some((action) => String(action && action.label || '').trim().toLowerCase() === 'dismiss'));

    // Dismiss is always available except on blocking errors or when an explicit
    // Dismiss action button is already present.
    if (_active.sevName !== 'blocking' && !hasDismissAction) {
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
    // Playback notices have a dedicated reading-view surface driven by
    // syncShellPlaybackControls(). Keep them out of the global shell banner.
    if (_isPlaybackSurfaceKey(key)) return;
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
    const actions = opts && Array.isArray(opts.actions) ? opts.actions.slice() : [];
    if (!blocking && actions.length === 0) actions.push(actionPresets.dismiss(key));
    _show(key, blocking ? 'blocking' : 'error', message, actions);
  }

  function clear(key) {
    if (_isPlaybackSurfaceKey(key)) return;
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

  return { pending, success, error, clear, clearAll, actions: actionPresets };
})();



    function isRuntimeAppearanceReady() {
        try {
            if (window.rcAppearance && typeof window.rcAppearance.hasApplied === 'function' && window.rcAppearance.hasApplied()) return true;
        } catch (_) {}
        try {
            return !!(document.body && document.body.getAttribute('data-appearance-ready') === 'true');
        } catch (_) {
            return false;
        }
    }

    function isRuntimeAppearancePainted() {
        try {
            return !!(document.body && document.body.getAttribute('data-appearance-painted') === 'true');
        } catch (_) {
            return false;
        }
    }

    function waitForRuntimeAppearanceReady() {
        return new Promise((resolve) => {
            if (isRuntimeAppearanceReady()) {
                resolve();
                return;
            }
            const onApplied = () => {
                cleanup();
                resolve();
            };
            const cleanup = () => {
                try { document.removeEventListener('rc:appearance-applied', onApplied); } catch (_) {}
            };
            try { document.addEventListener('rc:appearance-applied', onApplied); } catch (_) {}
            if (isRuntimeAppearanceReady()) {
                cleanup();
                resolve();
            }
        });
    }

    function waitForRuntimeAppearancePainted() {
        return new Promise((resolve) => {
            if (isRuntimeAppearancePainted()) {
                resolve();
                return;
            }
            const onPainted = () => {
                cleanup();
                resolve();
            };
            const cleanup = () => {
                try { document.removeEventListener('rc:appearance-painted', onPainted); } catch (_) {}
            };
            try { document.addEventListener('rc:appearance-painted', onPainted); } catch (_) {}
            if (isRuntimeAppearancePainted()) {
                cleanup();
                resolve();
            }
        });
    }

    function waitForBootRevealFrame() {
        return new Promise((resolve) => {
            if (!(window && typeof window.requestAnimationFrame === 'function')) {
                setTimeout(resolve, 0);
                return;
            }
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(resolve);
            });
        });
    }

    function scheduleBootPendingMessage() {
        if (_bootPendingMessageTimer) return;
        _bootPendingMessageTimer = window.setTimeout(() => {
            _bootPendingMessageTimer = null;
            try {
                const copy = document.getElementById('boot-scrim-copy');
                if (!copy) return;
                copy.textContent = 'Checking your account…';
                copy.classList.add('boot-scrim-copy--visible');
            } catch (_) {}
        }, 1200);
    }

    function clearBootPendingMessage() {
        if (_bootPendingMessageTimer) {
            window.clearTimeout(_bootPendingMessageTimer);
            _bootPendingMessageTimer = null;
        }
        try {
            const copy = document.getElementById('boot-scrim-copy');
            if (!copy) return;
            copy.classList.remove('boot-scrim-copy--visible');
            copy.textContent = '';
        } catch (_) {}
    }

    function releaseBootPending() {
        if (_bootReleaseComplete) return;
        _bootReleaseComplete = true;
        clearBootPendingMessage();
        try { document.body.classList.remove('boot-pending'); } catch (_) {}
        try { document.body.classList.remove('auth-hydrating'); } catch (_) {}
        try { markDashboardPendingVisibleIfNeeded('boot-release'); } catch (_) {}
        try { applySignedInAccountControlReadiness('boot-release'); } catch (_) {}
        const scrim = document.getElementById('boot-scrim');
        if (!scrim) return;
        try {
            scrim.setAttribute('aria-hidden', 'true');
            window.setTimeout(() => {
                try { scrim.remove(); } catch (_) {}
            }, 180);
        } catch (_) {}
    }

    let _lastShellRelease = {
        requestedSurface: null,
        releasedSurface: null,
        releaseReason: 'boot',
        blockedBy: null,
        at: null
    };
    // =========================================================================
    // SLICE 7 MODULE BOUNDARY 3/6 — Account-Control Readiness
    // Logical boundary declaration only — code not physically separated yet.
    // Primary content: signed-in control state record, readiness reader,
    //   readiness poll. Auth presentation layer (sign-in/sign-up/sign-out
    //   shell, profile tabs, subscription surface rendering) continues after
    //   the Modal Opener Provenance block below.
    // =========================================================================

    let _accountControlsTransientBlock = null;
    let _lastSignedInAccountReadiness = {
        signedInInteractionReady: false,
        authCallable: false,
        accountControlsEnabled: false,
        visibleAccountControlsEnabled: false,
        blockedBy: 'boot',
        reason: 'boot',
        at: null
    };
    function setInlineBusy(button, busyLabel, enabledLabel, disabled) {
        if (!button) return;
        if (busyLabel) {
            if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent || '';
            button.textContent = busyLabel;
            button.disabled = true;
            return;
        }
        button.textContent = enabledLabel || button.dataset.idleLabel || button.textContent || '';
        delete button.dataset.idleLabel;
        if (typeof disabled === 'boolean') button.disabled = disabled;
    }

    function shellTrailPush(tag, data) {
        try {
            if (!Array.isArray(window.__rcEventTrail)) window.__rcEventTrail = [];
            window.__rcEventTrail.push(Object.assign({ t: new Date().toISOString(), tag }, data || {}));
            if (window.__rcEventTrail.length > 40) window.__rcEventTrail.shift();
            if (typeof updateDiagnostics === 'function') updateDiagnostics();
        } catch (_) {}
    }

    function isAuthedUser() {
        try { return !!(window.rcAuth && typeof window.rcAuth.isSignedIn === 'function' && window.rcAuth.isSignedIn()); } catch (_) { return false; }
    }

    function getAuthUser() {
        try { return window.rcAuth && typeof window.rcAuth.getUser === 'function' ? window.rcAuth.getUser() : null; } catch (_) { return null; }
    }

    function getCurrentVisibleSection() {
        const active = ALL_SECTIONS.find((s) => {
            const el = document.getElementById(s);
            return el && !el.classList.contains('hidden-section');
        });
        return active || _currentSection || 'landing-page';
    }

    function normalizeSection(id) {
        return ALL_SECTIONS.includes(id) ? id : 'landing-page';
    }

    function isIntroLibraryVisible() {
        return !isAuthedUser() && !!_publicIntroLibraryVisible;
    }

    function isPublicAbandonSurface(sectionId) {
        if (isAuthedUser()) return false;
        return sectionId === 'landing-page' || sectionId === 'public-onboarding' || (sectionId === 'dashboard' && isIntroLibraryVisible());
    }

    function isPublicRuntimeSurface(sectionId) {
        const section = normalizeSection(sectionId);
        if (isAuthedUser()) return false;
        return section === 'landing-page' || section === 'public-onboarding' || section === 'reading-mode' || (section === 'dashboard' && isIntroLibraryVisible());
    }

    function readPublicRuntimeBoundaryReport() {
        try {
            if (window.rcSync && typeof window.rcSync.getPublicRuntimeBoundaryReport === 'function') return window.rcSync.getPublicRuntimeBoundaryReport();
        } catch (_) {}
        try {
            if (typeof window.getPublicRuntimeBoundaryReport === 'function') return window.getPublicRuntimeBoundaryReport();
        } catch (_) {}
        return null;
    }

    function ensurePublicRuntimeBeforeRelease(sectionId, reason) {
        if (!isPublicRuntimeSurface(sectionId)) return { allowed: true, report: readPublicRuntimeBoundaryReport() };
        let report = null;
        try {
            if (window.rcSync && typeof window.rcSync.ensurePublicRuntimeBoundary === 'function') {
                report = window.rcSync.ensurePublicRuntimeBoundary(reason || ('shell-release:' + sectionId));
            } else {
                report = readPublicRuntimeBoundaryReport();
            }
        } catch (_) {
            report = readPublicRuntimeBoundaryReport();
        }
        const allowed = !!(report && report.publicRuntimeReady === true);
        if (!allowed) {
            _lastShellRelease = {
                requestedSurface: sectionId,
                releasedSurface: getCurrentVisibleSection(),
                releaseReason: reason || 'shell-release',
                blockedBy: 'publicRuntime',
                at: new Date().toISOString()
            };
            shellTrailPush('public-release-blocked', {
                sectionId,
                reason: reason || 'shell-release',
                report: report || null,
            });
        }
        return { allowed, report };
    }

    function clearPaidIntentForPublicAbandon(sectionId) {
        if (!isPublicAbandonSurface(sectionId)) return;
        try {
            if (window.rcBilling && typeof window.rcBilling.clearPendingPlan === 'function') window.rcBilling.clearPendingPlan();
        } catch (_) {}
    }

    function resolveSectionForAuth(id) {
        const normalized = normalizeSection(id);
        if (isAuthedUser() && (normalized === 'landing-page' || normalized === 'public-onboarding' || normalized === 'login-page')) return 'dashboard';
        if (!isAuthedUser() && normalized === 'profile-page') return 'landing-page';
        if (!isAuthedUser() && normalized === 'dashboard' && !isIntroLibraryVisible()) return 'landing-page';
        return normalized;
    }

    function buildShellUrl(sectionId) {
        const url = new URL(window.location.href);
        const params = new URLSearchParams(url.search);
        if (!sectionId || sectionId === 'landing-page') params.delete('view');
        else params.set('view', sectionId);
        const query = params.toString();
        return `${url.pathname}${query ? `?${query}` : ''}`;
    }

    function syncHistoryForSection(sectionId, mode = 'push') {
        if (!window.history || sectionId === 'reading-mode') return;
        const next = buildShellUrl(sectionId);
        const current = `${window.location.pathname}${window.location.search}`;
        if (mode === 'replace') {
            window.history.replaceState({ section: sectionId }, '', next);
            return;
        }
        if (next !== current) window.history.pushState({ section: sectionId }, '', next);
    }

    function readSectionFromLocation() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            return normalizeSection(params.get('view') || 'landing-page');
        } catch (_) {
            return 'landing-page';
        }
    }

    function deriveDisplayName(user) {
        const explicit = String((user && (user.displayName || user?.user_metadata?.full_name || user?.user_metadata?.name)) || '').trim();
        if (explicit) return explicit;
        const email = String((user && user.email) || '').trim();
        if (!email) return 'Account';
        return email.split('@')[0] || email;
    }

    function renderLibrarySubtitle(authed) {
        const subtitle = document.getElementById('dashboard-subtitle');
        if (!subtitle) return;
        // Do not toggle display — CSS min-height on #dashboard-subtitle reserves
        // a fixed line of space so text changes never cause layout shift.
        if (!authed) {
            subtitle.innerHTML = 'Bring in your own books or text and make this reading space yours.';
            return;
        }
        const remoteMetrics = (window.rcSync && typeof window.rcSync.getRemoteProfileMetrics === 'function') ? window.rcSync.getRemoteProfileMetrics() : null;
        const localMetrics = (window.rcReadingMetrics && typeof window.rcReadingMetrics.getReadingProfileMetrics === 'function')
            ? window.rcReadingMetrics.getReadingProfileMetrics()
            : { sessionsCompleted: 0, weeklyMinutes: 0 };
        const metrics = remoteMetrics || localMetrics;
        const sessions = Math.max(0, Number(metrics.sessionsCompleted || 0));
        const weekly = Math.max(0, Number(metrics.weeklyMinutes || 0));
        if (weekly > 0) {
            subtitle.innerHTML = `You've completed <strong>${sessions} session${sessions === 1 ? '' : 's'}</strong> all time and read <strong>${weekly} min</strong> this week.`;
        } else {
            subtitle.innerHTML = `You've completed <strong>${sessions} session${sessions === 1 ? '' : 's'}</strong> all time. Keep the momentum going.`;
        }
    }

    function getSignedInAccountControlElements() {
        const logoutButtons = Array.from(document.querySelectorAll('[onclick="shellSignOut()"]')).filter(Boolean);
        const profileTriggers = Array.from(document.querySelectorAll('#nav-profile-trigger')).filter(Boolean);
        return { logoutButtons, profileTriggers, all: profileTriggers.concat(logoutButtons) };
    }

    function isControlEnabled(el) {
        return !!(el && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
    }

    function readSignedInAccountControlReadiness(reason = 'readiness-read') {
        const controls = getSignedInAccountControlElements();
        const authed = !!isAuthedUser();
        const authKnown = !!(window.rcAuth && typeof window.rcAuth.isReady === 'function' && window.rcAuth.isReady());
        const authCallable = !!(window.rcAuth && typeof window.rcAuth.signOut === 'function');
        const shellPending = !!(document.body.classList.contains('boot-pending') || document.body.classList.contains('auth-hydrating'));
        let blockedBy = null;
        if (!authed) blockedBy = 'auth:signed-out';
        else if (!authKnown) blockedBy = 'auth:not-ready';
        else if (!authCallable) blockedBy = 'auth:signout-unavailable';
        else if (_accountControlsTransientBlock) blockedBy = _accountControlsTransientBlock;
        else if (shellPending) blockedBy = 'shell:boot-pending';

        const signedInInteractionReady = authed && !blockedBy;
        const visibleControls = controls.all.filter(isElementVisible);
        return {
            signedInInteractionReady,
            authCallable,
            accountControlsEnabled: signedInInteractionReady && controls.all.length > 0 && controls.all.every(isControlEnabled),
            visibleAccountControlsEnabled: signedInInteractionReady && visibleControls.length > 0 && visibleControls.every(isControlEnabled),
            blockedBy,
            signedIn: authed,
            authKnown,
            shellPending,
            profileControlCount: controls.profileTriggers.length,
            logoutControlCount: controls.logoutButtons.length,
            visibleControlCount: visibleControls.length,
            reason,
            at: new Date().toISOString()
        };
    }

    function applySignedInAccountControlReadiness(reason = 'account-control-settlement') {
        const initial = readSignedInAccountControlReadiness(reason);
        const controls = getSignedInAccountControlElements();
        const shouldEnable = !!initial.signedInInteractionReady;
        controls.all.forEach((control) => {
            try {
                control.disabled = !shouldEnable;
                if (shouldEnable) {
                    control.removeAttribute('aria-disabled');
                    control.removeAttribute('data-shell-blocked-by');
                } else {
                    control.setAttribute('aria-disabled', 'true');
                    if (initial.blockedBy) control.setAttribute('data-shell-blocked-by', initial.blockedBy);
                }
            } catch (_) {}
        });
        _lastSignedInAccountReadiness = readSignedInAccountControlReadiness(reason);
        shellTrailPush('account-control-readiness', {
            reason,
            signedInInteractionReady: _lastSignedInAccountReadiness.signedInInteractionReady,
            authCallable: _lastSignedInAccountReadiness.authCallable,
            accountControlsEnabled: _lastSignedInAccountReadiness.accountControlsEnabled,
            visibleAccountControlsEnabled: _lastSignedInAccountReadiness.visibleAccountControlsEnabled,
            blockedBy: _lastSignedInAccountReadiness.blockedBy
        });
        return _lastSignedInAccountReadiness;
    }

    // =========================================================================
    // SLICE 7 MODULE BOUNDARY 2/6 — Dashboard/Library Visible Settlement
    // Logical boundary declaration only — code not physically separated yet.
    // Primary content here: dashboard pending/ready release decision, owner
    //   report reads, settlement thresholds, releaseDashboardSectionVisibility().
    // Library table rendering (the visible settlement output) continues further
    //   in this file — see the matching MODULE BOUNDARY 2/6 continuation marker.
    // =========================================================================

    // ── Dashboard release seam ────────────────────────────────────────────────
    // Shell owns the first-visible dashboard state decision before the section
    // is made visible. Dashboard hidden-section removal is owned exclusively by
    // releaseDashboardSectionVisibility(). showSection() is the requester, not
    // the release authority, for the dashboard surface.
    //
    // Retirement condition: remove or narrow after dashboard release contract is
    // runtime-accepted and direct reveal paths are retired.

    function readDashboardLibraryState() {
        const dashboardEl = document.getElementById('dashboard');
        const raw = dashboardEl ? String(dashboardEl.getAttribute('data-library-state') || '').trim() : '';
        return raw || null;
    }

    function isSettledDashboardLibraryState(state) {
        return state === 'populated' || state === 'empty' || state === 'error';
    }

    // Derives release state from authoritative owner signals only — never from
    // shell-held mirror state. Signed-in path can never produce 'sample'.
    function readDashboardLibraryOwnerReport(reason = 'dashboard-release') {
        const authed = !!isAuthedUser();
        const intro = isIntroLibraryVisible();
        const ownerReady = typeof localBooksGetAll === 'function';
        const initialResolved = !!_libraryInitialResolutionComplete;
        if (!authed) {
            const state = intro ? 'sample' : 'pending';
            return { state, ownerReady: false, initialResolved, authed, source: intro ? 'public-sample' : 'public-blocked', reason, at: new Date().toISOString() };
        }
        if (!ownerReady) {
            return { state: 'pending', ownerReady, initialResolved, authed, source: 'signed-in-pending', pendingReason: 'owner-not-ready', reason, at: new Date().toISOString() };
        }
        if (!initialResolved) {
            return { state: 'pending', ownerReady, initialResolved, authed, source: 'signed-in-pending', pendingReason: 'resolution-pending', reason, at: new Date().toISOString() };
        }
        // Only read committed DOM state after owner has resolved — not before.
        const committed = readDashboardLibraryState();
        const state = isSettledDashboardLibraryState(committed) ? committed : 'pending';
        return { state, ownerReady, initialResolved, authed, source: 'signed-in-settled', reason, at: new Date().toISOString() };
    }

    function applyDashboardLibraryChrome(state, reason = 'dashboard-library-chrome') {
        const authed = !!isAuthedUser();
        const libraryToolbar = document.getElementById('library-toolbar');
        const manageBtn = document.getElementById('manageLibraryBtn');
        const importBtn = document.getElementById('importBookBtn');
        // Shell coordinates chrome visibility only. Library/import truth remains
        // owned by refreshLibrary(), localBooksGetAll(), and importer guards.
        const toolbarAllowed = authed
            ? isSettledDashboardLibraryState(state)
            : (state === 'sample' && isIntroLibraryVisible());
        if (libraryToolbar) {
            libraryToolbar.classList.toggle('hidden-section', !toolbarAllowed);
            libraryToolbar.setAttribute('data-shell-library-state', state || 'pending');
        }
        [manageBtn, importBtn].forEach((btn) => {
            if (!btn) return;
            try {
                btn.disabled = !toolbarAllowed;
                if (toolbarAllowed) btn.removeAttribute('aria-disabled');
                else btn.setAttribute('aria-disabled', 'true');
                btn.setAttribute('data-shell-library-state', state || 'pending');
            } catch (_) {}
        });
        return { state, toolbarAllowed };
    }

    function prepareDashboardRelease(requestedSurface, options = {}) {
        const reason = options.releaseReason || 'dashboard-release';
        const report = readDashboardLibraryOwnerReport(reason);
        const firstVisibleState = report.state;
        setLibrarySurfaceState(firstVisibleState, reason);
        if (firstVisibleState === 'pending') scheduleLibraryPendingBanner();
        const chrome = applyDashboardLibraryChrome(firstVisibleState, reason);
        _lastDashboardRelease = {
            requestedSurface,
            releasedSurface: 'dashboard',
            releaseReason: reason,
            firstVisibleLibraryState: firstVisibleState,
            source: report.source,
            ownerReady: !!report.ownerReady,
            blockedBy: null,
            toolbarAllowed: chrome.toolbarAllowed,
            hiddenSectionOwner: 'releaseDashboardSectionVisibility',
            at: new Date().toISOString()
        };
        return _lastDashboardRelease;
    }

    // Single owner of dashboard hidden-section removal. showSection() is the
    // requester only — it must not directly remove hidden-section from dashboard.
    function releaseDashboardSectionVisibility(requestedSurface, options = {}) {
        const release = prepareDashboardRelease(requestedSurface, options);
        ALL_SECTIONS.forEach((sectionId) => {
            const el = document.getElementById(sectionId);
            if (el) el.classList.add('hidden-section');
        });
        const target = document.getElementById('dashboard');
        if (target) target.classList.remove('hidden-section');
        _currentSection = 'dashboard';
        _lastShellRelease = {
            requestedSurface,
            releasedSurface: 'dashboard',
            releaseReason: release.releaseReason,
            blockedBy: null,
            at: new Date().toISOString()
        };
        return release;
    }

    function waitForDashboardLibrarySettlementOrThreshold(targetId, thresholdMs, reason = 'dashboard-library-reveal') {
        if (targetId !== 'dashboard') {
            return Promise.resolve({ targetId, settled: true, state: null, elapsedMs: 0, reason });
        }
        const started = performance.now();
        return new Promise((resolve) => {
            const done = (settled, state) => {
                const elapsedMs = Math.round(performance.now() - started);
                const report = { targetId, settled, state, elapsedMs, thresholdMs, reason, at: new Date().toISOString() };
                _lastDashboardLibraryRevealTransaction = Object.assign({}, _lastDashboardLibraryRevealTransaction || {}, report);
                resolve(report);
            };
            const check = () => {
                const state = readDashboardLibraryState();
                const authed = !!isAuthedUser();
                const settled = authed
                    ? (!!_libraryInitialResolutionComplete && isSettledDashboardLibraryState(state))
                    : (state === 'sample' || state === 'pending');
                if (settled) {
                    done(true, state);
                    return;
                }
                if (performance.now() - started >= thresholdMs) {
                    done(false, state || 'pending');
                    return;
                }
                window.setTimeout(check, 25);
            };
            check();
        });
    }

    function releaseStandardSectionVisibility(requestedSurface, targetId, options = {}) {
        ALL_SECTIONS.forEach((sectionId) => {
            const el = document.getElementById(sectionId);
            if (el) el.classList.add('hidden-section');
        });
        const target = document.getElementById(targetId);
        if (target) target.classList.remove('hidden-section');
        _currentSection = targetId;
        _lastShellRelease = {
            requestedSurface,
            releasedSurface: targetId,
            releaseReason: options.releaseReason || ('show-section:' + targetId),
            blockedBy: null,
            at: new Date().toISOString()
        };
    }

    function syncShellAuthPresentation(sectionId = getCurrentVisibleSection()) {
        const id = normalizeSection(sectionId);
        const authed = isAuthedUser();
        const user = getAuthUser();
        const isReading = id === 'reading-mode';
        const isLanding = id === 'landing-page';
        const dashboardEl = document.getElementById('dashboard');
        const profileEl = document.getElementById('profile-page');

        const navUserControls = document.getElementById('nav-user-controls');
        const navLandingControls = document.getElementById('nav-landing-controls');
        const navLoginBtn = document.getElementById('nav-login-btn');
        const navSignupBtn = document.getElementById('nav-signup-btn');
        const navUserName = document.getElementById('nav-user-name');
        const navAvatar = document.getElementById('nav-avatar');
        const navProfileTrigger = document.getElementById('nav-profile-trigger');
        const navUsagePill = document.getElementById('nav-usage-pill');

        if (navUserControls) navUserControls.classList.toggle('hidden-section', !authed || isReading);
        if (navLandingControls) navLandingControls.style.display = (!authed && !isReading) ? 'flex' : 'none';
        if (navLoginBtn) navLoginBtn.style.display = (!authed && id !== 'login-page') ? '' : 'none';
        if (navSignupBtn) navSignupBtn.style.display = !authed ? '' : 'none';
        if (navProfileTrigger) navProfileTrigger.style.display = authed ? '' : 'none';
        if (navUsagePill) navUsagePill.classList.toggle('hidden-section', !authed || isReading);

        const remoteDisplayName = (window.rcSync && typeof window.rcSync.getRemoteUsersRow === 'function') ? (window.rcSync.getRemoteUsersRow()?.display_name || '') : '';
        const displayName = remoteDisplayName || deriveDisplayName(user);
        if (navUserName) {
            navUserName.textContent = authed ? displayName : '';
            navUserName.classList.toggle('hidden-section', !authed);
        }
        if (navAvatar) navAvatar.src = 'https://api.dicebear.com/7.x/avataaars/svg?seed=Jeeves';

        const sidebar = document.getElementById('app-sidebar');
        if (sidebar) sidebar.style.display = authed && SIDEBAR_SECTIONS.includes(id) ? 'flex' : 'none';
        if (dashboardEl) dashboardEl.classList.toggle('with-sidebar', authed);
        if (profileEl) profileEl.classList.toggle('with-sidebar', authed);
        const supportFooter = document.getElementById('supportFooter');
        if (supportFooter) supportFooter.style.display = authed && SIDEBAR_SECTIONS.includes(id) ? 'block' : 'none';
        const sbLibrary = document.getElementById('sb-library');
        if (sbLibrary) sbLibrary.classList.toggle('active', id === 'dashboard');

        const libraryToolbar = document.getElementById('library-toolbar');
        const librarySample = document.getElementById('library-public-sample');
        const publicSampleCopy = document.getElementById('library-public-sample-copy');
        const publicSampleSubcopy = document.getElementById('library-public-sample-subcopy');
        if (id === 'dashboard') {
            applyDashboardLibraryChrome(readDashboardLibraryState() || (authed ? 'pending' : 'sample'), 'sync-auth-presentation:' + id);
        } else if (libraryToolbar) {
            libraryToolbar.classList.toggle('hidden-section', !(authed || isIntroLibraryVisible()));
        }
        if (librarySample && id !== 'dashboard') librarySample.classList.add('hidden-section');
        if (publicSampleCopy) publicSampleCopy.textContent = 'Create an account to import books, save your place, and build your own library.';
        if (publicSampleSubcopy) publicSampleSubcopy.textContent = 'Start free, keep your place, and come back anytime.';
        renderLibrarySubtitle(authed);

        const profileGuestCard = document.getElementById('profile-guest-card');
        const profileGuestContent = document.getElementById('profile-guest-content');
        const profileAuthCard = document.getElementById('profile-auth-card');
        const profileAuthContent = document.getElementById('profile-auth-content');
        if (profileGuestCard) profileGuestCard.classList.toggle('hidden-section', authed);
        if (profileGuestContent) profileGuestContent.classList.toggle('hidden-section', authed);
        if (profileAuthCard) profileAuthCard.classList.toggle('hidden-section', !authed);
        if (profileAuthContent) profileAuthContent.classList.toggle('hidden-section', !authed);

        const profileNameMain = document.getElementById('profile-name-main');
        const profileEmailMain = document.getElementById('profile-email-main');
        const profileAvatarMain = document.getElementById('profile-avatar-main');
        const profileNameSettings = document.getElementById('profile-name-settings');
        const profileEmailSettings = document.getElementById('profile-email-settings');
        const profileAvatarSettings = document.getElementById('profile-avatar-settings');
        if (profileNameMain) profileNameMain.textContent = authed ? displayName : 'Your account';
        if (profileEmailMain) profileEmailMain.textContent = authed ? 'Signed-in account' : 'Account settings';
        if (profileNameSettings) profileNameSettings.textContent = authed ? displayName : 'Your account';
        if (profileEmailSettings) profileEmailSettings.textContent = authed ? 'Signed-in account' : 'Account settings';
        const avatarSrc = 'https://api.dicebear.com/7.x/avataaars/svg?seed=Jeeves';
        if (profileAvatarMain) profileAvatarMain.src = avatarSrc;
        if (profileAvatarSettings) profileAvatarSettings.src = avatarSrc;
        // One shared account-control readiness writer owns Logout/Profile
        // disabled state across dashboard, profile, refresh, and auth cycling.
        applySignedInAccountControlReadiness('sync-auth-presentation:' + id);
    }

    function showSection(id, options = {}) {
        const targetId = resolveSectionForAuth(id);
        const publicBoundary = ensurePublicRuntimeBeforeRelease(targetId, 'show-section:' + targetId);
        if (!publicBoundary.allowed) return Promise.resolve(publicBoundary.report || null);
        if (targetId === 'landing-page' && !options.preserveIntroLibrary) _publicIntroLibraryVisible = false;
        // Route entry must not resume a stale onboarding pane. Browser history
        // can re-enter ?view=public-onboarding after the final transition has
        // been active; reset before release so Step 1 is the visible owner.
        if (targetId === 'public-onboarding') resetPublicOnboardingQuiz();
        const readingModeEl = document.getElementById('reading-mode');
        const wasReading = readingModeEl && !readingModeEl.classList.contains('hidden-section');

        // showSection is the requester only. Dashboard hidden-section removal is
        // owned exclusively by releaseDashboardSectionVisibility().
        if (targetId === 'dashboard') {
            releaseDashboardSectionVisibility(id, Object.assign({
                releaseReason: options.releaseReason || 'dashboard-release:show-section'
            }, options));
        } else {
            releaseStandardSectionVisibility(id, targetId, options);
        }

        const footer = document.getElementById('landing-footer');
        if (footer) footer.classList.toggle('hidden-section', targetId !== 'landing-page');

        const mainNav = document.querySelector('nav');
        if (mainNav) mainNav.style.display = targetId === 'reading-mode' || targetId === 'public-onboarding' ? 'none' : '';
        if (wasReading && targetId !== 'reading-mode') {
            try {
                if (typeof exitReadingSession === 'function') exitReadingSession();
                else cleanupReadingTransientState();
            } catch(_) {}
        }
        document.body.classList.toggle('reading-active', targetId === 'reading-mode');
        if (targetId === 'reading-mode') {
            initFocusMode();
            updateTierPill();
            updateExplorerSwatchState();
            updateProgressBar();
            try { if (window.rcTheme) window.rcTheme.applySettings(); } catch (_) {}
            try {
                if (window.rcEmbers && typeof window.rcEmbers.refreshBounds === 'function') window.rcEmbers.refreshBounds(true);
                if (window.rcEmbers && typeof window.rcEmbers.syncVisibility === 'function') window.rcEmbers.syncVisibility();
            } catch (_) {}
            try { syncExplorerMusicSource(); } catch (_) {}
        } else {
            try { syncExplorerMusicSource(); } catch (_) {}
        }

        clearPaidIntentForPublicAbandon(targetId);
        syncShellAuthPresentation(targetId);
        let _sectionRefreshPromise = null;
        if (targetId === 'dashboard') _sectionRefreshPromise = refreshLibrary('show-section-dashboard');
        if (targetId === 'profile-page') { try { renderProfileSurface(); } catch (_) {} try { renderSubscriptionSurface(); } catch (_) {} }
        try { if (typeof window.syncDiagnosticsVisibility === 'function') window.syncDiagnosticsVisibility(); } catch (_) {}
        if (options.historyMode !== 'none') syncHistoryForSection(targetId, options.historyMode === 'replace' ? 'replace' : 'push');

        window.scrollTo(0, 0);
        // Return the async library refresh promise so callers that need to wait
        // (e.g. DOMContentLoaded before removing auth-hydrating) can await it.
        return _sectionRefreshPromise || Promise.resolve();
    }

    // =========================================================================
    // SLICE 7 MODULE BOUNDARY 6/6 — Public Route Coordination
    // Logical boundary declaration only — code not physically separated yet.
    // Primary content: focus mode, public sample entry/exit, reading session
    //   entry, preview modal, session-complete surface. Shell frames user
    //   intent into runtime reading transitions — reading truth stays with
    //   the runtime owner.
    // =========================================================================

    // ── Focus mode fade ──────────────────────────────────────────
    let focusModeTimer   = null;
    let focusModeHandler = null;

    function initFocusMode() {
        const bar = document.getElementById('reading-top-bar');
        const rm  = document.getElementById('reading-mode');
        if (!bar || !rm) return;
        if (focusModeHandler) {
            ['mousemove', 'scroll', 'touchstart', 'click'].forEach(ev =>
                rm.removeEventListener(ev, focusModeHandler));
        }
        focusModeHandler = null;
        clearTimeout(focusModeTimer);
        focusModeTimer = null;
        bar.classList.remove('faded');
    }





    // =========================================================================
    // SLICE 7 MODULE BOUNDARY 4/6 — Modal Opener Provenance
    // Logical boundary declaration only — code not physically separated yet.
    // Primary content: openModal(), closeModal(), ownership guards,
    //   promptOwnershipAction(). Opener truth for pricing-modal is currently
    //   inferred, not authoritative — see getActiveModalReport() HELD comment
    //   (Bucket F). Do not treat this section as provenance-complete until
    //   Bucket F retirement conditions are met.
    // =========================================================================

    // ── Modals ───────────────────────────────────────────────────
    function openModal(id)  {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === 'pricing-modal' && window.rcBilling && typeof window.rcBilling.openPricingForAccount === 'function') {
            window.rcBilling.openPricingForAccount().catch(() => {});
            return;
        }
        el.classList.remove('hidden-section');
        if (el.classList.contains('modal-overlay')) el.style.display = 'flex';
    }
    function closeModal(id) { const el = document.getElementById(id); if (!el) return; el.classList.add('hidden-section'); if (el.classList.contains('modal-overlay')) el.style.display = 'none'; }

    function installPricingModalClickAway() {
        const pricingModal = document.getElementById('pricing-modal');
        if (!pricingModal || pricingModal.__jublyPricingClickAwayBound) return;
        pricingModal.__jublyPricingClickAwayBound = true;
        pricingModal.addEventListener('click', (event) => {
            if (event.target === pricingModal) closeModal('pricing-modal');
        });
    }

    function continueWithFree() {
        if (window.rcBilling && typeof window.rcBilling.continueWithFree === 'function') {
            window.rcBilling.continueWithFree();
            return;
        }
        showSigninPane();
    }

    function showSigninPane() {
        closeModal('pricing-modal');
        closeModal('ownership-modal');
        _authMode = 'signin';
        _signupStep = 1;
        toggleAuthMode(true);
        showSection('login-page');
    }

    function returnToPublicEntry() {
        closeModal('pricing-modal');
        closeModal('ownership-modal');
        try { if (window.rcBilling && typeof window.rcBilling.clearPendingPlan === 'function') window.rcBilling.clearPendingPlan(); } catch (_) {}
        showSection(isIntroLibraryVisible() ? 'dashboard' : 'landing-page');
    }

    function returnToLanding() {
        if (window.rcBilling && typeof window.rcBilling.clearPendingPlan === 'function') window.rcBilling.clearPendingPlan();
        _publicIntroLibraryVisible = false;
        _publicSampleSessionActive = false;
        returnToPublicEntry();
    }

    function authBack() {
        _authClearMessages();
        if (_authMode === 'signup' && _signupStep === 2) {
            _signupStep = 1;
            applyAuthModeUi();
            try {
                const emailField = document.getElementById('loginEmail');
                if (emailField) emailField.focus();
            } catch (_) {}
            return;
        }
        returnToPublicEntry();
    }

    function showSignupPane(forceDirect = false) {
        closeModal('ownership-modal');
        closeModal('pricing-modal');
        _authMode = 'signup';
        _signupStep = 1;
        toggleAuthMode(true);
        showSection('login-page');
    }

    function clearPublicOnboardingTimer() {
        if (_publicOnboardingTimer) window.clearTimeout(_publicOnboardingTimer);
        _publicOnboardingTimer = null;
    }

    function getPublicOnboardingPanes() {
        const card = document.getElementById('public-onboarding-card');
        return card ? Array.from(card.querySelectorAll('[data-onboarding-pane]')) : [];
    }

    function updatePublicOnboardingProgress(step) {
        document.querySelectorAll('[data-onboarding-progress]').forEach((dot) => {
            dot.classList.toggle('active', dot.getAttribute('data-onboarding-progress') === String(step));
        });
    }

    function setPublicOnboardingPane(name) {
        clearPublicOnboardingTimer();
        getPublicOnboardingPanes().forEach((pane) => {
            const active = pane.getAttribute('data-onboarding-pane') === name;
            pane.classList.toggle('active', active);
            if (active && pane.getAttribute('data-onboarding-step')) updatePublicOnboardingProgress(pane.getAttribute('data-onboarding-step'));
        });
        try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch (_) { window.scrollTo(0, 0); }
    }

    function goToPublicOnboardingStep(step) {
        setPublicOnboardingPane('step-' + step);
    }

    function showPublicOnboardingTransition(id, destination, delay) {
        setPublicOnboardingPane('interstitial-' + id);
        _publicOnboardingTimer = window.setTimeout(() => {
            _publicOnboardingTimer = null;
            try { destination(); } catch (_) {}
        }, delay);
    }

    function applyPublicOnboardingTheme(theme) {
        const safeTheme = ['default', 'green', 'purple'].includes(String(theme || 'default')) ? String(theme || 'default') : 'default';
        document.body.classList.remove('theme-green', 'theme-purple');
        if (safeTheme !== 'default') document.body.classList.add('theme-' + safeTheme);
        return safeTheme;
    }

    function syncPublicOnboardingSpeed(rate) {
        const value = Math.max(0.5, Math.min(2, Number(rate || 1) || 1));
        _publicOnboardingChoices.speed = value;
        const slider = document.getElementById('public-onboarding-speed');
        const label = document.getElementById('public-onboarding-speed-value');
        if (slider) {
            slider.value = String(value);
            const min = Number(slider.min || 0.5);
            const max = Number(slider.max || 2);
            const pct = ((value - min) / (max - min) * 100).toFixed(1) + '%';
            slider.style.setProperty('--fill', pct);
        }
        if (label) label.textContent = (Number.isInteger(value) ? value.toFixed(1) : String(value)) + '×';
        const shellSpeed = document.getElementById('shell-speed');
        if (shellSpeed) shellSpeed.value = String(value);
        shellSetSpeed(value);
        return value;
    }

    function resetPublicOnboardingQuiz() {
        clearPublicOnboardingTimer();
        _publicOnboardingChoices = Object.assign({}, PUBLIC_ONBOARDING_DEFAULTS);
        window.__jublyPublicOnboarding = Object.assign({ source: 'public-onboarding', durable: false }, _publicOnboardingChoices);
        applyPublicOnboardingTheme('default');
        document.querySelectorAll('#public-onboarding [role="radiogroup"]').forEach((group) => {
            const choices = Array.from(group.querySelectorAll('[role="radio"]'));
            choices.forEach((choice, index) => {
                const selected = index === 0;
                choice.classList.toggle('selected', selected);
                choice.setAttribute('aria-checked', String(selected));
            });
        });
        syncPublicOnboardingSpeed(PUBLIC_ONBOARDING_DEFAULTS.speed);
        goToPublicOnboardingStep(1);
    }

    function selectPublicOnboardingChoice(button) {
        const group = button && button.closest ? button.closest('[data-onboarding-group]') : null;
        if (!group) return;
        const key = group.getAttribute('data-onboarding-group');
        const value = button.getAttribute('data-onboarding-value') || '';
        Array.from(group.querySelectorAll('[role="radio"]')).forEach((choice) => {
            const selected = choice === button;
            choice.classList.toggle('selected', selected);
            choice.setAttribute('aria-checked', String(selected));
        });
        if (key === 'goal' || key === 'voice' || key === 'theme') _publicOnboardingChoices[key] = value;
        if (key === 'theme') applyPublicOnboardingTheme(value);
        window.__jublyPublicOnboarding = Object.assign({ source: 'public-onboarding', durable: false }, _publicOnboardingChoices);
    }

    function initPublicOnboardingSurface() {
        const surface = document.getElementById('public-onboarding');
        if (!surface || surface.__jublyOnboardingBound) return;
        surface.__jublyOnboardingBound = true;
        surface.addEventListener('click', (event) => {
            const radio = event.target.closest('[role="radio"]');
            if (radio && surface.contains(radio)) {
                selectPublicOnboardingChoice(radio);
                return;
            }
            const nextButton = event.target.closest('[data-onboarding-next]');
            if (!nextButton || !surface.contains(nextButton)) return;
            const next = nextButton.getAttribute('data-onboarding-next');
            if (next === '1') showPublicOnboardingTransition('1', () => goToPublicOnboardingStep(2), 2500);
            else if (next === '2') goToPublicOnboardingStep(3);
            else if (next === '3') showPublicOnboardingTransition('3', () => completePublicOnboardingAndStartReading(), 2600);
        });
        const speed = document.getElementById('public-onboarding-speed');
        if (speed) speed.addEventListener('input', () => syncPublicOnboardingSpeed(speed.value));
        resetPublicOnboardingQuiz();
    }

    function startPublicOnboardingQuiz() {
        if (isAuthedUser()) return startPublicSampleReading();
        closeModal('pricing-modal');
        closeModal('ownership-modal');
        _publicIntroLibraryVisible = false;
        return showSection('public-onboarding', { releaseReason: 'public-onboarding:start' });
    }

    async function completePublicOnboardingAndStartReading() {
        clearPublicOnboardingTimer();
        window.__jublyPublicOnboarding = Object.assign({
            source: 'public-onboarding',
            durable: false,
            completedAt: new Date().toISOString()
        }, _publicOnboardingChoices);
        applyPublicOnboardingTheme(_publicOnboardingChoices.theme);
        syncPublicOnboardingSpeed(_publicOnboardingChoices.speed);
        await startPublicSampleReading();
    }

    async function startPublicSampleReading() {
        _publicSampleSessionActive = true;
        closeModal('pricing-modal');
        closeModal('ownership-modal');
        const signal = document.getElementById('session-complete');
        if (signal) signal.classList.add('hidden-section');
        showSection('reading-mode');
        try { if (typeof startReadingFromPreview === 'function') await startReadingFromPreview(PUBLIC_SAMPLE_BOOK_ID); } catch (_) {}
    }

    function goToPostReadingSurface() {
        if (!isAuthedUser() && _publicSampleSessionActive) {
            _publicIntroLibraryVisible = true;
            _publicSampleSessionActive = false;
        }
        showSection(isIntroLibraryVisible() ? 'dashboard' : 'landing-page');
    }

    function promptOwnershipAction(kind) {
        if (isAuthedUser()) return false;
        const message = 'Create an account to import books, save your place, and build your own library.';
        if (window.rcBilling && typeof window.rcBilling.showPricingForGatedAction === 'function') {
            window.rcBilling.showPricingForGatedAction(message);
        } else {
            // Fallback: billing module unavailable. Set the gated message directly
            // before opening. This is the billing-unavailable degradation path only —
            // when billing is present, showPricingForGatedAction owns message delivery.
            const msgEl = document.getElementById('pricing-message');
            if (msgEl) msgEl.textContent = message;
            openModal('pricing-modal');
        }
        return true;
    }

    function installOwnershipGuards() {
        const bind = (id, kind) => {
            const el = document.getElementById(id);
            if (!el || el.__jublyOwnershipGuard) return;
            el.__jublyOwnershipGuard = true;
            el.addEventListener('click', (event) => {
                if (!isAuthedUser()) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    promptOwnershipAction(kind);
                }
            }, true);
        };
        bind('manageLibraryBtn', 'manage');
        bind('importBookBtn', 'import');
        bind('empty-drop-zone', 'import');
    }

    // ── Auth — Pass 4 sign-in / sign-up / sign-out ───────────────
    // Shell is a thin presenter. It calls rcAuth, reflects state, and routes.
    // It does not own auth state or Supabase operations.

    let _authMode = 'signin'; // 'signin' | 'signup'
    let _signupStep = 1; // 1=email, 2=username+password
    let _validatedSignupEmail = '';

    function applyAuthModeUi() {
        const heading       = document.getElementById('auth-form-heading');
        const subheading    = document.getElementById('auth-form-subheading');
        const submitBtn     = document.getElementById('auth-submit-btn');
        const toggleBtn     = document.getElementById('auth-toggle-btn');
        const toggleLabel   = document.getElementById('auth-toggle-label');
        const emailWrap     = document.getElementById('auth-email-wrap');
        const usernameWrap  = document.getElementById('auth-username-wrap');
        const passwordWrap  = document.getElementById('auth-password-wrap');
        const confirmWrap   = document.getElementById('auth-confirm-wrap');
        const errEl         = document.getElementById('auth-error');
        const okEl          = document.getElementById('auth-success');
        const pwInput       = document.getElementById('loginPassword');

        if (errEl) errEl.classList.add('hidden-section');
        if (okEl) okEl.classList.add('hidden-section');

        if (_authMode === 'signup') {
            if (heading) heading.textContent = 'Create account';
            if (toggleBtn) toggleBtn.textContent = 'Sign in instead';
            if (toggleLabel) toggleLabel.textContent = 'Already have an account?';
            if (_signupStep === 1) {
                if (emailWrap) emailWrap.classList.remove('hidden-section');
                if (subheading) subheading.textContent = 'Enter your email to begin.';
                if (usernameWrap) usernameWrap.classList.add('hidden-section');
                if (passwordWrap) passwordWrap.classList.add('hidden-section');
                if (confirmWrap) confirmWrap.classList.add('hidden-section');
                if (submitBtn) submitBtn.textContent = 'Next';
            } else {
                if (emailWrap) emailWrap.classList.add('hidden-section');
                if (subheading) subheading.textContent = 'Choose a username and password.';
                if (usernameWrap) usernameWrap.classList.remove('hidden-section');
                if (passwordWrap) passwordWrap.classList.remove('hidden-section');
                if (confirmWrap) confirmWrap.classList.remove('hidden-section');
                if (submitBtn) submitBtn.textContent = 'Create Account';
            }
            if (pwInput) pwInput.setAttribute('autocomplete', 'new-password');
        } else {
            if (heading) heading.textContent = 'Welcome back';
            if (subheading) subheading.textContent = 'Sign in to your account to continue';
            if (toggleBtn) toggleBtn.textContent = 'Create account';
            if (toggleLabel) toggleLabel.textContent = 'New here?';
            if (emailWrap) emailWrap.classList.remove('hidden-section');
            if (usernameWrap) usernameWrap.classList.add('hidden-section');
            if (passwordWrap) passwordWrap.classList.remove('hidden-section');
            if (confirmWrap) confirmWrap.classList.add('hidden-section');
            if (submitBtn) submitBtn.textContent = 'Sign In';
            if (pwInput) pwInput.setAttribute('autocomplete', 'current-password');
        }
    }

    function toggleAuthMode(forceApply = false) {
        if (!forceApply) _authMode = _authMode === 'signin' ? 'signup' : 'signin';
        _signupStep = 1;
        _validatedSignupEmail = '';
        applyAuthModeUi();
    }

    function _authShowError(msg) {
        const el = document.getElementById('auth-error');
        const ok = document.getElementById('auth-success');
        if (ok) ok.classList.add('hidden-section');
        if (!el) return;
        el.textContent = msg || 'Something went wrong. Please try again.';
        el.classList.remove('hidden-section');
    }

    function _authShowSuccess(msg) {
        const el = document.getElementById('auth-success');
        const err = document.getElementById('auth-error');
        if (err) err.classList.add('hidden-section');
        if (!el) return;
        el.textContent = msg || '';
        el.classList.remove('hidden-section');
    }

    function _authClearMessages() {
        const err = document.getElementById('auth-error');
        const ok  = document.getElementById('auth-success');
        if (err) err.classList.add('hidden-section');
        if (ok)  ok.classList.add('hidden-section');
    }

    function _readAuthPendingPlan() {
        try {
            return window.rcBilling && typeof window.rcBilling.readPendingPlan === 'function'
                ? String(window.rcBilling.readPendingPlan() || '').trim().toLowerCase()
                : '';
        } catch (_) {
            return '';
        }
    }

    function _existingAccountSteerMessage(pendingPlan) {
        return pendingPlan && pendingPlan !== 'free'
            ? `An account with this email already exists. Log In to continue with ${pendingPlan === 'premium' ? 'Premium' : 'Pro'} checkout.`
            : 'An account with this email already exists. Log In to continue.';
    }

    function _steerExistingAccountToSignin(email, pendingPlan) {
        _authMode = 'signin';
        _signupStep = 1;
        _validatedSignupEmail = '';
        applyAuthModeUi();
        const emailField = document.getElementById('loginEmail');
        if (emailField) emailField.value = String(email || '').trim();
        const passwordField = document.getElementById('loginPassword');
        try { if (passwordField) passwordField.focus(); } catch (_) {}
        _authShowError(_existingAccountSteerMessage(pendingPlan));
    }

    async function _inspectSignupEmailOrBlock(email, pendingPlan) {
        const inspected = window.rcAuth && typeof window.rcAuth.inspectEmail === 'function'
            ? await window.rcAuth.inspectEmail(email)
            : { ok: false, exists: false, error: { message: 'Unable to verify email yet.' } };
        if (inspected && inspected.exists) {
            _steerExistingAccountToSignin(email, pendingPlan);
            return false;
        }
        if (!inspected || inspected.ok !== true) {
            _validatedSignupEmail = '';
            _authShowError(String((inspected && inspected.error && inspected.error.message) || 'Unable to verify email yet. Please try again.'));
            return false;
        }
        _validatedSignupEmail = String(email || '').trim().toLowerCase();
        return true;
    }

    function buildAuthRedirectForPendingPlan() {
        let redirect = '';
        try {
            const cfg = window.rcAuth && typeof window.rcAuth.getConfig === 'function' ? window.rcAuth.getConfig() : null;
            redirect = String((cfg && cfg.authRedirectUrl) || '').trim();
        } catch (_) {}
        if (!redirect) return '';
        try {
            const url = new URL(redirect, window.location.href);
            url.searchParams.set('view', 'login-page');
            url.searchParams.set('auth', 'verified');
            const pendingPlan = _readAuthPendingPlan();
            if (pendingPlan === 'pro' || pendingPlan === 'premium') {
                url.searchParams.set('next', 'checkout');
                url.searchParams.set('tier', pendingPlan);
            } else {
                url.searchParams.delete('next');
                url.searchParams.delete('tier');
            }
            return url.toString();
        } catch (_) {
            return redirect;
        }
    }

    async function authFormSubmit() {
        const email    = ((document.getElementById('loginEmail') || {}).value || '').trim();
        const username = ((document.getElementById('signupUsername') || {}).value || '').trim();
        const password = (document.getElementById('loginPassword') || {}).value || '';
        const confirm  = (document.getElementById('loginPasswordConfirm') || {}).value || '';
        const btn      = document.getElementById('auth-submit-btn');

        _authClearMessages();

        if (_authMode === 'signup' && _signupStep === 1) {
            if (!email) {
                _authShowError('Email is required.');
                return;
            }
            if (!(window.rcAuth && typeof window.rcAuth.looksLikeEmail === 'function' && window.rcAuth.looksLikeEmail(email))) {
                _authShowError('Enter a valid email address.');
                return;
            }
            if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
            try {
                const pendingPlan = _readAuthPendingPlan();
                const allowedToContinue = await _inspectSignupEmailOrBlock(email, pendingPlan);
                if (!allowedToContinue) return;
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = _authMode === 'signup' ? (_signupStep === 1 ? 'Next' : 'Create Account') : 'Sign In';
                }
            }
            _signupStep = 2;
            applyAuthModeUi();
            try { const nextField = document.getElementById('signupUsername'); if (nextField) nextField.focus(); } catch (_) {}
            return;
        }

        if (_authMode === 'signin') {
            if (!email || !password) {
                _authShowError('Email and password are required.');
                return;
            }
        } else {
            if (!email || !username || !password || !confirm) {
                _authShowError('Username, password, and confirmation are required.');
                return;
            }
            if (!(window.rcAuth && typeof window.rcAuth.looksLikeEmail === 'function' && window.rcAuth.looksLikeEmail(email))) {
                _signupStep = 1;
                _validatedSignupEmail = '';
                applyAuthModeUi();
                _authShowError('Enter a valid email address.');
                return;
            }
            if (String(_validatedSignupEmail || '') !== String(email || '').trim().toLowerCase()) {
                _signupStep = 1;
                _validatedSignupEmail = '';
                applyAuthModeUi();
                _authShowError('Finish the email step before creating your account.');
                return;
            }
            if (password !== confirm) {
                _authShowError('Passwords do not match.');
                return;
            }
        }

        if (!window.rcAuth || typeof window.rcAuth.signIn !== 'function') {
            _authShowError('Auth is not available in this environment.');
            return;
        }

        if (btn) { btn.disabled = true; btn.textContent = 'Please wait…'; }

        try {
            if (_authMode === 'signup') {
                // Re-check here so final submit cannot drift from the email step if an
                // email was edited, autofilled, or claimed after the first step settled.
                const pendingPlan = _readAuthPendingPlan();
                const allowedToCreate = await _inspectSignupEmailOrBlock(email, pendingPlan);
                if (!allowedToCreate) return;

                const result = await window.rcAuth.signUp(email, password, username, {
                    emailRedirectTo: buildAuthRedirectForPendingPlan(),
                });
                const error = result && result.error ? result.error : null;
                const identities = Array.isArray(result?.data?.user?.identities) ? result.data.user.identities : null;
                const existingAccountLikely = !error && !result?.data?.session && Array.isArray(identities) && identities.length === 0;
                if (error) {
                    const message = String(error.message || 'Account creation failed. Please try again.');
                    if (/already\s+registered|already\s+exists|user\s+already\s+registered/i.test(message)) {
                        _steerExistingAccountToSignin(email, pendingPlan);
                    } else {
                        _authShowError(message);
                    }
                } else if (existingAccountLikely) {
                    _steerExistingAccountToSignin(email, pendingPlan);
                } else if (result?.data?.session) {
                    _authShowSuccess(pendingPlan && pendingPlan !== 'free'
                        ? `Account created. Redirecting to ${pendingPlan === 'premium' ? 'Premium' : 'Pro'} checkout…`
                        : 'Account created. Continuing to your library…');
                } else {
                    _authShowSuccess(pendingPlan && pendingPlan !== 'free' ? `Check your email to verify your account. After verification, Log In to continue with ${pendingPlan === 'premium' ? 'Premium' : 'Pro'} checkout.` : 'Check your email to verify your account.');
                }
            } else {
                const { error } = await window.rcAuth.signIn(email, password);
                if (error) {
                    const message = String(error.message || 'Sign-in failed. Check your email and password.');
                    _authShowError(/email\s+not\s+confirmed/i.test(message) ? 'Check your email to verify your account before signing in.' : message);
                } else {
                    const pendingPlan = window.rcBilling && typeof window.rcBilling.readPendingPlan === 'function' ? String(window.rcBilling.readPendingPlan() || '').trim().toLowerCase() : '';
                    if (pendingPlan === 'pro' || pendingPlan === 'premium') {
                        _authShowSuccess(`Signed in. Redirecting to ${pendingPlan === 'premium' ? 'Premium' : 'Pro'} checkout…`);
                    }
                }
            }
        } catch (_) {
            _authShowError('Unexpected error. Please try again.');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = _authMode === 'signup' ? (_signupStep === 1 ? 'Next' : 'Create Account') : 'Sign In';
            }
        }
    }

    async function shellSignOut() {
        const logoutBtn = document.querySelector('[onclick="shellSignOut()"]');
        _accountControlsTransientBlock = 'auth:signout';
        applySignedInAccountControlReadiness('signout-start');
        if (logoutBtn) logoutBtn.disabled = true;
        try { window.rcInteraction && window.rcInteraction.pending('auth:signout', 'Signing out…'); } catch (_) {}
        try {
            if (window.rcAuth && typeof window.rcAuth.signOut === 'function') {
                const result = await window.rcAuth.signOut();
                if (result && result.ok === false) {
                    _accountControlsTransientBlock = null;
                    applySignedInAccountControlReadiness('signout-failed');
                    try {
                        const actions = window.rcInteraction && window.rcInteraction.actions
                            ? [window.rcInteraction.actions.retry(shellSignOut), window.rcInteraction.actions.refresh()]
                            : [];
                        window.rcInteraction && window.rcInteraction.error('auth:signout', 'We couldn\'t confirm sign-out yet.', { actions });
                    } catch (_) {}
                    return;
                }
            }
            try { window.rcInteraction && window.rcInteraction.clear('auth:signout'); } catch (_) {}
        } catch (_) {
            _accountControlsTransientBlock = null;
            applySignedInAccountControlReadiness('signout-error');
            try {
                const actions = window.rcInteraction && window.rcInteraction.actions
                    ? [window.rcInteraction.actions.retry(shellSignOut), window.rcInteraction.actions.refresh()]
                    : [];
                window.rcInteraction && window.rcInteraction.error('auth:signout', 'We couldn\'t confirm sign-out yet.', { actions });
            } catch (_) {}
        }
    }

    function _handleAuthChanged(e) {
        const { signedIn, source } = e.detail || {};
        const current = getCurrentVisibleSection();
        _accountControlsTransientBlock = null;
        // Appearance ownership stays outside shell auth transitions.
        // index.html owns first paint, state.js owns runtime adoption, and shell
        // appearance controls remain user-intent bridges through rcAppearance.set().

        if (!_shellAuthBootstrapped) {
            syncShellAuthPresentation(resolveSectionForAuth(current));
            return;
        }

        if (signedIn) {
            const pendingPaid = !!(window.rcBilling && typeof window.rcBilling.hasPendingPaidIntent === 'function' && window.rcBilling.hasPendingPaidIntent());
            if (pendingPaid && (current === 'landing-page' || current === 'login-page')) {
                syncShellAuthPresentation(current === 'landing-page' ? 'login-page' : current);
                return;
            }
            if (current === 'landing-page' || current === 'login-page') {
                showSection('dashboard', { historyMode: 'replace', releaseReason: 'dashboard-release:auth-change' });
                return;
            }
            syncShellAuthPresentation(current);
            if (source === 'SIGNED_IN') {
                try { refreshLibrary('auth-change-signed-in'); } catch(_) {}
            }
        } else {
            if (current === 'profile-page') showSection('landing-page', { historyMode: 'replace' });
            else syncShellAuthPresentation(current);
        }
    }

    try {
        document.addEventListener('rc:auth-changed', _handleAuthChanged);
    } catch(_) {}

    window.addEventListener('popstate', () => {
        showSection(readSectionFromLocation(), { historyMode: 'none' });
    });

    document.addEventListener('DOMContentLoaded', async () => {
        installOwnershipGuards();
        installPricingModalClickAway();
        initPublicOnboardingSurface();
        try {
            document.body.classList.add('auth-hydrating');
            document.body.classList.add('boot-pending');
        } catch (_) {}
        scheduleBootPendingMessage();
        const appearanceReady = waitForRuntimeAppearanceReady();
        const appearancePainted = Promise.resolve(appearanceReady).then(() => waitForRuntimeAppearancePainted());
        try {
            if (window.rcAuth && typeof window.rcAuth.init === 'function') {
                await window.rcAuth.init();
            }
        } catch (_) {}

        const requestedSection = readSectionFromLocation();
        const settledSection = resolveSectionForAuth(requestedSection || 'landing-page');
        _shellAuthBootstrapped = true;
        // Start dashboard/library settlement behind the boot hold. If signed-in
        // library truth resolves quickly, reveal the settled dashboard directly.
        // If it is still unresolved at the threshold, reveal neutral pending; if
        // final truth lands immediately after that, setLibrarySurfaceState() keeps
        // pending visible for a short readable minimum instead of flashing it.
        const sectionPromise = Promise.resolve(showSection(settledSection, { historyMode: 'replace' }))
            .catch((err) => shellTrailPush('boot-section-settlement-error', { message: String(err && err.message || err) }));
        const bootHoldMs = 1000;
        try {
            await Promise.all([
                appearancePainted,
                waitForDashboardLibrarySettlementOrThreshold(settledSection, bootHoldMs, 'boot')
            ]);
            await waitForBootRevealFrame();
        } catch (_) {}
        releaseBootPending();
        try { await sectionPromise; } catch (_) {}
    });
    // ── Profile tabs ─────────────────────────────────────────────
    function switchTab(tabId) {
        document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden-section'));
        document.getElementById(tabId).classList.remove('hidden-section');
        document.querySelectorAll('.profile-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });
        if (tabId === 'tab-profile') { try { renderProfileSurface(); } catch (_) {} }
        if (tabId === 'tab-subscription') { try { renderSubscriptionSurface(); } catch (_) {} }
    }

    // ── Tier simulation (dev/localhost only, gated by canSimulateTierSelection) ──
    function canSimulateTierSelection() {
        return !!(window.rcPolicy && typeof window.rcPolicy.canSimulateTier === 'function' && window.rcPolicy.canSimulateTier());
    }

    function syncTierButtonState() {
        const current = (window.rcEntitlements && typeof window.rcEntitlements.getTier === 'function')
            ? window.rcEntitlements.getTier()
            : ((window.rcPolicy && typeof window.rcPolicy.getTier === 'function') ? window.rcPolicy.getTier() : 'basic');
        const map = { basic: 'Basic', pro: 'Pro', premium: 'Premium' };
        document.querySelectorAll('.tier-btn').forEach((btn) => {
            const next = map[current] || 'Basic';
            btn.classList.toggle('active', btn.textContent.trim() === next);
            btn.disabled = !canSimulateTierSelection();
        });
        const rows = new Set();
        document.querySelectorAll('.tier-btn').forEach((btn) => { if (btn.parentElement) rows.add(btn.parentElement); });
        rows.forEach((row) => { row.style.display = canSimulateTierSelection() ? '' : 'none'; });
    }

    function setTier(btn) {
        if (!canSimulateTierSelection()) return;
        document.querySelectorAll('.tier-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const map = { 'Basic': 'basic', 'Pro': 'pro', 'Premium': 'premium' };
        const value = map[btn.textContent.trim()] || 'basic';
        // Call the runtime policy API directly — do not dispatch through #tierSelect DOM element.
        if (window.rcPolicy && typeof window.rcPolicy.refreshForTier === 'function') {
            window.rcPolicy.refreshForTier(value).catch(() => {});
        }
        updateExplorerSwatchState();
        try { syncExplorerMusicSource(); } catch (_) {}
    }

    function updateTierPill() {
        const tier = (window.rcPolicy && typeof window.rcPolicy.getTier === 'function') ? window.rcPolicy.getTier() : 'basic';
        const pill = document.getElementById('reading-tier-pill');
        if (pill) { const map = { basic: 'Basic', pro: 'Pro', premium: 'Premium' }; pill.textContent = map[tier] || 'Basic'; }
    }

    function getCurrentTier() {
        if (window.rcEntitlements && typeof window.rcEntitlements.getTier === 'function') {
            try { return window.rcEntitlements.getTier(); } catch (_) {}
        }
        if (window.rcPolicy && typeof window.rcPolicy.getTier === 'function') {
            try { return window.rcPolicy.getTier(); } catch (_) {}
        }
        return 'basic';
    }

    // ── Theme ────────────────────────────────────────────────────
    const BUILTIN_MUSIC_SRC = 'assets/song.mp3';
    let _customMusicUrl = null;
    let _customMusicRecord = null;

    function revokeCustomMusicUrl() {
        if (_customMusicUrl) {
            try { URL.revokeObjectURL(_customMusicUrl); } catch (_) {}
            _customMusicUrl = null;
        }
    }

    function syncMusicRowSelection(source, hasCustom) {
        document.querySelectorAll('#musicPickerList .music-picker-row').forEach((row) => {
            const rowSource = row.dataset.musicSource;
            const selected = rowSource === source && (rowSource !== 'custom' || hasCustom);
            row.classList.toggle('selected', selected);
            row.classList.toggle('unavailable', rowSource === 'custom' && !hasCustom);
        });
    }

    async function loadCustomMusicRecord(forceReload) {
        if (!forceReload && _customMusicRecord) return _customMusicRecord;
        if (!(window.rcMusicDb && typeof window.rcMusicDb.customMusicGet === 'function')) return null;
        try { _customMusicRecord = await window.rcMusicDb.customMusicGet(); } catch (_) { _customMusicRecord = null; }
        return _customMusicRecord;
    }

    function setBgMusicSource(src, sourceKey) {
        const audio = document.getElementById('bgMusic');
        if (!audio || !src) return false;
        if (audio.dataset.rcSourceKey === sourceKey && audio.src) return true;
        audio.dataset.rcSourceKey = sourceKey;
        try { audio.src = src; audio.load(); } catch (_) { return false; }
        return true;
    }

    async function syncExplorerMusicSource(forceReload) {
        const themeState = (window.rcTheme && typeof window.rcTheme.get === 'function') ? window.rcTheme.get() : { themeId: 'default', settings: { music: 'default' } };
        const settings = (themeState && themeState.settings) || { music: 'default' };
        const isExplorer = themeState && themeState.themeId === 'explorer';
        if (!isExplorer || settings.music !== 'custom') {
            revokeCustomMusicUrl();
            return setBgMusicSource(BUILTIN_MUSIC_SRC, 'default');
        }
        const record = await loadCustomMusicRecord(forceReload);
        if (!record || !record.blob) {
            try { if (window.rcTheme && typeof window.rcTheme.patchSettings === 'function') window.rcTheme.patchSettings({ music: 'default' }); } catch (_) {}
            revokeCustomMusicUrl();
            return setBgMusicSource(BUILTIN_MUSIC_SRC, 'default');
        }
        revokeCustomMusicUrl();
        _customMusicUrl = URL.createObjectURL(record.blob);
        return setBgMusicSource(_customMusicUrl, `custom:${record.name || 'track'}:${record.savedAt || 0}`);
    }

    function setTheme(theme) {
        try {
            if (window.rcTheme && typeof window.rcTheme.set === 'function') {
                window.rcTheme.set(theme);
                window.rcTheme.syncShellState();
            }
        } catch (_) {}
        refreshExplorerPanel();
        try { syncExplorerMusicSource(); } catch (_) {}
    }

    function handleExplorerSwatch() {
        const canUse = !!(window.rcTheme && typeof window.rcTheme.canUseTheme === 'function' && window.rcTheme.canUseTheme('explorer'));
        if (!canUse) openModal('pricing-modal');
        else setTheme('explorer');
    }

    function updateExplorerSwatchState() {
        const btn = document.getElementById('explorer-swatch-btn');
        if (!btn) return;
        const swatch = btn.querySelector('.theme-swatch');
        const canUse = !!(window.rcTheme && typeof window.rcTheme.canUseTheme === 'function' && window.rcTheme.canUseTheme('explorer'));
        if (!canUse) {
            btn.classList.add('explorer-locked');
            btn.title = 'Upgrade to Pro+ to unlock Explorer theme';
            if (swatch) swatch.style.opacity = '0.6';
        } else {
            btn.classList.remove('explorer-locked');
            btn.title = 'Explorer theme';
            if (swatch) swatch.style.opacity = '1';
        }
    }

    function switchReadingSettingsTab(tabName) {
        document.querySelectorAll('.rs-tab').forEach((tab) => {
            const active = tab.dataset.rsTab === tabName;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        document.querySelectorAll('.rs-panel').forEach((panel) => {
            panel.style.display = panel.id === `rs-panel-${tabName}` ? '' : 'none';
        });
        if (tabName === 'themes') refreshExplorerPanel();
    }

    function setAppAppearance(mode) {
        try { if (window.rcAppearance && typeof window.rcAppearance.set === 'function') window.rcAppearance.set(mode); } catch (_) {}
    }

    function refreshExplorerPanel() {
        const explorerPanel = document.getElementById('rs-explorer-panel');
        const emptyState = document.getElementById('rs-themes-empty');
        if (!explorerPanel || !emptyState) return;
        const themeState = (window.rcTheme && typeof window.rcTheme.get === 'function') ? window.rcTheme.get() : { themeId: 'default' };
        const isExplorer = themeState.themeId === 'explorer';
        explorerPanel.style.display = isExplorer ? '' : 'none';
        emptyState.style.display = isExplorer ? 'none' : '';
        try { if (window.rcTheme) window.rcTheme.syncShellState(); } catch (_) {}
        if (isExplorer) populateExplorerPanel();
    }

    function populateExplorerPanel() {
        const settings = (window.rcTheme && typeof window.rcTheme.getSettings === 'function') ? window.rcTheme.getSettings() : null;
        if (!settings) return;
        const fontSelect = document.getElementById('explorer-font-select');
        const embersToggle = document.getElementById('explorer-embers-toggle');
        const bgSelect = document.getElementById('explorer-bg-select');
        const musicSub = document.getElementById('explorer-music-sub');
        if (fontSelect) fontSelect.value = settings.font || 'Lora';
        if (embersToggle) embersToggle.checked = settings.embersOn !== false;
        if (bgSelect) bgSelect.value = settings.backgroundMode || 'wallpaper';
        document.querySelectorAll('.explorer-accent-swatch').forEach((btn) => btn.classList.toggle('selected', btn.dataset.accentSwatch === settings.accentSwatch));
        document.querySelectorAll('.explorer-ember-swatch').forEach((btn) => btn.classList.toggle('selected', btn.dataset.emberPreset === settings.emberPreset));
        if (musicSub) musicSub.textContent = settings.music === 'custom' ? ((_customMusicRecord && _customMusicRecord.name) || 'Custom loaded') : 'Built-in default';
    }

    function explorerSettingChanged() {
        if (!(window.rcTheme && typeof window.rcTheme.patchSettings === 'function')) return;
        const fontSelect = document.getElementById('explorer-font-select');
        const embersToggle = document.getElementById('explorer-embers-toggle');
        const bgSelect = document.getElementById('explorer-bg-select');
        window.rcTheme.patchSettings({
            font: fontSelect ? fontSelect.value : 'Lora',
            embersOn: !!(embersToggle && embersToggle.checked),
            backgroundMode: bgSelect ? bgSelect.value : 'wallpaper'
        });
        populateExplorerPanel();
    }

    function explorerAccentSwatchPick(name) {
        if (!(window.rcTheme && typeof window.rcTheme.patchSettings === 'function')) return;
        window.rcTheme.patchSettings({ accentSwatch: name });
        populateExplorerPanel();
    }

    function explorerEmberPresetPick(name) {
        if (!(window.rcTheme && typeof window.rcTheme.patchSettings === 'function')) return;
        window.rcTheme.patchSettings({ emberPreset: name });
        populateExplorerPanel();
    }

    function explorerResetDefaults() {
        if (!(window.rcTheme && typeof window.rcTheme.resetSettings === 'function')) return;
        window.rcTheme.resetSettings();
        try { syncExplorerMusicSource(); } catch (_) {}
        populateExplorerPanel();
    }

    async function initMusicPickerState(forceReload) {
        const record = await loadCustomMusicRecord(forceReload);
        const deleteBtn = document.getElementById('musicCustomDeleteBtn');
        const status = document.getElementById('musicCustomStatus');
        const uploadBtn = document.querySelector('#musicPickerList .music-upload-btn');
        const settings = (window.rcTheme && typeof window.rcTheme.getSettings === 'function') ? window.rcTheme.getSettings() : { music: 'default' };
        const hasCustom = !!(record && record.blob);
        if (status) status.textContent = hasCustom ? `Loaded: ${record.name || 'Custom track'}` : 'No custom file loaded';
        if (deleteBtn) deleteBtn.style.display = hasCustom ? '' : 'none';
        if (uploadBtn) uploadBtn.textContent = hasCustom ? 'Replace' : 'Upload';
        syncMusicRowSelection(hasCustom && settings.music === 'custom' ? 'custom' : 'default', hasCustom);
        populateExplorerPanel();
        return hasCustom;
    }

    function openMusicPicker() { initMusicPickerState(false); openModal('musicPickerModal'); }
    function closeMusicPicker() { closeModal('musicPickerModal'); }

    function triggerMusicUpload() {
        if (!(window.rcTheme && typeof window.rcTheme.canUseCustomMusic === 'function' && window.rcTheme.canUseCustomMusic())) { openModal('pricing-modal'); return; }
        const input = document.getElementById('musicCustomInput');
        if (input) input.click();
    }

    async function handleMusicUpload(input) {
        const file = input && input.files && input.files[0];
        if (!file) return;
        if (!(window.rcTheme && typeof window.rcTheme.canUseCustomMusic === 'function' && window.rcTheme.canUseCustomMusic())) {
            openModal('pricing-modal');
            input.value = '';
            return;
        }
        try {
            if (window.rcMusicDb && typeof window.rcMusicDb.customMusicPut === 'function') {
                await window.rcMusicDb.customMusicPut(file, file.name, file.type);
            }
            _customMusicRecord = null;
            await initMusicPickerState(true);
            if (window.rcTheme && typeof window.rcTheme.patchSettings === 'function') window.rcTheme.patchSettings({ music: 'custom' });
            await syncExplorerMusicSource(true);
            populateExplorerPanel();
        } catch (_) {}
        if (input) input.value = '';
    }

    async function deleteCustomMusic() {
        try {
            if (window.rcMusicDb && typeof window.rcMusicDb.customMusicDelete === 'function') {
                await window.rcMusicDb.customMusicDelete();
            }
            _customMusicRecord = null;
            revokeCustomMusicUrl();
            if (window.rcTheme && typeof window.rcTheme.patchSettings === 'function') window.rcTheme.patchSettings({ music: 'default' });
            await initMusicPickerState(true);
            await syncExplorerMusicSource(true);
            populateExplorerPanel();
        } catch (_) {}
    }

    async function selectMusicRow(source) {
        const hasCustom = await initMusicPickerState(false);
        if (source === 'custom' && !(window.rcTheme && typeof window.rcTheme.canUseCustomMusic === 'function' && window.rcTheme.canUseCustomMusic())) {
            openModal('pricing-modal');
            return false;
        }
        if (source === 'custom' && !hasCustom) return false;
        if (window.rcTheme && typeof window.rcTheme.patchSettings === 'function') window.rcTheme.patchSettings({ music: source === 'custom' ? 'custom' : 'default' });
        syncMusicRowSelection(source === 'custom' ? 'custom' : 'default', hasCustom);
        await syncExplorerMusicSource(source === 'custom');
        populateExplorerPanel();
        return true;
    }

    // ── F1: TTS Speed Control bridge ─────────────────────────────
    function shellSetSpeed(value) {
        const rate = parseFloat(value) || 1;
        try { if (typeof setPlaybackRate === 'function') return setPlaybackRate(rate); } catch(_) {}
        return rate;
    }

    function getActivePlaybackPageIndex(playbackStatus) {
        const status = playbackStatus || null;
        try {
            const parsed = (typeof readingTargetFromKey === 'function' && status?.key)
                ? readingTargetFromKey(String(status.key))
                : null;
            const idx = Number(parsed?.pageIndex);
            if (Number.isFinite(idx) && idx >= 0) return idx;
        } catch (_) {}
        try {
            const idx = Number((window.__rcReadingTarget || {}).pageIndex);
            if (Number.isFinite(idx) && idx >= 0) return idx;
        } catch (_) {}
        return -1;
    }

    function getVisibleReadingPageIndex() {
        try {
            const pageEls = Array.from(document.querySelectorAll('.page'));
            if (pageEls.length) {
                const doc = document.documentElement;
                const viewportBottom = window.scrollY + window.innerHeight;
                const docBottom = Math.max(doc.scrollHeight, document.body?.scrollHeight || 0);
                if ((docBottom - viewportBottom) <= 4) {
                    const lastIdx = parseInt(pageEls[pageEls.length - 1]?.dataset?.pageIndex || String(pageEls.length - 1), 10);
                    if (!Number.isNaN(lastIdx) && lastIdx >= 0) return lastIdx;
                }
                let bestIdx = -1;
                let bestDist = Infinity;
                for (const el of pageEls) {
                    const rect = el.getBoundingClientRect();
                    if (rect.height <= 0) continue;
                    const idx = parseInt(el.dataset.pageIndex || '-1', 10);
                    if (Number.isNaN(idx) || idx < 0) continue;
                    const dist = Math.abs(rect.top);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestIdx = idx;
                    }
                }
                if (Number.isFinite(bestIdx) && bestIdx >= 0) return bestIdx;
            }
        } catch (_) {}
        try {
            if (typeof lastFocusedPageIndex === 'number' && lastFocusedPageIndex >= 0) return lastFocusedPageIndex;
        } catch (_) {}
        return 0;
    }

    function bringPlaybackPageIntoView(playbackStatus) {
        const idx = getActivePlaybackPageIndex(playbackStatus);
        if (!Number.isFinite(idx) || idx < 0) return false;
        const pageEl = document.querySelector(`.page[data-page-index="${idx}"]`) || document.querySelectorAll('.page')[idx];
        if (!pageEl) return false;
        try { pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) { return false; }
        return true;
    }

    function hasActiveReadingCards() {
        const reading = document.getElementById('reading-mode');
        const pagesEl = document.getElementById('pages');
        return !!(reading && !reading.classList.contains('hidden-section') && pagesEl && pagesEl.querySelector('.page'));
    }

    // PATCH(authority-boundary): Shell no longer directly manipulates importer DOM.
    // resetImporterState() in import.js is the single authoritative path:
    // it clears UI and all internal parser state (_file, _zip, _tocItems, etc.)
    // so the next open is always clean. The old shell version only reset UI,
    // leaving internal state dirty and allowing stale file/parse data to persist.
    function clearImporterTransientUI() {
        try { if (typeof resetImporterState === 'function') resetImporterState({ keepModalOpen: false }); } catch(_) {}
    }

    // PATCH(authority-boundary): Shell no longer owns runtime cleanup.
    // exitReadingSession() in library.js is the single authoritative path:
    // it stops TTS, cancels countdown, clears music, and emits diagnostics.
    function cleanupReadingTransientState() {
        try { if (typeof exitReadingSession === 'function') exitReadingSession(); } catch(_) {}
    }

    // ── Bottom bar controls ──────────────────────────────────────

    const SHELL_PLAYBACK_CLOUD_RESTART_VISIBLE_AFTER_MS = 400;

    function getShellVoiceVolumeLevel() {
        try {
            const voice = document.getElementById('vol_voice');
            if (voice && voice.value !== '') return Number(voice.value);
        } catch (_) {}
        try {
            const stored = JSON.parse(localStorage.getItem('rc_volumes') || '{}');
            if (typeof stored.voice === 'number') return Number(stored.voice);
        } catch (_) {}
        return null;
    }

    function computeShellPlaybackIndicatorMessage(status, countdown, support, eligibility) {
        const supportReason = String(support && support.reason || eligibility?.reasons?.canPlay || '').trim();
        const browserVoiceUnavailable = support && support.playable === false && support.browserVoiceAvailable === false;
        if (browserVoiceUnavailable || (!support?.playable && supportReason)) {
            return supportReason || 'No browser English voice is available on this device.';
        }

        const voiceVolume = getShellVoiceVolumeLevel();
        if (status?.active && Number.isFinite(voiceVolume) && voiceVolume <= 0) {
            return 'Voice volume is off';
        }

        const pending = status?.cloudRestartPending || null;
        const cloudRestartActive = !!(status?.cloudRestartInFlight || pending?.active);
        const elapsedMs = Number(pending?.elapsedMs || 0);
        if (cloudRestartActive && elapsedMs >= SHELL_PLAYBACK_CLOUD_RESTART_VISIBLE_AFTER_MS) {
            return String(pending?.message || 'Loading audio…');
        }

        // Playback-start failure is intentionally not inferred here. The current
        // runtime getter does not expose a retry-exhausted/start-error field.
        return '';
    }

    function setShellPlaybackIndicatorMessage(message) {
        const indicator = document.getElementById('shell-playback-indicator');
        if (!indicator) return;
        const text = String(message || '').trim();
        if (text) {
            indicator.textContent = text;
            indicator.hidden = false;
        } else {
            indicator.textContent = '';
            indicator.hidden = true;
        }
    }

    // Pause/Play — calls app's tts.js functions if available.
    // Guards against first-use case where TTS was never started (TTS_STATE.activeKey is null).
    function syncShellPlaybackControls() {
        const btn = document.getElementById('shell-play-btn');
        const labelEl = document.getElementById('shell-play-label');
        const iconEl = btn ? btn.querySelector('.shell-play-icon') : null;
        const prevBtn = document.getElementById('shell-prev-btn');
        const nextBtn = document.getElementById('shell-next-btn');
        let status = { active: false, paused: false };
        let countdown = { active: false };
        let support = { playable: true, reason: '' };
        let eligibility = { canPlay: false, canPause: false, canResume: false, canSkipPrev: false, canSkipNext: false, reasons: {} };
        try { if (typeof getPlaybackStatus === 'function') status = getPlaybackStatus() || status; } catch (_) {}
        try { if (typeof getCountdownStatus === 'function') countdown = getCountdownStatus() || countdown; } catch (_) {}
        try { if (typeof getTtsSupportStatus === 'function') support = getTtsSupportStatus() || support; } catch (_) {}
        try { if (typeof getPlaybackControlEligibility === 'function') eligibility = getPlaybackControlEligibility() || eligibility; } catch (_) {}
        const canPlay = !!eligibility.canPlay;
        const indicatorMessage = computeShellPlaybackIndicatorMessage(status, countdown, support, eligibility);
        if (btn) {
            const label = eligibility.canResume ? 'Resume' : (eligibility.canPause ? 'Pause' : 'Play');
            btn.classList.toggle('active', !!status.active && !status.paused);
            btn.title = indicatorMessage || (status.active ? (status.paused ? 'Resume narration' : 'Pause narration') : (countdown.active ? 'Resume current page from countdown' : 'Play current page'));
            // Keep Play reachable even when runtime reports a blocked state; the
            // indicator explains why while shell still forwards intent only.
            btn.disabled = false;
            btn.setAttribute('aria-disabled', 'false');
            if (labelEl) labelEl.textContent = label;
            if (iconEl) {
                iconEl.innerHTML = label === 'Pause'
                    ? '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>'
                    : '<polygon points="8 5 19 12 8 19 8 5"></polygon>';
            }
        }
        [prevBtn, nextBtn].forEach((control) => {
            if (!control) return;
            const isPrev = control === prevBtn;
            const canSkip = isPrev ? !!eligibility.canSkipPrev : !!eligibility.canSkipNext;
            const reason = isPrev
                ? (eligibility.reasons?.canSkipPrev || 'Skip unavailable')
                : (eligibility.reasons?.canSkipNext || 'Skip unavailable');
            control.disabled = !canSkip;
            control.setAttribute('aria-disabled', String(!canSkip));
            control.title = canSkip ? control.title.replace('disabled','').trim() : `Skip unavailable: ${reason}`;
        });
        document.querySelectorAll('.tts-btn[data-tts="page"]').forEach((pageBtn) => {
            const disabled = !support.playable && !pageBtn.classList.contains('tts-active');
            pageBtn.disabled = disabled;
            pageBtn.setAttribute('aria-disabled', String(disabled));
            if (disabled) pageBtn.title = support.reason || 'Playback unavailable';
            else pageBtn.removeAttribute('title');
        });
        // Surface playback/support status without taking ownership of runtime truth.
        setShellPlaybackIndicatorMessage(indicatorMessage);
        // PATCH(speed-sync): Keep #shell-speed in sync with TTS_STATE.rate.
        // Previously, if setPlaybackRate() was called from any path other than
        // the shell select itself (e.g. programmatic change, restored preference),
        // the select remained stale. Now it always reflects runtime truth.
        try {
            const speedSel = document.getElementById('shell-speed');
            const runtimeRate = String(Number(status.playbackRate || 1));
            if (speedSel && speedSel.value !== runtimeRate) {
                // Only update if the value exists as an option, to avoid
                // leaving the select in an invalid/blank state.
                const hasOpt = Array.from(speedSel.options).some(o => o.value === runtimeRate);
                if (hasOpt) speedSel.value = runtimeRate;
            }
        } catch (_) {}
    }

    function handlePausePlay() {
        // Shell is a pure delegate. All routing — resume, pause, countdown
        // cancel+restart, and fresh-start — is owned by pauseOrResumeReading()
        // in tts.js. Shell does not inspect eligibility or countdown here.
        // Runtime owns current-page truth; shell only forwards play/pause intent.
        const before = {
            playback: (typeof getPlaybackStatus === 'function') ? getPlaybackStatus() : null,
            countdown: (typeof getCountdownStatus === 'function') ? getCountdownStatus() : null,
        };
        let result = false;
        try { if (typeof pauseOrResumeReading === 'function') result = !!pauseOrResumeReading(); } catch (_) {}
        setTimeout(syncShellPlaybackControls, 0);
        const afterPlayback = (typeof getPlaybackStatus === 'function') ? getPlaybackStatus() : null;
        if (afterPlayback?.active && !afterPlayback.paused && (!before.playback?.active || before.playback?.paused || before.countdown?.active)) {
            bringPlaybackPageIntoView(afterPlayback);
        }
        return result;
    }

    // PATCH(autoplay-authority): was a dead stub returning false.
    // toggleAutoplay() in tts.js is the runtime owner of autoplay state.
    // Shell forwards the intent and syncs the checkbox so the hidden #autoplayToggle
    // reflects truth (ui.js reads it on boot, and the settings panel shows it).
    function handleAutoplayToggle() {
        let next = false;
        try { if (typeof toggleAutoplay === 'function') next = !!toggleAutoplay(); } catch(_) {}
        try {
            const cb = document.getElementById('autoplayToggle');
            if (cb) cb.checked = next;
        } catch(_) {}
        return next;
    }



    function handleTtsStep(delta) {
        let moved = false;
        try {
            if (typeof ttsJumpSentence === 'function') moved = !!ttsJumpSentence(delta);
        } catch (_) {}
        syncShellPlaybackControls();
        const afterPlayback = (typeof getPlaybackStatus === 'function') ? getPlaybackStatus() : null;
        if (moved && afterPlayback?.active && !afterPlayback.paused) {
            bringPlaybackPageIntoView(afterPlayback);
        }
        return moved;
    }

    document.addEventListener('DOMContentLoaded', () => {
        // HELD — boot-order bridge. Do not remove without boot timing proof.
        //
        // Why this exists: shell.js attaches its rc:runtime-policy-changed listener
        // during DOMContentLoaded, but state.js is injected later by app.js and emits
        // rc:runtime-policy-changed when it applies the initial fallback policy. Because
        // of that load order, shell can miss the first policy event entirely.
        //
        // Retirement condition: either prove via dev-only boot timing probes (cold
        // signed-out, cold signed-in, refresh signed-in) that rc:runtime-policy-changed
        // always fires after this listener is attached, or replace with a one-time
        // immediate read from current owner state after listener attachment. Do not
        // remove this timeout on the assumption it is "just a delay."
        setTimeout(() => {
            _bootProbe.mark('boot-timeout-fired', {
                rcPolicyPresent:     !!window.rcPolicy,
                rcThemePresent:      !!window.rcTheme,
                rcAppearancePresent: !!window.rcAppearance,
                rcEntitlementsPresent: !!window.rcEntitlements
            });
            updateTierPill();
            updateExplorerSwatchState();
            try { if (window.rcTheme) window.rcTheme.syncShellState(); } catch (_) {}
            try { if (window.rcAppearance) window.rcAppearance.syncButtons(); } catch (_) {}
            try { refreshExplorerPanel(); } catch (_) {}
            // Delayed report: fires after timeout so all marks are present.
            setTimeout(() => { _bootProbe.report(); }, 150);
        }, 500);
        // Reading entry is fully runtime-owned via startReadingFromPreview → __rcLoadBook.
    });

    // =========================================================================
    // SLICE 7 MODULE BOUNDARY 2/6 (continued) — Dashboard/Library Visible Settlement
    // Library table rendering: the visible output of the settlement decision
    // made in the primary 2/6 block above. Refresh is driven by the
    // rc:local-library-changed event and show-section-dashboard transitions.
    // =========================================================================

    // ── Library table — refreshed via rc:local-library-changed and show-section-dashboard ──
    function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    let libraryRefreshRetryTimer = null;
    let _loggedFirstLocalLibraryRead = false;
    let _libraryInitialResolutionComplete = false;
    let _libraryRefreshSequence = 0;
    const DASHBOARD_LIBRARY_PENDING_MIN_VISIBLE_MS = 1000;
    let _dashboardLibraryPendingVisibleAt = 0;
    let _dashboardLibraryDeferredFinalTimer = null;
    let _dashboardLibraryDeferredFinalState = null;
    let _lastDashboardLibraryRevealTransaction = null;

    function scheduleLibraryPendingBanner() {
        if (_libraryPendingBannerTimer || _libraryInitialResolutionComplete) return;
        _libraryPendingBannerTimer = window.setTimeout(() => {
            _libraryPendingBannerTimer = null;
            if (_libraryInitialResolutionComplete) return;
            if (!isAuthedUser()) return;
            if (getCurrentVisibleSection() !== 'dashboard') return;
            try {
                window.rcInteraction && window.rcInteraction.pending('library:hydrate', 'Books are still loading…');
            } catch (_) {}
        }, 1400);
    }

    function clearLibraryPendingBanner() {
        if (_libraryPendingBannerTimer) {
            window.clearTimeout(_libraryPendingBannerTimer);
            _libraryPendingBannerTimer = null;
        }
        try { window.rcInteraction && window.rcInteraction.clear('library:hydrate'); } catch (_) {}
    }

    function isDashboardVisibleToUser() {
        const dashboard = document.getElementById('dashboard');
        if (!dashboard || dashboard.classList.contains('hidden-section')) return false;
        try {
            if (document.body.classList.contains('boot-pending') || document.body.classList.contains('auth-hydrating')) return false;
        } catch (_) {}
        return true;
    }

    function clearDeferredDashboardLibraryFinalState() {
        if (_dashboardLibraryDeferredFinalTimer) {
            window.clearTimeout(_dashboardLibraryDeferredFinalTimer);
            _dashboardLibraryDeferredFinalTimer = null;
        }
        _dashboardLibraryDeferredFinalState = null;
    }

    function markDashboardPendingVisibleIfNeeded(reason = 'dashboard-pending-visible') {
        const state = readDashboardLibraryState();
        if (state !== 'pending' || !isDashboardVisibleToUser()) return false;
        if (!_dashboardLibraryPendingVisibleAt) {
            _dashboardLibraryPendingVisibleAt = performance.now();
            _lastDashboardLibraryRevealTransaction = Object.assign({}, _lastDashboardLibraryRevealTransaction || {}, {
                pendingVisibleAtMs: Math.round(_dashboardLibraryPendingVisibleAt),
                pendingMinVisibleMs: DASHBOARD_LIBRARY_PENDING_MIN_VISIBLE_MS,
                pendingVisibleReason: reason,
                at: new Date().toISOString()
            });
        }
        return true;
    }

    function applyLibrarySurfaceStateNow(normalized, reason = 'library-surface') {
        const pendingEl = document.getElementById('library-pending');
        const popEl = document.getElementById('library-populated');
        const emptyEl = document.getElementById('library-empty');
        const sampleEl = document.getElementById('library-public-sample');
        // pending panel serves both 'pending' and 'error' states
        if (pendingEl) pendingEl.classList.toggle('hidden-section', normalized !== 'pending' && normalized !== 'error');
        if (popEl) popEl.classList.toggle('hidden-section', normalized !== 'populated');
        if (emptyEl) emptyEl.classList.toggle('hidden-section', normalized !== 'empty');
        if (sampleEl) sampleEl.classList.toggle('hidden-section', normalized !== 'sample');
        const dashboardEl = document.getElementById('dashboard');
        if (dashboardEl) dashboardEl.setAttribute('data-library-state', normalized);
        applyDashboardLibraryChrome(normalized, reason);

        if (normalized === 'pending') {
            markDashboardPendingVisibleIfNeeded(reason);
        } else if (isSettledDashboardLibraryState(normalized) || normalized === 'sample') {
            _dashboardLibraryPendingVisibleAt = 0;
            clearDeferredDashboardLibraryFinalState();
        }
    }

    function maybeDeferDashboardLibraryFinalState(normalized, reason = 'library-surface') {
        if (!isSettledDashboardLibraryState(normalized)) return false;
        if (!isDashboardVisibleToUser()) return false;
        if (!_dashboardLibraryPendingVisibleAt) return false;
        const elapsed = performance.now() - _dashboardLibraryPendingVisibleAt;
        const remaining = DASHBOARD_LIBRARY_PENDING_MIN_VISIBLE_MS - elapsed;
        if (remaining <= 0) return false;
        _dashboardLibraryDeferredFinalState = { state: normalized, reason };
        if (_dashboardLibraryDeferredFinalTimer) window.clearTimeout(_dashboardLibraryDeferredFinalTimer);
        _dashboardLibraryDeferredFinalTimer = window.setTimeout(() => {
            const deferred = _dashboardLibraryDeferredFinalState;
            clearDeferredDashboardLibraryFinalState();
            if (!deferred) return;
            applyLibrarySurfaceStateNow(deferred.state, deferred.reason + ':deferred-final');
        }, Math.max(0, remaining));
        _lastDashboardLibraryRevealTransaction = Object.assign({}, _lastDashboardLibraryRevealTransaction || {}, {
            deferredFinalState: normalized,
            deferredReason: reason,
            deferredRemainingMs: Math.round(remaining),
            pendingMinVisibleMs: DASHBOARD_LIBRARY_PENDING_MIN_VISIBLE_MS,
            at: new Date().toISOString()
        });
        return true;
    }

    function setLibrarySurfaceState(state, reason = 'library-surface') {
        const normalized = (state === 'populated' || state === 'empty' || state === 'error' || state === 'sample')
            ? state : 'pending';
        if (maybeDeferDashboardLibraryFinalState(normalized, reason)) return;
        applyLibrarySurfaceStateNow(normalized, reason);
    }

    async function refreshLibrary(reason = 'unknown') {
        const rowsEl  = document.getElementById('library-rows');
        // NOTE: #dashboard-subtitle is NOT owned by refreshLibrary.
        // renderLibrarySubtitle() is the single owner of that element.
        // CSS min-height on #dashboard-subtitle ensures it never causes layout shift.
        if (!rowsEl) return;
        const authed = !!isAuthedUser();
        const hasLocalLibraryOwner = typeof localBooksGetAll === 'function';

        if (!authed) {
            _libraryInitialResolutionComplete = false;
            clearLibraryPendingBanner();
            if (libraryRefreshRetryTimer) {
                clearTimeout(libraryRefreshRetryTimer);
                libraryRefreshRetryTimer = null;
            }
            setLibrarySurfaceState('sample', reason);
            return;
        }

        // Runtime honesty contract for the dashboard books area:
        // keep the container visible immediately, keep books truth owned by the
        // local library runtime, and show a neutral pending state until the first
        // truthful local-library read resolves to populated vs empty/importer.
        // After that first truthful read, later refreshes keep the current visible
        // surface instead of flashing back through pending.
        if (!_libraryInitialResolutionComplete) {
            setLibrarySurfaceState('pending', reason);
            scheduleLibraryPendingBanner();
        }

        // Until runtime book storage is actually available, do not imply an empty
        // library and do not leave a blank gap. Keep the pending surface visible
        // and retry owner discovery.
        // IMPORTANT: the inner retry call is fire-and-forget — do NOT await it here,
        // or successive unavailability creates an infinite chain that hangs the page.
        if (!hasLocalLibraryOwner) {
            if (libraryRefreshRetryTimer) clearTimeout(libraryRefreshRetryTimer);
            return new Promise(resolve => {
                libraryRefreshRetryTimer = setTimeout(() => {
                    libraryRefreshRetryTimer = null;
                    try { refreshLibrary('owner-retry'); } catch (_) {}
                    resolve();
                }, 120);
            });
        }
        const refreshSeq = ++_libraryRefreshSequence;
        let books = [];
        try { books = await localBooksGetAll(); } catch(_) { books = []; }
        if (refreshSeq !== _libraryRefreshSequence) return;
        _loggedFirstLocalLibraryRead = true;
        _libraryInitialResolutionComplete = true;
        clearLibraryPendingBanner();
        const has = books.length > 0;
        if (!has) {
            setLibrarySurfaceState('empty', reason);
            try { renderSubscriptionSurface([]); } catch (_) {}
            return;
        }
        books.sort((a, b) => (b.createdAt||0) - (a.createdAt||0));
        const rows = books.map(b => {
            const pages = (window.rcLibraryData && typeof window.rcLibraryData.countPagesFromMarkdown === 'function')
                ? window.rcLibraryData.countPagesFromMarkdown(b.markdown || '')
                : Math.max(1, (String(b.markdown||'').match(/^\s*##\s+/gm)||[]).length || 1);
            const surface = (window.rcLibraryData && typeof window.rcLibraryData.getBookSurfaceData === 'function')
                ? window.rcLibraryData.getBookSurfaceData(`local:${String(b.id)}`, pages, { record: b })
                : { status: 'Unread', timeLabel: `${Math.max(1, Math.ceil(pages * 2.5))} min left` };
            const date = new Date(b.createdAt||Date.now()).toLocaleDateString();
            const id = ('local:' + String(b.id)).replace(/'/g,"\\'");
            const title = escHtml(b.title||'Untitled');
            return `<div onclick="openPreview('${id}','${title.replace(/'/g,"\\'")}')" class="px-6 py-4 flex items-center hover:bg-slate-50 cursor-pointer transition-colors border-b border-slate-100">
                <div class="flex-grow flex items-center gap-3"><div class="w-8 h-8 rounded flex items-center justify-center text-lg bg-accent-soft text-accent flex-shrink-0">📄</div><div><p class="font-semibold text-slate-800 text-sm">${title}</p><p class="text-xs text-slate-400">Added ${date}</p></div></div>
                <div class="w-32 hidden md:block"><span class="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-bold">${surface.status}</span></div>
                <div class="w-32 hidden md:block text-sm text-slate-500 font-medium">${surface.timeLabel}</div>
                <div class="w-8 text-slate-300">→</div></div>`;
        });
        rowsEl.innerHTML = rows.join('');
        setLibrarySurfaceState('populated', reason);
        try { renderSubscriptionSurface(books); } catch (_) {}

    }
    // Scroll affordance — called by library.js via __jublyAfterRender after render()
    window.__jublyAfterRender = function() {
        document.querySelectorAll('#pages .page').forEach(function(pageEl) {
            const textEl = pageEl.querySelector('.page-text');
            if (!textEl || textEl.parentElement.classList.contains('page-text-wrap')) return;
            const wrap = document.createElement('div'); wrap.className = 'page-text-wrap';
            textEl.parentNode.insertBefore(wrap, textEl); wrap.appendChild(textEl);
            const fade = document.createElement('div'); fade.className = 'page-text-fade'; wrap.appendChild(fade);
            function checkScroll() {
                const atEnd = textEl.scrollHeight - textEl.scrollTop - textEl.clientHeight < 8;
                wrap.classList.toggle('scrolled-to-end', atEnd || textEl.scrollHeight <= textEl.clientHeight + 4);
            }
            textEl.addEventListener('scroll', checkScroll, { passive: true });
            setTimeout(checkScroll, 150);
        });
    };

    // ── Reading session ──────────────────────────────────────────
    let _previewBookId = null;
    function openPreview(id, title) {
        _previewBookId = id;
        openModal('preview-modal');
        refreshPreviewSurface(id, title);
    }

    async function startReading() {
        closeModal('preview-modal');
        const signal = document.getElementById('session-complete');
        if (signal) signal.classList.add('hidden-section');
        showSection('reading-mode');
        if (!_previewBookId) return;
        try { if (typeof startReadingFromPreview === 'function') await startReadingFromPreview(_previewBookId); } catch (_) {}
    }

    let _goalCelebrationTimer = null;
    let _goalEditOpen = false;

    function setGoalEditMode(open) {
        _goalEditOpen = !!open;
        const editBtn = document.getElementById('profile-goal-edit-btn');
        const editForm = document.getElementById('profile-goal-edit-form');
        const input = document.getElementById('profile-goal-input');
        if (editBtn) editBtn.classList.toggle('hidden-section', _goalEditOpen);
        if (editForm) editForm.classList.toggle('hidden-section', !_goalEditOpen);
        if (_goalEditOpen && input) {
            const current = (window.rcPrefs && typeof window.rcPrefs.loadProfilePrefs === 'function') ? window.rcPrefs.loadProfilePrefs().dailyGoalMinutes : 15;
            input.value = String(current || 15);
            try { input.focus(); input.select(); } catch (_) {}
        }
    }

    function triggerGoalCelebration() {
        const banner = document.getElementById('profile-goal-celebration');
        if (!banner) return;
        if (_goalCelebrationTimer) clearTimeout(_goalCelebrationTimer);
        banner.textContent = '🎉🎊 Goal reached';
        banner.classList.remove('hidden-section');
        void banner.offsetWidth;
        banner.classList.remove('profile-goal-celebration-animate');
        banner.classList.add('profile-goal-celebration-animate');
        _goalCelebrationTimer = setTimeout(() => {
            try { banner.classList.add('hidden-section'); } catch (_) {}
            try { banner.classList.remove('profile-goal-celebration-animate'); } catch (_) {}
        }, 1600);
    }

    async function renderSubscriptionSurface(existingBooks) {
        const booksValue = document.getElementById('subscription-books-value');
        const storageValue = document.getElementById('subscription-storage-value');
        let books = Array.isArray(existingBooks) ? existingBooks : [];
        if (!books.length && typeof localBooksGetAll === 'function') {
            try { books = await localBooksGetAll(); } catch (_) { books = []; }
        }
        if (booksValue) booksValue.textContent = String(Array.isArray(books) ? books.length : 0);
        if (storageValue) {
            const totalBytes = Array.isArray(books) ? books.reduce((sum, book) => sum + Math.max(0, Number(book?.byteSize || 0)), 0) : 0;
            if (totalBytes >= 1024 * 1024) storageValue.textContent = `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`;
            else if (totalBytes >= 1024) storageValue.textContent = `${Math.max(1, Math.round(totalBytes / 1024))} KB`;
            else storageValue.textContent = totalBytes > 0 ? `${totalBytes} B` : '0 B';
        }
    }


    function renderUsageSurface() {
        const valueEl = document.getElementById('nav-usage-pill-value');
        if (!valueEl) return;
        const snapshot = (window.rcUsage && typeof window.rcUsage.getSnapshot === 'function')
            ? window.rcUsage.getSnapshot()
            : { remaining: null, allowance: null, authoritative: false };
        const remaining = snapshot?.remaining != null ? Number(snapshot.remaining) : null;
        if (Number.isFinite(remaining)) {
            valueEl.textContent = `${Math.max(0, remaining)} left today`;
        } else {
            // authoritative: false means usage truth is still settling — do not
            // show a believable number. Show neutral pending copy instead.
            valueEl.textContent = snapshot?.authoritative === false ? 'Checking…' : 'Usage';
        }
    }

    function renderProfileSurface() {
        // When signed in, require at least one confirmed snapshot (cache or live)
        // before rendering values. Until settings hydration is confirmed, local
        // pref values can contradict server truth (e.g. a local goal of 5 against
        // a server-confirmed 30 → "15/5"). A safe blank is correct here per the
        // runtime contract. rc:durable-data-hydrated fires after cache apply
        // (sub-100ms on returning users) and re-triggers this render with clean data.
        if (isAuthedUser()) {
            const hydrated = !!(window.rcSync && typeof window.rcSync.getHydrationState === 'function' && window.rcSync.getHydrationState().settings);
            if (!hydrated) return;
        }
        const metrics = (window.rcReadingMetrics && typeof window.rcReadingMetrics.getReadingProfileMetrics === 'function')
            ? window.rcReadingMetrics.getReadingProfileMetrics()
            : { dailyGoalMinutes: 15, dailyMinutes: 0, weeklyMinutes: 0, sessionsCompleted: 0, progressPct: 0, lastGoalCelebratedOn: '', todayIso: '' };
        const dailyEl = document.getElementById('profile-daily-minutes');
        const goalEl = document.getElementById('profile-goal-minutes');
        const weeklyEl = document.getElementById('profile-weekly-minutes');
        const sessionsEl = document.getElementById('profile-sessions-completed');
        const labelEl = document.getElementById('profile-goal-progress-label');
        const copyEl = document.getElementById('profile-goal-copy');
        const ringEl = document.getElementById('profile-goal-ring');
        const goalMinutes = Math.max(5, Number(metrics.dailyGoalMinutes || 15));
        const displayDailyMinutes = Math.max(0, Number(metrics.displayDailyMinutes != null ? metrics.displayDailyMinutes : Math.min(Number(metrics.dailyMinutes || 0), goalMinutes)));
        const remainingGoalMinutes = Math.max(0, Number(metrics.remainingGoalMinutes != null ? metrics.remainingGoalMinutes : Math.max(0, goalMinutes - Number(metrics.dailyMinutes || 0))));
        if (dailyEl) dailyEl.textContent = String(Math.round(displayDailyMinutes));
        if (goalEl) goalEl.textContent = String(goalMinutes);
        if (weeklyEl) weeklyEl.textContent = String(metrics.weeklyMinutes || 0);
        if (sessionsEl) sessionsEl.textContent = String(metrics.sessionsCompleted || 0);
        if (labelEl) labelEl.textContent = '';
        if (ringEl) ringEl.style.setProperty('--goal-progress', `${Math.max(0, Math.min(100, Number(metrics.progressPct || 0)))}%`);
        if (copyEl) {
            copyEl.textContent = metrics.progressPct >= 100
                ? 'Goal complete for today.'
                : `${remainingGoalMinutes} min to go today.`;
        }
        if (metrics.progressPct >= 100 && metrics.lastGoalCelebratedOn !== metrics.todayIso) {
            try {
                if (window.rcPrefs && typeof window.rcPrefs.saveProfilePrefs === 'function') {
                    window.rcPrefs.saveProfilePrefs({ lastGoalCelebratedOn: metrics.todayIso });
                }
            } catch (_) {}
            triggerGoalCelebration();
        }
    }

    async function refreshPreviewSurface(id, fallbackTitle) {
        const titleEl = document.getElementById('preview-title');
        const trioEl = document.getElementById('preview-meta-trio');
        if (titleEl) titleEl.innerText = fallbackTitle || 'Book';
        if (trioEl) trioEl.textContent = 'Loading preview…';
        try {
            if (window.rcLibraryData && typeof window.rcLibraryData.getBookPreviewSurface === 'function') {
                const surface = await window.rcLibraryData.getBookPreviewSurface(id);
                if (titleEl) titleEl.innerText = surface.title || fallbackTitle || 'Book';
                if (trioEl) trioEl.textContent = surface.previewTrio || '0 Pages • 0 min read • Unread';
                return;
            }
        } catch (_) {}
        if (trioEl) trioEl.textContent = '0 Pages • 0 min read • Unread';
    }

    // Empty state drag/drop
    function emptyStateDrop(e) {
        e.preventDefault();
        const zone = document.getElementById('empty-drop-zone');
        if (zone) { zone.style.borderColor = 'transparent'; zone.style.background = ''; }
        const files = e.dataTransfer && e.dataTransfer.files;
        if (!files || !files.length) return;
        // Use the one authoritative importer-entry path so the capacity check,
        // modal open, state reset, and file staging happen in a single async
        // sequence — eliminates the race where showModal()'s reset cleared a
        // file staged immediately before via click+dispatch.
        if (typeof window.openImporterWithFile === 'function') {
            window.openImporterWithFile(files[0]);
        }
    }

    // Session complete signal — presents current runtime page truth only.
    function showSessionComplete() {
        const signal = document.getElementById('session-complete');
        if (!signal || !hasActiveReadingCards()) return;
        const pageCount = (typeof pages !== 'undefined' && Array.isArray(pages)) ? pages.length : 0;
        const currentTarget = window.__rcReadingTarget || {};
        const isTextImport = /^local:text-/i.test(String(currentTarget.bookId || ''));
        const mins = (window.rcReadingMetrics && typeof window.rcReadingMetrics.estimateReadMinutesFromPages === 'function')
            ? window.rcReadingMetrics.estimateReadMinutesFromPages(pageCount, { textImport: isTextImport })
            : Math.max(1, isTextImport ? pageCount : Math.ceil(pageCount * 2.5));
        document.getElementById('stat-pages').textContent   = pageCount;
        document.getElementById('stat-minutes').textContent = mins;
        signal.classList.remove('hidden-section');
        signal.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Page progress bar — uses real pages[] from app state
    function updateProgressBar() {
        const prog  = document.getElementById('shell-page-progress');
        if (!prog) return;
        if (!hasActiveReadingCards()) { prog.textContent = '—'; return; }
        const total = (typeof pages !== 'undefined' && Array.isArray(pages)) ? pages.length : 0;
        let playback = { active: false, paused: false, key: null };
        try { if (typeof getPlaybackStatus === 'function') playback = getPlaybackStatus() || playback; } catch (_) {}
        const cur   = (playback.active && !playback.paused)
                        ? Math.max(0, getActivePlaybackPageIndex(playback))
                        : Math.max(0, getVisibleReadingPageIndex());
        const currentLabel = (typeof getDisplayPageNumber === 'function') ? getDisplayPageNumber(cur) : (cur + 1);
        const totalLabel = (typeof getDisplayPageTotal === 'function') ? getDisplayPageTotal(total) : total;
        prog.textContent = total > 0 ? `Page ${currentLabel} / ${totalLabel}` : '—';
    }

    document.addEventListener('DOMContentLoaded', () => {
        _bootProbe.mark('dcl-handler-entry', {
            rcPolicyPresent:     !!window.rcPolicy,
            rcThemePresent:      !!window.rcTheme,
            rcAppearancePresent: !!window.rcAppearance,
            rcEntitlementsPresent: !!window.rcEntitlements
        });
        const goalEditBtn = document.getElementById('profile-goal-edit-btn');
        const goalEditForm = document.getElementById('profile-goal-edit-form');
        const goalCancelBtn = document.getElementById('profile-goal-cancel-btn');
        const goalInput = document.getElementById('profile-goal-input');
        goalEditBtn?.addEventListener('click', () => { setGoalEditMode(true); });
        goalCancelBtn?.addEventListener('click', () => { setGoalEditMode(false); });
        goalEditForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            const next = Math.max(5, Math.min(300, Math.round(Number(goalInput && goalInput.value || 0) || 0)));
            if (!Number.isFinite(next) || next <= 0) return;
            // saveProfilePrefs fires rc:prefs-changed, which queues rcSync.syncSettings
            // via _handlePrefsChanged. Shell does not call syncSettings directly to
            // avoid a competing parallel durable write for the same mutation.
            try { if (window.rcPrefs && typeof window.rcPrefs.saveProfilePrefs === 'function') window.rcPrefs.saveProfilePrefs({ dailyGoalMinutes: next }); } catch (_) {}
            setGoalEditMode(false);
            renderProfileSurface();
        });
        const nameTrigger = document.getElementById('profile-name-edit-trigger');
        const nameForm = document.getElementById('profile-name-edit-form');
        const nameInput = document.getElementById('profile-name-input');
        const nameCancel = document.getElementById('profile-name-cancel-btn');
        const passwordToggle = document.getElementById('profile-password-toggle-btn');
        const passwordForm = document.getElementById('profile-password-form');
        const passwordInput = document.getElementById('profile-password-input');
        const passwordCancel = document.getElementById('profile-password-cancel-btn');
        const settingsStatus = document.getElementById('profile-settings-status');

        function setSettingsStatus(message, kind) {
            if (!settingsStatus) return;
            settingsStatus.textContent = message || '';
            settingsStatus.classList.toggle('hidden-section', !message);
            settingsStatus.classList.remove('profile-settings-status-error', 'profile-settings-status-success');
            if (message) settingsStatus.classList.add(kind === 'error' ? 'profile-settings-status-error' : 'profile-settings-status-success');
        }
        function setNameEdit(open) {
            if (nameForm) nameForm.classList.toggle('hidden-section', !open);
            if (nameTrigger) nameTrigger.classList.toggle('hidden-section', !!open);
            if (open && nameInput) {
                nameInput.value = deriveDisplayName(getAuthUser());
                setTimeout(() => { try { nameInput.focus(); nameInput.select(); } catch (_) {} }, 0);
            }
        }
        function setPasswordEdit(open) {
            if (passwordForm) passwordForm.classList.toggle('hidden-section', !open);
            if (passwordToggle) passwordToggle.classList.toggle('hidden-section', !!open);
            if (!open && passwordInput) passwordInput.value = '';
            if (open && passwordInput) setTimeout(() => { try { passwordInput.focus(); } catch (_) {} }, 0);
        }
        nameTrigger?.addEventListener('click', () => { setSettingsStatus('', 'success'); setNameEdit(true); });
        nameCancel?.addEventListener('click', () => { setNameEdit(false); });
        nameForm?.addEventListener('submit', async (e) => {
            e.preventDefault();
            setSettingsStatus('', 'success');
            const nextName = String(nameInput?.value || '').trim();
            if (!nextName) { setSettingsStatus('Username is required.', 'error'); return; }
            const saveBtn = document.getElementById('profile-name-save-btn');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
            const result = await (window.rcAuth && typeof window.rcAuth.updateDisplayName === 'function'
                ? window.rcAuth.updateDisplayName(nextName)
                : Promise.resolve({ error: { message: 'Profile editing is not available.' } }));
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
            if (result?.error) { setSettingsStatus(result.error.message || 'Unable to update username.', 'error'); return; }
            setNameEdit(false);
            syncShellAuthPresentation();
            setSettingsStatus('Username updated.', 'success');
        });
        passwordToggle?.addEventListener('click', () => { setSettingsStatus('', 'success'); setPasswordEdit(true); });
        passwordCancel?.addEventListener('click', () => { setPasswordEdit(false); });
        passwordForm?.addEventListener('submit', async (e) => {
            e.preventDefault();
            setSettingsStatus('', 'success');
            const nextPassword = String(passwordInput?.value || '');
            const saveBtn = document.getElementById('profile-password-save-btn');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
            const result = await (window.rcAuth && typeof window.rcAuth.changePassword === 'function'
                ? window.rcAuth.changePassword(nextPassword)
                : Promise.resolve({ error: { message: 'Password changes are not available.' } }));
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Password'; }
            if (result?.error) { setSettingsStatus(result.error.message || 'Unable to change password.', 'error'); return; }
            setPasswordEdit(false);
            setSettingsStatus('Password updated.', 'success');
        });
        document.getElementById('profile-help-chat-btn')?.addEventListener('click', async (e) => {
            e.preventDefault();
            const btn = e.currentTarget;
            setInlineBusy(btn, 'Opening…');
            try {
                if (window.rcHelp && typeof window.rcHelp.openChat === 'function') {
                    const ok = await window.rcHelp.openChat();
                    if (!ok) {
                        try { window.rcInteraction && window.rcInteraction.error('help:chat', 'Support chat couldn\'t be opened right now.'); } catch (_) {}
                    }
                }
            } catch (_) {
                try { window.rcInteraction && window.rcInteraction.error('help:chat', 'Support chat couldn\'t be opened right now.'); } catch (_) {}
            } finally {
                setInlineBusy(btn, null, null, false);
            }
        });
        document.getElementById('profile-help-feedback-link')?.addEventListener('click', async (e) => {
            e.preventDefault();
            const btn = e.currentTarget;
            setInlineBusy(btn, 'Opening…');
            try {
                if (window.rcHelp && typeof window.rcHelp.openFeedback === 'function') {
                    const ok = await window.rcHelp.openFeedback();
                    if (!ok) {
                        try { window.rcInteraction && window.rcInteraction.error('help:feedback', 'Feedback couldn\'t be opened right now.'); } catch (_) {}
                    }
                }
            } catch (_) {
                try { window.rcInteraction && window.rcInteraction.error('help:feedback', 'Feedback couldn\'t be opened right now.'); } catch (_) {}
            } finally {
                setInlineBusy(btn, null, null, false);
            }
        });
        const tierSel = document.getElementById('tierSelect');
        if (tierSel) {
            tierSel.addEventListener('change', () => {
                updateTierPill();
                syncTierButtonState();
                updateExplorerSwatchState();
                try { if (window.rcTheme && typeof window.rcTheme.enforceAccess === 'function') window.rcTheme.enforceAccess(); } catch (_) {}
                try { syncExplorerMusicSource(); } catch (_) {}
                refreshExplorerPanel();
            });
        }
        _bootProbe.mark('policy-listener-attached', {
            rcPolicyPresent:     !!window.rcPolicy,
            rcThemePresent:      !!window.rcTheme,
            rcAppearancePresent: !!window.rcAppearance,
            rcEntitlementsPresent: !!window.rcEntitlements
        });
        document.addEventListener('rc:runtime-policy-changed', (e) => {
            _bootProbe.mark('policy-event-received', {
                rcPolicyPresent:     !!window.rcPolicy,
                rcThemePresent:      !!window.rcTheme,
                rcAppearancePresent: !!window.rcAppearance,
                rcEntitlementsPresent: !!window.rcEntitlements,
                resolved:            !!(e && e.detail && e.detail.resolved),
                reason:              (e && e.detail && e.detail.reason) || null
            });
            updateTierPill();
            syncTierButtonState();
            updateExplorerSwatchState();
            try { syncExplorerMusicSource(); } catch (_) {}
            refreshExplorerPanel();
        });
        document.addEventListener('rc:prefs-changed', () => { try { renderProfileSurface(); } catch (_) {} try { renderLibrarySubtitle(isAuthedUser()); } catch (_) {} });
        document.addEventListener('rc:durable-data-hydrated', (e) => { const section = getCurrentVisibleSection(); const kind = e && e.detail ? String(e.detail.kind || 'sync') : 'sync'; try { renderLibrarySubtitle(isAuthedUser()); } catch (_) {} if (section === 'profile-page') { try { renderProfileSurface(); } catch (_) {} try { renderSubscriptionSurface(); } catch (_) {} } if (section === 'dashboard') { try { refreshLibrary(`durable-hydrated:${kind}`); } catch (_) {} } });
        window.addEventListener('rc:local-library-changed', () => { try { renderProfileSurface(); } catch (_) {} try { renderSubscriptionSurface(); } catch (_) {} try { renderLibrarySubtitle(isAuthedUser()); } catch (_) {} if (getCurrentVisibleSection() === 'dashboard') { try { refreshLibrary('local-library-changed'); } catch (_) {} } });
        window.addEventListener('rc:deleted-library-changed', () => { try { renderProfileSurface(); } catch (_) {} try { renderSubscriptionSurface(); } catch (_) {} });
        window.addEventListener('rc:usage-changed', () => { try { renderUsageSurface(); } catch (_) {} });
        try { switchReadingSettingsTab('general'); } catch (_) {}
        try { syncTierButtonState(); } catch (_) {}

        const importCloseBtn = document.getElementById('importBookClose');
        if (importCloseBtn) {
            importCloseBtn.addEventListener('click', () => setTimeout(() => { try { if (typeof resetImporterState === 'function') resetImporterState({ keepModalOpen: false }); } catch(_) {} }, 0));
        }
        try { renderProfileSurface(); } catch (_) {}
        try { renderSubscriptionSurface(); } catch (_) {}
        try { renderUsageSurface(); } catch (_) {}
        try { renderLibrarySubtitle(isAuthedUser()); } catch (_) {}

        const topSettingsBtn = document.getElementById('openReadingSettings');
        if (topSettingsBtn) {
            topSettingsBtn.addEventListener('click', () => { try { refreshExplorerPanel(); } catch (_) {} });
        }
        const musicPickerModal = document.getElementById('musicPickerModal');
        if (musicPickerModal) {
            musicPickerModal.addEventListener('click', (ev) => { if (ev.target === musicPickerModal) closeMusicPicker(); });
        }

        // Keep progress bar in sync as the user scrolls or focuses pages.
        const pagesEl = document.getElementById('pages');
        if (pagesEl) {
            pagesEl.addEventListener('scroll',  () => updateProgressBar());
            pagesEl.addEventListener('focusin', () => updateProgressBar());
        }

        // Countdown ownership remains on the page-level Read button in tts.js.
        // The shell next/skip button must not mirror countdown state.

        // F3: Page advance pulse + end-of-book detection via MutationObserver.
        let _sessionCompletePending = false;
        const _pagesContainer = document.getElementById('pages');
        if (_pagesContainer) {
            new MutationObserver(() => {
                // Pulse progress indicator on any page advance.
                const prog = document.getElementById('shell-page-progress');
                if (prog && !prog.classList.contains('page-advance-pulse')) {
                    prog.classList.add('page-advance-pulse');
                    prog.addEventListener('animationend', () => prog.classList.remove('page-advance-pulse'), { once: true });
                }
                // Detect last page reached: active page is the last one.
                try {
                    if (!hasActiveReadingCards()) return;
                    const total = (typeof pages !== 'undefined' && Array.isArray(pages)) ? pages.length : 0;
                    if (total < 1) return;
                    const activeEl = _pagesContainer.querySelector('.page-active');
                    if (!activeEl) return;
                    const allPages = Array.from(_pagesContainer.querySelectorAll('.page'));
                    const activeIdx = allPages.indexOf(activeEl);
                    if (activeIdx === total - 1 && !_sessionCompletePending) {
                        _sessionCompletePending = true;
                        // 500ms debounce: wait to confirm no further page-active transition follows.
                        setTimeout(() => {
                            _sessionCompletePending = false;
                            const stillActive = _pagesContainer.querySelector('.page-active');
                            const stillLast   = stillActive && Array.from(_pagesContainer.querySelectorAll('.page')).indexOf(stillActive) === total - 1;
                            const cd = (typeof getCountdownStatus === 'function') ? getCountdownStatus() : { active: false }; const noCountdown = !cd.active;
                            if (stillLast && noCountdown) showSessionComplete();
                        }, 500);
                    }
                } catch(_) {}
            }, { attributes: true, subtree: true, attributeFilter: ['class'] });
        }

        // Exit reading: stop TTS, cancel autoplay, clear countdown poll before navigating away.
        // The button's inline onclick still fires (showSection) — this just cleans up first.
        const exitBtn = document.querySelector('.reading-top-exit');
        if (exitBtn) {
            exitBtn.addEventListener('click', () => { try { syncShellPlaybackControls(); } catch(_) {} });
        }

        setInterval(() => {
            try { syncShellPlaybackControls(); } catch(_) {}
            try { updateProgressBar(); } catch(_) {}
        }, 350);
    });

    // =========================================================================
    // SLICE 7 MODULE BOUNDARY 5/6 — Shell Report & Diagnostics
    // Logical boundary declaration only — code not physically separated yet.
    // Primary content: snapshotShellControl(), getVisiblePublicBoundaryFields(),
    //   isElementVisible(), getActiveModalReport(), getSignedInInteractionReport(),
    //   and any exported shell report surface (window.rcShell).
    // These are dev/reporting tools only. They must not become product owners
    //   or behavior justification. See workflow rule: diagnostics report owner
    //   truth only and are removable unless accepted as durable diagnostics.
    // =========================================================================

    function snapshotShellControl(selector) {
        const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!el) return null;
        let rect = null;
        try {
            const r = el.getBoundingClientRect();
            rect = { width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) };
        } catch (_) {}
        return {
            text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
            disabled: !!el.disabled,
            ariaDisabled: el.getAttribute('aria-disabled'),
            title: el.getAttribute('title') || '',
            className: el.className || '',
            rect
        };
    }

    function getVisiblePublicBoundaryFields() {
        const tierPill = document.getElementById('reading-tier-pill');
        const explorerBtn = document.getElementById('explorer-swatch-btn');
        const explorerPanel = document.getElementById('rs-explorer-panel');
        let tts = null;
        try { tts = typeof window.getTtsDiagnosticsSnapshot === 'function' ? window.getTtsDiagnosticsSnapshot() : null; } catch (_) { tts = null; }
        const tierText = String(tierPill ? tierPill.textContent || '' : '').trim().toLowerCase();
        const requestedPath = String(tts?.routing?.requestedPath || tts?.last?.playRequest?.path || '').trim().toLowerCase();
        const resolvedPath = String(tts?.last?.resolvedPath || '').trim().toLowerCase();
        return {
            publicRuntime: readPublicRuntimeBoundaryReport(),
            visibleProBadgePresent: /^(pro|premium)$/.test(tierText),
            visibleExplorerControlsPresent: !!(
                (explorerBtn && !explorerBtn.classList.contains('explorer-locked')) ||
                (explorerPanel && explorerPanel.style.display !== 'none') ||
                document.body.classList.contains('theme-explorer')
            ),
            visibleCloudRouteAttempted: requestedPath.indexOf('cloud') !== -1 || resolvedPath.indexOf('cloud') !== -1,
        };
    }


    function isElementVisible(el) {
        if (!el) return false;
        try {
            const style = window.getComputedStyle(el);
            if (!style || style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        } catch (_) { return false; }
    }

    function getTopmostElementAtCenter(selector) {
        const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!el || typeof document.elementFromPoint !== 'function') return null;
        try {
            const r = el.getBoundingClientRect();
            const x = Math.round(r.left + (r.width / 2));
            const y = Math.round(r.top + (r.height / 2));
            const top = document.elementFromPoint(x, y);
            if (!top) return null;
            return {
                tag: String(top.tagName || '').toLowerCase(),
                id: top.id || '',
                className: String(top.className || ''),
                text: String(top.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
                matchesTarget: top === el || (typeof el.contains === 'function' && el.contains(top))
            };
        } catch (_) { return null; }
    }

    function getActiveModalReport() {
        const modals = Array.from(document.querySelectorAll('.modal-overlay'));
        const open = modals.find((el) => el && !el.classList.contains('hidden-section') && el.style.display !== 'none');
        return {
            open: !!open,
            id: open ? (open.id || '') : null,
            // HELD — opener is inferred, not truthful provenance.
            // billing.js entry points (openPricingForSignup, openPricingForAccount,
            // showPricingForGatedAction) do not persist a shared opener context that
            // shell can read back. Reporting here is inference from billing side effects
            // and is not a valid provenance substitute.
            //
            // Retirement condition: billing.js must be extended (in a Central-authorized
            // Station 2 follow-up slice scoping js/billing.js) to write a single readable
            // pricing-open context — opener, allowed surface, message/source, timestamp —
            // from the three legitimate entry points only. Shell reads that context here
            // instead of inferring. Acceptance requires runtime test with probes.
            opener: open && open.id === 'pricing-modal' ? 'pricing' : (open ? 'unknown' : 'none'),
            allowedSurface: open ? getCurrentVisibleSection() : null
        };
    }

    function getSignedInInteractionReport() {
        const logoutBtn = document.querySelector('[onclick="shellSignOut()"]');
        const profileTrigger = document.getElementById('nav-profile-trigger');
        const dashboard = document.getElementById('dashboard');
        const dashboardVisible = !!(dashboard && !dashboard.classList.contains('hidden-section'));
        const dashboardControls = dashboardVisible
            ? Array.from(dashboard.querySelectorAll('button, a, [role="button"]')).filter(isElementVisible)
            : [];
        const readiness = readSignedInAccountControlReadiness('report');
        return Object.assign({}, readiness, {
            lastReadiness: _lastSignedInAccountReadiness,
            logoutEnabled: !!(logoutBtn && isControlEnabled(logoutBtn)),
            logoutVisibleAndEnabled: !!(logoutBtn && isElementVisible(logoutBtn) && isControlEnabled(logoutBtn)),
            profileEnabled: !!(profileTrigger && isElementVisible(profileTrigger) && isControlEnabled(profileTrigger)),
            dashboardCtasEnabled: dashboardControls.some(isControlEnabled),
            topmostElementAtLogoutCenter: getTopmostElementAtCenter(logoutBtn)
        });
    }


    function getLibrarySurfaceReport() {
        const dashboard = document.getElementById('dashboard');
        const rows = document.getElementById('library-rows');
        const state = dashboard ? (dashboard.getAttribute('data-library-state') || null) : null;
        const ownerReport = readDashboardLibraryOwnerReport('report');
        return {
            ownerReady: typeof localBooksGetAll === 'function',
            state: state || (_libraryInitialResolutionComplete ? 'ready-unknown' : 'pending'),
            initialResolutionComplete: !!_libraryInitialResolutionComplete,
            count: rows ? rows.children.length : 0,
            source: ownerReport.source,
            dashboardRelease: _lastDashboardRelease,
            revealTransaction: _lastDashboardLibraryRevealTransaction,
            pendingMinVisibleMs: DASHBOARD_LIBRARY_PENDING_MIN_VISIBLE_MS,
            pendingVisible: !!_dashboardLibraryPendingVisibleAt,
            deferredFinalState: _dashboardLibraryDeferredFinalState ? _dashboardLibraryDeferredFinalState.state : null
        };
    }

    function getPricingSurfaceReport(modalReport, readingVisible) {
        let pendingPlan = null;
        let pendingPaidIntent = false;
        try { pendingPlan = window.rcBilling && typeof window.rcBilling.readPendingPlan === 'function' ? window.rcBilling.readPendingPlan() : null; } catch (_) { pendingPlan = null; }
        try { pendingPaidIntent = !!(window.rcBilling && typeof window.rcBilling.hasPendingPaidIntent === 'function' && window.rcBilling.hasPendingPaidIntent()); } catch (_) {}
        const modal = document.getElementById('pricing-modal');
        const modalOpen = !!(modalReport && modalReport.open && modalReport.id === 'pricing-modal');
        return {
            modalOpen,
            opener: modalOpen ? (pendingPaidIntent ? 'pending-paid-intent' : 'unknown') : 'none',
            openerAllowed: modalOpen ? !readingVisible : true,
            pricingOverReading: modalOpen && !!readingVisible,
            planUiSettledAtOpen: modalOpen ? !(modal && modal.classList.contains('pricing-modal-settling')) : null,
            pendingPlan: pendingPlan || null
        };
    }

    function getShellSurfaceReport() {
        const visibleSection = getCurrentVisibleSection();
        const readingMode = document.getElementById('reading-mode');
        const readingVisible = !!(readingMode && !readingMode.classList.contains('hidden-section'));
        const modal = getActiveModalReport();
        const user = getAuthUser();
        return {
            shell: {
                requestedSurface: _lastShellRelease.requestedSurface,
                releasedSurface: _lastShellRelease.releasedSurface || visibleSection,
                releaseReason: _lastShellRelease.releaseReason,
                blockedBy: _lastShellRelease.blockedBy,
                visibleSection,
                bootPending: document.body.classList.contains('boot-pending'),
                authHydrating: document.body.classList.contains('auth-hydrating')
            },
            auth: {
                known: !!(window.rcAuth && typeof window.rcAuth.isReady === 'function' && window.rcAuth.isReady()),
                signedIn: !!isAuthedUser(),
                userIdPresent: !!(user && user.id),
                source: 'rcAuth'
            },
            publicRuntime: readPublicRuntimeBoundaryReport(),
            signedInInteraction: getSignedInInteractionReport(),
            dashboardRelease: _lastDashboardRelease,
            library: getLibrarySurfaceReport(),
            modal,
            pricing: getPricingSurfaceReport(modal, readingVisible),
            publicBoundary: getVisiblePublicBoundaryFields()
        };
    }

    window.getShellSurfaceReport = getShellSurfaceReport;

    window.getShellDiagnosticsSnapshot = function getShellDiagnosticsSnapshot() {
        const topBar = document.getElementById('reading-top-bar');
        const bottomBar = document.querySelector('.reading-bottom-bar');
        const readingMode = document.getElementById('reading-mode');
        const pageBtns = Array.from(document.querySelectorAll('.tts-btn[data-tts="page"]'));
        const topCluster = document.querySelector('#reading-top-bar .reading-top-left');
        const topActions = document.querySelector('#reading-top-bar .reading-top-actions');
        const bottomCluster = document.querySelector('.reading-bottom-bar .reading-bottom-left');
        const bottomActions = document.querySelector('.reading-bottom-bar .reading-bottom-actions');
        const progress = document.getElementById('shell-page-progress');
        return {
            readingVisible: !!(readingMode && !readingMode.classList.contains('hidden-section')),
            publicBoundary: getVisiblePublicBoundaryFields(),
            surfaceReport: getShellSurfaceReport(),
            settingsOpen: !!(typeof window.isReadingSettingsModalOpen === 'function' && window.isReadingSettingsModalOpen()),
            progressLabel: progress ? progress.textContent : null,
            playback: (typeof window.getPlaybackStatus === 'function') ? window.getPlaybackStatus() : null,
            countdown: (typeof window.getCountdownStatus === 'function') ? window.getCountdownStatus() : null,
            support: (typeof window.getTtsSupportStatus === 'function') ? window.getTtsSupportStatus() : null,
            runtime: (typeof window.getRuntimeUiState === 'function') ? window.getRuntimeUiState() : null,
            tts: (typeof window.getTtsDiagnosticsSnapshot === 'function') ? window.getTtsDiagnosticsSnapshot() : null,
            controls: {
                settings: snapshotShellControl('#openReadingSettings'),
                exit: snapshotShellControl('.reading-top-exit'),
                previous: snapshotShellControl('#shell-prev-btn'),
                play: snapshotShellControl('#shell-play-btn'),
                next: snapshotShellControl('#shell-next-btn')
            },
            pageReadButtons: {
                count: pageBtns.length,
                disabledCount: pageBtns.filter((btn) => !!btn.disabled).length,
                activeCount: pageBtns.filter((btn) => btn.classList.contains('tts-active')).length,
                sample: pageBtns.slice(0, 3).map((btn) => snapshotShellControl(btn))
            },
            layout: {
                topBar: topBar ? { clientWidth: topBar.clientWidth, scrollWidth: topBar.scrollWidth } : null,
                topCluster: topCluster ? { clientWidth: topCluster.clientWidth, scrollWidth: topCluster.scrollWidth, offsetLeft: topCluster.offsetLeft } : null,
                topActions: topActions ? { clientWidth: topActions.clientWidth, offsetLeft: topActions.offsetLeft } : null,
                bottomBar: bottomBar ? { clientWidth: bottomBar.clientWidth, scrollWidth: bottomBar.scrollWidth } : null,
                bottomCluster: bottomCluster ? { clientWidth: bottomCluster.clientWidth, scrollWidth: bottomCluster.scrollWidth, offsetLeft: bottomCluster.offsetLeft } : null,
                bottomActions: bottomActions ? { clientWidth: bottomActions.clientWidth, offsetLeft: bottomActions.offsetLeft } : null
            }
        };
    };
