// js/sync.js
// ─────────────────────────────────────────────────────────────────────────────
// Durable sync seam.
//
// window.rcSync owns:
//   - server-authoritative durable sync for user/settings/progress/sessions
//   - cached last-confirmed durable snapshot for signed-in refresh responsiveness
//   - optimistic projection of persistent-looking UI while durable writes confirm
//   - restore lookups against durable progress
//   - sync diagnostics visibility for runtime validation
//
// This module does NOT own auth state, shell truth, or live reading behavior.
// Runtime still owns reading entry/apply timing and current page truth.
//
// localStorage cache (rc_durable_snapshot_v1:<userId>):
//   - Written on every confirmed server snapshot
//   - Applied on sign-in before server responds (display projection only)
//   - NEVER used as restore authority — restore always hits the server
//   - NEVER used as a first-entry position guess
//
// localStorage dirty set (rc_dirty_settings_v1):
//   - Written on every user-initiated setting change (field-level, with timestamp)
//   - Survives page refresh — replayed on top of server snapshot after hydration
//   - Cleared field-by-field when server confirms those fields
//   - Drives retry-without-snap-back on server write failures
// ─────────────────────────────────────────────────────────────────────────────

window.rcSync = (function () {
  let _progressTimer = null;
  let _prefsSyncTimer = null;
  let _remoteUsersRow = null;
  let _remoteSettingsRow = null;
  let _remoteLibraryItems = [];
  let _remoteProgressRows = [];
  let _remoteBookMetricsRows = [];
  let _remoteDailyStatsRows = [];
  let _remoteSessions = [];
  let _remoteProfileMetrics = null;
  let _remoteUsageSummary = null;
  let _remoteEntitlement = null;
  const _cachedSnapshotApplyCount = Object.create(null);
  let _hydrationState = { inFlight: false, users: false, settings: false, progress: false, sessions: false, usage: false };
  let _lastSyncSnapshotAt = null;
  let _syncDiagnostics = { users: null, settings: null, progress: null, sessions: null, restore: null, snapshot: null };
  const RC_EVENT_TRAIL_MAX = 40;
  if (!Array.isArray(window.__rcEventTrail)) window.__rcEventTrail = [];
  function _pushEvent(tag, data) {
    const entry = { t: new Date().toISOString(), tag, ...data };
    window.__rcEventTrail.push(entry);
    if (window.__rcEventTrail.length > RC_EVENT_TRAIL_MAX) window.__rcEventTrail.shift();
    try { if (typeof window.updateDiagnostics === 'function') window.updateDiagnostics(); } catch (_) {}
  }
  let _requestSeq = 0;
  let _appliedSeq = 0;
  let _applyingRemoteSettings = false;
  let _pendingRuntimePolicyProjection = null;
  let _pendingRuntimePolicyFlushTimer = null;
  let _runtimePolicyProjectionDiagnostics = {
    at: null,
    action: 'init',
    reason: 'init',
    tier: null,
    fromCache: false,
    fromSnapshot: false,
    pendingPresent: false,
    stagedSnapshotProjectionPresent: false,
  };

  // Dirty settings: field-level record of user mutations not yet confirmed by the server.
  // Persisted to localStorage so uncommitted changes survive page refresh.
  // Entries: { [fieldName]: { value, ts } }
  const RC_DIRTY_SETTINGS_KEY = 'rc_dirty_settings_v1';
  let _dirtySettings = {};
  let _confirmedSettingsRow = null; // last server-ACKed settings row (never overwritten by projection)
  try { const _ds = localStorage.getItem(RC_DIRTY_SETTINGS_KEY); if (_ds) _dirtySettings = JSON.parse(_ds) || {}; } catch (_) {}

  function _saveDirtySettings() {
    try {
      Object.keys(_dirtySettings).length === 0
        ? localStorage.removeItem(RC_DIRTY_SETTINGS_KEY)
        : localStorage.setItem(RC_DIRTY_SETTINGS_KEY, JSON.stringify(_dirtySettings));
    } catch (_) {}
  }

  function _recordDirtyFields(collected) {
    // Diff collected UI state against last server-confirmed row (not the projected row).
    // Only fields that diverge from confirmed server truth are marked dirty.
    const confirmed = _confirmedSettingsRow || {};
    const now = Date.now();
    let changed = false;
    Object.keys(collected).forEach(k => {
      if (k === 'updated_at') return;
      if (JSON.stringify(collected[k]) !== JSON.stringify(confirmed[k])) {
        _dirtySettings[k] = { value: collected[k], ts: now };
        changed = true;
      }
    });
    if (changed) _saveDirtySettings();
  }

  function _replayDirtyOntoSettings() {
    // Overlay any pending dirty mutations onto _remoteSettingsRow and apply them
    // to the DOM/localStorage. Called after a server snapshot lands so user intent
    // from before the refresh is immediately visible and queued for server write.
    const dirtyKeys = Object.keys(_dirtySettings);
    if (dirtyKeys.length === 0) return;
    const dirtyValues = Object.fromEntries(dirtyKeys.map(k => [k, _dirtySettings[k].value]));
    const merged = Object.assign({}, _remoteSettingsRow || {}, dirtyValues);
    _remoteSettingsRow = merged;
    _applyRemoteSettingsRow(merged);
    // Queue a sync so dirty mutations are written to the server.
    // Slight delay avoids racing with whatever triggered _applySnapshot.
    setTimeout(() => { try { _queueSettingsSync(); } catch (_) {} }, 80);
  }

  const RC_THEME_PREFS_KEY = 'rc_theme_prefs';
  const RC_APPEARANCE_PREFS_KEY = 'rc_appearance_prefs';
  const RC_DURABLE_CACHE_PREFIX = 'rc_durable_snapshot_v1:';

  const WATCHED_SETTING_IDS = new Set([
    'voiceFemaleSelect',
    'voiceMaleSelect',
    'autoplayToggle',
    'vol_voice',
  ]);

  function _user() {
    try { return window.rcAuth && typeof window.rcAuth.getUser === 'function' ? window.rcAuth.getUser() : null; } catch (_) { return null; }
  }

  function _accessToken() {
    try { return window.rcAuth && typeof window.rcAuth.getAccessToken === 'function' ? String(window.rcAuth.getAccessToken() || '').trim() : ''; } catch (_) { return ''; }
  }

  function _ready() {
    const u = _user();
    return !!(u && u.id && _accessToken());
  }

  function _emitHydrated(kind) {
    const hydratedKind = String(kind || 'sync');
    _pushEvent('durable-data-hydrated', { kind: hydratedKind });
    try { document.dispatchEvent(new CustomEvent('rc:durable-data-hydrated', { detail: { kind: hydratedKind } })); } catch (_) {}
  }

  function _recordSync(kind, status, detail = {}) {
    _syncDiagnostics[kind] = Object.assign({ status: String(status || 'idle'), at: new Date().toISOString() }, detail || {});
    try { if (typeof window.updateDiagnostics === 'function') window.updateDiagnostics(); } catch (_) {}
    return _syncDiagnostics[kind];
  }

  function _recordRuntimePolicyProjectionDiagnostic(action, detail = {}) {
    const pending = _pendingRuntimePolicyProjection;
    _runtimePolicyProjectionDiagnostics = Object.assign({}, _runtimePolicyProjectionDiagnostics || {}, {
      at: new Date().toISOString(),
      action: String(action || 'unknown'),
      reason: String(detail.reason || ''),
      tier: detail.tier == null ? (pending && pending.policy ? String(pending.policy.tier || '') : null) : String(detail.tier || ''),
      fromCache: !!detail.fromCache,
      fromSnapshot: !!detail.fromSnapshot,
      pendingPresent: !!pending,
      stagedSnapshotProjectionPresent: !!pending && (action === 'staged' || !!detail.fromSnapshot),
    });
    return _runtimePolicyProjectionDiagnostics;
  }

  function _getRuntimePolicyProjectionDiagnosticsSnapshot() {
    const pending = _pendingRuntimePolicyProjection;
    return {
      pendingPolicyProjectionPresent: !!pending,
      pendingPolicyProjectionTier: pending && pending.policy ? String(pending.policy.tier || '') : null,
      pendingPolicyProjectionFromCache: !!(pending && pending.options && pending.options.fromCache),
      stagedSnapshotPolicyProjectionPresent: !!pending && !!(_runtimePolicyProjectionDiagnostics && _runtimePolicyProjectionDiagnostics.stagedSnapshotProjectionPresent),
      lastProjection: Object.assign({}, _runtimePolicyProjectionDiagnostics || {}),
    };
  }

  document.addEventListener('rc:runtime-policy-changed', () => { try { _flushPendingRuntimePolicyProjection('runtime-policy-changed'); } catch (_) {} });
  try { window.addEventListener('load', () => { try { _flushPendingRuntimePolicyProjection('window-load'); } catch (_) {} }); } catch (_) {}

  function _normalizeUsageValue(value) {
    if (value == null || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? Math.max(0, num) : null;
  }

  function _composeResolvedUsageSummary(local, remote) {
    const localRemaining = _normalizeUsageValue(local?.remaining);
    const localAllowance = _normalizeUsageValue(local?.allowance != null ? local.allowance : local?.limit);
    const remoteRemaining = _normalizeUsageValue(remote?.remaining);
    const remoteAllowance = _normalizeUsageValue(remote?.allowance != null ? remote.allowance : remote?.limit);

    const localHasValue = localRemaining != null || localAllowance != null;
    const remoteHasValue = remoteRemaining != null || remoteAllowance != null;
    const localAuthoritative = !!(local?.authoritative && localHasValue);
    const remoteAuthoritative = !!(remote?.authoritative && remoteHasValue);

    let primary = null;
    let source = null;
    if (localAuthoritative) {
      primary = local;
      source = local?.source || 'local-authoritative';
    } else if (remoteAuthoritative) {
      primary = remote;
      source = remote?.source || 'remote-authoritative';
    } else if (localHasValue) {
      primary = local;
      source = local?.source || 'local-projected';
    } else if (remoteHasValue) {
      primary = remote;
      source = remote?.source || 'remote-projected';
    }

    const primaryRemaining = _normalizeUsageValue(primary?.remaining);
    const primaryAllowance = _normalizeUsageValue(primary?.allowance != null ? primary.allowance : primary?.limit);
    return {
      remaining: primaryRemaining,
      allowance: primaryAllowance,
      authoritative: !!((localAuthoritative || remoteAuthoritative) && (primaryRemaining != null || primaryAllowance != null)),
      source,
      local,
      remote,
    };
  }

  function _getResolvedUsageSummary() {
    let local = null;
    try {
      local = window.rcUsage && typeof window.rcUsage.getSnapshot === 'function' ? window.rcUsage.getSnapshot() : null;
    } catch (_) {
      local = null;
    }
    return _composeResolvedUsageSummary(local, _remoteUsageSummary);
  }

  function _resetPolicyToPublic(reason) {
    try {
      if (window.rcPolicy && typeof window.rcPolicy.resetToPublic === 'function') {
        window.rcPolicy.resetToPublic(reason || 'sync-public-reset');
        return true;
      }
    } catch (_) {}
    return false;
  }

  function _clearPendingRuntimePolicyProjection(reason) {
    const hadPending = !!_pendingRuntimePolicyProjection;
    _pendingRuntimePolicyProjection = null;
    if (_pendingRuntimePolicyFlushTimer) {
      clearTimeout(_pendingRuntimePolicyFlushTimer);
      _pendingRuntimePolicyFlushTimer = null;
    }
    if (hadPending) _pushEvent('policy-projection-cleared-public', { reason: String(reason || 'public-reset') });
    _recordRuntimePolicyProjectionDiagnostic('cleared', { reason: String(reason || 'public-reset') });
    return hadPending;
  }

  function _applyRuntimePolicyProjection(policy, options = {}) {
    if (!policy || typeof policy !== 'object') return false;
    if (!_ready()) {
      _clearPendingRuntimePolicyProjection('apply-blocked-public');
      _resetPolicyToPublic('sync-policy-apply-blocked-public');
      _recordRuntimePolicyProjectionDiagnostic('blocked', { tier: String(policy.tier || ''), fromCache: !!options.fromCache, fromSnapshot: !!options.fromSnapshot, reason: 'apply-blocked-public' });
      _pushEvent('policy-projection-blocked-public', { tier: String(policy.tier || ''), fromCache: !!options.fromCache });
      return false;
    }
    try {
      if (window.rcPolicy && typeof window.rcPolicy.apply === 'function') {
        window.rcPolicy.apply(policy, null, { transient: !!options.fromCache, resolved: true, source: options.fromCache ? 'sync-cache' : 'sync-snapshot', reason: options.replayed ? `policy-projection-replay:${options.replayReason || 'owner-ready'}` : 'policy-projection-apply' });
        _recordRuntimePolicyProjectionDiagnostic('applied', { tier: String(policy.tier || ''), fromCache: !!options.fromCache, fromSnapshot: !!options.fromSnapshot, reason: options.replayed ? `replayed:${options.replayReason || 'owner-ready'}` : 'apply' });
        _pushEvent('policy-projected', {
          tier: String(policy.tier || ''),
          fromCache: !!options.fromCache,
          explorer: !!(policy.features?.themes?.explorer),
          replayed: !!options.replayed,
          replayReason: String(options.replayReason || ''),
        });
        _recordSync('snapshot', options.fromCache ? 'cache-policy-projected' : 'policy-projected', {
          policyTier: String(policy.tier || ''),
          source: options.fromCache ? 'server-cache' : 'server-sync',
          replayed: !!options.replayed,
        });
        return true;
      }
    } catch (_) {}
    return false;
  }

  function _schedulePendingRuntimePolicyFlush() {
    if (_pendingRuntimePolicyFlushTimer || !_pendingRuntimePolicyProjection) return;
    _pendingRuntimePolicyFlushTimer = setTimeout(() => {
      _pendingRuntimePolicyFlushTimer = null;
      _flushPendingRuntimePolicyProjection('owner-ready-retry');
    }, 50);
  }

  function _stageRuntimePolicyProjection(policy, options = {}) {
    if (!policy || typeof policy !== 'object') return false;
    if (!_ready()) {
      _clearPendingRuntimePolicyProjection('stage-blocked-public');
      _resetPolicyToPublic('sync-policy-stage-blocked-public');
      _recordRuntimePolicyProjectionDiagnostic('stage-blocked', { tier: String(policy.tier || ''), fromCache: !!options.fromCache, fromSnapshot: !!options.fromSnapshot, reason: 'stage-blocked-public' });
      _pushEvent('policy-projection-stage-blocked-public', { tier: String(policy.tier || ''), fromCache: !!options.fromCache });
      return false;
    }
    _pendingRuntimePolicyProjection = {
      policy,
      options: {
        fromCache: !!options.fromCache,
        fromSnapshot: !!options.fromSnapshot,
      },
    };
    _recordRuntimePolicyProjectionDiagnostic('staged', { tier: String(policy.tier || ''), fromCache: !!options.fromCache, fromSnapshot: !!options.fromSnapshot, reason: 'owner-not-ready' });
    _pushEvent('policy-projection-staged', {
      tier: String(policy.tier || ''),
      fromCache: !!options.fromCache,
      explorer: !!(policy.features?.themes?.explorer),
    });
    _recordSync('snapshot', options.fromCache ? 'cache-policy-staged' : 'policy-staged', {
      policyTier: String(policy.tier || ''),
      source: options.fromCache ? 'server-cache' : 'server-sync',
    });
    _schedulePendingRuntimePolicyFlush();
    return true;
  }

  function _flushPendingRuntimePolicyProjection(reason = 'owner-ready') {
    if (!_pendingRuntimePolicyProjection) return false;
    if (!_ready()) {
      _clearPendingRuntimePolicyProjection(reason || 'flush-blocked-public');
      _resetPolicyToPublic('sync-policy-flush-blocked-public');
      _recordRuntimePolicyProjectionDiagnostic('flush-blocked', { reason: String(reason || 'owner-ready') });
      _pushEvent('policy-projection-flush-blocked-public', { reason: String(reason || 'owner-ready') });
      return false;
    }
    if (!(window.rcPolicy && typeof window.rcPolicy.apply === 'function')) {
      _schedulePendingRuntimePolicyFlush();
      return false;
    }
    const pending = _pendingRuntimePolicyProjection;
    _pendingRuntimePolicyProjection = null;
    if (_pendingRuntimePolicyFlushTimer) {
      clearTimeout(_pendingRuntimePolicyFlushTimer);
      _pendingRuntimePolicyFlushTimer = null;
    }
    return _applyRuntimePolicyProjection(pending.policy, Object.assign({}, pending.options, {
      replayed: true,
      replayReason: reason,
    }));
  }

  function _cacheKey(userId) {
    return `${RC_DURABLE_CACHE_PREFIX}${String(userId || '').trim()}`;
  }

  function _readLocalJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) { return {}; }
  }

  function _writeLocalJson(key, payload) {
    const safe = (payload && typeof payload === 'object') ? payload : {};
    try { localStorage.setItem(key, JSON.stringify(safe)); } catch (_) {}
    return safe;
  }

  function _readDurableCache(userId) {
    const key = _cacheKey(userId);
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
  }

  function _writeDurableCache(userId, snapshot) {
    const key = _cacheKey(userId);
    try { localStorage.setItem(key, JSON.stringify({ savedAt: new Date().toISOString(), snapshot: snapshot || null })); } catch (_) {}
  }

  function _currentThemePrefs() {
    const stored = _readLocalJson(RC_THEME_PREFS_KEY);
    try {
      if (window.rcTheme && typeof window.rcTheme.get === 'function') {
        const state = window.rcTheme.get() || {};
        const themeId = String(state.themeId || stored.theme_id || 'default');
        const settings = (state.settings && typeof state.settings === 'object') ? state.settings : (stored.theme_settings || {});
        return {
          theme_id: themeId,
          theme_settings: Object.assign({}, stored.theme_settings || {}, settings || {}),
        };
      }
    } catch (_) {}
    return stored;
  }

  function _currentAppearancePrefs() {
    try {
      if (window.rcAppearance && typeof window.rcAppearance.get === 'function') {
        return { appearance: window.rcAppearance.get() };
      }
    } catch (_) {}
    return {};
  }

  function _currentProfilePrefs() {
    try {
      if (window.rcPrefs && typeof window.rcPrefs.loadProfilePrefs === 'function') {
        return window.rcPrefs.loadProfilePrefs() || {};
      }
    } catch (_) {}
    return {};
  }

  function _normalizeBookId(bookId) {
    return String(bookId || '').trim();
  }

  function _normalizeChapterId(value) {
    if (value == null || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? String(num) : String(value);
  }

  function _collectSettingsRow() {
    const theme = _currentThemePrefs();
    const profile = _currentProfilePrefs();
    const themeSettings = (theme.theme_settings && typeof theme.theme_settings === 'object') ? theme.theme_settings : {};
    const voiceVolumeEl = document.getElementById('vol_voice');
    const autoplayToggle = document.getElementById('autoplayToggle');
    const selectedVoice = (() => {
      try { return String(window.__rcSessionVoiceSelection || '').trim(); } catch (_) { return ''; }
    })();
    const _isCloudVoice = /^(cloud:|azure:|polly:)/i.test(selectedVoice);
    const _cloudAllowed = !!(window.rcPolicy && typeof window.rcPolicy.get === 'function' && window.rcPolicy.get()?.features?.cloudVoices);
    const safeVoiceId = (_isCloudVoice && !_cloudAllowed) ? null : (selectedVoice || null);

    const row = {
      theme_id: String(theme.theme_id || 'default'),
      font_id: themeSettings.font ? String(themeSettings.font) : null,
      tts_voice_id: safeVoiceId,
      tts_volume: voiceVolumeEl && voiceVolumeEl.value !== '' ? Number(voiceVolumeEl.value) : null,
      autoplay_enabled: autoplayToggle ? !!autoplayToggle.checked : null,
      music_enabled: typeof themeSettings.music === 'string' ? themeSettings.music !== 'off' : (_remoteSettingsRow && typeof _remoteSettingsRow.music_enabled === 'boolean' ? !!_remoteSettingsRow.music_enabled : true),
      particles_enabled: typeof themeSettings.embersOn === 'boolean' ? !!themeSettings.embersOn : (_remoteSettingsRow && typeof _remoteSettingsRow.particles_enabled === 'boolean' ? !!_remoteSettingsRow.particles_enabled : true),
      daily_goal_minutes: Number.isFinite(Number(profile.dailyGoalMinutes)) ? Math.max(5, Math.min(300, Math.round(Number(profile.dailyGoalMinutes)))) : (_remoteSettingsRow && Number.isFinite(Number(_remoteSettingsRow.daily_goal_minutes)) ? Math.max(5, Math.min(300, Math.round(Number(_remoteSettingsRow.daily_goal_minutes)))) : 15),
      updated_at: new Date().toISOString(),
    };

    Object.keys(row).forEach((key) => {
      if (row[key] === undefined) delete row[key];
    });
    return row;
  }

  function _deriveRemoteProfileMetrics() {
    const profile = _currentProfilePrefs();
    const goal = _remoteSettingsRow && Number.isFinite(Number(_remoteSettingsRow.daily_goal_minutes))
      ? Math.max(5, Math.min(300, Math.round(Number(_remoteSettingsRow.daily_goal_minutes))))
      : Math.max(5, Math.min(300, Math.round(Number(profile.dailyGoalMinutes || 15))));
    const today = (window.rcReadingMetrics && typeof window.rcReadingMetrics.getTodayIsoDate === 'function')
      ? window.rcReadingMetrics.getTodayIsoDate()
      : new Date().toISOString().slice(0, 10);
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - (6 * 24 * 60 * 60 * 1000));
    const weekStartIso = sevenDaysAgo.toISOString().slice(0, 10);
    let dailyMinutes = 0;
    let weeklyMinutes = 0;
    let sessionsCompleted = 0;
    (_remoteDailyStatsRows || []).forEach((entry) => {
      const statDate = String(entry?.stat_date || '');
      const minutes = Math.max(0, Math.round(Number(entry?.minutes_read || 0)));
      const count = Math.max(0, Math.round(Number(entry?.sessions_count || 0)));
      if (statDate === today) dailyMinutes += minutes;
      if (statDate && statDate >= weekStartIso) weeklyMinutes += minutes;
      sessionsCompleted += count;
    });
    const displayDailyMinutes = Math.max(0, Math.min(dailyMinutes, goal));
    _remoteProfileMetrics = {
      dailyGoalMinutes: goal,
      dailyMinutes,
      displayDailyMinutes,
      weeklyMinutes,
      sessionsCompleted,
      progressPct: goal > 0 ? Math.max(0, Math.min(100, Math.round((dailyMinutes / goal) * 100))) : 0,
      remainingGoalMinutes: Math.max(0, goal - dailyMinutes),
      lastGoalCelebratedOn: String(profile.lastGoalCelebratedOn || ''),
      todayIso: today,
    };
    return _remoteProfileMetrics;
  }

  function _applyRemoteSettingsRow(row) {
    if (!row || typeof row !== 'object') return;
    _remoteSettingsRow = row;
    _applyingRemoteSettings = true;
    try {
      const localTheme = _currentThemePrefs();
      const nextTheme = Object.assign({}, localTheme || {});
      if (row.theme_id) nextTheme.theme_id = String(row.theme_id);
      nextTheme.theme_settings = Object.assign({}, nextTheme.theme_settings || {});
      if (row.font_id) nextTheme.theme_settings.font = String(row.font_id);
      if (typeof row.music_enabled === 'boolean' && !row.music_enabled) nextTheme.theme_settings.music = 'off';
      if (typeof row.particles_enabled === 'boolean') nextTheme.theme_settings.embersOn = !!row.particles_enabled;
      _writeLocalJson(RC_THEME_PREFS_KEY, nextTheme);
      try { if (window.rcTheme && typeof window.rcTheme.load === 'function') window.rcTheme.load(); } catch (_) {}


      if (row.daily_goal_minutes != null) {
        try {
          if (window.rcPrefs && typeof window.rcPrefs.saveProfilePrefs === 'function') {
            window.rcPrefs.saveProfilePrefs({ dailyGoalMinutes: Number(row.daily_goal_minutes) });
          }
        } catch (_) {}
      }



      if (row.tts_voice_id) {
        const _voiceId = String(row.tts_voice_id).trim();
        const _isCloudId = /^(cloud:|azure:|polly:)/i.test(_voiceId);
        const _cloudAllowed = !!(window.rcPolicy && typeof window.rcPolicy.get === 'function' && window.rcPolicy.get()?.features?.cloudVoices);
        if (_voiceId && (!_isCloudId || _cloudAllowed)) {
          try { window.__rcSessionVoiceSelection = _voiceId; } catch (_) {}
          const female = document.getElementById('voiceFemaleSelect');
          const male = document.getElementById('voiceMaleSelect');
          [female, male].forEach((select) => {
            if (!select) return;
            const exists = Array.from(select.options || []).some((opt) => String(opt.value) === _voiceId);
            if (exists) select.value = _voiceId;
          });
        }
      }

      if (row.tts_volume != null) {
        const voiceVolumeEl = document.getElementById('vol_voice');
        if (voiceVolumeEl) {
          voiceVolumeEl.value = String(row.tts_volume);
          try { voiceVolumeEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
        }
      }

      if (typeof row.autoplay_enabled === 'boolean') {
        if (window.applyAutoplayRuntimePreference && typeof window.applyAutoplayRuntimePreference === 'function') {
          try { window.applyAutoplayRuntimePreference(!!row.autoplay_enabled, { source: 'durable-settings-sync' }); } catch (_) {}
        } else {
          const autoplayToggle = document.getElementById('autoplayToggle');
          if (autoplayToggle) autoplayToggle.checked = !!row.autoplay_enabled;
          try { localStorage.setItem('rc_autoplay', row.autoplay_enabled ? '1' : '0'); } catch (_) {}
        }
      }
    } finally {
      _applyingRemoteSettings = false;
    }
    _deriveRemoteProfileMetrics();
  }

  // Bulk-apply a server snapshot to all in-memory state. Rejects stale responses
  // via seq ordering. Persists to localStorage as last-confirmed projection.
  function _applySnapshot(snapshot, options = {}) {
    if (!_ready()) {
      _clearPendingRuntimePolicyProjection('snapshot-blocked-public');
      _resetPolicyToPublic('sync-snapshot-blocked-public');
      _pushEvent('snapshot-apply-blocked-public', { fromCache: !!options.fromCache, seq: Number(options.seq || 0) });
      return false;
    }
    const seq = Number(options.seq || 0);
    if (seq && seq < _appliedSeq) return false;
    if (seq) _appliedSeq = seq;
    const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
    _remoteUsersRow = snap.usersRow || null;
    _remoteSettingsRow = snap.settingsRow || null;
    _remoteLibraryItems = Array.isArray(snap.libraryItems) ? snap.libraryItems.slice() : [];
    _remoteProgressRows = Array.isArray(snap.progressRows) ? snap.progressRows.slice() : [];
    _remoteBookMetricsRows = Array.isArray(snap.bookMetricsRows) ? snap.bookMetricsRows.slice() : [];
    _remoteDailyStatsRows = Array.isArray(snap.dailyStatsRows) ? snap.dailyStatsRows.slice() : [];
    const sessionRows = snap.sessions && Array.isArray(snap.sessions.rows) ? snap.sessions.rows.slice() : [];
    _remoteSessions = sessionRows;
    _remoteUsageSummary = snap.usage || null;
    _remoteEntitlement = snap.entitlement || null;
    _hydrationState = { inFlight: false, users: true, settings: true, progress: true, sessions: true, usage: !!snap.usage };
    _lastSyncSnapshotAt = new Date().toISOString();
    // Track the server-confirmed settings row separately from the projected row.
    // _confirmedSettingsRow is the baseline for dirty-field diffing and is never
    // overwritten by optimistic projection — only by actual server ACKs.
    if (!options.fromCache && _remoteSettingsRow) _confirmedSettingsRow = _remoteSettingsRow;
    // Theme access can be policy-gated (Explorer). Apply the last-confirmed or
    // fresh server runtime policy projection before reloading persisted theme
    // settings so hydration does not downgrade a valid saved theme back to default
    // simply because the runtime policy has not been projected yet.
    if (snap.runtimePolicy && typeof snap.runtimePolicy === 'object') {
      const projectionOptions = Object.assign({}, options, { fromSnapshot: true });
      if (!_applyRuntimePolicyProjection(snap.runtimePolicy, projectionOptions)) {
        _stageRuntimePolicyProjection(snap.runtimePolicy, projectionOptions);
      }
    }
    if (_remoteSettingsRow) _applyRemoteSettingsRow(_remoteSettingsRow);
    else _deriveRemoteProfileMetrics();
    // Replay any dirty user mutations on top of the server-confirmed settings so
    // changes made before this snapshot (including across a page refresh) are
    // immediately visible and scheduled for server write.
    _replayDirtyOntoSettings();
    try {
      if (window.rcUsage && typeof window.rcUsage.applySnapshot === 'function' && snap.usage) {
        window.rcUsage.applySnapshot({
          remaining: snap.usage.remaining,
          limit: snap.usage.limit,
          authoritative: !!snap.usage.authoritative,
          source: options.fromCache ? 'server-cache' : 'server-sync',
        });
      }
    } catch (_) {}
    // runtimePolicy was already projected before settings hydration above so
    // policy-gated persisted settings (like Explorer theme) reload against the
    // same truth surface that produced the snapshot. The next fresh server snapshot
    // still wins if a cached projection was stale.
    // Persist as last-confirmed display projection (not restore authority).
    try {
      const u = _user();
      if (options.persist !== false && u && u.id) _writeDurableCache(u.id, snap);
    } catch (_) {}
    return true;
  }

  // Apply last-confirmed snapshot from localStorage for immediate display on refresh.
  // This is a projection ONLY — it paints the UI without blocking on the server.
  // It must NOT be used as a restore position source.
  function _applyCachedSnapshotForUser(userId) {
    const key = String(userId || 'unknown');
    _cachedSnapshotApplyCount[key] = (_cachedSnapshotApplyCount[key] || 0) + 1;
    _pushEvent('durable-cache-apply', { count: _cachedSnapshotApplyCount[key], hasUserId: !!userId });
    const cached = _readDurableCache(userId);
    if (!cached || !cached.snapshot) return false;
    const applied = _applySnapshot(cached.snapshot, { seq: 0, persist: false, fromCache: true });
    if (applied) {
      _recordSync('snapshot', 'cache', { cachedAt: cached.savedAt || null });
      _emitHydrated('cache');
    }
    return applied;
  }

  // Optimistic projection: write current local settings to _remoteSettingsRow
  // so the UI doesn't flash back to stale server values between saves.
  function _projectCurrentSettingsLocal() {
    if (!_ready()) return null;
    const u = _user();
    if (!u || !u.id) return null;
    const projected = Object.assign({}, _remoteSettingsRow || {}, { user_id: u.id }, _collectSettingsRow());
    _remoteSettingsRow = projected;
    _deriveRemoteProfileMetrics();
    _recordSync('settings', 'projected', { row: projected });
    _emitHydrated('settings-projected');
    return projected;
  }

  // Generic server fetch against /api/app?kind=durable-sync.
  // Returns { seq, data } where seq is a monotonic counter for stale-rejection.
  async function _serverSync(scope = 'snapshot', init = {}) {
    const token = _accessToken();
    if (!token) throw new Error('Missing auth token.');
    const method = String(init.method || 'GET').toUpperCase();
    const url = new URL('/api/app', window.location.origin);
    url.searchParams.set('kind', 'durable-sync');
    url.searchParams.set('scope', String(scope || 'snapshot'));
    if (init.params && typeof init.params === 'object') {
      Object.entries(init.params).forEach(([key, value]) => {
        if (value == null || value === '') return;
        url.searchParams.set(String(key), String(value));
      });
    }
    const seq = ++_requestSeq;
    const resp = await fetch(url.toString(), {
      method,
      cache: 'no-store',
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(typeof init.body !== 'undefined' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: typeof init.body !== 'undefined' ? JSON.stringify(init.body) : undefined,
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data || data.ok === false) {
      throw new Error(String((data && (data.error || data.reason)) || `Durable sync ${resp.status}`));
    }
    return { seq, data };
  }

  // ── Sign-in bootstrap ─────────────────────────────────────────────────────
  // 1. Paint cached snapshot immediately (display projection only)
  // 2. POST sync_user → returns full snapshot → apply
  // 3. If settingsRow === null (confirmed empty), seed from local
  async function _onSignIn() {
    const u = _user();
    _hydrationState = { inFlight: true, users: false, settings: false, progress: false, sessions: false, usage: false };
    if (u && u.id) _applyCachedSnapshotForUser(u.id);
    _recordSync('snapshot', 'pending', { reason: 'signin' });
    try {
      const { seq, data } = await _serverSync('snapshot', { method: 'POST', body: { action: 'sync_user', payload: {} } });
      if (data && data.snapshot) {
        _applySnapshot(data.snapshot, { seq, persist: true });
        // Seed settings only when server explicitly confirmed no settings row.
        if (data.snapshot.settingsRow === null) {
          await syncSettings().catch(() => {});
        }
      }
      _recordSync('snapshot', 'success', { reason: 'signin', snapshotAt: _lastSyncSnapshotAt });
      _emitHydrated('signin');
    } catch (error) {
      _hydrationState.inFlight = false;
      _recordSync('snapshot', 'error', { reason: 'signin', message: String(error?.message || error || 'signin hydration failed') });
    }
  }

  // ── Settings sync ─────────────────────────────────────────────────────────
  async function syncSettings() {
    if (!_ready()) return null;
    // Snapshot which dirty keys are being sent in this request so we can clear
    // only those on success. New mutations that arrive during the network roundtrip
    // stay dirty and will be included in the next sync cycle.
    const syncingKeys = new Set(Object.keys(_dirtySettings));
    const dirtyValues = Object.fromEntries([...syncingKeys].map(k => [k, _dirtySettings[k].value]));
    // Payload: full collected row merged with dirty values (dirty wins).
    // This sends authoritative user intent rather than blindly resending cached values.
    const payload = Object.assign(_collectSettingsRow(), dirtyValues);
    _pushEvent('settings-sync-start', { theme_id: payload.theme_id, dirtyKeys: [...syncingKeys] });
    _projectCurrentSettingsLocal();
    _recordSync('settings', 'pending', { payload, dirtyFields: [...syncingKeys] });
    try {
      const { seq, data } = await _serverSync('snapshot', { method: 'POST', body: { action: 'sync_settings', payload } });
      // Clear only the dirty keys that were included in this request.
      syncingKeys.forEach(k => delete _dirtySettings[k]);
      _saveDirtySettings();
      if (data && data.snapshot) _applySnapshot(data.snapshot, { seq, persist: true });
      // Update confirmed baseline to whatever the server just settled.
      if (_remoteSettingsRow) _confirmedSettingsRow = _remoteSettingsRow;
      _pushEvent('settings-sync-ok', { theme_id: _remoteSettingsRow?.theme_id });
      _recordSync('settings', 'success', { row: data && data.row ? data.row : null, snapshotAt: _lastSyncSnapshotAt });
      try { window.rcInteraction && window.rcInteraction.clear('settings:sync'); } catch (_) {}
      _emitHydrated('settings');
      return data && data.row ? data.row : null;
    } catch (error) {
      _recordSync('settings', 'error', { message: String(error?.message || error || 'settings sync failed') });
      try {
        if (window.rcInteraction && syncingKeys.size > 0) {
          const actions = window.rcInteraction.actions
            ? [window.rcInteraction.actions.retry(() => { try { syncSettings().catch(() => {}); } catch (_) {} })]
            : [];
          window.rcInteraction.error('settings:sync', 'Your changes weren\'t saved yet.', { actions });
        }
      } catch (_) {}
      // Do NOT snap back. The dirty set preserves user intent and will be retried.
      // Snapping back on transient server errors (503, network timeout) violates the
      // runtime contract: "no setting that changes and then snaps back for no reason."
      // The optimistic projection stays in place until the server confirms or the user
      // changes the setting again.
      _queueSettingsSync(); // schedule a retry with dirty set intact
      return null;
    }
  }

  async function getSettings() {
    if (_remoteSettingsRow) return _remoteSettingsRow;
    if (!_ready()) return null;
    try {
      const { seq, data } = await _serverSync('snapshot');
      if (data && data.snapshot) _applySnapshot(data.snapshot, { seq, persist: true });
      return _remoteSettingsRow;
    } catch (error) {
      _recordSync('settings', 'error', { message: String(error?.message || error || 'settings fetch failed') });
      return null;
    }
  }

  // ── User row sync ─────────────────────────────────────────────────────────
  async function _syncUserRow() {
    if (!_ready()) return null;
    _recordSync('users', 'pending');
    try {
      const { seq, data } = await _serverSync('snapshot', { method: 'POST', body: { action: 'sync_user', payload: {} } });
      if (data && data.snapshot) _applySnapshot(data.snapshot, { seq, persist: true });
      _recordSync('users', 'success', { row: data && data.row ? data.row : null });
      return data && data.row ? data.row : null;
    } catch (error) {
      _recordSync('users', 'error', { message: String(error?.message || error || 'user sync failed') });
      return null;
    }
  }

  function _inferLibrarySourceKind(bookId) {
    const raw = String(bookId || '').trim();
    if (/^local:text-/i.test(raw)) return 'pasted_text';
    if (/^local:/i.test(raw)) return 'upload_file';
    return 'embedded_book';
  }

  function _inferLibraryStorageKind(bookId) {
    return /^local:/i.test(String(bookId || '').trim()) ? 'device_local' : 'embedded';
  }

  async function _collectLibraryItemMeta(bookId, pageCountHint) {
    const normalizedBookId = _normalizeBookId(bookId);
    if (!normalizedBookId) return null;
    const meta = {
      storage_ref: normalizedBookId,
      source_kind: _inferLibrarySourceKind(normalizedBookId),
      storage_kind: _inferLibraryStorageKind(normalizedBookId),
      import_kind: /^local:text-/i.test(normalizedBookId) ? 'text' : (/^local:/i.test(normalizedBookId) ? 'epub' : 'embedded'),
      page_count: Math.max(0, Number(pageCountHint) || 0),
    };
    if (!/^local:/i.test(normalizedBookId)) return meta;
    try {
      if (typeof window.__rcLocalBookGet !== 'function') return meta;
      const localId = normalizedBookId.replace(/^local:/i, '');
      const record = await window.__rcLocalBookGet(localId);
      if (!record) return meta;
      meta.title = String(record.title || '').trim() || meta.title || 'Book';
      meta.source_name = String(record.sourceName || '').trim() || null;
      meta.content_fingerprint = String(record.contentFingerprint || '').trim() || null;
      meta.import_kind = String(record.importKind || meta.import_kind || '').trim() || meta.import_kind;
      meta.byte_size = Math.max(0, Number(record.byteSize) || 0);
      const storedPageCount = Math.max(0, Number(record.pageCount) || 0);
      if (storedPageCount > 0) meta.page_count = storedPageCount;
      else if (!(meta.page_count > 0)) {
        if (window.rcLibraryData && typeof window.rcLibraryData.countPagesFromMarkdown === 'function') {
          meta.page_count = Math.max(0, Number(window.rcLibraryData.countPagesFromMarkdown(record.markdown || '')) || 0);
        }
      }
      return meta;
    } catch (_) {
      return meta;
    }
  }

  // ── Progress identity ─────────────────────────────────────────────────────
  function _collectProgressIdentity(bookId, chapterIndex) {
    const target = window.__rcReadingTarget || {};
    const normalizedBookId = _normalizeBookId(bookId || target.bookId || target.sourceId || '');
    const sourceType = String(target.sourceType || 'book');
    const sourceId = String(target.bookId || normalizedBookId || '');
    const chapterId = Number.isFinite(Number(chapterIndex)) ? String(Number(chapterIndex)) : (target.chapterIndex != null ? String(target.chapterIndex) : null);
    const pageCount = document.querySelectorAll('.page').length || null;
    return {
      book_id: normalizedBookId,
      source_type: sourceType,
      source_id: sourceId,
      chapter_id: chapterId,
      page_count: pageCount,
      is_active: true,
      session_version: 1,
    };
  }

  function _findCachedProgressRow(bookId, chapterIndex) {
    const normalizedBookId = _normalizeBookId(bookId);
    const normalizedChapterId = _normalizeChapterId(chapterIndex);
    if (!normalizedBookId) return null;
    let best = null;
    for (const row of _remoteProgressRows) {
      if (_normalizeBookId(row.book_id) !== normalizedBookId) continue;
      if (normalizedChapterId != null && _normalizeChapterId(row.chapter_id) !== normalizedChapterId) continue;
      if (!best) { best = row; continue; }
      const currentTime = Date.parse(best.updated_at || best.last_read_at || 0) || 0;
      const rowTime = Date.parse(row.updated_at || row.last_read_at || 0) || 0;
      if (rowTime > currentTime) best = row;
    }
    return best;
  }

  function _findLatestCachedBookProgress(bookId) {
    return _findCachedProgressRow(bookId, null);
  }

  // ── Progress write ────────────────────────────────────────────────────────
  function scheduleProgressSync(bookId, chapterIndex, pageIndex, meta = {}) {
    if (!_ready()) return;
    if (_progressTimer) clearTimeout(_progressTimer);
    _progressTimer = setTimeout(() => {
      _progressTimer = null;
      _writeProgress(bookId, chapterIndex, pageIndex, meta).catch(() => {});
    }, 450);
  }

  async function _writeProgress(bookId, chapterIndex, pageIndex, meta = {}) {
    const u = _user();
    if (!_ready() || !u) return null;
    const identity = _collectProgressIdentity(bookId, chapterIndex);
    const itemMeta = await _collectLibraryItemMeta(identity.book_id, identity.page_count);
    const payload = Object.assign({}, identity, itemMeta || {}, {
      last_page_index: Number.isFinite(Number(pageIndex)) && Number(pageIndex) >= 0 ? Number(pageIndex) : 0,
      last_read_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    _recordSync('progress', 'pending', { payload, reason: String(meta.reason || 'write') });
    try {
      const { seq, data } = await _serverSync('snapshot', { method: 'POST', body: { action: 'write_progress', payload } });
      if (data && data.snapshot) _applySnapshot(data.snapshot, { seq, persist: true });
      const row = data && data.row ? data.row : payload;
      _recordSync('progress', 'success', { row, reason: String(meta.reason || 'write') });
      _emitHydrated('progress');
      return row;
    } catch (error) {
      _recordSync('progress', 'error', { message: String(error?.message || error || 'progress write failed'), payload, reason: String(meta.reason || 'write') });
      return null;
    }
  }

  // Flush any pending debounced progress write immediately.
  async function saveProgressNow(bookId, chapterIndex, pageIndex, meta = {}) {
    if (_progressTimer) {
      clearTimeout(_progressTimer);
      _progressTimer = null;
    }
    return _writeProgress(bookId, chapterIndex, pageIndex, meta);
  }

  // Flush progress for the current __rcReadingTarget before switching books.
  async function flushProgressSync() {
    if (_progressTimer) {
      clearTimeout(_progressTimer);
      _progressTimer = null;
    }
    const target = window.__rcReadingTarget || {};
    if (!target || !target.bookId) return null;
    return _writeProgress(target.bookId, target.chapterIndex, target.pageIndex, { reason: 'flush-current-target' });
  }

  // ── Progress reads ────────────────────────────────────────────────────────
  async function getReadingProgress(bookId, chapterIndex) {
    const cached = _findCachedProgressRow(bookId, chapterIndex);
    if (cached) {
      const idx = Number(cached.last_page_index);
      return Number.isFinite(idx) && idx >= 0 ? { pageIndex: idx, updatedAt: cached.updated_at || cached.last_read_at || null } : null;
    }
    const identity = _collectProgressIdentity(bookId, chapterIndex);
    const existing = _findCachedProgressRow(identity.book_id, identity.chapter_id != null ? identity.chapter_id : null);
    if (!existing) return null;
    const idx = Number(existing.last_page_index);
    return Number.isFinite(idx) && idx >= 0 ? { pageIndex: idx, updatedAt: existing.updated_at || existing.last_read_at || null } : null;
  }

  // Restore: trust in-memory cache only if _hydrationState.progress === true
  // (meaning server confirmed this session). Otherwise always fetch the server.
  // localStorage cache is NEVER used as restore source.
  async function getRestoreProgress(bookId) {
    const normalizedBookId = _normalizeBookId(bookId);
    if (!normalizedBookId || !_ready()) return null;

    // Cache hit only when server has confirmed progress this session.
    if (_hydrationState.progress === true) {
      const cached = _findLatestCachedBookProgress(normalizedBookId);
      if (cached) {
        const idx = Number(cached.last_page_index);
        if (Number.isFinite(idx) && idx >= 0) {
          const result = {
            pageIndex: idx,
            chapterIndex: _normalizeChapterId(cached.chapter_id) != null ? Number(cached.chapter_id) : null,
            updatedAt: cached.updated_at || cached.last_read_at || null,
          };
          _recordSync('restore', 'cache-hit', { bookId: normalizedBookId, result });
          return result;
        }
      }
    }

    // Always fetch server for restore when cache is not confirmed.
    _recordSync('restore', 'pending', { bookId: normalizedBookId });
    try {
      const { data } = await _serverSync('restore', { params: { book_id: normalizedBookId } });
      const row = data && data.row ? data.row : null;
      if (!row) {
        _recordSync('restore', 'empty', { bookId: normalizedBookId });
        return null;
      }
      // Merge fetched row into in-memory progress cache.
      _remoteProgressRows = [row, ...(_remoteProgressRows || []).filter((entry) => String(entry.id || '') !== String(row.id || ''))];
      try {
        const u = _user();
        if (u && u.id) {
          _writeDurableCache(u.id, {
            usersRow: _remoteUsersRow,
            settingsRow: _remoteSettingsRow,
            libraryItems: _remoteLibraryItems,
            progressRows: _remoteProgressRows,
            bookMetricsRows: _remoteBookMetricsRows,
            dailyStatsRows: _remoteDailyStatsRows,
            sessions: { rows: _remoteSessions, latest: _remoteSessions[0] || null, totalSessions: (_remoteSessions || []).length },
            usage: _remoteUsageSummary,
      resolvedUsage: _getResolvedUsageSummary(),
            entitlement: _remoteEntitlement,
          });
        }
      } catch (_) {}
      const idx = Number(row.last_page_index);
      if (!Number.isFinite(idx) || idx < 0) {
        _recordSync('restore', 'empty', { bookId: normalizedBookId });
        return null;
      }
      const result = {
        pageIndex: idx,
        chapterIndex: _normalizeChapterId(row.chapter_id) != null ? Number(row.chapter_id) : null,
        updatedAt: row.updated_at || row.last_read_at || null,
      };
      _recordSync('restore', 'success', { bookId: normalizedBookId, result });
      return result;
    } catch (error) {
      _recordSync('restore', 'error', { bookId: normalizedBookId, message: String(error?.message || error || 'restore lookup failed') });
      return null;
    }
  }

  // ── Session record ────────────────────────────────────────────────────────
  async function recordReadingSession(entry) {
    const u = _user();
    if (!_ready() || !u || !entry || !entry.bookId) return null;
    const target = window.__rcReadingTarget || {};
    const elapsedSeconds = Math.max(0, Math.round(Number(entry.elapsedSeconds || 0)));
    const itemMeta = await _collectLibraryItemMeta(String(entry.bookId || ''), target.pageCount || 0);
    const payload = Object.assign({}, itemMeta || {}, {
      pages_completed: Math.max(0, Math.round(Number(entry.pagesAdvanced || 0))),
      minutes_listened: Math.max(0, Math.round(elapsedSeconds / 60)),
      source_type: String(target.sourceType || 'book'),
      source_id: String(target.bookId || entry.bookId || ''),
      book_id: String(entry.bookId || ''),
      chapter_id: target.chapterIndex != null ? String(target.chapterIndex) : null,
      mode: typeof window.appMode === 'string' ? String(window.appMode) : 'reading',
      tts_seconds: 0,
      completed: !!entry.completed,
      started_at: entry.startedAt || new Date().toISOString(),
      ended_at: entry.endedAt || new Date().toISOString(),
      elapsed_seconds: elapsedSeconds,
    });
    _recordSync('sessions', 'pending', { payload });
    try {
      const { seq, data } = await _serverSync('snapshot', { method: 'POST', body: { action: 'record_session', payload } });
      if (data && data.snapshot) _applySnapshot(data.snapshot, { seq, persist: true });
      _recordSync('sessions', 'success', { row: data && data.row ? data.row : payload });
      _emitHydrated('sessions');
      return data && data.row ? data.row : payload;
    } catch (error) {
      _recordSync('sessions', 'error', { message: String(error?.message || error || 'session write failed'), payload });
      return null;
    }
  }

  // ── Profile metrics ───────────────────────────────────────────────────────
  function getRemoteReadingBookSummary(bookId, totalPagesHint) {
    if (!_ready()) return null;
    const row = _findLatestCachedBookProgress(bookId);
    const key = _normalizeBookId(bookId);
    const metric = (_remoteBookMetricsRows || []).find((entry) => _normalizeBookId(entry.book_id) === key) || null;
    if (!row && !metric) return null;
    const totalPages = Number.isFinite(Number(totalPagesHint)) && Number(totalPagesHint) > 0
      ? Number(totalPagesHint)
      : Math.max(0, Number((row && row.page_count) || (metric && metric.page_count) || 0));
    const lastPageIndex = Math.max(0, Number((row && row.last_page_index) || 0));
    const totalReadingSeconds = metric ? Math.max(0, Number(metric.minutes_read_total || 0) * 60) : 0;
    const completed = !!(metric && metric.completed_at) || (totalPages > 0 && lastPageIndex >= Math.max(0, totalPages - 1));
    return {
      bookId: key,
      totalPages,
      lastPageIndex,
      totalReadingSeconds,
      lastOpenedAt: (metric && metric.last_opened_at) || (row && (row.last_read_at || row.updated_at)) || null,
      completed,
      completedAt: metric ? (metric.completed_at || null) : null,
    };
  }

  function getRemoteProfileMetrics() {
    return _ready() ? (_remoteProfileMetrics || _deriveRemoteProfileMetrics()) : null;
  }

  // ── State clearing ────────────────────────────────────────────────────────
  function _clearRemoteState() {
    _clearPendingRuntimePolicyProjection('clear-remote-state');
    _resetPolicyToPublic('sync-clear-remote-state');
    _remoteUsersRow = null;
    _remoteSettingsRow = null;
    _remoteLibraryItems = [];
    _remoteProgressRows = [];
    _remoteBookMetricsRows = [];
    _remoteDailyStatsRows = [];
    _remoteSessions = [];
    _remoteProfileMetrics = null;
    _remoteUsageSummary = null;
    _remoteEntitlement = null;
    _hydrationState = { inFlight: false, users: false, settings: false, progress: false, sessions: false, usage: false };
    _lastSyncSnapshotAt = null;
    _requestSeq = 0;
    _appliedSeq = 0;
    // Clear session tokens so a stale usage count from the previous session does not
    // leak into the next user's projection window. The usage pill is hidden when not
    // authed, so this does not create a visible blank state for the current user.
    // When the next user signs in, their cached or server-confirmed usage replaces this.
    try {
      if (window.rcUsage && typeof window.rcUsage.applySnapshot === 'function') {
        window.rcUsage.applySnapshot({ remaining: null, limit: null, authoritative: false, source: 'signout' });
      }
    } catch (_) {}
    try { window.__rcSessionVoiceSelection = ''; } catch (_) {}
  }

  async function rehydrateDurableData() {
    if (!_ready()) {
      _clearRemoteState();
      _emitHydrated('signout');
      return;
    }
    await _onSignIn();
  }

  // ── Settings queue ────────────────────────────────────────────────────────
  function _queueSettingsSync() {
    if (!_ready()) return;
    if (_prefsSyncTimer) clearTimeout(_prefsSyncTimer);
    _prefsSyncTimer = setTimeout(() => {
      _prefsSyncTimer = null;
      syncSettings().catch(() => {});
    }, 350);
  }

  // ── Event handlers ────────────────────────────────────────────────────────
  function _handleAuthChanged(e) {
    const { signedIn, source } = e.detail || {};
    _pushEvent('auth-changed', { signedIn: !!signedIn, source: source || 'unknown' });
    if (signedIn && source !== 'init-unconfigured' && source !== 'init-client-error') {
      const u = _user();
      _hydrationState = { inFlight: true, users: false, settings: false, progress: false, sessions: false, usage: false };
      if (u && u.id) _applyCachedSnapshotForUser(u.id);
      setTimeout(() => { _onSignIn().catch(() => {}); }, 0);
      return;
    }
    if (!signedIn) {
      _clearRemoteState();
      _emitHydrated('signout');
    }
  }

  function _handlePrefsChanged() {
    if (_applyingRemoteSettings) return;
    // Record dirty fields before projecting — diff against confirmed server truth,
    // not the projected row (_remoteSettingsRow would include previous projections).
    try {
      const collected = _collectSettingsRow();
      _pushEvent('prefs-changed', { theme_id: collected.theme_id, applyingRemote: false });
      _recordDirtyFields(collected);
    } catch (_) {}
    _projectCurrentSettingsLocal();
    _queueSettingsSync();
  }

  function _handleSettingsControlEvent(event) {
    if (_applyingRemoteSettings) return;
    const id = String(event?.target?.id || '').trim();
    if (!WATCHED_SETTING_IDS.has(id)) return;
    try { _recordDirtyFields(_collectSettingsRow()); } catch (_) {}
    _projectCurrentSettingsLocal();
    _queueSettingsSync();
  }

  function _createPublicBoundaryProbe() {
    let active = false;
    let startedAt = null;
    let snapshots = [];
    let autoTimer = null;
    let lastAutoSignature = '';

    function _devtoolsAllowed() {
      try {
        return !!(window.rcDevTools
          && typeof window.rcDevTools.isDiagnosticsEnabled === 'function'
          && window.rcDevTools.isDiagnosticsEnabled());
      } catch (_) {
        return false;
      }
    }

    function _assertCanUse(action) {
      if (active || _devtoolsAllowed()) return true;
      throw new Error(`${action || 'Public boundary probe'} requires an active devtools-enabled staging session. Sign in normally with the staging test account first; do not share credentials in chat.`);
    }

    function _isVisible(el) {
      if (!el) return false;
      try {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      } catch (_) {
        return false;
      }
    }

    function _visibleProBadgePresent() {
      const candidates = [
        document.getElementById('reading-tier-pill'),
        ...Array.from(document.querySelectorAll('[data-plan-badge], [data-tier-badge], .tier-pill, .plan-pill, .plan-badge, .tier-badge'))
      ].filter(Boolean);
      return candidates.some((el) => {
        const text = String(el.textContent || '').trim().toLowerCase();
        return _isVisible(el) && /\b(pro|premium)\b/.test(text);
      });
    }

    function _readSessionVoiceSelection() {
      let value = '';
      try { value = String(window.__rcSessionVoiceSelection || '').trim(); } catch (_) { value = ''; }
      return { present: !!value, type: /^(cloud:|azure:|polly:)/i.test(value) ? 'cloud' : (value ? 'browser' : 'none') };
    }

    function _readRuntimePolicy() {
      let policy = null;
      let diag = null;
      try { policy = window.rcPolicy && typeof window.rcPolicy.get === 'function' ? window.rcPolicy.get() : null; } catch (_) { policy = null; }
      try { diag = window.rcPolicy && typeof window.rcPolicy.getDiagnosticsSnapshot === 'function' ? window.rcPolicy.getDiagnosticsSnapshot() : null; } catch (_) { diag = null; }
      const sourcePolicy = (diag && diag.policy) || policy || {};
      return {
        raw: sourcePolicy,
        tier: String(sourcePolicy.tier || (diag && diag.tier) || 'unknown'),
        cloudVoiceCapability: !!(sourcePolicy.features && sourcePolicy.features.cloudVoices),
        explorerThemeCapability: !!(sourcePolicy.features && sourcePolicy.features.themes && sourcePolicy.features.themes.explorer),
        source: diag && diag.source ? String(diag.source) : 'unknown',
        reason: diag && diag.reason ? String(diag.reason) : '',
        resolved: !!(diag && diag.resolved),
        resolutionMode: diag && diag.resolutionMode ? String(diag.resolutionMode) : String(sourcePolicy.resolutionMode || ''),
      };
    }

    function _currentTtsRouteMode() {
      try {
        const tts = typeof window.getTtsDiagnosticsSnapshot === 'function' ? window.getTtsDiagnosticsSnapshot() : null;
        const routing = tts && tts.routing ? tts.routing : null;
        if (routing) {
          return {
            mode: routing.requestedPath || (routing.cloudCapable ? 'cloud-capable' : 'browser/public'),
            cloudCapable: !!routing.cloudCapable,
            reason: routing.reason || '',
            selectedType: routing.selected ? routing.selected.type || 'unknown' : 'unknown',
          };
        }
      } catch (_) {}
      const policy = _readRuntimePolicy();
      return {
        mode: policy.cloudVoiceCapability ? 'cloud-capable' : 'browser/public',
        cloudCapable: !!policy.cloudVoiceCapability,
        reason: 'derived-from-runtime-policy',
        selectedType: _readSessionVoiceSelection().present ? 'selected' : 'auto',
      };
    }

    function _buildSnapshot(label, trigger) {
      const user = _user();
      const policy = _readRuntimePolicy();
      const voice = _readSessionVoiceSelection();
      const projection = _getRuntimePolicyProjectionDiagnosticsSnapshot();
      const ttsRoute = _currentTtsRouteMode();
      const currentLabel = String(label || `snapshot-${snapshots.length + 1}`);
      const publicExpected = /signed-out|signout|public|basic/i.test(currentLabel);
      const signedInExpected = /signed-in|signin|pro|explorer|cloud/i.test(currentLabel) && !publicExpected;
      const checks = {
        signedInExpectedPass: signedInExpected ? (!!user && (policy.tier === 'pro' || policy.tier === 'premium') && policy.cloudVoiceCapability && policy.explorerThemeCapability) : null,
        signedOutExpectedPass: publicExpected ? (!user && policy.tier === 'basic' && !policy.cloudVoiceCapability && !policy.explorerThemeCapability && !voice.present && !projection.pendingPolicyProjectionPresent && !_visibleProBadgePresent()) : null,
      };
      return {
        index: snapshots.length + 1,
        label: currentLabel,
        trigger: String(trigger || 'manual'),
        at: new Date().toISOString(),
        userPresent: !!user,
        userIdPresent: !!(user && user.id),
        currentTier: policy.tier,
        cloudVoiceCapability: policy.cloudVoiceCapability,
        explorerThemeCapability: policy.explorerThemeCapability,
        runtimePolicy: {
          source: policy.source,
          reason: policy.reason,
          resolved: policy.resolved,
          resolutionMode: policy.resolutionMode,
        },
        sessionVoiceSelection: voice,
        pendingPolicyProjectionPresent: projection.pendingPolicyProjectionPresent,
        stagedSnapshotPolicyProjectionPresent: projection.stagedSnapshotPolicyProjectionPresent,
        visibleProBadgePresent: _visibleProBadgePresent(),
        ttsRoute,
        projectionDiagnostics: projection.lastProjection || null,
        checks,
      };
    }

    function _record(label, trigger) {
      const snapshot = _buildSnapshot(label, trigger);
      snapshots.push(snapshot);
      try { console.info('[rcPublicBoundaryProbe]', snapshot.label, snapshot); } catch (_) {}
      return snapshot;
    }

    function _signature(snapshot) {
      return JSON.stringify({
        userPresent: snapshot.userPresent,
        tier: snapshot.currentTier,
        cloud: snapshot.cloudVoiceCapability,
        explorer: snapshot.explorerThemeCapability,
        voice: snapshot.sessionVoiceSelection && snapshot.sessionVoiceSelection.present,
        pending: snapshot.pendingPolicyProjectionPresent,
        staged: snapshot.stagedSnapshotPolicyProjectionPresent,
        proBadge: snapshot.visibleProBadgePresent,
        ttsMode: snapshot.ttsRoute && snapshot.ttsRoute.mode,
      });
    }

    function _recordAuto(trigger) {
      if (!active) return;
      if (autoTimer) clearTimeout(autoTimer);
      autoTimer = setTimeout(() => {
        autoTimer = null;
        const snapshot = _buildSnapshot(`auto:${trigger}`, trigger);
        const sig = _signature(snapshot);
        if (sig === lastAutoSignature) return;
        lastAutoSignature = sig;
        snapshots.push(snapshot);
        try { console.info('[rcPublicBoundaryProbe]', snapshot.label, snapshot); } catch (_) {}
      }, 300);
    }

    function start(label = 'start') {
      _assertCanUse('Start public boundary probe');
      active = true;
      startedAt = new Date().toISOString();
      snapshots = [];
      lastAutoSignature = '';
      return _record(label, 'start');
    }

    function mark(label) {
      _assertCanUse('Mark public boundary probe');
      if (!active) start('implicit-start');
      return _record(label || `manual-${snapshots.length + 1}`, 'manual');
    }

    function reset() {
      _assertCanUse('Reset public boundary probe');
      active = false;
      startedAt = null;
      snapshots = [];
      lastAutoSignature = '';
      if (autoTimer) {
        clearTimeout(autoTimer);
        autoTimer = null;
      }
      return true;
    }

    function getReportObject() {
      return {
        probe: 'public-boundary-validation',
        version: 1,
        startedAt,
        generatedAt: new Date().toISOString(),
        active,
        expected: {
          cycleSignedIn: 'Pro/Explorer/cloud true',
          cycleSignedOut: 'Basic/public/cloud false/session voice cleared',
        },
        snapshots: snapshots.slice(),
      };
    }

    function report() {
      _assertCanUse('Read public boundary probe report');
      const text = JSON.stringify(getReportObject(), null, 2);
      try { console.log(text); } catch (_) {}
      return text;
    }

    async function copyReport() {
      const text = report();
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
      }
      return text;
    }

    try { document.addEventListener('rc:auth-changed', () => _recordAuto('auth-changed')); } catch (_) {}
    try { document.addEventListener('rc:runtime-policy-changed', () => _recordAuto('runtime-policy-changed')); } catch (_) {}
    try { document.addEventListener('rc:durable-data-hydrated', () => _recordAuto('durable-data-hydrated')); } catch (_) {}

    return { start, mark, report, copyReport, reset, getSnapshots: () => snapshots.slice(), isActive: () => !!active };
  }

  const _publicBoundaryProbe = _createPublicBoundaryProbe();
  try { window.rcPublicBoundaryProbe = _publicBoundaryProbe; } catch (_) {}

  try { document.addEventListener('rc:auth-changed', _handleAuthChanged); } catch (_) {}
  try { document.addEventListener('rc:prefs-changed', _handlePrefsChanged); } catch (_) {}
  try { document.addEventListener('change', _handleSettingsControlEvent, true); } catch (_) {}
  try { document.addEventListener('input', _handleSettingsControlEvent, true); } catch (_) {}

  return {
    scheduleProgressSync,
    saveProgressNow,
    flushProgressSync,
    getReadingProgress,
    getRestoreProgress,
    recordReadingSession,
    getRemoteReadingBookSummary,
    getRemoteProfileMetrics,
    syncSettings,
    getSettings,
    rehydrateDurableData,
    getRemoteUsersRow: () => _remoteUsersRow,
    getRemoteUsageSummary: () => _remoteUsageSummary,
    getResolvedUsageSummary: () => _getResolvedUsageSummary(),
    getHydrationState: () => ({ ..._hydrationState }),
    getRuntimePolicyProjectionDiagnostics: () => _getRuntimePolicyProjectionDiagnosticsSnapshot(),
    getDiagnosticsSnapshot: () => ({
      sync: { ..._syncDiagnostics },
      hydrated: { ..._hydrationState },
      snapshotAt: _lastSyncSnapshotAt,
      usersRow: _remoteUsersRow,
      settingsRow: _remoteSettingsRow,
      usage: _remoteUsageSummary,
      resolvedUsage: _getResolvedUsageSummary(),
      runtimePolicyProjection: _getRuntimePolicyProjectionDiagnosticsSnapshot(),
      publicBoundaryProbe: _publicBoundaryProbe && typeof _publicBoundaryProbe.getSnapshots === 'function' ? { active: _publicBoundaryProbe.isActive(), snapshots: _publicBoundaryProbe.getSnapshots() } : null,
      libraryItemCount: (_remoteLibraryItems || []).length,
      progressCount: (_remoteProgressRows || []).length,
      bookMetricsCount: (_remoteBookMetricsRows || []).length,
      dailyStatCount: (_remoteDailyStatsRows || []).length,
      sessionCount: (_remoteSessions || []).length,
      eventTrail: Array.isArray(window.__rcEventTrail) ? window.__rcEventTrail.slice() : [],
    }),
    deleteLibraryItem: async (bookId, options = {}) => {
      if (!_ready()) return null;
      const payload = { book_id: _normalizeBookId(bookId), purge: !!options.purge };
      const { seq, data } = await _serverSync('snapshot', { method: 'POST', body: { action: 'delete_library_item', payload } });
      if (data && data.snapshot) _applySnapshot(data.snapshot, { seq, persist: true });
      return data && data.row ? data.row : null;
    },
    restoreLibraryItem: async (bookId) => {
      if (!_ready()) return null;
      const payload = { book_id: _normalizeBookId(bookId) };
      const { seq, data } = await _serverSync('snapshot', { method: 'POST', body: { action: 'restore_library_item', payload } });
      if (data && data.snapshot) _applySnapshot(data.snapshot, { seq, persist: true });
      return data && data.row ? data.row : null;
    },
  };
})();
