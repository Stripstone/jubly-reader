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

  playbackBlockedReason: '',

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
  lastPlayRequest: null,
  lastResolvedPath: null,
  lastPauseStrategy: null,
  lastRouteDecision: null,
  lastSkip: null,
};

function ttsDiagPush(event, data = {}) {
  const entry = { seq: ++TTS_DEBUG.seq, at: new Date().toISOString(), event, data };
  TTS_DEBUG.lastAction = entry;
  TTS_DEBUG.recent.push(entry);
  if (TTS_DEBUG.recent.length > 60) TTS_DEBUG.recent.shift();
  try { if (typeof updateDiagnostics === 'function') updateDiagnostics(); } catch (_) {}
  return entry;
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
};

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

function ttsAutoplayScheduleNext(pageIndex) {
  if (!AUTOPLAY_STATE.enabled) return;
  const pageEls = document.querySelectorAll('.page');
  const nextIndex = pageIndex + 1;
  if (nextIndex >= pageEls.length) return;
  const currentPageEl = pageEls[pageIndex];
  if (!currentPageEl) return;
  const btn = currentPageEl.querySelector('.tts-btn[data-tts="page"]');
  if (!btn) return;
  AUTOPLAY_STATE.countdownPageIndex = pageIndex;
  AUTOPLAY_STATE.countdownSec = 3;
  btn.classList.add('tts-active');
  function updateBtn() { if (btn) btn.textContent = `⏸ Next in ${AUTOPLAY_STATE.countdownSec}…`; }
  updateBtn();
  AUTOPLAY_STATE.countdownTimerId = setInterval(() => {
    AUTOPLAY_STATE.countdownSec -= 1;
    if (AUTOPLAY_STATE.countdownSec <= 0) {
      ttsAutoplayCancelCountdown();
      const nextPageEl = pageEls[nextIndex];
      if (nextPageEl) nextPageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => {
        const text = (typeof pages !== 'undefined' && pages[nextIndex]) ? pages[nextIndex] : '';
        if (text) {
          const _cur = window.__rcReadingTarget || {};
          if (typeof setReadingTarget === 'function') setReadingTarget({ sourceType: _cur.sourceType || '', bookId: _cur.bookId || '', chapterIndex: _cur.chapterIndex != null ? _cur.chapterIndex : -1, pageIndex: nextIndex });
          ttsSpeakQueue((typeof readingTargetToKey === 'function') ? readingTargetToKey(window.__rcReadingTarget) : `page-${nextIndex}`, [text]);
        }
      }, 400);
    } else { updateBtn(); }
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
  const sentenceRegex = /[^.!?]*[.!?]+["']?\s*/g;
  const ranges = [];
  let match;
  while ((match = sentenceRegex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  if (!ranges.length) ranges.push({ start: 0, end: text.length });
  return ranges;
}

// ─── Highlight ────────────────────────────────────────────────────────────────

function ttsClearSentenceHighlight() {
  if (TTS_STATE.highlightRAF) { cancelAnimationFrame(TTS_STATE.highlightRAF); TTS_STATE.highlightRAF = null; }
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
    const isMobile = window.matchMedia && window.matchMedia('(max-width: 480px)').matches;
    const pane = TTS_STATE.highlightPageEl;
    if (isMobile && pane && blockIdx >= 0 && TTS_STATE.highlightSpans[blockIdx]) {
      const cur = TTS_STATE.highlightSpans[blockIdx];
      const canScroll = pane.scrollHeight > pane.clientHeight + 4;
      if (canScroll) {
        const desired = cur.offsetTop - (pane.clientHeight / 2) + (cur.offsetHeight / 2);
        pane.scrollTop = Math.max(0, Math.min(desired, pane.scrollHeight - pane.clientHeight));
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
    if (idx !== lastIdx) {
      // Track active block on state — this is what skip and pause read.
      if (idx >= 0) TTS_STATE.activeBlockIndex = idx;
      ttsHighlightBlock(idx);
      lastIdx = idx;
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

  function speakFromBlock(blockIdx) {
    if (TTS_STATE.activeSessionId !== sessionId) return;
    if (TTS_STATE.activeKey !== key) return;

    TTS_STATE.browserCurrentSentenceIndex = blockIdx;
    TTS_STATE.activeBlockIndex = blockIdx;
    ttsHighlightBlock(blockIdx);

    if (blockIdx >= ranges.length) {
      TTS_STATE.activeKey = null;
      TTS_STATE.browserSpeakFromBlock = null;
      ttsSetButtonActive(key, false);
      ttsSetHintButton(key, false);
      ttsClearSentenceHighlight();
      if (isPageRead) {
        const _pp = (typeof readingTargetFromKey === 'function') ? readingTargetFromKey(key) : null;
        const pageIndex = _pp ? _pp.pageIndex : -1;
        if (Number.isFinite(pageIndex) && pageIndex >= 0) ttsAutoplayScheduleNext(pageIndex);
      }
      ttsDiagPush('browser-speak-complete', { key, blockCount: ranges.length, sessionId });
      return;
    }

    const r = ranges[blockIdx];
    const sentenceText = text.slice(r.start, r.end);
    const utter = new SpeechSynthesisUtterance(sentenceText);
    utter.lang = 'en-US';
    utter.rate = Number(TTS_STATE.rate || 1) || 1;
    utter.pitch = 1;
    try { utter.volume = Math.max(0, Math.min(1, Number(TTS_STATE.volume ?? 1))); } catch (_) {}
    if (voice) utter.voice = voice;

    utter.onend = () => {
      if (TTS_STATE.activeSessionId !== sessionId) return;
      if (TTS_STATE.activeKey !== key) return;
      if (TTS_STATE.browserPaused) return; // pause captured this slot
      speakFromBlock(blockIdx + 1);
    };

    utter.onerror = () => {
      if (TTS_STATE.activeSessionId !== sessionId) return;
      // Guard 1: intentional cancel (pause, skip, resume, stop-or-replace).
      // Covers the deferred-speak race: the cancel window is 1200ms, long
      // enough for the 0ms defer in browserSpeakPageFromSentence to flush.
      if (isIntentionalBrowserCancelForSession(sessionId) || TTS_STATE.browserRestarting) {
        ttsDiagPush('browser-cancel-transition', {
          key, blockIdx, sessionId,
          reason: TTS_STATE.browserIntentionalCancelReason || 'browser-restarting',
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
      TTS_STATE.playbackBlockedReason = 'speechSynthesis utterance error';
      TTS_DEBUG.lastError = { at: new Date().toISOString(), path: 'browser', key, message: 'speechSynthesis utterance error', blockIdx };
      ttsDiagPush('browser-utterance-error', { key, blockIdx, sessionId });
      ttsReconcileAfterRuntimeError('browser-utterance-error', { key, blockIdx, sessionId });
    };

    window.speechSynthesis.speak(utter);
  }

  TTS_STATE.browserSpeakFromBlock = speakFromBlock;
  if (!startPaused) speakFromBlock(0);
}

// Monotonically-incrementing speak-generation counter.
// Each call to browserSpeakPageFromSentence claims a generation slot.
// The deferred setTimeout checks that no newer call has claimed the slot,
// preventing double-speak when rapid Skip/Resume calls overlap within the
// one-tick defer window.
let _browserSpeakGen = 0;

// Resume or skip to a specific block within the current browser session.
//
// Chrome/Edge SpeechSynthesis race fix (confirmed via diagnostic trace):
// cancel() is processed asynchronously. Calling speak() in the same
// event-loop tick causes the new utterance to be silently cancelled and
// fire onerror before it starts — observed consistently as a 2-3ms gap
// between skip/pause and browser-utterance-error in production diagnostics.
// Fix: defer speak() by one event-loop tick so cancel fully flushes first.
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
  // this before our setTimeout fires, so our deferred call self-aborts.
  const gen = ++_browserSpeakGen;

  // Mark intent and cancel synchronously so onerror on the outgoing
  // utterance is recognised as intentional within the 2000ms window.
  // Clear any prior playbackBlockedReason so support status reflects
  // the in-progress recovery (not the previous error string).
  TTS_STATE.playbackBlockedReason = '';
  try {
    markIntentionalBrowserCancel('restart-from-block', { key, targetBlock: target, gen, reason: entryReason });
    window.speechSynthesis.cancel();
  } catch (_) {}

  ttsDiagPush('browser-re-entry', {
    key, blockIdx: target, gen, reason: entryReason,
    outcomeClass: entryReason === 'speed-change' ? 'live-mutate' : 'preserved-re-entry',
    sessionId,
  });

  // Advance state synchronously so getPlaybackStatus() and highlight
  // reflect the target block immediately (before the deferred speak).
  TTS_STATE.browserPaused = false;
  TTS_STATE.browserRestarting = false;
  TTS_STATE.browserCurrentSentenceIndex = target;
  TTS_STATE.activeBlockIndex = target;
  try { ttsHighlightBlock(target); } catch (_) {}

  // Defer speak by one event-loop tick so cancel() fully flushes.
  // Four guards ensure only the authoritative call executes:
  //   1. Session must not have been replaced (stop, new Read Page)
  //   2. Active key must still be this page
  //   3. The speak function must not have been replaced (new session)
  //   4. This must be the latest speak generation (rapid double-skip)
  setTimeout(() => {
    if (_browserSpeakGen !== gen) return;           // superseded by newer call
    if (TTS_STATE.activeSessionId !== sessionId) return;  // session replaced
    if (TTS_STATE.activeKey !== key) return;              // page replaced
    if (TTS_STATE.browserSpeakFromBlock !== speakFn) return;  // fn replaced
    speakFn(target);
  }, 0);

  return true;
}

// ─── Support / routing ────────────────────────────────────────────────────────

function getResolvedTtsPolicy() {
  const policyApi = window.rcPolicy || {};
  const policy = typeof policyApi.get === 'function' ? policyApi.get() : null;
  const tier = typeof policyApi.getTier === 'function'
    ? String(policyApi.getTier())
    : ((policy && policy.tier) ? String(policy.tier) : ((typeof appTier !== 'undefined' && appTier) ? String(appTier) : 'free'));
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
  if (ctx.blockCount <= 0) return { can: hasCrossPageTarget, reason: hasCrossPageTarget ? 'cross-page-target' : 'no-blocks-or-page-target' };
  const targetBlock = ctx.blockIndex + (delta < 0 ? -1 : 1);
  if (targetBlock >= 0 && targetBlock < ctx.blockCount) return { can: true, reason: 'in-page-target' };
  if (targetBlock < 0) return { can: true, reason: 'restart-block-0' };
  return { can: hasCrossPageTarget, reason: hasCrossPageTarget ? 'cross-page-target' : 'no-next-page-target' };
}

function getPlaybackControlEligibility() {
  const countdown = getCountdownStatus();
  const support = getTtsSupportStatus();
  let paused = !!TTS_STATE.browserPaused;
  try {
    if (TTS_STATE.audio) paused = !!TTS_STATE.audio.paused;
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
  const hasRealResumeHook = !!(TTS_STATE.audio && TTS_STATE.audio.paused) ||
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
  TTS_STATE.browserRestarting = false;
  TTS_STATE.browserIntentionalCancelUntil = 0;
  TTS_STATE.browserIntentionalCancelReason = null;
  TTS_STATE.browserIntentionalCancelMeta = null;
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
    if (TTS_STATE.audio) paused = !!TTS_STATE.audio.paused;
    else if (!TTS_STATE.browserPaused && browserTtsSupported()) paused = !!window.speechSynthesis.paused;
  } catch (_) {}
  return {
    active: !!TTS_STATE.activeKey,
    paused,
    key: TTS_STATE.activeKey || null,
    playbackRate: Number(TTS_STATE.rate || 1) || 1,
    sessionId: TTS_STATE.activeSessionId,
    activeBlockIndex: TTS_STATE.activeBlockIndex,
    blockCount: Array.isArray(TTS_STATE.highlightMarks) ? TTS_STATE.highlightMarks.length : 0,
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

function toggleAutoplay(force) {
  AUTOPLAY_STATE.enabled = typeof force === 'boolean' ? !!force : !AUTOPLAY_STATE.enabled;
  if (!AUTOPLAY_STATE.enabled) ttsAutoplayCancelCountdown();
  ttsDiagPush('toggle-autoplay', { enabled: !!AUTOPLAY_STATE.enabled });
  return AUTOPLAY_STATE.enabled;
}

// ─── Core controls ────────────────────────────────────────────────────────────

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
  TTS_STATE.browserRestarting = false;
  TTS_STATE.browserIntentionalCancelUntil = 0;
  TTS_STATE.browserIntentionalCancelReason = null;
  TTS_STATE.browserIntentionalCancelMeta = null;

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
  if (TTS_STATE.audio && TTS_STATE.audio.paused) {
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
    // Check whether the paused session has a real resume hook before attempting.
    // A stale paused session (browserSpeakFromBlock cleared, audio element gone)
    // should restart the current focused page rather than looping into a failed
    // ttsResume() call.
    const hasRealResumeHook = !!(TTS_STATE.audio && TTS_STATE.audio.paused) ||
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
  TTS_DEBUG.lastCloudRequest = { chars: String(text || '').length, sentenceMarks: !!(opts && opts.sentenceMarks), selectedVoice: selectedVoicePref.stored, selectedVoiceType: selectedVoicePref.type, requestedVoiceId: selectedVoicePref.requestedCloudVoiceId, variant: TTS_STATE.voiceVariant || 'female' };
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
  TTS_DEBUG.lastCloudResponse = { ok: true, status: res.status, provider: data?.provider || null, cacheHit: !!data?.cacheHit, debug: data?.debug || null };
  ttsDiagPush('cloud-response', TTS_DEBUG.lastCloudResponse);
  return { url: data.url, sentenceMarks: Array.isArray(data.sentenceMarks) ? data.sentenceMarks : null };
}

async function ttsSpeakQueue(key, parts) {
  const routeInfo = getPreferredTtsRouteInfo();
  TTS_DEBUG.lastRouteDecision = routeInfo;
  TTS_DEBUG.lastPlayRequest = { key, parts: (parts || []).length, path: routeInfo.requestedPath, reason: routeInfo.reason, selectedVoice: routeInfo.selected.stored };

  const before = ttsBlockSnapshot();

  // Case: same key, currently PAUSED → resume (not stop, not restart).
  // This handles "Play → Pause → Read page same page" correctly.
  if (TTS_STATE.activeKey === key && (TTS_STATE.browserPaused || (TTS_STATE.audio && TTS_STATE.audio.paused))) {
    ttsDiagPush('speak-request', { ...TTS_DEBUG.lastPlayRequest, route: 'resume-paused-same-key' });
    ttsResume();
    ttsDiagPush('speak-action', { action: 'resumed', key, before, after: ttsBlockSnapshot() });
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

  // Free tier → browser.
  if (!routeInfo.cloudCapable) {
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
  TTS_STATE.activeKey = key;
  TTS_STATE.lastPageKey = key;
  TTS_STATE.activeBlockIndex = -1;
  TTS_STATE.pausedBlockIndex = -1;
  TTS_STATE.pausedPageKey = null;
  ttsSetButtonActive(key, true);
  ttsSetHintButton(key, true);

  try {
    for (let i = 0; i < queue.length; i++) {
      const wantMarks = (i === 0 && optsForKeySentenceMarks(key));
      // Pre-flight usage check before the first cloud TTS request.
      // Pass 3: server verdict gates the action; client counter is display-only.
      if (i === 0 && optsForKeySentenceMarks(key)) {
        if (window.rcUsage && typeof window.rcUsage.check === 'function') {
          try {
            const verdict = await window.rcUsage.check('tts');
            if (!verdict.allowed) {
              try { TTS_STATE.playbackBlockedReason = 'usage-limit'; } catch (_) {}
              ttsSetButtonActive(key, false);
              ttsSetHintButton(key, false);
              return;
            }
          } catch (_) {} // server unreachable: proceed (safe degraded behavior)
        }
        try { if (typeof tokenSpend === 'function') tokenSpend('tts'); } catch (_) {}
      }
      const tts = await cloudFetchUrl(queue[i], { sentenceMarks: wantMarks });
      if (TTS_STATE.activeSessionId !== sessionId) return;
      const url = tts.url;
      if (wantMarks) {
        if (tts.sentenceMarks && tts.sentenceMarks.length) {
          ttsMaybePrepareSentenceHighlight(key, queue[i], tts.sentenceMarks);
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
        audio.onended = () => { ttsClearSentenceHighlight(); resolve(); };
        audio.onerror = () => reject(new Error('Audio playback failed'));
        audio.play().catch(reject);
      });

      if (TTS_STATE.activeSessionId !== sessionId) return;
    }

    TTS_STATE.activeKey = null;
    ttsSetButtonActive(key, false);
    ttsSetHintButton(key, false);
    if (optsForKeySentenceMarks(key)) {
      const _cp = (typeof readingTargetFromKey === 'function') ? readingTargetFromKey(key) : null;
      const pageIndex = _cp ? _cp.pageIndex : -1;
      if (Number.isFinite(pageIndex) && pageIndex >= 0) { ttsKeepWarmForAutoplay(); ttsAutoplayScheduleNext(pageIndex); }
    }
    ttsDiagPush('speak-action', { action: 'completed', route: 'cloud', key, before, after: ttsBlockSnapshot() });

  } catch (err) {
    if (TTS_STATE.activeSessionId !== sessionId) return;
    if (err && (err.name === 'AbortError' || String(err).includes('aborted'))) return;
    const ri = getPreferredTtsRouteInfo();
    TTS_STATE.playbackBlockedReason = String(err && err.message ? err.message : err);
    TTS_DEBUG.lastError = { at: new Date().toISOString(), path: 'cloud', key, message: TTS_STATE.playbackBlockedReason };
    ttsDiagPush('cloud-playback-failed', { key, message: TTS_STATE.playbackBlockedReason, route: ri });
    console.warn('Cloud TTS unavailable; keeping browser fallback disabled for predictable voice behavior:', err);
    ttsStop();
    TTS_DEBUG.lastResolvedPath = ri.selected.explicitCloud ? 'cloud-failure-explicit' : 'cloud-failure';
    return;
  }
}

// ─── Block-indexed skip ────────────────────────────────────────────────────────
//
// Operates on TTS_STATE.activeBlockIndex. Not on vague currentTime offsets.
// At page boundaries: next crosses to next page; prev restarts block 0.
// Clipping protection: 60ms before target block start time on the cloud-audio path.
// Browser path: no clip risk (each utterance starts from char 0 of sentence).

function isRuntimePausedForContract() {
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
  const key = String(TTS_STATE.activeKey || '');
  const parsedKey = (typeof readingTargetFromKey === 'function') ? readingTargetFromKey(key) : null;
  if (!parsedKey) return false;
  const currentIndex = parsedKey.pageIndex;
  const nextIndex = currentIndex + (delta < 0 ? -1 : 1);
  if (!Number.isFinite(nextIndex) || nextIndex < 0) return false;
  if (typeof pages === 'undefined' || !pages[nextIndex]) return false;

  try { if (typeof window.focusReadingPage === 'function') window.focusReadingPage(nextIndex, { behavior: 'smooth' }); } catch (_) {}

  // Advance reading target to next page (preserving source/chapter context).
  if (typeof setReadingTarget === 'function') setReadingTarget({ sourceType: parsedKey.sourceType, bookId: parsedKey.bookId, chapterIndex: parsedKey.chapterIndex, pageIndex: nextIndex });
  const nextKey = (typeof readingTargetToKey === 'function') ? readingTargetToKey(window.__rcReadingTarget) : `page-${nextIndex}`;
  const nextText = pages[nextIndex];

  // If we're on cloud (active audio exists), prepare next page audio in paused mode.
  if (TTS_STATE.audio) {
    void ttsPreparePausedCloudPage(nextIndex);
  } else {
    // Browser path: prepare page highlights and resume hook without unpausing.
    browserSpeakQueue(nextKey, [nextText], { startPaused: true, pausedBlockIndex: 0 });
  }
  return true;
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

  // ── Cloud path ───────────────────────────────────────────────────────────────
  const audio = TTS_STATE.audio;
  if (audio && marks && blockCount > 0) {
    let target = sourceBlock + (delta < 0 ? -1 : 1);

    if (target < 0) target = 0; // prev at block 0 → restart block 0

    if (target >= blockCount) { // next at last block → cross to next page
      const moved = pausedForContract ? ttsJumpPagePreserve(1) : ttsJumpPage(1);
      const skipResult = { at: new Date().toISOString(), type: 'block', delta, sourcePage, sourceBlock, resolvedPage: sourcePage + 1, resolvedBlock: 0, crossPage: true, moved, path: pausedForContract ? 'cloud-cross-page-preserve' : 'cloud-cross-page', clippingProtection: false };
      TTS_DEBUG.lastSkip = skipResult;
      ttsDiagPush('skip-block', skipResult);
      return moved;
    }

    const CLIP_GUARD_MS = 60;
    const rawTimeS = Number(marks[target].time || 0) / 1000;
    const seekTime = Math.max(0, rawTimeS - CLIP_GUARD_MS / 1000);
    try {
      audio.currentTime = seekTime;
      TTS_STATE.activeBlockIndex = target;
      ttsHighlightBlock(target);
      if (!pausedForContract) {
        ttsStartHighlightLoop(audio);
      } else {
        // Skip while paused: reposition without unpausing.
        TTS_STATE.pausedBlockIndex = target;
        TTS_STATE.pausedPageKey = key;
      }
    } catch (_) {
      TTS_DEBUG.lastSkip = { at: new Date().toISOString(), type: 'block', delta, sourcePage, sourceBlock, resolvedBlock: target, moved: false, path: 'cloud-seek-failed' };
      ttsDiagPush('skip-block', TTS_DEBUG.lastSkip);
      return false;
    }

    const skipResult = { at: new Date().toISOString(), type: 'block', delta, sourcePage, sourceBlock, resolvedPage: sourcePage, resolvedBlock: target, crossPage: false, moved: true, path: 'cloud-seek', clippingProtection: true, clipGuardMs: CLIP_GUARD_MS, seekTime, blockTimeMs: Number(marks[target].time || 0), sessionId: TTS_STATE.activeSessionId };
    TTS_DEBUG.lastSkip = skipResult;
    ttsDiagPush('skip-block', skipResult);
    return true;
  }

  // ── Browser path ─────────────────────────────────────────────────────────────
  if (browserTtsSupported() && TTS_STATE.browserSpeakFromBlock) {
    const ranges = TTS_STATE.browserSentenceRanges;
    const rangeCount = ranges ? ranges.length : 0;
    let target = sourceBlock + (delta < 0 ? -1 : 1);

    if (target < 0) target = 0;

    if (target >= rangeCount) {
      const moved = pausedForContract ? ttsJumpPagePreserve(1) : ttsJumpPage(1);
      const skipResult = { at: new Date().toISOString(), type: 'block', delta, sourcePage, sourceBlock, resolvedPage: sourcePage + 1, resolvedBlock: 0, crossPage: true, moved, path: pausedForContract ? 'browser-cross-page-preserve' : 'browser-cross-page', clippingProtection: false };
      TTS_DEBUG.lastSkip = skipResult;
      ttsDiagPush('skip-block', skipResult);
      return moved;
    }

    if (pausedForContract) {
      // Skip while paused: reposition highlight + paused indices,
      // but do not start speaking.
      try {
        markIntentionalBrowserCancel('skip-reposition-while-paused', { key, targetBlock: target });
        window.speechSynthesis.cancel();
      } catch (_) {}
      TTS_STATE.browserPaused = true;
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

  const key = String(TTS_STATE.activeKey || '');
  const _parsedJp = (typeof readingTargetFromKey === 'function') ? readingTargetFromKey(key) : null;
  if (!_parsedJp) return false;
  const currentIndex = _parsedJp.pageIndex;
  const nextIndex = currentIndex + (delta < 0 ? -1 : 1);
  if (!Number.isFinite(nextIndex) || nextIndex < 0) return false;
  if (typeof pages === 'undefined' || !pages[nextIndex]) return false;
  try { if (typeof window.focusReadingPage === 'function') window.focusReadingPage(nextIndex, { behavior: 'smooth' }); } catch (_) {}
  // Advance reading target to next page before deriving key.
  if (typeof setReadingTarget === 'function') setReadingTarget({ sourceType: _parsedJp.sourceType, bookId: _parsedJp.bookId, chapterIndex: _parsedJp.chapterIndex, pageIndex: nextIndex });
  ttsSpeakQueue((typeof readingTargetToKey === 'function') ? readingTargetToKey(window.__rcReadingTarget) : `page-${nextIndex}`, [pages[nextIndex]]);
  TTS_DEBUG.lastSkip = { at: new Date().toISOString(), type: 'page', delta, resolved: 'page-jump', sourcePageIndex: currentIndex, targetPageIndex: nextIndex, activeKey: TTS_STATE.activeKey || null };
  ttsDiagPush('skip-page', TTS_DEBUG.lastSkip);
  return true;
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
    highlight: { pageKey: TTS_STATE.highlightPageKey || null, spanCount: Array.isArray(TTS_STATE.highlightSpans) ? TTS_STATE.highlightSpans.length : 0, marksCount: Array.isArray(TTS_STATE.highlightMarks) ? TTS_STATE.highlightMarks.length : 0, activeBlockIndex: TTS_STATE.activeBlockIndex },
    unlock: { unlocked: !!TTS_AUDIO_UNLOCKED },
    last: { action: TTS_DEBUG.lastAction, error: TTS_DEBUG.lastError, skip: TTS_DEBUG.lastSkip, playRequest: TTS_DEBUG.lastPlayRequest, cloudRequest: TTS_DEBUG.lastCloudRequest, cloudResponse: TTS_DEBUG.lastCloudResponse, pauseStrategy: TTS_DEBUG.lastPauseStrategy, routeDecision: TTS_DEBUG.lastRouteDecision, resolvedPath: TTS_DEBUG.lastResolvedPath },
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
window.getCountdownStatus       = getCountdownStatus;
window.getTtsSupportStatus      = getTtsSupportStatus;
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
window.ttsSpeakQueue            = ttsSpeakQueue;
