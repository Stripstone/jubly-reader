// Split from original app.js during role-based phase-1 restructure.
// File: tts.js
// Note: This is still global-script architecture (no bundler/modules required).

//  - Browser SpeechSynthesis remains the baseline local path
//  - Cloud TTS policy is resolved server-side via /api/ai?action=tts
// ==============================

// ─── Block-based session model ───────────────────────────────────────────────
//
// Every "Read page" or "Play" starts a session identified by activeSessionId.
// The page text is split into highlight blocks (sentences). All controls —
// Play, Pause, Prev, Next — operate on activeBlockIndex, not time offsets.
//
// State invariants that must hold at all times:
//   TTS_STATE.activeKey           — page key speaking, or null
//   TTS_STATE.activeSessionId     — generation; invalidates stale async ops
//   TTS_STATE.activeBlockIndex    — current block index in highlightMarks
//   TTS_STATE.pausedBlockIndex    — block preserved on pause (-1 when not paused)
//   TTS_STATE.pausedPageKey       — page key preserved on pause
//   TTS_STATE.lastPageKey         — last key ever activated (for restartLast*)
//   TTS_STATE.browserSentenceRanges — char ranges on state (was closure-local)
//   TTS_STATE.browserSpeakFromBlock — re-entry fn for block-level resume/skip
// ─────────────────────────────────────────────────────────────────────────────

const TTS_STATE = {
  activeKey: null,
  activeSessionId: 0,
  activeBlockIndex: -1,
  pausedBlockIndex: -1,
  pausedPageKey: null,
  lastPageKey: null,

  backendCapability: null,
  backendCapabilityKey: null,
  backendCapabilitySessionId: 0,
  backendCapabilityAppliedAt: null,

  audio: null,
  abort: null,
  volume: 1,
  rate: 1,
  voiceVariant: 'female',
  activeBrowserVoiceName: null,
  browserPaused: false,
  browserRestarting: false,
  browserCurrentSentenceIndex: 0,
  browserCurrentCharIndex: 0,
  browserSentenceCount: 0,
  browserVoice: null,
  browserSentenceRanges: null,
  browserSpeakFromBlock: null,
  browserIntentionalCancelUntil: 0,
  browserIntentionalCancelReason: null,
  browserIntentionalCancelMeta: null,
  browserRestartTimerId: 0,
  browserRestartRequestId: 0,
  browserExpectedEntryBlockIndex: -1,

  playbackBlockedReason: '',
  pendingCloudSeekKey: null,
  pendingCloudSeekSessionId: 0,
  pendingCloudSeekBlockIndex: -1,
  pendingCloudSeekLeadMs: 0,
  cloudRestartRequestId: 0,
  cloudRestartInFlight: false,

  highlightMarksProvenance: null,
  highlightPageKey: null,
  highlightPageEl: null,
  highlightOriginalHTML: null,
  highlightRAF: null,
  highlightSpans: null,
  highlightMarks: null,
  highlightEnds: null,
};

const TTS_DEBUG = {
  seq: 0,
  recent: [],
  lastAction: null,
  lastError: null,
  lastCloudRequest: null,
  lastCloudResponse: null,
  lastCapability: null,
  lastPlayRequest: null,
  lastResolvedPath: null,
  lastPauseStrategy: null,
  lastRouteDecision: null,
  lastSkip: null,
};

// ─── Cloud synthesis window state ─────────────────────────────────────────────
//
// Tracks the block-window → full-page promotion lifecycle for a single session.
// Cleared on every new cloud session start and on ttsStop().
//
//   mode:
//     'idle'         — no active window session
//     'block-window' — chunk A (sentences 0+1) is synthesising or playing
//     'promoting'    — full-page fetch is in-flight; chunk A still playing
//     'promoted'     — full-page result is available; switch has been applied
//       or is pending the chunk-A onended handoff
//
//   promotionApplied — true when _ttsWindowApplyPromotion performed the mid-
//       playback src-swap; tells the post-loop code the full page already played.

// Engagement gate constants.
//
//   TTS_WINDOW_ENGAGEMENT_THRESHOLD_S — minimum seconds of real audio playback
//     (audio.currentTime on the chunk-A element) before full-page synthesis is
//     allowed. Uses audio.currentTime so countdown, loading, and pause time are
//     excluded automatically: currentTime only advances during active playback.
//
//   TTS_WINDOW_SMALL_PAGE_CHARS — full-page character threshold below which the
//     entire page is short enough that window mode adds no meaningful savings and
//     full-page synthesis is acceptable immediately. This guard is on the FULL
//     PAGE length, not on chunk A. A page with a short opening sentence but a
//     long body still uses block-window; only a genuinely short full page skips it.

const TTS_WINDOW_ENGAGEMENT_THRESHOLD_S = 3;
const TTS_WINDOW_SMALL_PAGE_CHARS = 200;

const TTS_CLOUD_WINDOW = {
  active: false,
  mode: 'idle',
  sessionId: 0,
  pageKey: null,
  pageText: '',
  chunkASentenceCount: 0,
  promotionTriggered: false,
  promotionApplied: false,
  promotionFetchPromise: null,
  promotionResult: null,
  engagementSignal: null,
  charsPhase1: 0,
  charsFullPage: 0,
  charsSessionTotal: 0,
  // Desired full-page block index from a forward-skip past the chunk-A boundary.
  // Set by ttsJumpSentence; consumed by _ttsWindowApplyPromotion and the Case B
  // handoff in ttsSpeakQueue so the seek targets the intended block, not just the
  // currently-active one.
  pendingSkipBlock: -1,
  // True while a forward skip has been captured during the block-window →
  // full-page promotion seam. While set, extra skip clicks are coalesced into
  // the same pending same-page intent instead of restarting chunk-A audio.
  pendingSkipSettling: false,
};


// Runtime-only memory of pages that have successfully latched full-page cloud
// audio/marks in this tab. This avoids re-entering the fragile chunk-A window
// when the user stops and immediately replays the same page. It is intentionally
// not persisted and is only set after validated full-page marks are live.
const TTS_FULL_PAGE_READY_KEYS = new Set();

function markTtsFullPageReady(key, context = {}) {
  const stableKey = String(key || '');
  if (!stableKey) return false;
  TTS_FULL_PAGE_READY_KEYS.add(stableKey);
  ttsDiagPush('window-full-page-ready-recorded', {
    key: stableKey,
    sessionId: Number(context.sessionId || TTS_STATE.activeSessionId || 0),
    source: String(context.source || 'unknown'),
    marksCount: Number(context.marksCount || 0),
  });
  return true;
}

function hasTtsFullPageReady(key) {
  return TTS_FULL_PAGE_READY_KEYS.has(String(key || ''));
}

function isPassiveTtsWindowPromotionSignal(signal) {
  const value = String(signal || '');
  return value === 'engagement-threshold-met' || value === 'chunk-a-ended-no-engagement' || value === 'chunk-ended-natural';
}

function getTtsCloudMarkCount() {
  return Array.isArray(TTS_STATE.highlightMarks) ? TTS_STATE.highlightMarks.length : 0;
}

function getTtsChunkWindowLimit() {
  const windowCount = Number(TTS_CLOUD_WINDOW.chunkASentenceCount || 0);
  return Math.max(2, Number.isFinite(windowCount) ? windowCount : 0);
}

function isStaleChunkWindowCloudSession() {
  const key = String(TTS_STATE.activeKey || TTS_STATE.pausedPageKey || '');
  if (!key || !TTS_STATE.audio) return false;
  const marksCount = getTtsCloudMarkCount();
  const chunkLimit = getTtsChunkWindowLimit();
  const lastCapabilityCount = Number(TTS_DEBUG.lastCapability?.returnedMarksCount || 0);
  const audioEnded = !!TTS_STATE.audio.ended;
  const paused = !!TTS_STATE.audio.paused;
  const chunkOnlyMarks = marksCount > 0 && marksCount <= chunkLimit;
  const chunkOnlyCapability = lastCapabilityCount > 0 && lastCapabilityCount <= chunkLimit;
  // Only ended chunk-window audio is stale. A paused, non-ended Phase 1 session
  // with 2 valid marks is a real media pause and must resume from audio.currentTime.
  // If natural chunk-end continuation already triggered promotion, it is an
  // in-flight handoff, not a stale Resume target.
  if (TTS_CLOUD_WINDOW.active && TTS_CLOUD_WINDOW.promotionTriggered && !TTS_CLOUD_WINDOW.promotionApplied) return false;
  if (TTS_STATE.cloudRestartInFlight && TTS_CLOUD_WINDOW.active && !TTS_CLOUD_WINDOW.promotionApplied) return false;
  return paused && audioEnded && (chunkOnlyMarks || chunkOnlyCapability);
}

function restoreNaturalWindowStateForHandoff(sessionId, key, pageText, chunkAText, source = 'unknown') {
  if (TTS_STATE.activeSessionId !== sessionId || String(TTS_STATE.activeKey || '') !== String(key || '')) return false;
  if (TTS_CLOUD_WINDOW.active && TTS_CLOUD_WINDOW.sessionId === sessionId && TTS_CLOUD_WINDOW.pageKey === key) return true;

  const text = String(pageText || '');
  const phase1 = String(chunkAText || '');
  const chunkCount = Math.max(2, Number(TTS_CLOUD_WINDOW.chunkASentenceCount || 0) || 2);
  TTS_CLOUD_WINDOW.active = true;
  TTS_CLOUD_WINDOW.mode = 'handoff-pending';
  TTS_CLOUD_WINDOW.sessionId = sessionId;
  TTS_CLOUD_WINDOW.pageKey = key;
  TTS_CLOUD_WINDOW.pageText = text;
  TTS_CLOUD_WINDOW.chunkASentenceCount = chunkCount;
  TTS_CLOUD_WINDOW.promotionTriggered = false;
  TTS_CLOUD_WINDOW.promotionApplied = false;
  TTS_CLOUD_WINDOW.promotionFetchPromise = null;
  TTS_CLOUD_WINDOW.promotionResult = null;
  TTS_CLOUD_WINDOW.charsPhase1 = phase1.length || Number(TTS_CLOUD_WINDOW.charsPhase1 || 0);
  TTS_CLOUD_WINDOW.charsFullPage = text.length || Number(TTS_CLOUD_WINDOW.charsFullPage || 0);
  TTS_CLOUD_WINDOW.charsSessionTotal = TTS_CLOUD_WINDOW.charsPhase1;
  TTS_CLOUD_WINDOW.pendingSkipBlock = -1;
  TTS_CLOUD_WINDOW.pendingSkipSettling = false;
  ttsDiagPush('window-natural-handoff-window-restored', {
    sessionId, key, source,
    chunkASentenceCount: TTS_CLOUD_WINDOW.chunkASentenceCount,
    charsPhase1: TTS_CLOUD_WINDOW.charsPhase1,
    charsFullPage: TTS_CLOUD_WINDOW.charsFullPage,
    activeBlockIndex: Number(TTS_STATE.activeBlockIndex ?? -1),
    reason: 'lost-window-state-before-natural-handoff',
  });
  return true;
}

function ttsBeginNaturalWindowHandoff(sessionId, key, reason = 'chunk-ended-natural') {
  if (!TTS_CLOUD_WINDOW.active || TTS_CLOUD_WINDOW.sessionId !== sessionId) return false;
  if (TTS_STATE.activeSessionId !== sessionId || String(TTS_STATE.activeKey || '') !== String(key || '')) return false;
  if (TTS_CLOUD_WINDOW.promotionApplied) return false;

  const promotionTriggeredBefore = !!TTS_CLOUD_WINDOW.promotionTriggered;
  const promotionReadyBefore = !!TTS_CLOUD_WINDOW.promotionResult;

  if (!promotionTriggeredBefore) {
    try { _ttsWindowTriggerPromotion(reason); } catch (err) {
      ttsDiagPush('window-chunk-ended-natural-trigger-failed', { sessionId, key, reason, error: String(err?.message || err) });
    }
  }

  const promotionReady = !!TTS_CLOUD_WINDOW.promotionResult;
  const promotionPending = !!TTS_CLOUD_WINDOW.promotionFetchPromise && !promotionReady;
  const chunkAEnd = Math.max(0, Number(TTS_CLOUD_WINDOW.chunkASentenceCount || 0));

  TTS_CLOUD_WINDOW.mode = promotionReady ? 'promoted' : 'handoff-pending';
  TTS_STATE.cloudRestartInFlight = true;

  ttsDiagPush('window-chunk-ended-natural', {
    sessionId, key, reason,
    userInitiated: false,
    promotionTriggeredBefore,
    promotionTriggeredAfter: !!TTS_CLOUD_WINDOW.promotionTriggered,
    promotionReadyBefore,
    promotionReady,
    promotionPending,
    chosenHandoffBlock: chunkAEnd,
    activeBlockIndex: Number(TTS_STATE.activeBlockIndex ?? -1),
    chunkASentenceCount: TTS_CLOUD_WINDOW.chunkASentenceCount,
    audioEnded: !!TTS_STATE.audio?.ended,
    audioCurrentTimeMs: TTS_STATE.audio ? Number(TTS_STATE.audio.currentTime || 0) * 1000 : null,
    staleWindowGuard: 'bypassed-natural-continuation',
    ttsCloudMode: TTS_CLOUD_WINDOW.mode,
  });
  return true;
}

function clearTtsCloudWindow() {
  TTS_CLOUD_WINDOW.active = false;
  TTS_CLOUD_WINDOW.mode = 'idle';
  TTS_CLOUD_WINDOW.sessionId = 0;
  TTS_CLOUD_WINDOW.pageKey = null;
  TTS_CLOUD_WINDOW.pageText = '';
  TTS_CLOUD_WINDOW.chunkASentenceCount = 0;
  TTS_CLOUD_WINDOW.promotionTriggered = false;
  TTS_CLOUD_WINDOW.promotionApplied = false;
  TTS_CLOUD_WINDOW.promotionFetchPromise = null;
  TTS_CLOUD_WINDOW.promotionResult = null;
  TTS_CLOUD_WINDOW.engagementSignal = null;
  TTS_CLOUD_WINDOW.charsPhase1 = 0;
  TTS_CLOUD_WINDOW.charsFullPage = 0;
  TTS_CLOUD_WINDOW.charsSessionTotal = 0;
  TTS_CLOUD_WINDOW.pendingSkipBlock = -1;
  TTS_CLOUD_WINDOW.pendingSkipSettling = false;
}

// Split page text into sentence strings preserving trailing whitespace.
// Mirrors server-side splitIntoSentenceRanges but returns strings not ranges.
function ttsWindowRecordForwardSkipIntent(reason, context = {}) {
  if (!TTS_CLOUD_WINDOW.active) return false;
  const delta = Number(context.delta || 0);
  if (delta <= 0) return false;

  const sourceBlock = Number.isFinite(Number(context.sourceBlock))
    ? Number(context.sourceBlock) : Number(TTS_STATE.activeBlockIndex ?? 0);
  const sourcePage = Number.isFinite(Number(context.sourcePage)) ? Number(context.sourcePage) : -1;
  const key = context.key || TTS_STATE.activeKey || TTS_CLOUD_WINDOW.pageKey || '';
  const minFullPageBlock = Math.max(0, Number(TTS_CLOUD_WINDOW.chunkASentenceCount || 0));
  const desiredBlock = Math.max(sourceBlock + 1, minFullPageBlock);
  const existing = Number.isFinite(Number(TTS_CLOUD_WINDOW.pendingSkipBlock))
    ? Number(TTS_CLOUD_WINDOW.pendingSkipBlock) : -1;
  const wasPending = existing >= 0 || TTS_CLOUD_WINDOW.pendingSkipSettling === true;
  const resolvedBlock = Math.max(existing, desiredBlock);

  TTS_CLOUD_WINDOW.pendingSkipBlock = resolvedBlock;
  TTS_CLOUD_WINDOW.pendingSkipSettling = true;

  if (!TTS_CLOUD_WINDOW.promotionTriggered) {
    try { _ttsWindowTriggerPromotion(reason || 'skip-forward-window-deferred'); } catch (_) {}
  }

  const event = wasPending ? 'window-skip-coalesced' : 'window-skip-deferred';
  ttsDiagPush(event, {
    reason,
    key,
    delta,
    sourcePage,
    sourceBlock,
    desiredBlock,
    pendingSkipBlock: TTS_CLOUD_WINDOW.pendingSkipBlock,
    sessionId: TTS_STATE.activeSessionId,
    mode: TTS_CLOUD_WINDOW.mode,
    promotionTriggered: !!TTS_CLOUD_WINDOW.promotionTriggered,
    cloudRestartInFlight: !!TTS_STATE.cloudRestartInFlight,
  });

  const skipResult = {
    at: new Date().toISOString(),
    type: 'block',
    delta,
    sourcePage,
    sourceBlock,
    resolvedPage: sourcePage,
    resolvedBlock: TTS_CLOUD_WINDOW.pendingSkipBlock,
    crossPage: false,
    moved: false,
    queued: true,
    path: wasPending ? 'window-forward-skip-coalesced' : 'window-forward-skip-deferred',
    clippingProtection: false,
    sessionId: TTS_STATE.activeSessionId,
  };
  TTS_DEBUG.lastSkip = skipResult;
  ttsDiagPush('skip-block', skipResult);
  return true;
}

