// server/lib/content-page-break-core.js
// Crown-jewel page-breaking logic — server-side only.
// Ported from the client-side chunkBlocksToPages algorithm so the tuned
// sentence-scoring and abbreviation-aware stop detection never ships to the
// browser bundle.

function toInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : fallback;
}

export function normalizePageSizeOption(pageSize) {
  const value = toInt(pageSize, 1600);
  if (value >= 1900) return 2000;
  if (value <= 1300) return 1200;
  return 1600;
}

function cleanBlockText(block) {
  return String(block || '').replace(/\s+/g, ' ').trim();
}

function looksLikeMajorHeading(text) {
  const t = cleanBlockText(text);
  if (!t) return false;
  if (t.length > 140) return false;
  if (/^[0-9]+$/.test(t)) return false;
  if (/[.!?]$/.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 14) return false;
  if (/^(chapter|part|section|appendix|introduction|conclusion|epilogue|prologue|preface|foreword|afterword|module)\b/i.test(t)) return true;
  const upperish = words.every((word) => {
    const letters = word.replace(/[^A-Za-z]/g, '');
    return !letters || letters === letters.toUpperCase();
  });
  return upperish && words.length <= 8;
}

function isListLine(text) {
  const t = String(text || '').trim();
  return /^[-*•]\s+/.test(t) || /^\d+[.)]\s+/.test(t);
}

// ─── Sentence-scoring page-break algorithm ─────────────────────────────��─────
// Ported from the tuned client-side chunker. All inner functions close over
// the per-call `target`, `minChars`, `softMax`, and `hardMax` values so they
// do not need to be passed around as parameters.

