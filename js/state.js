// Split from original app.js during role-based phase-1 restructure.
// File: state.js
// Note: This is still global-script architecture (no bundler/modules required).

function _trailPush(tag, data) {
  try {
    if (!Array.isArray(window.__rcEventTrail)) window.__rcEventTrail = [];
    window.__rcEventTrail.push({ t: new Date().toISOString(), tag, ...data });
    if (window.__rcEventTrail.length > 40) window.__rcEventTrail.shift();
    if (typeof window.updateDiagnostics === 'function') window.updateDiagnostics();
  } catch (_) {}
}

// ===================================
  // READING COMPREHENSION APP
  // ===================================
  
  // ===================================
  // APPLICATION STATE
  // ===================================
  
  const TIERS = [
    { min: TIER_MASTERFUL, name: 'Masterful', emoji: '🏛️' },
    { min: TIER_PROFICIENT, name: 'Proficient', emoji: '📜' },
    { min: TIER_COMPETENT, name: 'Competent', emoji: '📚' },
    { min: TIER_DEVELOPING, name: 'Developing', emoji: '🌱' },
    { min: 0, name: 'Fragmented', emoji: '🧩' }
  ];
  
  let pages = [];
  let pageData = [];
  let pageMeta = [];
  let currentPageIndex = 0;
  window.__rcPendingRestorePageIndex = -1;

// ─── Runtime reading target ───────────────────────────────────────────────────
// One authoritative object that all TTS entry paths must read.
// Never inferred from DOM or focus state. Set only via setReadingTarget().
//
//   sourceType:   importSource select value ('book' | 'text' | …)
//   bookId:       bookSelect value ('local:foo' | embedded ID | '' for text mode)
//   chapterIndex: chapter index within book; -1 if no chapters or text mode
//   pageIndex:    0-based index into currently loaded pages[]
//
// Chapter A page 0 and chapter B page 0 of the same book are distinct targets.
window.__rcReadingTarget = { sourceType: '', bookId: '', chapterIndex: -1, pageIndex: 0 };
  
  // Launch scope: reading remains the only user-facing mode.
  let appMode = 'reading';   // default mode
  let thesisText = ''; // research mode input — coming soon

  // Current resolved runtime tier: 'basic', 'pro', 'premium'.
  // Legacy aliases like 'free' / 'paid' are normalized at the policy seam.
  let appTier = 'basic';
  let runtimePolicy = null;
  let runtimePolicyResolved = false;

  // ---- Token Tracking ----
  // Session token counter. Counts consumption per category for diagnostic purposes.
  // Usage does not enforce limits client-side; it is display/diagnostics only.
  // Resets when tier changes.
  //
  // Usage cost per protected backend action.
  // Display/diagnostics only on the client — the server remains the authority.
  const TOKEN_COSTS = {
    tts: 2,
    evaluate: 2,
    anchors: 2,
    research: 2,
    ai: 2,
    summary: 2,
    book_import: 2,
    import: 2,
    other_protected_backend_action: 2,
  };

  const SAFE_FALLBACK_POLICY = Object.freeze({
    version: 1,
    tier: 'basic',
    simulationAllowed: false,
    usageDailyLimit: 100,
    importSlotLimit: 2,
    features: Object.freeze({
      modes: Object.freeze({
        reading: true,
        comprehension: false,
        research: false,
      }),
      aiEvaluate: false,
      anchors: false,
      cloudVoices: false,
      themes: Object.freeze({
        explorer: false,
        customMusic: false,
      }),
    }),
  });


  function normalizeAppTier(value, fallback = 'basic') {
    const tier = String(value || '').trim().toLowerCase();
    if (tier === 'free') return 'basic';
    if (tier === 'paid') return 'pro';
    return ['basic', 'pro', 'premium'].includes(tier) ? tier : fallback;
  }

  function getFallbackRuntimePolicy(tierInput) {
    // PASS3: Fallback is always the minimum safe basic-tier policy.
    // tierInput is accepted for callers that pass a hint, but it NEVER elevates
    // features above basic-tier when the server is unreachable.
    // simulationAllowed is never granted from client-side host inference:
    //   - it was previously set from canSimulateTierOnCurrentHost(), which let the
    //     client grant itself simulation capability when the server was down.
    //   - now it is always false; simulation capability comes from the server only.
    const tier = normalizeAppTier(tierInput, 'basic');
    return {
      version: SAFE_FALLBACK_POLICY.version,
      tier,
      simulationAllowed: false,
      resolutionMode: 'client-fallback',
      usageDailyLimit: SAFE_FALLBACK_POLICY.usageDailyLimit,
      importSlotLimit: SAFE_FALLBACK_POLICY.importSlotLimit,
      features: {
        modes: {
          reading: true,
          comprehension: SAFE_FALLBACK_POLICY.features.modes.comprehension,
          research: SAFE_FALLBACK_POLICY.features.modes.research,
        },
        aiEvaluate: SAFE_FALLBACK_POLICY.features.aiEvaluate,
        anchors: SAFE_FALLBACK_POLICY.features.anchors,
        cloudVoices: SAFE_FALLBACK_POLICY.features.cloudVoices,
        themes: {
          explorer: SAFE_FALLBACK_POLICY.features.themes.explorer,
          customMusic: SAFE_FALLBACK_POLICY.features.themes.customMusic,
        },
      },
    };
  }

  function normalizeRuntimePolicy(raw, tierHint) {
    const fallback = getFallbackRuntimePolicy(tierHint);
    const source = raw && typeof raw === 'object' ? raw : {};
    const tier = normalizeAppTier(source.tier || fallback.tier);
    const usageDailyLimit = Number(source.usageDailyLimit);
    const rawImportSlotLimit = source.importSlotLimit;
    const normalizedImportSlotLimit = rawImportSlotLimit == null
      ? null
      : Number(rawImportSlotLimit);
    const features = source.features && typeof source.features === 'object' ? source.features : {};
    const modes = features.modes && typeof features.modes === 'object' ? features.modes : {};
    const themes = features.themes && typeof features.themes === 'object' ? features.themes : {};

    return {
      version: Number(source.version) || fallback.version,
      tier,
      simulationAllowed: typeof source.simulationAllowed === 'boolean' ? source.simulationAllowed : fallback.simulationAllowed,
      // resolutionMode: consumed from server meta (passed in via applyResolvedRuntimePolicy).
      // 'production'    — server default tier, client request ignored.
      // 'simulation'    — preview/local only, client ?tier= honored.
      // 'client-fallback' — server unreachable, safe basic-tier only.
      resolutionMode: typeof source.resolutionMode === 'string' ? source.resolutionMode : (fallback.resolutionMode || 'client-fallback'),
      usageDailyLimit: Number.isFinite(usageDailyLimit) && usageDailyLimit > 0
        ? usageDailyLimit
        : fallback.usageDailyLimit,
      importSlotLimit: normalizedImportSlotLimit == null
        ? fallback.importSlotLimit
        : (Number.isFinite(normalizedImportSlotLimit) && normalizedImportSlotLimit > 0 ? Math.floor(normalizedImportSlotLimit) : fallback.importSlotLimit),
      features: {
        modes: {
          reading: true,
          comprehension: typeof modes.comprehension === 'boolean' ? modes.comprehension : fallback.features.modes.comprehension,
          research: typeof modes.research === 'boolean' ? modes.research : fallback.features.modes.research,
        },
        aiEvaluate: typeof features.aiEvaluate === 'boolean' ? features.aiEvaluate : fallback.features.aiEvaluate,
        anchors: typeof features.anchors === 'boolean' ? features.anchors : fallback.features.anchors,
        cloudVoices: typeof features.cloudVoices === 'boolean' ? features.cloudVoices : fallback.features.cloudVoices,
        themes: {
          explorer: typeof themes.explorer === 'boolean' ? themes.explorer : fallback.features.themes.explorer,
          customMusic: typeof themes.customMusic === 'boolean' ? themes.customMusic : fallback.features.themes.customMusic,
        },
      },
    };
  }

  function getRuntimePolicy() {
    if (runtimePolicy && typeof runtimePolicy === 'object') return runtimePolicy;
    runtimePolicy = getFallbackRuntimePolicy(appTier);
    runtimePolicyResolved = false;
    return runtimePolicy;
  }

  function isRuntimePolicyResolved() {
    return !!runtimePolicyResolved;
  }

  function getRuntimeUsageAllowance() {
    const limit = Number(getRuntimePolicy()?.usageDailyLimit);
    return Number.isFinite(limit) && limit > 0 ? limit : SAFE_FALLBACK_POLICY.usageDailyLimit;
  }


  function getRuntimeImportSlotLimit() {
    const limit = getRuntimePolicy()?.importSlotLimit;
    return limit == null ? null : (Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : null);
  }

  function hasRuntimeImportCapacity(currentCount) {
    const count = Number(currentCount);
    const normalizedCount = Number.isFinite(count) && count >= 0 ? count : 0;
    const limit = getRuntimeImportSlotLimit();
    return limit == null ? true : normalizedCount < limit;
  }

  function canUseMode(modeName) {
    const mode = String(modeName || '').trim().toLowerCase();
    if (mode === 'reading') return true;
    const policy = getRuntimePolicy();
    return !!policy?.features?.modes?.[mode];
  }

  function canUseAiEvaluate() {
    return !!getRuntimePolicy()?.features?.aiEvaluate;
  }

  function canUseAnchors() {
    return !!getRuntimePolicy()?.features?.anchors;
  }

  function canUseCloudVoices() {
    return !!getRuntimePolicy()?.features?.cloudVoices;
  }

  function applyResolvedRuntimePolicy(policyLike, tierHint, options = {}) {
    runtimePolicy = normalizeRuntimePolicy(policyLike, tierHint);
    runtimePolicyResolved = !!options.resolved;
    appTier = runtimePolicy.tier;
    try { tokenReset(); } catch (_) {}
    try { if (window.rcTheme && typeof window.rcTheme.enforceAccess === 'function') window.rcTheme.enforceAccess(); } catch (_) {}
    try {
      const detail = { policy: runtimePolicy, resolved: runtimePolicyResolved };
      document.dispatchEvent(new CustomEvent('rc:runtime-policy-changed', { detail }));
      window.dispatchEvent(new CustomEvent('rc:runtime-policy-changed', { detail }));
    } catch (_) {}
    return runtimePolicy;
  }

  async function refreshRuntimePolicy(requestedTier) {
    const hasExplicitTier = !(typeof requestedTier === 'undefined' || requestedTier === null || String(requestedTier).trim() === '');
    const tier = normalizeAppTier(hasExplicitTier ? requestedTier : getRuntimeTier());
    const endpoint = hasExplicitTier
      ? apiUrl(`/api/app?kind=runtime-config&tier=${encodeURIComponent(tier)}`)
      : apiUrl('/api/app?kind=runtime-config');
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { ...getAuthHeaders() },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`runtime-config ${response.status}`);
      const payload = await response.json();
      // Merge server meta.resolutionMode into the policy object before normalizing,
      // so normalizeRuntimePolicy can store it alongside capabilities.
      const policyWithMeta = payload?.policy
        ? { ...payload.policy, resolutionMode: payload?.meta?.resolutionMode }
        : payload;
      const resolvedTierHint = payload?.meta?.effectiveTier || tier;
      return applyResolvedRuntimePolicy(policyWithMeta, resolvedTierHint, { resolved: true });
    } catch (err) {
      // Server unreachable. If we already hold a confirmed non-basic policy (from a
      // prior successful fetch or durable-sync cache projection), preserve it — a
      // transient network failure must not strip access the user legitimately holds.
      // Only fall back to safe-basic when there is no confirmed policy in place.
      _trailPush('policy-fetch-failed', { tier: runtimePolicy && runtimePolicy.tier, reason: String(err?.message || err || 'unknown') });
      if (runtimePolicy && runtimePolicy.tier && runtimePolicy.tier !== 'basic') return runtimePolicy;
      return applyResolvedRuntimePolicy(getFallbackRuntimePolicy('basic'), 'basic', { resolved: false });
    }
  }

  let sessionTokens = {
    remaining: null,
    allowance: null,
    authoritative: false,
    source: 'unknown',
    spent: { tts: 0, evaluate: 0, anchors: 0, research: 0 },
  };

  function normalizeUsageValue(value) {
    if (value == null || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? Math.max(0, num) : null;
  }

  function tokenSpend(category) {
    const cost = TOKEN_COSTS[category] || 0;
    if (!cost) return;
    sessionTokens.spent[category] = (sessionTokens.spent[category] || 0) + cost;
    const remaining = normalizeUsageValue(sessionTokens.remaining);
    if (!sessionTokens.authoritative && remaining != null) {
      sessionTokens.remaining = Math.max(0, remaining - cost);
    }
  }

  function tokenReset() {
    sessionTokens = {
      remaining: null,
      allowance: null,
      authoritative: false,
      source: 'reset',
      spent: { tts: 0, evaluate: 0, anchors: 0, research: 0 },
    };
  }

// ---- Persistence strip (stabilization mode) ----
// Keys listed here are purged on every boot to prevent stale runtime state
// from contaminating tests or poisoning playback/routing/gating behavior.
//
// INTENTIONALLY NOT STRIPPED:
//   rc_autoplay   — user preference (toggle state), not runtime state.
//                   Stripping it would reset a visible user setting on every
//                   refresh, which is a UX regression. It is safe to persist
//                   because AUTOPLAY_STATE.enabled is always initialized from
//                   the checkbox in initAutoplayToggle() and never drives
//                   playback routing directly.
//   rc_app_mode   — user preference (reading / comprehension / research mode).
//   rc_thesis_text — user draft content.
//
// To stabilize autoplay during a test run, clear rc_autoplay manually or add
// it here temporarily — do not leave it in the strip list in production.
const RC_STRIPPED_PERSIST_KEYS = [
  "rc_tts_speed",
  "rc_browser_voice",
  "rc_app_tier"
];

function purgeStrippedRuntimePersistence() {
  try {
    RC_STRIPPED_PERSIST_KEYS.forEach((key) => {
      try { localStorage.removeItem(key); } catch (_) {}
      try { sessionStorage.removeItem(key); } catch (_) {}
    });
  } catch (_) {}
  try { window.__rcRuntimePersistenceStripped = true; } catch (_) {}
}

purgeStrippedRuntimePersistence();
window.purgeStrippedRuntimePersistence = purgeStrippedRuntimePersistence;

// ---- Persistence ----
// Persist learner work per-page-hash so switching chapters/sources doesn't wipe progress.
// Also persist the last-opened session so refresh restores the current view.
const STORAGE_KEY_SESSION = "rc_session_v2";
const STORAGE_KEY_META = "rc_session_meta_v2"; // small future-proof hook

function loadSessionMetaPayload() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_META) || "{}") || {};
  } catch (_) {
    return {};
  }
}

