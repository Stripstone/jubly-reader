// Split from original app.js during role-based phase-1 restructure.
// File: anchors.js
// Note: This is still global-script architecture (no bundler/modules required).

  // Anchors (core idea targets)
  // ===================================

  // API base is resolved centrally in config.js.
  // Override precedence remains:
  //   1) ?api=https://your-vercel.app
  //   2) localStorage rc_api_base
  //   3) same-origin when the current host serves /api
  //   4) canonical public Vercel origin
  // ----------------------------------------------------
  // Anchor cache invalidation
  // ----------------------------------------------------
  // Anchors are cached in localStorage under keys like:
  //   anchors:<ANCHOR_VERSION>:<pageHash>
  // During iterative development, logic/prompt changes can make old cached
  // anchors look like "hallucinated" runtime bugs. To prevent that, we treat
  // ANCHOR_ENGINE_VERSION as the broad truth for anchor-system behavior.
  // If it changes, we wipe ALL anchor cache entries before continuing.
  const ANCHOR_ENGINE_VERSION = "2.1.0";
  const ANCHOR_ENGINE_VERSION_KEY = "rc_anchor_engine_version";

  function invalidateAnchorsCacheIfNeeded() {
    try {
      const stored = localStorage.getItem(ANCHOR_ENGINE_VERSION_KEY);
      if (stored === ANCHOR_ENGINE_VERSION) return;

      // Remove ALL cached anchor entries (any version).
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith('anchors:')) {
          localStorage.removeItem(k);
        }
      }
      localStorage.setItem(ANCHOR_ENGINE_VERSION_KEY, ANCHOR_ENGINE_VERSION);
      try { console.info('[AnchorEngine] cache cleared (version change)', { from: stored, to: ANCHOR_ENGINE_VERSION }); } catch (_) {}
    } catch (_) {
      // ignore (private mode / quota)
    }
  }

  // IMPORTANT: run before any anchor cache reads.
  invalidateAnchorsCacheIfNeeded();

