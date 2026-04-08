// js/billing.js
// Server-owned billing / entitlement seam.
// Frontend only starts checkout, opens portal, and renders resolved results.

window.rcBilling = (function () {
  let _configPromise = null;

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
    if (!token) throw new Error('Sign in required.');
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
    if (!resp.ok) throw new Error(data?.error || `Request failed (${resp.status})`);
    return data;
  }

  function rememberPendingPlan(plan) {
    const normalized = normalizePlan(plan);
    try { sessionStorage.setItem('rc_pending_plan', normalized); } catch (_) {}
    try {
      const url = new URL(window.location.href);
      if (normalized && normalized !== 'free') url.searchParams.set('plan_id', normalized);
      else url.searchParams.delete('plan_id');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    } catch (_) {}
  }

  function readPendingPlan() {
    try {
      const url = new URL(window.location.href);
      const fromUrl = normalizePlan(url.searchParams.get('plan_id') || '');
      if (fromUrl) return fromUrl;
    } catch (_) {}
    try { return normalizePlan(sessionStorage.getItem('rc_pending_plan') || ''); } catch (_) { return ''; }
  }

  function clearPendingPlan() {
    try { sessionStorage.removeItem('rc_pending_plan'); } catch (_) {}
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('plan_id');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    } catch (_) {}
  }

  function normalizePlan(plan) {
    const normalized = String(plan || '').trim().toLowerCase();
    if (normalized === 'paid') return 'pro';
    return normalized;
  }

  function openPricingForSignup() {
    clearPendingPlan();
    if (typeof closeModal === 'function') closeModal('ownership-modal');
    if (typeof openModal === 'function') openModal('pricing-modal');
    renderPricingUi().catch(() => {});
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
    return 'Free';
  }

  function applyPlanButtonState(button, label, onclick, disabled = false) {
    if (!button) return;
    button.textContent = label;
    button.disabled = !!disabled;
    button.onclick = onclick;
    button.classList.toggle('opacity-60', !!disabled);
    button.classList.toggle('cursor-not-allowed', !!disabled);
  }

  async function renderPricingUi() {
    const config = await fetchPublicConfig();
    const signedIn = !!(window.rcAuth && typeof window.rcAuth.isSignedIn === 'function' && window.rcAuth.isSignedIn());
    const snapshot = await fetchRuntimeSnapshot();
    const entitlement = snapshot?.meta?.entitlement || null;
    const currentTier = String(entitlement?.tier || snapshot?.tier || 'free').toLowerCase();
    const plans = config?.stripe?.plans || {};
    const freeBtn = document.getElementById('pricing-free-btn');
    const proBtn = document.getElementById('pricing-pro-btn');
    const premiumBtn = document.getElementById('pricing-premium-btn');
    const proAmount = document.getElementById('pricing-pro-amount');
    const proInterval = document.getElementById('pricing-pro-interval');
    const premiumAmount = document.getElementById('pricing-premium-amount');
    const premiumInterval = document.getElementById('pricing-premium-interval');

    if (proAmount) proAmount.textContent = plans?.pro?.amountLabel || 'Configured in Stripe';
    if (proInterval) proInterval.textContent = plans?.pro?.intervalLabel || '';
    if (premiumAmount) premiumAmount.textContent = plans?.premium?.amountLabel || 'Configured in Stripe';
    if (premiumInterval) premiumInterval.textContent = plans?.premium?.intervalLabel || '';

    if (!signedIn) {
      applyPlanButtonState(freeBtn, 'Continue with Free', () => rememberPlanAndOpenSignup('free'));
      applyPlanButtonState(proBtn, 'Choose Pro', () => rememberPlanAndOpenSignup('pro'), !plans?.pro?.available);
      applyPlanButtonState(premiumBtn, 'Choose Premium', () => rememberPlanAndOpenSignup('premium'), !plans?.premium?.available);
      return;
    }

    applyPlanButtonState(freeBtn, currentTier === 'free' ? 'Current Plan' : 'Free Plan', () => { if (typeof closeModal === 'function') closeModal('pricing-modal'); }, currentTier === 'free');
    applyPlanButtonState(proBtn, currentTier === 'paid' ? 'Current Plan' : 'Upgrade to Pro', () => startCheckout('pro'), !plans?.pro?.available || currentTier === 'paid');
    applyPlanButtonState(premiumBtn, currentTier === 'premium' ? 'Current Plan' : 'Upgrade to Premium', () => startCheckout('premium'), !plans?.premium?.available || currentTier === 'premium');
  }

  function continueWithFree() {
    rememberPlanAndOpenSignup('free');
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
    const config = await fetchPublicConfig();
    const snapshot = await fetchRuntimeSnapshot();
    const entitlement = snapshot?.meta?.entitlement || null;
    const signedIn = !!(window.rcAuth && typeof window.rcAuth.isSignedIn === 'function' && window.rcAuth.isSignedIn());

    if (!signedIn) {
      if (statusCopy) statusCopy.textContent = 'Sign in to access your account, or choose View Pricing after you are inside the app when you are ready to upgrade.';
      if (billingState) billingState.innerHTML = 'Guest <span class="text-slate-300 text-sm font-normal">mode</span>';
      if (primaryBtn) {
        primaryBtn.textContent = 'View Pricing';
        primaryBtn.onclick = function () { if (typeof openPricingForSignup === 'function') openPricingForSignup(); else if (typeof openModal === 'function') openModal('pricing-modal'); };
      }
      if (secondaryBtn) {
        secondaryBtn.textContent = 'Sign in first';
        secondaryBtn.onclick = function () { if (typeof showSigninPane === 'function') showSigninPane(); };
      }
      return;
    }

    if (entitlement && entitlement.status === 'active') {
      const tierLabel = entitlement.tier === 'premium' ? 'Premium' : entitlement.tier === 'paid' ? 'Pro' : 'Free';
      if (statusCopy) statusCopy.textContent = `Your resolved plan is ${tierLabel}. Billing changes go through the Stripe portal, not the browser.`;
      if (billingState) billingState.innerHTML = `${tierLabel} <span class="text-slate-300 text-sm font-normal">active</span>`;
      if (primaryBtn) {
        primaryBtn.textContent = 'Manage Billing';
        primaryBtn.onclick = function () { openCustomerPortal(); };
      }
      if (secondaryBtn) {
        secondaryBtn.textContent = 'View Pricing';
        secondaryBtn.onclick = function () { if (typeof openModal === 'function') openModal('pricing-modal'); };
      }
    } else {
      if (statusCopy) statusCopy.textContent = 'Your account is on the free path until Stripe creates an active entitlement. Upgrade when you are ready.';
      if (billingState) billingState.innerHTML = 'Free <span class="text-slate-300 text-sm font-normal">path</span>';
      if (primaryBtn) {
        primaryBtn.textContent = 'View Pricing';
        primaryBtn.onclick = function () { if (typeof openPricingForSignup === 'function') openPricingForSignup(); else if (typeof openModal === 'function') openModal('pricing-modal'); };
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
    try {
      const data = await authenticatedPost('/api/billing?action=checkout', { plan: normalized });
      clearPendingPlan();
      if (data?.url) window.location.href = data.url;
    } catch (error) {
      setMessage('pricing-message', error.message || 'Unable to start checkout.', 'error');
      setMessage('billing-message', error.message || 'Unable to start checkout.', 'error');
    }
  }

  async function openCustomerPortal() {
    if (!(window.rcAuth && typeof window.rcAuth.isSignedIn === 'function' && window.rcAuth.isSignedIn())) {
      setMessage('billing-message', 'Sign in to manage billing.', 'info');
      if (typeof showSigninPane === 'function') showSigninPane();
      return;
    }
    try {
      const data = await authenticatedPost('/api/billing?action=portal', {});
      if (data?.url) window.location.href = data.url;
    } catch (error) {
      setMessage('billing-message', error.message || 'Unable to open billing portal.', 'error');
    }
  }

  function handleQueryFeedback() {
    try {
      const url = new URL(window.location.href);
      const checkout = url.searchParams.get('checkout');
      const portal = url.searchParams.get('portal');
      if (checkout === 'success') {
        setMessage('pricing-message', 'Checkout completed. Refreshing your account access…', 'success');
        setMessage('billing-message', 'Checkout completed. Refreshing your account access…', 'success');
        refreshRuntimeFromAccount();
      } else if (checkout === 'cancel') {
        setMessage('pricing-message', 'Checkout was canceled. You can keep using the free path or try again later.', 'info');
      }
      if (portal === 'return') {
        setMessage('billing-message', 'Returned from billing portal. Refreshing your account access…', 'success');
        refreshRuntimeFromAccount();
      }
      if (checkout || portal) {
        url.searchParams.delete('checkout');
        url.searchParams.delete('portal');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      }
    } catch (_) {}
  }

  async function handleAuthChanged(e) {
    const { signedIn, source } = e.detail || {};
    await refreshRuntimeFromAccount();
    await renderSubscriptionUi();
    await renderPricingUi();
    if (signedIn && (source === 'SIGNED_IN' || source === 'INITIAL_SESSION' || source === 'init')) {
      const pending = normalizePlan(readPendingPlan());
      if (pending === 'free') {
        clearPendingPlan();
      } else if (pending) {
        clearPendingPlan();
        startCheckout(pending);
      }
    }
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
    readPendingPlan,
    clearPendingPlan,
    openPricingForSignup,
    continueWithFree,
  };
})();

window.startCheckout = function startCheckout(plan) { return window.rcBilling.startCheckout(plan); };
window.openCustomerPortal = function openCustomerPortal() { return window.rcBilling.openCustomerPortal(); };

window.openPricingForSignup = function openPricingForSignup() { return window.rcBilling.openPricingForSignup(); };
window.continueWithFree = function continueWithFree() { return window.rcBilling.continueWithFree(); };