function ttsWindowSplitSentences(text) {
  const src = String(text || '');
  const regex = /[^.!?]*[.!?]+["']?\s*/g;
  const results = [];
  let lastEnd = 0;
  let match;
  while ((match = regex.exec(src)) !== null) {
    results.push(src.slice(match.index, match.index + match[0].length));
    lastEnd = match.index + match[0].length;
  }
  if (lastEnd < src.length) results.push(src.slice(lastEnd));
  return results.filter(s => s.trim().length > 0);
}

function ttsDiagPush(event, data = {}) {
  const entry = { seq: ++TTS_DEBUG.seq, at: new Date().toISOString(), event, data };
  TTS_DEBUG.lastAction = entry;
  TTS_DEBUG.recent.push(entry);
  if (TTS_DEBUG.recent.length > 60) TTS_DEBUG.recent.shift();
  try { if (typeof updateDiagnostics === 'function') updateDiagnostics(); } catch (_) {}
  return entry;
}


function normalizeTtsCapability(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const preciseSeek = raw.preciseSeek && typeof raw.preciseSeek === 'object' ? raw.preciseSeek : {};
  const marks = raw.marks && typeof raw.marks === 'object' ? raw.marks : {};
  const cache = raw.cache && typeof raw.cache === 'object' ? raw.cache : {};
  const artifact = raw.artifact && typeof raw.artifact === 'object' ? raw.artifact : {};
  return {
    provider: raw.provider == null ? null : String(raw.provider || ''),
    preciseSeek: {
      available: !!preciseSeek.available,
      reason: preciseSeek.reason == null ? '' : String(preciseSeek.reason || ''),
      provenance: preciseSeek.provenance == null ? 'none' : String(preciseSeek.provenance || 'none'),
      includedInResponse: !!preciseSeek.includedInResponse,
    },
    marks: {
      requested: !!marks.requested,
      includedInResponse: !!marks.includedInResponse,
      provenance: marks.provenance == null ? 'none' : String(marks.provenance || 'none'),
      cacheStatus: marks.cacheStatus == null ? null : String(marks.cacheStatus || ''),
    },
    cache: {
      audio: { status: cache && cache.audio ? (cache.audio.status == null ? null : String(cache.audio.status || '')) : null },
      marks: { status: cache && cache.marks ? (cache.marks.status == null ? null : String(cache.marks.status || '')) : null },
    },
    artifact: {
      version: artifact.version == null ? null : String(artifact.version || ''),
      hash: artifact.hash == null ? null : String(artifact.hash || ''),
    },
  };
}

function getTtsCapabilityStatus() {
  const backend = TTS_STATE.backendCapability ? JSON.parse(JSON.stringify(TTS_STATE.backendCapability)) : null;
  const pageKey = TTS_STATE.backendCapabilityKey || TTS_STATE.activeKey || TTS_STATE.pausedPageKey || null;
  const sentenceMarksRequested = !!(backend && backend.marks && backend.marks.requested);
  const marksReturnedCount = Array.isArray(TTS_STATE.highlightMarks) ? TTS_STATE.highlightMarks.length : 0;
  const runtimeHighlight = TTS_STATE.highlightMarksProvenance || 'none';
  let authority = 'none';
  let mismatch = null;
  if (backend) {
    authority = 'backend-capability';
    if (backend.preciseSeek.available && sentenceMarksRequested && !backend.marks.includedInResponse) {
      mismatch = 'precise-seek-available-but-marks-not-included';
    } else if (!backend.preciseSeek.available && runtimeHighlight === 'timed') {
      mismatch = 'timed-highlight-without-backend-precise-seek';
    }
  } else if (runtimeHighlight !== 'none') {
    authority = 'legacy-runtime-inference';
    mismatch = 'backend-capability-missing';
  }
  const usingTimedMarks = runtimeHighlight === 'timed';
  return {
    authority,
    pageKey,
    sessionId: Number(TTS_STATE.backendCapabilitySessionId || TTS_STATE.activeSessionId || 0),
    appliedAt: TTS_STATE.backendCapabilityAppliedAt || null,
    backend,
    runtime: {
      highlightProvenance: runtimeHighlight,
      usingTimedMarks,
      usingEstimatedMarks: runtimeHighlight === 'estimated',
      marksReturnedCount,
      preciseSeekReadyNow: !!(backend && backend.preciseSeek && backend.preciseSeek.available && backend.marks && backend.marks.includedInResponse && usingTimedMarks),
    },
    mismatch,
  };
}

function applyCloudCapabilityForRuntime({ key, sessionId, capability, sentenceMarks } = {}) {
  const normalized = normalizeTtsCapability(capability);
  TTS_STATE.backendCapability = normalized;
  TTS_STATE.backendCapabilityKey = key ? String(key) : null;
  TTS_STATE.backendCapabilitySessionId = Number(sessionId || 0) || 0;
  TTS_STATE.backendCapabilityAppliedAt = new Date().toISOString();

  const returnedMarksCount = Array.isArray(sentenceMarks) ? sentenceMarks.length : 0;
  const summary = {
    authority: normalized ? 'backend-capability' : 'legacy-runtime-inference',
    key: key ? String(key) : null,
    sessionId: Number(sessionId || 0) || 0,
    provider: normalized?.provider || null,
    preciseSeekAvailable: !!normalized?.preciseSeek?.available,
    preciseSeekReason: normalized?.preciseSeek?.reason || (returnedMarksCount > 0 ? 'legacy-sentence-marks-only' : 'backend-capability-missing'),
    preciseSeekProvenance: normalized?.preciseSeek?.provenance || 'none',
    marksRequested: !!normalized?.marks?.requested,
    marksIncludedInResponse: !!normalized?.marks?.includedInResponse,
    returnedMarksCount,
    marksProvenance: normalized?.marks?.provenance || 'none',
    audioCacheStatus: normalized?.cache?.audio?.status || null,
    marksCacheStatus: normalized?.cache?.marks?.status || null,
    artifactVersion: normalized?.artifact?.version || null,
    artifactHash: normalized?.artifact?.hash || null,
    mismatch: null,
  };
  if (summary.preciseSeekAvailable && summary.marksRequested && !summary.marksIncludedInResponse) {
    summary.mismatch = 'precise-seek-available-but-marks-not-included';
  } else if (!normalized && returnedMarksCount > 0) {
    summary.mismatch = 'backend-capability-missing';
  }
  TTS_DEBUG.lastCapability = summary;
  ttsDiagPush('cloud-capability-applied', summary);
  return summary;
}


function clearTtsBackendCapabilityState() {
  TTS_STATE.backendCapability = null;
  TTS_STATE.backendCapabilityKey = null;
  TTS_STATE.backendCapabilitySessionId = 0;
  TTS_STATE.backendCapabilityAppliedAt = null;
}

function ttsBlockSnapshot() {
  const key = TTS_STATE.activeKey || null;
  const pageIdx = key ? ((typeof readingTargetFromKey === 'function' ? readingTargetFromKey(key) : null)?.pageIndex ?? -1) : -1;
  return {
    sessionId: TTS_STATE.activeSessionId,
    pageKey: key,
    pageIndex: pageIdx,
    blockIndex: TTS_STATE.activeBlockIndex,
    pausedBlockIndex: TTS_STATE.pausedBlockIndex,
    pausedPageKey: TTS_STATE.pausedPageKey,
    playback: getPlaybackStatus(),
  };
}

function ttsExcerptText(value, maxLen = 96) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

function ttsGetPageTextForKey(key) {
  const parsed = (typeof readingTargetFromKey === 'function') ? readingTargetFromKey(String(key || '')) : null;
  const pageIndex = parsed ? parsed.pageIndex : -1;
  if (!Number.isFinite(pageIndex) || pageIndex < 0) return { pageIndex: -1, text: '', pageEl: null, textEl: null };
  const pageEl = document.querySelectorAll('.page')[pageIndex] || null;
  const textEl = pageEl ? pageEl.querySelector('.page-text') : null;
  const text = String(textEl ? (textEl.textContent || '') : '');
  return { pageIndex, text, pageEl, textEl };
}

function ttsGetBlockPreview(key, blockIdx) {
  const target = Number(blockIdx);
  if (!Number.isFinite(target) || target < 0) return null;
  const page = ttsGetPageTextForKey(key);
  const text = String(page.text || '');
  const browserRanges = Array.isArray(TTS_STATE.browserSentenceRanges) ? TTS_STATE.browserSentenceRanges : null;
  const highlightRanges = Array.isArray(TTS_STATE.highlightMarks) ? TTS_STATE.highlightMarks : null;
  const browserRange = browserRanges && browserRanges[target];
  const highlightRange = highlightRanges && highlightRanges[target];
  const range = browserRange || highlightRange;
  if (!range) return {
    pageIndex: page.pageIndex,
    blockIndex: target,
    rangeSource: browserRange ? 'browser-ranges' : (highlightRange ? 'highlight-marks' : 'none'),
    text: '',
    excerpt: '',
    start: -1,
    end: -1,
  };
  const start = Number.isFinite(Number(range.start)) ? Number(range.start) : -1;
  const end = Number.isFinite(Number(range.end)) ? Number(range.end) : -1;
  const slice = (start >= 0 && end >= start && text) ? text.slice(start, end) : '';
  return {
    pageIndex: page.pageIndex,
    blockIndex: target,
    rangeSource: browserRange ? 'browser-ranges' : 'highlight-marks',
    text: slice,
    excerpt: ttsExcerptText(slice),
    start,
    end,
  };
}

// ─── Voice / support ─────────────────────────────────────────────────────────

function getStoredSelectedVoice() {
  try { return String(window.__rcSessionVoiceSelection || ''); } catch (_) { return ''; }
}

function getSelectedVoicePreference() {
  const stored = getStoredSelectedVoice();
  const type = stored.startsWith('cloud:') || stored.startsWith('polly:') || stored.startsWith('azure:') ? 'cloud' : (stored ? 'browser' : 'auto');
  return {
    stored, type,
    explicitCloud: type === 'cloud',
    requestedCloudVoiceId: type === 'cloud' ? stored.replace(/^(cloud:|polly:|azure:)/, '') : null,
  };
}

// ─── Safari audio unlock ──────────────────────────────────────────────────────

let TTS_AUDIO_UNLOCKED = false;
const TTS_AUDIO_ELEMENT = new Audio();
TTS_AUDIO_ELEMENT.preload = 'auto';
try {
  const savedRate = Number(TTS_STATE.rate || 1) || 1;
  TTS_STATE.rate = savedRate;
  TTS_AUDIO_ELEMENT.defaultPlaybackRate = savedRate;
  TTS_AUDIO_ELEMENT.playbackRate = savedRate;
} catch (_) {}

const TTS_SILENT_SRC = 'data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAA';

function ttsUnlockAudio() {
  if (TTS_AUDIO_ELEMENT.loop) return;
  try {
    TTS_AUDIO_ELEMENT.pause();
    TTS_AUDIO_ELEMENT.src = TTS_SILENT_SRC;
    TTS_AUDIO_ELEMENT.volume = 0;
    const p = TTS_AUDIO_ELEMENT.play();
    if (p && typeof p.then === 'function') {
      p.then(() => { TTS_AUDIO_UNLOCKED = true; }).catch(() => {});
    } else { TTS_AUDIO_UNLOCKED = true; }
  } catch (_) {}
}

// ─── Autoplay ────────────────────────────────────────────────────────────────

const AUTOPLAY_STATE = {
  enabled: false,
  countdownPageIndex: -1,
  countdownSec: 0,
  countdownTimerId: null,
  countdownDeadlineTs: 0,
};

const AUTOPLAY_NEXT_DELAY_MS = 3000;

function queuePendingCloudSeek(key, sessionId, blockIdx, leadMs = 0) {
  TTS_STATE.pendingCloudSeekKey = String(key || '');
  TTS_STATE.pendingCloudSeekSessionId = Number(sessionId || 0) || 0;
  TTS_STATE.pendingCloudSeekBlockIndex = Number.isFinite(Number(blockIdx)) ? Number(blockIdx) : -1;
  TTS_STATE.pendingCloudSeekLeadMs = Number.isFinite(Number(leadMs)) ? Math.max(0, Number(leadMs)) : 0;
}

function clearPendingCloudSeek() {
  TTS_STATE.pendingCloudSeekKey = null;
  TTS_STATE.pendingCloudSeekSessionId = 0;
  TTS_STATE.pendingCloudSeekBlockIndex = -1;
  TTS_STATE.pendingCloudSeekLeadMs = 0;
}

function clearCloudRestartTransition(opts = {}) {
  const audio = TTS_STATE.audio;
  const shouldUnmute = opts.unmute !== false;
  TTS_STATE.cloudRestartInFlight = false;
  if (opts.invalidateRequest !== false) {
    TTS_STATE.cloudRestartRequestId = Number(TTS_STATE.cloudRestartRequestId || 0) + 1;
  }
  if (shouldUnmute && audio) {
    try { audio.muted = false; } catch (_) {}
  }
}

function isCloudRestartTransitionActive() {
  return !!TTS_STATE.audio && !!TTS_STATE.cloudRestartInFlight;
}

function clearPendingBrowserRestartTimer() {
  const timerId = Number(TTS_STATE.browserRestartTimerId || 0);
  if (timerId > 0) {
    try { clearTimeout(timerId); } catch (_) {}
  }
  TTS_STATE.browserRestartTimerId = 0;
}

function resetBrowserRestartOwnership() {
  clearPendingBrowserRestartTimer();
  TTS_STATE.browserRestarting = false;
  TTS_STATE.browserRestartRequestId = 0;
  TTS_STATE.browserExpectedEntryBlockIndex = -1;
}

function isBrowserStaleEntryBlock(blockIdx) {
  const expected = Number(TTS_STATE.browserExpectedEntryBlockIndex);
  return Number.isFinite(expected) && expected >= 0 && Number(blockIdx) !== expected;
}

function isRecoverablePlaybackFailure(err) {
  const msg = String(err && err.message ? err.message : err || '');
  // Recoverable failures should surface clearly but must not permanently lock
  // playback controls. In particular, transient cloud/server transport issues
  // (for example websocket 1006 / unable-to-contact-server) should leave Play
  // immediately retryable after the failed session is cleaned up.
  return /audio playback failed|stale-phase1-promotion-result|notallowederror|interrupted|notsupportederror|mediaerror|unable to contact server|statuscode:\s*1006|failed to fetch|networkerror|network request failed|timeout|timed out|service unavailable|bad gateway|gateway timeout|tts request failed \(5\d\d\)|server error/i.test(msg);
}

function isRecoverableBrowserUtteranceError(evt) {
  const code = String(evt && (evt.error || evt.name || evt.type) ? (evt.error || evt.name || evt.type) : '').toLowerCase();
  return /interrupted|canceled|cancelled|audio-busy/.test(code);
}

function applyPendingCloudSeekIfNeeded(audio, key, sessionId, reason) {
  if (!audio || !key) return false;
  if (String(TTS_STATE.pendingCloudSeekKey || '') !== String(key)) return false;
  if (Number(TTS_STATE.pendingCloudSeekSessionId || 0) !== Number(sessionId || 0)) return false;
  const target = Number(TTS_STATE.pendingCloudSeekBlockIndex);
  const marks = TTS_STATE.highlightMarks;
  if (!Array.isArray(marks) || !marks.length || !Number.isFinite(target) || target < 0 || target >= marks.length) return false;
  const leadMs = Number.isFinite(Number(TTS_STATE.pendingCloudSeekLeadMs)) ? Math.max(0, Number(TTS_STATE.pendingCloudSeekLeadMs)) : 0;
  const rawTimeS = Number(marks[target].time || 0) / 1000;
  const seekTime = Math.max(0, rawTimeS - leadMs / 1000);
  try {
    audio.currentTime = seekTime;
    TTS_STATE.activeBlockIndex = target;
    ttsHighlightBlock(target);
    if (isRuntimePausedForContract()) {
      TTS_STATE.pausedBlockIndex = target;
      TTS_STATE.pausedPageKey = key;
    }
    clearPendingCloudSeek();
    ttsDiagPush('cloud-seek-applied', { key, sessionId, blockIndex: target, seekTime, leadMs, reason: reason || 'media-ready' });
    return true;
  } catch (_) {
    return false;
  }
}

function ttsKeepWarmForAutoplay() {
  if (!AUTOPLAY_STATE.enabled) return;
  try {
    TTS_AUDIO_ELEMENT.loop = true;
    TTS_AUDIO_ELEMENT.src = TTS_SILENT_SRC;
    TTS_AUDIO_ELEMENT.volume = 0;
    TTS_AUDIO_ELEMENT.play().catch(() => {});
  } catch (_) {}
}

function ttsSetButtonActive(key, active) {
  try {
    const _parsed = (typeof readingTargetFromKey === 'function') ? readingTargetFromKey(key) : null;
    if (!_parsed) return;
    const pageIndex = _parsed.pageIndex;
    if (!Number.isFinite(pageIndex)) return;
    const pageEl = document.querySelectorAll('.page')[pageIndex];
    if (!pageEl) return;
    const btn = pageEl.querySelector('.tts-btn[data-tts="page"]');
    if (btn) btn.classList.toggle('tts-active', active);
  } catch (_) {}
}

function ttsSetHintButton(key, disabled) {
  try {
    const _parsed = (typeof readingTargetFromKey === 'function') ? readingTargetFromKey(key) : null;
    if (!_parsed) return;
    const pageIndex = _parsed.pageIndex;
    if (!Number.isFinite(pageIndex)) return;
    const pageEl = document.querySelectorAll('.page')[pageIndex];
    if (!pageEl) return;
    const btn = pageEl.querySelector('.hint-btn');
    if (btn) btn.disabled = disabled;
  } catch (_) {}
}

function ttsAutoplayCancelCountdown() {
  const idx = AUTOPLAY_STATE.countdownPageIndex;
  if (AUTOPLAY_STATE.countdownTimerId) clearInterval(AUTOPLAY_STATE.countdownTimerId);
  AUTOPLAY_STATE.countdownTimerId = null;
  AUTOPLAY_STATE.countdownDeadlineTs = 0;
  AUTOPLAY_STATE.countdownPageIndex = -1;
  AUTOPLAY_STATE.countdownSec = 0;
  try {
    const pageEls = document.querySelectorAll('.page');
    if (idx >= 0 && pageEls[idx]) {
      const btn = pageEls[idx].querySelector('.tts-btn[data-tts="page"]');
      if (btn) { btn.textContent = '🔊 Read page'; btn.classList.remove('tts-active'); }
    }
  } catch (_) {}
}

function applyAutoplayRuntimePreference(enabled, opts = {}) {
  const next = !!enabled;
  AUTOPLAY_STATE.enabled = next;
  if (!next) ttsAutoplayCancelCountdown();
  if (opts.syncControl !== false) {
    try {
      const checkbox = document.getElementById('autoplayToggle');
      if (checkbox) checkbox.checked = next;
    } catch (_) {}
  }
  if (opts.persist !== false) {
    try { localStorage.setItem('rc_autoplay', next ? '1' : '0'); } catch (_) {}
  }
  ttsDiagPush('autoplay-runtime-applied', {
    enabled: next,
    source: String(opts.source || 'unknown'),
    persisted: opts.persist !== false,
    syncedControl: opts.syncControl !== false,
  });
  return AUTOPLAY_STATE.enabled;
}

function ttsBuildPageHandoffTarget(input = {}) {
  const raw = (typeof input === 'number') ? { pageIndex: input } : (input || {});
  const baseFromKey = (typeof readingTargetFromKey === 'function' && raw.key) ? readingTargetFromKey(String(raw.key)) : null;
  const baseFromTarget = raw.targetContext && typeof raw.targetContext === 'object' ? raw.targetContext : null;
  const baseFromReading = window.__rcReadingTarget || null;
  const base = baseFromKey || baseFromTarget || baseFromReading || {};
  const currentIndex = Number.isFinite(Number(raw.pageIndex)) ? Number(raw.pageIndex) : Number(base.pageIndex);
  const delta = Number.isFinite(Number(raw.delta)) ? Number(raw.delta) : 1;
  const nextIndex = Number.isFinite(currentIndex) ? currentIndex + (delta < 0 ? -1 : 1) : NaN;
  if (!Number.isFinite(nextIndex) || nextIndex < 0) return null;
  if (typeof pages === 'undefined' || !pages[nextIndex]) return null;
  return {
    currentIndex: Number.isFinite(currentIndex) ? currentIndex : -1,
    nextIndex,
    sourceType: base.sourceType || '',
    bookId: base.bookId || '',
    chapterIndex: base.chapterIndex != null ? base.chapterIndex : -1,
    text: pages[nextIndex],
    targetBlockIndex: Number.isFinite(Number(raw.targetBlockIndex)) ? Number(raw.targetBlockIndex) : 0,
    behavior: raw.behavior || 'smooth',
    reason: raw.reason || '',
  };
}

function ttsRunPageHandoff(input = {}) {
  const mode = String(input.mode || 'speak');
  const resolved = ttsBuildPageHandoffTarget(input);
  if (!resolved) return false;
  const { currentIndex, nextIndex, sourceType, bookId, chapterIndex, text, targetBlockIndex, behavior, reason } = resolved;
  const focusResult = (typeof window.focusReadingPage === 'function')
    ? window.focusReadingPage(nextIndex, { behavior })
    : { ok: false };
  if ((!focusResult || focusResult.ok === false) && behavior) {
    try {
      const pageEls = document.querySelectorAll('.page');
      const nextPageEl = pageEls[nextIndex];
      if (nextPageEl) nextPageEl.scrollIntoView({ behavior, block: 'start' });
    } catch (_) {}
  }
  if (typeof setReadingTarget === 'function') {
    setReadingTarget({ sourceType, bookId, chapterIndex, pageIndex: nextIndex });
  }
  const nextTarget = window.__rcReadingTarget || { sourceType, bookId, chapterIndex, pageIndex: nextIndex };
  const nextKey = (typeof readingTargetToKey === 'function') ? readingTargetToKey(nextTarget) : `page-${nextIndex}`;
  TTS_STATE.playbackBlockedReason = '';
  clearPendingCloudSeek();

  if (mode === 'paused') {
    if (TTS_STATE.audio) {
      void ttsPreparePausedCloudPage(nextIndex);
    } else {
      browserSpeakQueue(nextKey, [text], { startPaused: true, pausedBlockIndex: targetBlockIndex });
    }
  } else if (mode === 'speak') {
    try { ttsKeepWarmForAutoplay(); } catch (_) {}
    ttsSpeakQueue(nextKey, [text]);
  }

  TTS_DEBUG.lastSkip = {
    at: new Date().toISOString(),
    type: 'page',
    resolved: 'page-handoff',
    sourcePageIndex: currentIndex,
    targetPageIndex: nextIndex,
    mode,
    reason: reason || '',
    activeKey: TTS_STATE.activeKey || null,
  };
  ttsDiagPush('page-handoff', TTS_DEBUG.lastSkip);
  return true;
}

function ttsAutoplayScheduleNext(pageInfo) {
  if (!AUTOPLAY_STATE.enabled) return;
  const resolved = ttsBuildPageHandoffTarget(typeof pageInfo === 'number' ? { pageIndex: pageInfo, reason: 'autoplay-countdown' } : { ...(pageInfo || {}), reason: (pageInfo && pageInfo.reason) || 'autoplay-countdown' });
  if (!resolved) return;
  const pageEls = document.querySelectorAll('.page');
  const currentPageEl = pageEls[resolved.currentIndex];
  if (!currentPageEl) return;
  const btn = currentPageEl.querySelector('.tts-btn[data-tts="page"]');
  if (!btn) return;
  ttsAutoplayCancelCountdown();
  AUTOPLAY_STATE.countdownPageIndex = resolved.currentIndex;
  AUTOPLAY_STATE.countdownDeadlineTs = Date.now() + AUTOPLAY_NEXT_DELAY_MS;
  AUTOPLAY_STATE.countdownSec = Math.max(1, Math.ceil(AUTOPLAY_NEXT_DELAY_MS / 1000));
  btn.classList.add('tts-active');
  const updateBtn = () => { try { btn.textContent = `⏸ Next in ${AUTOPLAY_STATE.countdownSec}…`; } catch (_) {} };
  updateBtn();
  AUTOPLAY_STATE.countdownTimerId = setInterval(() => {
    const remainingMs = Math.max(0, Number(AUTOPLAY_STATE.countdownDeadlineTs || 0) - Date.now());
    AUTOPLAY_STATE.countdownSec = Math.max(0, Math.ceil(remainingMs / 1000));
    if (remainingMs <= 0) {
      ttsAutoplayCancelCountdown();
      ttsRunPageHandoff({
        pageIndex: resolved.currentIndex,
        targetContext: { sourceType: resolved.sourceType, bookId: resolved.bookId, chapterIndex: resolved.chapterIndex, pageIndex: resolved.currentIndex },
        mode: 'speak',
        behavior: 'smooth',
        reason: 'autoplay-countdown-complete',
      });
    } else {
      updateBtn();
    }
  }, 1000);
}

// ─── Sentence / block utilities ───────────────────────────────────────────────

function optsForKeySentenceMarks(key) {
  if (typeof key !== 'string') return false;
  if (key.startsWith('rt|')) return true;     // full-context reading target key (post-refactor)
  if (key.startsWith('page-')) return true;   // legacy bare key (transient backward compat on load)
  return false;
}

function utf8ByteOffsetToJsIndex(str, byteOffset) {
  const enc = new TextEncoder();
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const cp = str.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    bytes += enc.encode(ch).length;
    if (bytes > byteOffset) return i;
    if (cp > 0xFFFF) i++;
  }
  return str.length;
}

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function splitIntoSentenceRanges(text) {
  const source = String(text || '');
  const sentenceRegex = /[^.!?]*[.!?]+["']?\s*/g;
  const ranges = [];
  let match;
  let lastEnd = 0;
  while ((match = sentenceRegex.exec(source)) !== null) {
    const end = match.index + match[0].length;
    ranges.push({ start: match.index, end });
    lastEnd = end;
  }
  // Preserve visible trailing text even when it has no terminal punctuation.
  // This keeps TTS/highlight blocks aligned with .page-text content such as
  // form rows or box labels that end without a period.
  if (lastEnd < source.length) ranges.push({ start: lastEnd, end: source.length });
  if (!ranges.length) ranges.push({ start: 0, end: source.length });
  return ranges.filter(r => r.end > r.start);
}

// ─── Highlight ────────────────────────────────────────────────────────────────

function ttsClearSentenceHighlight() {
  if (TTS_STATE.highlightRAF) { cancelAnimationFrame(TTS_STATE.highlightRAF); TTS_STATE.highlightRAF = null; }
  TTS_STATE.highlightMarksProvenance = null;
  if (TTS_STATE.highlightPageEl && TTS_STATE.highlightOriginalHTML != null) {
    TTS_STATE.highlightPageEl.innerHTML = TTS_STATE.highlightOriginalHTML;
    try {
      const pageEl = TTS_STATE.highlightPageEl.closest('.page');
      if (pageEl) { const hintBtn = pageEl.querySelector('.hint-btn'); if (hintBtn) hintBtn.disabled = false; }
    } catch (_) {}
  }
  TTS_STATE.highlightPageKey = null;
  TTS_STATE.highlightPageEl = null;
  TTS_STATE.highlightOriginalHTML = null;
  TTS_STATE.highlightSpans = null;
  TTS_STATE.highlightMarks = null;
  TTS_STATE.highlightEnds = null;
}

function ttsHighlightBlock(blockIdx) {
  if (!TTS_STATE.highlightSpans) return;
  TTS_STATE.highlightSpans.forEach((span, i) => {
    span.style.setProperty('--tts-alpha', i === blockIdx ? '1' : '0');
  });
  // Keep TTS_STATE.activeBlockIndex consistent with visual highlight
  // so skip/pause/resume all read from a single source of truth.
  if (blockIdx >= 0) TTS_STATE.activeBlockIndex = blockIdx;
  try {
    const pane = TTS_STATE.highlightPageEl;
    const cur = (pane && blockIdx >= 0) ? TTS_STATE.highlightSpans[blockIdx] : null;
    if (pane && cur) {
      const styles = window.getComputedStyle ? window.getComputedStyle(pane) : null;
      const overflowY = styles ? String(styles.overflowY || '').toLowerCase() : '';
      const paneIsScrollable = (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
        && (pane.scrollHeight > pane.clientHeight + 4);
      if (paneIsScrollable) {
        const viewTop = pane.scrollTop;
        const viewBottom = viewTop + pane.clientHeight;
        const blockTop = cur.offsetTop;
        const blockBottom = blockTop + cur.offsetHeight;
        const edgePad = Math.max(24, Math.min(96, Math.round(pane.clientHeight * 0.18)));
        const desiredTop = viewTop + edgePad;
        const desiredBottom = viewBottom - edgePad;
        if (blockTop < desiredTop || blockBottom > desiredBottom) {
          const centered = blockTop - (pane.clientHeight / 2) + (cur.offsetHeight / 2);
          const maxScroll = Math.max(0, pane.scrollHeight - pane.clientHeight);
          pane.scrollTop = Math.max(0, Math.min(centered, maxScroll));
        }
      }
    }
  } catch (_) {}
}

function ttsMaybePrepareSentenceHighlight(key, rawText, marks) {
  if (!optsForKeySentenceMarks(key) || !Array.isArray(marks) || !marks.length) return;
  const _parsed = (typeof readingTargetFromKey === 'function') ? readingTargetFromKey(key) : null;
  const pageIndex = _parsed ? _parsed.pageIndex : -1;
  if (!Number.isFinite(pageIndex) || pageIndex < 0) return;
  const pageEl = document.querySelectorAll('.page')[pageIndex];
  if (!pageEl) return;
  const textEl = pageEl.querySelector('.page-text');
  if (!textEl) return;
  ttsClearSentenceHighlight();
  const text = String(rawText || textEl.textContent || '');
  const spansHtml = [];
  const spansMeta = [];
  const ranges = marks.map(m => {
    const start = utf8ByteOffsetToJsIndex(text, m.start);
    const end = utf8ByteOffsetToJsIndex(text, m.end);
    return { time: Number(m.time) || 0, start, end };
  }).filter(r => r.end > r.start);
  if (!ranges.length) return;
  let cursor = 0;
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (r.start > cursor) spansHtml.push(escapeHTML(text.slice(cursor, r.start)));
    spansHtml.push(`<span class="tts-sentence" data-tts-sent="${i}">${escapeHTML(text.slice(r.start, r.end))}</span>`);
    spansMeta.push(r);
    cursor = r.end;
  }
  if (cursor < text.length) spansHtml.push(escapeHTML(text.slice(cursor)));
  TTS_STATE.highlightPageKey = key;
  TTS_STATE.highlightPageEl = textEl;
  TTS_STATE.highlightOriginalHTML = textEl.innerHTML;
  TTS_STATE.highlightMarks = spansMeta;
  TTS_STATE.highlightEnds = spansMeta.map((r, i) => i + 1 < spansMeta.length ? spansMeta[i + 1].time : Infinity);
  TTS_STATE.highlightMarksProvenance = 'timed';
  textEl.innerHTML = spansHtml.join('');
  TTS_STATE.highlightSpans = Array.from(textEl.querySelectorAll('.tts-sentence'));
  try { const h = pageEl.querySelector('.hint-btn'); if (h) h.disabled = true; } catch (_) {}
}

function ttsPrepareEstimatedHighlight(key, rawText, audio) {
  if (!optsForKeySentenceMarks(key) || !rawText || !audio) return;
  const _parsed = (typeof readingTargetFromKey === 'function') ? readingTargetFromKey(key) : null;
  const pageIndex = _parsed ? _parsed.pageIndex : -1;
  if (!Number.isFinite(pageIndex) || pageIndex < 0) return;
  const pageEl = document.querySelectorAll('.page')[pageIndex];
  if (!pageEl) return;
  const textEl = pageEl.querySelector('.page-text');
  if (!textEl) return;
  ttsClearSentenceHighlight();
  const text = String(rawText || textEl.textContent || '');
  const charRanges = splitIntoSentenceRanges(text);
  const spansHtml = [];
  let cursor = 0;
  for (let i = 0; i < charRanges.length; i++) {
    const r = charRanges[i];
    if (r.start > cursor) spansHtml.push(escapeHTML(text.slice(cursor, r.start)));
    spansHtml.push(`<span class="tts-sentence" data-tts-sent="${i}">${escapeHTML(text.slice(r.start, r.end))}</span>`);
    cursor = r.end;
  }
  if (cursor < text.length) spansHtml.push(escapeHTML(text.slice(cursor)));
  TTS_STATE.highlightPageKey = key;
  TTS_STATE.highlightPageEl = textEl;
  TTS_STATE.highlightOriginalHTML = textEl.innerHTML;
  textEl.innerHTML = spansHtml.join('');
  TTS_STATE.highlightSpans = Array.from(textEl.querySelectorAll('.tts-sentence'));
  try { const h = pageEl.querySelector('.hint-btn'); if (h) h.disabled = true; } catch (_) {}
  function buildTimings(duration) {
    const totalChars = charRanges.reduce((s, r) => s + (r.end - r.start), 0) || 1;
    let elapsed = 0;
    const m = charRanges.map(r => {
      const frac = (r.end - r.start) / totalChars;
      const t = elapsed * 1000;
      elapsed += frac * duration;
      return { time: t, start: r.start, end: r.end };
    });
    TTS_STATE.highlightMarks = m;
    TTS_STATE.highlightEnds = m.map((x, i) => i + 1 < m.length ? m[i + 1].time : Infinity);
    TTS_STATE.highlightMarksProvenance = 'estimated';
  }
  buildTimings(60);
  let refined = false;
  function onTimeUpdate() {
    if (refined) return;
    if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
      refined = true; buildTimings(audio.duration);
      audio.removeEventListener('timeupdate', onTimeUpdate);
    }
  }
  audio.addEventListener('timeupdate', onTimeUpdate);
}