const ANCHOR_VERSION = 6;
  const anchorsInFlight = new Map(); // pageHash -> Promise

  // Global anchors diagnostics record surfaced via the 🔧 Diagnostics panel.
  // This is REQUIRED so "Load Pages" / "Add Pages" always produces tangible
  // runtime evidence even when anchors come from cache.
  let lastAnchorsDiagnostics = null;

  // -----------------------------------
  // Anchors diagnostics (REQUIRED when ?debug=1)
  // -----------------------------------
  // Policy: every anchor load trigger must write a tangible diagnostic record,
  // even on cache hits, so runtime validation never relies on "ghost" behavior.
  function isAnchorsDebugEnabled() {
    return isDebugEnabledFromUrl();
  }

  function setAnchorsDiagnostics(pageEl, pageIndex, patch) {
    try {
      if (!isAnchorsDebugEnabled()) return;
      const pd = pageData?.[pageIndex];
      if (!pd) return;

      pd.anchorsDiagnostics = Object.assign({}, pd.anchorsDiagnostics || {}, patch || {});
      pd.anchorsDiagnostics.ts = Date.now();

      // Always update global record (even if pageEl is not present).
      lastAnchorsDiagnostics = Object.assign({ pageIndex }, pd.anchorsDiagnostics);

      if (!pageEl) return;

      const pre = pageEl.querySelector('.anchors-debug-pre');
      if (pre) {
        const d = pd.anchorsDiagnostics || {};
        const lines = [
          `stage: ${d.stage || ''}`,
          `pageIndex: ${pageIndex}`,
          `pageHash: ${(d.pageHash || pd.pageHash || '').slice(0, 12)}`,
          `cacheHit: ${String(d.cacheHit)}`,
          `api: ${d.api ? `${d.api.url} (${d.api.status})` : ''}`,
          `anchors: ${typeof d.anchorCount === 'number' ? d.anchorCount : ''}`,
          `spansInjected: ${typeof d.spanCount === 'number' ? d.spanCount : ''}`,
          d.error ? `error: ${d.error}` : '',
        ].filter(Boolean);
        pre.textContent = lines.join('\\n');
      }

      const counter = pageEl.querySelector('.anchors-counter');
      if (counter) {
        const d = pd.anchorsDiagnostics || {};
        const shortHash = String(d.pageHash || pd.pageHash || '').slice(0, 8);
        counter.title = `anchors dbg — hash:${shortHash} cacheHit:${String(d.cacheHit)} stage:${d.stage || ''}`;
      }
    } catch (_) {}
  }

  async function sha256HexBrowser(text) {
    const enc = new TextEncoder();
    const data = enc.encode(String(text ?? ""));
    const hash = await crypto.subtle.digest('SHA-256', data);
    const bytes = Array.from(new Uint8Array(hash));
    return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function normalizeForMatch(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Deterministic stopword list for anchor term extraction/matching.
  // Keep intentionally small; we're not doing NLP, just avoiding glue-words.
  const ANCHOR_STOPWORDS = new Set([
    'a','an','and','are','as','at','be','been','being','but','by','can','could','did','do','does','doing',
    'for','from','had','has','have','having','he','her','here','hers','him','his','how','i','if','in','into',
    'is','it','its','just','like','may','me','more','most','my','no','not','of','off','on','one','or','our',
    'out','over','people','so','some','such','than','that','the','their','them','then','there','these','they',
    'this','those','to','too','under','up','us','was','we','were','what','when','where','which','who','why',
    'will','with','without','you','your'
  ]);

  // Weak verbs and helper words that often become "strange" anchor keywords.
  // We intentionally filter these out for a more satisfying UX.
  const ANCHOR_WEAK_VERBS = new Set([
    'be','been','being','is','are','was','were','am',
    'have','has','had','having',
    'do','does','did','doing',
    'get','gets','got','getting',
    'make','makes','made','making',
    'feel','feels','felt','feeling',
    // common "action" verbs / helper words that tend to become unhelpful anchor keywords
    // (we prefer the nouns/concepts around them)
    'create','creates','created','creating',
    'need','needs','needed','needing',
    'start','starts','started','starting',
    'earn','earns','earned','earning',
    'move','moves','moved','moving',
    'begin','begins','began','beginning',
    'able','right'
  ]);

  // Simple normalization into a stable trigger token.
  // Robustness comes from generating "trim variants" rather than heavy NLP.
  function baseForm(token) {
    let t = String(token || '').toLowerCase().trim();
    if (!t) return '';
    t = t.replace(/[^a-z0-9]/g, '');
    if (!t) return '';
    return t;
  }

  // Generate shortened forms by dropping 1–4 characters from the end.
  // Rule:
  // - If token length < 4 => no trimming.
  // - Otherwise return token plus t[:-1..-4] as long as length >= minRemain.
  function trimVariants(token, minRemain = 3) {
    const t = baseForm(token);
    if (!t) return [];
    if (t.length < 4) return [t];
    const out = [t];
    for (let k = 1; k <= 4; k++) {
      const n = t.length - k;
      if (n < minRemain) continue;
      out.push(t.slice(0, n));
    }
    return out;
  }

  function tokenizeBase(text) {
    const s = normalizeForMatch(text);
    if (!s) return [];
    const raw = s.split(' ').filter(Boolean);
    const out = [];
    for (const w of raw) {
      const b = baseForm(w);
      if (!b) continue;
      if (b.length < 4) continue;
      if (ANCHOR_STOPWORDS.has(b)) continue;
      if (ANCHOR_WEAK_VERBS.has(b)) continue;
      out.push(b);
    }
    return out;
  }

  function extractEssentialTerms(anchor) {
    // Matching should feel generous, but not "free".
    // We prioritize literal quote terms, and only keep a small number of extra model terms
    // (to support paraphrase) while filtering low-signal filler.
    const rawTerms = Array.isArray(anchor?.terms) ? anchor.terms : [];

    const quoteTerms = tokenizeBase(anchor?.quote || "");
    const quoteSet = new Set(quoteTerms);

    const STOP = new Set([
      "a","an","the","and","or","but","so","to","of","in","on","for","with","at","by","from","as","it","its",
      "is","are","was","were","be","been","being","do","does","did","have","has","had",
      "this","that","these","those","you","your","we","our","they","their","i","me","my",
      "can","could","should","would","will","just","very","really","more","most","less","much",
      "about","into","over","under","than","then","when","how","why","what","who"
    ]);

    function isHighSignal(term) {
      if (!term) return false;
      if (/\d/.test(term)) return true; // numbers, wpm, percentages
      if (term.length >= 8) return true; // longer words tend to be more specific
      return ["hundred","hundreds","percent","wpm","spreeder","triforce","monologue","tracker","insight","insights"].includes(term);
    }

    // Normalize model terms via tokenizeBase, but filter filler.
    const modelTermsAll = rawTerms.flatMap(t => tokenizeBase(t));
    const modelTerms = modelTermsAll.filter(w => w && !STOP.has(w));

    const out = [];
    const seen = new Set();

    // 1) Always include quote terms first (literal spine)
    for (const w of quoteTerms) {
      if (!w || STOP.has(w) || seen.has(w)) continue;
      seen.add(w);
      out.push(w);
      if (out.length >= 6) return out;
    }

    // 2) Add a small number of extra model terms (paraphrase support),
    // preferring those that are either in the quote OR high-signal.
    let extras = 0;
    for (const w of modelTerms) {
      if (!w || seen.has(w)) continue;
      if (quoteSet.has(w) || isHighSignal(w)) {
        seen.add(w);
        out.push(w);
        extras += quoteSet.has(w) ? 0 : 1;
      }
      if (out.length >= 6 || extras >= 2) break;
    }

    return out.slice(0, 6);
  }
function shouldCountAnchor(anchor, quoteMatch, matchedTerms, matchCount, totalTerms) {
    // Quote match counts as found.
    if (quoteMatch) return true;

    const weight = Number(anchor?.weight ?? 1);
    const ratio = totalTerms > 0 ? (matchCount / totalTerms) : 0;

    // High-signal terms are the ones that tend to carry the "mechanism" or key detail.
    const HIGH = new Set(["hundred","hundreds","percent","wpm","spreeder","triforce","monologue","tracker","insight","insights"]);
    const hasHigh = Array.isArray(anchor?.terms) && anchor.terms.some(t => HIGH.has(String(t).toLowerCase()));
    const matchedHigh = Array.isArray(matchedTerms) && matchedTerms.some(t => HIGH.has(String(t).toLowerCase()));

    // Progressive strictness:
    // - weight 3: require strong completion (or at least one high-signal term)
    // - weight 2: require moderate completion
    // - weight 1: allow a single meaningful hit
    if (weight >= 3) {
      if (hasHigh && !matchedHigh) return false;
      return ratio >= 0.8 || matchCount >= Math.min(3, totalTerms);
    }
    if (weight === 2) {
      if (hasHigh && !matchedHigh) return false;
      return ratio >= 0.6 || matchCount >= Math.min(2, totalTerms);
    }
    // weight 1
    return matchCount >= 1;
  }

function quoteChunkMatch(quote, inputNorm) {
    const q = normalizeForMatch(quote);
    if (!q || !inputNorm) return false;
    // If the quote is short, allow direct substring match.
    if (q.length <= 40) return inputNorm.includes(q);
    // Otherwise, try 3-word chunks (deterministic)
    const words = q.split(" ").filter(Boolean);
    if (words.length < 3) return false;
    for (let i = 0; i <= words.length - 3; i++) {
      const chunk = words.slice(i, i + 3).join(" ");
      if (chunk.length >= 12 && inputNorm.includes(chunk)) return true;
    }
    return false;
  }

  function buildAnchorsHtml(sourceText, anchors) {
    const src = String(sourceText || '');
    const list = Array.isArray(anchors) ? anchors : [];
    if (!list.length) return escapeHtml(src);

    // Compute non-overlapping ranges from first occurrence of each quote.
    const ranges = [];
    for (const a of list) {
      const q = String(a?.quote || '');
      if (!q) continue;
      const idx = src.indexOf(q);
      if (idx === -1) continue;
      ranges.push({ start: idx, end: idx + q.length, id: String(a?.id || '') });
    }

    if (!ranges.length) return escapeHtml(src);

    // Prefer longer quotes first when overlaps exist, then earlier start.
    ranges.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    const chosen = [];
    const overlaps = (r1, r2) => !(r1.end <= r2.start || r2.end <= r1.start);
    for (const r of ranges) {
      if (chosen.some(c => overlaps(c, r))) continue;
      chosen.push(r);
    }
    chosen.sort((a, b) => a.start - b.start);

    let out = '';
    let cursor = 0;
    for (const r of chosen) {
      if (r.start > cursor) out += escapeHtml(src.slice(cursor, r.start));
      const segment = src.slice(r.start, r.end);
      out += `<span class="anchor" data-anchor-id="${escapeHtml(r.id)}">${escapeHtml(segment)}</span>`;
      cursor = r.end;
    }
    if (cursor < src.length) out += escapeHtml(src.slice(cursor));
    return out;
  }

  function getAnchorCacheKey(pageHash) {
    return `anchors:${ANCHOR_VERSION}:${pageHash}`;
  }

  function readAnchorsFromCache(pageHash) {
    try {
      const raw = localStorage.getItem(getAnchorCacheKey(pageHash));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.anchorVersion !== ANCHOR_VERSION) return null;
      if (!Array.isArray(parsed.anchors)) return null;
    // Back-compat: older cache shape was { anchors: [...] }.
    // Newer cache may include extra fields produced by /api/ai?action=anchors.
    return {
      ...parsed,
      // Anchors endpoint no longer emits pageBetterConsolidation (evaluate owns that).
      pageBetterConsolidation: undefined,
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : undefined,
    };
    } catch (_) {
      return null;
    }
  }

function writeAnchorsToCache(pageHash, payload) {
    try {
    const toStore = {
      anchors: payload?.anchors,
      pageBetterConsolidation: undefined,
      candidates: payload?.candidates,
      anchorVersion: ANCHOR_VERSION,
      createdAt: Date.now(),
    };
    localStorage.setItem(getAnchorCacheKey(pageHash), JSON.stringify(toStore));
    } catch (_) {
      // ignore quota errors
    }
  }

  async function fetchAnchorsForPageText(pageText, pageHash) {
    // Pre-flight usage check before cloud anchors call.
    // Pass 3: server verdict gates the action; client counter is display-only.
    if (window.rcUsage && typeof window.rcUsage.check === 'function') {
      try {
        const verdict = await window.rcUsage.check('anchors');
        if (!verdict.allowed) {
          throw new Error('Usage limit reached. Upgrade your plan to continue generating anchors.');
        }
      } catch (usageErr) {
        if (usageErr.message && usageErr.message.includes('Usage limit')) throw usageErr;
        // Server unreachable: proceed (safe degraded behavior).
      }
    }

    const debug = isDebugEnabledFromUrl();
    const url = apiUrl('/api/ai?action=anchors');
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageText, maxAnchors: 5, debug: debug ? 1 : 0 }),
    });
    const txt = await resp.text();
    let data;
    try { data = JSON.parse(txt); } catch { data = { error: 'Invalid JSON from /api/ai?action=anchors', detail: txt }; }
    if (!resp.ok) {
      const err = new Error(data?.error || 'Anchors API error');
      err.details = data;
      throw err;
    }
    // Spend 1 token for anchor generation (display/diagnostics tracking only).
    try { if (window.rcUsage && typeof window.rcUsage.spend === 'function') window.rcUsage.spend('anchors'); else if (typeof tokenSpend === 'function') tokenSpend('anchors'); } catch(_) {}
    // Basic schema check
    if (!Array.isArray(data?.anchors) || !data?.meta?.pageHash) {
      const err = new Error('Invalid /api/ai?action=anchors response schema');
      err.details = data;
      throw err;
    }
    if (String(data.meta.pageHash) !== String(pageHash)) {
      const err = new Error('Anchors pageHash mismatch');
      err.details = { expected: pageHash, got: data?.meta?.pageHash };
      throw err;
    }

    // In debug mode, surface diagnostics in the console AND return enough metadata
    // for the on-page anchors debug panel.
    if (debug) {
      try {
        console.info('[Anchors] /api/ai?action=anchors response', {
          status: resp.status,
          pageHash: data?.meta?.pageHash,
          anchorVersion: data?.meta?.anchorVersion,
          anchors: Array.isArray(data?.anchors) ? data.anchors.length : null,
          debug: data?.debug,
        });
      } catch (_) {}
    }
    return { data, api: { url, status: resp.status }, rawText: debug ? txt : undefined };
  }

  async function ensureAnchorsForPageIndex(pageIndex, pageElForDiag = null) {
    const text = String(pages?.[pageIndex] || '');
    if (!text) return null;

    const pd = pageData?.[pageIndex];
    if (!pd) return null;

    // If already loaded for this pageHash, reuse.
    if (pd.pageHash && pd.anchors && pd.anchorVersion === ANCHOR_VERSION) return pd.anchors;

    // Diagnostics: trigger recorded as soon as anchors are requested.
    setAnchorsDiagnostics(pageElForDiag, pageIndex, { stage: 'trigger', cacheHit: null });

    const pageHash = pd.pageHash || await sha256HexBrowser(text);
    pd.pageHash = pageHash;
    setAnchorsDiagnostics(pageElForDiag, pageIndex, { stage: 'pageHash', pageHash, cacheHit: null });

    const cached = readAnchorsFromCache(pageHash);
    // Use cache only if it matches current anchor version
    if (cached?.anchors && cached.anchorVersion === ANCHOR_VERSION) {
      pd.anchors = cached.anchors;
      // No pageBetterConsolidation in anchors cache (evaluate owns that).
      pd.anchorCandidates = cached.candidates;
      pd.anchorVersion = cached.anchorVersion;
      pd.anchorsMeta = { createdAt: cached.createdAt, cacheHit: true };
      setAnchorsDiagnostics(pageElForDiag, pageIndex, {
        stage: 'cache-hit',
        pageHash,
        cacheHit: true,
        anchorCount: cached.anchors.length,
        pageBetterConsolidation: null,
        candidates: Array.isArray(cached.candidates) ? cached.candidates : null,
        api: null,
      });
      if (isDebugEnabledFromUrl()) {
        try {
          console.info("[Anchors] cache hit", { pageHash, anchorVersion: cached.anchorVersion, createdAt: cached.createdAt });
        } catch (_) {}
      }
      return pd.anchors;
    }

    if (cached?.anchors && cached.anchorVersion !== ANCHOR_VERSION) {
      // Cache exists but is stale — force a re-fetch so new server contract can be validated.
      pd.anchorsMeta = { createdAt: cached.createdAt, cacheHit: false, cacheStale: true, cachedAnchorVersion: cached.anchorVersion, expectedAnchorVersion: ANCHOR_VERSION };
      setAnchorsDiagnostics(pageElForDiag, pageIndex, {
        stage: 'cache-stale',
        pageHash,
        cacheHit: false,
        cacheStale: true,
        cachedAnchorVersion: cached.anchorVersion,
        expectedAnchorVersion: ANCHOR_VERSION,
        anchorCount: cached.anchors.length,
        api: null,
      });
      if (isDebugEnabledFromUrl()) {
        try {
          console.info("[Anchors] cache stale (will refetch)", { pageHash, cachedAnchorVersion: cached.anchorVersion, expectedAnchorVersion: ANCHOR_VERSION });
        } catch (_) {}
      }
    }

    // De-dupe concurrent fetches by pageHash.
    if (anchorsInFlight.has(pageHash)) {
      await anchorsInFlight.get(pageHash);
      return pd.anchors || null;
    }

    const p = (async () => {
      setAnchorsDiagnostics(pageElForDiag, pageIndex, { stage: 'fetching', pageHash, cacheHit: false });
      const out = await fetchAnchorsForPageText(text, pageHash);
      const data = out.data;
      pd.anchors = data.anchors;
      // No pageBetterConsolidation in anchors response (evaluate owns that).
      pd.anchorCandidates = data.candidates;
      pd.anchorVersion = data.meta.anchorVersion;
      pd.anchorsMeta = { createdAt: Date.now(), cacheHit: false };
      pd.anchorsRawDebug = data?.debug || null;
      setAnchorsDiagnostics(pageElForDiag, pageIndex, {
        stage: 'fetched',
        pageHash,
        cacheHit: false,
        api: out.api,
        anchorCount: Array.isArray(data.anchors) ? data.anchors.length : null,
        pageBetterConsolidation: null,
        candidates: Array.isArray(data.candidates) ? data.candidates : null,
      });
      writeAnchorsToCache(pageHash, {
        anchors: data.anchors,
        pageBetterConsolidation: null,
        candidates: data.candidates,
      });
    })();

    anchorsInFlight.set(pageHash, p);
    try {
      await p;
      return pd.anchors;
    } finally {
      anchorsInFlight.delete(pageHash);
    }
  }

  function updateAnchorsUIForPage(pageEl, pageIndex, userText) {
    const pd = pageData?.[pageIndex];
    if (!pageEl || !pd?.anchors) return;

    const inputNorm = normalizeForMatch(userText);
    const userBaseTokens = tokenizeBase(userText);
    // Expand user tokens into trimmed variants for robust matching.
    // Example: "generational" -> ["generational","generationa","generation","generatio","generati"]
    // This intentionally does NOT require variants to be "real words"; it's just a deterministic trigger key.
    const userVariantSet = new Set();
    for (const t of userBaseTokens) {
      for (const v of trimVariants(t, 3)) userVariantSet.add(v);
    }
    const anchors = pd.anchors;
    const spans = pageEl.querySelectorAll('.page-text .anchor');

    // Phase 2 UX contract:
    // - Counter unlocks an anchor as soon as ANY essential keyword matches.
    // - Visual intensity reflects how many essential keywords are present.
    // - First match should be NOTICEABLE (>= 50% intensity), additional matches strengthen it.
    // - Additionally, the matched keyword(s) inside the anchor quote should be fully highlighted.
    // UX tuning:
    // - First match should be clearly visible, but not overpowering.
    // - Additional matches increase intensity.
    const ANCHOR_ALPHA_MAX = 0.90;
    const ANCHOR_ALPHA_FIRST = 0.40;

    const foundIds = new Set();
    const byId = new Map(anchors.map(a => [String(a.id), a]));
    const matchDetails = [];

    spans.forEach(span => {
      const id = String(span.getAttribute('data-anchor-id') || '');
      const a = byId.get(id);
      if (!a) return;

      const essential = extractEssentialTerms(a);
      // A term is considered matched if ANY of its trim variants appears in the userVariantSet.
      const matched = [];
      for (const term of essential) {
        const variants = trimVariants(term, 3);
        if (variants.some(v => userVariantSet.has(v))) matched.push(term);
      }

      // If the user effectively quoted the passage (chunk match), treat as fully satisfied.
      const quoteMatch = quoteChunkMatch(a.quote, inputNorm);
      const total = Math.max(1, essential.length);
      const matchCount = quoteMatch ? total : matched.length;
      const counted = shouldCountAnchor(a, quoteMatch, matched, matchCount, total);
      const ratio = Math.min(1, matchCount / total);

      // Apply progressive alpha.
      // UX rule: first match should jump to >= 50% visibility; more matches approach max.
      let alpha = 0;
      if (matchCount >= 1) {
        if (total <= 1) {
          alpha = ANCHOR_ALPHA_MAX;
        } else {
          const extraSteps = Math.min(total, matchCount) - 1;
          const denom = Math.max(1, total - 1);
          const extra = (ANCHOR_ALPHA_MAX - ANCHOR_ALPHA_FIRST) * (extraSteps / denom);
          alpha = Math.min(ANCHOR_ALPHA_MAX, ANCHOR_ALPHA_FIRST + extra);
        }
      }
      span.style.setProperty('--anchor-alpha', String(alpha));

      // Fully highlight the matched keyword(s) inside the anchor quote.
      // This gives the "Oh, I found a word" feedback without changing matching rules.
      applyMatchedTermHighlight(span, quoteMatch ? essential : matched);

      if (counted) foundIds.add(id);

      // Collect match reasoning for debug (only tiny payload).
      matchDetails.push({
        id,
        terms: essential,
        matchedTerms: quoteMatch ? essential : matched,
        matchedBaseForms: quoteMatch ? essential : matched,
        matchedBaseFormsViaTrim: quoteMatch ? essential : matched,
        userBaseTokensSample: userBaseTokens.slice(0, 18),
        userTrimTokensSample: Array.from(userVariantSet).slice(0, 18),
        matchCount,
        totalTerms: total,
        counted,
        completionRatio: Number(ratio.toFixed(2)),
        matchedBy: quoteMatch ? 'quote' : 'terms'
      });
    });

    const counter = pageEl.querySelector('.anchors-counter');
    if (counter) counter.textContent = `Anchors Found: ${foundIds.size}/${anchors.length}`;

    // Surface match reasoning in diagnostics when debug is enabled.
    if (isDebugEnabledFromUrl()) {
      setAnchorsDiagnostics(pageEl, pageIndex, {
        stage: 'matches-updated',
        found: foundIds.size,
        // Keep small: only include first 8 anchors worth of details.
        matchDetails: matchDetails.slice(0, 8)
      });
    }
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function applyMatchedTermHighlight(span, matchedTerms) {
    if (!span) return;
    const original = span.dataset.originalText ?? span.textContent;
    // Always reset to original before applying new markup.
    span.textContent = original;
    span.dataset.originalText = original;

    const terms = Array.isArray(matchedTerms)
      ? matchedTerms.map(t => String(t || '').trim()).filter(Boolean)
      : [];
    if (!terms.length) return;

    // Prefer longer terms first to avoid partial overlap issues.
    terms.sort((a, b) => b.length - a.length);

    // Terms are trigger keys; create a forgiving surface pattern for the quote.
    // We allow up to 4 trailing word characters so:
    // - "student" highlights "students"
    // - "generation" highlights "generational"
    // This is aligned with the trim-variant matching rule.
    const variants = [];
    for (const t of terms) {
      const esc = escapeRegExp(t);
      variants.push(`${esc}\\w{0,4}`);
    }

    const pattern = variants.join('|');
    if (!pattern) return;

    const re = new RegExp(`\\b(${pattern})\\b`, 'gi');
    const text = original;
    const parts = text.split(re);
    if (parts.length <= 1) return;

    // Rebuild with matched segments wrapped.
    let html = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i % 2 === 1) {
        html += `<span class="anchor-term-found">${escapeHtml(part)}</span>`;
      } else {
        html += escapeHtml(part);
      }
    }
    span.innerHTML = html;
  }

  function bindHintButton(pageEl, pageIndex) {
    const btn = pageEl.querySelector('.hint-btn');
    if (!btn) return;
    if (!canUseAnchorsRuntime()) {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.title = 'Anchors are not available on the active plan';
      return;
    }
    btn.addEventListener('click', async () => {
      const pd = pageData?.[pageIndex];

      // Helper: ensure CSS transitions apply on first-time injection.
      const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

      // Lazy anchors: if anchors aren't ready yet, generate them now.
      // Keep UX simple: disable button briefly while loading.
      if (!pd?.anchors?.length) {
        try {
          btn.disabled = true;
          btn.textContent = 'Generating…';
          await hydrateAnchorsIntoPageEl(pageEl, pageIndex);
          // On first generation, the spans are newly injected; wait a frame so
          // the browser can commit layout before we animate hint opacity.
          await nextFrame();
        } catch (_) {
          // If anchors fail, keep hint disabled (consistent with error path).
        } finally {
          btn.textContent = 'Hint';
          // hydrateAnchorsIntoPageEl will re-enable if successful
          if (pd?.anchors?.length) btn.disabled = false;
        }
      }

      if (!pd?.anchors?.length) return;

      // 2s fade-in / 2s fade-out visual override.
      const spans = pageEl.querySelectorAll('.page-text .anchor');
      spans.forEach(s => { s.style.transitionDuration = '2s'; });
      // Inline CSS vars beat class rules; explicitly set alpha for hint.
      // To avoid a "snap" on the first run, force a 0 -> 0.90 transition.
      spans.forEach(s => {
        s.dataset.anchorAlphaPrev = s.style.getPropertyValue('--anchor-alpha') || '';
        s.style.setProperty('--anchor-alpha', '0');
      });
      await nextFrame();
      spans.forEach(s => s.style.setProperty('--anchor-alpha', '0.90'));
      pageEl.classList.add('anchor-hint-active');

      // Hold for 2 seconds, then return to match-based visibility over 2 seconds.
      setTimeout(() => {
        pageEl.classList.remove('anchor-hint-active');
        // After fade-out completes, restore normal transition speed and refresh matches.
        setTimeout(() => {
          spans.forEach(s => { s.style.transitionDuration = '0.35s'; });
          spans.forEach(s => {
            // Clear hint override; updateAnchorsUIForPage will re-apply match-based alpha.
            delete s.dataset.anchorAlphaPrev;
          });
          const textarea = pageEl.querySelector('textarea');
          updateAnchorsUIForPage(pageEl, pageIndex, textarea ? textarea.value : '');
        }, 2000);
      }, 2000);
    });
  }

  async function hydrateAnchorsIntoPageEl(pageEl, pageIndex) {
    if (!canUseAnchorsRuntime()) return;
    const text = String(pages?.[pageIndex] || '');
    if (!pageEl || !text) return;
    const textEl = pageEl.querySelector('.page-text');
    if (!textEl) return;

    try {
      setAnchorsDiagnostics(pageEl, pageIndex, { stage: 'hydrate-start', cacheHit: null });
      const anchors = await ensureAnchorsForPageIndex(pageIndex, pageEl);
      if (!anchors || !anchors.length) return;
      // Only apply if the text element is still for this page.
      textEl.innerHTML = buildAnchorsHtml(text, anchors);

      // If we failed to inject any spans, make it visible in debug.
      const spanCount = textEl.querySelectorAll('.anchor').length;
      setAnchorsDiagnostics(pageEl, pageIndex, { stage: 'spans-injected', spanCount, anchorCount: anchors.length });
      if (spanCount === 0) {
        const counter = pageEl.querySelector('.anchors-counter');
        if (counter) counter.textContent = `Anchors Found: 0/${anchors.length}`;
        if (isDebugEnabledFromUrl()) {
          console.warn('[Anchors] No spans injected. Quotes may not match the rendered page text exactly.', {
            pageIndex,
            anchorsSample: anchors.slice(0, 3),
          });
        }
      }

      const textarea = pageEl.querySelector('textarea');
      updateAnchorsUIForPage(pageEl, pageIndex, textarea ? textarea.value : '');
      const btn = pageEl.querySelector('.hint-btn');
      if (btn) btn.disabled = false;
    } catch (e) {
      const counter = pageEl.querySelector('.anchors-counter');
      if (counter) counter.textContent = 'Anchors: error';
      const btn = pageEl.querySelector('.hint-btn');
      if (btn) btn.disabled = true;

      setAnchorsDiagnostics(pageEl, pageIndex, { stage: 'error', error: String(e?.message || e) });

      if (isDebugEnabledFromUrl()) {
        console.warn('Anchors failed', e);
      }
    }
  }

  const sandSound = document.getElementById("sandSound");
  const stoneSound = document.getElementById("stoneSound");
  const rewardSound = document.getElementById("rewardSound");
  const compassSound = document.getElementById("compassSound");
  const pageTurnSound = document.getElementById("pageTurnSound");
  const evaluateSound = document.getElementById("evaluateSound");
  
  // Set initial volumes
  function loadSavedVolumes() {
    try {
      const raw = localStorage.getItem('rc_volumes');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function saveVolumes(v) {
    try { localStorage.setItem('rc_volumes', JSON.stringify(v)); } catch (_) {}
  }

  const savedVol = loadSavedVolumes() || {};
  // Voices (TTS) volume is handled separately from music/SFX.
  TTS_STATE.volume = typeof savedVol.voice === 'number' ? savedVol.voice : 1;

  // Voice variant (male/female) is session-only during stabilization.
  try {
    const v = String(localStorage.getItem('rc_voice_variant') || TTS_STATE.voiceVariant || window.__rcSessionVoiceVariant || '').toLowerCase();
    if (v === 'male' || v === 'female') TTS_STATE.voiceVariant = v;
  } catch (_) {}
  sandSound.volume = typeof savedVol.sand === 'number' ? savedVol.sand : SAND_VOLUME;
  stoneSound.volume = typeof savedVol.stone === 'number' ? savedVol.stone : STONE_VOLUME;
  rewardSound.volume = typeof savedVol.reward === 'number' ? savedVol.reward : REWARD_VOLUME;
  compassSound.volume = typeof savedVol.compass === 'number' ? savedVol.compass : COMPASS_VOLUME;
  pageTurnSound.volume = typeof savedVol.pageTurn === 'number' ? savedVol.pageTurn : PAGE_TURN_VOLUME;
  evaluateSound.volume = typeof savedVol.evaluate === 'number' ? savedVol.evaluate : EVALUATE_VOLUME;
  music.volume = typeof savedVol.music === 'number' ? savedVol.music : MUSIC_VOLUME;

  // Small helper used by the volume panel
  function setVolume(key, val) {
    const v = Math.max(0, Math.min(1, Number(val)));
    const cur = loadSavedVolumes() || {};
    cur[key] = v;
    saveVolumes(cur);
    if (key === 'sand') sandSound.volume = v;
    if (key === 'stone') stoneSound.volume = v;
    if (key === 'reward') rewardSound.volume = v;
    if (key === 'compass') compassSound.volume = v;
    if (key === 'pageTurn') pageTurnSound.volume = v;
    if (key === 'evaluate') evaluateSound.volume = v;
    if (key === 'music') music.volume = v;
    if (key === 'voice') {
      TTS_STATE.volume = v;
      // Apply immediately if Polly audio is currently playing.
      if (TTS_STATE.audio && typeof TTS_STATE.audio.volume === 'number') {
        try { TTS_STATE.audio.volume = v; } catch (_) {}
      }
    }
  }
  
  // Set initial input values from constants
  document.getElementById("goalTimeInput").value = DEFAULT_TIME_GOAL;
  document.getElementById("goalCharInput").value = DEFAULT_CHAR_GOAL;

  // Difficulty presets: set time + character targets with one click.
  (function initDifficultyPresets() {
    const btnEasy = document.getElementById('difficultyEasy');
    const btnMed = document.getElementById('difficultyMedium');
    const btnHard = document.getElementById('difficultyHard');
    const timeEl = document.getElementById('goalTimeInput');
    const charEl = document.getElementById('goalCharInput');
    if (!btnEasy || !btnMed || !btnHard || !timeEl || !charEl) return;

    const PRESETS = {
      easy:   { time: 90,  chars: 200 },
      medium: { time: 150, chars: 260 },
      hard:   { time: 300, chars: 340 },
    };

    function setActive(mode) {
      [btnEasy, btnMed, btnHard].forEach((b) => b.classList.remove('is-active'));
      btnEasy.setAttribute('aria-pressed', String(mode === 'easy'));
      btnMed.setAttribute('aria-pressed', String(mode === 'medium'));
      btnHard.setAttribute('aria-pressed', String(mode === 'hard'));
      if (mode === 'easy') btnEasy.classList.add('is-active');
      if (mode === 'medium') btnMed.classList.add('is-active');
      if (mode === 'hard') btnHard.classList.add('is-active');
    }

    function applyPreset(mode) {
      const p = PRESETS[mode];
      if (!p) return;
      timeEl.value = String(p.time);
      charEl.value = String(p.chars);
      setActive(mode);
      try { localStorage.setItem('rc_difficulty', mode); } catch (_) {}
    }

    btnEasy.addEventListener('click', () => applyPreset('easy'));
    btnMed.addEventListener('click', () => applyPreset('medium'));
    btnHard.addEventListener('click', () => applyPreset('hard'));

    // Restore last selection if present; otherwise leave the current values.
    try {
      const saved = localStorage.getItem('rc_difficulty');
      if (saved && PRESETS[saved]) {
        applyPreset(saved);
      }
    } catch (_) {}
  })();

  
  // ===================================
