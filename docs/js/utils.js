// Split from original app.js during role-based phase-1 restructure.
// File: utils.js
// Note: This is still global-script architecture (no bundler/modules required).

function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function applyHighlightSnippetsToPage(pageIndex, snippets) {
    const pageEl = document.querySelectorAll('.page')[pageIndex];
    if (!pageEl) return;
    const textEl = pageEl.querySelector('.page-text');
    if (!textEl) return;

    const source = String(pages?.[pageIndex] ?? textEl.textContent ?? '');
    const list = Array.isArray(snippets) ? snippets.map(s => String(s || '').trim()).filter(Boolean) : [];

    if (!list.length) {
      textEl.textContent = source;
      return;
    }

    // Find all occurrences of each snippet (simple + deterministic).
    const ranges = [];
    for (const snip of list) {
      let idx = 0;
      while (idx < source.length) {
        const found = source.indexOf(snip, idx);
        if (found === -1) break;
        ranges.push({ start: found, end: found + snip.length });
        idx = found + Math.max(1, snip.length);
      }
    }

    if (!ranges.length) {
      // If nothing matched exactly, show the plain source.
      textEl.textContent = source;
      return;
    }

    // Merge overlapping ranges.
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (!last || r.start > last.end) {
        merged.push({ start: r.start, end: r.end });
      } else {
        last.end = Math.max(last.end, r.end);
      }
    }

    let out = '';
    let cursor = 0;
    for (const r of merged) {
      if (r.start > cursor) out += escapeHtml(source.slice(cursor, r.start));
      out += `<mark class="highlight-missed">${escapeHtml(source.slice(r.start, r.end))}</mark>`;
      cursor = r.end;
    }
    if (cursor < source.length) out += escapeHtml(source.slice(cursor));

    textEl.innerHTML = out;
  }

  // ===================================
