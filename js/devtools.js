window.rcDevTools = (function () {
  const state = {
    checked: false,
    allowed: false,
    email: '',
    snapshot: null,
    loading: false,
  };

  let host = { button: null, panel: null, text: null };
  let cogBtn = null;
  let panel = null;
  let statusEl = null;

  function getAuthHeaders() {
    try {
      const token = window.rcAuth && typeof window.rcAuth.getAccessToken === 'function'
        ? String(window.rcAuth.getAccessToken() || '').trim()
        : '';
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch (_) {
      return {};
    }
  }

  function emitChange() {
    try { document.dispatchEvent(new CustomEvent('rc:devtools-changed', { detail: { ...state } })); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('rc:devtools-changed', { detail: { ...state } })); } catch (_) {}
  }

  function canCheck() {
    return !!(window.rcAuth && typeof window.rcAuth.isSignedIn === 'function' && window.rcAuth.isSignedIn());
  }

  async function fetchJson(url, init) {
    const resp = await fetch(url, { cache: 'no-store', ...init, headers: { ...(init && init.headers ? init.headers : {}) } });
    const data = await resp.json().catch(() => null);
    return { ok: resp.ok, status: resp.status, data };
  }

  async function refresh() {
    if (!canCheck()) {
      state.checked = true;
      state.allowed = false;
      state.email = '';
      state.snapshot = null;
      syncUi();
      emitChange();
      return null;
    }
    state.loading = true;
    syncUi();
    const { ok, data } = await fetchJson('/api/app?kind=dev-tools', { method: 'GET', headers: { ...getAuthHeaders() } }).catch(() => ({ ok: false, data: null }));
    state.checked = true;
    state.loading = false;
    state.allowed = !!(ok && data && data.allowed);
    state.email = state.allowed ? String(data.email || '') : '';
    state.snapshot = state.allowed ? (data.snapshot || null) : null;
    try { if (typeof window.syncDiagnosticsVisibility === 'function') window.syncDiagnosticsVisibility(); } catch (_) {}
    syncUi();
    emitChange();
    return state.snapshot;
  }

  async function mutate(action, payload) {
    if (!state.allowed) return null;
    state.loading = true;
    syncUi();
    const { ok, data } = await fetchJson('/api/app?kind=dev-tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ action, payload: payload || {} }),
    }).catch(() => ({ ok: false, data: null }));
    state.loading = false;
    if (!ok || !data || !data.ok) {
      const message = data && data.error ? String(data.error) : 'Dev action failed.';
      throw new Error(message);
    }
    state.snapshot = data.snapshot || null;
    syncUi();
    await rehydrate();
    emitChange();
    return state.snapshot;
  }

  async function rehydrate() {
    try {
      if (window.rcPolicy && typeof window.rcPolicy.refreshForTier === 'function') {
        await window.rcPolicy.refreshForTier();
      }
    } catch (_) {}
    try {
      if (window.rcUsage && typeof window.rcUsage.applySnapshot === 'function' && state.snapshot && state.snapshot.usage) {
        window.rcUsage.applySnapshot({ remaining: state.snapshot.usage.remaining, limit: state.snapshot.usage.limit });
      }
    } catch (_) {}
    try {
      if (window.rcSync && typeof window.rcSync.rehydrateDurableData === 'function') {
        await window.rcSync.rehydrateDurableData();
      }
    } catch (_) {}
    try { if (typeof window.updateDiagnostics === 'function') window.updateDiagnostics(); } catch (_) {}
  }

  function isDiagnosticsEnabled() {
    return !!state.allowed;
  }

  function attachDiagnosticsHost(nextHost) {
    host = Object.assign({}, host || {}, nextHost || {});
    syncUi();
  }

  function ensureCog() {
    if (!host.panel || !state.allowed) return;
    if (!cogBtn) {
      cogBtn = document.createElement('button');
      cogBtn.type = 'button';
      cogBtn.id = 'diagDevCog';
      cogBtn.title = 'Dev tools';
      cogBtn.textContent = '⚙';
      cogBtn.style.position = 'absolute';
      cogBtn.style.left = '12px';
      cogBtn.style.bottom = '10px';
      cogBtn.style.width = '30px';
      cogBtn.style.height = '30px';
      cogBtn.style.borderRadius = '999px';
      cogBtn.style.border = '1px solid var(--border)';
      cogBtn.style.background = 'var(--secondary-bg)';
      cogBtn.style.cursor = 'pointer';
      cogBtn.style.zIndex = '2';
      cogBtn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (!panel || panel.style.display !== 'block') {
          await refresh();
          openPanel();
        } else {
          closePanel();
        }
      });
    }
    if (!host.panel.contains(cogBtn)) {
      host.panel.style.position = 'fixed';
      host.panel.style.paddingBottom = '52px';
      host.panel.appendChild(cogBtn);
    }
    cogBtn.style.display = 'block';
  }

  function ensurePanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'devToolsPanel';
    panel.style.display = 'none';
    panel.style.position = 'fixed';
    panel.style.zIndex = '1002';
    panel.style.width = '430px';
    panel.style.maxWidth = '94vw';
    panel.style.maxHeight = '82vh';
    panel.style.overflow = 'hidden';
    panel.style.flexDirection = 'column';
    panel.style.border = '2px solid var(--border)';
    panel.style.borderRadius = '12px';
    panel.style.background = 'var(--secondary-bg)';
    panel.style.boxShadow = '0 14px 32px rgba(0,0,0,0.24)';
    panel.innerHTML = `
      <div id="devToolsTopBar" style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 14px; border-bottom:1px solid var(--border); flex-shrink:0;">
        <div style="min-width:0; flex:1;">
          <strong style="font-size:14px; opacity:0.95;">Dev tools</strong>
          <div id="devToolsStatus" style="font-size:12px; opacity:0.72; margin-top:2px;"></div>
          <div id="devClientSummary" style="font-size:11px; opacity:0.68; margin-top:2px;"></div>
        </div>
        <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
          <button type="button" id="devToolsRefreshBtn" title="Refresh dev tools" style="padding:6px 10px;">↺</button>
          <button type="button" id="devToolsCloseBtn" style="padding:6px 10px;">✕</button>
        </div>
      </div>

      <div id="devToolsContent" style="overflow-y:auto; flex:1; padding:14px;">
        <section style="border:1px solid var(--border); border-radius:10px; padding:10px; margin-bottom:10px;">
          <strong style="display:block; margin-bottom:8px; font-size:13px;">Plan</strong>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <label style="font-size:12px;">Tier<select id="devPlanTier" style="width:100%; margin-top:4px;"><option value="free">Free</option><option value="paid">Pro</option><option value="premium">Premium</option></select></label>
            <label style="font-size:12px;">Status<select id="devPlanStatus" style="width:100%; margin-top:4px;"><option value="active">active</option><option value="trialing">trialing</option><option value="canceled">canceled</option><option value="past_due">past_due</option></select></label>
          </div>
          <div style="display:flex; justify-content:flex-end; margin-top:8px;"><button type="button" id="devPlanSaveBtn">Save plan</button></div>
        </section>

        <section style="border:1px solid var(--border); border-radius:10px; padding:10px; margin-bottom:10px;">
          <strong style="display:block; margin-bottom:8px; font-size:13px;">Usage</strong>
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;">
            <label style="font-size:12px;">Left today<input id="devUsageRemaining" type="number" min="0" style="width:100%; margin-top:4px;" /></label>
            <label style="font-size:12px;">Used units<input id="devUsageUnits" type="number" min="0" style="width:100%; margin-top:4px;" /></label>
            <label style="font-size:12px;">API calls<input id="devUsageCalls" type="number" min="0" style="width:100%; margin-top:4px;" /></label>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; margin-top:8px;">
            <button type="button" id="devUsageResetBtn">Reset today</button>
            <button type="button" id="devUsageSaveBtn">Save usage</button>
          </div>
        </section>

        <section style="border:1px solid var(--border); border-radius:10px; padding:10px; margin-bottom:10px;">
          <strong style="display:block; margin-bottom:8px; font-size:13px;">Restore / progress</strong>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <label style="font-size:12px;">Book ID<input id="devProgressBookId" type="text" style="width:100%; margin-top:4px;" /></label>
            <label style="font-size:12px;">Source ID<input id="devProgressSourceId" type="text" style="width:100%; margin-top:4px;" /></label>
            <label style="font-size:12px;">Source type<input id="devProgressSourceType" type="text" value="book" style="width:100%; margin-top:4px;" /></label>
            <label style="font-size:12px;">Chapter<input id="devProgressChapter" type="text" style="width:100%; margin-top:4px;" /></label>
            <label style="font-size:12px;">Current page<input id="devProgressPage" type="number" min="1" style="width:100%; margin-top:4px;" /></label>
            <label style="font-size:12px;">Page count<input id="devProgressPageCount" type="number" min="0" style="width:100%; margin-top:4px;" /></label>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; margin-top:8px;">
            <button type="button" id="devProgressClearBtn">Clear restore</button>
            <button type="button" id="devProgressSaveBtn">Set restore spot</button>
          </div>
        </section>

        <section style="border:1px solid var(--border); border-radius:10px; padding:10px; margin-bottom:10px;">
          <strong style="display:block; margin-bottom:8px; font-size:13px;">Analytics / sessions</strong>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <label style="font-size:12px;">Book ID<input id="devSessionBookId" type="text" style="width:100%; margin-top:4px;" /></label>
            <label style="font-size:12px;">Chapter<input id="devSessionChapter" type="text" style="width:100%; margin-top:4px;" /></label>
            <label style="font-size:12px;">Minutes listened<input id="devSessionMinutes" type="number" min="0" style="width:100%; margin-top:4px;" /></label>
            <label style="font-size:12px;">Pages completed<input id="devSessionPages" type="number" min="0" style="width:100%; margin-top:4px;" /></label>
            <label style="font-size:12px;">Mode<input id="devSessionMode" type="text" value="reading" style="width:100%; margin-top:4px;" /></label>
            <label style="font-size:12px; display:flex; align-items:end; gap:8px;"><input id="devSessionCompleted" type="checkbox" /> completed</label>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; margin-top:8px;">
            <button type="button" id="devSessionsResetBtn">Reset session history</button>
            <button type="button" id="devSessionAddBtn">Add session</button>
          </div>
        </section>

        <section style="border:1px solid var(--border); border-radius:10px; padding:10px; margin-bottom:10px;">
          <strong style="display:block; margin-bottom:8px; font-size:13px;">Settings</strong>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <label style="font-size:12px;">Daily goal<input id="devSettingsGoal" type="number" min="5" max="300" style="width:100%; margin-top:4px;" /></label>
            <label style="font-size:12px;">Appearance<select id="devSettingsAppearance" style="width:100%; margin-top:4px;"><option value="light">light</option><option value="dark">dark</option></select></label>
            <label style="font-size:12px;">Theme<input id="devSettingsTheme" type="text" style="width:100%; margin-top:4px;" /></label>
            <label style="font-size:12px;">TTS speed<input id="devSettingsTtsSpeed" type="number" min="0.5" max="3" step="0.1" style="width:100%; margin-top:4px;" /></label>
            <label style="font-size:12px; display:flex; align-items:end; gap:8px;"><input id="devSettingsAutoplay" type="checkbox" /> autoplay</label>
            <label style="font-size:12px; display:flex; align-items:end; gap:8px;"><input id="devSettingsSourcePages" type="checkbox" /> source page numbers</label>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; margin-top:8px;">
            <button type="button" id="devSettingsClearBtn">Clear settings</button>
            <button type="button" id="devSettingsRehydrateBtn">Rehydrate</button>
            <button type="button" id="devSettingsSaveBtn">Save settings</button>
          </div>
        </section>
      </div>
    `;
    document.body.appendChild(panel);
    statusEl = panel.querySelector('#devToolsStatus');
    panel.querySelector('#devToolsCloseBtn').addEventListener('click', closePanel);
    panel.querySelector('#devToolsRefreshBtn').addEventListener('click', async () => {
      await refresh();
      renderPanel();
    });

    // Drag-to-reposition via top bar.
    // mousedown on the bar starts a drag; clicks on the buttons inside the bar
    // are excluded because their own listeners fire first and stop propagation
    // isn't needed — we simply ignore moves under 4px so accidental micro-drags
    // on the buttons don't shift the panel.
    const topBar = panel.querySelector('#devToolsTopBar');
    let drag = null;
    topBar.style.cursor = 'grab';
    topBar.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      // Don't initiate drag if the target is a button.
      if (ev.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      drag = { startX: ev.clientX, startY: ev.clientY, originLeft: rect.left, originTop: rect.top };
      topBar.style.cursor = 'grabbing';
      ev.preventDefault();
    });
    document.addEventListener('mousemove', (ev) => {
      if (!drag) return;
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      const newLeft = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, drag.originLeft + dx));
      const newTop = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, drag.originTop + dy));
      panel.style.left = `${newLeft}px`;
      panel.style.top = `${newTop}px`;
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = null;
      topBar.style.cursor = 'grab';
    });
    panel.querySelector('#devPlanSaveBtn').addEventListener('click', async () => {
      await doAction('set_plan', { tier: value('devPlanTier'), status: value('devPlanStatus') });
    });
    panel.querySelector('#devUsageSaveBtn').addEventListener('click', async () => {
      await doAction('set_usage', { remaining: num('devUsageRemaining'), used_units: num('devUsageUnits'), used_api_calls: num('devUsageCalls') });
    });
    panel.querySelector('#devUsageResetBtn').addEventListener('click', async () => {
      await doAction('reset_usage_window', {});
    });
    panel.querySelector('#devProgressSaveBtn').addEventListener('click', async () => {
      await doAction('set_progress', {
        book_id: value('devProgressBookId'),
        source_id: value('devProgressSourceId') || value('devProgressBookId'),
        source_type: value('devProgressSourceType') || 'book',
        chapter_id: value('devProgressChapter') || null,
        pageIndex: Math.max(0, num('devProgressPage') - 1),
        pageCount: num('devProgressPageCount'),
      });
    });
    panel.querySelector('#devProgressClearBtn').addEventListener('click', async () => {
      await doAction('clear_progress', {
        book_id: value('devProgressBookId'),
        source_id: value('devProgressSourceId') || value('devProgressBookId'),
        source_type: value('devProgressSourceType') || 'book',
        chapter_id: value('devProgressChapter') || null,
      });
    });
    panel.querySelector('#devSessionAddBtn').addEventListener('click', async () => {
      await doAction('add_session', {
        book_id: value('devSessionBookId'),
        source_id: value('devSessionBookId'),
        source_type: 'book',
        chapter_id: value('devSessionChapter') || null,
        minutesListened: num('devSessionMinutes'),
        pagesCompleted: num('devSessionPages'),
        mode: value('devSessionMode') || 'reading',
        completed: checked('devSessionCompleted'),
      });
    });
    panel.querySelector('#devSessionsResetBtn').addEventListener('click', async () => {
      await doAction('reset_sessions', {});
    });
    panel.querySelector('#devSettingsSaveBtn').addEventListener('click', async () => {
      await doAction('set_settings', {
        daily_goal_minutes: num('devSettingsGoal'),
        appearance_mode: value('devSettingsAppearance'),
        theme_id: value('devSettingsTheme') || null,
        tts_speed: num('devSettingsTtsSpeed'),
        autoplay_enabled: checked('devSettingsAutoplay'),
        use_source_page_numbers: checked('devSettingsSourcePages'),
      });
    });
    panel.querySelector('#devSettingsClearBtn').addEventListener('click', async () => {
      await doAction('clear_settings', {});
    });
    panel.querySelector('#devSettingsRehydrateBtn').addEventListener('click', async () => {
      await refresh();
      await rehydrate();
    });
    // Panel closes only via the explicit ✕ button — not on outside click.
  }

  function value(id) {
    const el = panel && panel.querySelector(`#${id}`);
    return el ? String(el.value || '').trim() : '';
  }
  function num(id) {
    const el = panel && panel.querySelector(`#${id}`);
    return el ? Number(el.value || 0) : 0;
  }
  function checked(id) {
    const el = panel && panel.querySelector(`#${id}`);
    return !!(el && el.checked);
  }
  function setValue(id, value) {
    const el = panel && panel.querySelector(`#${id}`);
    if (!el) return;
    el.value = value == null ? '' : String(value);
  }
  function setChecked(id, value) {
    const el = panel && panel.querySelector(`#${id}`);
    if (!el) return;
    el.checked = !!value;
  }

  function shortBookId(value) {
    const raw = String(value || '').trim();
    if (!raw) return '—';
    if (raw.length <= 18) return raw;
    return `${raw.slice(0, 8)}…${raw.slice(-6)}`;
  }

  function getClientContext() {
    let target = {};
    let restore = null;
    let profile = null;
    let sync = null;
    try { target = Object.assign({}, window.__rcReadingTarget || {}); } catch (_) {}
    try { restore = typeof window.getReadingRestoreStatus === 'function' ? window.getReadingRestoreStatus() : null; } catch (_) {}
    try { profile = window.rcPrefs && typeof window.rcPrefs.loadProfilePrefs === 'function' ? window.rcPrefs.loadProfilePrefs() : null; } catch (_) {}
    try { sync = window.rcSync && typeof window.rcSync.getDiagnosticsSnapshot === 'function' ? window.rcSync.getDiagnosticsSnapshot() : null; } catch (_) {}
    return { target, restore, profile, sync };
  }

  function renderPanel() {
    if (!panel) return;
    const snapshot = state.snapshot || {};
    const entitlement = snapshot.entitlementRow || snapshot.entitlement || {};
    const usage = snapshot.usage || {};
    const latestProgress = snapshot.progress && snapshot.progress.latest ? snapshot.progress.latest : ((Array.isArray(snapshot.progressRows) && snapshot.progressRows[0]) ? snapshot.progressRows[0] : {});
    const latestSession = snapshot.sessions && snapshot.sessions.latest ? snapshot.sessions.latest : {};
    const settings = snapshot.settingsRow || {};
    const client = getClientContext();
    const clientTarget = client.target || {};
    const clientRestore = client.restore || {};
    const clientBookId = String(clientTarget.bookId || '').trim();
    const clientActive = !!clientBookId;
    const resolvedBookId = clientActive ? clientBookId : (latestProgress.book_id || '');
    const resolvedSourceId = clientActive ? (clientBookId || latestProgress.source_id || '') : (latestProgress.source_id || latestProgress.book_id || '');
    const resolvedSourceType = clientActive ? (clientTarget.sourceType || 'book') : (latestProgress.source_type || 'book');
    const resolvedChapter = clientActive ? (clientTarget.chapterIndex != null ? clientTarget.chapterIndex : (latestProgress.chapter_id == null ? '' : latestProgress.chapter_id)) : (latestProgress.chapter_id == null ? '' : latestProgress.chapter_id);
    const resolvedPageIndex = clientActive ? (clientTarget.pageIndex != null ? clientTarget.pageIndex : (clientRestore.currentPageIndex != null ? clientRestore.currentPageIndex : latestProgress.last_page_index)) : latestProgress.last_page_index;
    const resolvedPageVisible = resolvedPageIndex == null || resolvedPageIndex === '' ? '' : (Math.max(0, Number(resolvedPageIndex)) + 1);
    const resolvedPageCount = clientRestore && clientRestore.pageCount ? clientRestore.pageCount : (latestProgress.page_count == null ? 0 : latestProgress.page_count);
    setValue('devPlanTier', entitlement.tier === 'premium' ? 'premium' : entitlement.tier === 'paid' ? 'paid' : 'free');
    setValue('devPlanStatus', entitlement.status || 'active');
    setValue('devUsageRemaining', usage.remaining == null ? '' : usage.remaining);
    setValue('devUsageUnits', usage.row && usage.row.used_units != null ? usage.row.used_units : (usage.used_units == null ? 0 : usage.used_units));
    setValue('devUsageCalls', usage.usedApiCalls == null ? (usage.used_api_calls == null ? 0 : usage.used_api_calls) : usage.usedApiCalls);
    setValue('devProgressBookId', resolvedBookId);
    setValue('devProgressSourceId', resolvedSourceId);
    setValue('devProgressSourceType', resolvedSourceType);
    setValue('devProgressChapter', resolvedChapter == null ? '' : resolvedChapter);
    setValue('devProgressPage', resolvedPageVisible === '' ? '' : resolvedPageVisible);
    setValue('devProgressPageCount', resolvedPageCount == null ? 0 : resolvedPageCount);
    setValue('devSessionBookId', latestSession.book_id || resolvedBookId || '');
    setValue('devSessionChapter', latestSession.chapter_id == null ? (resolvedChapter == null ? '' : resolvedChapter) : latestSession.chapter_id);
    setValue('devSessionMinutes', latestSession.minutes_listened == null ? 0 : latestSession.minutes_listened);
    setValue('devSessionPages', latestSession.pages_completed == null ? 0 : latestSession.pages_completed);
    setValue('devSessionMode', latestSession.mode || 'reading');
    setChecked('devSessionCompleted', !!latestSession.completed);
    setValue('devSettingsGoal', settings.daily_goal_minutes == null ? ((client.profile && client.profile.dailyGoalMinutes) || 15) : settings.daily_goal_minutes);
    setValue('devSettingsAppearance', settings.appearance_mode || 'light');
    setValue('devSettingsTheme', settings.theme_id || 'default');
    setValue('devSettingsTtsSpeed', settings.tts_speed == null ? '' : settings.tts_speed);
    setChecked('devSettingsAutoplay', !!settings.autoplay_enabled);
    setChecked('devSettingsSourcePages', !!settings.use_source_page_numbers);
    if (statusEl) {
      const sessionSummary = snapshot.sessions || {};
      const plan = entitlement.tier === 'paid' ? 'Pro' : entitlement.tier === 'premium' ? 'Premium' : 'Free';
      const remaining = usage.remaining == null ? '—' : usage.remaining;
      statusEl.textContent = `${state.email || 'dev'} • ${plan} • ${remaining} left • ${sessionSummary.totalSessions || 0} sessions`;
    }
    const summaryEl = panel.querySelector('#devClientSummary');
    if (summaryEl) {
      const restoreStatus = client.sync && client.sync.sync && client.sync.sync.restore ? (client.sync.sync.restore.status || 'idle') : 'idle';
      const chapterVisible = resolvedChapter === '' || resolvedChapter == null ? '—' : (Number(resolvedChapter) + 1);
      const pageVisible = resolvedPageVisible === '' ? '—' : resolvedPageVisible;
      summaryEl.textContent = `Client: book ${shortBookId(resolvedBookId)} • ch ${chapterVisible} • pg ${pageVisible} • restore ${restoreStatus}`;
    }
  }

  function openPanel() {
    if (!state.allowed) return;
    ensurePanel();
    renderPanel();
    panel.style.display = 'flex';
    positionPanel();
  }

  function positionPanel() {
    if (!panel) return;
    const anchor = host.panel || host.button;
    if (!anchor) {
      panel.style.right = '16px';
      panel.style.top = '16px';
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const width = panel.offsetWidth || 430;
    const gap = 12;
    let left = rect.right + gap;
    if (left + width > window.innerWidth - 10) {
      left = Math.max(10, rect.left - width - gap);
    }
    panel.style.left = `${Math.max(10, left)}px`;
    panel.style.top = `${Math.max(10, rect.top)}px`;
  }

  function closePanel() {
    if (panel) panel.style.display = 'none';
  }

  async function doAction(action, payload) {
    try {
      await mutate(action, payload);
      renderPanel();
    } catch (error) {
      window.alert(String(error?.message || error || 'Dev action failed.'));
    }
  }

  function syncUi() {
    if (state.allowed) {
      ensureCog();
      if (panel && panel.style.display === 'block') renderPanel();
    } else {
      if (cogBtn) cogBtn.style.display = 'none';
      if (panel) panel.style.display = 'none';
    }
  }

  try {
    document.addEventListener('rc:auth-changed', () => {
      setTimeout(() => { refresh().catch(() => {}); }, 0);
    });
  } catch (_) {}
  try {
    document.addEventListener('rc:durable-data-hydrated', () => {
      if (panel && panel.style.display === 'block') renderPanel();
    });
  } catch (_) {}
  try {
    window.addEventListener('resize', () => { if (panel && panel.style.display === 'block') positionPanel(); });
  } catch (_) {}

  return {
    refresh,
    mutate,
    rehydrate,
    attachDiagnosticsHost,
    isDiagnosticsEnabled,
    isAllowed: () => !!state.allowed,
    getState: () => ({ ...state }),
  };
})();

setTimeout(() => {
  try { if (window.rcDevTools && typeof window.rcDevTools.refresh === 'function') window.rcDevTools.refresh(); } catch (_) {}
}, 0);
