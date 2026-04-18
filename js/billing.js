// js/billing.js
// Server-owned billing / entitlement seam.
// Frontend only starts checkout, opens portal, and renders resolved results.

window.rcBilling = (function () {
  let _configPromise = null;
  let _pricingRenderToken = 0;
  let _checkoutInFlightPlan = '';

  function setMessage(id, message, tone = 'info') {
    const el = document.getElementById(id);
    if (!el) return;
    if (!message) {
      el.textContent = '';
      el.classList.add('hidden-section');
      el.style.color = '';
      return;
    }
    el.textContent = message;
    el.classList.remove('hidden-section');
    el.style.color = tone === 'error' ? '#b91c1c' : tone === 'success' ? '#166534' : '#4338ca';
  }

  async function fetchPublicConfig() {
    if (_configPromise) return _configPromise;
    _configPromise = fetch('/api/app?kind=public-config', { cache: 'no-store' })
      .then((resp) => resp.ok ? resp.json() : null)
      .catch(() => null);
    return _configPromise;
  }

  function getAccessToken() {
    try {
      return window.rcAuth && typeof window.rcAuth.getAccessToken === 'function'
        ? window.rcAuth.getAccessToken()
        : '';
    } catch (_) {
      return '';
    }
  }

  async function authenticatedPost(url, body) {
    const token = getAccessToken();
    if (!token) {
      const err = new Error('Sign in required.');
      err.code = 'auth_required';
      throw err;
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body || {}),
      cache: 'no-store',
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = new Error(data?.error || `Request failed (${resp.status})`);
      if (resp.status === 401 || resp.status === 403) err.code = 'auth_required';
      throw err;
    }
    return data;
  }

  function isAuthRequiredError(error) {
    const code = String(error && error.code || '').trim().toLowerCase();
    if (code === 'auth_required') return true;
    const msg = String(error && error.message || error || '').trim().toLowerCase();
    return msg === 'sign in required.' || msg === 'sign in required';
  }

  function syncPlanIdQuery(plan) {
    try {
      const url = new URL(window.location.href);
      const normalized = normalizePlan(plan);
      if (normalized === 'pro' || normalized === 'premium') {
        url.searchParams.set('tier', normalized);
        url.searchParams.set('next', 'checkout');
      } else {
        url.searchParams.delete('tier');
        if (String(url.searchParams.get('next') || '').trim().toLowerCase() === 'checkout') url.searchParams.delete('next');
      }
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    } catch (_) {}
  }

  function rememberPendingPlan(plan) {
    const normalized = normalizePlan(plan);
    try { sessionStorage.setItem('rc_pending_plan', String(normalized || '')); } catch (_) {}
    syncPlanIdQuery(normalized);
  }

  function readPendingPlan() {
    try {
      const url = new URL(window.location.href);
      const fromUrl = normalizePlan(url.searchParams.get('tier') || '');
      if (fromUrl) return fromUrl;
    } catch (_) {}
    try { return normalizePlan(sessionStorage.getItem('rc_pending_plan') || ''); } catch (_) { return ''; }
  }

  function clearPendingPlan() {
    try { sessionStorage.removeItem('rc_pending_plan'); } catch (_) {}
    syncPlanIdQuery('');
  }

  function hasPendingPaidIntent() {
    const pending = normalizePlan(readPendingPlan());
    return pending === 'pro' || pending === 'premium';
  }

  function normalizePlan(plan) {
    const normalized = String(plan || '').trim().toLowerCase();
    if (normalized === 'paid') return 'pro';
    return normalized;
  }

  function normalizeRuntimeTier(tier) {
    const normalized = String(tier || '').trim().toLowerCase();
    if (normalized === 'free') return 'basic';
    if (normalized === 'paid') return 'pro';
    return ['basic', 'pro', 'premium'].includes(normalized) ? normalized : 'basic';
  }

  function showPricingModalNow() {
    const el = document.getElementById('pricing-modal');
    if (!el) return;
    el.classList.remove('hidden-section');
    if (el.classList.contains('modal-overlay')) el.style.display = 'flex';
  }

  async function openPricingForSignup() {
    clearPendingPlan();
    setMessage('pricing-message', '', 'info');
    if (typeof closeModal === 'function') closeModal('ownership-modal');
    await renderPricingUi();
    showPricingModalNow();
  }

  async function openPricingForAccount(message = '') {
    clearPendingPlan();
    setMessage('pricing-message', message || '', 'info');
    await renderPricingUi();
    showPricingModalNow();
  }

  async function showPricingForGatedAction(message) {
    setMessage('pricing-message', message || 'Create an account to import books, save your place, and build your own library.', 'info');
    if (typeof closeModal === 'function') closeModal('ownership-modal');
    await renderPricingUi();
    showPricingModalNow();
  }

  function rememberPlanAndOpenSignup(plan) {
    rememberPendingPlan(plan);
    if (typeof closeModal === 'function') closeModal('pricing-modal');
    if (typeof closeModal === 'function') closeModal('ownership-modal');
    if (typeof showSignupPane === 'function') showSignupPane(true);
    else if (typeof showSection === 'function') showSection('login-page');
  }

  function planDisplayLabel(plan) {
    const normalized = normalizePlan(plan);
    if (normalized === 'premium') return 'Premium';
    if (normalized === 'pro') return 'Pro';
    return 'Basic';
  }

  function getPlanTrialDays(plans, plan) {
    const normalized = normalizePlan(plan);
    const raw = normalized === 'premium' ? plans?.premium?.trialDays : normalized === 'pro' ? plans?.pro?.trialDays : 0;
    const days = Number(raw);
    return Number.isFinite(days) && days > 0 ? Math.trunc(days) : 0;
  }

  function trialCtaLabel(plan, fallback, plans) {
    const normalized = normalizePlan(plan);
    // Pro trial copy is public config projected from server env; it is not an entitlement claim.
    if (normalized === 'pro') {
      const days = getPlanTrialDays(plans, 'pro');
      if (days > 0) return `${days}-Day Trial`;
    }
    return fallback;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function entitlementMatchesCheckoutPlan(entitlement, expectedPlan) {
    if (!entitlement || typeof entitlement !== 'object') return false;
    const status = String(entitlement.status || '').trim().toLowerCase();
    if (status !== 'active' && status !== 'trialing') return false;
    const tier = normalizeRuntimeTier(entitlement.tier);
    const expected = normalizePlan(expectedPlan);
    if (expected === 'pro' || expected === 'premium') return tier === expected;
    return tier === 'pro' || tier === 'premium';
  }

  async function waitForCheckoutEntitlement(expectedPlan) {
    const attempts = [0, 700, 1200, 1800, 2600, 3600, 5000];
    for (const waitMs of attempts) {
      if (waitMs > 0) await delay(waitMs);
      const snapshot = await fetchRuntimeSnapshot();
      const entitlement = snapshot?.meta?.entitlement || null;
      if (entitlementMatchesCheckoutPlan(entitlement, expectedPlan)) {
        await refreshRuntimeFromAccount();
        await renderSubscriptionUi();
        await renderPricingUi();
        return true;
      }
    }
    return false;
  }

  function daysLeftLabel(endDateLike) {
    const end = endDateLike ? new Date(endDateLike).getTime() : NaN;
    if (!Number.isFinite(end)) return '';
    const days = Math.max(0, Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000)));
    if (days <= 0) return 'Last trial day';
    return days === 1 ? '1 day left' : `${days} days left`;
  }

  function applyPlanButtonState(button, label, onclick, disabled = false) {
    if (!button) return;
    button.textContent = label;
    button.disabled = !!disabled;
    button.onclick = onclick;
    button.classList.toggle('opacity-60', !!disabled);
    button.classList.toggle('cursor-not-allowed', !!disabled);
  }

  function setButtonBusy(button, busyLabel) {
    if (!button) return;
    if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent || '';
    button.disabled = true;
    button.classList.add('opacity-60', 'cursor-not-allowed');
    if (busyLabel) button.textContent = busyLabel;
  }

  function clearButtonBusy(button) {
    if (!button) return;
    if (button.dataset.idleLabel) button.textContent = button.dataset.idleLabel;
    delete button.dataset.idleLabel;
    button.classList.remove('opacity-60', 'cursor-not-allowed');
  }

  function setPricingModalSettling(signedIn) {
    const modal = document.getElementById('pricing-modal');
    const freeBtn = document.getElementById('pricing-free-btn');
    const proBtn = document.getElementById('pricing-pro-btn');
    const premiumBtn = document.getElementById('pricing-premium-btn');
    if (modal) modal.classList.add('pricing-modal-settling');
    // Seed the final labels while hidden so the first visible modal paint is
    // coherent instead of showing Loading... then morphing button text.
    if (signedIn) {
      applyPlanButtonState(freeBtn, 'Basic', null, true);
      applyPlanButtonState(proBtn, 'Pro', null, true);
      applyPlanButtonState(premiumBtn, 'Premium', null, true);
      return;
    }
    applyPlanButtonState(freeBtn, 'Continue for free', null, true);
    applyPlanButtonState(proBtn, 'Choose Pro', null, true);
    applyPlanButtonState(premiumBtn, 'Choose Premium', null, true);
  }

  function clearPricingModalSettling() {
    const modal = document.getElementById('pricing-modal');
    if (modal) modal.classList.remove('pricing-modal-settling');
  }

  function getSignedInPlanButtonModel(currentTier, plans) {
    const tier = normalizeRuntimeTier(currentTier || 'basic');
    const isBasicLocked = tier === 'pro' || tier === 'premium';
    const isProLocked = tier === 'premium';
    return {
      free: {
        label: tier === 'basic' ? 'Current Plan' : 'Basic',
        disabled: tier === 'basic' || isBasicLocked,
        onclick: tier === 'basic' ? () => { if (typeof closeModal === 'function') closeModal('pricing-modal'); } : null,
      },
      pro: {
        label: tier === 'pro' ? 'Current Plan' : trialCtaLabel('pro', 'Upgrade to Pro', plans),
        disabled: !plans?.pro?.available || tier === 'pro' || isProLocked,
        onclick: tier === 'pro' || isProLocked ? null : () => startCheckout('pro'),
      },
      premium: {
        label: tier === 'premium' ? 'Current Plan' : 'Upgrade to Premium',
        disabled: !plans?.premium?.available || tier === 'premium',
        onclick: tier === 'premium' ? null : () => startCheckout('premium'),
      },
    };
  }

  async function renderPricingUi() {
    const token = ++_pricingRenderToken;
    const freeBtn = document.getElementById('pricing-free-btn');
    const proBtn = document.getElementById('pricing-pro-btn');
    const premiumBtn = document.getElementById('pricing-premium-btn');
    const proAmount = document.getElementById('pricing-pro-amount');
    const proInterval = document.getElementById('pricing-pro-interval');
    const premiumAmount = document.getElementById('pricing-premium-amount');
    const premiumInterval = document.getElementById('pricing-premium-interval');
    const signedIn = !!(window.rcAuth && typeof window.rcAuth.isSignedIn === 'function' && window.rcAuth.isSignedIn());
    setPricingModalSettling(signedIn);

    const [config, snapshot] = await Promise.all([fetchPublicConfig(), fetchRuntimeSnapshot()]);
    if (token !== _pricingRenderToken) return;
    clearPricingModalSettling();
    const entitlement = snapshot?.meta?.entitlement || null;
    const currentTier = normalizeRuntimeTier(entitlement?.tier || snapshot?.meta?.effectiveTier || snapshot?.policy?.tier || snapshot?.tier || 'basic');
    const plans = config?.stripe?.plans || {};

    if (proAmount) proAmount.textContent = plans?.pro?.amountLabel || 'Configured in Stripe';
    if (proInterval) proInterval.textContent = plans?.pro?.intervalLabel || '';
    if (premiumAmount) premiumAmount.textContent = plans?.premium?.amountLabel || 'Configured in Stripe';
    if (premiumInterval) premiumInterval.textContent = plans?.premium?.intervalLabel || '';

    if (!signedIn) {
      applyPlanButtonState(freeBtn, 'Continue for free', () => rememberPlanAndOpenSignup('free'));
      applyPlanButtonState(proBtn, trialCtaLabel('pro', 'Choose Pro', plans), () => rememberPlanAndOpenSignup('pro'), !plans?.pro?.available);
      applyPlanButtonState(premiumBtn, 'Choose Premium', () => rememberPlanAndOpenSignup('premium'), !plans?.premium?.available);
      return;
    }

    const buttonModel = getSignedInPlanButtonModel(currentTier, plans);
    applyPlanButtonState(freeBtn, buttonModel.free.label, buttonModel.free.onclick, buttonModel.free.disabled);
    applyPlanButtonState(proBtn, buttonModel.pro.label, buttonModel.pro.onclick, buttonModel.pro.disabled);
    applyPlanButtonState(premiumBtn, buttonModel.premium.label, buttonModel.premium.onclick, buttonModel.premium.disabled);
  }

  function continueWithFree() {
    if (!(window.rcAuth && typeof window.rcAuth.isSignedIn === 'function' && window.rcAuth.isSignedIn())) {
      rememberPlanAndOpenSignup('free');
      setMessage('pricing-message', 'Create an account to continue with Basic.', 'info');
      setMessage('billing-message', 'Create an account to continue with Basic.', 'info');
      return;
    }
    clearPendingPlan();
    if (typeof closeModal === 'function') closeModal('pricing-modal');
    if (typeof closeModal === 'function') closeModal('ownership-modal');
    if (typeof showSection === 'function') showSection('dashboard');
  }

  async function refreshRuntimeFromAccount() {
    if (!(window.rcPolicy && typeof window.rcPolicy.refreshForTier === 'function')) {
      setTimeout(refreshRuntimeFromAccount, 50);
      return;
    }
    // Pass 5: authenticated billing/account refresh must consume the server's
    // resolved entitlement snapshot, not a client-supplied ?tier= simulation hint.
    try { await window.rcPolicy.refreshForTier(); } catch (_) {}
  }

  async function fetchRuntimeSnapshot() {
    const headers = {};
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const resp = await fetch('/api/app?kind=runtime-config', {
      method: 'GET',
      headers,
      cache: 'no-store',
    }).catch(() => null);
    if (!resp || !resp.ok) return null;
    return resp.json().catch(() => null);
  }

  async function renderSubscriptionUi() {
    const statusCopy = document.getElementById('subscription-status-copy');
    const billingState = document.getElementById('subscription-billing-state');
    const primaryBtn = document.getElementById('subscription-primary-btn');
    const secondaryBtn = document.getElementById('subscription-secondary-btn');

    // Neutral pending while account truth is in flight
    if (statusCopy) statusCopy.textContent = 'Checking your account…';
    if (billingState) billingState.textContent = '—';
    if (primaryBtn) primaryBtn.disabled = true;
    if (secondaryBtn) secondaryBtn.disabled = true;

    const config = await fetchPublicConfig();
    const snapshot = await fetchRuntimeSnapshot();
    const entitlement = snapshot?.meta?.entitlement || null;
    const signedIn = !!(window.rcAuth && typeof window.rcAuth.isSignedIn === 'function' && window.rcAuth.isSignedIn());

    // Truth has arrived — unlock buttons before populating settled state
    if (primaryBtn) primaryBtn.disabled = false;
    if (secondaryBtn) secondaryBtn.disabled = false;

    if (!signedIn) {
      if (statusCopy) statusCopy.textContent = 'Sign in to view your plan details and billing options.';
      if (billingState) billingState.textContent = 'Not signed in';
      if (primaryBtn) {
        primaryBtn.textContent = 'View Pricing';
        primaryBtn.onclick = function () { if (window.rcBilling && typeof window.rcBilling.openPricingForAccount === 'function') window.rcBilling.openPricingForAccount(); else if (typeof openPricingForSignup === 'function') openPricingForSignup(); else if (typeof openModal === 'function') openModal('pricing-modal'); };
      }
      if (secondaryBtn) {
        secondaryBtn.textContent = 'Sign in first';
        secondaryBtn.onclick = function () { if (typeof showSigninPane === 'function') showSigninPane(); };
      }
      return;
    }

    if (entitlement && (entitlement.status === 'active' || entitlement.status === 'trialing')) {
      const resolvedTier = normalizeRuntimeTier(entitlement?.tier);
      const tierLabel = resolvedTier === 'premium' ? 'Premium' : resolvedTier === 'pro' ? 'Pro' : 'Free';
      const status = String(entitlement.status || '').trim().toLowerCase();
      const renewsAt = entitlement.renewsAt || entitlement.periodEnd || null;
      const renewsLabel = renewsAt
        ? new Date(renewsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        : `${tierLabel} active`;
      if (status === 'trialing') {
        const remaining = daysLeftLabel(renewsAt);
        if (statusCopy) statusCopy.textContent = `Your ${tierLabel} free trial is active.`;
        if (billingState) billingState.textContent = remaining ? `Free trial · ${remaining}` : 'Free trial active';
      } else {
        if (statusCopy) statusCopy.textContent = `Your ${tierLabel} plan is active.`;
        if (billingState) billingState.textContent = renewsLabel;
      }
      if (primaryBtn) {
        primaryBtn.textContent = 'Manage Billing';
        primaryBtn.onclick = function () { openCustomerPortal(); };
      }
      if (secondaryBtn) {
        secondaryBtn.textContent = 'View Pricing';
        secondaryBtn.onclick = function () { if (window.rcBilling && typeof window.rcBilling.openPricingForAccount === 'function') window.rcBilling.openPricingForAccount(); else if (typeof openModal === 'function') openModal('pricing-modal'); };
      }
    } else {
      if (statusCopy) statusCopy.textContent = 'You are on the Basic plan. Upgrade whenever you want more books, storage, and features.';
      if (billingState) billingState.textContent = 'Basic';
      if (primaryBtn) {
        primaryBtn.textContent = 'View Pricing';
        primaryBtn.onclick = function () { if (window.rcBilling && typeof window.rcBilling.openPricingForAccount === 'function') window.rcBilling.openPricingForAccount(); else if (typeof openPricingForSignup === 'function') openPricingForSignup(); else if (typeof openModal === 'function') openModal('pricing-modal'); };
      }
      if (secondaryBtn) {
        const stripeReady = !!(config?.stripe?.plans?.pro?.available || config?.stripe?.plans?.premium?.available);
        secondaryBtn.textContent = stripeReady ? 'Manage Billing' : 'Billing unavailable';
        secondaryBtn.onclick = function () { if (stripeReady) openCustomerPortal(); };
      }
    }
  }

  async function startCheckout(plan) {
    const normalized = normalizePlan(plan);
    if (!normalized) return;
    if (normalized === 'free') {
      continueWithFree();
      return;
    }
    if (!(window.rcAuth && typeof window.rcAuth.isSignedIn === 'function' && window.rcAuth.isSignedIn())) {
      rememberPlanAndOpenSignup(normalized);
      setMessage('pricing-message', `Create an account to continue with ${planDisplayLabel(normalized)}.`, 'info');
      setMessage('billing-message', `Create an account to continue with ${planDisplayLabel(normalized)}.`, 'info');
      return;
    }
    if (_checkoutInFlightPlan === normalized) return;
    _checkoutInFlightPlan = normalized;

    // Lock plan buttons immediately — do not let a second tap queue a second request
    const proBtn = document.getElementById('pricing-pro-btn');
    const premiumBtn = document.getElementById('pricing-premium-btn');
    [proBtn, premiumBtn].forEach((btn) => {
      if (btn) { btn.disabled = true; btn.classList.add('opacity-60', 'cursor-not-allowed'); }
    });
    const clickedBtn = normalized === 'premium' ? premiumBtn : proBtn;
    setButtonBusy(clickedBtn, 'Preparing…');
    try { window.rcInteraction && window.rcInteraction.pending('billing:checkout', 'Preparing checkout…'); } catch (_) {}

    try {
      const data = await authenticatedPost('/api/billing?action=checkout', { plan: normalized });
      if (data?.url) {
        // Banner stays as 'Preparing checkout…' — page is about to navigate away
        window.location.href = data.url;
      } else {
        _checkoutInFlightPlan = '';
        [proBtn, premiumBtn].forEach((btn) => {
          if (btn) { clearButtonBusy(btn); btn.disabled = false; }
        });
        try { window.rcInteraction && window.rcInteraction.clear('billing:checkout'); } catch (_) {}
      }
    } catch (err) {
      _checkoutInFlightPlan = '';
      [proBtn, premiumBtn].forEach((btn) => {
        if (btn) { clearButtonBusy(btn); btn.disabled = false; }
      });
      try {
        const actions = window.rcInteraction && window.rcInteraction.actions
          ? (isAuthRequiredError(err)
              ? [window.rcInteraction.actions.openLogin()]
              : [window.rcInteraction.actions.retry(() => startCheckout(plan))])
          : [];
        window.rcInteraction && window.rcInteraction.error(
          'billing:checkout',
          isAuthRequiredError(err) ? 'Sign in to continue with checkout.' : 'Checkout couldn\'t be opened right now.',
          { actions }
        );
      } catch (_) {}
      setMessage('pricing-message', isAuthRequiredError(err) ? 'Sign in to continue with checkout.' : (err.message || 'Unable to start checkout.'), 'error');
      setMessage('billing-message', isAuthRequiredError(err) ? 'Sign in to continue with checkout.' : (err.message || 'Unable to start checkout.'), 'error');
    }
  }

  async function openCustomerPortal() {
    if (!(window.rcAuth && typeof window.rcAuth.isSignedIn === 'function' && window.rcAuth.isSignedIn())) {
      setMessage('billing-message', 'Sign in to manage billing.', 'info');
      try {
        const actions = window.rcInteraction && window.rcInteraction.actions ? [window.rcInteraction.actions.openLogin()] : [];
        window.rcInteraction && window.rcInteraction.error('billing:portal', 'Sign in to manage billing.', { actions });
      } catch (_) {}
      return;
    }

    // Disable both subscription buttons immediately — portal open is one-shot
    const primaryBtn = document.getElementById('subscription-primary-btn');
    const secondaryBtn = document.getElementById('subscription-secondary-btn');
    [primaryBtn, secondaryBtn].forEach((btn) => { if (btn) btn.disabled = true; });
    setButtonBusy(secondaryBtn, 'Opening…');
    try { window.rcInteraction && window.rcInteraction.pending('billing:portal', 'Opening billing…'); } catch (_) {}

    try {
      const data = await authenticatedPost('/api/billing?action=portal', {});
      if (data?.url) {
        // Page is navigating away — banner stays as 'Opening billing…'
        window.location.href = data.url;
      } else {
        [primaryBtn, secondaryBtn].forEach((btn) => { if (btn) { clearButtonBusy(btn); btn.disabled = false; } });
        try { window.rcInteraction && window.rcInteraction.clear('billing:portal'); } catch (_) {}
      }
    } catch (err) {
      [primaryBtn, secondaryBtn].forEach((btn) => { if (btn) { clearButtonBusy(btn); btn.disabled = false; } });
      try {
        const actions = window.rcInteraction && window.rcInteraction.actions
          ? (isAuthRequiredError(err)
              ? [window.rcInteraction.actions.openLogin()]
              : [window.rcInteraction.actions.retry(openCustomerPortal)])
          : [];
        window.rcInteraction && window.rcInteraction.error(
          'billing:portal',
          isAuthRequiredError(err) ? 'Sign in to manage billing.' : 'Billing couldn\'t be opened right now.',
          { actions }
        );
      } catch (_) {}
      setMessage('billing-message', isAuthRequiredError(err) ? 'Sign in to manage billing.' : (err.message || 'Unable to open billing portal.'), 'error');
    }
  }

  async function handleQueryFeedback() {
    try {
      const url = new URL(window.location.href);
      const checkout = url.searchParams.get('checkout');
      const portal = url.searchParams.get('portal');
      if (checkout === 'success') {
        const expectedPlan = normalizePlan(url.searchParams.get('checkout_plan') || readPendingPlan());
        setMessage('pricing-message', 'Checkout completed. Refreshing your account access…', 'success');
        setMessage('billing-message', 'Checkout completed. Refreshing your account access…', 'success');
        try { window.rcInteraction && window.rcInteraction.pending('billing:return', 'Updating your plan…'); } catch (_) {}
        const confirmed = await waitForCheckoutEntitlement(expectedPlan);
        if (!confirmed) {
          await refreshRuntimeFromAccount();
          await renderSubscriptionUi();
          setMessage('billing-message', 'Checkout completed. Your account access is still updating. Refresh if it does not appear shortly.', 'info');
        }
        clearPendingPlan();
        try { window.rcInteraction && window.rcInteraction.clear('billing:return'); } catch (_) {}
      } else if (checkout === 'cancel') {
        clearPendingPlan();
      }
      if (portal === 'return') {
        clearPendingPlan();
        setMessage('billing-message', 'Returned from billing portal. Refreshing your account access…', 'success');
        try { window.rcInteraction && window.rcInteraction.pending('billing:return', 'Refreshing billing status…'); } catch (_) {}
        await refreshRuntimeFromAccount();
        try { window.rcInteraction && window.rcInteraction.clear('billing:return'); } catch (_) {}
      }
      if (checkout || portal) {
        url.searchParams.delete('checkout');
        url.searchParams.delete('checkout_plan');
        url.searchParams.delete('portal');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      }
    } catch (_) {
      try {
        const actions = window.rcInteraction && window.rcInteraction.actions ? [window.rcInteraction.actions.refresh()] : [];
        window.rcInteraction && window.rcInteraction.error('billing:return', 'We couldn\'t confirm your billing update yet.', { actions });
      } catch (_) {}
    }
  }

  async function handleAuthChanged(e) {
    const { signedIn, source } = e.detail || {};
    if (signedIn && (source === 'SIGNED_IN' || source === 'INITIAL_SESSION' || source === 'init')) {
      const pending = normalizePlan(readPendingPlan());
      if (pending === 'free') {
        clearPendingPlan();
      } else if (pending === 'pro' || pending === 'premium') {
        setMessage('pricing-message', `Redirecting to ${planDisplayLabel(pending)} checkout…`, 'info');
        setMessage('billing-message', `Redirecting to ${planDisplayLabel(pending)} checkout…`, 'info');
        startCheckout(pending);
        return;
      }
    }
    // Do NOT call refreshRuntimeFromAccount() here. Policy is owned by sync.js;
    // calling refreshForTier() on every auth event (including tab-return token
    // refreshes) races against the durable-sync cache projection and can
    // transiently apply a basic fallback, stripping access mid-session.
    // renderSubscriptionUi / renderPricingUi each call fetchRuntimeSnapshot()
    // internally and do not need a prior global policy refresh.
    await renderSubscriptionUi();
    await renderPricingUi();
  }

  document.addEventListener('rc:auth-changed', (e) => { handleAuthChanged(e).catch(() => {}); });
  document.addEventListener('DOMContentLoaded', () => {
    handleQueryFeedback();
    renderSubscriptionUi().catch(() => {});
    renderPricingUi().catch(() => {});
  });

  return {
    startCheckout,
    openCustomerPortal,
    refreshRuntimeFromAccount,
    renderSubscriptionUi,
    renderPricingUi,
    rememberPendingPlan,
    showPricingForGatedAction,
    openPricingForAccount,
    readPendingPlan,
    clearPendingPlan,
    openPricingForSignup,
    continueWithFree,
    hasPendingPaidIntent,
  };
})();

window.startCheckout = function startCheckout(plan) { return window.rcBilling.startCheckout(plan); };
window.openCustomerPortal = function openCustomerPortal() { return window.rcBilling.openCustomerPortal(); };

window.openPricingForSignup = function openPricingForSignup() { return window.rcBilling.openPricingForSignup(); };
window.openPricingForAccount = function openPricingForAccount(message) { return window.rcBilling.openPricingForAccount(message); };
window.continueWithFree = function continueWithFree() { return window.rcBilling.continueWithFree(); };
