function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : []).map((entry) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const text = normalizeText(entry.text);
      const rawPage = Number(entry.sourcePageNumber);
      return {
        text,
        sourcePageNumber: Number.isFinite(rawPage) && rawPage > 0 ? Math.round(rawPage) : null,
      };
    }
    return { text: normalizeText(entry), sourcePageNumber: null };
  }).filter((entry) => entry.text);
}

function normalizeTocLabel(text) {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(/[–—]/g, ' - ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/\s+(?:\d+[\d,\-– ]*|[ivxlcdm]+)\s*$/i, '').trim();
  s = s.replace(/\s*\.+\s*(?:\d+[\d,\-– ]*|[ivxlcdm]+)\s*$/i, '').trim();
  return s;
}

function looksLikeMajorHeading(text) {
  const s = normalizeTocLabel(text);
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
  const cleanBlocks = normalizeBlocks(blocks).map((entry) => entry.text).filter(Boolean);

  const NOMINAL_PAGE = 1600;
  const totalChars   = cleanBlocks.reduce((s, b) => s + String(b || '').trim().length, 0);
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
      if (ch === ')') { paren = Math.max(0, paren - 1); continue; }
      if (ch === '[') { bracket++; continue; }
      if (ch === ']') { bracket = Math.max(0, bracket - 1); continue; }
      if (ch === '{') { brace++; continue; }
      if (ch === '}') { brace = Math.max(0, brace - 1); continue; }

      if (paren || bracket || brace || straightQ || curlyQ) continue;
      if (ch !== '.' && ch !== '?' && ch !== '!') continue;
      const left = t.slice(Math.max(0, i - 18), i + 1);
      if (ch === '.' && (abbrevRe.test(left) || initialChainRe.test(left) || singleInitialRe.test(left))) continue;
      stops.push(i + 1);
    }
    return stops;
  }

  function nearestBlockBoundaryCut(text, targetLen, minLen) {
    const t = String(text || '');
    let best = -1;
    let bestDist = Infinity;
    const re = /\n\n/g;
    let m;
    while ((m = re.exec(t))) {
      const cut = m.index + m[0].length;
      if (cut < minLen) continue;
      const d = Math.abs(cut - targetLen);
      if (d < bestDist) {
        bestDist = d;
        best = cut;
      }
    }
    return best;
  }

  function chooseSentenceCut(text, targetLen, minLen) {
    const t = String(text || '').trim();
    if (!t) return -1;
    const stops = collectStops(t).filter(c => c >= minLen);
    if (!stops.length) return -1;
    let best = -1;
    let bestScore = -Infinity;
    for (const cut of stops) {
      const before = toks(t.slice(Math.max(0, cut - 180), cut));
      const after  = toks(t.slice(cut, Math.min(t.length, cut + 180)));
      const plainBefore = plainCount(before);
      const plainAfter  = plainCount(after);
      if (plainBefore < 3) continue;
      const endsSentence = /[.!?]["”')\]]*\s*$/.test(t.slice(0, cut));
      const afterStr = t.slice(cut).trim();
      const startLooksWeak = /^[a-z]|^[,;:]|^[-\u2022*]|^\d+[.)]\s+/.test(afterStr);
      let score = 0;
      score -= Math.abs(cut - targetLen);
      if (cut >= Math.round(targetLen * 0.85)) score += 120;
      if (plainAfter < 3) score -= 220;
      if (commaRate(t.slice(0, cut)) > 0.12) score -= 90;
      if (!endsSentence) score -= 60;
      if (startLooksWeak || isListLine(afterStr)) score -= 160;
      if (score > bestScore) {
        bestScore = score;
        best = cut;
      }
    }
    return best;
  }

  function flushBuffer(force, bufValue) {
    let t = String(bufValue || '').trim();
    if (!t) return '';
    while (t.length > target) {
      let cut = chooseSentenceCut(t, target, minChars);
      if (cut <= 0 || cut >= t.length) {
        cut = nearestBlockBoundaryCut(t, target, minChars);
        if (cut <= 0 || cut >= t.length) {
          if (!force && t.length <= hardMax) break;
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
    if (force && t) {
      pagesOut.push(t);
      return '';
    }
    return t;
  }

  let buf = '';
  for (const block of cleanBlocks) {
    if (looksLikeMajorHeading(block) && buf.length >= minChars) {
      buf = flushBuffer(true, buf);
    }
    buf = buf ? `${buf}\n\n${block}` : block;
    buf = flushBuffer(false, buf);
    if (buf.length > hardMax) buf = flushBuffer(true, buf);
  }
  flushBuffer(true, buf);

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

function assignSourceNumbersToPages(blocks, pagesOut) {
  const items = normalizeBlocks(blocks);
  if (!items.length) return pagesOut.map((_, idx) => ({ sourcePageNumber: idx + 1 }));

  let itemIndex = 0;
  let itemOffset = 0;

  const consumeFromItems = (charCount) => {
    let remaining = Math.max(0, Number(charCount) || 0);
    let firstSource = null;
    while (remaining > 0 && itemIndex < items.length) {
      const item = items[itemIndex];
      const available = Math.max(0, item.text.length - itemOffset);
      if (available === 0) {
        itemIndex += 1;
        itemOffset = 0;
        if (remaining >= 2) remaining -= 2;
        continue;
      }
      if (firstSource == null && Number.isFinite(Number(item.sourcePageNumber))) {
        firstSource = Number(item.sourcePageNumber);
      }
      const take = Math.min(available, remaining);
      itemOffset += take;
      remaining -= take;
      if (itemOffset >= item.text.length) {
        itemIndex += 1;
        itemOffset = 0;
        if (remaining >= 2) remaining -= 2;
      }
    }
    return firstSource;
  };

  let lastSeen = null;
  return pagesOut.map((pageText, idx) => {
    const assigned = consumeFromItems(String(pageText || '').length);
    if (Number.isFinite(Number(assigned)) && assigned > 0) lastSeen = Math.round(Number(assigned));
    return { sourcePageNumber: lastSeen || (idx + 1) };
  });
}

export function buildMarkdownBookFromSections(sections, { breakByPageNumber = false } = {}) {
  const out = [];
  const pageMeta = [];
  (Array.isArray(sections) ? sections : []).forEach((section, sectionIndex) => {
    const title = normalizeText(section && section.title) || `Section ${sectionIndex + 1}`;
    out.push(`# ${title}`);
    out.push('');
    const blocks = Array.isArray(section && section.blocks) ? section.blocks : [];
    const pages = chunkBlocksToPages(blocks);
    const assignedMeta = breakByPageNumber
      ? assignSourceNumbersToPages(blocks, pages)
      : pages.map((_, idx) => ({ sourcePageNumber: idx + 1 }));
    pages.forEach((pageText, pageIndex) => {
      const displayNumber = pageIndex + 1;
      out.push(`## Page ${displayNumber}`);
      out.push('');
      out.push(pageText);
      out.push('');
      pageMeta.push({
        title: `Page ${displayNumber}`,
        sourcePageNumber: Number.isFinite(Number(assignedMeta[pageIndex] && assignedMeta[pageIndex].sourcePageNumber))
          ? Number(assignedMeta[pageIndex].sourcePageNumber)
          : displayNumber,
      });
    });
    out.push('');
  });
  return { markdown: out.join('\n'), pageMeta };
}