// Highlight loop for server-resolved cloud path. Updates TTS_STATE.activeBlockIndex as audio advances.
function ttsStartHighlightLoop(audio) {
  if (!audio || !TTS_STATE.highlightSpans || !TTS_STATE.highlightMarks) return;
  let lastIdx = -1;
  let isFirstTick = true;
  const tick = () => {
    if (!TTS_STATE.audio || TTS_STATE.audio !== audio) return;
    if (!TTS_STATE.highlightSpans || !TTS_STATE.highlightMarks) return;
    const t = audio.currentTime * 1000;
    let idx = -1;
    const marks = TTS_STATE.highlightMarks;
    const ends = TTS_STATE.highlightEnds || [];
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].time;
      const end = ends[i] ?? Infinity;
      if (t >= start && t < end) { idx = i; break; }
    }

    // First tick after loop restart: log proof surface for seek boundary analysis.
    if (isFirstTick) {
      isFirstTick = false;
      ttsDiagPush('raf-first-tick', {
        audioCurrentTimeMs: t,
        computedIdx: idx,
        markTimeMs: (idx >= 0 && marks[idx]) ? marks[idx].time : null,
      });
    }

    if (idx !== lastIdx) {
      // Track active block on state — this is what skip and pause read.
      if (idx >= 0) TTS_STATE.activeBlockIndex = idx;
      ttsHighlightBlock(idx);
      lastIdx = idx;
      // Window promotion gate — checked on every block transition once block 1
      // is reached. All three conditions must hold simultaneously:
      //
      //   1. idx >= 1  — user has progressed past the first block
      //   2. audio.currentTime >= threshold  — at least 3 s of real audio played;
      //        currentTime only advances during active playback so countdown,
      //        loading delays, and paused time are excluded automatically
      //   3. !audio.paused  — playback is live, not paused
      //
      // Pause during block 1 never satisfies (3) so it never promotes.
      // A pause on block 1+ after threshold is already met is fine: the promotion
      // fetch launched before the pause and the result will be waiting.
      if (idx >= 1 && TTS_CLOUD_WINDOW.active && !TTS_CLOUD_WINDOW.promotionTriggered) {
        const _wa = TTS_STATE.audio;
        const _playing = !!(_wa && !_wa.paused && !_wa.ended);
        const _elapsed = _wa ? Number(_wa.currentTime || 0) : 0;
        if (_playing && _elapsed >= TTS_WINDOW_ENGAGEMENT_THRESHOLD_S) {
          try { _ttsWindowTriggerPromotion('engagement-threshold-met'); } catch (_) {}
        }
      }
    }
    TTS_STATE.highlightRAF = requestAnimationFrame(tick);
  };
  if (TTS_STATE.highlightRAF) cancelAnimationFrame(TTS_STATE.highlightRAF);
  TTS_STATE.highlightRAF = requestAnimationFrame(tick);
}

// ─── Browser TTS: sentence-per-utterance block model ─────────────────────────
//
// Each highlight block (sentence) is one SpeechSynthesisUtterance.
// Block index = utterance index. Skip = cancel + re-enter from target block.
// Pause = set browserPaused + cancel; Resume = re-enter from pausedBlockIndex.
// No boundary-event heuristics needed for block tracking.

function browserTtsSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

function browserTtsStop() {
  if (!browserTtsSupported()) return;
  // Explicit stop/replace/teardown path — cancel is intentional.
  TTS_STATE.browserIntentionalCancelUntil = Date.now() + 1200;
  TTS_STATE.browserIntentionalCancelReason = 'stop-or-replace';
  TTS_STATE.browserIntentionalCancelMeta = { sessionId: TTS_STATE.activeSessionId, key: TTS_STATE.activeKey || null };
  clearPendingBrowserRestartTimer();
  window.speechSynthesis.cancel();
}

function markIntentionalBrowserCancel(reason, meta = {}) {
  TTS_STATE.browserIntentionalCancelUntil = Date.now() + 1200;
  TTS_STATE.browserIntentionalCancelReason = reason;
  TTS_STATE.browserIntentionalCancelMeta = { ...meta, sessionId: TTS_STATE.activeSessionId, key: TTS_STATE.activeKey || null };
  ttsDiagPush('browser-intentional-cancel', {
    reason,
    ...TTS_STATE.browserIntentionalCancelMeta
  });
}

function isIntentionalBrowserCancelForSession(sessionId) {
  const stillActive = Date.now() <= Number(TTS_STATE.browserIntentionalCancelUntil || 0);
  if (!stillActive) return false;
  const metaSession = Number(TTS_STATE.browserIntentionalCancelMeta?.sessionId ?? -1);
  return metaSession === Number(sessionId);
}

function browserPickVoice() {
  try {
    const voices = window.speechSynthesis.getVoices() || [];
    const isMale = String(TTS_STATE.voiceVariant || '').toLowerCase() === 'male';
    const BAD_VOICES = ['Albert','Bad News','Bells','Boing','Bubbles','Cellos','Deranged','Good News','Hysterical','Jester','Organ','Superstar','Whisper','Zarvox','Trinoids'];
    const usable = voices.filter(v => !BAD_VOICES.some(b => v.name.includes(b)));
    const enVoices = usable.filter(v => (v.lang || '').toLowerCase().startsWith('en'));
    try { const saved = getStoredSelectedVoice(); if (saved) { const m = enVoices.find(v => v.name === saved); if (m) return m; } } catch (_) {}
    const femaleNames = ['Aria','Jenny','Samantha','Karen','Moira','Serena','Tessa'];
    const maleNames   = ['Daniel','Rishi','Alex','Guy','Ryan','Fred'];
    const preferred = isMale ? maleNames : femaleNames;
    const fallback  = isMale ? femaleNames : maleNames;
    const findNamed = (nl) => enVoices.find(v => nl.some(n => v.name.includes(n)));
    return findNamed(preferred) || findNamed(fallback) ||
      enVoices.find(v => /Microsoft/i.test(v.name)) ||
      enVoices.find(v => /Google/i.test(v.name)) ||
      enVoices[0] || usable[0] || null;
  } catch (_) { return null; }
}

