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
    try { sessionStorage.setItem('rc_pending_plan', String(plan || '')); } catch (_) {}
  }

  function readPendingPlan() {
    try { return String(sessionStorage.getItem('rc_pending_plan') || '').trim(); } catch (_) { return ''; }
  }

  function clearPendingPlan() {
    try { sessionStorage.removeItem('rc_pending_plan'); } catch (_) {}
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
      if (statusCopy) statusCopy.textContent = 'Sign in when you want billing ownership. The free path remains available without an account.';
      if (billingState) billingState.innerHTML = 'Guest <span class="text-slate-300 text-sm font-normal">mode</span>';
      if (primaryBtn) {
        primaryBtn.textContent = 'View Pricing';
        primaryBtn.onclick = function () { if (typeof openModal === 'function') openModal('pricing-modal'); };
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
        primaryBtn.onclick = function () { if (typeof openModal === 'function') openModal('pricing-modal'); };
      }
      if (secondaryBtn) {
        const stripeReady = !!(config?.stripe?.plans?.pro || config?.stripe?.plans?.premium);
        secondaryBtn.textContent = stripeReady ? 'Manage Billing' : 'Billing unavailable';
        secondaryBtn.onclick = function () { if (stripeReady) openCustomerPortal(); };
      }
    }
  }

  async function startCheckout(plan) {
    const normalized = String(plan || '').trim().toLowerCase();
    if (!normalized) return;
    if (!(window.rcAuth && typeof window.rcAuth.isSignedIn === 'function' && window.rcAuth.isSignedIn())) {
      rememberPendingPlan(normalized);
      setMessage('pricing-message', 'Create an account or sign in to continue to secure checkout.', 'info');
      setMessage('billing-message', 'Create an account or sign in to continue to secure checkout.', 'info');
      if (typeof showSignupPane === 'function') showSignupPane();
      else if (typeof showSection === 'function') showSection('login-page');
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
    if (signedIn && source === 'SIGNED_IN') {
      const pending = readPendingPlan();
      if (pending) {
        clearPendingPlan();
        startCheckout(pending);
      }
    }
  }

  document.addEventListener('rc:auth-changed', (e) => { handleAuthChanged(e).catch(() => {}); });
  document.addEventListener('DOMContentLoaded', () => {
    handleQueryFeedback();
    renderSubscriptionUi().catch(() => {});
  });

  return {
    startCheckout,
    openCustomerPortal,
    refreshRuntimeFromAccount,
    renderSubscriptionUi,
  };
})();

window.startCheckout = function startCheckout(plan) { return window.rcBilling.startCheckout(plan); };
window.openCustomerPortal = function openCustomerPortal() { return window.rcBilling.openCustomerPortal(); };
