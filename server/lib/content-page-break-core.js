function looksLikeMajorHeading(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
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

export function chunkBlocksToPages(blocks) {
  const pagesOut = [];

  const NOMINAL_PAGE = 1600;
  const totalChars   = (blocks || []).reduce((s, b) => s + String(b || '').trim().length, 0);
  const pageCount    = Math.max(1, Math.round(totalChars / NOMINAL_PAGE));
  const target       = Math.max(400, Math.round(totalChars / pageCount));

  const minChars = Math.max(200, Math.round(target * 0.5));
  const softMax  = Math.round(target * 1.15);
  const hardMax  = Math.max(softMax + 300, Math.round(target * 2.0));

  const plainWordRe = /^[A-Za-z]+(?:['\u2019][A-Za-z]+)?$/;
  const listLineRe  = /^\s*(?:\d+[.)]\s+|[-\u2022*]\s+)/i;
  const abbrevRe = /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof|Rev|Hon|Sr|Jr|Capt|Maj|Lt|Sgt|Col|Gen|Cpl|Pvt|Cmdr|Cdr|Adm|Brig|Gov|Sen|Rep|Atty|Insp|Supt|Pres|St|Ave|Blvd|Rd|Ln|Ct|Sq|Dept|Est|Corp|Inc|Ltd|Co|Bros|Assn|Intl|etc|vs|approx|vol|chap|sec|no|art|fig|ed|trans|repr|rev|supp|pp|ibid|op|cf)\.\s*$/i;
  const initialChainRe  = /(?:\b[A-Za-z]\.){2,}\s*$/;
  const singleInitialRe = /(?:^|\s)[A-Za-z]\.\s*$/;

  function norm(s)  { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function toks(s)  { return norm(s).split(' ').filter(Boolean); }
  function plainCount(arr) { return arr.filter(t => plainWordRe.test(t)).length; }
  function isListLine(s)   { return listLineRe.test(String(s || '').trim()); }

  function commaRate(sentence) {
    const words = toks(sentence).length;
    if (!words) return 0;
    return ((sentence.match(/[,;]/g) || []).length) / words;
  }

  function collectStops(text) {
    const t = String(text || '');
    const stops = [];
    let paren = 0, bracket = 0, brace = 0, straightQ = false, curlyQ = 0;

    for (let i = 0; i < t.length; i++) {
      const ch   = t[i];
      const prev = i > 0 ? t[i - 1] : '';

      if (ch === '"' && prev !== '\\') { straightQ = !straightQ; continue; }
      if (ch === '\u201C')             { curlyQ++; continue; }
      if (ch === '\u201D')             { curlyQ = Math.max(0, curlyQ - 1); continue; }
      if (ch === '(') { paren++; continue; }
      if (ch === ')') { paren   = Math.max(0, paren   - 1); continue; }
      if (ch === '[') { bracket++; continue; }
      if (ch === ']') { bracket = Math.max(0, bracket - 1); continue; }
      if (ch === '{') { brace++; continue; }
      if (ch === '}') { brace   = Math.max(0, brace   - 1); continue; }

      if (paren || bracket || brace || straightQ || curlyQ) continue;
      if (ch !== '.' && ch !== '?' && ch !== '!') continue;
      if (ch === '.' && i + 1 < t.length && /[a-z]/.test(t[i + 1])) continue;

      const tail = t.slice(0, i + 1);
      if (abbrevRe.test(tail)) continue;
      if (initialChainRe.test(tail)) continue;
      if (ch === '.' && singleInitialRe.test(tail)) continue;

      let cut = i + 1;
      while (cut < t.length && /['\u2019"\u201D)\]}]/.test(t[cut])) cut++;
      while (cut < t.length && /\s/.test(t[cut])) cut++;
      stops.push({ punct: i, cut });
    }
    return stops;
  }

  function scoreStop(text, stop, allStops) {
    const { punct, cut } = stop;
    const preSlice  = norm(text.slice(Math.max(0, punct - 200), punct));
    const postSlice = norm(text.slice(cut, Math.min(text.length, cut + 200)));
    const preToks   = toks(preSlice);
    const postToks  = toks(postSlice);

    if (plainCount(preToks)  < 3) return null;
    if (plainCount(postToks) < 3) return null;
    const firstPostToken = postToks[0] || '';
    if (!plainWordRe.test(firstPostToken)) return null;

    const prevStop      = [...allStops].reverse().find(s => s.cut <= Math.max(0, punct - 2));
    const sentStart     = prevStop ? prevStop.cut : 0;
    const endSentence   = norm(text.slice(sentStart, punct));
    const endLen        = plainCount(toks(endSentence));
    const endCommaRate  = commaRate(endSentence);

    const nextStop      = allStops.find(s => s.punct > cut);
    const nextPunct     = nextStop ? nextStop.punct : Math.min(text.length, cut + 500);
    const startSentence = norm(text.slice(cut, nextPunct));
    const startLen      = plainCount(toks(startSentence));
    const startCommaRate = commaRate(startSentence);

    let score = 0;
    const endIdeal = 18,  endBand = 10;
    const strIdeal = 13,  strBand = 8;
    score += Math.max(0, endBand - Math.abs(endLen - endIdeal)) * 3.0;
    score += Math.max(0, strBand - Math.abs(startLen - strIdeal)) * 2.75;

    const endCommaExcess   = Math.max(0, endCommaRate   - 0.12);
    const startCommaExcess = Math.max(0, startCommaRate - 0.12);
    score -= endCommaExcess * 120;
    score -= startCommaExcess * 100;

    const lastPreToken = preToks[preToks.length - 1] || '';
    if (!plainWordRe.test(lastPreToken)) {
      if (/^\d+$/.test(lastPreToken)) return null;
      score -= 60;
    }

    const delta = cut - target;
    if (delta < 0) {
      score -= Math.abs(delta) / 40;
    } else {
      score -= delta / 15;
      score -= Math.max(0, delta - Math.round(target * 0.1)) / 5;
    }

    return { cut, score };
  }

  function chooseCut(text) {
    const t = String(text || '').trim();
    if (!t) return -1;

    const allStops = collectStops(t).filter(s => s.cut >= minChars);
    if (!allStops.length) return -1;

    const windowLo = Math.round(target * 0.7);
    const windowHi = Math.round(target * 1.3);
    const tightStops = allStops.filter(s => s.cut >= windowLo && s.cut <= windowHi);
    const tightScored = tightStops.map(s => scoreStop(t, s, allStops)).filter(Boolean);
    if (tightScored.length) {
      tightScored.sort((a, b) => b.score - a.score || a.cut - b.cut);
      return tightScored[0].cut;
    }

    const scored = allStops.map(s => scoreStop(t, s, allStops)).filter(Boolean);
    if (!scored.length) return -1;
    scored.sort((a, b) => b.score - a.score || a.cut - b.cut);
    return scored[0].cut;
  }

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

  function flushBuffer(force = false) {
    let t = String(buf || '').trim();
    while (t) {
      if (!force && t.length <= softMax) break;
      const cut = chooseCut(t);
      if (cut < 0 || cut >= t.length) {
        if (force) {
          const bbCut = nearestBlockBoundaryCut(t, target, minChars);
          if (bbCut > 0 && bbCut < t.length) {
            pagesOut.push(t.slice(0, bbCut).trim());
            t = t.slice(bbCut).trim();
            continue;
          }
          pagesOut.push(t); t = '';
        }
        break;
      }
      pagesOut.push(t.slice(0, cut).trim());
      t = t.slice(cut).trim();
    }
    buf = t;
  }

  const cleanBlocks = (blocks || []).map(b => String(b || '').trim()).filter(Boolean);
  let buf = '';

  for (const block of cleanBlocks) {
    if (looksLikeMajorHeading(block) && buf.length >= minChars) {
      flushBuffer(true);
    }
    buf = buf ? `${buf}\n\n${block}` : block;
    flushBuffer(false);
    if (buf.length > hardMax) flushBuffer(true);
  }

  flushBuffer(true);

  const merged = [];
  for (const p of pagesOut) {
    const page = String(p || '').trim();
    if (!page) continue;
    if (!merged.length) { merged.push(page); continue; }
    const prev = merged[merged.length - 1];
    const combined = prev + '\n\n' + page;
    const absorbThreshold = Math.round(target * 0.7);
    if (page.length < absorbThreshold && combined.length <= hardMax && !isListLine(page)) {
      merged[merged.length - 1] = combined.trim();
    } else {
      merged.push(page);
    }
  }
  return merged;
}


const RC_PAGE_MARKER_RE = /^\[\[RC_PAGE:(\d{1,5})\]\]$/;

function parseRcPageMarker(text) {
  const match = String(text || '').trim().match(RC_PAGE_MARKER_RE);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : null;
}

function stripMarkerBlocks(blocks) {
  const cleanBlocks = [];
  const markers = [];
  let charOffset = 0;
  let pendingMarker = null;

  for (const rawBlock of (blocks || [])) {
    const block = String(rawBlock || '').trim();
    if (!block) continue;
    const markerNum = parseRcPageMarker(block);
    if (Number.isFinite(markerNum)) {
      pendingMarker = markerNum;
      continue;
    }
    if (Number.isFinite(pendingMarker)) {
      markers.push({ offset: charOffset, pageNumber: pendingMarker });
      pendingMarker = null;
    }
    if (cleanBlocks.length) charOffset += 2;
    cleanBlocks.push(block);
    charOffset += block.length;
  }

  return { cleanBlocks, markers, fullText: cleanBlocks.join('\n\n') };
}

function assignSourcePageMeta(pageTexts, fullText, markers, useSourceNumbers) {
  const text = String(fullText || '');
  let searchPos = 0;
  let markerIdx = 0;
  let activePageNumber = null;

  return (pageTexts || []).map((pageText, idx) => {
    const page = String(pageText || '').trim();
    let start = text.indexOf(page, searchPos);
    if (start < 0) start = searchPos;
    while (markerIdx < markers.length && Number(markers[markerIdx].offset) <= start) {
      activePageNumber = Number(markers[markerIdx].pageNumber);
      markerIdx += 1;
    }
    const fallback = idx + 1;
    const sourcePageNumber = useSourceNumbers && Number.isFinite(activePageNumber) && activePageNumber > 0
      ? activePageNumber
      : fallback;
    searchPos = Math.max(searchPos, start + page.length);
    return { title: `Page ${fallback}`, sourcePageNumber };
  });
}

export function buildMarkdownBookFromSections(sections, options = {}) {
  const useSourceNumbers = !!options?.breakByPageNumber;
  const out = [];
  const pageMeta = [];
  (sections || []).forEach((sec) => {
    const title = String(sec?.title || 'Untitled Section').trim();
    out.push(`# ${title}`);
    out.push('');
    const { cleanBlocks, markers, fullText } = stripMarkerBlocks(sec?.blocks || []);
    const pages = chunkBlocksToPages(cleanBlocks);
    const sectionMeta = assignSourcePageMeta(pages, fullText, markers, useSourceNumbers);
    pages.forEach((page, idx) => {
      out.push(`## Page ${idx + 1}`);
      out.push('');
      out.push(page);
      out.push('');
      pageMeta.push(sectionMeta[idx] || { title: `Page ${idx + 1}`, sourcePageNumber: idx + 1 });
    });
    out.push('');
  });
  return {
    markdown: out.join('\n'),
    pageMeta,
    pageCount: pageMeta.length,
  };
}