function browserSpeakQueue(key, parts, opts = {}) {
  const startPaused = !!opts.startPaused;
  const pausedBlockIndex = Number.isFinite(Number(opts.pausedBlockIndex)) ? Number(opts.pausedBlockIndex) : 0;

  TTS_DEBUG.lastResolvedPath = 'browser';
  TTS_DEBUG.lastRouteDecision = getPreferredTtsRouteInfo();
  TTS_DEBUG.lastPlayRequest = { key, parts: (parts || []).length, path: 'browser' };
  ttsDiagPush('browser-speak-request', TTS_DEBUG.lastPlayRequest);

  if (!browserTtsSupported()) {
    TTS_STATE.playbackBlockedReason = 'Text-to-speech is not supported in this browser.';
    ttsDiagPush('browser-unsupported', { key, reason: TTS_STATE.playbackBlockedReason });
    try { if (typeof updateDiagnostics === 'function') updateDiagnostics(); } catch (_) {}
    return;
  }
  const support = getTtsSupportStatus();
  if (!support.browserVoiceAvailable) {
    TTS_STATE.playbackBlockedReason = support.reason || 'No browser voice available';
    TTS_DEBUG.lastError = { at: new Date().toISOString(), path: 'browser', key, message: support.reason || 'No browser voice available' };
    ttsDiagPush('browser-voice-unavailable', { key, reason: TTS_STATE.playbackBlockedReason });
    return;
  }

  const queue = (parts || []).map(t => String(t || '').trim()).filter(Boolean);
  if (!queue.length) return;

  // Skip/Prev/Next contract: when preparing paused state, cancel queued utterances
  // without full stop/reset (tsStop clears paused indices/highlight).
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    if (!startPaused) ttsStop();
    else {
      try {
        markIntentionalBrowserCancel('prepare-paused-session', { startPaused: true, targetBlock: pausedBlockIndex });
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
  }

  const sessionId = ++TTS_STATE.activeSessionId;
  clearTtsBackendCapabilityState();
  clearPendingCloudSeek();
  clearCloudRestartTransition();
  resetBrowserRestartOwnership();
  TTS_STATE.activeKey = key;
  TTS_STATE.lastPageKey = key;
  TTS_STATE.browserPaused = startPaused;
  TTS_STATE.playbackBlockedReason = '';
  TTS_STATE.activeBlockIndex = startPaused ? pausedBlockIndex : -1;
  TTS_STATE.pausedBlockIndex = startPaused ? pausedBlockIndex : -1;
  TTS_STATE.pausedPageKey = startPaused ? key : null;

  ttsSetButtonActive(key, true);
  ttsSetHintButton(key, true);

  const voice = browserPickVoice();
  TTS_STATE.browserVoice = voice || null;
  TTS_STATE.activeBrowserVoiceName = voice ? voice.name : '(default)';

  const isPageRead = optsForKeySentenceMarks(key);
  const text = queue[0] || '';
  const ranges = splitIntoSentenceRanges(text);
  TTS_STATE.browserSentenceRanges = ranges;
  TTS_STATE.browserSentenceCount = ranges.length;

  // Build highlight spans
  if (isPageRead) {
    try {
      const _parsed = (typeof readingTargetFromKey === 'function') ? readingTargetFromKey(key) : null;
      const pageIndex = _parsed ? _parsed.pageIndex : -1;
      const pageEl = document.querySelectorAll('.page')[pageIndex];
      const textEl = pageEl?.querySelector('.page-text');
      if (textEl) {
        ttsClearSentenceHighlight();
        const spansHtml = [];
        let cursor = 0;
        for (let i = 0; i < ranges.length; i++) {
          const r = ranges[i];
          if (r.start > cursor) spansHtml.push(escapeHTML(text.slice(cursor, r.start)));
          spansHtml.push(`<span class="tts-sentence" data-tts-sent="${i}">${escapeHTML(text.slice(r.start, r.end))}</span>`);
          cursor = r.end;
        }
        if (cursor < text.length) spansHtml.push(escapeHTML(text.slice(cursor)));
        TTS_STATE.highlightPageKey = key;
        TTS_STATE.highlightPageEl = textEl;
        TTS_STATE.highlightOriginalHTML = textEl.innerHTML;
        textEl.innerHTML = spansHtml.join('');
        TTS_STATE.highlightSpans = Array.from(textEl.querySelectorAll('.tts-sentence'));
        // Use integer index as "time" so cloud skip path (ttsJumpSentence) can
        // fall back to the same marks array format without special-casing.
        TTS_STATE.highlightMarks = ranges.map((r, i) => ({ time: i, start: r.start, end: r.end }));
        TTS_STATE.highlightEnds = ranges.map((_, i) => i + 1 < ranges.length ? i + 1 : Infinity);
        try { const h = pageEl.querySelector('.hint-btn'); if (h) h.disabled = true; } catch (_) {}

        if (startPaused && pausedBlockIndex >= 0) {
          // Ensure paused highlight is consistent before Resume.
          try { ttsHighlightBlock(pausedBlockIndex); } catch (_) {}
          TTS_STATE.browserCurrentSentenceIndex = pausedBlockIndex;
          TTS_STATE.activeBlockIndex = pausedBlockIndex;
        }
      }
    } catch (_) {}
  }

  function speakFromBlock(blockIdx, opts = {}) {
    if (TTS_STATE.activeSessionId !== sessionId) return;
    if (TTS_STATE.activeKey !== key) return;

    TTS_STATE.browserCurrentSentenceIndex = blockIdx;
    TTS_STATE.activeBlockIndex = blockIdx;
    ttsHighlightBlock(blockIdx);

    const preview = ttsGetBlockPreview(key, blockIdx);
    ttsDiagPush('browser-block-entry', {
      key,
      blockIdx,
      sessionId,
      highlightBlockIndex: TTS_STATE.activeBlockIndex,
      browserCurrentSentenceIndex: TTS_STATE.browserCurrentSentenceIndex,
      pageIndex: preview?.pageIndex ?? -1,
      excerpt: preview?.excerpt || '',
      rangeSource: preview?.rangeSource || 'none',
      rangeStart: preview?.start ?? -1,
      rangeEnd: preview?.end ?? -1,
    });

    if (blockIdx >= ranges.length) {
      TTS_STATE.activeKey = null;
      TTS_STATE.browserSpeakFromBlock = null;
      ttsSetButtonActive(key, false);
      ttsSetHintButton(key, false);
      ttsClearSentenceHighlight();
      if (isPageRead) {
        const _pp = (typeof readingTargetFromKey === 'function') ? readingTargetFromKey(key) : null;
        const pageIndex = _pp ? _pp.pageIndex : -1;
        if (Number.isFinite(pageIndex) && pageIndex >= 0) ttsAutoplayScheduleNext({ pageIndex, key, reason: 'page-complete' });
      }
      ttsDiagPush('browser-speak-complete', { key, blockCount: ranges.length, sessionId });
      return;
    }

    const requestId = Number.isFinite(Number(opts.restartRequestId)) ? Number(opts.restartRequestId) : 0;
    const entryReason = String(opts.reason || (requestId > 0 ? 'restart-from-block' : 'queue-progress'));
    const r = ranges[blockIdx];
    const sentenceText = text.slice(r.start, r.end);
    const utter = new SpeechSynthesisUtterance(sentenceText);
    utter.lang = 'en-US';
    utter.onstart = () => {
      const startPreview = ttsGetBlockPreview(key, blockIdx);
      if (TTS_STATE.activeSessionId !== sessionId || TTS_STATE.activeKey !== key) {
        ttsDiagPush('browser-stale-utterance-start', {
          key,
          blockIdx,
          sessionId,
          requestId,
          expectedBlockIndex: TTS_STATE.browserExpectedEntryBlockIndex,
          activeSessionId: TTS_STATE.activeSessionId,
          activeKey: TTS_STATE.activeKey || null,
          pageIndex: startPreview?.pageIndex ?? -1,
          excerpt: startPreview?.excerpt || ttsExcerptText(sentenceText),
          reason: 'session-or-page-replaced',
        });
        try {
          markIntentionalBrowserCancel('discard-stale-utterance-start-session-replaced', { key, staleBlock: blockIdx, expectedBlock: TTS_STATE.browserExpectedEntryBlockIndex, requestId });
          window.speechSynthesis.cancel();
        } catch (_) {}
        return;
      }
      if (requestId > 0 && Number(TTS_STATE.browserRestartRequestId || 0) !== requestId) {
        ttsDiagPush('browser-stale-utterance-start', {
          key,
          blockIdx,
          sessionId,
          requestId,
          expectedBlockIndex: TTS_STATE.browserExpectedEntryBlockIndex,
          activeRestartRequestId: TTS_STATE.browserRestartRequestId,
          pageIndex: startPreview?.pageIndex ?? -1,
          excerpt: startPreview?.excerpt || ttsExcerptText(sentenceText),
          reason: 'superseded-by-newer-request',
        });
        try {
          markIntentionalBrowserCancel('discard-stale-utterance-start-superseded', { key, staleBlock: blockIdx, expectedBlock: TTS_STATE.browserExpectedEntryBlockIndex, requestId });
          window.speechSynthesis.cancel();
        } catch (_) {}
        return;
      }
      if (isBrowserStaleEntryBlock(blockIdx)) {
        ttsDiagPush('browser-stale-utterance-start', {
          key,
          blockIdx,
          sessionId,
          requestId,
          expectedBlockIndex: TTS_STATE.browserExpectedEntryBlockIndex,
          highlightBlockIndex: TTS_STATE.activeBlockIndex,
          pageIndex: startPreview?.pageIndex ?? -1,
          excerpt: startPreview?.excerpt || ttsExcerptText(sentenceText),
          reason: entryReason,
        });
        try {
          markIntentionalBrowserCancel('discard-stale-utterance-start', { key, staleBlock: blockIdx, expectedBlock: TTS_STATE.browserExpectedEntryBlockIndex, requestId });
          window.speechSynthesis.cancel();
        } catch (_) {}
        return;
      }
      if (requestId > 0 && Number(TTS_STATE.browserRestartRequestId || 0) === requestId) {
        TTS_STATE.browserRestarting = false;
      }
      TTS_STATE.browserExpectedEntryBlockIndex = blockIdx;
      ttsDiagPush('browser-utterance-start', {
        key,
        blockIdx,
        sessionId,
        requestId,
        reason: entryReason,
        highlightBlockIndex: TTS_STATE.activeBlockIndex,
        browserCurrentSentenceIndex: TTS_STATE.browserCurrentSentenceIndex,
        pageIndex: startPreview?.pageIndex ?? -1,
        excerpt: startPreview?.excerpt || ttsExcerptText(sentenceText),
        rangeSource: startPreview?.rangeSource || 'browser-ranges',
        rangeStart: startPreview?.start ?? r.start,
        rangeEnd: startPreview?.end ?? r.end,
      });
    };
    utter.rate = Number(TTS_STATE.rate || 1) || 1;
    utter.pitch = 1;
    try { utter.volume = Math.max(0, Math.min(1, Number(TTS_STATE.volume ?? 1))); } catch (_) {}
    if (voice) utter.voice = voice;

    utter.onend = () => {
      if (TTS_STATE.activeSessionId !== sessionId) return;
      if (TTS_STATE.activeKey !== key) return;
      if (TTS_STATE.browserPaused) return; // pause captured this slot
      if (isIntentionalBrowserCancelForSession(sessionId)) {
        ttsDiagPush('browser-end-transition', {
          key, blockIdx, sessionId, requestId,
          reason: TTS_STATE.browserIntentionalCancelReason || 'intentional-cancel',
        });
        return;
      }
      if (blockIdx !== TTS_STATE.activeBlockIndex && TTS_STATE.activeBlockIndex >= 0) {
        ttsDiagPush('browser-stale-block-end', {
          key, blockIdx, activeBlockIndex: TTS_STATE.activeBlockIndex, sessionId, requestId,
          note: 'onend on stale block — discarding',
        });
        return;
      }
      speakFromBlock(blockIdx + 1, { reason: 'queue-progress' });
    };

    utter.onerror = (evt) => {
      if (TTS_STATE.activeSessionId !== sessionId) return;
      // Guard 1: intentional cancel (pause, skip, resume, stop-or-replace).
      // Covers the deferred restart window while cancel() flushes old speech.
      if (isIntentionalBrowserCancelForSession(sessionId) || (TTS_STATE.browserRestarting && isBrowserStaleEntryBlock(blockIdx))) {
        ttsDiagPush('browser-cancel-transition', {
          key, blockIdx, sessionId,
          reason: TTS_STATE.browserIntentionalCancelReason || 'browser-restarting-stale-entry',
        });
        return;
      }
      // Guard 2: state is paused. A stale onerror from a cancel that was
      // issued for a pause should never collapse the session — the user's
      // intent was to pause, not to stop. Discard and preserve state.
      if (TTS_STATE.browserPaused && TTS_STATE.activeKey === key) {
        ttsDiagPush('browser-cancel-while-paused', {
          key, blockIdx, sessionId,
          note: 'onerror fired while paused — discarding, session preserved',
        });
        return;
      }
      // Guard 3: block index stale — utterance that arrived from before a
      // skip should not count as an error on the new target block.
      if (blockIdx !== TTS_STATE.activeBlockIndex && TTS_STATE.activeBlockIndex >= 0) {
        ttsDiagPush('browser-stale-block-error', {
          key, blockIdx, activeBlockIndex: TTS_STATE.activeBlockIndex, sessionId,
          note: 'onerror on stale block — discarding',
        });
        return;
      }
      const errorCode = String(evt && (evt.error || evt.name || evt.type) ? (evt.error || evt.name || evt.type) : '').toLowerCase();
      const recoverable = isRecoverableBrowserUtteranceError(evt);
      TTS_STATE.playbackBlockedReason = recoverable ? '' : 'speechSynthesis utterance error';
      TTS_DEBUG.lastError = {
        at: new Date().toISOString(),
        path: 'browser',
        key,
        message: errorCode ? `speechSynthesis utterance ${errorCode}` : 'speechSynthesis utterance error',
        blockIdx,
        recoverable,
      };
      ttsDiagPush('browser-utterance-error', { key, blockIdx, sessionId, errorCode, recoverable });
      ttsReconcileAfterRuntimeError('browser-utterance-error', { key, blockIdx, sessionId, errorCode, recoverable });
      if (recoverable) TTS_STATE.playbackBlockedReason = '';
    };

    window.speechSynthesis.speak(utter);
  }

  TTS_STATE.browserSpeakFromBlock = speakFromBlock;
  TTS_STATE.browserExpectedEntryBlockIndex = startPaused ? pausedBlockIndex : 0;
  if (!startPaused) speakFromBlock(0, { reason: 'initial-start' });
}

// Monotonically-incrementing speak-generation counter.
// Each call to browserSpeakPageFromSentence claims a generation slot.
// The deferred setTimeout checks that no newer call has claimed the slot,
// preventing double-speak when rapid Skip/Resume calls overlap within the
// one-tick defer window.
let _browserSpeakGen = 0;
const BROWSER_RESTART_FLUSH_MS = 32;

// Resume or skip to a specific block within the current browser session.
//
// Chrome/Edge SpeechSynthesis race fix (confirmed via diagnostic trace):
// cancel() is processed asynchronously. Calling speak() in the same
// event-loop tick causes the new utterance to be silently cancelled and
// fire onerror before it starts — observed consistently as a 2-3ms gap
// between skip/pause and browser-utterance-error in production diagnostics.
// Fix: defer restart long enough for cancel() to flush before the authoritative block may speak.
function browserSpeakPageFromSentence(key, blockIdx, reason) {
  if (!TTS_STATE.browserSpeakFromBlock) return false;
  if (TTS_STATE.activeKey !== key) return false;
  const ranges = TTS_STATE.browserSentenceRanges;
  if (!ranges || !ranges.length) return false;
  const target = Math.max(0, Math.min(ranges.length - 1, blockIdx));
  const speakFn = TTS_STATE.browserSpeakFromBlock;
  const sessionId = TTS_STATE.activeSessionId;
  const entryReason = reason || 'skip-or-resume';
  // Claim this speak generation. A later call (rapid double-skip) increments
  // this before our deferred restart fires, so the older request self-aborts.
  const gen = ++_browserSpeakGen;
  const requestId = Number(TTS_STATE.browserRestartRequestId || 0) + 1;
  TTS_STATE.browserRestartRequestId = requestId;
  TTS_STATE.browserExpectedEntryBlockIndex = target;
  TTS_STATE.browserRestarting = true;
  clearPendingBrowserRestartTimer();

  // Mark intent and cancel synchronously so onerror on the outgoing
  // utterance is recognised as intentional within the 2000ms window.
  // Clear any prior playbackBlockedReason so support status reflects
  // the in-progress recovery (not the previous error string).
  TTS_STATE.playbackBlockedReason = '';
  try {
    markIntentionalBrowserCancel('restart-from-block', { key, targetBlock: target, gen, reason: entryReason });
    window.speechSynthesis.cancel();
  } catch (_) {}

  const reentryPreview = ttsGetBlockPreview(key, target);
  ttsDiagPush('browser-re-entry', {
    key, blockIdx: target, gen, requestId, reason: entryReason,
    outcomeClass: entryReason === 'speed-change' ? 'live-mutate' : 'preserved-re-entry',
    sessionId,
    highlightBlockIndex: TTS_STATE.activeBlockIndex,
    browserCurrentSentenceIndex: TTS_STATE.browserCurrentSentenceIndex,
    pageIndex: reentryPreview?.pageIndex ?? -1,
    excerpt: reentryPreview?.excerpt || '',
    rangeSource: reentryPreview?.rangeSource || 'none',
  });

  // Advance state synchronously so getPlaybackStatus() and highlight
  // reflect the target block immediately (before the deferred speak).
  TTS_STATE.browserPaused = false;
  TTS_STATE.browserCurrentSentenceIndex = target;
  TTS_STATE.activeBlockIndex = target;
  try { ttsHighlightBlock(target); } catch (_) {}

  // Defer speak long enough for cancel() to flush so stale audio/utterance
  // entry cannot survive behind the newly landed block.
  // Four guards ensure only the authoritative call executes:
  //   1. Session must not have been replaced (stop, new Read Page)
  //   2. Active key must still be this page
  //   3. The speak function must not have been replaced (new session)
  //   4. This must be the latest speak generation (rapid double-skip)
  TTS_STATE.browserRestartTimerId = setTimeout(() => {
    TTS_STATE.browserRestartTimerId = 0;
    const guardBase = {
      key,
      requestedBlockIdx: target,
      gen,
      requestId,
      sessionId,
      activeSessionId: TTS_STATE.activeSessionId,
      activeKey: TTS_STATE.activeKey || null,
      highlightBlockIndex: TTS_STATE.activeBlockIndex,
      browserCurrentSentenceIndex: TTS_STATE.browserCurrentSentenceIndex,
      expectedEntryBlockIndex: TTS_STATE.browserExpectedEntryBlockIndex,
      activeRestartRequestId: TTS_STATE.browserRestartRequestId,
    };
    if (_browserSpeakGen !== gen) {
      ttsDiagPush('browser-re-entry-suppressed', { ...guardBase, reason: 'superseded-by-newer-generation', latestGen: _browserSpeakGen });
      return;
    }
    if (TTS_STATE.activeSessionId !== sessionId) {
      ttsDiagPush('browser-re-entry-suppressed', { ...guardBase, reason: 'session-replaced' });
      return;
    }
    if (TTS_STATE.activeKey !== key) {
      ttsDiagPush('browser-re-entry-suppressed', { ...guardBase, reason: 'page-replaced' });
      return;
    }
    if (TTS_STATE.browserSpeakFromBlock !== speakFn) {
      ttsDiagPush('browser-re-entry-suppressed', { ...guardBase, reason: 'speak-function-replaced' });
      return;
    }
    if (Number(TTS_STATE.browserRestartRequestId || 0) !== requestId) {
      ttsDiagPush('browser-re-entry-suppressed', { ...guardBase, reason: 'superseded-by-newer-request' });
      return;
    }
    speakFn(target, { restartRequestId: requestId, reason: entryReason });
  }, BROWSER_RESTART_FLUSH_MS);

  return true;
}

// ─── Support / routing ────────────────────────────────────────────────────────

function getResolvedTtsPolicy() {
  const policyApi = window.rcPolicy || {};
  const policy = typeof policyApi.get === 'function' ? policyApi.get() : null;
  const tier = typeof policyApi.getTier === 'function'
    ? String(policyApi.getTier())
    : ((policy && policy.tier) ? String(policy.tier) : ((typeof appTier !== 'undefined' && appTier) ? String(appTier) : 'basic'));
  const cloudVoiceAccess = typeof policyApi.canUseCloudVoices === 'function'
    ? !!policyApi.canUseCloudVoices()
    : !!policy?.features?.cloudVoices;
  return { tier, cloudVoiceAccess, policy };
}

function getTtsSupportStatus() {
  const resolved = getResolvedTtsPolicy();
  const tier = resolved.tier;
  const browserSupported = !!browserTtsSupported();
  let browserVoices = 0;
  try { browserVoices = browserSupported ? (window.speechSynthesis.getVoices() || []).filter(v => (v.lang || '').toLowerCase().startsWith('en')).length : 0; } catch (_) {}
  const browserVoice = browserSupported ? browserPickVoice() : null;
  const freePlayable = browserSupported && !!browserVoice;
  const basePlayable = resolved.cloudVoiceAccess ? true : freePlayable;
  const blockedReason = String(TTS_STATE.playbackBlockedReason || '');
  const playable = (!blockedReason) && basePlayable;
  return {
    tier, cloudVoiceAccess: !!resolved.cloudVoiceAccess, browserSupported, browserVoices,
    browserVoiceAvailable: !!browserVoice,
    browserVoiceName: browserVoice ? (browserVoice.name || null) : null,
    freePlayable, playable,
    selected: getSelectedVoicePreference(),
    reason: playable ? '' : (blockedReason || 'No browser English voice is available on this device.'),
  };
}

function getPreferredTtsRouteInfo() {
  const support = getTtsSupportStatus();
  const tier = support.tier;
  const cloudCapable = !!support.cloudVoiceAccess;
  const selected = getSelectedVoicePreference();
  const browserSelected = selected.type === 'browser';

  let requestedPath = 'browser-tier-default';
  let reason = 'tier-browser-only';

  if (cloudCapable) {
    if (browserSelected) {
      requestedPath = 'browser-selected';
      reason = 'explicit-browser-selection';
    } else if (selected.explicitCloud) {
      requestedPath = 'cloud-selected';
      reason = 'explicit-cloud-selection';
    } else {
      requestedPath = 'cloud-tier-default';
      reason = 'tier-cloud-default';
    }
  } else if (selected.explicitCloud) {
    requestedPath = 'browser-tier-default';
    reason = 'cloud-selection-blocked-by-tier';
  }

  return { tier, cloudCapable, requestedPath, reason, selected, support };
}

// ─── Status ────────────────────────────────────────────────────────────────────

function ttsSessionSnapshot() {
  const key = TTS_STATE.activeKey || TTS_STATE.pausedPageKey || null;
  const pageIdx = key ? ((typeof readingTargetFromKey === 'function' ? readingTargetFromKey(key) : null)?.pageIndex ?? -1) : -1;
  return {
    sessionId: Number(TTS_STATE.activeSessionId || 0),
    activeKey: TTS_STATE.activeKey || null,
    activeBlockIndex: Number(TTS_STATE.activeBlockIndex ?? -1),
    pausedPageKey: TTS_STATE.pausedPageKey || null,
    pausedBlockIndex: Number(TTS_STATE.pausedBlockIndex ?? -1),
    inferredPageIndex: pageIdx,
    hasBrowserResumeHook: !!TTS_STATE.browserSpeakFromBlock,
    hasAudio: !!TTS_STATE.audio,
  };
}

function getNavSessionContext() {
  const key = String(TTS_STATE.activeKey || TTS_STATE.pausedPageKey || '');
  const _parsed = (typeof readingTargetFromKey === 'function') ? readingTargetFromKey(key) : null;
  if (!_parsed) return null;
  const pageIndex = _parsed.pageIndex;
  if (!Number.isFinite(pageIndex) || pageIndex < 0) return null;
  const blockCountFromMarks = Array.isArray(TTS_STATE.highlightMarks) ? TTS_STATE.highlightMarks.length : 0;
  const blockCountFromRanges = Array.isArray(TTS_STATE.browserSentenceRanges) ? TTS_STATE.browserSentenceRanges.length : 0;
  const blockCount = Math.max(blockCountFromMarks, blockCountFromRanges, 0);
  const baseBlock = Number.isFinite(Number(TTS_STATE.activeBlockIndex)) && TTS_STATE.activeBlockIndex >= 0
    ? Number(TTS_STATE.activeBlockIndex)
    : (Number.isFinite(Number(TTS_STATE.pausedBlockIndex)) ? Number(TTS_STATE.pausedBlockIndex) : 0);
  return { key, pageIndex, blockCount, blockIndex: Math.max(0, baseBlock) };
}

function computeSkipEligibility(delta) {
  const ctx = getNavSessionContext();
  if (!ctx) return { can: false, reason: 'no-active-or-paused-session' };
  const nextPage = ctx.pageIndex + (delta < 0 ? -1 : 1);
  const hasCrossPageTarget = typeof pages !== 'undefined' && !!pages && Number.isFinite(nextPage) && nextPage >= 0 && !!pages[nextPage];
  if (ctx.blockCount <= 0) {
    if (TTS_CLOUD_WINDOW.active && !TTS_CLOUD_WINDOW.promotionApplied) {
      return { can: true, reason: 'window-pending-promotion' };
    }
    // Runtime skip code does not perform cross-page navigation from an active
    // no-block cloud session. Do not advertise cross-page skip eligibility when
    // the live session has no seek/highlight truth.
    if (TTS_STATE.audio || TTS_STATE.activeKey) {
      return { can: false, reason: 'no-live-blocks' };
    }
    return { can: hasCrossPageTarget, reason: hasCrossPageTarget ? 'cross-page-target' : 'no-blocks-or-page-target' };
  }
  const targetBlock = ctx.blockIndex + (delta < 0 ? -1 : 1);
  if (targetBlock >= 0 && targetBlock < ctx.blockCount) return { can: true, reason: 'in-page-target' };
  if (targetBlock < 0) return { can: true, reason: 'restart-block-0' };
  if (TTS_CLOUD_WINDOW.active && TTS_CLOUD_WINDOW.promotionApplied &&
      ctx.blockCount <= Number(TTS_CLOUD_WINDOW.chunkASentenceCount || 0)) {
    return { can: true, reason: 'window-stale-promotion' };
  }
  // targetBlock >= ctx.blockCount — boundary reached.
  // If in an active block-window session without a confirmed full-page promotion,
  // the skip will be deferred (not cross-page-navigated). Expose this explicitly so
  // controls reflect the actual outcome rather than advertising cross-page-target
  // while the actual skip fires cross-page-disabled.
  if (TTS_CLOUD_WINDOW.active && !TTS_CLOUD_WINDOW.promotionApplied) {
    return { can: true, reason: 'window-pending-promotion' };
  }
  return { can: hasCrossPageTarget, reason: hasCrossPageTarget ? 'cross-page-target' : 'no-next-page-target' };
}

function getPlaybackControlEligibility() {
  const countdown = getCountdownStatus();
  const support = getTtsSupportStatus();
  const cloudRestartInFlight = isCloudRestartTransitionActive();
  let paused = !!TTS_STATE.browserPaused;
  try {
    if (TTS_STATE.audio) paused = cloudRestartInFlight ? false : !!TTS_STATE.audio.paused;
    else if (!TTS_STATE.browserPaused && browserTtsSupported()) paused = !!window.speechSynthesis.paused;
  } catch (_) {}
  const playback = {
    active: !!TTS_STATE.activeKey,
    paused,
    key: TTS_STATE.activeKey || null,
    playbackRate: Number(TTS_STATE.rate || 1) || 1,
    sessionId: TTS_STATE.activeSessionId,
    activeBlockIndex: TTS_STATE.activeBlockIndex,
    blockCount: Array.isArray(TTS_STATE.highlightMarks) ? TTS_STATE.highlightMarks.length : 0,
  };
  const hasSession = !!(TTS_STATE.activeKey || TTS_STATE.pausedPageKey);
  // canResume requires both a paused active session AND a real resume hook.
  // A session that is "paused" with no hook (browserSpeakFromBlock cleared, or
  // audio element gone) cannot actually resume — marking it resumable would show
  // a Resume label that calls ttsResume() and fails silently.
  // audio.ended implies audio.paused in all browsers, so exclude ended elements
  // from the resume hook: an ended audio element has no live position to resume
  // from, and calling audio.play() on it would restart from t=0 without marks.
  const hasRealResumeHook = (!cloudRestartInFlight && !!(TTS_STATE.audio && TTS_STATE.audio.paused && !TTS_STATE.audio.ended)) ||
    !!(TTS_STATE.browserPaused && TTS_STATE.browserSpeakFromBlock);
  const canResume = !!playback.active && !!playback.paused && hasSession && hasRealResumeHook;
  const canPause = !!playback.active && !playback.paused;
  const canPlay = canResume || !!countdown.active || !!support.playable;
  const prev = computeSkipEligibility(-1);
  const next = computeSkipEligibility(1);
  const snapshot = {
    canPlay, canPause, canResume,
    canSkipPrev: !!prev.can,
    canSkipNext: !!next.can,
    reasons: {
      canPlay: canPlay ? (canResume ? 'resume-paused-session' : (countdown.active ? 'countdown-active' : 'playback-supported')) : (support.reason || 'playback-unavailable'),
      canPause: canPause ? 'active-unpaused-session' : 'no-active-unpaused-session',
      canResume: canResume ? 'active-paused-session' : (hasSession && !hasRealResumeHook ? 'stale-paused-no-hook' : 'no-paused-session'),
      canSkipPrev: prev.reason,
      canSkipNext: next.reason,
    },
    context: {
      playback,
      countdown,
      hasSession,
      nav: getNavSessionContext(),
    }
  };
  return snapshot;
}

function ttsReconcileAfterRuntimeError(kind, details = {}) {
  const before = {
    playback: getPlaybackStatus(),
    session: ttsSessionSnapshot(),
    browserSpeech: browserTtsSupported() ? { speaking: !!window.speechSynthesis.speaking, paused: !!window.speechSynthesis.paused, pending: !!window.speechSynthesis.pending } : null,
  };
  const key = TTS_STATE.activeKey || TTS_STATE.pausedPageKey || null;
  if (key) {
    try { ttsSetButtonActive(key, false); } catch (_) {}
    try { ttsSetHintButton(key, false); } catch (_) {}
  }
  try { if (browserTtsSupported()) window.speechSynthesis.cancel(); } catch (_) {}
  try {
    TTS_AUDIO_ELEMENT.pause();
    TTS_AUDIO_ELEMENT.removeAttribute('src');
    TTS_AUDIO_ELEMENT.load();
  } catch (_) {}
  TTS_STATE.audio = null;
  TTS_STATE.activeKey = null;
  TTS_STATE.activeBlockIndex = -1;
  TTS_STATE.pausedPageKey = null;
  TTS_STATE.pausedBlockIndex = -1;
  TTS_STATE.browserSentenceRanges = null;
  TTS_STATE.browserSpeakFromBlock = null;
  TTS_STATE.browserPaused = false;
  resetBrowserRestartOwnership();
  TTS_STATE.browserIntentionalCancelUntil = 0;
  TTS_STATE.browserIntentionalCancelReason = null;
  TTS_STATE.browserIntentionalCancelMeta = null;
  clearPendingCloudSeek();
  clearCloudRestartTransition();
  TTS_STATE.highlightRAF = null;
  try { ttsClearSentenceHighlight(); } catch (_) {}
  const after = {
    playback: getPlaybackStatus(),
    session: ttsSessionSnapshot(),
    browserSpeech: browserTtsSupported() ? { speaking: !!window.speechSynthesis.speaking, paused: !!window.speechSynthesis.paused, pending: !!window.speechSynthesis.pending } : null,
    controls: getPlaybackControlEligibility(),
  };
  ttsDiagPush('post-error-reconciliation', {
    kind,
    details,
    before,
    after
  });
}

function getPlaybackStatus() {
  let paused = !!TTS_STATE.browserPaused;
  try {
    if (TTS_STATE.audio) paused = isCloudRestartTransitionActive() ? false : !!TTS_STATE.audio.paused;
    else if (!TTS_STATE.browserPaused && browserTtsSupported()) paused = !!window.speechSynthesis.paused;
  } catch (_) {}
  const capability = getTtsCapabilityStatus();
  return {
    active: !!TTS_STATE.activeKey,
    paused,
    key: TTS_STATE.activeKey || null,
    playbackRate: Number(TTS_STATE.rate || 1) || 1,
    sessionId: TTS_STATE.activeSessionId,
    activeBlockIndex: TTS_STATE.activeBlockIndex,
    blockCount: Array.isArray(TTS_STATE.highlightMarks) ? TTS_STATE.highlightMarks.length : 0,
    cloudRestartInFlight: isCloudRestartTransitionActive(),
    capability,
  };
}

function getAutoplayStatus() { return { enabled: !!AUTOPLAY_STATE.enabled }; }

function getCountdownStatus() {
  return {
    pageIndex: Number(AUTOPLAY_STATE.countdownPageIndex ?? -1),
    seconds: Number(AUTOPLAY_STATE.countdownSec ?? 0) || 0,
    active: Number(AUTOPLAY_STATE.countdownPageIndex ?? -1) !== -1 && Number(AUTOPLAY_STATE.countdownSec ?? 0) > 0,
  };
}

function setPlaybackRate(rate) {
  const value = Math.max(0.5, Math.min(3, Number(rate || 1) || 1));
  const prev = TTS_STATE.rate;
  TTS_STATE.rate = value;

  // Cloud path: mutate playback rate live on the active audio element.
  try { TTS_AUDIO_ELEMENT.defaultPlaybackRate = value; TTS_AUDIO_ELEMENT.playbackRate = value; } catch (_) {}

  const changed = Math.abs(value - prev) > 0.001;

  // Browser path: do NOT cancel/restart the current utterance on speed change.
  // Restarting causes the current sentence to replay from its beginning, which
  // the user experiences as repeated speech. TTS_STATE.rate is already updated
  // above; speakFromBlock() reads utter.rate = Number(TTS_STATE.rate || 1) fresh
  // for each sentence, so the new rate takes effect naturally at the next
  // sentence boundary without any restart penalty.
  // Cloud path: playbackRate was already mutated live on the audio element above.
  ttsDiagPush('set-playback-rate', {
    rate: value,
    prev,
    action: changed
      ? (TTS_STATE.browserSpeakFromBlock && !TTS_STATE.browserPaused
          ? 'browser-rate-deferred-next-sentence'
          : (TTS_STATE.browserPaused ? 'rate-stored-paused' : 'cloud-live-mutate'))
      : 'no-change',
  });
  return value;
}

function toggleAutoplay(force, opts = {}) {
  const next = typeof force === 'boolean' ? !!force : !AUTOPLAY_STATE.enabled;
  const applied = applyAutoplayRuntimePreference(next, {
    source: String(opts.source || (typeof force === 'boolean' ? 'force-toggle' : 'toggle')),
    persist: opts.persist !== false,
    syncControl: opts.syncControl !== false,
  });
  ttsDiagPush('toggle-autoplay', { enabled: !!applied, source: String(opts.source || (typeof force === 'boolean' ? 'force-toggle' : 'toggle')) });
  return applied;
}

// ─── Core controls ────────────────────────────────────────────────────────────


function ttsClearPausedSessionForManualPageAdvance(delta, context = {}) {
  const step = Number(delta || 0);
  const before = {
    playback: getPlaybackStatus(),
    session: ttsSessionSnapshot(),
    controls: getPlaybackControlEligibility(),
  };
  const wasPaused = !!before.playback.active && !!before.playback.paused;
  if (!wasPaused) {
    const payload = {
      success: false,
      cleared: false,
      reason: 'no-active-paused-session',
      delta: step,
      context,
      before,
      after: before,
    };
    ttsDiagPush('manual-page-advance-clear-paused-session', payload);
    return payload;
  }

  ttsStop();

  const after = {
    playback: getPlaybackStatus(),
    session: ttsSessionSnapshot(),
    controls: getPlaybackControlEligibility(),
  };
  const payload = {
    success: true,
    cleared: true,
    reason: 'cleared-paused-session-for-manual-page-advance',
    delta: step,
    context,
    before,
    after,
  };
  ttsDiagPush('manual-page-advance-clear-paused-session', payload);
  return payload;
}

function ttsStop() {
  try { document.querySelectorAll('.tts-btn[data-tts="page"].tts-active').forEach(btn => btn.classList.remove('tts-active')); } catch (_) {}
  try { if (TTS_STATE.activeKey) ttsSetHintButton(TTS_STATE.activeKey, false); } catch (_) {}
  ttsAutoplayCancelCountdown();

  if (TTS_STATE.abort) { try { TTS_STATE.abort.abort(); } catch (_) {} TTS_STATE.abort = null; }
  if (TTS_STATE.audio) {
    try { TTS_AUDIO_ELEMENT.loop = false; TTS_AUDIO_ELEMENT.pause(); TTS_AUDIO_ELEMENT.removeAttribute('src'); TTS_AUDIO_ELEMENT.load(); } catch (_) {}
    TTS_STATE.audio = null;
  }
  browserTtsStop();
  ttsClearSentenceHighlight();

  // Increment session ID to invalidate all in-flight async operations.
  TTS_STATE.activeSessionId++;

  TTS_STATE.activeKey = null;
  TTS_STATE.activeBlockIndex = -1;
  TTS_STATE.pausedBlockIndex = -1;
  TTS_STATE.pausedPageKey = null;
  TTS_STATE.browserSentenceRanges = null;
  TTS_STATE.browserSpeakFromBlock = null;
  TTS_STATE.activeBrowserVoiceName = null;
  TTS_STATE.browserPaused = false;
  resetBrowserRestartOwnership();
  TTS_STATE.browserIntentionalCancelUntil = 0;
  TTS_STATE.browserIntentionalCancelReason = null;
  TTS_STATE.browserIntentionalCancelMeta = null;
  clearPendingCloudSeek();
  clearCloudRestartTransition();
  clearTtsBackendCapabilityState();
  clearTtsCloudWindow();

  ttsDiagPush('stop', {
    outcomeClass: 'full-stop',
    sessionId: TTS_STATE.activeSessionId,
    lastPageKey: (typeof lastFocusedPageIndex === 'number' && lastFocusedPageIndex >= 0) ? `page-${lastFocusedPageIndex}` : null,
  });
}

function ttsPause() {
  const before = {
    playback: getPlaybackStatus(),
    session: ttsSessionSnapshot(),
    controls: getPlaybackControlEligibility(),
  };
  if (!TTS_STATE.activeKey) {
    ttsDiagPush('pause-action', { success: false, reason: 'no-active-session', before, after: before });
    return { success: false, reason: 'no-active-session', before, after: before };
  }

  // Preserve block position BEFORE any engine state changes.
  const preservedBlock = (Number.isFinite(Number(TTS_STATE.activeBlockIndex)) && TTS_STATE.activeBlockIndex >= 0)
    ? TTS_STATE.activeBlockIndex
    : (Number.isFinite(Number(TTS_STATE.browserCurrentSentenceIndex)) ? TTS_STATE.browserCurrentSentenceIndex : 0);
  TTS_STATE.pausedBlockIndex = preservedBlock;
  TTS_STATE.pausedPageKey = TTS_STATE.activeKey;

  // Stop highlight advancement while paused.
  if (TTS_STATE.highlightRAF) { cancelAnimationFrame(TTS_STATE.highlightRAF); TTS_STATE.highlightRAF = null; }

  // Cloud path.
  if (TTS_STATE.audio) {
    clearCloudRestartTransition({ invalidateRequest: true, unmute: true });
    try { TTS_STATE.audio.pause(); } catch (_) {}
    // After audio.pause(), currentTime is frozen. Resolve the exact block at that
    // timestamp so preservedBlock is as accurate as possible (no 16ms RAF lag).
    if (TTS_STATE.highlightMarks && TTS_STATE.highlightMarks.length) {
      try {
        const t = TTS_STATE.audio.currentTime * 1000;
        const marks = TTS_STATE.highlightMarks;
        const ends = TTS_STATE.highlightEnds || [];
        for (let i = 0; i < marks.length; i++) {
          if (t >= marks[i].time && t < (ends[i] ?? Infinity)) {
            TTS_STATE.activeBlockIndex = i;
            break;
          }
        }
      } catch (_) {}
    }
    TTS_DEBUG.lastPauseStrategy = 'cloud-audio-pause';
  }

  // Browser path.
  if (browserTtsSupported()) {
    try {
      const wasSpeaking = !!window.speechSynthesis.speaking;
      window.speechSynthesis.pause();
      const synthPaused = !!window.speechSynthesis.paused;
      if (!synthPaused && wasSpeaking) {
        TTS_STATE.browserPaused = true;
        TTS_STATE.browserRestarting = true;
        try {
          // Use a longer intentional-cancel window here (2000ms instead of 1200ms).
          // Pause → Resume is the most common sequence and the user may act quickly.
          // The deferred setTimeout(0) in browserSpeakPageFromSentence (called by
          // Resume) must complete before this window closes to be protected.
          TTS_STATE.browserIntentionalCancelUntil = Date.now() + 2000;
          TTS_STATE.browserIntentionalCancelReason = 'pause-fallback-cancel-restart';
          TTS_STATE.browserIntentionalCancelMeta = {
            sessionId: TTS_STATE.activeSessionId,
            key: TTS_STATE.activeKey || null,
            preservedBlockIndex: TTS_STATE.pausedBlockIndex,
          };
          ttsDiagPush('browser-intentional-cancel', {
            reason: 'pause-fallback-cancel-restart',
            ...TTS_STATE.browserIntentionalCancelMeta,
          });
          window.speechSynthesis.cancel();
        } catch (_) {}
        TTS_STATE.browserRestarting = false;
        TTS_DEBUG.lastPauseStrategy = 'browser-cancel-restart-fallback';
        ttsDiagPush('browser-pause-fallback', { key: TTS_STATE.activeKey, preservedBlockIndex: TTS_STATE.pausedBlockIndex, sessionId: TTS_STATE.activeSessionId });
      } else {
        TTS_STATE.browserPaused = synthPaused;
        TTS_DEBUG.lastPauseStrategy = synthPaused ? 'browser-speechsynthesis-pause' : 'browser-pause-noop';
      }
    } catch (_) {}
  }

  const after = {
    playback: getPlaybackStatus(),
    session: ttsSessionSnapshot(),
    controls: getPlaybackControlEligibility(),
  };
  const outcomeClass = TTS_STATE.audio
    ? 'live-mutate'      // cloud: audio.pause() — live interruption, not reset
    : (TTS_STATE.browserPaused
        ? (TTS_DEBUG.lastPauseStrategy === 'browser-speechsynthesis-pause'
            ? 'live-mutate'    // native pause succeeded
            : 'preserved-re-entry')  // cancel+re-enter path
        : 'noop');
  const payload = {
    success: !!(TTS_STATE.pausedPageKey && TTS_STATE.pausedBlockIndex >= 0),
    pauseStrategy: TTS_DEBUG.lastPauseStrategy,
    outcomeClass,
    preservedPageKey: TTS_STATE.pausedPageKey,
    preservedBlockIndex: TTS_STATE.pausedBlockIndex,
    before,
    after,
  };
  ttsDiagPush('paused', payload);
  ttsDiagPush('pause-action', payload);
  ttsDiagPush('control-eligibility', after.controls);
  return payload;
}

function ttsResume() {
  const before = {
    playback: getPlaybackStatus(),
    session: ttsSessionSnapshot(),
    controls: getPlaybackControlEligibility(),
  };
  const expectedSessionId = Number(TTS_STATE.activeSessionId || 0);
  const expectedPageKey = TTS_STATE.pausedPageKey || TTS_STATE.activeKey || null;
  const expectedBlock = TTS_STATE.pausedBlockIndex >= 0 ? TTS_STATE.pausedBlockIndex : 0;
  if (!TTS_STATE.activeKey) {
    const payload = { success: false, resumed: false, restarted: false, reason: 'no-active-session', before, after: before };
    ttsDiagPush('resume-action', payload);
    return payload;
  }
  if (!expectedPageKey) {
    const payload = { success: false, resumed: false, restarted: false, reason: 'no-preserved-page', before, after: before };
    ttsDiagPush('resume-action', payload);
    return payload;
  }

  // Cloud path: resume audio from preserved currentTime.
  if (TTS_STATE.audio && !isCloudRestartTransitionActive() && TTS_STATE.audio.paused) {
    // Stale-session guard: if the audio element has ended (ended === true implies
    // paused === true in all browsers), the session completed its playback and the
    // highlight marks were cleared by the onended handler. Calling audio.play()
    // would restart the audio from t=0 without marks, producing audio without
    // highlighting and exposing a corrupt blockCount: 0 / no-highlight state.
    // Instead, treat this as a fresh Play on the same page.
    if (TTS_STATE.audio.ended) {
      const _restartKey = expectedPageKey;
      const _parsed = _restartKey && typeof readingTargetFromKey === 'function'
        ? readingTargetFromKey(_restartKey) : null;
      const _pageIndex = _parsed ? _parsed.pageIndex : -1;
      // Fully stop the stale session before restarting so ttsSpeakQueue starts
      // from a clean slate (fresh sessionId, cleared window state, etc.).
      ttsStop();
      if (_restartKey && Number.isFinite(_pageIndex) && _pageIndex >= 0 &&
          typeof pages !== 'undefined' && pages[_pageIndex]) {
        ttsSpeakQueue(_restartKey, [pages[_pageIndex]]);
        const after = {
          playback: getPlaybackStatus(),
          session: ttsSessionSnapshot(),
          controls: getPlaybackControlEligibility(),
        };
        const payload = {
          success: true, resumed: false, restarted: true,
          outcomeClass: 'fresh-restart',
          route: 'cloud-stale-ended-restart',
          resumedSessionId: Number(TTS_STATE.activeSessionId || 0),
          resumedPageKey: _restartKey,
          resumedBlockIndex: 0,
          before, after,
        };
        ttsDiagPush('resumed', payload);
        ttsDiagPush('resume-action', payload);
        ttsDiagPush('control-eligibility', after.controls);
        return payload;
      }
      const failPayload = {
        success: false, resumed: false, restarted: false,
        reason: 'stale-ended-no-page-text',
        before, after: before,
      };
      ttsDiagPush('resume-action', failPayload);
      return failPayload;
    }

    try {
      // Apply current rate (may have changed during pause) before resuming.
      const resumeRate = Number(TTS_STATE.rate || 1) || 1;
      TTS_STATE.audio.defaultPlaybackRate = resumeRate;
      TTS_STATE.audio.playbackRate = resumeRate;
      TTS_STATE.audio.play().catch(() => {});
      // Re-start the highlight RAF — it was stopped on pause to avoid
      // advancing activeBlockIndex while the audio was silent.
      ttsStartHighlightLoop(TTS_STATE.audio);
      // Ensure paused state is cleared so getPlaybackStatus() reflects resuming.
      TTS_STATE.pausedBlockIndex = -1;
      TTS_STATE.pausedPageKey = null;
    } catch (_) {}
    const after = {
      playback: getPlaybackStatus(),
      session: ttsSessionSnapshot(),
      controls: getPlaybackControlEligibility(),
    };
    const payload = {
      success: true, resumed: true, restarted: false,
      outcomeClass: 'live-mutate',
      route: 'cloud-audio-resume',
      resumedSessionId: Number(TTS_STATE.activeSessionId || 0),
      resumedPageKey: expectedPageKey,
      resumedBlockIndex: expectedBlock,
      sessionMatched: Number(TTS_STATE.activeSessionId || 0) === expectedSessionId,
      before, after,
    };
    ttsDiagPush('resumed', payload);
    ttsDiagPush('resume-action', payload);
    ttsDiagPush('control-eligibility', after.controls);
    return payload;
  }

  // Browser path: re-enter the sentence loop from the preserved block.
  if (browserTtsSupported() && TTS_STATE.browserPaused) {
    TTS_DEBUG.lastPauseStrategy = 'browser-restart-from-block';
    const key = expectedPageKey;
    const blockIdx = expectedBlock;
    const sameSession = Number(TTS_STATE.activeSessionId || 0) === expectedSessionId;
    const samePage = TTS_STATE.activeKey === key;
    // Clear paused state synchronously before calling browserSpeakPageFromSentence.
    // This means getPlaybackStatus() reflects "resuming" immediately rather than
    // showing paused=true during the deferred setTimeout(0) gap inside
    // browserSpeakPageFromSentence. If the resume fails (ok=false), callers
    // should treat this as a failed resume (the session was already paused).
    // Also clear any stale playbackBlockedReason so getTtsSupportStatus() reflects
    // the in-progress recovery rather than the previous error.
    if (sameSession && samePage) {
      TTS_STATE.browserPaused = false;
      TTS_STATE.pausedBlockIndex = -1;
      TTS_STATE.pausedPageKey = null;
      TTS_STATE.playbackBlockedReason = '';
    }
    const ok = sameSession && samePage ? browserSpeakPageFromSentence(key, blockIdx) : false;
    if (!ok && sameSession && samePage) {
      // Resume failed — restore paused state so the user can retry.
      TTS_STATE.browserPaused = true;
      TTS_STATE.pausedBlockIndex = blockIdx;
      TTS_STATE.pausedPageKey = key;
    }
    const after = {
      playback: getPlaybackStatus(),
      session: ttsSessionSnapshot(),
      controls: getPlaybackControlEligibility(),
    };
    const payload = {
      success: !!ok,
      resumed: !!ok,
      restarted: !!ok,
      outcomeClass: ok ? 'preserved-re-entry' : 'blocked',
      route: ok ? 'browser-restart-from-preserved-block' : 'browser-resume-rejected',
      resumedSessionId: Number(TTS_STATE.activeSessionId || 0),
      resumedPageKey: key,
      resumedBlockIndex: blockIdx,
      sessionMatched: sameSession,
      pageMatched: samePage,
      before, after,
    };
    ttsDiagPush('resumed', payload);
    ttsDiagPush('resume-action', payload);
    ttsDiagPush('control-eligibility', after.controls);
    return payload;
  }

  // Native browser resume fallback.
  try {
    window.speechSynthesis.resume();
    TTS_STATE.browserPaused = !!window.speechSynthesis.paused;
    TTS_DEBUG.lastPauseStrategy = 'browser-speechsynthesis-resume';
  } catch (_) {}
  const after = {
    playback: getPlaybackStatus(),
    session: ttsSessionSnapshot(),
    controls: getPlaybackControlEligibility(),
  };
  const payload = {
    success: true,
    resumed: true,
    restarted: false,
    outcomeClass: 'live-mutate',
    route: 'browser-native-resume',
    resumedSessionId: Number(TTS_STATE.activeSessionId || 0),
    resumedPageKey: expectedPageKey,
    resumedBlockIndex: expectedBlock,
    sessionMatched: Number(TTS_STATE.activeSessionId || 0) === expectedSessionId,
    before, after,
  };
  ttsDiagPush('resumed', payload);
  ttsDiagPush('resume-action', payload);
  ttsDiagPush('control-eligibility', after.controls);
  return payload;
}

function pauseOrResumeReading() {
  const before = ttsBlockSnapshot();
  let route = 'unknown';
  let outcome = 'unknown';

  if (!before.playback.active) {
    try { TTS_STATE.playbackBlockedReason = ''; } catch (_) {}
    // Countdown active: runtime owns this routing decision.
    // Cancel the countdown and restart the last spoken page rather than
    // starting the currently focused page. Previously this branch lived in
    // the shell's handlePausePlay; moved here so the shell can be a pure
    // delegate for all playback actions.
    try {
      const countdown = getCountdownStatus();
      if (countdown.active) {
        const restarted = restartLastSpokenPageTts();
        route = 'restart-last-spoken-page';
        outcome = restarted ? 'restarted' : 'failed';
        ttsDiagPush('pause-resume-action', {
          action: 'play', route, outcome,
          outcomeClass: restarted ? 'full-restart' : 'blocked',
          before, after: ttsBlockSnapshot(),
        });
        return getPlaybackStatus();
      }
    } catch (_) {}
    try {
      if (typeof window.startFocusedPageTts === 'function') {
        const started = window.startFocusedPageTts();
        route = 'start-focused-page';
        outcome = started ? 'started' : 'failed';
        ttsDiagPush('pause-resume-action', {
          action: 'play', route, outcome,
          outcomeClass: started ? 'full-restart' : 'blocked',
          before, after: ttsBlockSnapshot(),
        });
        return getPlaybackStatus();
      }
    } catch (_) {}
    route = 'no-focused-page-fn';
    outcome = 'failed';
    ttsDiagPush('pause-resume-action', {
      action: 'play', route, outcome, outcomeClass: 'blocked',
      before, after: ttsBlockSnapshot(),
    });
    return before.playback;
  }

  if (before.playback.paused) {
    // A paused chunk-window cloud session is not a useful resume target once it
    // only has Phase 1 marks. Restart the focused page cleanly instead of making
    // the user spend one Play cycle clearing stale chunk state.
    if (isStaleChunkWindowCloudSession()) {
      route = 'stale-window-paused-restart-focused';
      ttsDiagPush('pause-resume-action', {
        action: 'stale-window-resume-cleared',
        route, outcome: 'clearing-stale-window-session',
        before,
        stale: {
          marksCount: getTtsCloudMarkCount(),
          chunkLimit: getTtsChunkWindowLimit(),
          audioEnded: !!TTS_STATE.audio?.ended,
          cloudWindow: {
            active: !!TTS_CLOUD_WINDOW.active,
            mode: TTS_CLOUD_WINDOW.mode,
            promotionTriggered: !!TTS_CLOUD_WINDOW.promotionTriggered,
            promotionApplied: !!TTS_CLOUD_WINDOW.promotionApplied,
          },
        },
        after: ttsBlockSnapshot(),
      });
      ttsStop();
      try {
        if (typeof window.startFocusedPageTts === 'function') {
          const started = window.startFocusedPageTts();
          outcome = started ? 'started' : 'failed';
          ttsDiagPush('pause-resume-action', {
            action: 'play', route, outcome,
            outcomeClass: started ? 'full-restart' : 'blocked',
            before, after: ttsBlockSnapshot(),
          });
        }
      } catch (_) {}
      return getPlaybackStatus();
    }

    // Check whether the paused session has a real resume hook before attempting.
    // A stale paused session (browserSpeakFromBlock cleared, audio element gone)
    // should restart the current focused page rather than looping into a failed
    // ttsResume() call.
    const hasRealResumeHook = (!isCloudRestartTransitionActive() && !!(TTS_STATE.audio && TTS_STATE.audio.paused && !TTS_STATE.audio.ended)) ||
      !!(TTS_STATE.browserPaused && TTS_STATE.browserSpeakFromBlock);
    if (!hasRealResumeHook) {
      // Stale session: clear paused state so startFocusedPageTts gets a clean run.
      TTS_STATE.browserPaused = false;
      TTS_STATE.pausedBlockIndex = -1;
      TTS_STATE.pausedPageKey = null;
      route = 'stale-paused-restart-focused';
      ttsDiagPush('pause-resume-action', {
        action: 'stale-resume-cleared',
        route, outcome: 'clearing-stale-session',
        before, after: ttsBlockSnapshot(),
      });
      try {
        if (typeof window.startFocusedPageTts === 'function') {
          const started = window.startFocusedPageTts();
          outcome = started ? 'started' : 'failed';
          ttsDiagPush('pause-resume-action', {
            action: 'play', route, outcome,
            outcomeClass: started ? 'full-restart' : 'blocked',
            before, after: ttsBlockSnapshot(),
          });
        }
      } catch (_) {}
      return getPlaybackStatus();
    }
    const resumed = ttsResume();
    route = 'resume';
    outcome = resumed && resumed.success ? 'resumed' : 'resume-failed';
  } else {
    const paused = ttsPause();
    route = 'pause';
    outcome = paused && paused.success ? 'paused' : 'pause-failed';
  }

  ttsDiagPush('pause-resume-action', {
    action: before.playback.paused ? 'resume' : 'pause',
    route, outcome, before, after: ttsBlockSnapshot(),
  });
  return getPlaybackStatus();
}

// ─── Cloud TTS path ───────────────────────────────────────────────────────────

async function cloudFetchUrl(text, opts = {}) {
  const controller = new AbortController();
  TTS_STATE.abort = controller;
  const payload = { text };
  const selectedVoicePref = getSelectedVoicePreference();
  if (selectedVoicePref.explicitCloud && selectedVoicePref.requestedCloudVoiceId) payload.voiceId = selectedVoicePref.requestedCloudVoiceId;
  if (opts && opts.sentenceMarks) payload.speechMarks = 'sentence';
  if (opts && opts.requestMode) payload.requestMode = String(opts.requestMode);
  TTS_DEBUG.lastCloudRequest = { chars: String(text || '').length, sentenceMarks: !!(opts && opts.sentenceMarks), requestMode: opts && opts.requestMode ? String(opts.requestMode) : '', selectedVoice: selectedVoicePref.stored, selectedVoiceType: selectedVoicePref.type, requestedVoiceId: selectedVoicePref.requestedCloudVoiceId, variant: TTS_STATE.voiceVariant || 'female' };
  try { const qs = new URLSearchParams(window.location.search); if (qs.get('debug') === '1') payload.debug = '1'; } catch (_) {}
  try { if (String(TTS_STATE.voiceVariant || '').toLowerCase() === 'male') payload.voiceVariant = 'male'; } catch (_) {}
  try { const saved = getStoredSelectedVoice(); if (saved.startsWith('cloud:')) payload.voiceId = saved.slice('cloud:'.length); } catch (_) {}
  try { if (localStorage.getItem('tts_nocache') === '1') payload.nocache = true; } catch (_) {}
  const endpoint = apiUrl('/api/ai?action=tts');
  const res = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: controller.signal,
  });
  let data = null, rawText = '';
  try { rawText = await res.text(); data = rawText ? JSON.parse(rawText) : null; } catch (_) {}
  if (!res.ok || !data?.url) {
    TTS_DEBUG.lastCloudResponse = { ok: false, status: res.status, payload: data || null, rawText: rawText || '' };
    const detail = data?.detail || data?.message || rawText || '';
    const msg = data?.error ? `${data.error}${detail ? `: ${detail}` : ''}` : `TTS request failed (${res.status})${detail ? `: ${detail}` : ''}`;
    throw new Error(msg);
  }
  const capability = normalizeTtsCapability(data?.capability);
  TTS_DEBUG.lastCloudResponse = {
    ok: true,
    status: res.status,
    provider: (capability && capability.provider) || data?.provider || null,
    cacheHit: !!data?.cacheHit,
    capability,
    debug: data?.debug || null,
  };
  ttsDiagPush('cloud-response', {
    ok: true,
    status: res.status,
    provider: TTS_DEBUG.lastCloudResponse.provider,
    cacheHit: !!data?.cacheHit,
    requestMode: opts && opts.requestMode ? String(opts.requestMode) : '',
    preciseSeekAvailable: !!capability?.preciseSeek?.available,
    preciseSeekReason: capability?.preciseSeek?.reason || '',
    marksIncludedInResponse: !!capability?.marks?.includedInResponse,
    marksProvenance: capability?.marks?.provenance || 'none',
    artifactVersion: capability?.artifact?.version || null,
  });
  return { url: data.url, sentenceMarks: Array.isArray(data.sentenceMarks) ? data.sentenceMarks : null, capability };
}

