// Split from original app.js during role-based phase-1 restructure.
// File: library.js
// Note: This is still global-script architecture (no bundler/modules required).

  // LOCAL LIBRARY (IndexedDB)
  // ===================================
  const LOCAL_DB_NAME = 'rc_local_library_v1';

  function getFocusedOrInferredReadingPageIndex() {
    try {
      if (typeof lastFocusedPageIndex === 'number' && lastFocusedPageIndex >= 0) return lastFocusedPageIndex;
    } catch (_) {}
    try {
      if (typeof inferCurrentPageIndex === 'function') {
        const idx = inferCurrentPageIndex();
        if (Number.isFinite(idx) && idx >= 0) return idx;
      }
    } catch (_) {}
    return 0;
  }

  async function flushCurrentReadingProgress(reason) {
    try {
      if (!(window.rcSync && typeof window.rcSync.saveProgressNow === 'function')) return null;
      const ctx = (typeof window.getReadingTargetContext === 'function') ? window.getReadingTargetContext() : (window.__rcReadingTarget || {});
      const bookId = String(ctx.bookId || '').trim();
      if (!bookId) return null;
      const chapterIndex = Number.isFinite(Number(ctx.chapterIndex)) ? Number(ctx.chapterIndex) : -1;
      const pageIndex = getFocusedOrInferredReadingPageIndex();
      return await window.rcSync.saveProgressNow(bookId, chapterIndex, pageIndex, { reason: String(reason || 'flush') });
    } catch (_) {
      return null;
    }
  }

  function queueCurrentReadingProgress(reason) {
    try {
      if (!(window.rcSync && typeof window.rcSync.scheduleProgressSync === 'function')) return;
      const ctx = (typeof window.getReadingTargetContext === 'function') ? window.getReadingTargetContext() : (window.__rcReadingTarget || {});
      const bookId = String(ctx.bookId || '').trim();
      if (!bookId) return;
      const chapterIndex = Number.isFinite(Number(ctx.chapterIndex)) ? Number(ctx.chapterIndex) : -1;
      const pageIndex = getFocusedOrInferredReadingPageIndex();
      window.rcSync.scheduleProgressSync(bookId, chapterIndex, pageIndex, { reason: String(reason || 'queue') });
    } catch (_) {}
  }

  function applyPendingReadingRestore() {
    try {
      const idx = Number(window.__rcPendingRestorePageIndex ?? -1);
      if (!Number.isFinite(idx) || idx < 0) return false;
      const pageEls = document.querySelectorAll('.page');
      const target = pageEls[idx];
      if (!target) return false;
      target.scrollIntoView({ behavior: 'auto', block: 'start' });
      lastFocusedPageIndex = idx;
      try { currentPageIndex = idx; } catch (_) {}
      // Advance reading target to the restored page; preserve source context set by render().
      try {
        const _cur = window.__rcReadingTarget || {};
        if (typeof setReadingTarget === 'function') setReadingTarget({ sourceType: _cur.sourceType || '', bookId: _cur.bookId || '', chapterIndex: _cur.chapterIndex != null ? _cur.chapterIndex : -1, pageIndex: idx });
      } catch (_) {}
      window.__rcPendingRestorePageIndex = -1;
      return true;
    } catch (_) {
      return false;
    }
  }
  const LOCAL_DB_VERSION = 2;
  const LOCAL_STORE_BOOKS = 'books';
  const LOCAL_STORE_DELETED = 'deleted_books';

  let _localDbPromise = null;

  function openLocalDb() {
    if (_localDbPromise) return _localDbPromise;
    _localDbPromise = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(LOCAL_STORE_BOOKS)) {
            db.createObjectStore(LOCAL_STORE_BOOKS, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(LOCAL_STORE_DELETED)) {
            db.createObjectStore(LOCAL_STORE_DELETED, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      } catch (e) {
        reject(e);
      }
    });
    return _localDbPromise;
  }

  async function localBooksGetAll() {
    const db = await openLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE_BOOKS, 'readonly');
      const store = tx.objectStore(LOCAL_STORE_BOOKS);
      const req = store.getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error || new Error('getAll failed'));
    });
  }

  async function localBookGet(id) {
    const db = await openLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE_BOOKS, 'readonly');
      const store = tx.objectStore(LOCAL_STORE_BOOKS);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('get failed'));
    });
  }

  async function localBookPut(record) {
    const db = await openLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE_BOOKS, 'readwrite');
      const store = tx.objectStore(LOCAL_STORE_BOOKS);
      const req = store.put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('put failed'));
    });
  }

  async function localDeletedBooksGetAll() {
    const db = await openLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE_DELETED, 'readonly');
      const store = tx.objectStore(LOCAL_STORE_DELETED);
      const req = store.getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error || new Error('deleted getAll failed'));
    });
  }

  async function localDeletedBookPut(record) {
    const db = await openLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE_DELETED, 'readwrite');
      const store = tx.objectStore(LOCAL_STORE_DELETED);
      const req = store.put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('deleted put failed'));
    });
  }

  async function syncRemoteLibraryItemState(bookId, options = {}) {
    try {
      if (!(window.rcSync && typeof bookId === 'string' && bookId.trim())) return null;
      if (options.restore) {
        if (typeof window.rcSync.restoreLibraryItem === 'function') return await window.rcSync.restoreLibraryItem(bookId);
        return null;
      }
      if (typeof window.rcSync.deleteLibraryItem === 'function') return await window.rcSync.deleteLibraryItem(bookId, options);
    } catch (_) {}
    return null;
  }

  function queueRemoteLibraryItemState(bookId, options = {}) {
    const normalized = String(bookId || '').trim();
    if (!normalized) return Promise.resolve(null);
    const task = (async () => {
      const row = await syncRemoteLibraryItemState(normalized, options);
      try {
        if (window.rcSync && typeof window.rcSync.rehydrateDurableData === 'function') {
          await window.rcSync.rehydrateDurableData();
        }
      } catch (_) {}
      return row;
    })();
    task.catch((error) => {
      try { console.warn('Remote library sync failed:', error); } catch (_) {}
    });
    return task;
  }

  function waitForNextPaint(count = 2) {
    const frames = Math.max(1, Number(count) || 1);
    return new Promise((resolve) => {
      let remaining = frames;
      const step = () => {
        remaining -= 1;
        if (remaining <= 0) {
          resolve(true);
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  async function localDeletedBookDelete(id) {
    const db = await openLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE_DELETED, 'readwrite');
      const store = tx.objectStore(LOCAL_STORE_DELETED);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('deleted delete failed'));
    });
  }

  async function moveLocalBookToDeleted(id) {
    const db = await openLocalDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([LOCAL_STORE_BOOKS, LOCAL_STORE_DELETED], 'readwrite');
      const books = tx.objectStore(LOCAL_STORE_BOOKS);
      const deleted = tx.objectStore(LOCAL_STORE_DELETED);
      const req = books.get(id);
      req.onsuccess = () => {
        const record = req.result;
        if (!record) { reject(new Error('book not found')); return; }
        deleted.put({ ...record, deletedAt: Date.now() });
        books.delete(id);
      };
      req.onerror = () => reject(req.error || new Error('move failed'));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('move failed'));
      tx.onabort = () => reject(tx.error || new Error('move aborted'));
    });
    queueRemoteLibraryItemState(`local:${String(id || '').trim()}`, { purge: false });
    return true;
  }

  async function restoreDeletedLocalBook(id) {
    const db = await openLocalDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([LOCAL_STORE_BOOKS, LOCAL_STORE_DELETED], 'readwrite');
      const books = tx.objectStore(LOCAL_STORE_BOOKS);
      const deleted = tx.objectStore(LOCAL_STORE_DELETED);
      const req = deleted.get(id);
      req.onsuccess = () => {
        const record = req.result;
        if (!record) { reject(new Error('deleted book not found')); return; }
        const restored = { ...record };
        delete restored.deletedAt;
        books.put(restored);
        deleted.delete(id);
      };
      req.onerror = () => reject(req.error || new Error('restore failed'));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('restore failed'));
      tx.onabort = () => reject(tx.error || new Error('restore aborted'));
    });
    queueRemoteLibraryItemState(`local:${String(id || '').trim()}`, { restore: true });
    return true;
  }

  async function permanentlyDeleteLocalBook(id) {
    await localDeletedBookDelete(id);
    queueRemoteLibraryItemState(`local:${String(id || '').trim()}`, { purge: true });
    return true;
  }

  window.__rcLocalBookGet = localBookGet;
  window.__rcLocalBookPut = localBookPut;
  window.__rcLocalBooksGetAll = localBooksGetAll;
  window.__rcLocalDeletedBooksGetAll = localDeletedBooksGetAll;

  const _bookPreviewCache = new Map();

  function countPagesFromMarkdown(markdown) {
    const count = (String(markdown || '').match(/^\s*##\s+/gm) || []).length;
    return Math.max(1, count || 0);
  }

  function normalizeLocalBookId(bookId) {
    const raw = String(bookId || '').trim();
    return raw.startsWith('local:') ? raw.slice(6) : raw;
  }

  function isTextImportRecord(recordOrId) {
    if (!recordOrId) return false;
    if (typeof recordOrId === 'string') {
      const id = normalizeLocalBookId(recordOrId);
      return /^text-/i.test(id);
    }
    const record = recordOrId || {};
    const id = normalizeLocalBookId(record.id || record.bookId || '');
    return String(record.importKind || '').toLowerCase() === 'text'
      || String(record.sourceName || '').toLowerCase() === 'pasted text'
      || /^text-/i.test(id);
  }

  function estimateBookReadMinutes(pageCount, recordOrId) {
    const pages = Math.max(1, Number(pageCount) || 1);
    if (isTextImportRecord(recordOrId)) return pages;
    return Math.max(1, Math.ceil(pages * 2.5));
  }

  function getBookSurfaceData(bookId, totalPages, options = {}) {
    const pageCount = Math.max(1, Number(totalPages) || 1);
    const summary = (window.rcReadingMetrics && typeof window.rcReadingMetrics.getReadingBookSummary === 'function')
      ? window.rcReadingMetrics.getReadingBookSummary(bookId, pageCount)
      : null;
    const status = !summary ? 'Unread' : (summary.completed ? 'Completed' : 'In Progress');
    const record = options && options.record ? options.record : null;
    const totalMinutes = (window.rcReadingMetrics && typeof window.rcReadingMetrics.estimateReadMinutesFromPages === 'function')
      ? window.rcReadingMetrics.estimateReadMinutesFromPages(pageCount, { textImport: isTextImportRecord(record || bookId) })
      : estimateBookReadMinutes(pageCount, record || bookId);
    const lastPage = summary ? Math.max(0, Number(summary.lastPageIndex || 0)) : 0;
    const remainingPages = summary && !summary.completed ? Math.max(0, pageCount - (lastPage + 1)) : 0;
    const remainingMinutes = status === 'Unread'
      ? totalMinutes
      : (status === 'Completed' ? 0 : Math.max(1, (window.rcReadingMetrics && typeof window.rcReadingMetrics.estimateReadMinutesFromPages === 'function') ? window.rcReadingMetrics.estimateReadMinutesFromPages(remainingPages || 1, { textImport: isTextImportRecord(record || bookId) }) : estimateBookReadMinutes(remainingPages || 1, record || bookId)));
    const timeLabel = status === 'Completed' ? 'Done' : `${remainingMinutes} min left`;
    return {
      status,
      timeLabel,
      totalPages: pageCount,
      totalMinutes,
      previewTrio: `${pageCount} Pages • ${totalMinutes} min read • ${status}`
    };
  }

  async function getBookRecordById(bookId) {
    if (!bookId) return null;
    if (isLocalBookId(bookId)) {
      const rec = await localBookGet(stripLocalPrefix(bookId)).catch(() => null);
      return rec ? { title: rec.title || 'Untitled', markdown: rec.markdown || '', totalPages: countPagesFromMarkdown(rec.markdown || '') } : null;
    }
    const cacheHit = _bookPreviewCache.get(String(bookId));
    if (cacheHit) return cacheHit;
    if (!Array.isArray(manifest) || !manifest.length) {
      try { await loadManifest(); } catch (_) {}
    }
    const entry = Array.isArray(manifest) ? manifest.find((b) => b.id === bookId) : null;
    if (!entry) return null;
    let raw = '';
    try {
      const res = await fetch(entry.path, { cache: 'no-cache' });
      if (!res.ok) throw new Error('fetch failed');
      raw = await res.text();
    } catch (_) {
      try { if (window.EMBED_BOOKS && typeof window.EMBED_BOOKS[bookId] === 'string') raw = window.EMBED_BOOKS[bookId]; } catch (_) {}
    }
    if (!raw) return null;
    const record = { title: entry.title || titleFromBookId(bookId) || 'Untitled', markdown: raw, totalPages: countPagesFromMarkdown(raw) };
    _bookPreviewCache.set(String(bookId), record);
    return record;
  }

  async function getBookPreviewSurface(bookId) {
    const record = await getBookRecordById(bookId).catch(() => null);
    if (!record) return { title: 'Book', previewTrio: '0 Pages • 0 min read • Unread', totalPages: 0, status: 'Unread' };
    return {
      title: record.title,
      ...getBookSurfaceData(bookId, record.totalPages)
    };
  }

  window.rcLibraryData = {
    getBookSurfaceData,
    getBookPreviewSurface,
    countPagesFromMarkdown,
  };

  async function localBookDelete(id) {
    const db = await openLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE_BOOKS, 'readwrite');
      const store = tx.objectStore(LOCAL_STORE_BOOKS);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('delete failed'));
    });
  }

  function isLocalBookId(id) {
    return typeof id === 'string' && id.startsWith('local:');
  }

  function stripLocalPrefix(id) {
    return isLocalBookId(id) ? id.slice('local:'.length) : id;
  }

  async function hashArrayBufferSha256(buf) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', buf);
      const bytes = new Uint8Array(digest);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      return b64.slice(0, 22);
    } catch (_) {
      // Fallback: not cryptographically strong, but stable.
      return String(Date.now());
    }
  }

  // ===================================
  // EPUB (client-side) -> Markdown (chapters + pages)
  // Requires JSZip (loaded in index.html)
  // ===================================

  function xmlParseSafe(xmlStr) {
    try {
      return new DOMParser().parseFromString(String(xmlStr || ''), 'application/xml');
    } catch (_) {
      return null;
    }
  }

  function htmlParseSafe(htmlStr) {
    try {
      return new DOMParser().parseFromString(String(htmlStr || ''), 'text/html');
    } catch (_) {
      return null;
    }
  }

  function normPath(p) {
    return String(p || '').replace(/^\//, '');
  }

  function joinPath(baseDir, rel) {
    const b = String(baseDir || '');
    const r = String(rel || '');
    if (!b) return normPath(r);
    if (!r) return normPath(b);
    if (/^https?:/i.test(r)) return r;
    if (r.startsWith('/')) return normPath(r);
    const out = (b.endsWith('/') ? b : (b + '/')) + r;
    // Resolve ./ and ../
    const parts = out.split('/');
    const stack = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') stack.pop();
      else stack.push(part);
    }
    return stack.join('/');
  }

  async function zipReadText(zip, path) {
    const f = zip.file(path);
    if (!f) return '';
    return await f.async('text');
  }

  async function epubFindOpfPath(zip) {
    const container = await zipReadText(zip, 'META-INF/container.xml');
    const doc = xmlParseSafe(container);
    if (!doc) return null;
    const rootfile = doc.querySelector('rootfile');
    const fullPath = rootfile?.getAttribute('full-path') || rootfile?.getAttribute('fullpath');
    return fullPath ? normPath(fullPath) : null;
  }

  function dirOf(path) {
    const p = String(path || '');
    const idx = p.lastIndexOf('/');
    return idx >= 0 ? p.slice(0, idx) : '';
  }

  function classifySection(title) {
    const t = String(title || '').toLowerCase();
    if (!t.trim()) return { type: 'unknown', tags: [] };
    const tags = [];
    let type = 'unknown';
    if (/\bmodule\s+\d+\b/.test(t)) { type = 'chapter'; tags.push('Module'); }
    else if (/\bchapter\b|\bch\.?\s*\d+\b/.test(t) || /^chapter\s+\w+/.test(t)) { type = 'chapter'; tags.push('Chapter'); }
    else if (/\bintroduction\b|\bprologue\b|\bforeword\b|\bcase study\b/.test(t)) { type = 'intro'; tags.push('Intro'); }
    else if (/\backnowledg|\bdedication|\bcopyright|\bpermissions|\babout\b|\bcontents?\b/.test(t)) { type = 'front_matter'; tags.push('Front'); }
    else if (/\bappendix\b|\breferences\b|\bbibliography\b|\bnotes\b/.test(t)) { type = 'appendix'; tags.push('Appendix'); }
    else if (/\bindex\b|\bglossary\b/.test(t)) { type = 'index'; tags.push('Index'); }
    return { type, tags };
  }

  function defaultSelectedForTitle(title) {
    const cls = classifySection(title);
    // Default ON: chapters + intro. Default OFF: front matter / appendix / index.
    if (cls.type === 'chapter' || cls.type === 'intro') return true;
    if (cls.type === 'front_matter' || cls.type === 'appendix' || cls.type === 'index') return false;
    // Unknown: keep on (user can uncheck)
    return true;
  }

  function extractTextBlocksFromHtml(htmlStr) {
    const doc = htmlParseSafe(htmlStr);
    if (!doc) return [];
    const root = doc.body || doc.documentElement;
    if (!root) return [];

    const blocks = [];
    const nodes = root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li');
    nodes.forEach((el) => {
      if (!/^(H[1-6]|P|LI)$/i.test(el.tagName || '')) return;
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt) return;
      if (txt.length < 2) return;
      blocks.push(txt);
    });
    if (blocks.length === 0) {
      const txt = (root.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt) blocks.push(txt);
    }
    return blocks;
  }

  function extractTextBlocksWithLeadingMarkersFromHtml(htmlStr) {
    const doc = htmlParseSafe(htmlStr);
    if (!doc) return [];
    const root = doc.body || doc.documentElement;
    if (!root) return [];

    const items = [];
    let pendingMarker = null;
    const nodes = root.querySelectorAll('[id],[name],h1,h2,h3,h4,h5,h6,p,li');
    nodes.forEach((el) => {
      try {
        const rawMarker = el.getAttribute('id') || el.getAttribute('name') || '';
        const markerMatch = String(rawMarker).match(/^page[_-]?(\d+)$/i);
        if (markerMatch) pendingMarker = Number(markerMatch[1]);
      } catch (_) {}
      if (!/^(H[1-6]|P|LI)$/i.test(el.tagName || '')) return;
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt || txt.length < 2) return;
      items.push({ text: txt, sourcePageNumber: Number.isFinite(pendingMarker) ? pendingMarker : null });
      pendingMarker = null;
    });
    if (items.length === 0) {
      const txt = (root.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt) items.push({ text: txt, sourcePageNumber: null });
    }
    return items;
  }

  function escapeRegExp(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function titleArtifactVariants(title) {
    const s = normalizeTocLabel(title);
    if (!s) return [];
    const out = new Set([s]);
    const noModule = s.replace(/^module\s+\d+\s*/i, '').trim();
    if (noModule && noModule !== s) out.add(noModule);
    const noAppendix = s.replace(/^appendix\s+[a-z]\s*/i, '').trim();
    if (noAppendix && noAppendix !== s) out.add(noAppendix);
    const noCase = s.replace(/^case study\s*/i, '').trim();
    if (noCase && noCase !== s) out.add(noCase);
    return Array.from(out).filter(x => x && x.split(/\s+/).length <= 6);
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

  function removeInlineArtifactTitles(text, knownTitles) {
    let s = String(text || '');
    const vars = Array.isArray(knownTitles) ? knownTitles : [];
    for (const t of vars) {
      const e = escapeRegExp(t);
      if (!e) continue;
      s = s.replace(new RegExp(`(^|\\s)\\d{1,3}\\s+${e}(?=\\s|$)`, 'gi'), ' ');
      s = s.replace(new RegExp(`(^|\\s)${e}\\s+\\d{1,3}(?=\\s|$)`, 'gi'), ' ');
    }
    return s;
  }

  
  function repairWrappedWordFragments(text) {
    let s = String(text || '');
    // Preserve real hyphenated compounds that were split by a line wrap.
    s = s.replace(/\b([A-Za-z]{2,})-\s+([A-Za-z]{2,}-[A-Za-z][A-Za-z\-]*)\b/g, '$1-$2');
    // Repair ordinary wrapped words like iden- tifier, modera- tor, dis- cussion.
    s = s.replace(/\b([A-Za-z]{2,})\s*-\s+([a-z]{2,})\b/g, (m, a, b) => {
      const joined = `${a}${b}`;
      if (joined.length > 28) return `${a}-${b}`;
      return joined;
    });
    s = s.replace(/\b([A-Za-z]{2,})-\s+([a-z]{2,})\b/g, (m, a, b) => {
      const joined = `${a}${b}`;
      if (joined.length > 28) return `${a}-${b}`;
      return joined;
    });
    return s;
  }

  
  function cleanImportedBlock(text, { bookTitle = '', artifactTitles = [] } = {}) {
    let s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';

    // Remove decorative spaced headings like "T I P S" before the real heading text.
    s = s.replace(/^(?:[A-Z]\s+){2,}[A-Z](?=\s+[A-Z][a-z])\s+/, '');
    s = s.replace(/\((?:contd\.?|continued)\)/gi, '');
    s = fixLeadingDropCapSpacing(s);
    s = repairWrappedWordFragments(s);
    s = s.replace(/\bcontinued on page\s+\d+\b/gi, ' ');

    const known = [];
    if (bookTitle) known.push(bookTitle);
    (artifactTitles || []).forEach(t => titleArtifactVariants(t).forEach(v => known.push(v)));
    s = removeInlineArtifactTitles(s, known);

    if (bookTitle) {
      const e = escapeRegExp(bookTitle);
      s = s.replace(new RegExp(`^\\s*\\d{1,3}\\s+${e}\\s*`, 'i'), '');
      s = s.replace(new RegExp(`^\\s*${e}\\s+\\d{1,3}\\s*`, 'i'), '');
      s = s.replace(new RegExp(`\\b${e}\\b`, 'gi'), ' ');
    }

    // Strip common running-head / side-label artifacts seen in handbook-style EPUBs.
    s = s.replace(/\b(?:overview|focus groups|in-depth interviews|interview checklist|sampling in qualitative research|qualitative research methods|case study)\s+\d{1,3}\b/gi, ' ');
    s = s.replace(/\b\d{1,3}\s+(?:overview|focus groups|in-depth interviews|interview checklist|sampling in qualitative research|qualitative research methods|case study)\b/gi, ' ');
    s = s.replace(/\b(?:FOCUS|GROUPS|OVERVIEW|TIPS|CASE\s+STUDY)\b(?=\s+[A-Z][a-z])/g, ' ');
    s = s.replace(/^\s*\d{1,3}\s+/, '');
    s = s.replace(/\s+/g, ' ').trim();

    if (!s) return '';
    if (/^(?:continued on page\s+\d+|page\s+\d+)$/i.test(s)) return '';
    if (bookTitle && titleKey(s) === titleKey(bookTitle)) return '';
    if (/^(?:[ivxlcdm]+|\d{1,3})$/i.test(s)) return '';
    return s;
  }

  // Import cleanup helpers (deterministic, build-safe)
  function fixLeadingDropCapSpacing(text) {
    let s = String(text || '');
    // Drop-cap join (locked): only repair obvious one-letter ornamental splits at block start.
    // Keep true standalone words intact, especially articles/pronouns like "A" and "I".
    const skip = new Set(['A', 'I']);
    const joinLeadingDropCap = (source) => source.replace(
      /^(?:(["“\'\(\[]\s*))?([A-Z])\s+([a-z][a-z]+)(?=\b)/,
      (m, pre = '', cap, frag) => {
        if (skip.has(cap)) return m;
        return `${pre}${cap}${frag}`;
      }
    );
    s = joinLeadingDropCap(s);
    return s;
  }

  
  function mergeFragmentedBlocks(blocks) {
    const out = [];
    const listLineRe = /^\s*(\d+[\.|\)]\s+|box\s+\d+\s*:|line\s+\d+\s*:|part\s+[ivxlcdm]+\b|[-•*]\s+)/i;
    const strongEndRe = /[.!?]["'”’\)\]\}]*\s*$/;
    const weakTailRe = /(?:,|;|:)\s*$/;
    const startsContinuationRe = /^\s*(?:[a-z]|\(|\[|\{|and\b|or\b|but\b|nor\b|for\b|so\b|yet\b|because\b|which\b|who\b|whom\b|whose\b|that\b|to\b|of\b|in\b|on\b|at\b|by\b|from\b|with\b|without\b|under\b|over\b|between\b|among\b|through\b|into\b|onto\b)/i;

    for (let i = 0; i < (blocks || []).length; i++) {
      const cur = String(blocks[i] || '').trim();
      if (!cur) continue;
      if (out.length === 0) { out.push(cur); continue; }

      const prev = out[out.length - 1];
      // Always keep blocks separate when the PREV looks like a section heading —
      // it should stand alone.  Only gate on CUR being a heading when prev has
      // already ended cleanly (strong stop); if prev is a fragment, a heading-
      // looking line is actually a continuation (e.g. a mailing address line).
      if (looksLikeMajorHeading(prev)) {
        out.push(cur);
        continue;
      }
      if (looksLikeMajorHeading(cur) && strongEndRe.test(prev)) {
        out.push(cur);
        continue;
      }
      // A list-item PREV is always kept separate (it's a header or label).
      // A list-item CUR is only kept separate when prev already ends with a strong stop —
      // if prev is an incomplete fragment (no sentence-ending punct), the numbered item
      // is a continuation of an enumeration and must be merged.
      if (listLineRe.test(prev)) {
        out.push(cur);
        continue;
      }
      if (listLineRe.test(cur) && strongEndRe.test(prev)) {
        out.push(cur);
        continue;
      }

      if (/\b[A-Za-z]{2,}-$/.test(prev) && /^\s*[a-z]{2,}/.test(cur)) {
        out[out.length - 1] = (prev.replace(/-\s*$/, '') + cur.replace(/^\s+/, '')).replace(/\s+/g, ' ').trim();
        continue;
      }

      // Merge rules (after passing heading and list-label gates above):
      // 1. prev has no sentence-ending punct → it's a fragment. Merge unconditionally
      //    with whatever follows so line-wrapped prose and numbered continuations
      //    (e.g. "; and\n2. Affiant") join correctly.
      // 2. prev ends with a weak-tail char (,;:) → it's mid-clause. Merge when cur
      //    looks like a grammatical continuation.
      const prevIncomplete = !strongEndRe.test(prev);
      if (prevIncomplete || (weakTailRe.test(prev) && startsContinuationRe.test(cur))) {
        out[out.length - 1] = (prev + ' ' + cur).replace(/\s+/g, ' ').trim();
        continue;
      }
      out.push(cur);
    }
    return out;
  }



  function mergeFragmentedBlockItems(items) {
    const out = [];
    const listLineRe = /^\s*(\d+[\.|\)]\s+|box\s+\d+\s*:|line\s+\d+\s*:|part\s+[ivxlcdm]+\b|[-•*]\s+)/i;
    const strongEndRe = /[.!?]["'”’\)\]\}]*\s*$/;
    const weakTailRe = /(?:,|;|:)\s*$/;
    const startsContinuationRe = /^\s*(?:[a-z]|\(|\[|\{|and\b|or\b|but\b|nor\b|for\b|so\b|yet\b|because\b|which\b|who\b|whom\b|whose\b|that\b|to\b|of\b|in\b|on\b|at\b|by\b|from\b|with\b|without\b|under\b|over\b|between\b|among\b|through\b|into\b|onto\b)/i;

    for (let i = 0; i < (items || []).length; i++) {
      const curItem = items[i] && typeof items[i] === 'object' ? items[i] : null;
      const cur = String(curItem?.text || '').trim();
      if (!cur) continue;
      const curSegments = Array.isArray(curItem?.segments) && curItem.segments.length
        ? curItem.segments.filter(seg => String(seg?.text || '').trim())
        : [{ text: cur, sourcePageNumber: Number.isFinite(Number(curItem?.sourcePageNumber)) ? Number(curItem.sourcePageNumber) : null }];
      if (out.length === 0) { out.push({ text: cur, segments: curSegments }); continue; }

      const prevItem = out[out.length - 1];
      const prev = String(prevItem?.text || '').trim();
      if (!prev) { out[out.length - 1] = { text: cur, segments: curSegments }; continue; }

      if (looksLikeMajorHeading(prev)) { out.push({ text: cur, segments: curSegments }); continue; }
      if (looksLikeMajorHeading(cur) && strongEndRe.test(prev)) { out.push({ text: cur, segments: curSegments }); continue; }
      if (listLineRe.test(prev)) { out.push({ text: cur, segments: curSegments }); continue; }
      if (listLineRe.test(cur) && strongEndRe.test(prev)) { out.push({ text: cur, segments: curSegments }); continue; }

      if (/\b[A-Za-z]{2,}-$/.test(prev) && /^\s*[a-z]{2,}/.test(cur)) {
        const mergedText = (prev.replace(/-\s*$/, '') + cur.replace(/^\s+/, '')).replace(/\s+/g, ' ').trim();
        out[out.length - 1] = { text: mergedText, segments: [...(prevItem.segments || []), ...curSegments] };
        continue;
      }

      const prevIncomplete = !strongEndRe.test(prev);
      if (prevIncomplete || (weakTailRe.test(prev) && startsContinuationRe.test(cur))) {
        const mergedText = (prev + ' ' + cur).replace(/\s+/g, ' ').trim();
        out[out.length - 1] = { text: mergedText, segments: [...(prevItem.segments || []), ...curSegments] };
        continue;
      }
      out.push({ text: cur, segments: curSegments });
    }
    return out;
  }

  function isDecorativeSpacedHeading(text) {
    const s = String(text || '').trim();
    if (!s) return false;
    if (s.length > 80) return false;
    if (/[a-z]/.test(s)) return false; // if it has lowercase, it's not the decorative spaced heading style

    // Many single-letter uppercase tokens separated by spaces (e.g., "C H A P T E R O N E")
    const singleLetterTokens = (s.match(/\b[A-Z]\b/g) || []).length;
    if (singleLetterTokens >= 6) return true;

    // Or a tight pattern of "A B C D" letters across the line
    if (/^(?:[A-Z]\s+){5,}[A-Z]$/.test(s)) return true;

    return false;
  }

  
  function chunkBlocksToPages() {
    throw new Error('Client page breaking has moved to the server page-break route.');
  }

  function buildMarkdownBookFromSections() {
    throw new Error('Client page breaking has moved to the server page-break route.');
  }

  function _normEpubHref(href) {
    return String(href || '')
      .split('#')[0]
      .replace(/^\.\//, '')
      .replace(/^\//, '');
  }


  function normalizeTocLabel(text) {
    let s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    s = s.replace(/[–—]/g, ' - ');
    s = s.replace(/\s+/g, ' ').trim();
    // Strip trailing printed page references from front-matter contents lines.
    s = s.replace(/\s+(?:\d+[\d,\-– ]*|[ivxlcdm]+)\s*$/i, '').trim();
    s = s.replace(/\s*\.+\s*(?:\d+[\d,\-– ]*|[ivxlcdm]+)\s*$/i, '').trim();
    return s;
  }

  function titleKey(text) {
    return normalizeTocLabel(text)
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function weakTocTitle(title) {
    const k = titleKey(title);
    return !k || /^(start|unknown|cover|title page|contents?|toc|untitled|beginning)$/.test(k);
  }

  function tocLooksWeak(items, spineHrefs) {
    const arr = Array.isArray(items) ? items.filter(Boolean) : [];
    if (arr.length === 0) return true;
    if (arr.length <= 2) return true;
    const weakCount = arr.filter(it => weakTocTitle(it.title)).length;
    if (weakCount >= Math.max(1, arr.length - 1)) return true;
    const uniqueHrefs = new Set(arr.map(it => _normEpubHref(it.href)).filter(Boolean));
    if (uniqueHrefs.size <= 1 && (spineHrefs || []).length > 1) return true;
    return false;
  }

  function looksLikeMajorSectionTitle(text) {
    const s = normalizeTocLabel(text);
    if (!s) return false;
    if (s.length > 120) return false;
    if (/[.!?]$/.test(s)) return false;
    return /^(acknowledg|introduction\b|case study\b|module\s+\d+\b|appendix\s+[a-z]\b|glossary\b|references\b|bibliography\b|notes\b)/i.test(s);
  }

  function findTocShapedLines(blocks) {
    const out = [];
    let inContents = false;
    for (const raw of (blocks || [])) {
      const t = String(raw || '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      if (!inContents && /^(contents|table of contents)$/i.test(t)) { inContents = true; continue; }
      if (!inContents) continue;
      const label = normalizeTocLabel(t);
      if (!label) continue;
      if (looksLikeMajorSectionTitle(label)) out.push(label);
      // Stop when we leave the compact list and enter obvious prose.
      if (out.length >= 3 && /[.!?]$/.test(t) && t.split(/\s+/).length > 12) break;
    }
    return out;
  }

  function majorTitleVariants(title) {
    const raw = normalizeTocLabel(title);
    const key = titleKey(raw);
    const vars = new Set([raw, key]);
    const m = key.match(/^(module\s+\d+)\b/);
    if (m) vars.add(m[1]);
    const a = key.match(/^(appendix\s+[a-z])\b/);
    if (a) vars.add(a[1]);
    if (/^case study\b/.test(key)) vars.add('case study');
    if (/^introduction\b/.test(key)) vars.add('introduction');
    if (/^glossary\b/.test(key)) vars.add('glossary');
    if (/^acknowledg/.test(key)) vars.add('acknowledgments');
    return Array.from(vars).filter(Boolean);
  }

  function findBlockIndexForTitle(blocks, title) {
    const vars = majorTitleVariants(title);
    if (!vars.length) return -1;
    for (let i = 0; i < (blocks || []).length; i++) {
      const bk = titleKey(blocks[i]);
      if (!bk) continue;
      if (vars.some(v => bk === v || bk.startsWith(v + ' ') || bk.includes(' ' + v + ' '))) return i;
    }
    return -1;
  }

  async function rebuildTocFromFrontMatter(zip, spineHrefs) {
    const spine = Array.isArray(spineHrefs) ? spineHrefs.map(_normEpubHref) : [];
    if (!spine.length) return [];

    const candidateTitles = [];
    // 1) Look for an explicit Contents page near the front.
    for (let i = 0; i < Math.min(3, spine.length); i++) {
      const html = await zipReadText(zip, spine[i]);
      const blocks = extractTextBlocksFromHtml(html);
      const lines = findTocShapedLines(blocks);
      lines.forEach(t => candidateTitles.push(t));
      if (lines.length >= 3) break;
    }

    // 2) Fallback: recover major headings from body text across the spine.
    if (candidateTitles.length < 3) {
      for (let i = 0; i < spine.length; i++) {
        const html = await zipReadText(zip, spine[i]);
        const blocks = extractTextBlocksFromHtml(html);
        for (const b of blocks) {
          const label = normalizeTocLabel(b);
          if (looksLikeMajorSectionTitle(label)) candidateTitles.push(label);
        }
      }
    }

    // De-dupe while preserving order.
    const seen = new Set();
    const major = [];
    for (const t of candidateTitles) {
      const k = titleKey(t);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      major.push(t);
    }
    if (!major.length) return [];

    // Map each candidate title to the first matching spine doc and block index.
    const blockCache = new Map();
    const items = [];
    let lastSpineIdx = -1;
    for (const title of major) {
      let found = null;
      for (let s = Math.max(0, lastSpineIdx); s < spine.length; s++) {
        let blocks = blockCache.get(spine[s]);
        if (!blocks) {
          const html = await zipReadText(zip, spine[s]);
          blocks = extractTextBlocksFromHtml(html);
          blockCache.set(spine[s], blocks);
        }
        const idx = findBlockIndexForTitle(blocks, title);
        const matched = idx >= 0 && blocks[idx] && majorTitleVariants(title).some(v => { const bk = titleKey(blocks[idx]); return bk === v || bk.startsWith(v + ' ') || bk.includes(' ' + v + ' '); });
        if (matched) {
          found = { title, href: spine[s], blockIndex: idx };
          lastSpineIdx = s;
          break;
        }
      }
      if (found) items.push(found);
    }

    // Drop duplicates that map to the same spot.
    const finalSeen = new Set();
    return items.filter((it) => {
      const k = `${_normEpubHref(it.href)}|${it.blockIndex}|${titleKey(it.title)}`;
      if (finalSeen.has(k)) return false;
      finalSeen.add(k);
      return true;
    });
  }

  async function epubParseToc(zip, opfPath) {
    const opfText = await zipReadText(zip, opfPath);
    const opf = xmlParseSafe(opfText);
    if (!opf) return { metadata: {}, items: [] };

    const baseDir = dirOf(opfPath);
    const md = {};
    const titleEl = opf.querySelector('metadata > title, metadata > dc\\:title, dc\\:title');
    const creatorEl = opf.querySelector('metadata > creator, metadata > dc\\:creator, dc\\:creator');
    md.title = (titleEl?.textContent || '').trim();
    md.author = (creatorEl?.textContent || '').trim();

    // Build manifest map
    const manifest = new Map();
    opf.querySelectorAll('manifest > item').forEach((it) => {
      const id = it.getAttribute('id') || '';
      const href = it.getAttribute('href') || '';
      const mediaType = it.getAttribute('media-type') || it.getAttribute('mediaType') || '';
      const props = it.getAttribute('properties') || '';
      if (!id || !href) return;
      manifest.set(id, { id, href: joinPath(baseDir, href), mediaType, props });
    });

    // Spine order (used to extract full chapter ranges)
    const spineIds = [];
    opf.querySelectorAll('spine > itemref').forEach((it) => {
      const idref = it.getAttribute('idref');
      if (idref) spineIds.push(idref);
    });
    const spineHrefs = spineIds
      .map((idref) => manifest.get(idref)?.href)
      .filter(Boolean)
      .map(_normEpubHref);

    // EPUB3 nav
    const navItem = Array.from(manifest.values()).find(v => /\bnav\b/.test(v.props || ''));
    if (navItem) {
      const navHtml = await zipReadText(zip, navItem.href);
      const navDoc = htmlParseSafe(navHtml);
      const tocNav = navDoc?.querySelector('nav[epub\\:type="toc"], nav[epub\\:type="toc" i], nav[type="toc"], nav#toc');
      const links = tocNav ? tocNav.querySelectorAll('a[href]') : navDoc?.querySelectorAll('a[href]');
      const items = [];
      (links ? Array.from(links) : []).forEach((a) => {
        const href = a.getAttribute('href') || '';
        const title = (a.textContent || '').replace(/\s+/g, ' ').trim();
        if (!href || !title) return;
        const cleanHref = href.split('#')[0];
        if (!cleanHref) return;
        const full = joinPath(dirOf(navItem.href), cleanHref);
        items.push({ title, href: full });
      });
      // De-dupe
      const seen = new Set();
      const uniq = [];
      for (const it of items) {
        const k = it.title + '|' + it.href;
        if (seen.has(k)) continue;
        seen.add(k);
        uniq.push(it);
      }
      if (!tocLooksWeak(uniq, spineHrefs)) return { metadata: md, items: uniq, spineHrefs };
    }

    // EPUB2 NCX
    const spine = opf.querySelector('spine');
    const tocId = spine?.getAttribute('toc') || '';
    const tocItem = tocId ? manifest.get(tocId) : null;
    if (tocItem) {
      const ncxText = await zipReadText(zip, tocItem.href);
      const ncx = xmlParseSafe(ncxText);
      const navPoints = ncx ? Array.from(ncx.querySelectorAll('navPoint')) : [];
      const items = [];
      navPoints.forEach((np) => {
        const t = (np.querySelector('navLabel > text')?.textContent || '').trim();
        const src = (np.querySelector('content')?.getAttribute('src') || '').trim();
        if (!t || !src) return;
        const cleanHref = src.split('#')[0];
        const full = joinPath(dirOf(tocItem.href), cleanHref);
        items.push({ title: t, href: full });
      });
      if (!tocLooksWeak(items, spineHrefs)) return { metadata: md, items, spineHrefs };
    }

    const rebuilt = await rebuildTocFromFrontMatter(zip, spineHrefs);
    if (rebuilt.length) return { metadata: md, items: rebuilt, spineHrefs };

    // Worst-case: fall back to spine order
    const items = spineHrefs.map((href, i) => ({ title: `Section ${i + 1}`, href }));
    return { metadata: md, items, spineHrefs };
  }

  async function epubToMarkdownFromSelected(zip, tocItems, selectedIds, spineHrefs, { cleanupHeadings = false, onProgress = null, bookTitle = '' } = {}) {
    // Extract each selected TOC item as a range in spine order: from its start file until next TOC start.
    const toc = (tocItems || [])
      .slice()
      .filter(x => x && x.href)
      .map((x, idx) => ({ ...x, _order: idx, _hrefNorm: _normEpubHref(x.href) }));

    const spine = Array.isArray(spineHrefs) ? spineHrefs.map(_normEpubHref) : [];
    const hrefToSpineIndex = new Map(spine.map((h, i) => [h, i]));
    toc.forEach((it) => {
      it.spineIndex = hrefToSpineIndex.has(it._hrefNorm) ? hrefToSpineIndex.get(it._hrefNorm) : null;
      it.blockIndex = Number.isFinite(it.blockIndex) ? Math.max(0, it.blockIndex) : null;
    });

    const chosen = toc.filter(it => selectedIds.has(it.id) && typeof it.spineIndex === 'number');
    chosen.sort((a, b) => a._order - b._order);

    const sections = [];
    let done = 0;
    for (let i = 0; i < chosen.length; i++) {
      const it = chosen[i];
      // Find the next TOC item after this one (regardless of selection) that has a spine index.
      let endSpine = spine.length;
      for (let j = it._order + 1; j < toc.length; j++) {
        const nxt = toc[j];
        if (typeof nxt.spineIndex === 'number' && nxt.spineIndex > it.spineIndex) {
          endSpine = nxt.spineIndex;
          break;
        }
      }

      const blocks = [];
      let nextSameSpine = null;
      for (let j = it._order + 1; j < toc.length; j++) {
        const nxt = toc[j];
        if (typeof nxt.spineIndex === 'number' && nxt.spineIndex === it.spineIndex && Number.isFinite(nxt.blockIndex)) {
          nextSameSpine = nxt;
          break;
        }
        if (typeof nxt.spineIndex === 'number' && nxt.spineIndex > it.spineIndex) break;
      }

      for (let s = it.spineIndex; s < endSpine; s++) {
        const href = spine[s];
        const html = await zipReadText(zip, href);
        let cleanedItems = extractTextBlocksWithLeadingMarkersFromHtml(html)
          .map(item => {
            const cleanedText = cleanImportedBlock(item?.text || '', { bookTitle, artifactTitles: toc.map(x => x.title) });
            const sourcePageNumber = Number.isFinite(Number(item?.sourcePageNumber)) ? Number(item.sourcePageNumber) : null;
            return {
              text: cleanedText,
              sourcePageNumber,
              segments: [{ text: cleanedText, sourcePageNumber }],
            };
          })
          .filter(item => item.text && (!cleanupHeadings || !isDecorativeSpacedHeading(item.text)));
        cleanedItems = mergeFragmentedBlockItems(cleanedItems);
        cleanedItems = cleanedItems.filter(item => item.text && (!cleanupHeadings || !isDecorativeSpacedHeading(item.text)));

        let startIdx = 0;
        let endIdx = cleanedItems.length;
        if (s === it.spineIndex && Number.isFinite(it.blockIndex)) startIdx = Math.min(cleanedItems.length, Math.max(0, it.blockIndex));
        if (s === it.spineIndex && nextSameSpine && Number.isFinite(nextSameSpine.blockIndex)) endIdx = Math.min(endIdx, Math.max(startIdx, nextSameSpine.blockIndex));
        if (s === endSpine - 1 && !nextSameSpine) {
          // If the next TOC item starts inside the same final spine doc, stop there.
          for (let j = it._order + 1; j < toc.length; j++) {
            const nxt = toc[j];
            if (typeof nxt.spineIndex === 'number' && nxt.spineIndex === s && Number.isFinite(nxt.blockIndex)) {
              endIdx = Math.min(endIdx, Math.max(startIdx, nxt.blockIndex));
              break;
            }
            if (typeof nxt.spineIndex === 'number' && nxt.spineIndex > s) break;
          }
        }
        let lastMarker = null;
        for (let bi = startIdx; bi < endIdx; bi++) {
          const entry = cleanedItems[bi];
          const segments = Array.isArray(entry?.segments) && entry.segments.length ? entry.segments : [{ text: entry?.text || '', sourcePageNumber: null }];
          for (const seg of segments) {
            const segText = String(seg?.text || '').trim();
            if (!segText) continue;
            const markerNum = Number(seg?.sourcePageNumber);
            if (Number.isFinite(markerNum) && markerNum > 0 && markerNum !== lastMarker) {
              blocks.push(`[[RC_PAGE:${markerNum}]]`);
              lastMarker = markerNum;
            }
            blocks.push(segText);
          }
        }
      }
      sections.push({ title: it.title, blocks });
      done++;
      if (typeof onProgress === 'function') onProgress({ done, total: chosen.length });
    }

    return sections;
  }

  async function initBookImporter() {
    const sourceSel = document.getElementById("importSource");
    const bookControls = document.getElementById("bookControls");
    const textControls = document.getElementById("textControls");
    const bookSelect = document.getElementById("bookSelect");
    const chapterControls = document.getElementById("chapterControls");
    const chapterSelect = document.getElementById("chapterSelect");
    const pageControls = document.getElementById("pageControls");
    const pageStart = document.getElementById("pageStart");
    const pageEnd = document.getElementById("pageEnd");
    const loadBtn = document.getElementById("loadBookSelection");
    const appendBtn = document.getElementById("appendBookSelection");
    const bulkInput = document.getElementById("bulkInput");

    if (!sourceSel || !bookControls || !bookSelect || !chapterControls || !chapterSelect || !pageControls || !pageStart || !pageEnd || !loadBtn || !appendBtn || !bulkInput) {
      console.warn("Book importer: missing required elements");
      return;
    }

    let manifest = [];
    let currentBookRaw = "";
    let hasExplicitChapters = false;

    // When chapters exist, we keep chapter pages in memory
    let chapterList = []; // {title, raw}
    let currentPages = []; // [{title, text}]
    let currentBookPageMeta = []; // [{title, sourcePageNumber}] aligned to whole-book pages
    let currentChapterPageOffsets = [];
    let currentChapterIndex = null;

    function getReadingTargetContext() {
      const _cur = window.__rcReadingTarget || {};
      let sourceType = String(_cur.sourceType || '');
      let bookId = String(_cur.bookId || '');
      let chapterIndex = Number.isFinite(Number(_cur.chapterIndex)) ? Number(_cur.chapterIndex) : -1;

      try {
        if (sourceSel && sourceSel.value) sourceType = String(sourceSel.value || '');
      } catch (_) {}
      try {
        if (bookSelect && bookSelect.value) bookId = String(bookSelect.value || '');
      } catch (_) {}
      try {
        if (typeof currentChapterIndex === 'number' && currentChapterIndex !== null) chapterIndex = currentChapterIndex;
        else if (chapterSelect && chapterSelect.value !== '') {
          const _ch = parseInt(chapterSelect.value || '', 10);
          if (Number.isFinite(_ch)) chapterIndex = _ch;
        }
      } catch (_) {}

      // Reading mode can still have valid book context even if the source select
      // is blank/hidden on this path. Normalize that case instead of leaving
      // bottom-bar Play blocked behind an empty sourceType.
      if (!sourceType && (bookId || currentBookRaw || (Array.isArray(chapterList) && chapterList.length))) {
        sourceType = 'book';
      }

      return { sourceType, bookId, chapterIndex };
    }

    function setSourceUI() {
      const isBook = sourceSel.value === "book";
      bookControls.style.display = isBook ? "flex" : "none";
      if (textControls) textControls.style.display = isBook ? "none" : "block";

      // Load Pages only makes sense for Book source.
      if (loadBtn) loadBtn.style.display = isBook ? "" : "none";

      // Add Pages only makes sense for ad-hoc Text input.
      // For Books, allowing out-of-order appends adds confusion with no value.
      if (appendBtn) appendBtn.style.display = isBook ? "none" : "inline-block";
    }

    function countExplicitH1(text) {
      const lines = String(text || "").split(/\r?\n/);
      let count = 0;
      for (const line of lines) if (/^\s{0,3}#\s+/.test(line)) count++;
      return count;
    }

    function normalizeSourcePageMeta(entry, idx) {
      const item = (entry && typeof entry === 'object') ? entry : {};
      const rawNum = Number(item.sourcePageNumber);
      const sourcePageNumber = Number.isFinite(rawNum) && rawNum > 0 ? Math.round(rawNum) : (idx + 1);
      const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : `Page ${sourcePageNumber}`;
      return { title, sourcePageNumber };
    }

    function applySourcePageMeta(pagesIn, meta, startOffset = 0) {
      const pagesList = Array.isArray(pagesIn) ? pagesIn : [];
      const metaList = Array.isArray(meta) ? meta : [];
      return pagesList.map((page, idx) => {
        const pageTitle = page?.title || `Page ${idx + 1}`;
        const rawMeta = metaList[startOffset + idx];
        if (!rawMeta) {
          return {
            title: pageTitle,
            text: page?.text || '',
            sourcePageNumber: idx + 1,
          };
        }
        const metaEntry = normalizeSourcePageMeta(rawMeta, idx);
        return {
          title: pageTitle,
          text: page?.text || '',
          sourcePageNumber: metaEntry.sourcePageNumber,
        };
      });
    }

    function rebuildChapterPageOffsets() {
      currentChapterPageOffsets = [];
      let running = 0;
      chapterList.forEach((chapter) => {
        currentChapterPageOffsets.push(running);
        running += parsePagesWithTitles(chapter.raw).length;
      });
    }

    function parsePagesWithTitles(raw) {
      const text = String(raw || "");
      const lines = text.split(/\r?\n/);

      let pages = [];
      let cur = null;

      function push() {
        if (!cur) return;
        const cleaned = cur.lines
          .map(l => l.trim())
          .filter(l => l && !/^\s{0,3}#{1,6}\s+/.test(l) && !/^\s*[—-]{2,}\s*$/.test(l));

        const body = cleaned.join(" ").trim();
        if (body) pages.push({ title: cur.title, text: body, sourcePageNumber: pages.length + 1 });
      }

      for (const line of lines) {
        const h2 = line.match(/^\s{0,3}##\s+(.*)\s*$/);
        if (h2) {
          push();
          const title = (h2[1] || "").trim() || `Page ${pages.length + 1}`;
          cur = { title, lines: [] };
          continue;
        }
        if (!cur) cur = { title: "Page 1", lines: [] };
        cur.lines.push(line);
      }
      push();

      if (pages.length <= 1) {
        const blocks = String(raw || "").trim().split(/\n---\n/g);
        if (blocks.length > 1) {
          const out = [];
          blocks.forEach((blk) => {
            const cleaned = blk.split(/\r?\n/)
              .map(l => l.trim())
              .filter(l => l && !/^\s{0,3}#{1,6}\s+/.test(l) && !/^\s*[—-]{2,}\s*$/.test(l));
            const body = cleaned.join(" ").trim();
            if (body) out.push({ title: `Page ${out.length + 1}`, text: body, sourcePageNumber: out.length + 1 });
          });
          return out.length ? out : pages;
        }
      }

      const usedExplicitSeparators = /\n\s*---\s*\n/.test(raw) || /^\s*##\s*Page\s+\d+/im.test(raw);
      if (!usedExplicitSeparators) {
        const blocks = raw
          .replace(/\r\n?/g, "\n")
          .split(/\n\s*\n+/)
          .map(b => b.trim())
          .filter(Boolean);

        if (blocks.length > 1) {
          pages = blocks.map((b, i) => ({
            title: `Page ${i + 1}`,
            text: b.replace(/\s+/g, " ").trim(),
            sourcePageNumber: i + 1,
          }));
        }
      }

      return pages;
    }

    function setSelectOptions(selectEl, options, placeholder) {
      selectEl.innerHTML = "";
      if (placeholder) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = placeholder;
        selectEl.appendChild(opt);
      }
      options.forEach((o) => {
        const opt = document.createElement("option");
        opt.value = String(o.value);
        opt.textContent = o.label;
        selectEl.appendChild(opt);
      });
    }

    function populatePagesSelect(pages) {
      currentPages = pages || [];
      if (!currentPages.length) {
        setSelectOptions(pageStart, [], "No pages detected");
        setSelectOptions(pageEnd, [], "No pages detected");
        return;
      }

      const opts = currentPages.map((p, idx) => {
        const sourcePageNumber = Number(p?.sourcePageNumber);
        const title = p?.title || `Page ${idx + 1}`;
        const numericLabel = Number.isFinite(sourcePageNumber) && sourcePageNumber > 0 ? `Page ${sourcePageNumber}` : `Page ${idx + 1}`;
        return {
          value: idx,
          label: title && title !== numericLabel ? `${numericLabel} — ${title}` : numericLabel
        };
      });

      setSelectOptions(pageStart, opts, "Start page…");
      setSelectOptions(pageEnd, opts, "End page…");
      pageStart.value = "0";
      pageEnd.value = String(currentPages.length - 1);
    }

    function getCurrentChapterRaw() {
      if (hasExplicitChapters && Number.isFinite(currentChapterIndex) && chapterList[currentChapterIndex]) {
        return chapterList[currentChapterIndex].raw;
      }
      return currentBookRaw;
    }

    function getCurrentChapterPageOffset() {
      if (!hasExplicitChapters || !Number.isFinite(currentChapterIndex)) return 0;
      return Number(currentChapterPageOffsets[currentChapterIndex] || 0);
    }

    // Async so that loadBook can await full render + restore before resolving.
    // This closes the race where reading-restore-pending was removed before
    // render() and applyPendingReadingRestore() had actually run.
    async function refreshChapterAndPagesUI(options = {}) {
      const restore = (options && options.restore && typeof options.restore === 'object') ? options.restore : null;
      const restorePageIndex = Number.isFinite(Number(restore?.pageIndex)) ? Math.max(0, Number(restore.pageIndex)) : 0;
      const restoreChapterIndex = Number.isFinite(Number(restore?.chapterIndex)) ? Math.max(0, Number(restore.chapterIndex)) : null;

      // Chapters present?
      if (!hasExplicitChapters) {
        chapterControls.style.display = "none";
        currentChapterIndex = null;
        const bookPages = applySourcePageMeta(parsePagesWithTitles(currentBookRaw), currentBookPageMeta, 0);
        populatePagesSelect(bookPages);
        try { window.__rcPendingRestorePageIndex = Math.min(restorePageIndex, Math.max(0, bookPages.length - 1)); } catch (_) {}
        // Await render completion so the restore scroll finishes before the caller
        // removes reading-restore-pending and reveals pages to the user.
        const allText = bookPages.map(p => p.text).filter(Boolean).join("\n---\n");
        const pageMeta = bookPages.map((p, idx) => ({ title: p.title || `Page ${idx + 1}`, sourcePageNumber: Number.isFinite(Number(p?.sourcePageNumber)) ? Number(p.sourcePageNumber) : (idx + 1) }));
        if (allText) await applySelectionToBulkInput(allText, { append: false, preservePendingRestore: true, pageMeta });
        return;
      }

      chapterControls.style.display = "flex";
      const chapOpts = chapterList.map((ch, idx) => ({ value: idx, label: ch.title || `Chapter ${idx + 1}` }));
      setSelectOptions(chapterSelect, chapOpts, "Select a chapter…");
      const nextChapterIndex = Math.max(0, Math.min(Number.isFinite(restoreChapterIndex) ? restoreChapterIndex : 0, Math.max(0, chapterList.length - 1)));
      chapterSelect.value = String(nextChapterIndex);
      currentChapterIndex = nextChapterIndex;

      const chapterOffset = getCurrentChapterPageOffset();
      const chapterPages = applySourcePageMeta(parsePagesWithTitles(getCurrentChapterRaw()), currentBookPageMeta, chapterOffset);
      populatePagesSelect(chapterPages);
      try { window.__rcPendingRestorePageIndex = Math.min(restorePageIndex, Math.max(0, chapterPages.length - 1)); } catch (_) {}
      // Await render completion before resolving.
      const chapterText = chapterPages.map(p => p.text).filter(Boolean).join("\n---\n");
      const pageMeta = chapterPages.map((p, idx) => ({ title: p.title || `Page ${idx + 1}`, sourcePageNumber: Number.isFinite(Number(p?.sourcePageNumber)) ? Number(p.sourcePageNumber) : (idx + 1) }));
      if (chapterText) await applySelectionToBulkInput(chapterText, { append: false, preservePendingRestore: true, pageMeta });
    }

    async function loadManifest() {
      const candidates = [
        "assets/books/index.json"
      ];

      let lastErr = null;
      for (const path of candidates) {
        try {
          const res = await fetch(path, { cache: "no-cache" });
          if (!res.ok) throw new Error(`manifest fetch failed (${res.status}) at ${path}`);
          const data = await res.json();
          manifest = (Array.isArray(data) ? data : []).map((b) => {
            const id = b.id || b.name || "";
            const p = b.path || (id ? `assets/books/${id}.md` : "");
            const title = b.title || titleFromBookId(id) || id || "Untitled";
            return { id, title, path: p };
          }).filter(b => b.id && b.path);

          return;
        } catch (e) {
          lastErr = e;
        }
      }
      // Fallback for local file:// usage (fetch is often blocked). If an embedded manifest exists, use it.
      try {
        if (window.EMBED_MANIFEST && Array.isArray(window.EMBED_MANIFEST)) {
          const data = window.EMBED_MANIFEST;
          manifest = (Array.isArray(data) ? data : []).map((b) => {
            const id = b.id || b.name || "";
            const p = b.path || (id ? `assets/books/${id}.md` : "");
            const title = b.title || titleFromBookId(id) || id || "Untitled";
            return { id, title, path: p };
          }).filter(b => b.id && b.path);
          return;
        }
      } catch (_) {}
      throw lastErr || new Error("manifest fetch failed");
    }

    async function loadBook(id, options = {}) {
      currentBookRaw = "";
      chapterList = [];
      currentBookPageMeta = [];
      currentChapterPageOffsets = [];
      hasExplicitChapters = false;
      currentChapterIndex = null;

      setSelectOptions(chapterSelect, [], "Loading…");
      setSelectOptions(pageStart, [], "Loading…");
      setSelectOptions(pageEnd, [], "Loading…");

      // Local library
      if (isLocalBookId(id)) {
        try {
          const rec = await localBookGet(stripLocalPrefix(id));
          if (!rec || typeof rec.markdown !== 'string') throw new Error('local book missing');
          currentBookRaw = rec.markdown;
          currentBookPageMeta = Array.isArray(rec.pageMeta) ? rec.pageMeta : [];
          hasExplicitChapters = countExplicitH1(currentBookRaw) > 0;
          if (hasExplicitChapters) {
            chapterList = parseChaptersFromMarkdown(currentBookRaw);
            rebuildChapterPageOffsets();
          }
          // Await so loadBook only resolves after render() + applyPendingReadingRestore().
          await refreshChapterAndPagesUI(options);
          return;
        } catch (e) {
          setSelectOptions(chapterSelect, [], "Failed to load local book");
          setSelectOptions(pageStart, [], "Failed to load local book");
          setSelectOptions(pageEnd, [], "Failed to load local book");
          console.error('Local book load error:', e);
          return;
        }
      }

      const entry = manifest.find(b => b.id === id);
      if (!entry) {
        setSelectOptions(chapterSelect, [], "Select a book first");
        setSelectOptions(pageStart, [], "Select a book first");
        setSelectOptions(pageEnd, [], "Select a book first");
        return;
      }

      try {
        const res = await fetch(entry.path, { cache: "no-cache" });
        if (!res.ok) throw new Error(`book fetch failed (${res.status}) at ${entry.path}`);
        currentBookRaw = await res.text();

        hasExplicitChapters = countExplicitH1(currentBookRaw) > 0;
        if (hasExplicitChapters) {
          chapterList = parseChaptersFromMarkdown(currentBookRaw);
          rebuildChapterPageOffsets();
        }

        await refreshChapterAndPagesUI(options);
      } catch (e) {
        // Fallback for local file:// usage: try embedded books
        try {
          if (window.EMBED_BOOKS && typeof window.EMBED_BOOKS[id] === "string") {
            currentBookRaw = window.EMBED_BOOKS[id];
            hasExplicitChapters = countExplicitH1(currentBookRaw) > 0;
            if (hasExplicitChapters) {
              chapterList = parseChaptersFromMarkdown(currentBookRaw);
              rebuildChapterPageOffsets();
            }
            await refreshChapterAndPagesUI(options);
            return;
          }
        } catch (_) {}

        setSelectOptions(chapterSelect, [], "Failed to load book");
        setSelectOptions(pageStart, [], "Failed to load book");
        setSelectOptions(pageEnd, [], "Failed to load book");
        console.error("Book load error:", e);
      }
    }

    // Returns the addPages / appendPages promise so that callers on the
    // reading-entry path can await full render completion before revealing pages.
    // Fire-and-forget callers (chapter select, page slice controls) simply ignore
    // the returned promise, which is safe — they don't use the restore path.
    function applySelectionToBulkInput(text, { append = false, preservePendingRestore = false, pageMeta = null } = {}) {
      bulkInput.value = String(text || "").trim();
      if (append) return appendPages({ pageMeta });
      return addPages({ preservePendingRestore, pageMeta });
    }

    // Events
    sourceSel.addEventListener("change", setSourceUI);
    setSourceUI();

    bookSelect.addEventListener("change", async () => {
      const id = bookSelect.value;
      if (!id) return;
      let restore = null;
      try {
        if (window.rcSync && typeof window.rcSync.getRestoreProgress === 'function') restore = await window.rcSync.getRestoreProgress(String(id));
      } catch (_) {}
      await loadBook(id, { restore });
    });

    chapterSelect.addEventListener("change", () => {
      const idx = parseInt(chapterSelect.value || "", 10);
      if (!Number.isFinite(idx)) return;

      // Snapshot the selected index into a local const before any async boundary
      // so a rapid second change cannot corrupt this handler's chapter resolution.
      const selectedIdx = idx;
      currentChapterIndex = selectedIdx;

      const chapterOffset = getCurrentChapterPageOffset();
      const chapterPages = applySourcePageMeta(parsePagesWithTitles(getCurrentChapterRaw()), currentBookPageMeta, chapterOffset);
      populatePagesSelect(chapterPages);

      // Immediately replace rendered page cards with the new chapter's content.
      // Routing through applySelectionToBulkInput → addPages() → render() is the
      // single authoritative card-replacement path. Calling it synchronously here
      // closes the race window between chapter assignment and card DOM update —
      // no Load button click required, no timing assumption.
      const chapterText = chapterPages.map(p => p.text).filter(Boolean).join("\n---\n");
      const pageMeta = chapterPages.map((p, idx) => ({ title: p.title || `Page ${idx + 1}`, sourcePageNumber: Number.isFinite(Number(p?.sourcePageNumber)) ? Number(p.sourcePageNumber) : (idx + 1) }));
      applySelectionToBulkInput(chapterText, { append: false, pageMeta });
    });

    // Keep end >= start
    pageStart.addEventListener("change", () => {
      const s = parseInt(pageStart.value || "0", 10);
      const e = parseInt(pageEnd.value || "0", 10);
      if (Number.isFinite(s) && Number.isFinite(e) && e < s) pageEnd.value = String(s);
    });
    pageEnd.addEventListener("change", () => {
      const s = parseInt(pageStart.value || "0", 10);
      const e = parseInt(pageEnd.value || "0", 10);
      if (Number.isFinite(s) && Number.isFinite(e) && e < s) pageStart.value = String(e);
    });

    loadBtn.addEventListener("click", () => {
      // Dual-purpose button: in Text mode, it just loads pages from the textarea.
      if (sourceSel.value === "text") {
        addPages();
        return;
      }

      // Book mode: load selected book/page slice into the textarea, then add pages.
      if (!currentBookRaw) return;
      if (!currentPages.length) return;

      const s = Math.max(0, parseInt(pageStart.value || "0", 10));
      const e = Math.max(s, parseInt(pageEnd.value || String(s), 10));

      const selectedPages = currentPages.slice(s, e + 1);
      const slice = selectedPages.map((p) => p.text).filter(Boolean);
      const pageMeta = selectedPages.map((p, idx) => ({ title: p.title || `Page ${s + idx + 1}`, sourcePageNumber: Number.isFinite(Number(p?.sourcePageNumber)) ? Number(p.sourcePageNumber) : (s + idx + 1) }));
      // Keep delimiter in a single JS string line (prevents accidental raw-newline parse errors)
      applySelectionToBulkInput(slice.join("\n---\n"), { append: false, pageMeta });
    });

    appendBtn.addEventListener("click", () => {
      // Dual-purpose button: in Text mode, append from textarea.
      if (sourceSel.value === "text") {
        appendPages();
        return;
      }

      // Book mode: append selected slice.
      if (!currentBookRaw) return;
      if (!currentPages.length) return;

      const s = Math.max(0, parseInt(pageStart.value || "0", 10));
      const e = Math.max(s, parseInt(pageEnd.value || String(s), 10));

      const selectedPages = currentPages.slice(s, e + 1);
      const slice = selectedPages.map((p) => p.text).filter(Boolean);
      const pageMeta = selectedPages.map((p, idx) => ({ title: p.title || `Page ${s + idx + 1}`, sourcePageNumber: Number.isFinite(Number(p?.sourcePageNumber)) ? Number(p.sourcePageNumber) : (s + idx + 1) }));

      applySelectionToBulkInput(slice.join("\n---\n"), { append: true, pageMeta });
    });

    async function populateBookSelectWithLocal() {
      // Populate server + local books in one dropdown.
      bookSelect.innerHTML = "";

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select a book…";
      bookSelect.appendChild(placeholder);

      // Local books
      let locals = [];
      try { locals = await localBooksGetAll(); } catch (_) { locals = []; }
      if (locals.length) {
        const og = document.createElement('optgroup');
        og.label = 'Saved on this device';
        locals
          .slice()
          .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
          .forEach((b) => {
            const opt = document.createElement('option');
            opt.value = `local:${b.id}`;
            opt.textContent = b.title || 'Untitled (Local)';
            og.appendChild(opt);
          });
        bookSelect.appendChild(og);
      }

      // Server books
      if (manifest.length) {
        const og = document.createElement('optgroup');
        og.label = 'Server books';
        manifest.forEach((b) => {
          const opt = document.createElement('option');
          opt.value = b.id;
          opt.textContent = b.title;
          og.appendChild(opt);
        });
        bookSelect.appendChild(og);
      }

      if (!locals.length && !manifest.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No books found';
        bookSelect.appendChild(opt);
      }
    }

    try {
      await loadManifest();
      await populateBookSelectWithLocal();
    } catch (e) {
      // Even if manifest fails, still show local library.
      manifest = [];
      await populateBookSelectWithLocal();
      console.error("Book manifest load error:", e);
    }

    // Expose a tiny hook so the import modal can refresh the dropdown after import.
    window.__rcRefreshBookSelect = async () => {
      try { await populateBookSelectWithLocal(); } catch (_) {}
    };
    // Expose context helper so out-of-closure callers (startFocusedPageTts,
    // focusReadingPage, _installScrollPageTracker) can reach it.
    window.getReadingTargetContext = getReadingTargetContext;
    // Expose the authoritative book load path for the runtime reading-entry API.
    window.__rcLoadBook = loadBook;
  }



  async function addPages(options = {}) {
    const input = document.getElementById("bulkInput").value;
    goalTime = parseInt(document.getElementById("goalTimeInput").value);
    goalCharCount = parseInt(document.getElementById("goalCharInput").value);
    if (!input || !input.trim()) return;

    if (pages.length > 0) resetSession({ confirm: false, preservePendingRestore: !!options.preservePendingRestore });

    const newPages = splitIntoPages(input);
    const incomingMeta = Array.isArray(options.pageMeta) ? options.pageMeta : [];
    const nextPageMeta = [];
    for (let pageIdx = 0; pageIdx < newPages.length; pageIdx++) {
      const pageText = newPages[pageIdx];
      const pageHash = await stableHashText(pageText);
      let consolidation = "";
      let rating = 0;
      let isSandstone = false;
      let aiExpanded = false;
      let aiFeedbackRaw = "";
      let aiAt = null;
      let aiRating = null;
      try {
        const rawC = localStorage.getItem(getConsolidationCacheKey(pageHash));
        if (rawC) {
          const rec = JSON.parse(rawC);
          if (rec && typeof rec.consolidation === 'string') consolidation = rec.consolidation;
          const r = Number(rec?.rating || 0);
          rating = Number.isFinite(r) ? r : 0;
          isSandstone = !!rec?.isSandstone;
          aiExpanded = !!rec?.aiExpanded;
          aiFeedbackRaw = typeof rec?.aiFeedbackRaw === 'string' ? rec.aiFeedbackRaw : "";
          aiAt = rec?.aiAt ?? null;
          aiRating = rec?.aiRating ?? null;
        }
      } catch (_) {}

      const assignedIndex = pages.length;
      pages.push(pageText);
      nextPageMeta.push({
        title: incomingMeta[pageIdx]?.title || `Page ${assignedIndex + 1}`,
        sourcePageNumber: Number.isFinite(Number(incomingMeta[pageIdx]?.sourcePageNumber)) ? Number(incomingMeta[pageIdx].sourcePageNumber) : (assignedIndex + 1)
      });
      pageData.push({
        text: pageText,
        consolidation,
        aiExpanded,
        aiFeedbackRaw,
        aiAt,
        aiRating,
        charCount: (consolidation || "").length,
        completedOnTime: true,
        isSandstone,
        rating,
        pageHash,
        anchors: null,
        anchorVersion: 0,
        anchorsMeta: null
      });
    }

    document.getElementById("bulkInput").value = "";
    try { if (typeof setPageMeta === 'function') setPageMeta(nextPageMeta); } catch (_) {}
    schedulePersistSession();
    render();
    checkSubmitButton();
  }

  async function appendPages(options = {}) {
    const input = document.getElementById("bulkInput").value;
    goalTime = parseInt(document.getElementById("goalTimeInput").value);
    goalCharCount = parseInt(document.getElementById("goalCharInput").value);
    if (!input || !input.trim()) return;

    const newPages = splitIntoPages(input);
    const incomingMeta = Array.isArray(options.pageMeta) ? options.pageMeta : [];
    const nextPageMeta = (typeof getPageMetaSnapshot === 'function') ? getPageMetaSnapshot() : [];
    for (let pageIdx = 0; pageIdx < newPages.length; pageIdx++) {
      const pageText = newPages[pageIdx];
      const pageHash = await stableHashText(pageText);
      let consolidation = "";
      let rating = 0;
      let isSandstone = false;
      let aiExpanded = false;
      let aiFeedbackRaw = "";
      let aiAt = null;
      let aiRating = null;
      try {
        const rawC = localStorage.getItem(getConsolidationCacheKey(pageHash));
        if (rawC) {
          const rec = JSON.parse(rawC);
          if (rec && typeof rec.consolidation === 'string') consolidation = rec.consolidation;
          const r = Number(rec?.rating || 0);
          rating = Number.isFinite(r) ? r : 0;
          isSandstone = !!rec?.isSandstone;
          aiExpanded = !!rec?.aiExpanded;
          aiFeedbackRaw = typeof rec?.aiFeedbackRaw === 'string' ? rec.aiFeedbackRaw : "";
          aiAt = rec?.aiAt ?? null;
          aiRating = rec?.aiRating ?? null;
        }
      } catch (_) {}

      const assignedIndex = pages.length;
      pages.push(pageText);
      nextPageMeta.push({
        title: incomingMeta[pageIdx]?.title || `Page ${assignedIndex + 1}`,
        sourcePageNumber: Number.isFinite(Number(incomingMeta[pageIdx]?.sourcePageNumber)) ? Number(incomingMeta[pageIdx].sourcePageNumber) : (assignedIndex + 1)
      });
      pageData.push({
        text: pageText,
        consolidation,
        aiExpanded,
        aiFeedbackRaw,
        aiAt,
        aiRating,
        charCount: (consolidation || "").length,
        completedOnTime: true,
        isSandstone,
        rating,
        pageHash,
        anchors: null,
        anchorVersion: 0,
        anchorsMeta: null
      });
    }

    document.getElementById("bulkInput").value = "";
    try { if (typeof setPageMeta === 'function') setPageMeta(nextPageMeta); } catch (_) {}
    schedulePersistSession();
    render();
    checkSubmitButton();
  }

  function resetSession({ confirm = true, clearPersistedWork = false, clearAnchors = false, preservePendingRestore = false } = {}) {
    if (confirm && !window.confirm("Clear loaded pages and remove your consolidations and feedback?")) return false;

    if (clearPersistedWork) {
      clearPersistedWorkForPageHashes(pageData.map(p => p?.pageHash), { clearAnchors });
    }
    pages = [];
    pageData = [];
    try { if (typeof setPageMeta === 'function') setPageMeta([]); } catch (_) {}
    timers = [];
    intervals.forEach(i => clearInterval(i));
    intervals = [];
    sandSound.pause();
    document.getElementById("pages").innerHTML = "";
    document.getElementById("submitBtn").disabled = true;
    document.getElementById("verdictSection").style.display = "none";
    lastFocusedPageIndex = -1;
    // PATCH(source-continuity): Clear the pending restore index so stale boot-time
    // restore state from the previous session cannot leak into the next render().
    // loadPersistedSessionIfAny() sets __rcPendingRestorePageIndex from the old
    // session's page index. Without this clear, applyPendingReadingRestore() —
    // called at the end of render() — can scroll to that stale index in the new
    // source, placing TTS and lastFocusedPageIndex at the wrong page.
    if (!preservePendingRestore) window.__rcPendingRestorePageIndex = -1;
    evaluationPhase = false;
    // Clear reading target — no source is active after a reset.
    try { if (typeof setReadingTarget === 'function') setReadingTarget({ sourceType: '', bookId: '', chapterIndex: -1, pageIndex: 0 }); } catch (_) {}
    clearPersistedSession();
    return true;
  }

  function render() {
        // Stop any active TTS and autoplay countdown before rebuilding the DOM
    try { ttsStop(); } catch (_) {}

    // Establish authoritative reading target for this source load.
    // chapterIndex comes from closure-local currentChapterIndex (in scope here).
    // pageIndex starts at 0; applyPendingReadingRestore() overrides it if a
    // restore is pending for this source.
    try {
      const _ctx = getReadingTargetContext();
      if (typeof setReadingTarget === 'function') setReadingTarget({ sourceType: _ctx.sourceType, bookId: _ctx.bookId, chapterIndex: _ctx.chapterIndex, pageIndex: 0 });
    } catch (_) {}

    const container = document.getElementById("pages");
    container.innerHTML = "";

    const _isReadingMode = appMode === 'reading';

    pages.forEach((text, i) => {
      timers[i] ??= 0;

      const page = document.createElement("div");
      page.className = "page";
      page.dataset.pageIndex = String(i);

      // Evaluation/consolidation block is intentionally omitted from the DOM
      // in reading mode. applyModeVisibility() handles display toggling when
      // mode changes, but in reading mode these elements simply do not exist.
      page.innerHTML = `
        <div class="page-header">${(typeof getDisplayPageLabel === "function") ? getDisplayPageLabel(i) : `Page ${i + 1}`}</div>
        <div class="page-text">${escapeHtml(text)}</div>

        ${_isReadingMode ? '' : `
        <div class="anchors-row">
          <div class="anchors-ui anchors-ui--right">
            <div class="anchors-counter" title="Anchors">Anchors Found: 0/0</div>
            <button type="button" class="top-btn hint-btn">Hint</button>
          </div>
        </div>
        `}

        <div class="page-actions">
          <button type="button" class="top-btn tts-btn" data-tts="page" data-page="${i}">🔊 Read page</button>
        </div>

        <div class="anchors-nav">
          <button class="top-btn next-btn" onclick="goToNext(${i})">▶ Next</button>
        </div>

        ${_isReadingMode ? '' : `
        <div class="page-header">Consolidation</div>

        <div class="sand-wrapper">
          <textarea placeholder="What was this page really about?"></textarea>
          <div class="sand-layer"></div>
        </div>

        <div class="info-row">
          <div class="counter-section">
            <div class="timer">Timer: ${timers[i]} / ${goalTime}</div>
            <div class="char-counter">Characters: <span class="char-count">0</span> / ${goalCharCount}</div></div>

          <div class="evaluation-section">
            <div class="evaluation-label">Evaluation</div>
            <div class="stars locked" data-page="${i}">
              <span class="star" data-value="1">🧭</span>
              <span class="star" data-value="2">🧭</span>
              <span class="star" data-value="3">🧭</span>
              <span class="star" data-value="4">🧭</span>
              <span class="star" data-value="5">🧭</span>
            </div>
          </div>

          <div class="action-buttons">
            <button class="ai-btn" data-page="${i}" style="display: none;">▼ AI Evaluate&nbsp;&nbsp;</button>
          </div>
        </div>

        <div class="ai-feedback" data-page="${i}" style="display: none;">
          <!-- AI feedback will be inserted here -->
        </div>
        `}
      `;

      const textarea = page.querySelector("textarea");
      const sand = page.querySelector(".sand-layer");
      const timerDiv = page.querySelector(".timer");
      const wrapper = page.querySelector(".sand-wrapper");
      const charCountSpan = page.querySelector(".char-count");
      const starsDiv = page.querySelector(".evaluation-section .stars");

      // TTS: Read page text
      const ttsPageBtn = page.querySelector('.tts-btn[data-tts="page"]');
      if (ttsPageBtn) {
        try {
          const support = (typeof getTtsSupportStatus === 'function') ? getTtsSupportStatus() : null;
          if (support && !support.playable) {
            ttsPageBtn.disabled = true;
            ttsPageBtn.setAttribute('aria-disabled', 'true');
            ttsPageBtn.title = support.reason || 'Playback unavailable';
          }
        } catch (_) {}
        ttsPageBtn.addEventListener("click", () => {
          if (AUTOPLAY_STATE.countdownPageIndex === i) {
            ttsAutoplayCancelCountdown();
            return;
          }
          try { currentPageIndex = i; } catch (_) {}
          lastFocusedPageIndex = i;
          // Update authoritative reading target to this page before speaking.
          try {
            const _ctx = getReadingTargetContext();
            if (typeof setReadingTarget === 'function') setReadingTarget({ sourceType: _ctx.sourceType, bookId: _ctx.bookId, chapterIndex: _ctx.chapterIndex, pageIndex: i });
          } catch (_) {}
          ttsSpeakQueue(
            (typeof readingTargetToKey === 'function') ? readingTargetToKey(window.__rcReadingTarget) : `page-${i}`,
            [text]
          );
        });
      }


      // Character tracking — only present in non-reading-mode cards.
      if (textarea && charCountSpan) {
        textarea.value = pageData[i].consolidation || "";
        charCountSpan.textContent = Math.min(pageData[i].charCount, goalCharCount);

        textarea.addEventListener("input", (e) => {
          const count = e.target.value.length;
          pageData[i].consolidation = e.target.value;
          pageData[i].charCount = count;
          charCountSpan.textContent = Math.min(count, goalCharCount);

          // Anchors: deterministic matching (UI-only; no inference).
          updateAnchorsUIForPage(page, i, e.target.value);

          // Check if all pages have text to unlock compasses
          checkCompassUnlock();
        });

        // Persist learner work when they leave the field (reduces churn while typing).
        textarea.addEventListener("blur", () => {
          schedulePersistSession();
        });
      }

      // Clicking anywhere on the page should make "Next" advance from that page.
      page.addEventListener("pointerdown", () => {
        lastFocusedPageIndex = i;
      });

      // Timer events and keyboard nav — only present in non-reading-mode cards.
      if (textarea) {
        textarea.addEventListener("focus", () => {

          lastFocusedPageIndex = i;
          // Scroll to show entire page card (passage + textarea) instead of centering on textarea
          const pageCard = textarea.closest('.page');
          pageCard.scrollIntoView({
            behavior: 'instant',
            block: 'start',
            inline: 'nearest'
          });

          // Page turn immersion: activate stripe if starting fresh
          if (pageData[i].charCount === 0) {
            page.classList.add('page-active');
            if (!allSoundsMuted) {
              pageTurnSound.currentTime = 0;
              pageTurnSound.play();
            }
          }

          // Anchors (lazy): first meaningful engagement triggers anchor generation for this page
          // only when the active runtime policy allows anchors.
          try {
            const policyApi = window.rcPolicy || {};
            const canUseAnchors = typeof policyApi.canUseAnchors === 'function' ? !!policyApi.canUseAnchors() : false;
            if (canUseAnchors) hydrateAnchorsIntoPageEl(page, i);
          } catch (_) {}

          startTimer(i, sand, timerDiv, wrapper, textarea);
        });

        textarea.addEventListener("blur", () => {
          // Deactivate page stripe when leaving
          page.classList.remove('page-active');
          stopTimer(i);
          checkCompassUnlock(); // Check if compasses should unlock when user leaves textarea
        });

        // Keyboard navigation (iPad + desktop)
        textarea.addEventListener("keydown", (e) => {
          // Enter: unfocus textarea (Shift+Enter remains normal newline behavior)
          // This makes iPad flow smoother: user can hit Enter to dismiss keyboard,
          // then press Enter again (global) to jump to next box or click AI.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            // Prevent the global Enter handler from running in the same event.
            // (blur changes activeElement, which would otherwise trigger goToNext).
            e.stopPropagation();
            textarea.blur();
            return;
          }

          // Esc: unfocus textarea
          if (e.key === "Escape") {
            e.preventDefault();
            textarea.blur();
          }
        });
      }

      // Compass click handlers — only present in non-reading-mode cards.
      if (starsDiv) {
        const stars = starsDiv.querySelectorAll(".star");
        stars.forEach(star => {
          star.addEventListener("click", () => {
            if (starsDiv.classList.contains("locked")) return;
            const value = parseInt(star.dataset.value);
            setRating(i, value, stars);
          });
        });
      }
      
      // AI button click handler
      const aiBtn = page.querySelector(".ai-btn");
      if (aiBtn) {
        aiBtn.addEventListener("click", () => evaluatePageWithAI(i));
      }

      // Restore AI panel visibility + content if it was previously opened.
      // (User-facing state; persisted per pageHash.)
      const feedbackDiv = page.querySelector(`.ai-feedback[data-page="${i}"]`);
      if (aiBtn && feedbackDiv) {
        const hasFeedback = String(pageData[i]?.aiFeedbackRaw || '').trim().length > 0;
        if (hasFeedback) {
          // Ensure the button is available if there is saved feedback.
          aiBtn.style.display = 'block';
          // If the panel is expanded, show it and rebuild the formatted UI.
          if (pageData[i]?.aiExpanded) {
            feedbackDiv.style.display = 'block';
            aiBtn.textContent = '▲ AI Evaluate';
            // Rehydrate the formatted view from persisted raw feedback.
            try {
              displayAIFeedback(i, pageData[i].aiFeedbackRaw, null, feedbackDiv);
            } catch (e) {
              // Fallback: show raw text if formatted renderer fails.
              feedbackDiv.textContent = String(pageData[i].aiFeedbackRaw || '');
            }
          } else {
            feedbackDiv.style.display = 'none';
            aiBtn.textContent = '▼ AI Evaluate';
          }
        }
      }
      
      // Restore previous rating — only present in non-reading-mode cards.
      if (starsDiv && pageData[i].rating > 0) {
        const evalStars = starsDiv.querySelectorAll(".star");
        evalStars.forEach((star, starIdx) => {
          if (starIdx < pageData[i].rating) {
            star.classList.add("filled");
          }
        });
        // Stop animation since this page is already rated
        starsDiv.classList.add('rated');
      }

      // Restore sandstone state if applicable — only present in non-reading-mode cards.
      if (wrapper && sand && textarea) {
        if (pageData[i].isSandstone) {
          wrapper.classList.add("sandstone");
          textarea.readOnly = true;
          const evalStars = page.querySelector(".evaluation-section .stars");
          if (evalStars) {
            evalStars.classList.add("locked");
            evalStars.style.opacity = "0.15";
          }
          sand.style.height = "100%";
        } else if (timers[i] > 0) {
          // Restore partial sand if timer was running
          const sandStartTime = goalTime * (1 - SAND_START_PERCENTAGE);
          const sandDuration = goalTime * SAND_START_PERCENTAGE;
          if (timers[i] >= sandStartTime) {
            const sandElapsed = timers[i] - sandStartTime;
            const pct = Math.min(sandElapsed / sandDuration, 1);
            sand.style.height = `${pct * 100}%`;
          }
        }
      }

      container.appendChild(page);

      // Anchors: bind hint button.
      // IMPORTANT cost control: do NOT hydrate anchors for every page on load.
      // We generate anchors lazily on first meaningful interaction (focus / hint / evaluate).
      bindHintButton(page, i);

    });
    
    // Check states after rendering
    checkCompassUnlock();
    checkSubmitButton();

    
    applyModeVisibility();
    if (typeof applyTierAccess === 'function') applyTierAccess();
    try { applyPendingReadingRestore(); } catch (_) {}
    try { if (typeof updateDiagnostics === 'function') updateDiagnostics(); } catch (_) {}
    _installScrollPageTracker();
    try { if (typeof window.__jublyAfterRender === 'function') window.__jublyAfterRender(); } catch (_) {}
  }

  function applyModeVisibility() {
    const isReading = appMode === 'reading';

    // Hide Time/Characters/Difficulty knobs in reading mode.
    // goal-actions (Load/Add/Clear Pages) is a sibling div and always visible.
    const goalRow = document.querySelector('.goal-time-row');
    if (goalRow) goalRow.style.display = isReading ? 'none' : '';

    const thesisRow = document.getElementById('thesisRow');
    if (thesisRow) thesisRow.style.display = (appMode === 'research') ? '' : 'none';

    document.querySelectorAll('.page').forEach(pageEl => {
      const anchorsRow  = pageEl.querySelector('.anchors-row');
      const sandWrapper = pageEl.querySelector('.sand-wrapper');
      const infoRow     = pageEl.querySelector('.info-row');
      const aiFeedback  = pageEl.querySelector('.ai-feedback');
      const actionBtns  = pageEl.querySelector('.action-buttons');
      const headers     = pageEl.querySelectorAll('.page-header');
      const consolidationHeader = headers.length > 1 ? headers[1] : null;

      [anchorsRow, sandWrapper, infoRow, actionBtns, consolidationHeader]
        .forEach(el => { if (el) el.style.display = isReading ? 'none' : ''; });

      // ai-feedback has its own per-page visibility state managed by the AI
      // evaluation flow. Only force-hide it in reading mode — never force-show
      // it when switching modes, or unexpanded panels will appear prematurely.
      if (aiFeedback && isReading) aiFeedback.style.display = 'none';
    });

    const submitBtn = document.getElementById('submitBtn');
    const verdictSection = document.getElementById('verdictSection');
    if (submitBtn) submitBtn.style.display = isReading ? 'none' : '';
    if (verdictSection) verdictSection.style.display = isReading ? 'none' : '';
  }

  function startTimer(i, sand, timerDiv, wrapper, textarea) {
    if (intervals[i]) return;

    let sandSoundStarted = false;

    intervals[i] = setInterval(() => {
      timers[i]++;
      
      // Sand starts when configured percentage of time remains
      const sandStartTime = goalTime * (1 - SAND_START_PERCENTAGE);
      const sandDuration = goalTime * SAND_START_PERCENTAGE;
      
      if (timers[i] >= sandStartTime) {
        // Start sand sound when sand starts (if not muted)
        if (!sandSoundStarted) {
          sandSound.currentTime = 0;
          if (!allSoundsMuted) {
            if (window.playSfx) window.playSfx(sandSound, { restart: true, loop: true, retries: 3, delay: 120 });
            else sandSound.play();
          }
          sandSoundStarted = true;
        }
        
        const sandElapsed = timers[i] - sandStartTime;
        const pct = Math.min(sandElapsed / sandDuration, 1);
        sand.style.height = `${pct * 100}%`;
      }
      
      timerDiv.textContent = `Timer: ${timers[i]} / ${goalTime}`;

      if (timers[i] >= goalTime) {
        clearInterval(intervals[i]);
        intervals[i] = null;

        sandSound.pause();
        if (!allSoundsMuted) {
          stoneSound.currentTime = 0;
          if (window.playSfx) window.playSfx(stoneSound, { restart: true, loop: false, retries: 4, delay: 160 });
          else stoneSound.play();
        }

        wrapper.classList.add("sandstone");
        textarea.readOnly = true;
        textarea.blur();
        
        // Mark page as sandstoned and failed timing
        pageData[i].isSandstone = true;
        pageData[i].completedOnTime = false;
        pageData[i].editedAt = Date.now();
        
        // Block compasses on this page permanently
        const starsDiv = wrapper.closest(".page").querySelector(".evaluation-section .stars");
        starsDiv.classList.add("locked");
        starsDiv.style.opacity = "0.15";
        
        checkSubmitButton();
        schedulePersistSession();
      }
    }, 1000);
  }

  function stopTimer(i) {
    clearInterval(intervals[i]);
    intervals[i] = null;
    sandSound.pause();
  }

    /**
   * Clear Session (single reset button)
   * - Clears user-facing state: loaded pages + learner work.
   * - Keeps anchors (anchors are version-gated and backend-owned).
   */
  // Single user-facing reset: clears the currently loaded pages and any work tied to them.
  // Keeps anchors (they are version-gated and backend-owned).
  function clearPages() {
    const ok = resetSession({ confirm: true, clearPersistedWork: true, clearAnchors: false });
    if (ok) {
      // Belt-and-suspenders: ensure any pending debounced save can't resurrect state.
      try { persistSessionNow(); } catch (_) {}
      render();
      try { updateDiagnostics(); } catch (_) {}
    }
  }

  // Back-compat alias (older HTML/button wiring)
  function clearSession() { return clearPages(); }

// ===================================

  // 🗂️ Manage Library UI
  // ===================================

  (function initManageLibraryModal() {
    const openBtn = document.getElementById('manageLibraryBtn');
    const modal = document.getElementById('manageLibraryModal');
    const closeBtn = document.getElementById('manageLibraryClose');
    const listEl = document.getElementById('manageLibraryList');
    const deletedModal = document.getElementById('deletedFilesModal');
    const deletedCloseBtn = document.getElementById('deletedFilesClose');
    const deletedListEl = document.getElementById('deletedFilesList');
    const deletedManageBtn = document.getElementById('profile-deleted-manage-btn');
    const deletedCountEl = document.getElementById('profile-deleted-count');
    if (!openBtn || !modal || !listEl) return;

    function emitLibraryChanged() {
      try { window.dispatchEvent(new CustomEvent('rc:local-library-changed')); } catch (_) {}
    }
    function emitDeletedChanged() {
      try { window.dispatchEvent(new CustomEvent('rc:deleted-library-changed')); } catch (_) {}
    }

    async function refreshBookSelect() {
      try { if (typeof window.__rcRefreshBookSelect === 'function') await window.__rcRefreshBookSelect(); } catch (_) {}
    }

    async function renderDeletedCount() {
      if (!deletedCountEl) return;
      let deleted = [];
      try { deleted = await localDeletedBooksGetAll(); } catch (_) { deleted = []; }
      deletedCountEl.textContent = `${deleted.length} file${deleted.length === 1 ? '' : 's'} waiting in Deleted Files`;
    }

    function show() {
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      render();
    }
    function hide() {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }
    function showDeleted() {
      if (!deletedModal || !deletedListEl) return;
      deletedModal.style.display = 'flex';
      deletedModal.setAttribute('aria-hidden', 'false');
      renderDeleted();
    }
    function hideDeleted() {
      if (!deletedModal) return;
      deletedModal.style.display = 'none';
      deletedModal.setAttribute('aria-hidden', 'true');
    }

    async function render() {
      listEl.innerHTML = '';
      let books = [];
      try { books = await localBooksGetAll(); } catch (_) { books = []; }

      const count = books.length;
      const limit = (window.rcPolicy && typeof window.rcPolicy.getImportSlotLimit === 'function')
        ? window.rcPolicy.getImportSlotLimit()
        : null;
      const meta = document.createElement('div');
      meta.className = 'import-status';
      meta.textContent = limit == null
        ? `Saved on this device: ${count}`
        : `Saved on this device: ${count}/${limit}`;
      listEl.appendChild(meta);

      if (!books.length) {
        const empty = document.createElement('div');
        empty.className = 'import-status';
        empty.textContent = 'No local books yet. Use Import Book to add one.';
        listEl.appendChild(empty);
        return;
      }

      books
        .slice()
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .forEach((b) => {
          const row = document.createElement('div');
          row.className = 'library-row';

          const left = document.createElement('div');
          const t = document.createElement('div');
          t.className = 'library-row-title';
          t.textContent = b.title || 'Untitled';
          const m = document.createElement('div');
          m.className = 'library-row-meta';
          const kb = Math.round((b.byteSize || 0) / 1024);
          const pages = (String(b.markdown || '').match(/^\s*##\s+/gm) || []).length;
          m.textContent = `${pages} pages • ~${kb} KB • ${new Date(b.createdAt || Date.now()).toLocaleDateString()}`;
          left.appendChild(t);
          left.appendChild(m);

          const actions = document.createElement('div');
          actions.className = 'library-row-actions';
          const del = document.createElement('button');
          del.className = 'btn-danger';
          del.type = 'button';
          del.textContent = 'Delete';
          del.addEventListener('click', async () => {
            const ok = confirm(`Move “${b.title || 'this book'}” to Deleted Files?\n\nIt will leave your Library now, stay on this device, and can be restored later from Profile.`);
            if (!ok) return;
            try {
              await moveLocalBookToDeleted(b.id);
              await refreshBookSelect();
              emitLibraryChanged();
              emitDeletedChanged();
              await renderDeletedCount();
              render();
            } catch (_) {
              alert('Delete failed.');
            }
          });
          actions.appendChild(del);

          row.appendChild(left);
          row.appendChild(actions);
          listEl.appendChild(row);
        });
    }

    async function renderDeleted() {
      if (!deletedListEl) return;
      deletedListEl.innerHTML = '';
      let deleted = [];
      try { deleted = await localDeletedBooksGetAll(); } catch (_) { deleted = []; }
      const info = document.createElement('div');
      info.className = 'import-status';
      info.textContent = 'Deleted Files use this device storage until you permanently delete them. Restore puts the book back in Library.';
      deletedListEl.appendChild(info);
      if (!deleted.length) {
        const empty = document.createElement('div');
        empty.className = 'import-status';
        empty.textContent = 'No deleted files are waiting here.';
        deletedListEl.appendChild(empty);
        await renderDeletedCount();
        return;
      }
      deleted
        .slice()
        .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0))
        .forEach((b) => {
          const row = document.createElement('div');
          row.className = 'library-row';
          const left = document.createElement('div');
          const t = document.createElement('div');
          t.className = 'library-row-title';
          t.textContent = b.title || 'Untitled';
          const m = document.createElement('div');
          m.className = 'library-row-meta';
          const kb = Math.round((b.byteSize || 0) / 1024);
          const deletedOn = new Date(b.deletedAt || Date.now()).toLocaleDateString();
          m.textContent = `~${kb} KB • deleted ${deletedOn}`;
          left.appendChild(t);
          left.appendChild(m);
          const actions = document.createElement('div');
          actions.className = 'library-row-actions';
          const restore = document.createElement('button');
          restore.className = 'btn-primary';
          restore.type = 'button';
          restore.textContent = 'Restore';
          restore.addEventListener('click', async () => {
            try {
              await restoreDeletedLocalBook(b.id);
              await refreshBookSelect();
              emitLibraryChanged();
              emitDeletedChanged();
              await renderDeletedCount();
              renderDeleted();
            } catch (_) {
              alert('Restore failed.');
            }
          });
          const purge = document.createElement('button');
          purge.className = 'btn-danger';
          purge.type = 'button';
          purge.textContent = 'Delete';
          purge.addEventListener('click', async () => {
            const ok = confirm(`Permanently delete “${b.title || 'this book'}”?\n\nThis removes it from Deleted Files and frees the device storage.`);
            if (!ok) return;
            try {
              await permanentlyDeleteLocalBook(b.id);
              emitDeletedChanged();
              await renderDeletedCount();
              renderDeleted();
            } catch (_) {
              alert('Delete failed.');
            }
          });
          actions.appendChild(restore);
          actions.appendChild(purge);
          row.appendChild(left);
          row.appendChild(actions);
          deletedListEl.appendChild(row);
        });
      await renderDeletedCount();
    }

    openBtn.addEventListener('click', show);
    closeBtn?.addEventListener('click', hide);
    modal.addEventListener('click', (e) => { if (e.target === modal) hide(); });
    deletedManageBtn?.addEventListener('click', showDeleted);
    deletedCloseBtn?.addEventListener('click', hideDeleted);
    deletedModal?.addEventListener('click', (e) => { if (e.target === deletedModal) hideDeleted(); });
    window.addEventListener('rc:deleted-library-changed', () => { renderDeletedCount().catch(() => {}); });
    renderDeletedCount().catch(() => {});
  })();

  // ===================================

// ─── Scroll-based active-page tracker ────────────────────────────────────────
//
// lastFocusedPageIndex is the runtime truth for active page. It is already
// written by all explicit navigation paths (pointer, focus, goToNext, TTS skip,
// restore). The one gap: user scrolls without clicking. Without this tracker,
// lastFocusedPageIndex becomes stale after restore or pointer interaction, and
// startFocusedPageTts / progress bar both return the wrong page.
//
// This installs one passive scroll listener (idempotent — safe to call after
// every render()). On each scroll frame it measures the current visible page
// via inferCurrentPageIndex() and writes the result into lastFocusedPageIndex.
// inferCurrentPageIndex() is the measurement tool; lastFocusedPageIndex stays
// the runtime state; all existing consumers stay unchanged.
//
// Guards:
//   pages.length > 0       — skip if no content is loaded
//   rect.height > 0        — skip if pages are in a hidden section (rect = 0)
function _installScrollPageTracker() {
  if (window.__rcScrollPageTrackerInstalled) return;
  window.__rcScrollPageTrackerInstalled = true;
  var raf = 0;
  var prevIdx = -1;
  window.addEventListener('scroll', function () {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      try {
        if (!Array.isArray(pages) || !pages.length) return;
        // Measure the visible page by viewport proximity ONLY.
        // inferCurrentPageIndex() is intentionally not used here: it prioritises
        // document.activeElement, which stays on the last-clicked element (e.g. a
        // "Read Page" button inside a .page card) after release. That causes the
        // tracker to keep reporting the wrong page index even after the user has
        // manually scrolled to a different page.
        const pageEls = Array.from(document.querySelectorAll('.page'));
        if (!pageEls.length) return;
        let bestEl = null, bestIdx = -1, bestDist = Infinity;
        for (const el of pageEls) {
          const rect = el.getBoundingClientRect();
          if (rect.height <= 0) continue; // skip hidden / collapsed pages
          const dataIdx = parseInt(el.dataset.pageIndex || '-1', 10);
          if (Number.isNaN(dataIdx) || dataIdx < 0) continue;
          const dist = Math.abs(rect.top);
          if (dist < bestDist) { bestDist = dist; bestIdx = dataIdx; bestEl = el; }
        }
        if (!bestEl || !Number.isFinite(bestIdx) || bestIdx < 0) return;
        // Guard: skip if the winning element is in a hidden section (double-check).
        if (bestEl.getBoundingClientRect().height <= 0) return;
        lastFocusedPageIndex = bestIdx;
        updateReadingMetricsPage(bestIdx);
        // Keep reading target in sync so bottom-bar Play speaks the scrolled-to page.
        try {
          const _ctx = window.getReadingTargetContext();
          if (typeof setReadingTarget === 'function') setReadingTarget({ sourceType: _ctx.sourceType, bookId: _ctx.bookId, chapterIndex: _ctx.chapterIndex, pageIndex: bestIdx });
        } catch (_) {}
        // Queue progress sync only when the page actually changed.
        if (bestIdx !== prevIdx) {
          prevIdx = bestIdx;
          try { queueCurrentReadingProgress('scroll-tracker'); } catch (_) {}
        }
      } catch (_) {}
    });
  }, { passive: true });
}



let _activeReadingMetricsSession = null;

function beginReadingMetricsSession(bookId, totalPages) {
  const safeBookId = String(bookId || '');
  if (!safeBookId) return;
  const startingPageIndex = Math.max(0, getFocusedOrInferredReadingPageIndex());
  const now = Date.now();
  _activeReadingMetricsSession = {
    bookId: safeBookId,
    totalPages: Math.max(1, Number(totalPages) || 1),
    startingPageIndex,
    lastPageIndex: startingPageIndex,
    pagesAdvanced: 0,
    startedAt: new Date(now).toISOString(),
    lastResumeAt: document.hidden ? 0 : now,
    accumulatedMs: 0,
  };
}

function pauseReadingMetricsSession() {
  if (!_activeReadingMetricsSession || !_activeReadingMetricsSession.lastResumeAt) return;
  _activeReadingMetricsSession.accumulatedMs += Math.max(0, Date.now() - _activeReadingMetricsSession.lastResumeAt);
  _activeReadingMetricsSession.lastResumeAt = 0;
}

function resumeReadingMetricsSession() {
  if (!_activeReadingMetricsSession || _activeReadingMetricsSession.lastResumeAt) return;
  _activeReadingMetricsSession.lastResumeAt = Date.now();
}

function updateReadingMetricsPage(index) {
  if (!_activeReadingMetricsSession) return;
  const idx = Math.max(0, Number(index) || 0);
  if (idx !== _activeReadingMetricsSession.lastPageIndex) {
    _activeReadingMetricsSession.pagesAdvanced += 1;
    _activeReadingMetricsSession.lastPageIndex = idx;
  }
}

function finalizeReadingMetricsSession() {
  if (!_activeReadingMetricsSession) return null;
  pauseReadingMetricsSession();
  const session = _activeReadingMetricsSession;
  _activeReadingMetricsSession = null;
  const elapsedSeconds = Math.max(0, Math.round(session.accumulatedMs / 1000));
  const completed = session.totalPages > 0 && session.lastPageIndex >= (session.totalPages - 1);
  const summary = (window.rcReadingMetrics && typeof window.rcReadingMetrics.getReadingBookSummary === 'function')
    ? window.rcReadingMetrics.getReadingBookSummary(session.bookId, session.totalPages)
    : null;
  const nextTotal = Math.max(0, Number(summary?.totalReadingSeconds || 0)) + elapsedSeconds;
  try {
    if (window.rcReadingMetrics && typeof window.rcReadingMetrics.upsertReadingBookSummary === 'function') {
      window.rcReadingMetrics.upsertReadingBookSummary({
        bookId: session.bookId,
        totalPages: session.totalPages,
        lastPageIndex: session.lastPageIndex,
        totalReadingSeconds: nextTotal,
        lastOpenedAt: new Date().toISOString(),
        completed,
        completedAt: completed ? new Date().toISOString() : (summary?.completedAt || null)
      });
    }
    if (window.rcReadingMetrics && typeof window.rcReadingMetrics.appendReadingSession === 'function') {
      if (elapsedSeconds >= 60 || session.pagesAdvanced >= 1) {
        const sessionEntry = {
          bookId: session.bookId,
          startedAt: session.startedAt,
          endedAt: new Date().toISOString(),
          elapsedSeconds,
          pagesAdvanced: session.pagesAdvanced,
          completed,
        };
        window.rcReadingMetrics.appendReadingSession(sessionEntry);
        try { if (window.rcSync && typeof window.rcSync.recordReadingSession === 'function') window.rcSync.recordReadingSession(sessionEntry).catch(() => {}); } catch (_) {}
      }
    }
  } catch (_) {}
  return { elapsedSeconds, completed, pagesAdvanced: session.pagesAdvanced, bookId: session.bookId };
}

try {
  document.addEventListener('visibilitychange', () => {
    if (!_activeReadingMetricsSession) return;
    if (document.hidden) pauseReadingMetricsSession();
    else resumeReadingMetricsSession();
  });
} catch (_) {}

window.focusReadingPage = function focusReadingPage(targetIndex, options = {}) {
  const pageEls = Array.from(document.querySelectorAll('.page'));
  if (!pageEls.length) return { ok: false, reason: 'no-pages' };
  const total = pageEls.length;
  let idx = Number(targetIndex);
  if (!Number.isFinite(idx)) idx = getFocusedOrInferredReadingPageIndex();
  idx = ((idx % total) + total) % total;
  const target = pageEls[idx];
  if (!target) return { ok: false, reason: 'missing-target', index: idx, total };
  const activeClass = 'page-active';
  document.querySelectorAll('.' + activeClass).forEach((el) => el.classList.remove(activeClass));
  target.classList.add(activeClass);
  target.scrollIntoView({ behavior: options.behavior || 'smooth', block: 'start' });
  lastFocusedPageIndex = idx;
  try { currentPageIndex = idx; } catch (_) {}
  updateReadingMetricsPage(idx);
  // Keep reading target in sync so bottom-bar Play speaks the navigated-to page.
  try {
    const _ctx = window.getReadingTargetContext();
    if (typeof setReadingTarget === 'function') setReadingTarget({ sourceType: _ctx.sourceType, bookId: _ctx.bookId, chapterIndex: _ctx.chapterIndex, pageIndex: idx });
  } catch (_) {}
  try { if (window.TTS_STATE) window.TTS_STATE.playbackBlockedReason = ''; } catch (_) {}
  try { if (typeof updateDiagnostics === 'function') updateDiagnostics(); } catch (_) {}
  // Pass 4: schedule durable reading progress sync if the user is signed in.
  try {
    if (window.rcSync && typeof window.rcSync.scheduleProgressSync === 'function') {
      const _t = window.__rcReadingTarget || {};
      window.rcSync.scheduleProgressSync(_t.bookId || '', _t.chapterIndex != null ? _t.chapterIndex : -1, idx, { reason: 'focus-reading-page' });
    }
  } catch (_) {}
  return { ok: true, index: idx, total };
};

window.stepReadingPage = function stepReadingPage(delta, options = {}) {
  const total = Array.isArray(pages) ? pages.length : 0;
  if (!total) return { ok: false, reason: 'no-pages', total: 0 };
  const current = getFocusedOrInferredReadingPageIndex();
  const next = ((current + Number(delta || 0)) % total + total) % total;
  return window.focusReadingPage(next, options);
};

window.startFocusedPageTts = function startFocusedPageTts() {
  const baseTarget = window.getReadingTargetContext();
  // Refuse to infer target from DOM focus or scroll. If no authoritative
  // reading target exists, block and emit diagnostics rather than guessing.
  if (!baseTarget || !baseTarget.sourceType) {
    try { if (typeof ttsDiagPush === 'function') ttsDiagPush('start-focused-blocked', { reason: 'no-reading-target', pageCount: Array.isArray(pages) ? pages.length : 0 }); } catch (_) {}
    return false;
  }
  const idx = Math.max(0, Math.min(Number((window.__rcReadingTarget || {}).pageIndex) || 0, (Array.isArray(pages) ? pages.length : 1) - 1));
  const text = (Array.isArray(pages) && pages[idx]) ? pages[idx] : '';
  if (!text) return false;
  // Normalize clamped index back into target before deriving key.
  if (typeof setReadingTarget === 'function') setReadingTarget({ sourceType: baseTarget.sourceType, bookId: baseTarget.bookId, chapterIndex: baseTarget.chapterIndex, pageIndex: idx });
  try { currentPageIndex = idx; } catch (_) {}
  lastFocusedPageIndex = idx;
  try { if (window.TTS_STATE) window.TTS_STATE.playbackBlockedReason = ''; } catch (_) {}
  try { if (typeof updateDiagnostics === 'function') updateDiagnostics(); } catch (_) {}
  ttsSpeakQueue(
    (typeof readingTargetToKey === 'function') ? readingTargetToKey(window.__rcReadingTarget) : `page-${idx}`,
    [text]
  );
  return true;
};

window.getCurrentReadingPageIndex = getFocusedOrInferredReadingPageIndex;

// Runtime-owned reading-entry API.
// Resolves the book, prepares all page content, and renders page cards.
// Returns true when reading is ready; shell awaits this rather than polling.
// No selector event dispatch — the entire entry path is direct and awaited.
window.startReadingFromPreview = async function startReadingFromPreview(bookId) {
  if (!bookId) return false;

  // MUST be synchronous — before any await — so reading mode never shows stale
  // page content while network calls are in flight.
  const pagesEl = document.getElementById('pages');
  const readingModeEl = document.getElementById('reading-mode');
  try {
    if (pagesEl) pagesEl.innerHTML = '';
    if (readingModeEl) readingModeEl.classList.add('reading-restore-pending');
  } catch (_) {}

  // Fire-and-forget: the current reading target is safe in memory and will be
  // persisted in the background. Awaiting this was causing a multi-second blank
  // screen before the book loaded — unacceptable for a responsive entry path.
  try { if (window.rcSync && typeof window.rcSync.flushProgressSync === 'function') window.rcSync.flushProgressSync().catch(() => {}); } catch (_) {}

  // Set source selector to book mode for UI accuracy.
  // setSourceUI() is display-only so no change event dispatch is needed here.
  const sourceSel = document.getElementById('importSource');
  if (sourceSel && sourceSel.value !== 'book') sourceSel.value = 'book';

  let normalizedId = String(bookId);

  // Keep bookSelect value in sync for diagnostics and chapter navigation,
  // but do not dispatch a change event — the load path is direct, not event-driven.
  const bookSel = document.getElementById('bookSelect');
  if (bookSel) {
    const opts = Array.from(bookSel.options || []).map(o => String(o.value || ''));
    normalizedId = opts.includes(String(bookId)) ? String(bookId)
      : (opts.includes(`local:${bookId}`) ? `local:${bookId}` : String(bookId));
    bookSel.value = normalizedId;
  }

  let restore = null;
  try {
    if (window.rcSync && typeof window.rcSync.getRestoreProgress === 'function') {
      restore = await window.rcSync.getRestoreProgress(normalizedId);
    }
  } catch (_) {}

  // Compute restore truth. data-restore-kind is intentionally NOT set — with
  // the blocking flush removed the render is near-instant, so the overlay text
  // "Returning to your place…" would only flash for a frame. The hide/reveal
  // is silent: pages stay invisible via reading-restore-pending until scrolled
  // to the correct position, then fade in. No visible loading message needed.
  const hasRestore = !!(restore && Number.isFinite(Number(restore.pageIndex)) && Number(restore.pageIndex) > 0);
  try { if (readingModeEl) readingModeEl.removeAttribute('data-restore-kind'); } catch (_) {}

  // Await the runtime-owned book load path. This resolves only after render()
  // and applyPendingReadingRestore() have both completed, so #pages is already
  // scrolled to the correct position before reading-restore-pending is removed.
  if (typeof window.__rcLoadBook === 'function') {
    try { await window.__rcLoadBook(normalizedId, { restore }); } catch (_) {}
  }
  try { await waitForNextPaint(2); } catch (_) {}

  // Remove pending state and clean up the restore-kind attribute.
  // The opacity transition on #pages produces a smooth fade-in from this point.
  try { if (readingModeEl) readingModeEl.classList.remove('reading-restore-pending'); } catch (_) {}
  try { if (readingModeEl) readingModeEl.removeAttribute('data-restore-kind'); } catch (_) {}
  try { beginReadingMetricsSession(normalizedId, Array.isArray(pages) ? pages.length : 0); } catch (_) {}
  return true;
};

window.exitReadingSession = function exitReadingSession() {
  try { flushCurrentReadingProgress('reading-exit').catch(() => {}); } catch (_) {}
  const metrics = finalizeReadingMetricsSession();
  const result = { ttsStopped: false, musicStopped: false, countdownCleared: false, pageCount: Array.isArray(pages) ? pages.length : 0, activePageIndex: getFocusedOrInferredReadingPageIndex(), metrics };
  try { if (typeof ttsStop === 'function') { ttsStop(); result.ttsStopped = true; } } catch (_) {}
  try { if (typeof ttsAutoplayCancelCountdown === 'function') { ttsAutoplayCancelCountdown(); result.countdownCleared = true; } } catch (_) {}
  try { const signal = document.getElementById('session-complete'); if (signal) signal.classList.add('hidden-section'); } catch (_) {}
  try { document.querySelectorAll('.page-active').forEach((el) => el.classList.remove('page-active')); } catch (_) {}
  try { const active = document.activeElement; if (active && typeof active.blur === 'function') active.blur(); } catch (_) {}
  try { if (window.music) { window.music.pause(); result.musicStopped = true; } } catch (_) {}
  // PATCH(diagnostics): Push a named exit event into the TTS ring buffer so exit
  // cleanup is visible and provable in diagnostics. Previously updateDiagnostics()
  // re-read post-exit state but no event recorded what actually ran during cleanup.
  try { if (typeof ttsDiagPush === 'function') ttsDiagPush('exit-reading-session', result); } catch (_) {}
  try { updateDiagnostics(); } catch (_) {}
  return result;
};

window.getRuntimeUiState = function getRuntimeUiState() {
  return {
    pageCount: Array.isArray(pages) ? pages.length : 0,
    activePageIndex: getFocusedOrInferredReadingPageIndex(),
    hasPages: Array.isArray(pages) && pages.length > 0,
    restore: (typeof window.getReadingRestoreStatus === 'function') ? window.getReadingRestoreStatus() : null
  };
};