function saveSessionMetaPayload(payload) {
  const safe = (payload && typeof payload === "object") ? payload : {};
  try { localStorage.setItem(STORAGE_KEY_META, JSON.stringify(safe)); } catch (_) {}
  return safe;
}

function getConsolidationCacheKey(pageHash) {
  return `rc_consolidation_${pageHash}`;
}

function normalizePageMetaEntry(entry, idx) {
  const item = (entry && typeof entry === 'object') ? entry : {};
  const rawNum = Number(item.sourcePageNumber);
  const sourcePageNumber = Number.isFinite(rawNum) && rawNum > 0 ? Math.round(rawNum) : (idx + 1);
  const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : `Page ${sourcePageNumber}`;
  return { title, sourcePageNumber };
}

function setPageMeta(nextMeta) {
  pageMeta = Array.isArray(nextMeta) ? nextMeta.map((entry, idx) => normalizePageMetaEntry(entry, idx)) : [];
  return pageMeta;
}

function getPageMetaSnapshot() {
  return Array.isArray(pageMeta) ? pageMeta.map((entry, idx) => normalizePageMetaEntry(entry, idx)) : [];
}

function getPageMetaEntry(index) {
  const idx = Number(index);
  if (!Array.isArray(pageMeta) || !Number.isFinite(idx) || idx < 0 || idx >= pageMeta.length) return null;
  return normalizePageMetaEntry(pageMeta[idx], idx);
}

function usesSourcePageNumbers() {
  // Page numbering is fixed runtime behavior when source metadata exists.
  // Retired legacy prefs must not re-enter as a client-side gate.
  return true;
}

function getDisplayPageNumber(index) {
  const idx = Number(index);
  const meta = getPageMetaEntry(idx);
  if (meta && Number.isFinite(Number(meta.sourcePageNumber))) return Number(meta.sourcePageNumber);
  return idx + 1;
}

function getDisplayPageTotal(totalCount) {
  const total = Number(totalCount);
  if (!Number.isFinite(total) || total <= 0) return 0;
  const lastMeta = getPageMetaEntry(total - 1);
  if (lastMeta && Number.isFinite(Number(lastMeta.sourcePageNumber))) return Number(lastMeta.sourcePageNumber);
  return total;
}