export function chunkBlocksToPages(blocks, { pageSize = 1600 } = {}) {
  const NOMINAL_PAGE = normalizePageSizeOption(pageSize);
  const totalChars = (blocks || []).reduce((s, b) => s + String(b || '').trim().length, 0);
  const pageCount = Math.max(1, Math.round(totalChars / NOMINAL_PAGE));
  const target = Math.max(400, Math.round(totalChars / pageCount));

  const minChars = Math.max(200, Math.round(target * 0.5));
  const softMax  = Math.round(target * 1.15);
  const hardMax  = Math.max(softMax + 300, Math.round(target * 2.0));

  const plainWordRe    = /^[A-Za-z]+(?:['\u2019][A-Za-z]+)?$/;
  const listLineRe     = /^\s*(?:\d+[.)]\s+|[-\u2022*]\s+)/i;
  const abbrevRe       = /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof|Rev|Hon|Sr|Jr|Capt|Maj|Lt|Sgt|Col|Gen|Cpl|Pvt|Cmdr|Cdr|Adm|Brig|Gov|Sen|Rep|Atty|Insp|Supt|Pres|St|Ave|Blvd|Rd|Ln|Ct|Sq|Dept|Est|Corp|Inc|Ltd|Co|Bros|Assn|Intl|etc|vs|approx|vol|chap|sec|no|art|fig|ed|trans|repr|rev|supp|pp|ibid|op|cf)\.\s*$/i;
  const initialChainRe = /(?:\b[A-Za-z]\.){2,}\s*$/;
  const singleInitialRe = /(?:^|\s)[A-Za-z]\.\s*$/;

  function norm(s)  { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function toks(s)  { return norm(s).split(' ').filter(Boolean); }
  function plainCount(arr) { return arr.filter(t => plainWordRe.test(t)).length; }
  function isListLineLocal(s) { return listLineRe.test(String(s || '').trim()); }

  function commaRate(sentence) {
    const words = toks(sentence).length;
    if (!words) return 0;
    return ((sentence.match(/[,;]/g) || []).length) / words;
  }

  // Collect valid hard-punctuation stops (. ? !) that are:
  //   - outside all block delimiters: () [] {} "" \u201c\u201d
  //   - not an abbreviation, initial chain, or lone initial
  function collectStops(text) {
    const t = String(text || '');
    const stops = [];
    let paren = 0, bracket = 0, brace = 0, straightQ = false, curlyQ = 0;

    for (let i = 0; i < t.length; i++) {
      const ch   = t[i];
      const prev = i > 0 ? t[i - 1] : '';

      if (ch === '"' && prev !== '\\') { straightQ = !straightQ;                  continue; }
      if (ch === '\u201C')             { curlyQ++;                                 continue; }
      if (ch === '\u201D')             { curlyQ = Math.max(0, curlyQ - 1);         continue; }
      if (ch === '(') { paren++;                              continue; }
      if (ch === ')') { paren   = Math.max(0, paren   - 1);  continue; }
      if (ch === '[') { bracket++;                            continue; }
      if (ch === ']') { bracket = Math.max(0, bracket - 1);  continue; }
      if (ch === '{') { brace++;                              continue; }
      if (ch === '}') { brace   = Math.max(0, brace   - 1);  continue; }

      if (paren || bracket || brace || straightQ || curlyQ) continue;
      if (ch !== '.' && ch !== '?' && ch !== '!') continue;

      // Skip dots that are part of a URL/domain (e.g. founders.archives.gov).
      if (ch === '.' && i + 1 < t.length && /[a-z]/.test(t[i + 1])) continue;

      const tail = t.slice(0, i + 1);
      if (abbrevRe.test(tail))                      continue;
      if (initialChainRe.test(tail))                continue;
      if (ch === '.' && singleInitialRe.test(tail)) continue;

      // Advance past trailing closers and whitespace to the cut point.
      let cut = i + 1;
      while (cut < t.length && /['\u2019"\u201D)\]}]/.test(t[cut])) cut++;
      while (cut < t.length && /\s/.test(t[cut])) cut++;

      stops.push({ punct: i, cut });
    }
    return stops;
  }

  // Score one candidate stop. Returns null if validation fails.
  function scoreStop(text, stop, allStops) {
    const { punct, cut } = stop;

    const preSlice  = norm(text.slice(Math.max(0, punct - 200), punct));
    const postSlice = norm(text.slice(cut, Math.min(text.length, cut + 200)));
    const preToks   = toks(preSlice);
    const postToks  = toks(postSlice);

    // Hard gate: 3 plain words must exist in each window.
    if (plainCount(preToks)  < 3) return null;
    if (plainCount(postToks) < 3) return null;

    // Hard gate: first token after cut must be a plain word.
    const firstPostToken = postToks[0] || '';
    if (!plainWordRe.test(firstPostToken)) return null;

    // Ending sentence — the sentence whose period closes this page.
    const prevStop    = [...allStops].reverse().find(s => s.cut <= Math.max(0, punct - 2));
    const sentStart   = prevStop ? prevStop.cut : 0;
    const endSentence = norm(text.slice(sentStart, punct));
    const endLen      = plainCount(toks(endSentence));
    const endCommaRate = commaRate(endSentence);

    // Starting sentence — the sentence that opens the next page.
    const nextStop      = allStops.find(s => s.punct > cut);
    const nextPunct     = nextStop ? nextStop.punct : Math.min(text.length, cut + 500);
    const startSentence = norm(text.slice(cut, nextPunct));
    const startLen      = plainCount(toks(startSentence));
    const startCommaRate = commaRate(startSentence);

    let score = 0;

    // Sentence shape scoring.
    // Ending page: ideal 14–22 words → peak reward = 30 pts.
    // Starting page: ideal 8–18 words → peak reward = 22 pts.
    const endIdeal = 18, endBand = 10;
    const strIdeal = 13, strBand = 8;
    score += Math.max(0, endBand - Math.abs(endLen   - endIdeal)) * 3.0;
    score += Math.max(0, strBand - Math.abs(startLen - strIdeal)) * 2.75;

    // Comma / semicolon density penalty.
    const endCommaExcess   = Math.max(0, endCommaRate   - 0.12);
    const startCommaExcess = Math.max(0, startCommaRate - 0.12);
    score -= endCommaExcess   * 120;
    score -= startCommaExcess * 100;

    // Last token before punct — non-plain token penalty.
    const lastPreToken = preToks[preToks.length - 1] || '';
    if (!plainWordRe.test(lastPreToken)) {
      if (/^\d+$/.test(lastPreToken)) return null; // pure digit: hard block
      score -= 60;
    }

    // Size proximity.
    const delta = cut - target;
    if (delta < 0) {
      score -= Math.abs(delta) / 40;
    } else {
      score -= delta / 15;
      score -= Math.max(0, delta - Math.round(target * 0.1)) / 5;
    }

    return { cut, score };
  }

  // Pick the best cut point using a two-pass window strategy.
  function chooseCut(text) {
    const t = String(text || '').trim();
    if (!t) return -1;

    const allStops = collectStops(t).filter(s => s.cut >= minChars);
    if (!allStops.length) return -1;

    // Pass 1: tight window (target ±30%). Consistency beats marginal quality
    // gains at extreme distances — a good stop here always wins.
    const windowLo   = Math.round(target * 0.7);
    const windowHi   = Math.round(target * 1.3);
    const tightStops = allStops.filter(s => s.cut >= windowLo && s.cut <= windowHi);
    const tightScored = tightStops.map(s => scoreStop(t, s, allStops)).filter(Boolean);
    if (tightScored.length) {
      tightScored.sort((a, b) => b.score - a.score || a.cut - b.cut);
      return tightScored[0].cut;
    }

    // Pass 2: full-range fallback — no scoreable stop in the tight window
    // (dense citations, form fields, vendor lists).
    const scored = allStops.map(s => scoreStop(t, s, allStops)).filter(Boolean);
    if (!scored.length) return -1;
    scored.sort((a, b) => b.score - a.score || a.cut - b.cut);
    return scored[0].cut;
  }

  // Find the paragraph boundary (\n\n) closest to `tgt` that is >= `min`.
  function nearestBlockBoundaryCut(text, tgt, min) {
    const re = /\n\n/g;
    let best = -1, bestDist = Infinity, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index < min) continue;
      const dist = Math.abs(m.index - tgt);
      if (dist < bestDist) { bestDist = dist; best = m.index + 2; }
    }
    return best;
  }

  const pagesOut = [];
  let buf = '';

  function flushBuffer(force = false) {
    let t = String(buf || '').trim();
    while (t) {
      if (!force && t.length <= softMax) break;
      const cut = chooseCut(t);
      if (cut < 0 || cut >= t.length) {
        if (force) {
          // No sentence stop found. Try a paragraph boundary near target so
          // list-dense content breaks gracefully.
          const bbCut = nearestBlockBoundaryCut(t, target, minChars);
          if (bbCut > 0 && bbCut < t.length) {
            pagesOut.push(t.slice(0, bbCut).trim());
            t = t.slice(bbCut).trim();
            continue;
          }
          pagesOut.push(t);
          t = '';
        }
        break;
      }
      pagesOut.push(t.slice(0, cut).trim());
      t = t.slice(cut).trim();
    }
    buf = t;
  }

  const cleanBlocks = (blocks || []).map(b => String(b || '').trim()).filter(Boolean);

  for (const block of cleanBlocks) {
    if (looksLikeMajorHeading(block) && buf.length >= minChars) {
      flushBuffer(true);
    }
    buf = buf ? `${buf}\n\n${block}` : block;
    flushBuffer(false);
    if (buf.length > hardMax) flushBuffer(true);
  }
  flushBuffer(true);

  // Absorb orphan pages (below minChars) into the preceding page.
  // absorbThreshold = target * 0.7 — same tuning as the original library.
  const merged = [];
  for (const p of pagesOut) {
    const page = String(p || '').trim();
    if (!page) continue;
    if (!merged.length) { merged.push(page); continue; }
    const prev     = merged[merged.length - 1];
    const combined = prev + '\n\n' + page;
    const absorbThreshold = Math.round(target * 0.7);
    if (page.length < absorbThreshold && combined.length <= hardMax && !isListLineLocal(page)) {
      merged[merged.length - 1] = combined.trim();
    } else {
      merged.push(page);
    }
  }
  return merged;
}

// ─── Document-page-marker helpers ──────────────────────────────────��─────────

function parseDocumentPageMarker(block) {
  const raw = String(block || '').replace(/\r\n?/g, '\n').trim();
  if (!raw) return null;
  const match = raw.match(/^(?:##\s*)?(?:page|p\.)\s*(\d{1,4})(?:\b|\s*[:\-–—])([\s\S]*)$/i);
  if (!match) return null;
  const pageNumber = Number(match[1]);
  if (!Number.isFinite(pageNumber) || pageNumber <= 0) return null;
  // Reject "Page N of M" patterns — these are running headers, not real markers.
  const remainder = cleanBlockText(match[2] || '');
  if (/^\s*of\s+\d/i.test(match[2])) return null;
  return { pageNumber, remainder };
}

function splitBlocksByDocumentPageMarkers(blocks) {
  const cleanBlocks = (blocks || [])
    .map((block) => String(block || '').replace(/\r\n?/g, '\n'))
    .filter((block) => cleanBlockText(block));
  const pages = [];
  let current = null;

  function flushCurrent() {
    if (!current) return;
    const text = cleanBlockText(current.text || '');
    if (text) pages.push({ sourcePageNumber: current.sourcePageNumber, text });
    current = null;
  }

  for (const block of cleanBlocks) {
    const marker = parseDocumentPageMarker(block);
    if (marker) {
      flushCurrent();
      current = { sourcePageNumber: marker.pageNumber, text: marker.remainder || '' };
      continue;
    }
    if (!current) continue;
    current.text = current.text ? `${current.text}\n\n${block}` : block;
  }

  flushCurrent();
  return pages;
}

function sanitizeSectionTitle(title, fallbackIndex) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim();
  return clean || `Section ${fallbackIndex + 1}`;
}

export function buildMarkdownBookFromSections(sections, { pageSize = 1600, breakByPageNumber = true } = {}) {
  const out = [];
  const flatPages = [];
  let nextPageNumber = 1;

  (sections || []).forEach((sec, sectionIndex) => {
    const title = sanitizeSectionTitle(sec?.title, sectionIndex);
    out.push(`# ${title}`);
    out.push('');

    const explicitPages = breakByPageNumber ? splitBlocksByDocumentPageMarkers(sec?.blocks || []) : [];
    const pages = explicitPages.length
      ? explicitPages.map((page) => ({
          assigned: Number(page.sourcePageNumber),
          text: String(page.text || '').trim(),
        }))
      : chunkBlocksToPages(sec?.blocks || [], { pageSize }).map((pageText, pageIndex) => ({
          assigned: breakByPageNumber ? nextPageNumber + pageIndex : (pageIndex + 1),
          text: String(pageText || '').trim(),
        }));

    pages.forEach((page) => {
      const assigned = Number(page.assigned);
      const pageText = String(page.text || '').trim();
      if (!Number.isFinite(assigned) || assigned <= 0 || !pageText) return;
      out.push(`## Page ${assigned}`);
      out.push('');
      out.push(pageText);
      out.push('');
      flatPages.push({
        sectionTitle: title,
        sourcePageNumber: assigned,
        text: pageText,
      });
    });

    if (breakByPageNumber && explicitPages.length) {
      const lastExplicit = explicitPages[explicitPages.length - 1];
      const lastNumber = Number(lastExplicit?.sourcePageNumber);
      if (Number.isFinite(lastNumber) && lastNumber >= nextPageNumber) nextPageNumber = lastNumber + 1;
    } else {
      nextPageNumber += pages.length;
    }

    out.push('');
  });

  return {
    markdown: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    pages: flatPages,
    pageCount: flatPages.length,
    breakByPageNumber: !!breakByPageNumber,
  };
}

export function splitRawTextToPages(raw, { pageSize = 1600, breakByPageNumber = true } = {}) {
  const input = String(raw || '').replace(/\r\n?/g, '\n').trim();
  if (!input) return { pages: [], pageCount: 0, markdown: '', breakByPageNumber: !!breakByPageNumber };

  if (breakByPageNumber) {
    const explicitMarkdownPages = [];
    const explicitRegex = /^\s*##\s*Page\s+(\d+)\s*$\n?([\s\S]*?)(?=^\s*##\s*Page\s+\d+\s*$|$)/gim;
    let match = explicitRegex.exec(input);
    while (match) {
      const pageNumber = Number(match[1]);
      const text = cleanBlockText(match[2] || '');
      if (Number.isFinite(pageNumber) && pageNumber > 0 && text) {
        explicitMarkdownPages.push({ sourcePageNumber: pageNumber, text });
      }
      match = explicitRegex.exec(input);
    }
    if (explicitMarkdownPages.length) {
      const out = [];
      explicitMarkdownPages.forEach((page) => {
        out.push('# Imported Text');
        out.push('');
        out.push(`## Page ${page.sourcePageNumber}`);
        out.push('');
        out.push(page.text);
        out.push('');
      });
      return {
        markdown: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
        pages: explicitMarkdownPages.map((page) => ({
          sectionTitle: 'Imported Text',
          sourcePageNumber: page.sourcePageNumber,
          text: page.text,
        })),
        pageCount: explicitMarkdownPages.length,
        breakByPageNumber: true,
      };
    }
  }

  const normalized = input.replace(/^\s*##\s*Page\s+\d+.*$/gim, '\n\n---\n\n');
  const hardChunks = normalized.split(/\n\s*---\s*\n/g).map((chunk) => String(chunk || '').trim()).filter(Boolean);
  const logicalSections = hardChunks.length ? hardChunks : [normalized];
  const sections = logicalSections.map((chunk, index) => {
    const blocks = chunk
      .split(/\n\s*\n+/g)
      .map((part) => cleanBlockText(part))
      .filter(Boolean);
    return { title: `Section ${index + 1}`, blocks };
  });
  return buildMarkdownBookFromSections(sections, { pageSize, breakByPageNumber });
}
