// ============================================================
    // jubly — Shell + App bridge
    // ============================================================
    //
    // PERMANENT (shell navigation and app wiring):
    //   showSection(), initFocusMode(), switchTab(), openModal(),
    //   closeModal(), setTheme(), handleExplorerSwatch(),
    //   setTier(), updateTierPill(), handlePausePlay(),
    //   handleAutoplayToggle(), updateProgressBar(),
    //   showSessionComplete(), renderDashboard(), startReading()
    //
    // SCAFFOLD (remove on real auth wiring):
    //   login() — simulates auth; replace with Supabase auth flow
    // ============================================================

    // ── Section routing ──────────────────────────────────────────
    const ALL_SECTIONS     = ['landing-page', 'login-page', 'dashboard', 'profile-page', 'reading-mode'];
    const PUBLIC_SAMPLE_BOOK_ID = 'BOOK_ReadingTraining';
    const SIDEBAR_SECTIONS = ['dashboard', 'profile-page'];
        let _currentSection = 'landing-page';
    let _shellAuthBootstrapped = false;


    let SHELL_DEBUG = {
        seq: 0,
        lastPlaybackSync: null,
        lastControlAction: null,
        lastSkipAction: null,
        lastProgressSnapshot: null
    };
    function shellDebugRemember(slot, data) {
        const entry = Object.assign({ seq: ++SHELL_DEBUG.seq, at: new Date().toISOString() }, data || {});
        SHELL_DEBUG[slot] = entry;
        try { if (typeof updateDiagnostics === 'function') updateDiagnostics(); } catch (_) {}
        return entry;
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

    function resolveSectionForAuth(id) {
        const normalized = normalizeSection(id);
        if (isAuthedUser() && (normalized === 'landing-page' || normalized === 'login-page')) return 'dashboard';
        if (!isAuthedUser() && normalized === 'profile-page') return 'landing-page';
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
        subtitle.style.display = '';
        if (!authed) {
            subtitle.innerHTML = 'Create an account to enter your library and keep your settings, billing, and progress in one place.';
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
        if (libraryToolbar) libraryToolbar.classList.toggle('hidden-section', !authed);
        if (librarySample) librarySample.classList.add('hidden-section');
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
    }

    function showSection(id, options = {}) {
        const targetId = resolveSectionForAuth(id);
        const readingModeEl = document.getElementById('reading-mode');
        const wasReading = readingModeEl && !readingModeEl.classList.contains('hidden-section');

        ALL_SECTIONS.forEach((s) => {
            const el = document.getElementById(s);
            if (el) el.classList.add('hidden-section');
        });
        const target = document.getElementById(targetId);
        if (target) target.classList.remove('hidden-section');
        _currentSection = targetId;

        const footer = document.getElementById('landing-footer');
        if (footer) footer.classList.toggle('hidden-section', targetId !== 'landing-page');

        const mainNav = document.querySelector('nav');
        if (mainNav) mainNav.style.display = targetId === 'reading-mode' ? 'none' : '';
        if (wasReading && targetId !== 'reading-mode') {
            try {
                let exitResult = null;
                if (typeof exitReadingSession === 'function') exitResult = exitReadingSession();
                else cleanupReadingTransientState();
                shellDebugRemember('lastControlAction', { type: 'exit-reading', exitResult });
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

        syncShellAuthPresentation(targetId);
        let _sectionRefreshPromise = null;
        if (targetId === 'dashboard') _sectionRefreshPromise = refreshLibrary();
        if (targetId === 'profile-page') { try { renderProfileSurface(); } catch (_) {} try { renderSubscriptionSurface(); } catch (_) {} }
        try { if (typeof window.syncDiagnosticsVisibility === 'function') window.syncDiagnosticsVisibility(); } catch (_) {}
        if (options.historyMode !== 'none') syncHistoryForSection(targetId, options.historyMode === 'replace' ? 'replace' : 'push');

        window.scrollTo(0, 0);
        // Return the async library refresh promise so callers that need to wait
        // (e.g. DOMContentLoaded before removing auth-hydrating) can await it.
        return _sectionRefreshPromise || Promise.resolve();
    }

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





    // ── Modals ───────────────────────────────────────────────────
    function openModal(id)  { const el = document.getElementById(id); if (!el) return; el.classList.remove('hidden-section'); if (el.classList.contains('modal-overlay')) el.style.display = 'flex'; if (id === 'pricing-modal' && window.rcBilling && typeof window.rcBilling.renderPricingUi === 'function') window.rcBilling.renderPricingUi().catch(() => {}); }
    function closeModal(id) { const el = document.getElementById(id); if (!el) return; el.classList.add('hidden-section'); if (el.classList.contains('modal-overlay')) el.style.display = 'none'; }

    function login() {
        if (window.rcBilling && typeof window.rcBilling.clearPendingPlan === 'function') window.rcBilling.clearPendingPlan();
        closeModal('pricing-modal');
        closeModal('ownership-modal');
        showSection('dashboard');
        try { refreshLibrary(); } catch(_) {}
    }

    function continueWithFree() {
        if (window.rcBilling && typeof window.rcBilling.continueWithFree === 'function') {
            window.rcBilling.continueWithFree();
            return;
        }
        login();
    }

    function showSigninPane() {
        closeModal('pricing-modal');
        closeModal('ownership-modal');
        _authMode = 'signin';
        _signupStep = 1;
        toggleAuthMode(true);
        showSection('login-page');
    }

    function returnToLanding() {
        if (window.rcBilling && typeof window.rcBilling.clearPendingPlan === 'function') window.rcBilling.clearPendingPlan();
        closeModal('pricing-modal');
        closeModal('ownership-modal');
        showSection('landing-page');
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
        returnToLanding();
    }

    function showSignupPane(forceDirect = false) {
        closeModal('ownership-modal');
        closeModal('pricing-modal');
        _authMode = 'signup';
        _signupStep = 1;
        toggleAuthMode(true);
        showSection('login-page');
    }

    function openSampleBookPreview() {
        try { openPreview(PUBLIC_SAMPLE_BOOK_ID, 'Reading Training'); } catch (_) {}
    }

    function promptOwnershipAction(kind) {
        if (isAuthedUser()) return false;
        const copy = document.getElementById('ownership-copy');
        if (copy) {
            copy.textContent = kind === 'manage'
                ? 'Managing your personal library belongs to your signed-in account. You can still explore the sample book without creating one.'
                : 'Importing books belongs to your signed-in account. You can still explore the sample book without creating one.';
        }
        openModal('ownership-modal');
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
                if (submitBtn) submitBtn.textContent = 'Submit';
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
                const { error } = await window.rcAuth.signUp(email, password, username);
                if (error) {
                    _authShowError(error.message || 'Account creation failed. Please try again.');
                } else {
                    const pendingPlan = window.rcBilling && typeof window.rcBilling.readPendingPlan === 'function' ? String(window.rcBilling.readPendingPlan() || '').trim().toLowerCase() : '';
                    _authShowSuccess(pendingPlan && pendingPlan !== 'free' ? `Account created. Check your email, then sign in to continue with ${pendingPlan === 'premium' ? 'Premium' : 'Pro'} checkout.` : 'Account created. Check your email, then sign in.');
                }
            } else {
                const { error } = await window.rcAuth.signIn(email, password);
                if (error) {
                    _authShowError(error.message || 'Sign-in failed. Check your email and password.');
                }
            }
        } catch (_) {
            _authShowError('Unexpected error. Please try again.');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = _authMode === 'signup' ? (_signupStep === 1 ? 'Submit' : 'Create Account') : 'Sign In';
            }
        }
    }

    async function shellSignOut() {
        if (window.rcAuth && typeof window.rcAuth.signOut === 'function') {
            await window.rcAuth.signOut();
        }
    }

    function _handleAuthChanged(e) {
        const { signedIn, source } = e.detail || {};
        const current = getCurrentVisibleSection();

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
                showSection('dashboard', { historyMode: 'replace' });
                try { refreshLibrary(); } catch(_) {}
                return;
            }
            syncShellAuthPresentation(current);
            if (source === 'SIGNED_IN') {
                try { refreshLibrary(); } catch(_) {}
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
        try { document.body.classList.add('auth-hydrating'); } catch (_) {}
        try {
            if (window.rcAuth && typeof window.rcAuth.init === 'function') {
                await window.rcAuth.init();
            }
        } catch (_) {}

        const requestedSection = readSectionFromLocation();
        const settledSection = resolveSectionForAuth(requestedSection || 'landing-page');
        _shellAuthBootstrapped = true;
        // Await the section's async work (e.g. refreshLibrary on dashboard) before
        // removing auth-hydrating, so the correct state is rendered before the
        // section becomes visible — preventing flash of intermediate states.
        // Race against a hard 500ms cap: auth-hydrating must never permanently
        // block the page regardless of what happens in library init.
        try {
            await Promise.race([
                showSection(settledSection, { historyMode: 'replace' }),
                new Promise(resolve => setTimeout(resolve, 500))
            ]);
        } catch (_) {}
        try { document.body.classList.remove('auth-hydrating'); } catch (_) {}
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

    // ── Tier — drives #tierSelect so ui.js applyTierAccess() fires ──
    function canSimulateTierSelection() {
        return !!(window.rcPolicy && typeof window.rcPolicy.canSimulateTier === 'function' && window.rcPolicy.canSimulateTier());
    }

    function syncTierButtonState() {
        const current = (window.rcEntitlements && typeof window.rcEntitlements.getTier === 'function')
            ? window.rcEntitlements.getTier()
            : ((typeof appTier !== 'undefined' && appTier) ? appTier : 'free');
        const map = { free: 'Basic', paid: 'Pro', premium: 'Premium' };
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
        const map = { 'Basic': 'free', 'Pro': 'paid', 'Premium': 'premium' };
        const value = map[btn.textContent.trim()] || 'free';
        const sel = document.getElementById('tierSelect');
        if (sel && sel.value !== value) { sel.value = value; sel.dispatchEvent(new Event('change')); }
        const pill = document.getElementById('reading-tier-pill');
        if (pill) pill.textContent = btn.textContent.trim();
        updateExplorerSwatchState();
        try { if (window.rcTheme && typeof window.rcTheme.enforceAccess === 'function') window.rcTheme.enforceAccess(); } catch (_) {}
        try { syncExplorerMusicSource(); } catch (_) {}
    }

    function updateTierPill() {
        const sel  = document.getElementById('tierSelect');
        const pill = document.getElementById('reading-tier-pill');
        if (!sel || !pill) return;
        const map = { free: 'Basic', paid: 'Pro', premium: 'Premium' };
        pill.textContent = map[sel.value] || 'Basic';
    }

    function getCurrentTier() {
        if (window.rcEntitlements && typeof window.rcEntitlements.getTier === 'function') {
            try { return window.rcEntitlements.getTier(); } catch (_) {}
        }
        const sel = document.getElementById('tierSelect');
        if (sel && sel.value) return sel.value;
        return (typeof appTier !== 'undefined' && appTier) ? appTier : 'free';
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

    function promptExplorerUpgrade() { openModal('pricing-modal'); }

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

    // RETIRED (Pass 2): syncVisiblePageAsPlayTarget is no longer called.
    // Its only call site was handlePausePlay(), which has been updated to
    // delegate without pre-empting runtime page truth. Runtime owns current-
    // page targeting through _installScrollPageTracker + __rcReadingTarget.
    // getVisibleReadingPageIndex() below is kept because it still feeds the
    // progress display (not launch-critical truth). If progress display is
    // later moved to a runtime-owned readout, both functions can be deleted.
    function syncVisiblePageAsPlayTarget() {
        const idx = getVisibleReadingPageIndex();
        if (!Number.isFinite(idx) || idx < 0) return false;
        try {
            if (typeof window.focusReadingPage === 'function') {
                const result = window.focusReadingPage(idx, { behavior: 'smooth' });
                return !!(result && result.ok !== false);
            }
        } catch (_) {}
        return false;
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
        if (btn) {
            const label = eligibility.canResume ? 'Resume' : (eligibility.canPause ? 'Pause' : 'Play');
            btn.classList.toggle('active', !!status.active && !status.paused);
            btn.title = status.active ? (status.paused ? 'Resume narration' : 'Pause narration') : (countdown.active ? 'Resume current page from countdown' : 'Play current page');
            btn.disabled = !canPlay;
            btn.setAttribute('aria-disabled', String(!canPlay));
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
        // Surface blocked/no-voice/error state visibly rather than leaving dead controls.
        const blockedMsgEl = document.getElementById('shell-tts-blocked-msg');
        if (blockedMsgEl) {
            const blockedReason = !canPlay && !status.active && !countdown.active
                ? String(support.reason || eligibility.reasons?.canPlay || '')
                : '';
            if (blockedReason) {
                blockedMsgEl.textContent = blockedReason;
                blockedMsgEl.style.display = '';
            } else {
                blockedMsgEl.textContent = '';
                blockedMsgEl.style.display = 'none';
            }
        }
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

        shellDebugRemember('lastPlaybackSync', {
            type: 'playback-sync',
            playback: status,
            countdown,
            support,
            eligibility,
            speedSynced: true,
            controls: {
                playDisabled: !!(btn && btn.disabled),
                prevDisabled: !!(prevBtn && prevBtn.disabled),
                nextDisabled: !!(nextBtn && nextBtn.disabled),
                blockedReasons: {
                    play: (!canPlay && eligibility.reasons) ? (eligibility.reasons.canPlay || '') : null,
                    prev: (!eligibility.canSkipPrev && eligibility.reasons) ? (eligibility.reasons.canSkipPrev || '') : null,
                    next: (!eligibility.canSkipNext && eligibility.reasons) ? (eligibility.reasons.canSkipNext || '') : null,
                }
            }
        });
    }

    function handlePausePlay() {
        // Shell is a pure delegate. All routing — resume, pause, countdown
        // cancel+restart, and fresh-start — is owned by pauseOrResumeReading()
        // in tts.js. Shell does not inspect eligibility or countdown here.
        // PASS2: Removed syncVisiblePageAsPlayTarget() call. Runtime owns
        // current-page truth via _installScrollPageTracker (library.js), which
        // keeps __rcReadingTarget.pageIndex current on every scroll frame.
        // startFocusedPageTts() reads that directly. Shell must not pre-empt
        // the runtime's page truth with a DOM-visibility inference.
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
        shellDebugRemember('lastControlAction', {
            type: 'play-toggle',
            before,
            result,
            after: afterPlayback,
        });
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
        shellDebugRemember('lastControlAction', { type: 'autoplay-toggle', enabled: next });
        return next;
    }



    function handleTtsStep(delta) {
        const before = {
            playback: (typeof getPlaybackStatus === 'function') ? getPlaybackStatus() : null,
            countdown: (typeof getCountdownStatus === 'function') ? getCountdownStatus() : null,
            runtime: (typeof getRuntimeUiState === 'function') ? getRuntimeUiState() : null
        };
        let moved = false;
        let route = 'unavailable';
        try { if (typeof ttsJumpSentence === 'function') { moved = !!ttsJumpSentence(delta); if (moved) route = 'sentence-jump'; } } catch (_) {}
        if (!moved) {
            try { if (typeof ttsJumpPage === 'function') { moved = !!ttsJumpPage(delta); if (moved) route = 'page-jump'; } } catch (_) {}
        }
        syncShellPlaybackControls();
        const afterPlayback = (typeof getPlaybackStatus === 'function') ? getPlaybackStatus() : null;
        if (moved && afterPlayback?.active && !afterPlayback.paused) {
            bringPlaybackPageIntoView(afterPlayback);
        }
        shellDebugRemember('lastSkipAction', {
            type: 'skip',
            delta,
            route,
            moved,
            before,
            after: {
                playback: afterPlayback,
                countdown: (typeof getCountdownStatus === 'function') ? getCountdownStatus() : null,
                runtime: (typeof getRuntimeUiState === 'function') ? getRuntimeUiState() : null,
                tts: (typeof getTtsDiagnosticsSnapshot === 'function') ? getTtsDiagnosticsSnapshot() : null
            }
        });
        return moved;
    }

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            updateTierPill();
            updateExplorerSwatchState();
            try { if (window.rcTheme) window.rcTheme.syncShellState(); } catch (_) {}
            try { if (window.rcAppearance) window.rcAppearance.syncButtons(); } catch (_) {}
            try { refreshExplorerPanel(); } catch (_) {}
        }, 500);
        patchRefreshHook();
        // Reading entry is now fully runtime-owned via startReadingFromPreview → __rcLoadBook.
        // The previous poll/auto-click bridge (bookSel change → waitForPages → loadBtn.click)
        // has been retired: loadBook() in library.js calls render() directly, and render()
        // calls __jublyAfterRender itself. No shell polling or synthetic click is needed.
    });

    // ── Library table — populated by __jublyLibraryRefresh hook called from library.js ──
    function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    let libraryRefreshRetryTimer = null;

    async function refreshLibrary() {
        const rowsEl  = document.getElementById('library-rows');
        const popEl   = document.getElementById('library-populated');
        const emptyEl = document.getElementById('library-empty');
        const sampleEl = document.getElementById('library-public-sample');
        const sub     = document.getElementById('dashboard-subtitle');
        if (!rowsEl) return;

        // Hide all library states at the very start — the correct state is revealed
        // only when we actually know what to show. This prevents flash of stale data
        // on navigation and prevents intermediate DOM states being visible during
        // async resolution. On boot, auth-hydrating covers this; on navigation it does not.
        if (popEl) popEl.classList.add('hidden-section');
        if (emptyEl) emptyEl.classList.add('hidden-section');
        if (sampleEl) sampleEl.classList.add('hidden-section');
        if (sub) sub.style.display = 'none';

        if (!isAuthedUser()) {
            if (sampleEl) sampleEl.classList.remove('hidden-section');
            if (sub) {
                sub.style.display = '';
                sub.innerHTML = 'Try the sample first. Create an account later when you want ownership, saved state, and your personal library.';
            }
            return;
        }

        // Keep the library surface honest during boot. Until runtime book storage is
        // actually available, do not imply an empty library by showing the empty/import CTA.
        // Return a promise that resolves after one retry tick so DOMContentLoaded's
        // auth-hydrating removal is delayed until the retry has had a chance to render.
        // IMPORTANT: the inner retry call is fire-and-forget — do NOT await it here,
        // or successive unavailability creates an infinite chain that hangs the page.
        if (typeof localBooksGetAll !== 'function') {
            if (libraryRefreshRetryTimer) clearTimeout(libraryRefreshRetryTimer);
            return new Promise(resolve => {
                libraryRefreshRetryTimer = setTimeout(() => {
                    libraryRefreshRetryTimer = null;
                    try { refreshLibrary(); } catch (_) {}
                    resolve();
                }, 120);
            });
        }
        let books = [];
        try { books = await localBooksGetAll(); } catch(_) { books = []; }
        const has = books.length > 0;
        if (popEl)   popEl.classList.toggle('hidden-section', !has);
        if (emptyEl) emptyEl.classList.toggle('hidden-section', has);
        if (sub) sub.style.display = has ? '' : 'none';
        if (!has) {
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
        try { renderSubscriptionSurface(books); } catch (_) {}

    }
    // Hook called by library.js after populateBookSelectWithLocal()
    window.__jublyLibraryRefresh = refreshLibrary;

    function patchRefreshHook() {
        let tries = 0;
        const timer = setInterval(() => {
            tries += 1;
            if (typeof window.__rcRefreshBookSelect === 'function') {
                clearInterval(timer);
                const prev = window.__rcRefreshBookSelect;
                if (prev.__jublyWrapped) return;
                const wrapped = async function() {
                    const out = await prev.apply(this, arguments);
                    try { await refreshLibrary(); } catch(_) {}
                    return out;
                };
                wrapped.__jublyWrapped = true;
                window.__rcRefreshBookSelect = wrapped;
            } else if (tries >= 100) {
                clearInterval(timer);
            }
        }, 100);
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
        const remaining = Number(snapshot?.remaining);
        valueEl.textContent = Number.isFinite(remaining) ? `${Math.max(0, remaining)} left today` : 'Usage';
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
        if (!hasActiveReadingCards()) { prog.textContent = '—'; shellDebugRemember('lastProgressSnapshot', { type: 'progress', visible: false, label: '—' }); return; }
        const total = (typeof pages !== 'undefined' && Array.isArray(pages)) ? pages.length : 0;
        let playback = { active: false, paused: false, key: null };
        try { if (typeof getPlaybackStatus === 'function') playback = getPlaybackStatus() || playback; } catch (_) {}
        const cur   = (playback.active && !playback.paused)
                        ? Math.max(0, getActivePlaybackPageIndex(playback))
                        : Math.max(0, getVisibleReadingPageIndex());
        prog.textContent = total > 0 ? `Page ${cur + 1} / ${total}` : '—';
        shellDebugRemember('lastProgressSnapshot', { type: 'progress', visible: true, label: prog.textContent, current: cur, total });
    }

    // ── App event bridge ─────────────────────────────────────────
    // Called by app's goToNext() / nextCard equivalent at session end
    // The app will call showSessionComplete() directly once wired;
    // this is a fallback shim for the transition period.
    window.jublySessionComplete = showSessionComplete;

    document.addEventListener('DOMContentLoaded', () => {
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
            const result = await (window.rcAuth && typeof window.rcAuth.updateDisplayName === 'function'
                ? window.rcAuth.updateDisplayName(nextName)
                : Promise.resolve({ error: { message: 'Profile editing is not available.' } }));
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
            const result = await (window.rcAuth && typeof window.rcAuth.changePassword === 'function'
                ? window.rcAuth.changePassword(nextPassword)
                : Promise.resolve({ error: { message: 'Password changes are not available.' } }));
            if (result?.error) { setSettingsStatus(result.error.message || 'Unable to change password.', 'error'); return; }
            setPasswordEdit(false);
            setSettingsStatus('Password updated.', 'success');
        });
        document.getElementById('profile-help-chat-btn')?.addEventListener('click', async (e) => { e.preventDefault(); try { if (window.rcHelp && typeof window.rcHelp.openChat === 'function') await window.rcHelp.openChat(); } catch (_) {} });
        document.getElementById('profile-help-feedback-link')?.addEventListener('click', async (e) => { e.preventDefault(); try { if (window.rcHelp && typeof window.rcHelp.openFeedback === 'function') await window.rcHelp.openFeedback(); } catch (_) {} });
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
        document.addEventListener('rc:runtime-policy-changed', () => {
            updateTierPill();
            syncTierButtonState();
            updateExplorerSwatchState();
            try { syncExplorerMusicSource(); } catch (_) {}
            refreshExplorerPanel();
        });
        document.addEventListener('rc:prefs-changed', () => { try { renderProfileSurface(); } catch (_) {} try { renderLibrarySubtitle(isAuthedUser()); } catch (_) {} });
        document.addEventListener('rc:durable-data-hydrated', () => { const section = getCurrentVisibleSection(); try { renderLibrarySubtitle(isAuthedUser()); } catch (_) {} if (section === 'profile-page') { try { renderProfileSurface(); } catch (_) {} try { renderSubscriptionSurface(); } catch (_) {} } if (section === 'dashboard') { try { refreshLibrary(); } catch (_) {} } });
        window.addEventListener('rc:local-library-changed', () => { try { renderProfileSurface(); } catch (_) {} try { renderSubscriptionSurface(); } catch (_) {} try { renderLibrarySubtitle(isAuthedUser()); } catch (_) {} if (getCurrentVisibleSection() === 'dashboard') { try { refreshLibrary(); } catch (_) {} } });
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

        // F2: Autoplay countdown badge — polls AUTOPLAY_STATE every 300ms, shows badge on button.
        let _countdownInterval = null;
        function _startCountdownPoll() {
            if (_countdownInterval) return;
            _countdownInterval = setInterval(() => {
                const btn = document.getElementById('shell-next-btn');
                if (!btn) return;
                let badge = document.getElementById('shell-countdown-badge');
                try {
                    if (!hasActiveReadingCards()) { if (badge) badge.remove(); return; }
                    const countdown = (typeof getCountdownStatus === 'function') ? getCountdownStatus() : { pageIndex: -1, seconds: 0 };
                    const idx = countdown.pageIndex;
                    const sec = countdown.seconds;
                    if (idx !== -1 && sec > 0) {
                        if (!badge) {
                            badge = document.createElement('span');
                            badge.id = 'shell-countdown-badge';
                            badge.style.cssText = 'margin-left:4px; font-size:0.65rem; font-weight:800; color:var(--theme-accent); background:var(--theme-accent-soft); border-radius:999px; padding:1px 6px;';
                            btn.appendChild(badge);
                        }
                        badge.textContent = `Next: ${sec}…`;
                    } else if (badge) {
                        badge.remove();
                    }
                } catch(_) { if (badge) badge.remove(); }
            }, 300);
        }
        _startCountdownPoll();

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
            debug: SHELL_DEBUG,
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
    // Engine scripts load dynamically after window.load; refresh shell library once boot settles.
    // refreshLibrary() removed from this timer — it was a timing workaround that
    // raced against auth and could show the unauthenticated sample state after
    // auth had resolved. DOMContentLoaded now awaits refreshLibrary() before
    // removing auth-hydrating, so this stale call is no longer needed.
    window.addEventListener('load', () => setTimeout(() => { patchRefreshHook(); }, 350));