function getDisplayPageLabel(index) {
  return `Page ${getDisplayPageNumber(index)}`;
}
window.setPageMeta = setPageMeta;
window.getPageMetaSnapshot = getPageMetaSnapshot;
window.getDisplayPageNumber = getDisplayPageNumber;
window.getDisplayPageTotal = getDisplayPageTotal;
window.getDisplayPageLabel = getDisplayPageLabel;


let _persistTimer = null;
function schedulePersistSession() {
  try {
    if (_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = setTimeout(() => {
      _persistTimer = null;
      persistSessionNow();
    }, 250);
  } catch (_) {}
}

function persistSessionNow() {
  try {
    for (const p of (pageData || [])) {
      const h = p?.pageHash;
      if (!h) continue;
      const record = {
        v: 2,
        savedAt: Date.now(),
        consolidation: p?.consolidation || "",
        rating: Number(p?.rating || 0) || 0,
        isSandstone: !!p?.isSandstone,
        aiExpanded: !!p?.aiExpanded,
        aiFeedbackRaw: typeof p?.aiFeedbackRaw === 'string' ? p.aiFeedbackRaw : "",
        aiAt: p?.aiAt ?? null,
        aiRating: p?.aiRating ?? null,
      };
      localStorage.setItem(getConsolidationCacheKey(h), JSON.stringify(record));
    }

    const payload = {
      v: 2,
      savedAt: Date.now(),
      pages: pages.slice(),
      pageHashes: pageData.map(p => p?.pageHash || ""),
      consolidations: pageData.map(p => p?.consolidation || ""),
      pageMeta: getPageMetaSnapshot()
    };
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(payload));
    const existingMeta = loadSessionMetaPayload();
    saveSessionMetaPayload({ ...existingMeta, savedAt: payload.savedAt });
    return true;
  } catch (e) {
    return false;
  }
}

function clearPersistedSession() {
  try { localStorage.removeItem(STORAGE_KEY_SESSION); } catch (_) {}
  try {
    const existingMeta = loadSessionMetaPayload();
    if (existingMeta && existingMeta.readingMetrics) saveSessionMetaPayload({ readingMetrics: existingMeta.readingMetrics, savedAt: Date.now() });
    else localStorage.removeItem(STORAGE_KEY_META);
  } catch (_) {}
}

function clearPersistedWorkForPageHashes(pageHashes, { clearAnchors = false } = {}) {
  const hashes = (pageHashes || []).filter(Boolean);
  for (const h of hashes) {
    try { localStorage.removeItem(getConsolidationCacheKey(h)); } catch (_) {}
    if (clearAnchors) {
      try { localStorage.removeItem(getAnchorCacheKey(h)); } catch (_) {}
    }
  }
}

function loadPersistedSessionIfAny() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SESSION);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 2) return false;
    if (!Array.isArray(parsed.pages)) return false;

    pages = parsed.pages;
    const incomingHashes = Array.isArray(parsed.pageHashes) ? parsed.pageHashes : [];
    const incomingConsolidations = Array.isArray(parsed.consolidations) ? parsed.consolidations : [];
    const incomingPageMeta = Array.isArray(parsed.pageMeta) ? parsed.pageMeta : [];

    setPageMeta(incomingPageMeta.length ? incomingPageMeta : pages.map((_, idx) => ({ title: `Page ${idx + 1}`, sourcePageNumber: idx + 1 })));

    pageData = pages.map((t, idx) => {
      const pageHash = incomingHashes[idx] || "";
      let consolidation = incomingConsolidations[idx] || "";
      let rating = 0;
      let isSandstone = false;
      let aiExpanded = false;
      let aiFeedbackRaw = "";
      let aiAt = null;
      let aiRating = null;
      if (pageHash) {
        try {
          const rawC = localStorage.getItem(getConsolidationCacheKey(pageHash));
          if (rawC) {
            const rec = JSON.parse(rawC);
            if (rec && typeof rec.consolidation === 'string') consolidation = rec.consolidation;
            const r = Number(rec?.rating || 0);
            rating = Number.isFinite(r) ? r : 0;
            isSandstone = !!rec?.isSandstone;
            aiExpanded = !!rec?.aiExpanded;
            aiFeedbackRaw = typeof rec?.aiFeedbackRaw === 'string' ? rec.aiFeedbackRaw : "";
            aiAt = rec?.aiAt ?? null;
            aiRating = rec?.aiRating ?? null;
          }
        } catch (_) {}
      }
      return {
        text: t,
        consolidation,
        aiExpanded,
        aiFeedbackRaw,
        aiAt,
        aiRating,
        charCount: (consolidation || "").length,
        completedOnTime: true,
        isSandstone,
        rating,
        pageHash,
        anchors: null,
        anchorVersion: 0,
        anchorsMeta: null
      };
    });

    if (pages.length !== pageData.length) {
      const n = Math.min(pages.length, pageData.length);
      pages = pages.slice(0, n);
      pageData = pageData.slice(0, n);
    }

    currentPageIndex = Math.min(currentPageIndex, Math.max(0, pages.length - 1));

    // PATCH(restore-path): Write the clamped restore index so applyPendingReadingRestore()
    // called at the end of render() can scroll to the correct page.
    // Without this write, __rcPendingRestorePageIndex stays at its boot value of -1
    // and restore silently falls through, always landing on page 0.
    if (pages.length > 0 && currentPageIndex >= 0) {
      window.__rcPendingRestorePageIndex = currentPageIndex;
    }

    return pages.length > 0;
  } catch (e) {
    return false;
  }
}


// If a saved session was written before page hashes were computed (e.g. user never generated anchors),
// the session snapshot may not include pageHashes. In that case, we compute them on boot and then
// rehydrate per-page persisted work (ratings / AI feedback / panel state) keyed by the hash.
async function ensurePageHashesAndRehydrate() {
  try {
    if (!Array.isArray(pages) || !Array.isArray(pageData) || !pages.length) return;
    let changed = false;

    for (let idx = 0; idx < pages.length; idx++) {
      const text = pages[idx] || "";
      const p = pageData[idx];
      if (!p) continue;

      if (!p.pageHash) {
        const h = await stableHashText(text);
        if (h) {
          p.pageHash = h;
          changed = true;
        }
      }

      const h = p.pageHash;
      if (!h) continue;

      try {
        const rawC = localStorage.getItem(getConsolidationCacheKey(h));
        if (rawC) {
          const rec = JSON.parse(rawC);
          if (rec && typeof rec.consolidation === 'string') p.consolidation = rec.consolidation;
          const r = Number(rec?.rating || 0);
          p.rating = Number.isFinite(r) ? r : 0;
          p.isSandstone = !!rec?.isSandstone;
          p.aiExpanded = !!rec?.aiExpanded;
          p.aiFeedbackRaw = typeof rec?.aiFeedbackRaw === 'string' ? rec.aiFeedbackRaw : "";
          p.aiAt = rec?.aiAt ?? null;
          p.aiRating = rec?.aiRating ?? null;
          p.charCount = (p.consolidation || "").length;
        }
      } catch (_) {}
    }

    if (changed) persistSessionNow();
  } catch (_) {}
}