function clearTtsStartupBanner() {
  try { window.rcInteraction && window.rcInteraction.clear('tts:start'); } catch (_) {}
}

async function cloudFetchWithRetry(text, opts, { maxAttempts = 3, sessionId, getSessionId } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
      if (typeof getSessionId === 'function' && getSessionId() !== sessionId) return null;
    }
    try {
      return await cloudFetchUrl(text, opts);
    } catch (err) {
      lastErr = err;
      if (!isRecoverablePlaybackFailure(err)) throw err;
      ttsDiagPush('cloud-fetch-retry', { attempt: attempt + 1, maxAttempts, error: String(err?.message || err) });
    }
  }
  throw lastErr;
}

// ─── Cloud synthesis window — promotion functions ─────────────────────────────
//
// _ttsWindowTriggerPromotion: called from the highlight loop when activeBlockIndex
//   reaches 1. Fires a non-blocking full-page cloud fetch and wires the result
//   handler that immediately switches the audio src once the data arrives.
//
// _ttsWindowApplyPromotion: called from the .then() of the promotion fetch while
//   chunk A is still playing. Swaps audio.src to the full-page URL, seeks to the
//   start of the currently-active block, and restarts the highlight loop so skip
//   and pause immediately see full-page marks.

function _ttsWindowTriggerPromotion(signal) {
  if (!TTS_CLOUD_WINDOW.active || TTS_CLOUD_WINDOW.promotionTriggered) return;
  const { sessionId, pageKey: key, pageText } = TTS_CLOUD_WINDOW;
  if (TTS_STATE.activeSessionId !== sessionId) return;

  TTS_CLOUD_WINDOW.promotionTriggered = true;
  TTS_CLOUD_WINDOW.mode = 'promoting';
  TTS_CLOUD_WINDOW.engagementSignal = signal;

  ttsDiagPush('window-promotion-trigger', {
    signal,
    sessionId,
    key,
    charsPhase1: TTS_CLOUD_WINDOW.charsPhase1,
    charsFullPage: TTS_CLOUD_WINDOW.charsFullPage,
    activeBlockIndex: TTS_STATE.activeBlockIndex,
    ttsCloudMode: 'block-window',
  });

  const promise = cloudFetchWithRetry(
    pageText,
    { sentenceMarks: true, requestMode: 'full-page' },
    { maxAttempts: 3, sessionId, getSessionId: () => TTS_STATE.activeSessionId }
  );
  TTS_CLOUD_WINDOW.promotionFetchPromise = promise;

  promise.then(result => {
    if (!result || TTS_STATE.activeSessionId !== sessionId || !TTS_CLOUD_WINDOW.active) return;

    // Validate: the full-page result must contain more sentence marks than chunk A.
    // If the server/cache returned Phase 1 marks (e.g. the chunk-A artifact hash) in
    // response to requestMode:'full-page', applying it would set promotionApplied = true
    // with blockCount ≤ chunkASentenceCount. That prematurely closes the skip-safety
    // window — subsequent skips at the chunk-A boundary see promotionApplied = true and
    // fall through to cross-page-disabled instead of window-skip-deferred.
    const _resultMarkCount = result.sentenceMarks ? result.sentenceMarks.length : 0;
    const _chunkACount = TTS_CLOUD_WINDOW.chunkASentenceCount;
    if (_resultMarkCount <= _chunkACount) {
      ttsDiagPush('window-promotion-stale-phase1', {
        sessionId,
        key,
        returnedMarksCount: _resultMarkCount,
        chunkASentenceCount: _chunkACount,
        expectedMin: _chunkACount + 1,
        requestMode: 'full-page',
        audioCacheStatus: result.capability?.cache?.audio?.status || null,
        marksCacheStatus: result.capability?.cache?.marks?.status || null,
        artifactHash: result.capability?.artifact?.hash || null,
        phase: 'promotion-fetch',
        ttsCloudMode: 'stale-phase1-rejected',
      });
      // Leave the window state intact so the post-chunk-A handoff can see the
      // rejected promotion and fail through the normal cleanup path instead of
      // returning from ttsSpeakQueue with activeKey/audio but no live marks.
      return;
    }

    TTS_CLOUD_WINDOW.promotionResult = result;
    TTS_CLOUD_WINDOW.mode = 'promoted';
    TTS_CLOUD_WINDOW.charsSessionTotal = TTS_CLOUD_WINDOW.charsPhase1 + pageText.length;

    ttsDiagPush('window-promotion-ready', {
      sessionId,
      key,
      cacheHit: result.capability?.cache?.audio?.status === 'hit',
      returnedMarksCount: _resultMarkCount,
      chunkASentenceCount: _chunkACount,
      charsPhase1: TTS_CLOUD_WINDOW.charsPhase1,
      charsFullPage: pageText.length,
      charsSessionTotal: TTS_CLOUD_WINDOW.charsSessionTotal,
      ttsCloudMode: 'full-page',
      engagementSignal: signal,
    });

    // Passive engagement should not hot-swap into the currently speaking or
    // just-spoken Phase 1 block. Leave chunk A playing and let the Case B handoff
    // start full-page audio at the next unspoken block. Explicit user actions
    // such as skip keep the immediate apply path so controls remain responsive.
    const hasPendingExplicitSkip = Number(TTS_CLOUD_WINDOW.pendingSkipBlock || -1) >= 0 || TTS_CLOUD_WINDOW.pendingSkipSettling === true;
    if (isPassiveTtsWindowPromotionSignal(signal) && !hasPendingExplicitSkip) {
      ttsDiagPush('window-promotion-passive-handoff-deferred', {
        sessionId, key,
        signal,
        activeBlockIndex: TTS_STATE.activeBlockIndex,
        chunkASentenceCount: TTS_CLOUD_WINDOW.chunkASentenceCount,
        returnedMarksCount: _resultMarkCount,
        ttsCloudMode: 'full-page',
      });
      return;
    }

    // If chunk A is still playing: switch immediately for explicit skip/replay
    // actions. If chunk A has already ended: _ttsWindowApplyPromotion is a no-op
    // (audio.ended); the post-loop handoff path in ttsSpeakQueue will handle it.
    try { _ttsWindowApplyPromotion(sessionId, key, result); } catch (_) {}
  }).catch(err => {
    ttsDiagPush('window-promotion-failed', {
      sessionId,
      key,
      error: String(err?.message || err),
    });
    // Promotion failed. chunk A will still play to its natural end.
    // The post-loop handoff will re-await the promise and re-throw, which
    // propagates into the outer catch of ttsSpeakQueue.
  });
}

