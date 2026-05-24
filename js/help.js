// js/help.js
// Native Jubly support widget. Replaces Intercom and keeps the existing
// rcHelp.openChat/openFeedback surface used by the shell.
(function () {
  const ID = 'jubly-support-widget';
  const STYLE_ID = 'jubly-support-widget-style';
  const ENDPOINT = '/api/app?kind=support-submit';
  const STORAGE_KEY = 'jubly:support-widget-opened';
  const EVIDENCE_PACKET_KEY = 'jubly:support-evidence-packet:v1';
  const SUPPORT_JOURNEY_KEY = 'jubly:support-recent-journey:v1';
  const MAX_SUPPORT_JOURNEY_EVENTS = 18;
  const PRESERVED_INCIDENT_TTL_MS = 30 * 60 * 1000;

  const ROOTS = { question: 'Ask a question', bug: 'Report a problem', feedback: 'Leave feedback' };
  const ROOT_CHOICES = [ROOTS.question, ROOTS.bug, ROOTS.feedback];
  const FEEDBACK_CHOICES = ['Tell us about Jubly Reader', 'I have a suggestion'];
  const QUESTION_CHOICES = ['I found a bug', 'I have a suggestion', 'Something else'];
  const BUG_AREAS = ['Sign up or getting started', 'Reading screen', 'Read-aloud controls', 'Library and saved books', 'Account, plan, or billing', 'Something else'];
  const BUG_TYPES = ['Something looked wrong', 'A button didn’t work', 'I saw the wrong screen', 'Audio had a problem', 'My progress was wrong', 'Settings didn’t apply', 'The app was slow', 'The app froze or crashed', 'Something else'];

  const s = { mounted: false, path: [], transcript: [], unlocked: false, screenshot: null, placeholder: '', els: {} };

  function supportStorage() {
    try { return window.sessionStorage || null; } catch (_) { return null; }
  }

  function supportWasOpened() {
    const store = supportStorage();
    return !!(store && store.getItem(STORAGE_KEY) === '1');
  }

  function isSignedIn() {
    try { return !!(window.rcAuth && typeof window.rcAuth.isSignedIn === 'function' && window.rcAuth.isSignedIn()); } catch (_) { return false; }
  }

  function authReady() {
    try { return !!(window.rcAuth && typeof window.rcAuth.isReady === 'function' && window.rcAuth.isReady()); } catch (_) { return false; }
  }

  function rememberOpenedIfSignedIn() {
    if (!isSignedIn()) return;
    const store = supportStorage();
    try { if (store) store.setItem(STORAGE_KEY, '1'); } catch (_) {}
  }

  function forgetOpened() {
    const store = supportStorage();
    try { if (store) store.removeItem(STORAGE_KEY); } catch (_) {}
  }

  function style() {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = `
#${ID}{--p:#6548f7;--pd:#5236e0;--ps:#efeafe;--t:#0e1630;--m:#6d7891;--l:#dbe3f0;position:fixed;right:24px;bottom:24px;z-index:2147482500;display:flex;flex-direction:column;align-items:flex-end;gap:14px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--t)}
#${ID} *{box-sizing:border-box}#${ID} .panel{width:min(390px,calc(100vw - 24px));height:min(680px,calc(100vh - 120px));display:flex;flex-direction:column;border-radius:28px;background:#fff;box-shadow:0 24px 60px rgba(18,23,38,.18);border:1px solid rgba(190,201,222,.75);overflow:hidden;transform-origin:bottom right;transform:translateY(12px) scale(.98);opacity:0;pointer-events:none;transition:.22s ease}
#${ID}.open .panel{transform:translateY(0) scale(1);opacity:1;pointer-events:auto}#${ID} .head{position:relative;padding:24px 22px 18px;background:linear-gradient(180deg,#725cff 0%,#5e43f2 100%);color:#fff}#${ID} .brand{display:flex;align-items:center;gap:12px;margin-bottom:16px}#${ID} .mark{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;background:rgba(10,11,23,.8)}#${ID} h2{margin:0 44px 6px 0;font-size:18px;line-height:1.2;color:#fff}#${ID} p{margin:0;font-size:14px;line-height:1.45;color:rgba(255,255,255,.88)}
#${ID} .close{position:absolute;top:18px;right:18px;width:36px;height:36px;border:0;border-radius:50%;background:rgba(255,255,255,.12);color:#fff;display:grid;place-items:center;cursor:pointer}#${ID} .close:hover,#${ID} .close:focus-visible{background:rgba(255,255,255,.2);outline:0}
#${ID} .log{flex:1;padding:16px 16px 6px;display:flex;flex-direction:column;gap:12px;overflow-y:auto;background:linear-gradient(180deg,#fbfcff 0%,#f5f7fc 100%)}#${ID} .b{max-width:86%;padding:12px 14px;border-radius:18px;font-size:14px;line-height:1.45;word-break:break-word;box-shadow:0 6px 16px rgba(18,23,38,.08)}#${ID} .a{align-self:flex-start;background:#fff;border:1px solid var(--l);border-top-left-radius:8px}#${ID} .u{align-self:flex-end;background:linear-gradient(180deg,#725cff 0%,var(--p) 100%);color:#fff;border-top-right-radius:8px}#${ID} .st{align-self:center;max-width:92%;background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;box-shadow:none}#${ID} .ok{background:#ecfdf5;color:#047857;border-color:#bbf7d0}
#${ID} .chips{display:flex;flex-wrap:wrap;gap:8px;align-self:flex-start;max-width:92%;margin:2px 0 4px}#${ID} .chip{border:1px solid rgba(101,72,247,.28);background:#fff;color:var(--pd);border-radius:999px;padding:9px 13px;font-size:13px;font-weight:600;cursor:pointer}#${ID} .chip:hover,#${ID} .chip:focus-visible{background:var(--ps);outline:0}
#${ID} .nav{padding:0 16px 14px;display:flex;gap:14px;background:linear-gradient(180deg,#f5f7fc 0%,#fff 100%);border-top:1px solid rgba(219,227,240,.75)}#${ID} .link{background:none;border:0;padding:0;font-size:12px;color:var(--m);text-decoration:underline;cursor:pointer}
#${ID} .compose-shell{padding:14px 16px 16px;background:#fff;border-top:1px solid rgba(219,227,240,.9)}#${ID} .path{display:none;margin-bottom:10px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--pd)}#${ID} .compose{border:1px solid var(--l);border-radius:18px;background:#f7f8fb;padding:10px 12px;display:flex;flex-direction:column;gap:10px}#${ID} .compose.on{background:#fff}#${ID} textarea{width:100%;min-height:56px;max-height:140px;border:0;outline:0;resize:none;background:transparent;color:var(--t);font:inherit;line-height:1.45}#${ID} textarea:disabled{color:#8e98ad;cursor:not-allowed}#${ID} .actions{display:flex;align-items:center;justify-content:space-between;gap:10px}#${ID} .attach{display:none;border:0;background:none;color:var(--m);font-size:13px;font-weight:600;cursor:pointer;padding:0}#${ID} .file-note{font-size:11px;color:var(--m);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px}#${ID} .send{border:0;border-radius:12px;padding:10px 16px;font-size:13px;font-weight:700;color:#fff;background:linear-gradient(180deg,#725cff 0%,var(--p) 100%);box-shadow:0 8px 18px rgba(101,72,247,.26);cursor:pointer;opacity:.45;pointer-events:none}#${ID} .send.on{opacity:1;pointer-events:auto}
#${ID} .launcher-row{display:flex;align-items:center;gap:12px}#${ID} .label{padding:10px 16px;border-radius:16px;background:rgba(18,23,38,.92);color:#fff;font-size:14px;font-weight:600;box-shadow:0 6px 16px rgba(18,23,38,.08)}#${ID}.open .label{opacity:0;pointer-events:none}#${ID} .launch{width:64px;height:64px;border:0;border-radius:50%;background:linear-gradient(180deg,#735cff 0%,var(--p) 100%);color:#fff;cursor:pointer;box-shadow:0 18px 36px rgba(101,72,247,.34);display:grid;place-items:center}#${ID} .launch .x{display:none}#${ID}.open .launch .chat{display:none}#${ID}.open .launch .x{display:block}
@media(max-width:560px){#${ID}{right:12px;left:12px;bottom:12px;align-items:stretch}#${ID} .launcher-row{justify-content:flex-end}#${ID} .panel{width:100%;height:min(72vh,680px)}}`;
    document.head.appendChild(el);
  }

  function mount() {
    if (s.mounted && document.getElementById(ID)) return true;
    if (!document.body) return false;
    style();
    const root = document.createElement('section');
    root.id = ID;
    root.setAttribute('aria-label', 'Jubly support widget');
    root.innerHTML = `
<div class="panel" role="dialog" aria-modal="false" aria-label="Message the Jubly Reader team"><header class="head"><button class="close" data-k="close" type="button" aria-label="Minimize support widget"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 12h12"></path></svg></button><div class="brand"><div class="mark" aria-hidden="true"><svg viewBox="0 0 28 28" width="24" height="24" fill="none"><rect x="5" y="7" width="5" height="14" rx="2.5" fill="white" opacity=".95"></rect><rect x="11.5" y="4" width="5" height="20" rx="2.5" fill="white"></rect><rect x="18" y="9" width="5" height="10" rx="2.5" fill="white" opacity=".85"></rect></svg></div><div><h2>Message the Jubly Reader team</h2><p>Ask a question, report a problem, or leave feedback.</p></div></div></header><div class="log" data-k="log" aria-live="polite"></div><div class="nav"><button class="link" data-k="reset" type="button">Start over</button></div><div class="compose-shell"><div class="path" data-k="path"></div><div class="compose" data-k="compose"><textarea data-k="msg" placeholder="Choose a topic above to start" disabled></textarea><div class="actions"><button class="attach" data-k="attach" type="button">📎 Attach screenshot</button><span class="file-note" data-k="note"></span><button class="send" data-k="send" type="button">Send</button></div><input data-k="file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></div></div></div><div class="launcher-row"><div class="label">Message us</div><button class="launch" data-k="launch" type="button" aria-label="Open support widget" aria-expanded="false"><svg class="chat" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path><path d="M8.5 9.5h.01"></path><path d="M12 9.5h.01"></path><path d="M15.5 9.5h.01"></path></svg><svg class="x" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"></path></svg></button></div>`;
    document.body.appendChild(root);
    const q = (k) => root.querySelector(`[data-k="${k}"]`);
    s.els = { root, log: q('log'), path: q('path'), compose: q('compose'), msg: q('msg'), attach: q('attach'), send: q('send'), file: q('file'), note: q('note'), launch: q('launch') };
    q('launch').addEventListener('click', () => {
      if (root.classList.contains('open')) return dismiss();
      return setOpen(true);
    });
    q('close').addEventListener('click', () => setOpen(false));
    q('reset').addEventListener('click', start);
    q('msg').addEventListener('input', refreshSend);
    q('send').addEventListener('click', send);
    q('attach').addEventListener('click', () => q('file').click());
    q('file').addEventListener('change', attachFile);
    s.mounted = true;
    start();
    return true;
  }

  function setOpen(open) {
    if (!open && (!s.mounted || !document.getElementById(ID))) return true;
    if (!mount()) return false;
    if (open) {
      try {
        if (window.rcAnnotations && typeof window.rcAnnotations.closeWidget === 'function') window.rcAnnotations.closeWidget();
      } catch (_) {}
      rememberOpenedIfSignedIn();
    }
    s.els.root.classList.toggle('open', !!open);
    s.els.launch.setAttribute('aria-expanded', String(!!open));
    s.els.launch.setAttribute('aria-label', open ? 'Dismiss support widget' : 'Open support widget');
    if (open && s.unlocked) setTimeout(() => { try { s.els.msg.focus(); } catch (_) {} }, 0);
    return true;
  }

  function dismiss() {
    shutdown();
    return true;
  }

  function restorePersistedLauncher() {
    if (s.mounted || !supportWasOpened()) return false;
    if (!authReady()) return false;
    if (!isSignedIn()) { forgetOpened(); return false; }
    if (!mount()) return false;
    setOpen(false);
    return true;
  }

  function bubble(text, cls) {
    const b = document.createElement('div');
    b.className = `b ${cls || 'a'}`;
    b.textContent = String(text || '');
    s.els.log.appendChild(b);
    if (cls === 'a' || cls === 'u') s.transcript.push({ role: cls === 'u' ? 'user' : 'assistant', text: b.textContent, at: new Date().toISOString() });
    requestAnimationFrame(() => { s.els.log.scrollTop = s.els.log.scrollHeight; });
  }

  function chips(items, fn) {
    const wrap = document.createElement('div');
    wrap.className = 'chips';
    items.forEach((item) => {
      const c = document.createElement('button');
      c.className = 'chip';
      c.type = 'button';
      c.textContent = item;
      c.addEventListener('click', () => { wrap.remove(); fn(item); });
      wrap.appendChild(c);
    });
    s.els.log.appendChild(wrap);
  }

  function start() {
    mount();
    s.path = [];
    s.transcript = [];
    s.unlocked = false;
    s.screenshot = null;
    s.placeholder = '';
    s.els.log.innerHTML = '';
    s.els.msg.value = '';
    s.els.note.textContent = '';
    lock();
    bubble('Hi, how can we help?', 'a');
    chips(ROOT_CHOICES, chooseType);
  }

  function lock() {
    s.unlocked = false;
    s.els.msg.disabled = true;
    s.els.msg.placeholder = 'Choose a topic above to start';
    s.els.compose.classList.remove('on');
    s.els.send.classList.remove('on');
    s.els.attach.style.display = 'none';
    s.els.path.style.display = s.path.length ? 'block' : 'none';
    s.els.path.textContent = s.path.join(' > ');
  }

  function unlock() {
    s.unlocked = true;
    s.els.msg.disabled = false;
    s.els.msg.placeholder = s.placeholder || (s.path[0] === ROOTS.bug ? 'What did you do, what did you expect, and what actually happened?' : 'Type your message here');
    s.els.compose.classList.add('on');
    s.els.path.style.display = 'block';
    s.els.path.textContent = s.path.join(' > ');
    s.els.attach.style.display = s.path[0] === ROOTS.bug ? 'inline-block' : 'none';
    refreshSend();
    s.els.msg.focus();
  }

  function refreshSend() { s.els.send.classList.toggle('on', s.unlocked && s.els.msg.value.trim().length > 0); }

  function chooseType(type) {
    if (type === ROOTS.bug) return startBugFlow();
    if (type === ROOTS.feedback) return startFeedbackFlow();
    if (type === ROOTS.question) return startQuestionFlow();
  }

  function startBugFlow() {
    recordSupportJourney('support-root-selected', { root: ROOTS.bug });
    s.placeholder = '';
    s.path = [ROOTS.bug];
    bubble(ROOTS.bug, 'u');
    askBugArea();
    lock();
  }

  function askBugArea() {
    bubble('Where did it happen?', 'a');
    chips(BUG_AREAS, (area) => {
      s.path = [ROOTS.bug, area];
      bubble(area, 'u');
      bubble('What kind of problem was it?', 'a');
      chips(BUG_TYPES, (bugType) => {
        s.path.push(bugType);
        bubble(bugType, 'u');
        bubble('Please describe what happened. We’ll include basic app context to help understand the issue.', 'a');
        unlock();
      });
      lock();
    });
  }

  function startFeedbackFlow() {
    recordSupportJourney('support-root-selected', { root: ROOTS.feedback });
    s.placeholder = '';
    s.path = [ROOTS.feedback];
    bubble(ROOTS.feedback, 'u');
    bubble('What kind of feedback do you have?', 'a');
    chips(FEEDBACK_CHOICES, chooseFeedbackType);
    lock();
  }

  function chooseFeedbackType(choice, alreadyBubbled) {
    s.path = [ROOTS.feedback, choice];
    if (!alreadyBubbled) bubble(choice, 'u');
    if (choice === 'I have a suggestion') {
      bubble('Make a suggestion for what we should improve. Our team will be notified of your suggestions.', 'a');
      s.placeholder = 'What should we improve?';
    } else {
      bubble('Tell us about your experience with our product. If you’re enjoying Jubly Reader, leaving a review helps us a lot.', 'a');
      s.placeholder = 'What do you like about Jubly Reader?';
    }
    unlock();
  }

  function startQuestionFlow() {
    recordSupportJourney('support-root-selected', { root: ROOTS.question });
    s.placeholder = '';
    s.path = [ROOTS.question];
    bubble(ROOTS.question, 'u');
    bubble('What would you like help with?', 'a');
    chips(QUESTION_CHOICES, (choice) => {
      bubble(choice, 'u');
      if (choice === 'I found a bug') {
        s.path = [ROOTS.bug];
        askBugArea();
        lock();
        return;
      }
      if (choice === 'I have a suggestion') {
        chooseFeedbackType(choice, true);
        return;
      }
      s.path = [ROOTS.question, choice];
      bubble('What would you like help with?', 'a');
      s.placeholder = 'Ask your question here';
      unlock();
    });
    lock();
  }

  function safe(fn) { try { return fn(); } catch (err) { return { error: String(err && err.message || err) }; } }
  function auth() {
    const api = window.rcAuth || null;
    const session = safe(() => api && typeof api.getSession === 'function' ? api.getSession() : null);
    const user = safe(() => api && typeof api.getUser === 'function' ? api.getUser() : null);
    const policy = safe(() => window.rcPolicy && typeof window.rcPolicy.getReport === 'function' ? window.rcPolicy.getReport() : null);
    return { user: user && !user.error ? user : null, policy: policy && !policy.error ? policy : null, token: session && !session.error ? String(session.access_token || '') : '', signedIn: !!(api && typeof api.isSignedIn === 'function' && api.isSignedIn()) };
  }
  function visibleSection() {
    const nodes = Array.from(document.querySelectorAll('#landing-page,#intro-library,#dashboard,#profile-page,#reading-mode,section[id]'));
    const found = nodes.find((el) => safe(() => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width && r.height && !el.classList.contains('hidden-section'); }));
    return found ? found.id : null;
  }

  function evidenceStore() {
    try { return window.sessionStorage || null; } catch (_) { return null; }
  }

  function jsonClone(value) {
    try { return JSON.parse(JSON.stringify(value || null)); } catch (_) { return null; }
  }

  function compactObject(value, allowedKeys, maxString = 220) {
    if (!value || typeof value !== 'object') return null;
    const out = {};
    allowedKeys.forEach((key) => {
      if (!(key in value)) return;
      const raw = value[key];
      if (raw == null) { out[key] = raw; return; }
      if (typeof raw === 'string') out[key] = raw.length > maxString ? `${raw.slice(0, maxString)}…` : raw;
      else if (typeof raw === 'number' || typeof raw === 'boolean') out[key] = raw;
      else if (Array.isArray(raw)) out[key] = raw.slice(0, 8);
      else if (typeof raw === 'object') out[key] = jsonClone(raw);
    });
    return Object.keys(out).length ? out : null;
  }

  function readStoredJson(key, fallback) {
    const store = evidenceStore();
    if (!store) return fallback;
    try {
      const parsed = JSON.parse(store.getItem(key) || 'null');
      return parsed == null ? fallback : parsed;
    } catch (_) { return fallback; }
  }

  function writeStoredJson(key, value) {
    const store = evidenceStore();
    if (!store) return;
    try { store.setItem(key, JSON.stringify(value)); } catch (_) {}
  }


  function timeMs(value) {
    const ms = Date.parse(String(value || ''));
    return Number.isFinite(ms) ? ms : 0;
  }

  function sameEvidenceArea(incident, featureArea) {
    const incidentArea = String(incident?.activeFeatureArea || '').toLowerCase();
    const selectedArea = String(featureArea || '').toLowerCase();
    if (!incidentArea || !selectedArea || selectedArea === 'unknown') return false;
    if (incidentArea === selectedArea) return true;
    return selectedArea === 'reading' && incidentArea === 'tts';
  }

  function isFreshRelevantIncident(incident, featureArea, nowMs = Date.now()) {
    if (!incident || typeof incident !== 'object') return false;
    const capturedMs = timeMs(incident.capturedAt);
    if (!capturedMs || nowMs - capturedMs < 0 || nowMs - capturedMs > PRESERVED_INCIDENT_TTL_MS) return false;
    return sameEvidenceArea(incident, featureArea);
  }

  function recordSupportJourney(event, data = {}) {
    const existing = Array.isArray(readStoredJson(SUPPORT_JOURNEY_KEY, [])) ? readStoredJson(SUPPORT_JOURNEY_KEY, []) : [];
    existing.push({ at: new Date().toISOString(), event: String(event || 'support-event'), surface: visibleSection(), data: compactObject(data, ['type', 'path', 'choice', 'root', 'visibleSection', 'href'], 160) || {} });
    writeStoredJson(SUPPORT_JOURNEY_KEY, existing.slice(-MAX_SUPPORT_JOURNEY_EVENTS));
  }

  function pathToFeatureArea(path) {
    const joined = Array.isArray(path) ? path.join(' > ').toLowerCase() : String(path || '').toLowerCase();
    if (/read-aloud|audio|tts|voice/.test(joined)) return 'tts';
    if (/library|saved book|cloud|book/.test(joined)) return 'library';
    if (/account|plan|billing|subscription|sign up|signup/.test(joined)) return 'billing-auth';
    if (/reading/.test(joined)) return 'reading';
    if (/setting/.test(joined)) return 'settings';
    return 'unknown';
  }

  function eventSummary(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const data = entry.data && typeof entry.data === 'object' ? entry.data : {};
    return {
      seq: Number(entry.seq || 0) || null,
      at: entry.at || null,
      event: String(entry.event || ''),
      data: compactObject(data, [
        'type', 'resolved', 'reason', 'sourcePageIndex', 'targetPageIndex', 'pageIndex', 'focusedPageIndex',
        'mode', 'key', 'activeKey', 'sessionId', 'requestId', 'requestMode', 'ok', 'status', 'provider',
        'cacheHit', 'marksProvenance', 'marksIncludedInResponse', 'preciseSeekAvailable', 'preciseSeekReason',
        'targetBlock', 'blockIndex', 'seekTime', 'elapsedMs', 'error', 'errorCode', 'recoverable', 'success'
      ], 180) || {}
    };
  }

  function meaningfulTtsEvents(tts) {
    const events = Array.isArray(tts?.recentEvents) ? tts.recentEvents : [];
    const important = /handoff|cloud|audio|seek|pause|paused|stop|error|failed|rejected|restart|promotion|clear|abort|presynth|browser-entry|utterance/i;
    return events.filter((entry) => important.test(String(entry?.event || ''))).slice(-10).map(eventSummary).filter(Boolean);
  }

  function summarizeTtsIncident(tts, path) {
    if (!tts || typeof tts !== 'object') return null;
    const last = tts.last && typeof tts.last === 'object' ? tts.last : {};
    const playback = tts.playback && typeof tts.playback === 'object' ? tts.playback : null;
    const events = meaningfulTtsEvents(tts);
    const handoffEvent = events.slice().reverse().find((entry) => entry.event === 'page-handoff');
    const cloudEvent = events.slice().reverse().find((entry) => /cloud-response/i.test(entry.event));
    const stopEvent = events.slice().reverse().find((entry) => /stop|pause|paused|error|failed|rejected|abort|clear/i.test(entry.event));
    const handoff = compactObject(last.skip || handoffEvent?.data, ['at', 'type', 'resolved', 'sourcePageIndex', 'targetPageIndex', 'mode', 'reason', 'activeKey'], 220);
    const cloudRequest = compactObject(last.cloudRequest, ['chars', 'textHash', 'sentenceMarks', 'requestMode', 'selectedVoice', 'selectedVoiceType', 'requestedVoiceId', 'variant'], 220);
    const cloudResponse = compactObject(last.cloudResponse || cloudEvent?.data, ['ok', 'status', 'provider', 'cacheHit', 'requestMode', 'preciseSeekAvailable', 'preciseSeekReason', 'marksIncludedInResponse', 'marksProvenance'], 220);
    const playRequest = compactObject(last.playRequest, ['key', 'blockCount', 'voice', 'route', 'selectedVoice', 'selectedVoiceType', 'requestedVoiceId'], 220);
    const audio = compactObject(tts.audio, ['present', 'paused', 'currentTime', 'playbackRate', 'loop'], 220);
    const session = compactObject(tts.session, ['id', 'activeKey', 'activeBlockIndex', 'blockCount', 'pausedBlockIndex', 'pausedPageKey', 'lastPageKey', 'browserRangeCount'], 220);
    const capability = compactObject(tts.capability, ['provider', 'marksProvenance', 'providerPreciseMarks', 'preciseSeek', 'marks', 'artifact', 'cache'], 220);
    const hasUsefulTtsContext = !!(handoff || cloudRequest || cloudResponse || playRequest || events.length);
    if (!hasUsefulTtsContext) return null;
    const likelyAutoplayHandoff = !!(handoff && /page-handoff/i.test(String(handoff.resolved || '')) && /autoplay/i.test(String(handoff.reason || '')));
    const becameInactive = playback && playback.active === false;
    const incidentType = likelyAutoplayHandoff ? 'tts-autoplay-page-handoff-context' : 'tts-runtime-context';
    const summary = likelyAutoplayHandoff
      ? 'Read Aloud recently attempted an autoplay page handoff. Preserve this context separately from the Profile/report-time state.'
      : 'Recent Read Aloud runtime context preserved for support evidence.';
    return {
      capturedAt: new Date().toISOString(),
      source: 'existing-tts-diagnostics-snapshot',
      recentSurface: 'reading-view',
      activeFeatureArea: 'tts',
      incidentType,
      summary,
      reportTimePlaybackActive: playback ? !!playback.active : null,
      becameInactiveAtReportCapture: becameInactive || null,
      userPausedKnown: stopEvent && /pause|paused/.test(stopEvent.event) ? true : (likelyAutoplayHandoff ? false : null),
      handoff,
      playRequest,
      cloudRequest,
      cloudResponse,
      session,
      audio,
      capability,
      recentEvents: events,
    };
  }

  function readPreservedIncident(featureArea) {
    const stored = readStoredJson(EVIDENCE_PACKET_KEY, null);
    if (!isFreshRelevantIncident(stored, featureArea)) return null;
    return stored;
  }

  function preserveIncident(packet) {
    if (!packet || typeof packet !== 'object') return null;
    const bounded = { ...packet, freshnessWindowMs: PRESERVED_INCIDENT_TTL_MS };
    writeStoredJson(EVIDENCE_PACKET_KEY, bounded);
    return bounded;
  }

  function recentJourney(rawDiagnostics, preservedIncident) {
    const supportEvents = Array.isArray(readStoredJson(SUPPORT_JOURNEY_KEY, [])) ? readStoredJson(SUPPORT_JOURNEY_KEY, []) : [];
    const ttsEvents = Array.isArray(preservedIncident?.recentEvents) ? preservedIncident.recentEvents.map((entry) => ({ at: entry.at, event: `tts:${entry.event}`, surface: preservedIncident.recentSurface || 'reading-view', data: entry.data || {} })) : [];
    const current = { at: rawDiagnostics.capturedAt, event: 'support:diagnostics-captured', surface: rawDiagnostics.visibleSection, data: { href: rawDiagnostics.location?.href || '' } };
    return [...ttsEvents.slice(-8), ...supportEvents.slice(-8), current].slice(-12);
  }

  function buildSupportEvidencePacket(rawDiagnostics, meta = {}) {
    const path = Array.isArray(meta.path) ? meta.path.slice(0, 6) : [];
    const featureArea = pathToFeatureArea(path);
    const derivedCandidate = summarizeTtsIncident(rawDiagnostics.ttsDiagnosticsSnapshot, meta.path);
    const derived = isFreshRelevantIncident(derivedCandidate, featureArea) ? derivedCandidate : null;
    const preserved = derived ? preserveIncident(derived) : readPreservedIncident(featureArea);
    const packet = {
      version: '1D-support-evidence-packet-v1',
      assembledAt: new Date().toISOString(),
      purpose: 'Existing support widget evidence packet; not a user-facing diagnostics surface.',
      currentReportContext: {
        currentSurface: rawDiagnostics.visibleSection || null,
        supportPath: path,
        supportType: meta.type || null,
        selectedFeatureArea: featureArea,
        route: rawDiagnostics.location || null,
        signedIn: !!meta.signedIn,
        tier: meta.tier || null,
      },
      preservedRecentIncident: preserved || null,
      recentJourney: recentJourney(rawDiagnostics, preserved),
      supportFlowBoundary: {
        oneSupportSystem: true,
        entrypoint: 'Profile/Help entrypoints open existing rcHelp support widget.',
        diagnosticsVisibility: 'hidden support evidence attached to support-submit payload',
        preservedIncidentFreshnessMs: PRESERVED_INCIDENT_TTL_MS,
        staleOrUnrelatedPreservedIncidentsAttach: false,
        createsNewReportingSurface: false,
      }
    };
    return packet;
  }
  function diagnostics(meta = {}) {
    const raw = {
      capturedAt: new Date().toISOString(),
      location: { href: location.href, pathname: location.pathname, search: location.search, hash: location.hash },
      visibleSection: visibleSection(),
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio: devicePixelRatio || 1 },
      userAgent: navigator.userAgent,
      bodyClass: document.body ? document.body.className : '',
      shellSurfaceReport: safe(() => typeof window.getShellSurfaceReport === 'function' ? window.getShellSurfaceReport() : null),
      shellDiagnosticsSnapshot: safe(() => typeof window.getShellDiagnosticsSnapshot === 'function' ? window.getShellDiagnosticsSnapshot() : null),
      publicRuntimeBoundaryReport: safe(() => typeof window.getPublicRuntimeBoundaryReport === 'function' ? window.getPublicRuntimeBoundaryReport() : null),
      appearanceFirstPaintReport: safe(() => typeof window.getAppearanceFirstPaintReport === 'function' ? window.getAppearanceFirstPaintReport() : null),
      runtimeUiState: safe(() => typeof window.getRuntimeUiState === 'function' ? window.getRuntimeUiState() : null),
      playbackStatus: safe(() => typeof window.getPlaybackStatus === 'function' ? window.getPlaybackStatus() : null),
      ttsSupportStatus: safe(() => typeof window.getTtsSupportStatus === 'function' ? window.getTtsSupportStatus() : null),
      ttsDiagnosticsSnapshot: safe(() => typeof window.getTtsDiagnosticsSnapshot === 'function' ? window.getTtsDiagnosticsSnapshot() : null)
    };
    return {
      supportEvidencePacket: buildSupportEvidencePacket(raw, meta),
      ...raw
    };
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result || '')); r.onerror = () => reject(r.error || new Error('read failed')); r.readAsDataURL(file); });
  }
  async function attachFile() {
    const file = s.els.file.files && s.els.file.files[0];
    s.screenshot = null; s.els.note.textContent = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type || '') || file.size > 2 * 1024 * 1024) { bubble('Please attach an image under 2 MB.', 'st'); return; }
    s.screenshot = { filename: file.name, mimeType: file.type, size: file.size, dataUrl: await fileToDataUrl(file) };
    s.els.note.textContent = file.name;
  }

  async function submit(text) {
    recordSupportJourney('support-submit-attempt', { path: s.path });
    const a = auth();
    const type = s.path[0] === ROOTS.bug ? 'bug' : s.path[0] === ROOTS.feedback ? 'feedback' : 'question';
    const headers = { 'Content-Type': 'application/json' };
    if (a.token) headers.Authorization = `Bearer ${a.token}`;
    const payload = {
      type,
      path: s.path,
      message: text,
      contactEmail: a.user?.email || '',
      context: { user: a.user, signedIn: a.signedIn, policy: a.policy, route: visibleSection(), supportPath: s.path, location: { href: location.href, pathname: location.pathname, search: location.search, hash: location.hash } },
      diagnostics: diagnostics({ type, path: s.path, signedIn: a.signedIn, tier: a.policy?.tier || a.user?.tier || null }),
      transcript: s.transcript.slice(-30),
      screenshot: s.screenshot
    };
    const resp = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(payload), cache: 'no-store' });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data || data.ok === false) throw new Error(data?.error || `Support submit failed (${resp.status})`);
    return data;
  }

  async function send() {
    const text = s.els.msg.value.trim();
    if (!s.unlocked || !text) return;
    bubble(text, 'u');
    s.els.msg.value = '';
    s.els.msg.disabled = true;
    s.els.send.textContent = 'Sending…';
    refreshSend();
    try {
      await submit(text);
      recordSupportJourney('support-submit-success', { path: s.path });
      bubble('Sent — app context was included for the Jubly team.', 'st ok');
      bubble('Thanks. You can start another topic whenever you’re ready.', 'a');
      s.path = []; s.placeholder = ''; s.screenshot = null; s.els.note.textContent = ''; lock(); chips(ROOT_CHOICES, chooseType);
    } catch (err) {
      recordSupportJourney('support-submit-failed', { path: s.path });
      bubble(String(err && err.message || 'Support message could not be sent.'), 'st');
      s.els.msg.disabled = false; s.els.msg.value = text; refreshSend();
    } finally {
      s.els.send.textContent = 'Send';
    }
  }

  async function openRoot(root) {
    recordSupportJourney('support-widget-opened', { root });
    try { if (window.rcAnnotations && typeof window.rcAnnotations.closeWidget === 'function') window.rcAnnotations.closeWidget(); } catch (_) {}
    mount();
    setOpen(true);
    if (root) { start(); chooseType(root); }
    return true;
  }
  function shutdown() { forgetOpened(); const root = document.getElementById(ID); if (root) root.remove(); s.mounted = false; s.els = {}; }

  window.rcHelp = {
    syncIdentity: async () => true,
    openChat: () => openRoot(null),
    openFeedback: () => openRoot(ROOTS.feedback),
    openBugReport: () => openRoot(ROOTS.bug),
    close: () => setOpen(false),
    dismiss,
    toggle: () => {
      mount();
      const nextOpen = !s.els.root.classList.contains('open');
      if (nextOpen) { try { if (window.rcAnnotations && typeof window.rcAnnotations.closeWidget === 'function') window.rcAnnotations.closeWidget(); } catch (_) {} }
      return setOpen(nextOpen);
    },
    shutdown,
  };

  function installPersistedLauncherRestore() {
    const onAuthChanged = (event) => {
      const detail = event && event.detail ? event.detail : null;
      if (detail && detail.ready && detail.signedIn) { restorePersistedLauncher(); return; }
      if (detail && detail.ready && !detail.signedIn) shutdown();
    };
    try { document.addEventListener('rc:auth-changed', onAuthChanged); } catch (_) {}
    try { window.addEventListener('rc:auth-changed', onAuthChanged); } catch (_) {}
    const restore = () => { restorePersistedLauncher(); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', restore, { once: true });
    } else {
      setTimeout(restore, 0);
    }
  }

  installPersistedLauncherRestore();

  // Do not mount by default on public load. After a signed-in user opens support once,
  // a minimized launcher is restored across refresh until hard close or sign-out.
})();
