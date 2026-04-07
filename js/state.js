// Split from original app.js during role-based phase-1 restructure.
// File: state.js
// Note: This is still global-script architecture (no bundler/modules required).

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
  
  // Current mode: 'reading', 'comprehension', 'research'
  let appMode = 'reading';   // default mode
  let thesisText = ''; // research mode input — coming soon

  // Current subscription tier: 'free', 'paid', 'premium'
  // During prototype: controls feature access in UI but does not enforce usage limits.
  let appTier = 'free';
  let runtimePolicy = null;

  // ---- Token Tracking ----
  // Session token counter. Counts consumption per category for diagnostic purposes.
  // Tokens do not enforce limits during prototype — this is observational only.
  // Resets when tier changes.
  //
  // Token costs (must match ExperienceSpec):
  //   TTS page (cloud)     = 1
  //   AI Evaluate          = 2
  //   Generate anchors     = 1
  //   Research analysis    = 3

  const TOKEN_COSTS = {
    tts:      1,
    evaluate: 2,
    anchors:  1,
    research: 3,
  };

  const SAFE_FALLBACK_POLICY = Object.freeze({
    version: 1,
    tier: 'free',
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


  function normalizeAppTier(value) {
    const tier = String(value || '').trim().toLowerCase();
    return ['free', 'paid', 'premium'].includes(tier) ? tier : 'free';
  }

  function getFallbackRuntimePolicy(tierInput) {
    // PASS3: Fallback is always the minimum safe free-tier policy.
    // tierInput is accepted for callers that pass a hint, but it NEVER elevates
    // features above free-tier when the server is unreachable.
    // simulationAllowed is never granted from client-side host inference:
    //   - it was previously set from canSimulateTierOnCurrentHost(), which let the
    //     client grant itself simulation capability when the server was down.
    //   - now it is always false; simulation capability comes from the server only.
    const tier = normalizeAppTier(tierInput);
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
      // 'client-fallback' — server unreachable, safe free-tier only.
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
    return runtimePolicy;
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

  function applyResolvedRuntimePolicy(policyLike, tierHint) {
    runtimePolicy = normalizeRuntimePolicy(policyLike, tierHint);
    appTier = runtimePolicy.tier;
    try { tokenReset(); } catch (_) {}
    try { if (window.rcTheme && typeof window.rcTheme.enforceAccess === 'function') window.rcTheme.enforceAccess(); } catch (_) {}
    try {
      const detail = { policy: runtimePolicy };
      document.dispatchEvent(new CustomEvent('rc:runtime-policy-changed', { detail }));
      window.dispatchEvent(new CustomEvent('rc:runtime-policy-changed', { detail }));
    } catch (_) {}
    return runtimePolicy;
  }

  async function refreshRuntimePolicy(requestedTier) {
    const tier = normalizeAppTier(requestedTier || getRuntimeTier());
    try {
      const response = await fetch(apiUrl(`/api/runtime-config?tier=${encodeURIComponent(tier)}`), {
        method: 'GET',
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`runtime-config ${response.status}`);
      const payload = await response.json();
      // Merge server meta.resolutionMode into the policy object before normalizing,
      // so normalizeRuntimePolicy can store it alongside capabilities.
      const policyWithMeta = payload?.policy
        ? { ...payload.policy, resolutionMode: payload?.meta?.resolutionMode }
        : payload;
      return applyResolvedRuntimePolicy(policyWithMeta, tier);
    } catch (_) {
      // Server unreachable. Apply minimum safe free-tier fallback only.
      // PASS3: Do not preserve the requested tier (even on localhost) when the
      // server is down. The previous path used canSimulateTierOnCurrentHost() to
      // grant the requested tier in fallback — that made the client a second policy
      // engine when the server failed. Now the fallback is always safe-free.
      // When the server becomes reachable, the next refreshForTier call will fetch
      // the correct server-resolved policy.
      return applyResolvedRuntimePolicy(getFallbackRuntimePolicy('free'), 'free');
    }
  }

  let sessionTokens = {
    remaining: SAFE_FALLBACK_POLICY.usageDailyLimit,
    spent: { tts: 0, evaluate: 0, anchors: 0, research: 0 },
  };

  function tokenSpend(category) {
    const cost = TOKEN_COSTS[category] || 0;
    if (!cost) return;
    sessionTokens.spent[category] = (sessionTokens.spent[category] || 0) + cost;
    sessionTokens.remaining = Math.max(0, sessionTokens.remaining - cost);
  }

  function tokenReset() {
    sessionTokens = {
      remaining: getRuntimeUsageAllowance(),
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

function getConsolidationCacheKey(pageHash) {
  return `rc_consolidation_${pageHash}`;
}

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
      consolidations: pageData.map(p => p?.consolidation || "")
    };
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(payload));
    localStorage.setItem(STORAGE_KEY_META, JSON.stringify({ savedAt: payload.savedAt }));
    return true;
  } catch (e) {
    return false;
  }
}

function clearPersistedSession() {
  try { localStorage.removeItem(STORAGE_KEY_SESSION); } catch (_) {}
  try { localStorage.removeItem(STORAGE_KEY_META); } catch (_) {}
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

  function inferCurrentPageIndex() {
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
    const pageEls = Array.from(document.querySelectorAll(".page"));
    if (!pageEls.length) return -1;
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
  // We support truthy URL forms: ?debug=1, ?debug=true, ?debug (empty), ?debug=on/yes
  // and treat ?debug=0/false/off/no as disabled.
  function isDebugEnabledFromUrl() {
    try {
      const params = new URLSearchParams(location.search);
      if (!params.has('debug')) return false;
      const v = (params.get('debug') || '').trim().toLowerCase();
      if (v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
      return false;
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

let appTheme = 'default';
let appThemeSettings = {};
let appAppearance = 'light';
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
  };
}

function loadThemePrefs() {
  return getPrefsAdapter().loadThemePrefs();
}

function saveThemePrefs(payload) {
  return getPrefsAdapter().saveThemePrefs(payload);
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

function getRuntimeTier() {
  // PASS3: Read exclusively from server-resolved runtimePolicy.
  // Previously fell back to reading #tierSelect DOM value, which made DOM
  // an authority for policy tier. Tier simulation now routes through
  // refreshForTier (ui.js owns #tierSelect → syncTierPolicy → refreshForTier),
  // which fetches from the server and sets runtimePolicy directly.
  try {
    return normalizeAppTier(runtimePolicy?.tier || 'free');
  } catch (_) {
    return 'free';
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
    const lightBtn = document.getElementById('appearance-light-btn');
    const darkBtn = document.getElementById('appearance-dark-btn');
    if (lightBtn) lightBtn.classList.toggle('active', appAppearance !== 'dark');
    if (darkBtn) darkBtn.classList.toggle('active', appAppearance === 'dark');
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
    appTheme = 'default';
    persistThemeState();
  }
  applyThemeClass(appTheme);
  applyThemeSettings();
  syncThemeShellState();
  return appTheme;
}

function applyAppearance() {
  document.body.classList.remove('app-light', 'app-dark');
  document.body.classList.add(appAppearance === 'dark' ? 'app-dark' : 'app-light');
  syncAppearanceButtons();
  return appAppearance;
}

function setAppearance(mode) {
  appAppearance = String(mode || 'light') === 'dark' ? 'dark' : 'light';
  saveAppearancePrefs({ appearance: appAppearance });
  return applyAppearance();
}

function loadAppearance() {
  const stored = loadAppearancePrefs() || {};
  appAppearance = stored.appearance === 'dark' ? 'dark' : 'light';
  return applyAppearance();
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
  if (canUseTheme(appTheme)) return true;
  setThemeRuntime('default');
  return false;
}

window.rcPrefs = {
  loadThemePrefs,
  saveThemePrefs,
  loadAppearancePrefs,
  saveAppearancePrefs,
  loadDiagnosticsPrefs,
  saveDiagnosticsPrefs
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
  apply: applyAppearance,
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
// Falls back to client-side check only when the server is unreachable.
window.rcUsage = {
  // Returns { allowed, cost, remaining, limit, meta } from server.
  // Await this before any cloud action and block if allowed === false.
  check: async function rcUsageCheck(category) {
    const spent = sessionTokens?.spent || {};
    try {
      const resp = await fetch(
        (typeof apiUrl === 'function' ? apiUrl('/api/usage-check') : '/api/usage-check'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: category, spent }),
          cache: 'no-store',
        }
      );
      if (resp.ok) {
        const data = await resp.json();
        return {
          allowed: !!data.allowed,
          cost: data.cost,
          remaining: data.remaining,
          limit: data.limit,
          meta: data.meta || {},
        };
      }
    } catch (_) {}
    // Server unreachable: degrade to client-side check (safe-free behavior only).
    // BRIDGE: client fallback until server is reliably reachable.
    // Real owner: /api/usage-check + server-resolved policy.
    // This fallback uses the server-resolved limit (from the last successful
    // policy fetch) so it is not a full client-only path.
    const limit = getRuntimeUsageAllowance();
    const totalSpent = Object.values(spent).reduce((a, b) => a + b, 0);
    const cost = TOKEN_COSTS[category] || 0;
    const remaining = Math.max(0, limit - totalSpent);
    return {
      allowed: remaining >= cost,
      cost,
      remaining,
      limit,
      meta: { policySource: 'client-fallback' },
    };
  },
  // Local spend tracking for display/diagnostics. Not enforcement authority.
  spend: function rcUsageSpend(category) {
    try { if (typeof tokenSpend === 'function') tokenSpend(category); } catch (_) {}
  },
};

window.rcEntitlements = {
  getTier: getRuntimeTier,
  getResolvedPolicy: getRuntimePolicy,
  canUseTheme,
  canUseCustomMusic,
  enforceThemeAccess
};

applyResolvedRuntimePolicy(getFallbackRuntimePolicy(appTier), appTier);
loadAppearance();
loadTheme();