// Stable-ish text hashing: must match the canonical pageHash used by anchors + cache keys.
// Do NOT whitespace-normalize here, or persisted per-page records (rc_consolidation_<hash>) won't rehydrate.
async function stableHashText(text) {
  return await sha256HexBrowser(String(text ?? ""));
}

 // Stores: { text, consolidation, charCount, completedOnTime, isSandstone, rating }
  let timers = [];
  let intervals = [];
  let lastFocusedPageIndex = -1; // for keyboard navigation

  function getReadingViewportBottomGap() {
    try {
      const doc = document.documentElement;
      const docBottom = Math.max(Number(doc?.scrollHeight || 0), Number(document.body?.scrollHeight || 0));
      const viewportBottom = Number(window.scrollY || 0) + Number(window.innerHeight || 0);
      if (!Number.isFinite(docBottom) || !Number.isFinite(viewportBottom)) return Infinity;
      return Math.max(0, docBottom - viewportBottom);
    } catch (_) {
      return Infinity;
    }
  }

  function isReadingViewportNearBottom(thresholdPx) {
    const dynamicThreshold = Math.max(24, Math.min(120, Math.round((Number(window.innerHeight || 0) || 0) * 0.08)));
    const threshold = Number.isFinite(Number(thresholdPx)) ? Number(thresholdPx) : dynamicThreshold;
    return getReadingViewportBottomGap() <= Math.max(0, threshold);
  }

  try { window.getReadingViewportBottomGap = getReadingViewportBottomGap; } catch (_) {}
  try { window.isReadingViewportNearBottom = isReadingViewportNearBottom; } catch (_) {}

  function inferCurrentPageIndex() {
    const pageEls = Array.from(document.querySelectorAll('.page'));
    if (!pageEls.length) return -1;

    try {
      if (isReadingViewportNearBottom()) {
        const lastPage = pageEls[pageEls.length - 1];
        const idx = parseInt(lastPage?.dataset?.pageIndex || String(pageEls.length - 1), 10);
        if (!Number.isNaN(idx)) return idx;
      }
    } catch (_) {}

    // 1) Active element within a page
    const active = document.activeElement;
    if (active) {
      const pageEl = active.closest?.(".page");
      if (pageEl?.dataset?.pageIndex) {
        const idx = parseInt(pageEl.dataset.pageIndex, 10);
        if (!Number.isNaN(idx)) return idx;
      }
    }

    // 2) Page closest to top of viewport
    let bestIdx = -1;
    let bestDist = Infinity;
    for (const el of pageEls) {
      const rect = el.getBoundingClientRect();
      const dist = Math.abs(rect.top);
      if (dist < bestDist) {
        bestDist = dist;
        const idx = parseInt(el.dataset.pageIndex || "-1", 10);
        if (!Number.isNaN(idx)) bestIdx = idx;
      }
    }
    return bestIdx;
  }

  // When true, the UI is in the "Evaluation" phase (compasses unlocked).
  // In this phase, the Next button should advance pages without focusing the textarea.
  let evaluationPhase = false;

  // Diagnostics (hidden panel): capture last AI request/response for bug-fixing
  let lastAIDiagnostics = null;

  let goalTime = DEFAULT_TIME_GOAL;
  let goalCharCount = DEFAULT_CHAR_GOAL;

  // -----------------------------------
  // Debug flag helper
  // -----------------------------------
  // Diagnostics/debug mode is enabled only when the authenticated user matches
  // DEV_CREDA on the server. This replaces the old public ?debug=1 path.
  function isDebugEnabledFromUrl() {
    try {
      return !!(window.rcDevTools && typeof window.rcDevTools.isDiagnosticsEnabled === 'function' && window.rcDevTools.isDiagnosticsEnabled());
    } catch (_) {
      return false;
    }
  }

  // -----------------------------------
  // Passage highlighting (first-class feature)
  // -----------------------------------
// ==============================
// TEXT TO SPEECH

// ─── Reading target helpers ────────────────────────────────────────────────────

// Only write path for window.__rcReadingTarget.
function setReadingTarget({ sourceType, bookId, chapterIndex, pageIndex }) {
  window.__rcReadingTarget = {
    sourceType:   String(sourceType   ?? ''),
    bookId:       String(bookId       ?? ''),
    chapterIndex: Number.isFinite(Number(chapterIndex)) ? Number(chapterIndex) : -1,
    pageIndex:    (Number.isFinite(Number(pageIndex)) && Number(pageIndex) >= 0) ? Number(pageIndex) : 0,
  };
}
window.setReadingTarget = setReadingTarget;

// Key shape: rt|sourceType|bookId|chapterIndex|pageIndex
// Used as TTS_STATE.activeKey / lastPageKey so all key-bearing state carries
// full source context, not just a bare page index.
function readingTargetToKey(target) {
  const t = target || window.__rcReadingTarget || {};
  return `rt|${t.sourceType ?? ''}|${t.bookId ?? ''}|${t.chapterIndex ?? -1}|${t.pageIndex ?? 0}`;
}
window.readingTargetToKey = readingTargetToKey;

// Reverse: parse a key produced by readingTargetToKey back to a target object.
// Also handles legacy bare 'page-${idx}' keys so transient state on load degrades
// gracefully rather than silently breaking restart/skip.
function readingTargetFromKey(key) {
  if (typeof key !== 'string') return null;
  const parts = key.split('|');
  if (parts[0] === 'rt' && parts.length >= 5) {
    const pageIndex    = Number(parts[4]);
    const chapterIndex = Number(parts[3]);
    if (!Number.isFinite(pageIndex) || pageIndex < 0) return null;
    return {
      sourceType:   parts[1],
      bookId:       parts[2],
      chapterIndex: Number.isFinite(chapterIndex) ? chapterIndex : -1,
      pageIndex,
    };
  }
  // Legacy fallback: bare page-${idx} from state written before this patch.
  const m = key.match(/^page-(\d+)$/);
  if (m) return { sourceType: '', bookId: '', chapterIndex: -1, pageIndex: Number(m[1]) };
  return null;
}
window.readingTargetFromKey = readingTargetFromKey;

function getReadingRestoreStatus() {
  return {
    currentPageIndex: Number.isFinite(currentPageIndex) ? currentPageIndex : 0,
    pendingRestorePageIndex: Number(window.__rcPendingRestorePageIndex ?? -1),
    lastFocusedPageIndex: Number(typeof lastFocusedPageIndex === 'number' ? lastFocusedPageIndex : -1),
    pageCount: Array.isArray(pages) ? pages.length : 0
  };
}

window.getReadingRestoreStatus = getReadingRestoreStatus;


// ===================================
// THEME + APPEARANCE PERSISTENCE
// ===================================

const RC_THEME_PREFS_KEY = 'rc_theme_prefs';
const RC_APPEARANCE_PREFS_KEY = 'rc_appearance_prefs';
const RC_DIAGNOSTICS_PREFS_KEY = 'rc_diagnostics_prefs';
const RC_PROFILE_PREFS_KEY = 'rc_profile_prefs';

let appTheme = 'default';
let appThemeSettings = {};
let appAppearance = 'light';
let appearanceAppliedOnce = false;
let appearancePaintSignalSeq = 0;
let diagnosticsPrefs = { enabled: false, mode: 'off' };

const EXPLORER_PRESET = {
  accentSwatch: 'rust',
  font: 'Lora',
  embersOn: true,
  emberPreset: 'fire',
  backgroundMode: 'wallpaper',
  music: 'default'
};

const EXPLORER_ACCENTS = {
  rust: { accent: '#c17d4a', deep: '#8B2500', soft: '#f5ede4', rmSoft: '#f5ede0', btnBg: 'rgba(193,125,74,0.10)', btnHover: 'rgba(193,125,74,0.18)' },
  moss: { accent: '#5e8d63', deep: '#3f6947', soft: '#e4f0e6', rmSoft: '#e0eee3', btnBg: 'rgba(94,141,99,0.10)', btnHover: 'rgba(94,141,99,0.18)' },
  ink:  { accent: '#475569', deep: '#334155', soft: '#e2e8f0', rmSoft: '#e2e8f0', btnBg: 'rgba(71,85,105,0.10)', btnHover: 'rgba(71,85,105,0.18)' },
  plum: { accent: '#8b5cf6', deep: '#6d28d9', soft: '#efe7ff', rmSoft: '#ede9fe', btnBg: 'rgba(139,92,246,0.10)', btnHover: 'rgba(139,92,246,0.18)' }
};

const EXPLORER_FONTS = ['Lora', 'Crimson Pro', 'Inter'];
const EXPLORER_EMBER_PRESETS = {
  fire: ['#FF2200', '#FF6600', '#FFA500'],
  ember: ['#7c2d12', '#d97706', '#ffcc80'],
  golden: ['#b45309', '#f59e0b', '#fde68a'],
  moonfire: ['#312e81', '#8b5cf6', '#c4b5fd']
};

