function cleanBlockText(block) {
  return String(block || '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeSectionTitle(title, fallbackIndex) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim();
  return clean || `Section ${fallbackIndex + 1}`;
}

function parseExplicitPageMarker(block) {
  const raw = String(block || '').replace(/\r\n?/g, '\n').trim();
  if (!raw) return null;
  const match = raw.match(/^(?:##\s*)?page\s+(\d+)\s*$/i);
  if (!match) return null;
  const pageNumber = Number(match[1]);
  // Reject implausibly large numbers (OCR/conversion artifacts e.g. Page 15642).
  return Number.isFinite(pageNumber) && pageNumber > 0 && pageNumber <= 9999 ? pageNumber : null;
}

function stripMarkerBlocks(blocks) {
  const textBlocks = [];
  const markerEvents = [];
  let joined = '';
  let pendingMarker = null;

  for (const rawBlock of (blocks || [])) {
    const marker = parseExplicitPageMarker(rawBlock);
    if (Number.isFinite(marker)) {
      pendingMarker = marker;
      continue;
    }
    const block = String(rawBlock || '').trim();
    if (!block) continue;
    const blockStart = joined ? (joined.length + 2) : 0;
    if (pendingMarker != null) {
      markerEvents.push({ offset: blockStart, pageNumber: pendingMarker });
      pendingMarker = null;
    }
    textBlocks.push(block);
    joined = joined ? `${joined}\n\n${block}` : block;
  }

  return { textBlocks, markerEvents, joinedText: joined };
}

function resolvePageNumberForOffset(markerEvents, startOffset, fallbackNumber) {
  const fallback = Number.isFinite(Number(fallbackNumber)) ? Number(fallbackNumber) : null;
  let resolved = fallback;
  for (const event of (markerEvents || [])) {
    const offset = Number(event?.offset);
    const pageNumber = Number(event?.pageNumber);
    if (!Number.isFinite(offset) || !Number.isFinite(pageNumber) || pageNumber <= 0) continue;
    if (offset <= startOffset) resolved = pageNumber;
    else break;
  }
  return Number.isFinite(resolved) && resolved > 0 ? Math.round(resolved) : null;
}

function looksLikeMajorHeading(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return false;
  if (s.length > 140) return false;
  if (/^(participants?|sample|checklist|transcript|question\s+\d+|tips?)\b/i.test(s)) return false;
  if (/:$/.test(s) && !/^(module\s+\d+|appendix\s+[a-z]|case study|introduction|overview|glossary|references|bibliography|notes)\b/i.test(s)) return false;
  if (/^(module\s+\d+\b|appendix\s+[a-z]\b|introduction\b|case study\b|overview\b|glossary\b|references\b|bibliography\b|notes\b|acknowledg)/i.test(s)) return true;
  if (/^[A-Z][A-Za-z0-9'’\-]*(?:\s+[A-Z][A-Za-z0-9'’\-]*){1,8}$/.test(s) && !/[.!?]$/.test(s)) return true;
  return false;
}

export function chunkBlocksToPages(blocks) {
  const pagesOut = [];

  const NOMINAL_PAGE = 1600;
  const totalChars = (blocks || []).reduce((s, b) => s + String(b || '').trim().length, 0);
  const pageCount = Math.max(1, Math.round(totalChars / NOMINAL_PAGE));
  const target = Math.max(400, Math.round(totalChars / pageCount));

  const minChars = Math.max(200, Math.round(target * 0.5));
  const softMax = Math.round(target * 1.15);
  const hardMax = Math.max(softMax + 300, Math.round(target * 2.0));

  const plainWordRe = /^[A-Za-z]+(?:['\u2019][A-Za-z]+)?$/;
  const listLineRe = /^\s*(?:\d+[.)]\s+|[-\u2022*]\s+)/i;

  const abbrevRe = /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof|Rev|Hon|Sr|Jr|Capt|Maj|Lt|Sgt|Col|Gen|Cpl|Pvt|Cmdr|Cdr|Adm|Brig|Gov|Sen|Rep|Atty|Insp|Supt|Pres|St|Ave|Blvd|Rd|Ln|Ct|Sq|Dept|Est|Corp|Inc|Ltd|Co|Bros|Assn|Intl|etc|vs|approx|vol|chap|sec|no|art|fig|ed|trans|repr|rev|supp|pp|ibid|op|cf)\.\s*$/i;
  const initialChainRe = /(?:\b[A-Za-z]\.){2,}\s*$/;
  const singleInitialRe = /(?:^|\s)[A-Za-z]\.\s*$/;

  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function toks(s) { return norm(s).split(' ').filter(Boolean); }
  function plainCount(arr) { return arr.filter(t => plainWordRe.test(t)).length; }
  function isListLine(s) { return listLineRe.test(String(s || '').trim()); }

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
      const ch = t[i];
      const prev = i > 0 ? t[i - 1] : '';

      if (ch === '"' && prev !== '\\') { straightQ = !straightQ; continue; }
      if (ch === '\u201C') { curlyQ++; continue; }
      if (ch === '\u201D') { curlyQ = Math.max(0, curlyQ - 1); continue; }
      if (ch === '(') { paren++; continue; }
      if (ch === ')') { paren = Math.max(0, paren - 1); continue; }
      if (ch === '[') { bracket++; continue; }
      if (ch === ']') { bracket = Math.max(0, bracket - 1); continue; }
      if (ch === '{') { brace++; continue; }
      if (ch === '}') { brace = Math.max(0, brace - 1); continue; }

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

    const preSlice = norm(text.slice(Math.max(0, punct - 200), punct));
    const postSlice = norm(text.slice(cut, Math.min(text.length, cut + 200)));
    const preToks = toks(preSlice);
    const postToks = toks(postSlice);

    if (plainCount(preToks) < 3) return null;
    if (plainCount(postToks) < 3) return null;

    const firstPostToken = postToks[0] || '';
    if (!plainWordRe.test(firstPostToken)) return null;

    const prevStop = [...allStops].reverse().find(s => s.cut <= Math.max(0, punct - 2));
    const sentStart = prevStop ? prevStop.cut : 0;
    const endSentence = norm(text.slice(sentStart, punct));
    const endLen = plainCount(toks(endSentence));
    const endCommaRate = commaRate(endSentence);

    const nextStop = allStops.find(s => s.punct > cut);
    const nextPunct = nextStop ? nextStop.punct : Math.min(text.length, cut + 500);
    const startSentence = norm(text.slice(cut, nextPunct));
    const startLen = plainCount(toks(startSentence));
    const startCommaRate = commaRate(startSentence);

    let score = 0;

    const endIdeal = 18, endBand = 10;
    const strIdeal = 13, strBand = 8;
    score += Math.max(0, endBand - Math.abs(endLen - endIdeal)) * 3.0;
    score += Math.max(0, strBand - Math.abs(startLen - strIdeal)) * 2.75;

    const endCommaExcess = Math.max(0, endCommaRate - 0.12);
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

function buildSectionPages(sectionBlocks, { breakByPageNumber = true, fallbackStart = 1 } = {}) {
  const { textBlocks, markerEvents, joinedText } = stripMarkerBlocks(sectionBlocks);
  const chunked = chunkBlocksToPages(textBlocks);
  const pages = [];
  let searchStart = 0;
  let fallback = Number.isFinite(Number(fallbackStart)) ? Number(fallbackStart) : 1;

  for (const pageText of chunked) {
    const text = String(pageText || '').trim();
    if (!text) continue;
    let startOffset = joinedText.indexOf(text, Math.max(0, searchStart - 4));
    if (startOffset < 0) {
      const prefixTokens = text.split(/\s+/).filter(Boolean).slice(0, 12);
      if (prefixTokens.length) {
        const pattern = new RegExp(prefixTokens.map(escapeRegExp).join('\\s+'));
        const windowStart = Math.max(0, searchStart - 24);
        const match = pattern.exec(joinedText.slice(windowStart));
        if (match) startOffset = windowStart + match.index;
      }
    }
    if (startOffset < 0) startOffset = searchStart;
    let assigned = null;
    if (breakByPageNumber && markerEvents.length) {
      assigned = resolvePageNumberForOffset(markerEvents, startOffset, null);
    }
    if (!Number.isFinite(assigned) || assigned <= 0) assigned = fallback;
    pages.push({ sourcePageNumber: Math.round(assigned), text });
    searchStart = startOffset + text.length;
    fallback = Math.max(fallback + 1, Math.round(assigned) + 1);
  }

  return pages;
}

export function buildMarkdownBookFromSections(sections, { breakByPageNumber = true } = {}) {
  const out = [];
  const flatPages = [];
  let fallbackPageNumber = 1;

  (sections || []).forEach((sec, sectionIndex) => {
    const title = sanitizeSectionTitle(sec?.title, sectionIndex);
    out.push(`# ${title}`);
    out.push('');

    const pages = buildSectionPages(Array.isArray(sec?.blocks) ? sec.blocks : [], {
      breakByPageNumber,
      fallbackStart: fallbackPageNumber,
    });

    pages.forEach((page) => {
      const assigned = Number(page.sourcePageNumber);
      const pageText = String(page.text || '').trim();
      if (!Number.isFinite(assigned) || assigned <= 0 || !pageText) return;
      out.push(`## Page ${assigned}`);
      out.push('');
      out.push(pageText);
      out.push('');
      flatPages.push({ sectionTitle: title, sourcePageNumber: assigned, text: pageText });
      fallbackPageNumber = Math.max(fallbackPageNumber, assigned + 1);
    });

    out.push('');
  });

  return {
    markdown: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    pages: flatPages,
    pageCount: flatPages.length,
    breakByPageNumber: !!breakByPageNumber,
  };
}

export function splitRawTextToPages(raw, { breakByPageNumber = true } = {}) {
  let input = String(raw || '').replace(/\r\n?/g, '\n').trim();
  if (!input) return { pages: [], pageCount: 0, markdown: '', breakByPageNumber: !!breakByPageNumber };

  const hardChunks = input.split(/\n\s*---\s*\n/g);
  const sections = [];

  for (let i = 0; i < hardChunks.length; i++) {
    const chunk = String(hardChunks[i] || '').trim();
    if (!chunk) continue;
    const blocks = chunk
      .split(/\n\s*\n+/g)
      .map((part) => String(part || '').trim())
      .filter(Boolean);
    sections.push({ title: `Section ${sections.length + 1}`, blocks });
  }

  if (!sections.length) {
    sections.push({ title: 'Section 1', blocks: [input] });
  }

  return buildMarkdownBookFromSections(sections, { breakByPageNumber });
}