function _ttsWindowApplyPromotion(sessionId, key, result) {
  if (TTS_STATE.activeSessionId !== sessionId) return;
  if (String(TTS_STATE.activeKey || '') !== String(key || '')) return;
  const audio = TTS_STATE.audio;
  // Guard: chunk A already ended — let the post-loop handoff in ttsSpeakQueue handle it.
  if (!audio || audio.ended) return;

  const currentBlock = Math.max(0, Number(TTS_STATE.activeBlockIndex ?? 0));

  // Validate result.sentenceMarks BEFORE mutating runtime state.
  // Checking after apply (e.g. on TTS_STATE.highlightMarks) is too late — stale
  // Phase 1 marks would briefly become the live seek truth. Validate on the raw
  // result first so no state is mutated if the promotion is stale.
  const _resultMarkCount = result.sentenceMarks ? result.sentenceMarks.length : 0;
  const _chunkASentCount = TTS_CLOUD_WINDOW.chunkASentenceCount;
  if (_resultMarkCount <= _chunkASentCount) {
    ttsDiagPush('window-promotion-stale-phase1', {
      sessionId, key,
      returnedMarksCount: _resultMarkCount,
      chunkASentenceCount: _chunkASentCount,
      expectedMin: _chunkASentCount + 1,
      phase: 'apply-promotion',
      ttsCloudMode: 'stale-phase1-rejected',
    });
    // Do not apply — let chunk-A finish naturally. Don't swap src.
    return;
  }

  // Apply full-page marks so highlight spans cover the whole page. This calls
  // ttsClearSentenceHighlight() internally, which cancels the old RAF — we restart
  // it below after the src swap settles.
  if (result.sentenceMarks && result.sentenceMarks.length) {
    ttsMaybePrepareSentenceHighlight(key, TTS_CLOUD_WINDOW.pageText, result.sentenceMarks);
  }
  applyCloudCapabilityForRuntime({ key, sessionId, capability: result.capability, sentenceMarks: result.sentenceMarks });

  // Seek target: start of the current block in the full-page audio.
  // Full-page and chunk-A timings differ (different synthesis context), so we
  // seek to fullPageMarks[targetBlock].time rather than using audio.currentTime.
  // If a forward-skip arrived while chunk A was still playing (pendingSkipBlock),
  // advance to that block instead of the currently-active one.
  const marks = TTS_STATE.highlightMarks;
  const _pendingSkip = (Number.isFinite(TTS_CLOUD_WINDOW.pendingSkipBlock) && TTS_CLOUD_WINDOW.pendingSkipBlock >= 0)
    ? TTS_CLOUD_WINDOW.pendingSkipBlock : -1;
  TTS_CLOUD_WINDOW.pendingSkipBlock = -1; // consume
  TTS_CLOUD_WINDOW.pendingSkipSettling = false;
  const resolvedBlock = _pendingSkip >= 0 ? Math.max(currentBlock, _pendingSkip) : currentBlock;
  const targetBlock = Math.min(resolvedBlock, marks ? marks.length - 1 : 0);
  const seekTime = (marks && marks[targetBlock]) ? Math.max(0, Number(marks[targetBlock].time || 0) / 1000) : 0;

  const requestId = ++TTS_STATE.cloudRestartRequestId;
  TTS_STATE.cloudRestartInFlight = true;
  TTS_STATE.activeBlockIndex = targetBlock;
  ttsHighlightBlock(targetBlock);

  if (TTS_STATE.highlightRAF) {
    try { cancelAnimationFrame(TTS_STATE.highlightRAF); } catch (_) {}
    TTS_STATE.highlightRAF = null;
  }
  clearPendingCloudSeek();

  ttsDiagPush('window-promotion-apply', {
    sessionId, key, targetBlock, seekTime,
    pendingSkipBlock: _pendingSkip,
    charsPhase1: TTS_CLOUD_WINDOW.charsPhase1,
    charsFullPage: TTS_CLOUD_WINDOW.charsFullPage,
    charsSessionTotal: TTS_CLOUD_WINDOW.charsSessionTotal,
    ttsCloudMode: 'full-page',
  });

  try {
    audio.pause();
    if (TTS_STATE.cloudRestartRequestId !== requestId || TTS_STATE.activeSessionId !== sessionId) return;

    audio.src = result.url;

    // Use addEventListener (not oncanplay=) to avoid clobbering the applyPending
    // handler wired in ttsSpeakQueue. Both can fire; applyPending is a no-op when
    // no pending seek exists.
    audio.addEventListener('canplay', function onReady() {
      audio.removeEventListener('canplay', onReady);
      if (TTS_STATE.cloudRestartRequestId !== requestId || TTS_STATE.activeSessionId !== sessionId) {
        TTS_STATE.cloudRestartInFlight = false;
        return;
      }
      audio.currentTime = seekTime;
      try { audio.defaultPlaybackRate = Number(TTS_STATE.rate || 1); audio.playbackRate = Number(TTS_STATE.rate || 1); } catch (_) {}
      audio.play().then(() => {
        if (TTS_STATE.cloudRestartRequestId !== requestId || TTS_STATE.activeSessionId !== sessionId) {
          TTS_STATE.cloudRestartInFlight = false;
          return;
        }
        TTS_STATE.cloudRestartInFlight = false;
        TTS_CLOUD_WINDOW.promotionApplied = true;
        // Disarm the window coalescing machinery now that full-page audio is live.
        // pendingSkipBlock and pendingSkipSettling were consumed by the apply path,
        // but a skip that arrived during the brief cloudRestartInFlight window above
        // could have re-set them. Clear here so post-promotion skips go through the
        // normal timed-seek path unobstructed.
        TTS_CLOUD_WINDOW.pendingSkipSettling = false;
        TTS_CLOUD_WINDOW.pendingSkipBlock = -1;
        markTtsFullPageReady(key, { sessionId, source: 'promotion-apply', marksCount: _resultMarkCount });
        const _applyLastMark = result.sentenceMarks[_resultMarkCount - 1] || null;
        ttsDiagPush('window-full-page-coverage', {
          sessionId, key,
          source: 'promotion-apply',
          marksCount: _resultMarkCount,
          pageTextLength: TTS_CLOUD_WINDOW.pageText.length,
          lastMarkEnd: _applyLastMark ? Number(_applyLastMark.end || 0) : 0,
        });
        ttsStartHighlightLoop(audio);
        ttsDiagPush('window-promotion-applied', {
          sessionId, key, targetBlock, seekTime,
          audioCurrentTimeMs: audio.currentTime * 1000,
          ttsCloudMode: 'full-page',
        });
        if (_pendingSkip >= 0) {
          ttsDiagPush('window-skip-applied-after-promotion', { sessionId, key, targetBlock, pendingSkipBlock: _pendingSkip });
        }
      }).catch(err => {
        TTS_STATE.cloudRestartInFlight = false;
        ttsDiagPush('window-promotion-play-failed', { sessionId, key, error: String(err?.message || err) });
      });
    }, { once: true });

  } catch (err) {
    TTS_STATE.cloudRestartInFlight = false;
    ttsDiagPush('window-promotion-apply-failed', { sessionId, key, error: String(err?.message || err) });
  }
}