const DEFAULT_PREFS_ADAPTER = {
  loadThemePrefs() {
    try {
      return JSON.parse(localStorage.getItem(RC_THEME_PREFS_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  },
  saveThemePrefs(payload) {
    const safePayload = (payload && typeof payload === 'object') ? payload : {};
    try { localStorage.setItem(RC_THEME_PREFS_KEY, JSON.stringify(safePayload)); } catch (_) {}
    return safePayload;
  },
  loadAppearancePrefs() {
    try {
      return JSON.parse(localStorage.getItem(RC_APPEARANCE_PREFS_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  },
  saveAppearancePrefs(payload) {
    const safePayload = (payload && typeof payload === 'object') ? payload : {};
    try { localStorage.setItem(RC_APPEARANCE_PREFS_KEY, JSON.stringify(safePayload)); } catch (_) {}
    return safePayload;
  },
  loadDiagnosticsPrefs() {
    try {
      return JSON.parse(localStorage.getItem(RC_DIAGNOSTICS_PREFS_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  },
  saveDiagnosticsPrefs(payload) {
    const safePayload = (payload && typeof payload === 'object') ? payload : {};
    try { localStorage.setItem(RC_DIAGNOSTICS_PREFS_KEY, JSON.stringify(safePayload)); } catch (_) {}
    return safePayload;
  },
  loadProfilePrefs() {
    try {
      return JSON.parse(localStorage.getItem(RC_PROFILE_PREFS_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  },
  saveProfilePrefs(payload) {
    const safePayload = (payload && typeof payload === 'object') ? payload : {};
    try { localStorage.setItem(RC_PROFILE_PREFS_KEY, JSON.stringify(safePayload)); } catch (_) {}
    return safePayload;
  }
};

window.rcPrefsAdapter = window.rcPrefsAdapter || DEFAULT_PREFS_ADAPTER;

function getPrefsAdapter() {
  const adapter = window.rcPrefsAdapter || DEFAULT_PREFS_ADAPTER;
  return {
    loadThemePrefs: typeof adapter.loadThemePrefs === 'function' ? adapter.loadThemePrefs.bind(adapter) : DEFAULT_PREFS_ADAPTER.loadThemePrefs,
    saveThemePrefs: typeof adapter.saveThemePrefs === 'function' ? adapter.saveThemePrefs.bind(adapter) : DEFAULT_PREFS_ADAPTER.saveThemePrefs,
    loadAppearancePrefs: typeof adapter.loadAppearancePrefs === 'function' ? adapter.loadAppearancePrefs.bind(adapter) : DEFAULT_PREFS_ADAPTER.loadAppearancePrefs,
    saveAppearancePrefs: typeof adapter.saveAppearancePrefs === 'function' ? adapter.saveAppearancePrefs.bind(adapter) : DEFAULT_PREFS_ADAPTER.saveAppearancePrefs,
    loadDiagnosticsPrefs: typeof adapter.loadDiagnosticsPrefs === 'function' ? adapter.loadDiagnosticsPrefs.bind(adapter) : DEFAULT_PREFS_ADAPTER.loadDiagnosticsPrefs,
    saveDiagnosticsPrefs: typeof adapter.saveDiagnosticsPrefs === 'function' ? adapter.saveDiagnosticsPrefs.bind(adapter) : DEFAULT_PREFS_ADAPTER.saveDiagnosticsPrefs,
    loadProfilePrefs: typeof adapter.loadProfilePrefs === 'function' ? adapter.loadProfilePrefs.bind(adapter) : DEFAULT_PREFS_ADAPTER.loadProfilePrefs,
    saveProfilePrefs: typeof adapter.saveProfilePrefs === 'function' ? adapter.saveProfilePrefs.bind(adapter) : DEFAULT_PREFS_ADAPTER.saveProfilePrefs,
  };
}

function loadThemePrefs() {
  return getPrefsAdapter().loadThemePrefs();
}

function saveThemePrefs(payload) {
  const result = getPrefsAdapter().saveThemePrefs(payload);
  // Pass 4: notify sync seam so durable settings stay in sync when signed in.
  // sync.js listens for this event and calls rcSync.syncSettings with the combined snapshot.
  try { document.dispatchEvent(new CustomEvent('rc:prefs-changed', { detail: { source: 'theme' } })); } catch (_) {}
  return result;
}

function loadAppearancePrefs() {
  return getPrefsAdapter().loadAppearancePrefs();
}

function saveAppearancePrefs(payload) {
  return getPrefsAdapter().saveAppearancePrefs(payload);
}

function loadDiagnosticsPrefs() {
  return getPrefsAdapter().loadDiagnosticsPrefs();
}

function saveDiagnosticsPrefs(payload) {
  return getPrefsAdapter().saveDiagnosticsPrefs(payload);
}

const DEFAULT_PROFILE_PREFS = Object.freeze({
  dailyGoalMinutes: 15,
  lastGoalCelebratedOn: ''
});

function normalizeProfilePrefs(raw) {
  const input = (raw && typeof raw === 'object') ? raw : {};
  const next = { ...DEFAULT_PROFILE_PREFS };
  const goal = Number(input.dailyGoalMinutes);
  if (Number.isFinite(goal) && goal > 0) next.dailyGoalMinutes = Math.max(5, Math.min(300, Math.round(goal)));
  if (typeof input.lastGoalCelebratedOn === 'string') next.lastGoalCelebratedOn = input.lastGoalCelebratedOn.trim();
  return next;
}

function loadProfilePrefs() {
  return normalizeProfilePrefs(getPrefsAdapter().loadProfilePrefs());
}

function saveProfilePrefs(payload) {
  const base = loadProfilePrefs();
  const result = normalizeProfilePrefs({ ...base, ...(payload && typeof payload === 'object' ? payload : {}) });
  const saved = getPrefsAdapter().saveProfilePrefs(result);
  try { document.dispatchEvent(new CustomEvent('rc:prefs-changed', { detail: { source: 'profile' } })); } catch (_) {}
  return normalizeProfilePrefs(saved);
}

function getTodayIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeReadingMetrics(raw) {
  const input = (raw && typeof raw === 'object') ? raw : {};
  const summaries = (input.bookSummaries && typeof input.bookSummaries === 'object') ? input.bookSummaries : {};
  const sessions = Array.isArray(input.sessionHistory) ? input.sessionHistory : [];
  const outSummaries = {};
  Object.keys(summaries).forEach((bookId) => {
    const row = summaries[bookId] || {};
    outSummaries[String(bookId)] = {
      bookId: String(bookId),
      totalPages: Number.isFinite(Number(row.totalPages)) ? Math.max(0, Number(row.totalPages)) : 0,
      lastPageIndex: Number.isFinite(Number(row.lastPageIndex)) ? Math.max(0, Number(row.lastPageIndex)) : 0,
      totalReadingSeconds: Number.isFinite(Number(row.totalReadingSeconds)) ? Math.max(0, Math.round(Number(row.totalReadingSeconds))) : 0,
      lastOpenedAt: typeof row.lastOpenedAt === 'string' ? row.lastOpenedAt : null,
      completed: !!row.completed,
      completedAt: typeof row.completedAt === 'string' ? row.completedAt : null
    };
  });
  const outSessions = sessions.map((entry) => ({
    bookId: String((entry && entry.bookId) || ''),
    startedAt: typeof entry?.startedAt === 'string' ? entry.startedAt : null,
    endedAt: typeof entry?.endedAt === 'string' ? entry.endedAt : null,
    elapsedSeconds: Number.isFinite(Number(entry?.elapsedSeconds)) ? Math.max(0, Math.round(Number(entry.elapsedSeconds))) : 0,
    pagesAdvanced: Number.isFinite(Number(entry?.pagesAdvanced)) ? Math.max(0, Math.round(Number(entry.pagesAdvanced))) : 0,
    completed: !!entry?.completed
  })).filter((entry) => entry.bookId && entry.endedAt);
  return {
    bookSummaries: outSummaries,
    sessionHistory: outSessions.slice(-200)
  };
}

function loadReadingMetrics() {
  const meta = loadSessionMetaPayload();
  return normalizeReadingMetrics(meta.readingMetrics);
}

function saveReadingMetrics(payload) {
  const meta = loadSessionMetaPayload();
  const next = normalizeReadingMetrics(payload);
  meta.savedAt = Date.now();
  meta.readingMetrics = next;
  saveSessionMetaPayload(meta);
  return next;
}

function estimateReadMinutesFromPages(pageCount, options = {}) {
  const pagesCount = Number(pageCount);
  const normalized = Number.isFinite(pagesCount) && pagesCount > 0 ? pagesCount : 0;
  const isTextImport = !!(options && options.textImport);
  if (isTextImport) return Math.max(1, Math.ceil(normalized));
  return Math.max(1, Math.ceil(normalized * 2.5));
}

function upsertReadingBookSummary(summary) {
  const store = loadReadingMetrics();
  const bookId = String(summary?.bookId || '');
  if (!bookId) return store;
  const prev = store.bookSummaries[bookId] || { bookId, totalPages: 0, lastPageIndex: 0, totalReadingSeconds: 0, lastOpenedAt: null, completed: false, completedAt: null };
  const next = {
    ...prev,
    ...summary,
    bookId,
    totalPages: Number.isFinite(Number(summary?.totalPages)) ? Math.max(0, Number(summary.totalPages)) : prev.totalPages,
    lastPageIndex: Number.isFinite(Number(summary?.lastPageIndex)) ? Math.max(0, Number(summary.lastPageIndex)) : prev.lastPageIndex,
    totalReadingSeconds: Number.isFinite(Number(summary?.totalReadingSeconds)) ? Math.max(0, Math.round(Number(summary.totalReadingSeconds))) : prev.totalReadingSeconds,
    lastOpenedAt: typeof summary?.lastOpenedAt === 'string' ? summary.lastOpenedAt : prev.lastOpenedAt,
    completed: typeof summary?.completed === 'boolean' ? summary.completed : prev.completed,
    completedAt: typeof summary?.completedAt === 'string' || summary?.completedAt === null ? summary.completedAt : prev.completedAt
  };
  store.bookSummaries[bookId] = next;
  return saveReadingMetrics(store);
}

function appendReadingSession(entry) {
  const bookId = String(entry?.bookId || '');
  if (!bookId) return loadReadingMetrics();
  const store = loadReadingMetrics();
  store.sessionHistory.push({
    bookId,
    startedAt: typeof entry?.startedAt === 'string' ? entry.startedAt : null,
    endedAt: typeof entry?.endedAt === 'string' ? entry.endedAt : null,
    elapsedSeconds: Number.isFinite(Number(entry?.elapsedSeconds)) ? Math.max(0, Math.round(Number(entry.elapsedSeconds))) : 0,
    pagesAdvanced: Number.isFinite(Number(entry?.pagesAdvanced)) ? Math.max(0, Math.round(Number(entry.pagesAdvanced))) : 0,
    completed: !!entry?.completed
  });
  return saveReadingMetrics(store);
}

function getReadingBookSummary(bookId, totalPagesHint) {
  const key = String(bookId || '');
  try {
    const signedIn = !!(window.rcAuth && typeof window.rcAuth.isSignedIn === 'function' && window.rcAuth.isSignedIn());
    if (signedIn && window.rcSync && typeof window.rcSync.getRemoteReadingBookSummary === 'function') {
      const remote = window.rcSync.getRemoteReadingBookSummary(key, totalPagesHint);
      if (remote) return remote;
    }
  } catch (_) {}
  const row = loadReadingMetrics().bookSummaries[key] || null;
  if (!row) return null;
  const totalPages = Number.isFinite(Number(totalPagesHint)) && Number(totalPagesHint) > 0 ? Number(totalPagesHint) : row.totalPages;
  const completed = !!row.completed || (totalPages > 0 && row.lastPageIndex >= Math.max(0, totalPages - 1));
  return {
    ...row,
    totalPages,
    completed,
    completedAt: completed ? (row.completedAt || row.lastOpenedAt || new Date().toISOString()) : null
  };
}

function getReadingProfileMetrics() {
  try {
    const signedIn = !!(window.rcAuth && typeof window.rcAuth.isSignedIn === 'function' && window.rcAuth.isSignedIn());
    if (signedIn && window.rcSync && typeof window.rcSync.getRemoteProfileMetrics === 'function') {
      const remote = window.rcSync.getRemoteProfileMetrics();
      if (remote) return remote;
    }
  } catch (_) {}
  const prefs = loadProfilePrefs();
  const metrics = loadReadingMetrics();
  const today = getTodayIsoDate();
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - (6 * 24 * 60 * 60 * 1000));
  let dailySeconds = 0;
  let weeklySeconds = 0;
  let sessionsCompleted = 0;
  metrics.sessionHistory.forEach((entry) => {
    if (!entry?.endedAt) return;
    const ended = new Date(entry.endedAt);
    if (Number.isNaN(ended.getTime())) return;
    const seconds = Math.max(0, Math.round(Number(entry.elapsedSeconds || 0)));
    if (ended.toISOString().slice(0, 10) === today) dailySeconds += seconds;
    if (ended >= sevenDaysAgo) weeklySeconds += seconds;
    sessionsCompleted += 1;
  });
  const goal = Math.max(5, Number(prefs.dailyGoalMinutes || DEFAULT_PROFILE_PREFS.dailyGoalMinutes));
  const progressPct = goal > 0 ? Math.max(0, Math.min(100, Math.round((dailySeconds / (goal * 60)) * 100))) : 0;
  const dailyMinutes = Math.round(dailySeconds / 60);
  return {
    dailyGoalMinutes: goal,
    dailyMinutes,
    displayDailyMinutes: Math.max(0, Math.min(dailyMinutes, goal)),
    weeklyMinutes: Math.round(weeklySeconds / 60),
    sessionsCompleted,
    progressPct,
    remainingGoalMinutes: Math.max(0, goal - dailyMinutes),
    lastGoalCelebratedOn: String(prefs.lastGoalCelebratedOn || ''),
    todayIso: today
  };
}

function getRuntimeTier() {
  // PASS3: Read exclusively from server-resolved runtimePolicy.
  // Previously fell back to reading #tierSelect DOM value, which made DOM
  // an authority for policy tier. Tier simulation now routes through
  // refreshForTier (ui.js owns #tierSelect → syncTierPolicy → refreshForTier),
  // which fetches from the server and sets runtimePolicy directly.
  try {
    return normalizeAppTier(runtimePolicy?.tier || 'basic');
  } catch (_) {
    return 'basic';
  }
}

function canUseTheme(themeId) {
  const theme = String(themeId || 'default');
  if (theme === 'explorer') return !!getRuntimePolicy()?.features?.themes?.explorer;
  return true;
}

function canUseCustomMusic() {
  return !!getRuntimePolicy()?.features?.themes?.customMusic;
}

function applyThemeClass(themeName) {
  const theme = String(themeName || 'default');
  document.body.classList.remove('theme-green', 'theme-purple', 'theme-explorer');
  if (theme !== 'default') document.body.classList.add('theme-' + theme);
}

function getThemeSettings() {
  return Object.assign({}, EXPLORER_PRESET, appThemeSettings || {});
}

function getThemeState() {
  return {
    themeId: appTheme,
    settings: getThemeSettings()
  };
}

function setExplorerInlineVars(accentDef, fontName) {
  const body = document.body;
  body.style.setProperty('--theme-accent', accentDef.accent);
  body.style.setProperty('--theme-accent-deep', accentDef.deep);
  body.style.setProperty('--theme-accent-soft', accentDef.soft);
  body.style.setProperty('--accent', accentDef.accent);
  body.style.setProperty('--rm-accent', accentDef.accent);
  body.style.setProperty('--rm-accent-soft', accentDef.rmSoft);
  body.style.setProperty('--rm-btn-bg', accentDef.btnBg);
  body.style.setProperty('--rm-btn-hover', accentDef.btnHover);
  body.style.setProperty('--rm-reading-font', fontName || 'Lora');
}

function clearExplorerInlineVars() {
  const body = document.body;
  ['--theme-accent', '--theme-accent-deep', '--theme-accent-soft', '--accent', '--rm-accent', '--rm-accent-soft', '--rm-btn-bg', '--rm-btn-hover', '--rm-reading-font']
    .forEach((name) => body.style.removeProperty(name));
}

function applyThemeSettings() {
  const settings = getThemeSettings();
  const readingContent = document.querySelector('#reading-mode .reading-content');
  if (appTheme !== 'explorer') {
    clearExplorerInlineVars();
    document.body.classList.remove('explorer-embers-off');
    if (readingContent) readingContent.classList.remove('explorer-bg-plain', 'explorer-bg-texture', 'explorer-bg-wallpaper');
    return settings;
  }
  const accentDef = EXPLORER_ACCENTS[settings.accentSwatch] || EXPLORER_ACCENTS.rust;
  const fontName = EXPLORER_FONTS.includes(settings.font) ? settings.font : EXPLORER_PRESET.font;
  const emberColors = EXPLORER_EMBER_PRESETS[settings.emberPreset] || EXPLORER_EMBER_PRESETS.fire;
  setExplorerInlineVars(accentDef, fontName);
  document.body.classList.toggle('explorer-embers-off', !settings.embersOn);
  if (readingContent) {
    const bgMode = ['plain', 'texture', 'wallpaper'].includes(settings.backgroundMode) ? settings.backgroundMode : 'wallpaper';
    readingContent.classList.remove('explorer-bg-plain', 'explorer-bg-texture', 'explorer-bg-wallpaper');
    readingContent.classList.add(`explorer-bg-${bgMode}`);
  }
  try { if (window.rcEmbers && typeof window.rcEmbers.setColors === 'function') window.rcEmbers.setColors(emberColors); } catch (_) {}
  try {
    if (window.rcEmbers && typeof window.rcEmbers.refreshBounds === 'function') window.rcEmbers.refreshBounds(true);
    if (window.rcEmbers && typeof window.rcEmbers.syncVisibility === 'function') window.rcEmbers.syncVisibility();
  } catch (_) {}
  return settings;
}

function persistThemeState() {
  _trailPush('persist-theme', { theme_id: appTheme });
  return saveThemePrefs({
    theme_id: appTheme,
    theme_settings: Object.assign({}, appThemeSettings || {}),
    diagnostics_mode: diagnosticsPrefs.mode || 'off',
    diagnostics_enabled: !!diagnosticsPrefs.enabled
  });
}

function setThemeRuntime(themeName) {
  const requestedTheme = String(themeName || 'default');
  const nextTheme = canUseTheme(requestedTheme) ? requestedTheme : 'default';
  appTheme = nextTheme;
  persistThemeState();
  applyThemeClass(appTheme);
  applyThemeSettings();
  syncThemeShellState();
  return appTheme;
}

function patchThemeSettings(settings) {
  const next = Object.assign({}, appThemeSettings || {});
  Object.entries(settings || {}).forEach(([key, value]) => {
    if (typeof value !== 'undefined') next[key] = value;
  });
  appThemeSettings = next;
  persistThemeState();
  applyThemeSettings();
  return getThemeSettings();
}

function resetThemeSettings() {
  appThemeSettings = {};
  persistThemeState();
  applyThemeSettings();
  return getThemeSettings();
}

function syncThemeSwatchUI() {
  try {
    document.querySelectorAll('#theme-swatches .theme-swatch').forEach((sw) => sw.classList.remove('selected'));
    const activeBtn = document.querySelector(`#theme-swatches [data-theme="${appTheme}"]`);
    const activeSwatch = activeBtn && activeBtn.querySelector('.theme-swatch');
    if (activeSwatch) activeSwatch.classList.add('selected');
  } catch (_) {}
}

function syncAppearanceButtons() {
  try {
    ['appearance-light-btn', 'rs-appearance-light-btn'].forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle('active', appAppearance !== 'dark');
    });
    ['appearance-dark-btn', 'rs-appearance-dark-btn'].forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle('active', appAppearance === 'dark');
    });
  } catch (_) {}
}

function syncThemeShellState() {
  syncThemeSwatchUI();
  syncAppearanceButtons();
}

function loadTheme() {
  const stored = loadThemePrefs() || {};
  const storedDiagPrefs = loadDiagnosticsPrefs() || {};
  const themeDiagPrefs = {};
  appTheme = String(stored.theme_id || 'default');
  appThemeSettings = (stored.theme_settings && typeof stored.theme_settings === 'object') ? stored.theme_settings : {};
  if (typeof stored.diagnostics_enabled === 'boolean') themeDiagPrefs.enabled = stored.diagnostics_enabled;
  if (typeof stored.diagnostics_mode === 'string') themeDiagPrefs.mode = stored.diagnostics_mode;
  diagnosticsPrefs = Object.assign({ enabled: false, mode: 'off' }, storedDiagPrefs, themeDiagPrefs);
  if (!canUseTheme(appTheme)) {
    // Theme access can be policy-gated. On cold boot, runtime policy may still be
    // unresolved when we first read persisted prefs. Display the safe default, but
    // do not overwrite the saved durable theme until a resolved runtime policy has
    // actually confirmed the theme is disallowed.
    const hasResolvedRuntimePolicy = isRuntimePolicyResolved();
    _trailPush('load-theme-forced-default', { storedTheme: appTheme, hasResolvedRuntimePolicy, policyTier: runtimePolicy && runtimePolicy.tier });
    appTheme = 'default';
    if (hasResolvedRuntimePolicy) persistThemeState();
  }
  applyThemeClass(appTheme);
  applyThemeSettings();
  syncThemeShellState();
  return appTheme;
}

function applyAppearance() {
  const modeClass = appAppearance === 'dark' ? 'app-dark' : 'app-light';
  const paintSeq = ++appearancePaintSignalSeq;
  try {
    document.documentElement.classList.remove('app-light', 'app-dark');
    document.documentElement.classList.add(modeClass);
    document.documentElement.setAttribute('data-app-appearance', appAppearance);
    document.documentElement.setAttribute('data-appearance-ready', 'true');
    document.documentElement.setAttribute('data-appearance-painted', 'false');
  } catch (_) {}
  document.body.classList.remove('app-light', 'app-dark');
  document.body.classList.add(modeClass);
  try {
    document.body.setAttribute('data-app-appearance', appAppearance);
    document.body.setAttribute('data-appearance-ready', 'true');
    document.body.setAttribute('data-appearance-painted', 'false');
  } catch (_) {}
  appearanceAppliedOnce = true;
  syncAppearanceButtons();
  try { document.dispatchEvent(new CustomEvent('rc:appearance-applied', { detail: { appearance: appAppearance } })); } catch (_) {}
  const dispatchPainted = () => {
    if (paintSeq !== appearancePaintSignalSeq) return;
    try { document.documentElement.setAttribute('data-appearance-painted', 'true'); } catch (_) {}
    try { document.body.setAttribute('data-appearance-painted', 'true'); } catch (_) {}
    try { document.dispatchEvent(new CustomEvent('rc:appearance-painted', { detail: { appearance: appAppearance } })); } catch (_) {}
  };
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(dispatchPainted);
    });
  } else {
    setTimeout(dispatchPainted, 0);
  }
  return appAppearance;
}

function normalizeAppearanceMode(value) {
  return String(value || 'light') === 'dark' ? 'dark' : 'light';
}

function writeAppearanceModeToLocal(mode) {
  const safeMode = normalizeAppearanceMode(mode);
  try { localStorage.setItem(RC_APPEARANCE_PREFS_KEY, JSON.stringify({ appearance_mode: safeMode })); } catch (_) {}
  try { document.cookie = 'rc_appearance_mode=' + encodeURIComponent(safeMode) + '; path=/; max-age=31536000; SameSite=Lax'; } catch (_) {}
  return safeMode;
}

function readAppearanceModeFromLocal() {
  try {
    const raw = localStorage.getItem(RC_APPEARANCE_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const value = parsed && typeof parsed === 'object'
        ? (parsed.appearance_mode ?? parsed.mode ?? parsed.appearance)
        : null;
      if (value != null && value !== '') return normalizeAppearanceMode(value);
    }
  } catch (_) {}
  try {
    const match = String(document.cookie || '').match(/(?:^|; )rc_appearance_mode=([^;]+)/);
    if (match && match[1]) return normalizeAppearanceMode(decodeURIComponent(match[1]));
  } catch (_) {}
  const stored = loadAppearancePrefs();
  const storedMode = stored && typeof stored === 'object'
    ? (stored.appearance_mode ?? stored.mode ?? stored.appearance)
    : null;
  return normalizeAppearanceMode(storedMode);
}

function setAppearance(mode) {
  appAppearance = normalizeAppearanceMode(mode);
  writeAppearanceModeToLocal(appAppearance);
  saveAppearancePrefs({ appearance_mode: appAppearance });
  return applyAppearance();
}

function loadAppearance(opts = {}) {
  appAppearance = opts.fromLocal === true ? readAppearanceModeFromLocal() : 'light';
  return applyAppearance();
}

function restorePersistedAppearance() {
  return loadAppearance({ fromLocal: true });
}

function getDiagnosticsPreference() {
  return Object.assign({}, diagnosticsPrefs || { enabled: false, mode: 'off' });
}

function setDiagnosticsPreference(partial) {
  diagnosticsPrefs = Object.assign({ enabled: false, mode: 'off' }, diagnosticsPrefs || {}, partial || {});
  saveDiagnosticsPrefs(diagnosticsPrefs);
  persistThemeState();
  return getDiagnosticsPreference();
}

function enforceThemeAccess() {
  const canUse = canUseTheme(appTheme);
  _trailPush('enforce-theme-access', { appTheme, canUse, policyTier: runtimePolicy && runtimePolicy.tier, policyResolved: isRuntimePolicyResolved() });
  if (canUse) return true;
  setThemeRuntime('default');
  return false;
}

window.rcPrefs = {
  loadThemePrefs,
  saveThemePrefs,
  loadAppearancePrefs,
  saveAppearancePrefs,
  loadDiagnosticsPrefs,
  saveDiagnosticsPrefs,
  loadProfilePrefs,
  saveProfilePrefs
};

window.rcReadingMetrics = {
  loadReadingMetrics,
  saveReadingMetrics,
  upsertReadingBookSummary,
  appendReadingSession,
  getReadingBookSummary,
  getReadingProfileMetrics,
  estimateReadMinutesFromPages,
  getTodayIsoDate
};

window.rcTheme = {
  get: getThemeState,
  set: setThemeRuntime,
  getSettings: getThemeSettings,
  patchSettings: patchThemeSettings,
  resetSettings: resetThemeSettings,
  applySettings: applyThemeSettings,
  canUseTheme,
  canUseCustomMusic,
  enforceAccess: enforceThemeAccess,
  syncShellState: syncThemeShellState,
  syncThemeSwatchUI,
  load: loadTheme,
  accents: EXPLORER_ACCENTS,
  fonts: EXPLORER_FONTS,
  emberPresets: EXPLORER_EMBER_PRESETS,
  // Transitional aliases for existing shell hooks during bounded integration.
  get active() { return appTheme; },
  get settings() { return getThemeSettings(); },
  save: setThemeRuntime,
  saveExplorerSettings: patchThemeSettings,
  getThemeSettings,
  reset: resetThemeSettings
};

window.rcAppearance = {
  get: () => appAppearance,
  set: setAppearance,
  load: loadAppearance,
  restorePersisted: restorePersistedAppearance,
  apply: applyAppearance,
  hasApplied: () => appearanceAppliedOnce,
  syncButtons: syncAppearanceButtons,
  // Transitional alias for current shell button handlers.
  save: setAppearance
};

window.rcDiagnosticsPrefs = {
  get: getDiagnosticsPreference,
  set: setDiagnosticsPreference,
  load: function loadDiagnosticsPreference() {
    diagnosticsPrefs = Object.assign({ enabled: false, mode: 'off' }, loadDiagnosticsPrefs() || {});
    return getDiagnosticsPreference();
  }
};

// PASS3: Define canSimulateTierSelection locally in state.js.
// Previously this referenced shell.js's canSimulateTierSelection (defined later
// in load order), so window.rcPolicy.canSimulateTier was always undefined at
// assignment time — causing simulation UI buttons to always be hidden.
// Now it reads simulationAllowed directly from the server-resolved runtimePolicy.
// Shell.js's canSimulateTierSelection checks window.rcPolicy.canSimulateTier(),
// which now resolves correctly without a circular shell dependency.
function canSimulateTierSelection() {
  return !!(getRuntimePolicy()?.simulationAllowed);
}

window.rcPolicy = {
  get: getRuntimePolicy,
  refreshForTier: refreshRuntimePolicy,
  apply: applyResolvedRuntimePolicy,
  canSimulateTier: canSimulateTierSelection,
  getTier: getRuntimeTier,
  getUsageDailyLimit: getRuntimeUsageAllowance,
  getImportSlotLimit: getRuntimeImportSlotLimit,
  hasImportCapacity: hasRuntimeImportCapacity,
  canUseMode,
  canUseAiEvaluate,
  canUseAnchors,
  canUseCloudVoices
};

// PASS3: Interim server-owned usage capacity API.
// window.rcUsage.check(category) is the authoritative pre-flight gate before
// any protected cloud action (TTS, evaluate, anchors, research).
// The server resolves its own policy limits — the client cannot inflate them
// by claiming a higher tier on production.
// Spend tracking (sessionTokens) is kept for display/diagnostics only.
window.rcUsage = {
  // Read-only preflight. Returns whether the action would be allowed given
  // current durable usage. Does NOT write or consume units — use consume()
  // after a successful action commit for the actual durable write.
  check: async function rcUsageCheck(category) {
    const spent = sessionTokens?.spent || {};
    try {
      const resp = await fetch(
        (typeof apiUrl === 'function' ? apiUrl('/api/app?kind=usage-check') : '/api/app?kind=usage-check'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ action: category, spent }),
          cache: 'no-store',
        }
      );
      if (resp.ok) {
        const data = await resp.json();
        const limit = Number(data.limit);
        const remaining = Number(data.remaining);
        if (Number.isFinite(limit) && limit >= 0) sessionTokens.allowance = limit;
        sessionTokens.remaining = Number.isFinite(remaining) ? Math.max(0, remaining) : null;
        sessionTokens.authoritative = Number.isFinite(remaining);
        sessionTokens.source = 'server';
        try { window.dispatchEvent(new CustomEvent('rc:usage-changed', { detail: { remaining: data.remaining, allowance: data.limit, source: 'server' } })); } catch (_) {}
        return {
          allowed: !!data.allowed,
          cost: data.cost,
          remaining: data.remaining,
          limit: data.limit,
          reason: data.meta?.reason || (data.allowed ? 'ok' : 'denied'),
          meta: data.meta || {},
        };
      }
    } catch (_) {}
    const cost = TOKEN_COSTS[category] || 0;
    sessionTokens.authoritative = false;
    sessionTokens.source = 'server-unavailable';
    try { window.dispatchEvent(new CustomEvent('rc:usage-changed', { detail: { remaining: null, allowance: sessionTokens.allowance, source: 'server-unavailable' } })); } catch (_) {}
    return {
      allowed: true,
      cost,
      remaining: null,
      limit: sessionTokens.allowance,
      reason: 'server_unavailable',
      meta: { policySource: 'server-unavailable' },
    };
  },
  // Durable consume. Call this AFTER a successful action commit (e.g. after
  // localBookPut succeeds). This is the only path that writes durable usage.
  consume: async function rcUsageConsume(category) {
    try {
      const resp = await fetch(
        (typeof apiUrl === 'function' ? apiUrl('/api/app?kind=usage-consume') : '/api/app?kind=usage-consume'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ action: category }),
          cache: 'no-store',
        }
      );
      if (resp.ok) {
        const data = await resp.json();
        const limit = Number(data.limit);
        const remaining = Number(data.remaining);
        if (Number.isFinite(limit) && limit >= 0) sessionTokens.allowance = limit;
        sessionTokens.remaining = Number.isFinite(remaining) ? Math.max(0, remaining) : null;
        sessionTokens.authoritative = Number.isFinite(remaining);
        sessionTokens.source = 'server';
        try { window.dispatchEvent(new CustomEvent('rc:usage-changed', { detail: { remaining: data.remaining, allowance: data.limit, source: 'server' } })); } catch (_) {}
        return {
          allowed: !!data.allowed,
          cost: data.cost,
          remaining: data.remaining,
          limit: data.limit,
          reason: data.meta?.reason || (data.allowed ? 'ok' : 'denied'),
          meta: data.meta || {},
        };
      }
    } catch (_) {}
    sessionTokens.authoritative = false;
    sessionTokens.source = 'server-unavailable';
    return {
      allowed: true,
      cost: TOKEN_COSTS[category] || 0,
      remaining: null,
      limit: sessionTokens.allowance,
      reason: 'server_unavailable',
      meta: { policySource: 'server-unavailable' },
    };
  },
  spend: function rcUsageSpend(category) {
    try { if (typeof tokenSpend === 'function') tokenSpend(category); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('rc:usage-changed', { detail: { remaining: sessionTokens.remaining, allowance: sessionTokens.allowance, source: sessionTokens.source || 'client' } })); } catch (_) {}
  },
  getSnapshot: function rcUsageGetSnapshot() {
    const remaining = normalizeUsageValue(sessionTokens?.remaining);
    const allowance = normalizeUsageValue(sessionTokens?.allowance);
    const hasValue = remaining != null || allowance != null;
    return {
      remaining,
      allowance,
      authoritative: typeof sessionTokens?.authoritative === 'boolean' ? (!!sessionTokens.authoritative && hasValue) : hasValue,
      source: sessionTokens?.source || null,
      spent: { ...(sessionTokens?.spent || {}) },
    };
  },
  applySnapshot: function rcUsageApplySnapshot(snapshot) {
    const remaining = normalizeUsageValue(snapshot?.remaining);
    const allowance = normalizeUsageValue(snapshot?.limit != null ? snapshot.limit : snapshot?.allowance);
    const hasValue = remaining != null || allowance != null;
    sessionTokens.allowance = allowance;
    sessionTokens.remaining = remaining;
    sessionTokens.authoritative = typeof snapshot?.authoritative === 'boolean' ? (!!snapshot.authoritative && hasValue) : hasValue;
    sessionTokens.source = snapshot?.source || 'server-sync';
    try { window.dispatchEvent(new CustomEvent('rc:usage-changed', { detail: { remaining: sessionTokens.remaining, allowance: sessionTokens.allowance, source: sessionTokens.source } })); } catch (_) {}
    return this.getSnapshot();
  },
};

window.rcEntitlements = {
  getTier: getRuntimeTier,
  getResolvedPolicy: getRuntimePolicy,
  canUseTheme,
  canUseCustomMusic,
  enforceThemeAccess
};

applyResolvedRuntimePolicy(getFallbackRuntimePolicy(appTier), appTier, { resolved: false });
loadAppearance({ fromLocal: false });
loadTheme();

