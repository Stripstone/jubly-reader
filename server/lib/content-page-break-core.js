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

function nearestSentenceCut(text, startIndex, minChars) {
  const t = String(text || '').trim();
  if (!t) return -1;
  const minIndex = Math.max(0, minChars || 0);
  const from = Math.max(minIndex, Math.min(t.length - 1, startIndex || 0));
  const punct = /[.!?]["')\]]?\s+/g;
  punct.lastIndex = from;
  let match = punct.exec(t);
  if (!match) {
    punct.lastIndex = 0;
    while ((match = punct.exec(t))) {
      const cut = punct.lastIndex;
      if (cut >= minIndex) return cut;
    }
    return -1;
  }
  return punct.lastIndex;
}

export function chunkBlocksToPages(blocks, { pageSize = 1600 } = {}) {
  const target = normalizePageSizeOption(pageSize);
  const minChars = Math.max(500, Math.round(target * 0.55));
  const hardMax = Math.max(target + 650, Math.round(target * 1.45));
  const pagesOut = [];

  function flushBuffer(force, bufValue) {
    let t = String(bufValue || '').trim();
    if (!t) return '';
    while (t.length > target) {
      let cut = nearestSentenceCut(t, target, minChars);
      if (!Number.isFinite(cut) || cut <= 0 || cut >= t.length) {
        cut = t.lastIndexOf(' ', Math.min(t.length - 1, target));
      }
      if (!Number.isFinite(cut) || cut <= 0 || cut >= t.length) {
        if (!force && t.length <= hardMax) break;
        pagesOut.push(t);
        return '';
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

  const cleanBlocks = (blocks || []).map(cleanBlockText).filter(Boolean);
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
  for (const page of pagesOut) {
    const text = cleanBlockText(page);
    if (!text) continue;
    if (!merged.length) {
      merged.push(text);
      continue;
    }
    const combined = `${merged[merged.length - 1]}\n\n${text}`.trim();
    const absorbThreshold = Math.round(target * 0.7);
    if (text.length < absorbThreshold && combined.length <= hardMax && !isListLine(text)) {
      merged[merged.length - 1] = combined;
    } else {
      merged.push(text);
    }
  }
  return merged;
}

function parseDocumentPageMarker(block) {
  const raw = String(block || '').replace(/\r\n?/g, '\n').trim();
  if (!raw) return null;
  const match = raw.match(/^(?:##\s*)?(?:page|p\.)\s*(\d{1,5})(?:\b|\s*[:\-–—])([\s\S]*)$/i);
  if (!match) return null;
  const pageNumber = Number(match[1]);
  if (!Number.isFinite(pageNumber) || pageNumber <= 0) return null;
  const remainder = cleanBlockText(match[2] || '');
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
          assigned: breakByPageNumber ? nextPageNumber : (pageIndex + 1),
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