async function ttsSpeakQueue(key, parts) {
  const routeInfo = getPreferredTtsRouteInfo();
  TTS_DEBUG.lastRouteDecision = routeInfo;
  TTS_DEBUG.lastPlayRequest = { key, parts: (parts || []).length, path: routeInfo.requestedPath, reason: routeInfo.reason, selectedVoice: routeInfo.selected.stored };

  const before = ttsBlockSnapshot();

  // Case: same key, currently PAUSED → stop/deactivate (not resume).
  // Bottom-bar Play/Resume remains the resume owner for the paused session.
  if (TTS_STATE.activeKey === key && (TTS_STATE.browserPaused || (!isCloudRestartTransitionActive() && (TTS_STATE.audio && TTS_STATE.audio.paused)))) {
    ttsDiagPush('speak-request', { ...TTS_DEBUG.lastPlayRequest, route: 'toggle-stop-paused-same-key' });
    ttsStop();
    ttsDiagPush('speak-action', { action: 'stopped-paused-session', key, before, after: ttsBlockSnapshot() });
    return;
  }

  // Case: same key, actively speaking → stop (toggle off).
  if (TTS_STATE.activeKey === key) {
    ttsDiagPush('speak-request', { ...TTS_DEBUG.lastPlayRequest, route: 'toggle-stop-same-key' });
    ttsStop();
    ttsDiagPush('speak-action', { action: 'stopped', key, before, after: ttsBlockSnapshot() });
    return;
  }

  // Case: different key active → replace cleanly.
  if (TTS_STATE.activeKey && TTS_STATE.activeKey !== key) {
    ttsDiagPush('speak-request', { ...TTS_DEBUG.lastPlayRequest, route: 'replace-session', replacing: TTS_STATE.activeKey });
    ttsStop();
  } else {
    ttsDiagPush('speak-request', TTS_DEBUG.lastPlayRequest);
  }

  // Free tier, or explicit browser voice selection regardless of cloud capability.
  if (!routeInfo.cloudCapable || routeInfo.requestedPath === 'browser-selected') {
    browserSpeakQueue(key, parts);
    ttsDiagPush('speak-action', { action: 'started', route: 'browser', key, before, after: ttsBlockSnapshot() });
    return;
  }

  // Cloud path.
  TTS_DEBUG.lastResolvedPath = 'cloud';
  ttsUnlockAudio();

  const queue = (parts || []).map(t => String(t || '').trim()).filter(Boolean);
  if (!queue.length) return;

  const sessionId = ++TTS_STATE.activeSessionId;
  clearTtsBackendCapabilityState();
  clearTtsCloudWindow();
  clearPendingCloudSeek();
  clearCloudRestartTransition();
  TTS_STATE.activeKey = key;
  TTS_STATE.lastPageKey = key;
  TTS_STATE.activeBlockIndex = -1;
  TTS_STATE.pausedBlockIndex = -1;
  TTS_STATE.pausedPageKey = null;
  ttsSetButtonActive(key, true);
  ttsSetHintButton(key, true);

  // ── Block-window synthesis setup ──────────────────────────────────────────
  // For full-page reads (queue.length === 1) where sentence marks are used and
  // the page contains more than 2 sentences: synthesise only the first 2
  // sentences (chunk A) initially. The highlight loop triggers a non-blocking
  // full-page fetch when block 1 is reached. See _ttsWindowTriggerPromotion.
  const pageText = queue[0];
  const wantMarksForPage = optsForKeySentenceMarks(key);
  let useWindowMode = false;
  let chunkAText = pageText;

  if (wantMarksForPage && queue.length === 1) {
    const sentences = ttsWindowSplitSentences(pageText);
    const pageAlreadyPromoted = hasTtsFullPageReady(key);
    // Use window mode when: page has 3+ sentences AND the full page is long
    // enough for windowing to save meaningful Azure chars. Once this tab has
    // already validated full-page marks for the page, replay goes direct to the
    // full-page cache instead of re-entering chunk-A and exposing the same seam.
    if (sentences.length > 2 && pageText.length >= TTS_WINDOW_SMALL_PAGE_CHARS && !pageAlreadyPromoted) {
      useWindowMode = true;
      chunkAText = sentences.slice(0, 2).join('');
      TTS_CLOUD_WINDOW.active = true;
      TTS_CLOUD_WINDOW.mode = 'block-window';
      TTS_CLOUD_WINDOW.sessionId = sessionId;
      TTS_CLOUD_WINDOW.pageKey = key;
      TTS_CLOUD_WINDOW.pageText = pageText;
      TTS_CLOUD_WINDOW.chunkASentenceCount = 2;
      TTS_CLOUD_WINDOW.charsPhase1 = chunkAText.length;
      TTS_CLOUD_WINDOW.charsFullPage = pageText.length;
      TTS_CLOUD_WINDOW.charsSessionTotal = chunkAText.length;
      ttsDiagPush('window-init', {
        sessionId, key,
        sentences: sentences.length,
        charsPhase1: chunkAText.length,
        charsFullPage: pageText.length,
        ttsCloudMode: 'block-window',
      });
    } else if (sentences.length > 2) {
      // Full page is short, or this page already proved full-page marks in this
      // tab. Synthesise full page directly.
      ttsDiagPush(pageAlreadyPromoted ? 'window-bypassed-promoted-page' : 'window-skipped-short-page', {
        sessionId, key,
        sentences: sentences.length,
        pageLength: pageText.length,
        smallPageThreshold: TTS_WINDOW_SMALL_PAGE_CHARS,
        priorFullPageReady: pageAlreadyPromoted,
        ttsCloudMode: 'full-page',
      });
    }
  }
  try {
    // Pre-flight usage check (runs once before any cloud request).
    // Pass 3: server verdict gates the action; client counter is display-only.
    if (wantMarksForPage) {
      if (window.rcUsage && typeof window.rcUsage.check === 'function') {
        try {
          const verdict = await window.rcUsage.check('tts');
          if (!verdict.allowed) {
            try { TTS_STATE.playbackBlockedReason = 'usage-limit'; } catch (_) {}
            ttsSetButtonActive(key, false);
            ttsSetHintButton(key, false);
            clearTtsCloudWindow();
            return;
          }
        } catch (_) {} // server unreachable: proceed (safe degraded behavior)
      }
      try { if (window.rcUsage && typeof window.rcUsage.spend === 'function') window.rcUsage.spend('tts'); else if (typeof tokenSpend === 'function') tokenSpend('tts'); } catch (_) {}
    }

    for (let i = 0; i < queue.length; i++) {
      const isFirstItem = (i === 0);
      const wantMarks = isFirstItem && wantMarksForPage;
      // Window mode: synthesise chunk A (sentences 0+1) for the first request.
      const textToSynth = (isFirstItem && useWindowMode) ? chunkAText : queue[i];
      const requestMode = (isFirstItem && useWindowMode) ? 'block-window' : 'full-page';

      const tts = await cloudFetchWithRetry(textToSynth, { sentenceMarks: wantMarks, requestMode }, { maxAttempts: 3, sessionId, getSessionId: () => TTS_STATE.activeSessionId });
      if (!tts || TTS_STATE.activeSessionId !== sessionId) return;
      applyCloudCapabilityForRuntime({ key, sessionId, capability: tts.capability, sentenceMarks: tts.sentenceMarks });
      const url = tts.url;
      if (wantMarks) {
        // For window mode: pass the full pageText as rawText so sentence spans are
        // placed at their correct positions within the full page HTML. Chunk A's
        // byte offsets are relative to the start of the page text (sentences 0+1
        // occupy the same byte positions in both chunkAText and pageText).
        const highlightText = (isFirstItem && useWindowMode) ? pageText : queue[i];
        if (tts.sentenceMarks && tts.sentenceMarks.length) {
          ttsMaybePrepareSentenceHighlight(key, highlightText, tts.sentenceMarks);
          if (!useWindowMode && tts.sentenceMarks.length > getTtsChunkWindowLimit()) {
            markTtsFullPageReady(key, { sessionId, source: 'direct-full-page', marksCount: tts.sentenceMarks.length });
            const lastMark = tts.sentenceMarks[tts.sentenceMarks.length - 1] || null;
            ttsDiagPush('window-full-page-coverage', {
              sessionId, key,
              source: 'direct-full-page',
              marksCount: tts.sentenceMarks.length,
              pageTextLength: highlightText.length,
              lastMarkEnd: lastMark ? Number(lastMark.end || 0) : 0,
            });
          }
        } else {
          ttsPrepareEstimatedHighlight(key, queue[i], TTS_AUDIO_ELEMENT);
        }
      }
      if (TTS_STATE.activeSessionId !== sessionId) return;

      await new Promise((resolve, reject) => {
        const audio = TTS_AUDIO_ELEMENT;
        try { audio.loop = false; audio.pause(); } catch (_) {}
        audio.src = url;
        TTS_STATE.audio = audio;
        try { audio.volume = Math.max(0, Math.min(1, Number(TTS_STATE.volume ?? 1))); } catch (_) {}
        try { audio.defaultPlaybackRate = Number(TTS_STATE.rate || 1); audio.playbackRate = Number(TTS_STATE.rate || 1); } catch (_) {}
        ttsStartHighlightLoop(audio);
        const applyPending = (reason) => { try { applyPendingCloudSeekIfNeeded(audio, key, sessionId, reason); } catch (_) {} };
        try { audio.onloadedmetadata = () => applyPending('loadedmetadata'); } catch (_) {}
        try { audio.oncanplay = () => applyPending('canplay'); } catch (_) {}
        audio.onended = () => {
          // In window mode this is only chunk-A ending unless the full-page
          // promotion already swapped src. Keep chunk-A marks live until Case B
          // either latches full-page marks or fails through normal cleanup;
          // clearing here creates active/paused/no-marks stale state.
          if (isFirstItem && useWindowMode && !TTS_CLOUD_WINDOW.promotionApplied) {
            restoreNaturalWindowStateForHandoff(sessionId, key, pageText, chunkAText, 'chunk-a-onended');
            ttsBeginNaturalWindowHandoff(sessionId, key, 'chunk-ended-natural');
          } else {
            ttsClearSentenceHighlight();
          }
          resolve();
        };
        audio.onerror = () => reject(new Error('Audio playback failed'));
        audio.play().then(() => {
          clearTtsStartupBanner();
          applyPending('play-start');
        }).catch(reject);
      });

      if (TTS_STATE.activeSessionId !== sessionId) return;

      // ── Window post-chunk-A handoff ──────────────────────────────────────
      // After chunk A's onended fires one of two situations applies:
      //
      //   A) _ttsWindowApplyPromotion swapped audio.src mid-playback:
      //      The onended above actually fired for the FULL PAGE audio — the
      //      whole page is done. promotionApplied === true signals this.
      //
      //   B) Chunk A ended before the full-page fetch resolved:
      //      Await the in-flight promise, apply marks, seek past sentences 0+1,
      //      and play the full-page audio to completion.
      if (isFirstItem && useWindowMode) {
        if (TTS_CLOUD_WINDOW.promotionApplied) {
          // Case A: full page already played via mid-playback switch. Done.
          ttsDiagPush('window-complete-via-promotion', {
            sessionId, key,
            charsPhase1: TTS_CLOUD_WINDOW.charsPhase1,
            charsFullPage: TTS_CLOUD_WINDOW.charsFullPage,
            charsSessionTotal: TTS_CLOUD_WINDOW.charsSessionTotal,
            ttsCloudMode: 'full-page',
          });
          clearTtsCloudWindow();
        } else {
          // Case B: chunk A ended; promotion was triggered but not yet applied.
          // If promotion was never triggered before the natural block-window end,
          // restore the local window owner state and trigger full-page promotion
          // here. Case B remains the only owner of the actual handoff.
          if (!TTS_CLOUD_WINDOW.active || TTS_CLOUD_WINDOW.sessionId !== sessionId || TTS_CLOUD_WINDOW.pageKey !== key) {
            restoreNaturalWindowStateForHandoff(sessionId, key, pageText, chunkAText, 'case-b-preflight');
          }
          if (!TTS_CLOUD_WINDOW.promotionTriggered || !TTS_CLOUD_WINDOW.promotionFetchPromise) {
            ttsBeginNaturalWindowHandoff(sessionId, key, 'chunk-ended-natural-fallback');
          }

          ttsDiagPush('window-natural-handoff-await', {
            sessionId, key,
            userInitiated: false,
            promotionTriggered: !!TTS_CLOUD_WINDOW.promotionTriggered,
            promotionPending: !!TTS_CLOUD_WINDOW.promotionFetchPromise && !TTS_CLOUD_WINDOW.promotionResult,
            promotionReady: !!TTS_CLOUD_WINDOW.promotionResult,
            chosenHandoffBlock: Number(TTS_CLOUD_WINDOW.chunkASentenceCount || 0),
            staleWindowGuard: 'avoided-natural-continuation',
          });

          if (!TTS_CLOUD_WINDOW.promotionFetchPromise) {
            if (TTS_STATE.activeSessionId !== sessionId || String(TTS_STATE.activeKey || '') !== String(key || '')) {
              clearCloudRestartTransition({ invalidateRequest: false, unmute: true });
              return;
            }
            TTS_CLOUD_WINDOW.active = true;
            TTS_CLOUD_WINDOW.mode = 'handoff-pending';
            TTS_CLOUD_WINDOW.sessionId = sessionId;
            TTS_CLOUD_WINDOW.pageKey = key;
            TTS_CLOUD_WINDOW.pageText = pageText;
            TTS_CLOUD_WINDOW.chunkASentenceCount = Math.max(2, Number(TTS_CLOUD_WINDOW.chunkASentenceCount || 0) || 2);
            TTS_CLOUD_WINDOW.charsPhase1 = String(chunkAText || '').length || TTS_CLOUD_WINDOW.charsPhase1;
            TTS_CLOUD_WINDOW.charsFullPage = pageText.length;
            TTS_CLOUD_WINDOW.charsSessionTotal = TTS_CLOUD_WINDOW.charsPhase1;
            TTS_CLOUD_WINDOW.promotionTriggered = true;
            TTS_CLOUD_WINDOW.engagementSignal = 'chunk-ended-natural-direct-fallback';
            TTS_CLOUD_WINDOW.promotionFetchPromise = cloudFetchWithRetry(
              pageText,
              { sentenceMarks: true, requestMode: 'full-page' },
              { maxAttempts: 3, sessionId, getSessionId: () => TTS_STATE.activeSessionId }
            );
            ttsDiagPush('window-natural-handoff-direct-fetch-fallback', {
              sessionId, key,
              userInitiated: false,
              promotionTriggered: true,
              promotionPending: true,
              promotionReady: false,
              chosenHandoffBlock: Number(TTS_CLOUD_WINDOW.chunkASentenceCount || 0),
              staleWindowGuard: 'avoided-natural-continuation',
              charsPhase1: TTS_CLOUD_WINDOW.charsPhase1,
              charsFullPage: TTS_CLOUD_WINDOW.charsFullPage,
            });
          }

          const fullResult = await TTS_CLOUD_WINDOW.promotionFetchPromise;
          if (!fullResult || TTS_STATE.activeSessionId !== sessionId) {
            clearCloudRestartTransition({ invalidateRequest: false, unmute: true });
            return;
          }
          TTS_CLOUD_WINDOW.promotionResult = fullResult;
          TTS_CLOUD_WINDOW.mode = 'promoted';
          TTS_CLOUD_WINDOW.charsSessionTotal = TTS_CLOUD_WINDOW.charsPhase1 + pageText.length;

          ttsDiagPush('window-natural-handoff-ready', {
            sessionId, key,
            userInitiated: false,
            promotionTriggered: !!TTS_CLOUD_WINDOW.promotionTriggered,
            promotionPending: false,
            promotionReady: true,
            returnedMarksCount: Array.isArray(fullResult.sentenceMarks) ? fullResult.sentenceMarks.length : 0,
            chosenHandoffBlock: Number(TTS_CLOUD_WINDOW.chunkASentenceCount || 0),
          });

          // Validate fullResult.sentenceMarks BEFORE mutating runtime state.
          // Applying stale Phase 1 marks (returned count <= chunkASentenceCount) would
          // make them briefly live seek truth and corrupt skip boundary detection.
          const _caseBMarkCount = fullResult.sentenceMarks ? fullResult.sentenceMarks.length : 0;
          const _caseBChunkACount = TTS_CLOUD_WINDOW.chunkASentenceCount;
          if (_caseBMarkCount <= _caseBChunkACount) {
            ttsDiagPush('window-promotion-stale-phase1', {
              sessionId, key,
              returnedMarksCount: _caseBMarkCount,
              chunkASentenceCount: _caseBChunkACount,
              expectedMin: _caseBChunkACount + 1,
              requestMode: 'full-page',
              audioCacheStatus: fullResult.capability?.cache?.audio?.status || null,
              marksCacheStatus: fullResult.capability?.cache?.marks?.status || null,
              artifactHash: fullResult.capability?.artifact?.hash || null,
              phase: 'case-b-handoff',
              ttsCloudMode: 'stale-phase1-rejected',
            });
            clearCloudRestartTransition({ invalidateRequest: false, unmute: true });
            throw new Error('stale-phase1-promotion-result');
          }

          applyCloudCapabilityForRuntime({ key, sessionId, capability: fullResult.capability, sentenceMarks: fullResult.sentenceMarks });
          if (fullResult.sentenceMarks && fullResult.sentenceMarks.length) {
            ttsMaybePrepareSentenceHighlight(key, pageText, fullResult.sentenceMarks);
          }

          // Seek into the full-page audio past chunk A's sentences.
          // If the user skipped forward while waiting for promotion, honour that
          // intent by jumping to the requested block (pendingSkipBlock) instead of
          // just the end of chunk A.
          const fullMarks = TTS_STATE.highlightMarks;
          const chunkAEnd = Math.min(TTS_CLOUD_WINDOW.chunkASentenceCount, fullMarks ? fullMarks.length - 1 : 0);
          const _handoffPendingSkip = (Number.isFinite(TTS_CLOUD_WINDOW.pendingSkipBlock) && TTS_CLOUD_WINDOW.pendingSkipBlock >= 0)
            ? TTS_CLOUD_WINDOW.pendingSkipBlock : -1;
          TTS_CLOUD_WINDOW.pendingSkipBlock = -1; // consume
          TTS_CLOUD_WINDOW.pendingSkipSettling = false;
          // Mark full-page marks/audio as the active seek/skip truth (Case B equivalent
          // of the promotionApplied = true set in _ttsWindowApplyPromotion for Case A).
          // Without this, all three window-skip guards would see promotionApplied === false
          // and incorrectly defer/coalesce skips — including attempts to skip past the last
          // block (target >= blockCount), which would set pendingSkipSettling = true and
          // lock out every subsequent forward skip for the rest of the session.
          TTS_CLOUD_WINDOW.promotionApplied = true;
          markTtsFullPageReady(key, { sessionId, source: 'case-b-handoff', marksCount: _caseBMarkCount });
          const _caseBLastMark = fullResult.sentenceMarks[_caseBMarkCount - 1] || null;
          ttsDiagPush('window-full-page-coverage', {
            sessionId, key,
            source: 'case-b-handoff',
            marksCount: _caseBMarkCount,
            pageTextLength: pageText.length,
            lastMarkEnd: _caseBLastMark ? Number(_caseBLastMark.end || 0) : 0,
          });
          const startBlock = Math.min(
            _handoffPendingSkip >= 0 ? Math.max(chunkAEnd, _handoffPendingSkip) : chunkAEnd,
            fullMarks ? fullMarks.length - 1 : 0
          );
          TTS_STATE.activeBlockIndex = startBlock;
          try { ttsHighlightBlock(startBlock); } catch (_) {}
          queuePendingCloudSeek(key, sessionId, startBlock, 0);

          ttsDiagPush('window-handoff-after-chunk-a', {
            sessionId, key, startBlock, chunkAEnd,
            pendingSkipBlock: _handoffPendingSkip,
            userInitiated: _handoffPendingSkip >= 0,
            passiveHandoff: _handoffPendingSkip < 0,
            promotionTriggered: !!TTS_CLOUD_WINDOW.promotionTriggered,
            promotionPending: false,
            promotionReady: true,
            staleWindowGuard: _handoffPendingSkip < 0 ? 'avoided-natural-continuation' : 'not-applicable-user-initiated',
            seekTimeMs: (fullMarks && fullMarks[startBlock]) ? fullMarks[startBlock].time : null,
            charsPhase1: TTS_CLOUD_WINDOW.charsPhase1,
            charsFullPage: pageText.length,
            charsSessionTotal: TTS_CLOUD_WINDOW.charsSessionTotal,
            ttsCloudMode: 'full-page',
          });
          ttsDiagPush('window-promotion-applied', {
            sessionId, key, startBlock,
            path: 'case-b-handoff',
            ttsCloudMode: 'full-page',
          });
          if (_handoffPendingSkip >= 0) {
            ttsDiagPush('window-skip-applied-after-promotion', { sessionId, key, targetBlock: startBlock, pendingSkipBlock: _handoffPendingSkip, handoff: true });
          }

          if (TTS_STATE.activeSessionId !== sessionId) return;

          // Play full-page audio from startBlock onward.
          await new Promise((resolve, reject) => {
            const audio = TTS_AUDIO_ELEMENT;
            try { audio.loop = false; audio.pause(); } catch (_) {}
            audio.src = fullResult.url;
            TTS_STATE.audio = audio;
            try { audio.volume = Math.max(0, Math.min(1, Number(TTS_STATE.volume ?? 1))); } catch (_) {}
            try { audio.defaultPlaybackRate = Number(TTS_STATE.rate || 1); audio.playbackRate = Number(TTS_STATE.rate || 1); } catch (_) {}
            const applyPending = (reason) => { try { applyPendingCloudSeekIfNeeded(audio, key, sessionId, reason); } catch (_) {} };
            try { audio.onloadedmetadata = () => applyPending('loadedmetadata'); } catch (_) {}
            try { audio.oncanplay = () => applyPending('canplay'); } catch (_) {}
            audio.onended = () => { ttsClearSentenceHighlight(); resolve(); };
            audio.onerror = () => reject(new Error('Audio playback failed'));
            audio.play().then(() => {
              clearTtsStartupBanner();
              applyPending('play-start');
              ttsStartHighlightLoop(audio);
              clearCloudRestartTransition({ invalidateRequest: false, unmute: true });
            }).catch(err => {
              clearCloudRestartTransition({ invalidateRequest: false, unmute: true });
              reject(err);
            });
          });

          if (TTS_STATE.activeSessionId !== sessionId) return;
          clearTtsCloudWindow();
        }
      }
    }

    TTS_STATE.activeKey = null;
    ttsSetButtonActive(key, false);
    ttsSetHintButton(key, false);
    if (optsForKeySentenceMarks(key)) {
      const _cp = (typeof readingTargetFromKey === 'function') ? readingTargetFromKey(key) : null;
      const pageIndex = _cp ? _cp.pageIndex : -1;
      if (Number.isFinite(pageIndex) && pageIndex >= 0) { ttsKeepWarmForAutoplay(); ttsAutoplayScheduleNext({ pageIndex, key, reason: 'page-complete' }); }
    }
    clearTtsStartupBanner();
    ttsDiagPush('speak-action', { action: 'completed', route: 'cloud', key, before, after: ttsBlockSnapshot() });

  } catch (err) {
    clearTtsStartupBanner();
    clearTtsCloudWindow();
    if (TTS_STATE.activeSessionId !== sessionId) return;
    if (err && (err.name === 'AbortError' || String(err).includes('aborted'))) return;
    const ri = getPreferredTtsRouteInfo();
    const msg = String(err && err.message ? err.message : err);
    const recoverable = isRecoverablePlaybackFailure(err);
    TTS_STATE.playbackBlockedReason = msg;
    TTS_DEBUG.lastError = { at: new Date().toISOString(), path: 'cloud', key, message: msg, recoverable };
    ttsDiagPush('cloud-playback-failed', { key, message: msg, route: ri, recoverable });
    console.warn('Cloud TTS unavailable; keeping browser fallback disabled for predictable voice behavior:', err);
    try {
      const actions = window.rcInteraction && window.rcInteraction.actions
        ? [window.rcInteraction.actions.retry(() => { try { if (typeof window.startFocusedPageTts === 'function') window.startFocusedPageTts(); } catch (_) {} })]
        : [];
      window.rcInteraction && window.rcInteraction.error('tts:start', 'Playback couldn\'t start.', { actions });
    } catch (_) {}
    ttsStop();
    if (recoverable) {
      // Keep explicit cloud selection intact, but do not treat transient cloud
      // transport/server failure as a lasting capability block. The user should
      // be able to press Play again immediately after the failed session stops.
      TTS_STATE.playbackBlockedReason = '';
    }
    TTS_DEBUG.lastResolvedPath = ri.selected.explicitCloud ? 'cloud-failure-explicit' : 'cloud-failure';
    return;
  }
}

// ─── Block-indexed skip ────────────────────────────────────────────────────────
//
// Operates on TTS_STATE.activeBlockIndex. Not on vague currentTime offsets.
// At page boundaries: next crosses to next page; prev restarts block 0.
// Cloud skip entry must start from the landed block itself so audible entry
// cannot trail behind the visible block after a skip.
// Browser path: no clip risk (each utterance starts from char 0 of sentence).

function isRuntimePausedForContract() {
  if (isCloudRestartTransitionActive()) return false;
  try {
    if (TTS_STATE.audio) return !!TTS_STATE.audio.paused;
  } catch (_) {}
  if (TTS_STATE.browserPaused) return true;
  try {
    if (browserTtsSupported()) return !!window.speechSynthesis.paused;
  } catch (_) {}
  return false;
}

function ttsJumpPagePreserve(delta) {
  return ttsRunPageHandoff({
    key: String(TTS_STATE.activeKey || ''),
    delta,
    mode: 'paused',
    targetBlockIndex: 0,
    behavior: 'smooth',
    reason: 'paused-page-preserve',
  });
}

async function ttsPreparePausedCloudPage(pageIndex) {
  // Key derives from the authoritative reading target, which must already reflect
  // this pageIndex (set by ttsJumpPagePreserve before calling this function).
  const _cur = window.__rcReadingTarget || {};
  const key = (typeof readingTargetToKey === 'function')
    ? readingTargetToKey({ sourceType: _cur.sourceType || '', bookId: _cur.bookId || '', chapterIndex: _cur.chapterIndex != null ? _cur.chapterIndex : -1, pageIndex: Number(pageIndex) })
    : `page-${pageIndex}`;
  if (typeof pages === 'undefined' || !pages[pageIndex]) return false;
  const text = pages[pageIndex];
  const sessionId = ++TTS_STATE.activeSessionId;
  clearTtsBackendCapabilityState();
  clearPendingCloudSeek();
  clearCloudRestartTransition();

  // Immediate state so UI reflects the navigation target.
  TTS_STATE.activeKey = key;
  TTS_STATE.lastPageKey = key;
  TTS_STATE.activeBlockIndex = 0;
  TTS_STATE.pausedBlockIndex = 0;
  TTS_STATE.pausedPageKey = key;
  TTS_STATE.browserPaused = false;
  TTS_STATE.playbackBlockedReason = '';

  ttsSetButtonActive(key, true);
  ttsSetHintButton(key, true);

  try { ttsClearSentenceHighlight(); } catch (_) {}

  // Prevent an early "Play" from starting the previous page's audio while
  // we fetch/prep the next page URL.
  const audio = TTS_AUDIO_ELEMENT;
  try {
    audio.loop = false;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  } catch (_) {}
  TTS_STATE.audio = audio;

  // Fast highlight (estimated timings) while we fetch real sentence marks.
  try { ttsPrepareEstimatedHighlight(key, text, TTS_AUDIO_ELEMENT); } catch (_) {}
  try { ttsHighlightBlock(0); } catch (_) {}

  try {
    const tts = await cloudFetchUrl(text, { sentenceMarks: true });
    if (TTS_STATE.activeSessionId !== sessionId) return false;
    applyCloudCapabilityForRuntime({ key, sessionId, capability: tts.capability, sentenceMarks: tts.sentenceMarks });
    const audio = TTS_AUDIO_ELEMENT;
    try { audio.loop = false; audio.pause(); } catch (_) {}

    audio.src = tts.url;
    TTS_STATE.audio = audio;

    if (tts?.sentenceMarks && Array.isArray(tts.sentenceMarks) && tts.sentenceMarks.length) {
      try { ttsMaybePrepareSentenceHighlight(key, text, tts.sentenceMarks); } catch (_) {}
    } else {
      try { ttsPrepareEstimatedHighlight(key, text, audio); } catch (_) {}
    }
    try { TTS_STATE.activeBlockIndex = 0; ttsHighlightBlock(0); } catch (_) {}
  } catch (_) {
    // Best-effort: if cloud preparation fails, fall back to existing skip behavior.
    // (Skip contract is primarily enforced for browser path.)
    try { ttsSpeakQueue(key, [text]); } catch (_) {}
  }
  return true;
}

function ttsRestartCloudFromBlockStart(audio, key, sessionId, blockIdx, seekTime, reason = 'cloud-skip-restart') {
  if (!audio) return false;
  const target = Number.isFinite(Number(blockIdx)) ? Number(blockIdx) : -1;
  if (target < 0) return false;
  const requestId = Number(TTS_STATE.cloudRestartRequestId || 0) + 1;
  const targetPreview = ttsGetBlockPreview(key, target);
  TTS_STATE.cloudRestartRequestId = requestId;
  TTS_STATE.cloudRestartInFlight = true;
  clearPendingCloudSeek();
  try { audio.muted = true; } catch (_) {}
  if (TTS_STATE.highlightRAF) { try { cancelAnimationFrame(TTS_STATE.highlightRAF); } catch (_) {} TTS_STATE.highlightRAF = null; }
  TTS_STATE.activeBlockIndex = target;
  try { ttsHighlightBlock(target); } catch (_) {}
  ttsDiagPush('cloud-restart-request', {
    key,
    sessionId,
    requestId,
    targetBlock: target,
    seekTime,
    reason,
    pageIndex: targetPreview?.pageIndex ?? -1,
    excerpt: targetPreview?.excerpt || '',
    rangeSource: targetPreview?.rangeSource || 'none',
  });

  const finalizeIfCurrent = (outcome, extra = {}) => {
    if (Number(TTS_STATE.cloudRestartRequestId || 0) !== requestId) return false;
    if (Number(TTS_STATE.activeSessionId || 0) !== Number(sessionId || 0)) return false;
    if (String(TTS_STATE.activeKey || '') !== String(key || '')) return false;
    if (outcome === 'applied') {
      try { audio.muted = false; } catch (_) {}
      TTS_STATE.cloudRestartInFlight = false;
      TTS_STATE.pausedBlockIndex = -1;
      TTS_STATE.pausedPageKey = null;
      ttsStartHighlightLoop(audio);
      ttsDiagPush('cloud-restart-applied', { key, sessionId, requestId, targetBlock: target, seekTime, reason, audioCurrentTimeMsAtUnmute: audio.currentTime * 1000, markProvenance: TTS_STATE.highlightMarksProvenance || 'unknown', ...extra });
      return true;
    }
    if (outcome === 'failed') {
      try { audio.muted = false; } catch (_) {}
      TTS_STATE.cloudRestartInFlight = false;
      ttsDiagPush('cloud-restart-failed', { key, sessionId, requestId, targetBlock: target, seekTime, reason, ...extra });
      return true;
    }
    return false;
  };

  try {
    audio.pause();
    if (Number(TTS_STATE.cloudRestartRequestId || 0) !== requestId || Number(TTS_STATE.activeSessionId || 0) !== Number(sessionId || 0) || String(TTS_STATE.activeKey || '') !== String(key || '')) {
      ttsDiagPush('cloud-restart-suppressed', { key, sessionId, requestId, targetBlock: target, reason: 'superseded-after-pause' });
      return false;
    }
    audio.currentTime = seekTime;
    const playResult = audio.play();
    if (playResult && typeof playResult.then === 'function') {
      playResult.then(() => {
        if (!finalizeIfCurrent('applied')) {
          ttsDiagPush('cloud-restart-suppressed', { key, sessionId, requestId, targetBlock: target, reason: 'superseded-after-play' });
        }
      }).catch((err) => {
        finalizeIfCurrent('failed', { message: String(err?.message || err || 'unknown') });
      });
    } else {
      finalizeIfCurrent('applied', { playResolution: 'sync' });
    }
    return true;
  } catch (err) {
    finalizeIfCurrent('failed', { message: String(err?.message || err || 'unknown') });
    return false;
  }
}

function ttsJumpSentence(delta) {

  if (!TTS_STATE.activeKey) {
    ttsDiagPush('skip-block', { delta, resolved: 'no-active-key' });
    TTS_DEBUG.lastSkip = { resolved: 'no-active-key', delta };
    return false;
  }

  const key = TTS_STATE.activeKey;
  const _parsedJump = (typeof readingTargetFromKey === 'function') ? readingTargetFromKey(String(key)) : null;
  const sourcePage = _parsedJump ? _parsedJump.pageIndex : -1;
  const sourceBlock = TTS_STATE.activeBlockIndex;
  const marks = TTS_STATE.highlightMarks;
  const blockCount = marks ? marks.length : 0;
  const pausedForContract = isRuntimePausedForContract();
  ttsDiagPush('skip-intent', {
    delta,
    key,
    sourcePage,
    activeBlockIndex: Number(TTS_STATE.activeBlockIndex ?? -1),
    pausedBlockIndex: Number(TTS_STATE.pausedBlockIndex ?? -1),
    highlightBlockIndex: Number(TTS_STATE.activeBlockIndex ?? -1),
    audioCurrentTimeMs: TTS_STATE.audio ? TTS_STATE.audio.currentTime * 1000 : null,
    activeBlockMarkTimeMs: (marks && Number.isFinite(TTS_STATE.activeBlockIndex) && TTS_STATE.activeBlockIndex >= 0 && marks[TTS_STATE.activeBlockIndex]) ? marks[TTS_STATE.activeBlockIndex].time : null,
    markProvenance: TTS_STATE.highlightMarksProvenance || 'unknown',
    hasAudio: !!TTS_STATE.audio,
    hasBrowserSpeakFromBlock: !!TTS_STATE.browserSpeakFromBlock,
    blockCount,
    pausedForContract,
    runtimePath: TTS_STATE.audio ? 'cloud-audio' : (TTS_STATE.browserSpeakFromBlock ? 'browser-speech' : 'none'),
    cloudWindow: {
      active: !!TTS_CLOUD_WINDOW.active,
      mode: TTS_CLOUD_WINDOW.mode,
      sessionId: TTS_CLOUD_WINDOW.sessionId,
      promotionTriggered: !!TTS_CLOUD_WINDOW.promotionTriggered,
      promotionApplied: !!TTS_CLOUD_WINDOW.promotionApplied,
      chunkASentenceCount: TTS_CLOUD_WINDOW.chunkASentenceCount,
      pendingSkipBlock: TTS_CLOUD_WINDOW.pendingSkipBlock,
      pendingSkipSettling: !!TTS_CLOUD_WINDOW.pendingSkipSettling,
    },
  });

  // ── Cloud path ───────────────────────────────────────────────────────────────
  const audio = TTS_STATE.audio;

  // Window seam guard: while a cloud seek or block-window → full-page promotion
  // is unsettled, forward skip must not re-enter chunk-A seek/restart logic.
  // Capture one same-page intent and coalesce rapid extra clicks until full-page
  // marks/audio are ready.
  //
  // Guard exits (promotionApplied = true) when the full-page src-swap is fully
  // settled and normal timed-seek can take over. All three window branches below
  // are also gated on !promotionApplied for the same reason.
  if (audio && delta > 0 && TTS_CLOUD_WINDOW.active && !TTS_CLOUD_WINDOW.promotionApplied && (
    TTS_STATE.cloudRestartInFlight ||
    TTS_CLOUD_WINDOW.pendingSkipSettling ||
    (TTS_CLOUD_WINDOW.promotionTriggered && !TTS_CLOUD_WINDOW.promotionApplied && TTS_CLOUD_WINDOW.mode !== 'promoted')
  )) {
    return ttsWindowRecordForwardSkipIntent('skip-forward-window-settling', { delta, key, sourcePage, sourceBlock });
  }

  // ── Window mode: forward skip with no marks ───────────────────────────────
  // Chunk A has ended and the full-page handoff is in progress — marks are
  // temporarily null while the promotion fetch or Case B await is in flight.
  // Record the desired advance block so the handoff/apply path picks it up.
  // Only applies pre-promotion; after promotionApplied the marks are the full
  // page marks and a null-marks state would be a separate fault.
  if (audio && (!marks || blockCount === 0) && TTS_CLOUD_WINDOW.active && !TTS_CLOUD_WINDOW.promotionApplied && delta > 0) {
    return ttsWindowRecordForwardSkipIntent('skip-forward-no-marks', { delta, key, sourcePage, sourceBlock });
  }

  if (audio && delta > 0 && marks && blockCount > 0 &&
      TTS_CLOUD_WINDOW.active && !TTS_CLOUD_WINDOW.promotionApplied &&
      !TTS_CLOUD_WINDOW.promotionTriggered) {
    // A manual forward skip is stronger engagement than the elapsed-time gate.
    // Start full-page promotion immediately, while still allowing the first
    // in-window skip (0 → 1) to land normally.
    try { _ttsWindowTriggerPromotion('skip-forward-window-preload'); } catch (_) {}
  }

  if (audio && marks && blockCount > 0) {
    let target = sourceBlock + (delta < 0 ? -1 : 1);

    if (target < 0) target = 0; // prev at block 0 → restart block 0

    if (target >= blockCount) {
      if (TTS_CLOUD_WINDOW.active && !TTS_CLOUD_WINDOW.promotionApplied) {
        // Forward skip past the chunk-A boundary is a high-engagement signal,
        // but full-page marks may not be bound yet. Serialize it as one
        // pending same-page intent so rapid clicks cannot repeatedly restart
        // chunk-A audio or fall through to cross-page navigation.
        return ttsWindowRecordForwardSkipIntent('skip-forward-engagement', { delta, key, sourcePage, sourceBlock });
      }
      // Stale-promotion guard: promotionApplied=true but blockCount still equals
      // chunk-A count means the full-page marks never latched (the Phase 1 result
      // was returned by the server for a full-page request and was rejected, leaving
      // blockCount at chunkASentenceCount). Treat as unpromoted so the skip defers
      // rather than falling through to cross-page-disabled.
      if (TTS_CLOUD_WINDOW.active && TTS_CLOUD_WINDOW.promotionApplied &&
          blockCount <= TTS_CLOUD_WINDOW.chunkASentenceCount) {
        ttsDiagPush('window-skip-stale-promotion-reroute', {
          sessionId: TTS_STATE.activeSessionId, key,
          sourcePage, sourceBlock, blockCount,
          chunkASentenceCount: TTS_CLOUD_WINDOW.chunkASentenceCount,
        });
        return ttsWindowRecordForwardSkipIntent('skip-forward-stale-promotion', { delta, key, sourcePage, sourceBlock });
      }
      // Not in window mode — cross-page navigation disabled.
      /* disabled cross-page path — kept for reference:
      const moved = pausedForContract ? ttsJumpPagePreserve(1) : ttsJumpPage(1);
      const skipResult = { at: new Date().toISOString(), type: 'block', delta, sourcePage, sourceBlock, resolvedPage: sourcePage + 1, resolvedBlock: 0, crossPage: true, moved, path: pausedForContract ? 'cloud-cross-page-preserve' : 'cloud-cross-page', clippingProtection: false };
      TTS_DEBUG.lastSkip = skipResult;
      ttsDiagPush('skip-block', skipResult);
      return moved;
      */
      const skipResult = { at: new Date().toISOString(), type: 'block', delta, sourcePage, sourceBlock, resolved: 'unavailable', crossPage: false, path: 'cross-page-disabled', sessionId: TTS_STATE.activeSessionId };
      TTS_DEBUG.lastSkip = skipResult;
      ttsDiagPush('skip-block', skipResult);
      return false;
    }

    const leadMs = 0;
    const rawTimeS = Number(marks[target].time || 0) / 1000;
    const seekTime = Math.max(0, rawTimeS - leadMs / 1000);
    const mediaSeekReady = Number(audio.readyState || 0) >= 1;
    const targetPreview = ttsGetBlockPreview(key, target);

    ttsDiagPush('cloud-seek-request', {
      key,
      delta,
      sourcePage,
      sourceBlock,
      targetBlock: target,
      pausedForContract,
      mediaSeekReady,
      sessionId: TTS_STATE.activeSessionId,
      pageIndex: targetPreview?.pageIndex ?? -1,
      excerpt: targetPreview?.excerpt || '',
      rangeSource: targetPreview?.rangeSource || 'none',
      rangeStart: targetPreview?.start ?? -1,
      rangeEnd: targetPreview?.end ?? -1,
      seekTime,
      rawTimeS,
      blockTimeMs: Number(marks[target].time || 0),
      markProvenance: TTS_STATE.highlightMarksProvenance || 'unknown',
    });

    TTS_STATE.activeBlockIndex = target;
    ttsHighlightBlock(target);
    if (pausedForContract) {
      TTS_STATE.pausedBlockIndex = target;
      TTS_STATE.pausedPageKey = key;
    }

    if (!mediaSeekReady) {
      queuePendingCloudSeek(key, TTS_STATE.activeSessionId, target, leadMs);
      const skipResult = { at: new Date().toISOString(), type: 'block', delta, sourcePage, sourceBlock, resolvedPage: sourcePage, resolvedBlock: target, crossPage: false, moved: true, path: 'cloud-seek-deferred-not-ready', clippingProtection: leadMs > 0, leadMs, sessionId: TTS_STATE.activeSessionId };
      TTS_DEBUG.lastSkip = skipResult;
      ttsDiagPush('skip-block', skipResult);
      return true;
    }

    let moved = true;
    try {
      if (pausedForContract) {
        audio.currentTime = seekTime;
        clearPendingCloudSeek();
      } else {
        moved = ttsRestartCloudFromBlockStart(audio, key, TTS_STATE.activeSessionId, target, seekTime, 'cloud-skip-restart');
      }
    } catch (_) {
      queuePendingCloudSeek(key, TTS_STATE.activeSessionId, target, leadMs);
      const skipResult = { at: new Date().toISOString(), type: 'block', delta, sourcePage, sourceBlock, resolvedPage: sourcePage, resolvedBlock: target, crossPage: false, moved: true, path: 'cloud-seek-deferred-after-error', clippingProtection: leadMs > 0, leadMs, sessionId: TTS_STATE.activeSessionId };
      TTS_DEBUG.lastSkip = skipResult;
      ttsDiagPush('skip-block', skipResult);
      return true;
    }

    const skipResult = { at: new Date().toISOString(), type: 'block', delta, sourcePage, sourceBlock, resolvedPage: sourcePage, resolvedBlock: target, crossPage: false, moved, path: pausedForContract ? 'cloud-seek-paused' : 'cloud-seek-restart-from-block-start', clippingProtection: leadMs > 0, leadMs, seekTime, blockTimeMs: Number(marks[target].time || 0), sessionId: TTS_STATE.activeSessionId };
    TTS_DEBUG.lastSkip = skipResult;
    ttsDiagPush('skip-block', skipResult);
    return moved;
  }

  // ── Browser path ─────────────────────────────────────────────────────────────
  if (browserTtsSupported() && TTS_STATE.browserSpeakFromBlock) {
    const ranges = TTS_STATE.browserSentenceRanges;
    const rangeCount = ranges ? ranges.length : 0;
    let target = sourceBlock + (delta < 0 ? -1 : 1);

    if (target < 0) target = 0;

    if (target >= rangeCount) {
      // Cross-page navigation disabled — same policy as cloud path.
      /* disabled cross-page path — kept for reference:
      const moved = pausedForContract ? ttsJumpPagePreserve(1) : ttsJumpPage(1);
      const skipResult = { at: new Date().toISOString(), type: 'block', delta, sourcePage, sourceBlock, resolvedPage: sourcePage + 1, resolvedBlock: 0, crossPage: true, moved, path: pausedForContract ? 'browser-cross-page-preserve' : 'browser-cross-page', clippingProtection: false };
      TTS_DEBUG.lastSkip = skipResult;
      ttsDiagPush('skip-block', skipResult);
      return moved;
      */
      const skipResult = { at: new Date().toISOString(), type: 'block', delta, sourcePage, sourceBlock, resolved: 'unavailable', crossPage: false, path: 'cross-page-disabled', sessionId: TTS_STATE.activeSessionId };
      TTS_DEBUG.lastSkip = skipResult;
      ttsDiagPush('skip-block', skipResult);
      return false;
    }

    if (pausedForContract) {
      // Skip while paused: reposition highlight + paused indices,
      // but do not start speaking.
      try {
        markIntentionalBrowserCancel('skip-reposition-while-paused', { key, targetBlock: target });
        window.speechSynthesis.cancel();
      } catch (_) {}
      clearPendingBrowserRestartTimer();
      TTS_STATE.browserPaused = true;
      TTS_STATE.browserExpectedEntryBlockIndex = target;
      TTS_STATE.browserCurrentSentenceIndex = target;
      TTS_STATE.activeBlockIndex = target;
      TTS_STATE.pausedBlockIndex = target;
      TTS_STATE.pausedPageKey = key;
      try { ttsHighlightBlock(target); } catch (_) {}
      const skipResult = { at: new Date().toISOString(), type: 'block', delta, sourcePage, sourceBlock, resolvedPage: sourcePage, resolvedBlock: target, crossPage: false, moved: true, path: 'browser-pause-preserve-reposition', clippingProtection: true, sessionId: TTS_STATE.activeSessionId };
      TTS_DEBUG.lastSkip = skipResult;
      ttsDiagPush('skip-block', skipResult);
      return true;
    } else {
      const targetPreview = ttsGetBlockPreview(key, target);
      ttsDiagPush('browser-skip-restart-request', {
        key,
        delta,
        sourcePage,
        sourceBlock,
        targetBlock: target,
        sessionId: TTS_STATE.activeSessionId,
        pausedForContract,
        highlightBlockIndex: TTS_STATE.activeBlockIndex,
        pageIndex: targetPreview?.pageIndex ?? -1,
        excerpt: targetPreview?.excerpt || '',
        rangeSource: targetPreview?.rangeSource || 'none',
        rangeStart: targetPreview?.start ?? -1,
        rangeEnd: targetPreview?.end ?? -1,
      });
      const ok = browserSpeakPageFromSentence(key, target);
      const skipResult = { at: new Date().toISOString(), type: 'block', delta, sourcePage, sourceBlock, resolvedPage: sourcePage, resolvedBlock: target, crossPage: false, moved: ok, path: 'browser-restart-from-block', clippingProtection: true, sessionId: TTS_STATE.activeSessionId };
      TTS_DEBUG.lastSkip = skipResult;
      ttsDiagPush('skip-block', skipResult);
      return ok;
    }
  }

  const skipResult = { at: new Date().toISOString(), type: 'block', delta, sourcePage, sourceBlock, resolved: 'unavailable', activeKey: TTS_STATE.activeKey, hasAudio: !!audio, hasMarks: !!marks, hasBrowserFn: !!TTS_STATE.browserSpeakFromBlock };
  TTS_DEBUG.lastSkip = skipResult;
  ttsDiagPush('skip-block', skipResult);
  return false;
}

function ttsJumpPage(delta) {
  // Skip contract: when paused, page navigation must preserve paused state.
  if (isRuntimePausedForContract()) {
    return ttsJumpPagePreserve(delta);
  }

  const moved = ttsRunPageHandoff({
    key: String(TTS_STATE.activeKey || ''),
    delta,
    mode: 'speak',
    behavior: 'smooth',
    reason: 'active-page-continue',
  });
  if (moved) {
    ttsDiagPush('skip-page', {
      at: new Date().toISOString(),
      delta,
      resolved: 'page-jump',
      reason: 'active-page-continue',
      activeKey: TTS_STATE.activeKey || null,
    });
  }
  return moved;
}

function ttsRestartPage(pageIndex, targetContext) {
  const idx = Number(pageIndex);
  if (!Number.isFinite(idx) || idx < 0) return false;
  if (typeof pages === 'undefined' || !pages[idx]) return false;
  try { if (typeof window.focusReadingPage === 'function') window.focusReadingPage(idx, { behavior: 'smooth' }); } catch (_) {}
  // Set reading target from provided context (preserves source/chapter) or
  // fall back to current __rcReadingTarget if no context was passed.
  const _ctx = targetContext || window.__rcReadingTarget || {};
  if (typeof setReadingTarget === 'function') setReadingTarget({ sourceType: _ctx.sourceType || '', bookId: _ctx.bookId || '', chapterIndex: _ctx.chapterIndex != null ? _ctx.chapterIndex : -1, pageIndex: idx });
  ttsSpeakQueue((typeof readingTargetToKey === 'function') ? readingTargetToKey(window.__rcReadingTarget) : `page-${idx}`, [pages[idx]]);
  ttsDiagPush('restart-page', { pageIndex: idx });
  return true;
}

function restartLastSpokenPageTts() {
  const countdown = getCountdownStatus();
  if (countdown.active && Number.isFinite(countdown.pageIndex) && countdown.pageIndex >= 0) {
    ttsAutoplayCancelCountdown();
    return ttsRestartPage(countdown.pageIndex);
  }
  // lastPageKey is set from key in ttsSpeakQueue — carries full source context.
  const key = String(TTS_STATE.lastPageKey || TTS_STATE.activeKey || '');
  const parsed = (typeof readingTargetFromKey === 'function') ? readingTargetFromKey(key) : null;
  if (!parsed) return false;
  return ttsRestartPage(parsed.pageIndex, parsed);
}

// ─── Diagnostics snapshot ─────────────────────────────────────────────────────

function getTtsDiagnosticsSnapshot() {
  const controlEligibility = getPlaybackControlEligibility();
  return {
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    location: typeof window !== 'undefined' ? { href: window.location.href, search: window.location.search } : null,
    support: { browserTts: browserTtsSupported(), speechSynthesis: !!(typeof window !== 'undefined' && window.speechSynthesis), audioElement: !!TTS_AUDIO_ELEMENT },
    playback: getPlaybackStatus(),
    countdown: getCountdownStatus(),
    cloudWindow: {
      active: !!TTS_CLOUD_WINDOW.active,
      mode: TTS_CLOUD_WINDOW.mode || 'idle',
      sessionId: Number(TTS_CLOUD_WINDOW.sessionId || 0),
      pageKey: TTS_CLOUD_WINDOW.pageKey || null,
      chunkASentenceCount: Number(TTS_CLOUD_WINDOW.chunkASentenceCount || 0),
      promotionTriggered: !!TTS_CLOUD_WINDOW.promotionTriggered,
      promotionApplied: !!TTS_CLOUD_WINDOW.promotionApplied,
      pendingSkipBlock: Number(TTS_CLOUD_WINDOW.pendingSkipBlock ?? -1),
      pendingSkipSettling: !!TTS_CLOUD_WINDOW.pendingSkipSettling,
      charsPhase1: Number(TTS_CLOUD_WINDOW.charsPhase1 || 0),
      charsFullPage: Number(TTS_CLOUD_WINDOW.charsFullPage || 0),
      charsSessionTotal: Number(TTS_CLOUD_WINDOW.charsSessionTotal || 0),
    },
    session: {
      id: TTS_STATE.activeSessionId,
      activeKey: TTS_STATE.activeKey || null,
      activeBlockIndex: TTS_STATE.activeBlockIndex,
      blockCount: Array.isArray(TTS_STATE.highlightMarks) ? TTS_STATE.highlightMarks.length : 0,
      pausedBlockIndex: TTS_STATE.pausedBlockIndex,
      pausedPageKey: TTS_STATE.pausedPageKey,
      lastPageKey: TTS_STATE.lastPageKey,
      browserRangeCount: Array.isArray(TTS_STATE.browserSentenceRanges) ? TTS_STATE.browserSentenceRanges.length : 0,
      hasBrowserResumeHook: !!TTS_STATE.browserSpeakFromBlock,
    },
    pages: {
      inferredPageIndex: (typeof inferCurrentPageIndex === 'function') ? inferCurrentPageIndex() : -1,
      focusedPageIndex: (typeof lastFocusedPageIndex === 'number') ? lastFocusedPageIndex : -1,
      activeKey: TTS_STATE.activeKey || null,
      lastPageKey: TTS_STATE.lastPageKey || null,
    },
    voice: { variant: TTS_STATE.voiceVariant || 'female', selected: getStoredSelectedVoice(), selection: getSelectedVoicePreference(), activeBrowserVoice: TTS_STATE.activeBrowserVoiceName || null, effectiveBrowserVoice: TTS_STATE.browserVoice ? (TTS_STATE.browserVoice.name || null) : null },
    routing: getPreferredTtsRouteInfo(),
    supportStatus: getTtsSupportStatus(),
    controlEligibility,
    speed: { selected: Number(TTS_STATE.rate || 1), state: Number(TTS_STATE.rate || 1), audio: Number(TTS_AUDIO_ELEMENT.playbackRate || 1) },
    browserSpeech: browserTtsSupported() ? { speaking: !!window.speechSynthesis.speaking, paused: !!window.speechSynthesis.paused, pending: !!window.speechSynthesis.pending, voices: (window.speechSynthesis.getVoices() || []).length, currentSentenceIndex: Number(TTS_STATE.browserCurrentSentenceIndex || 0), currentCharIndex: Number(TTS_STATE.browserCurrentCharIndex || 0), sentenceCount: Number(TTS_STATE.browserSentenceCount || 0) } : null,
    audio: { present: !!TTS_AUDIO_ELEMENT, paused: !!TTS_AUDIO_ELEMENT.paused, currentTime: Number(TTS_AUDIO_ELEMENT.currentTime || 0), playbackRate: Number(TTS_AUDIO_ELEMENT.playbackRate || 1), src: TTS_AUDIO_ELEMENT.getAttribute('src') || null, loop: !!TTS_AUDIO_ELEMENT.loop },
    highlight: { pageKey: TTS_STATE.highlightPageKey || null, spanCount: Array.isArray(TTS_STATE.highlightSpans) ? TTS_STATE.highlightSpans.length : 0, marksCount: Array.isArray(TTS_STATE.highlightMarks) ? TTS_STATE.highlightMarks.length : 0, activeBlockIndex: TTS_STATE.activeBlockIndex, provenance: TTS_STATE.highlightMarksProvenance || 'none' },
    capability: getTtsCapabilityStatus(),
    unlock: { unlocked: !!TTS_AUDIO_UNLOCKED },
    last: { action: TTS_DEBUG.lastAction, error: TTS_DEBUG.lastError, skip: TTS_DEBUG.lastSkip, playRequest: TTS_DEBUG.lastPlayRequest, cloudRequest: TTS_DEBUG.lastCloudRequest, cloudResponse: TTS_DEBUG.lastCloudResponse, capability: TTS_DEBUG.lastCapability, pauseStrategy: TTS_DEBUG.lastPauseStrategy, routeDecision: TTS_DEBUG.lastRouteDecision, resolvedPath: TTS_DEBUG.lastResolvedPath },
    recentEvents: TTS_DEBUG.recent.slice(-40),
  };
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

if (browserTtsSupported()) {
  window.speechSynthesis.onvoiceschanged = () => { try { window.speechSynthesis.getVoices(); } catch (_) {} };
}
try {
  window.addEventListener('pagehide', () => ttsStop(), { passive: true });
  window.addEventListener('beforeunload', () => ttsStop(), { passive: true });
} catch (_) {}

// ─── Exports ──────────────────────────────────────────────────────────────────

window.getPlaybackStatus        = getPlaybackStatus;
window.getPlaybackControlEligibility = getPlaybackControlEligibility;
window.getAutoplayStatus        = getAutoplayStatus;
window.applyAutoplayRuntimePreference = applyAutoplayRuntimePreference;
window.getCountdownStatus       = getCountdownStatus;
window.getTtsSupportStatus      = getTtsSupportStatus;
window.getTtsCapabilityStatus   = getTtsCapabilityStatus;
window.getTtsDiagnosticsSnapshot = getTtsDiagnosticsSnapshot;
window.pauseOrResumeReading     = pauseOrResumeReading;
window.toggleAutoplay           = toggleAutoplay;
window.setPlaybackRate          = setPlaybackRate;
window.ttsJumpSentence          = ttsJumpSentence;
window.ttsJumpPage              = ttsJumpPage;
window.restartLastSpokenPageTts = restartLastSpokenPageTts;
window.ttsStop                  = ttsStop;
window.ttsPause                 = ttsPause;
window.ttsResume                = ttsResume;
window.ttsClearPausedSessionForManualPageAdvance = ttsClearPausedSessionForManualPageAdvance;
window.ttsSpeakQueue            = ttsSpeakQueue;
