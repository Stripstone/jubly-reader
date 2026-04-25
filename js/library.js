// Split from original app.js during role-based phase-1 restructure.
// File: library.js
// Note: This is still global-script architecture (no bundler/modules required).

  function libraryTrailPush(tag, data) {
    try {
      if (!Array.isArray(window.__rcEventTrail)) window.__rcEventTrail = [];
      window.__rcEventTrail.push(Object.assign({ t: new Date().toISOString(), tag }, data || {}));
      if (window.__rcEventTrail.length > 40) window.__rcEventTrail.shift();
      if (typeof updateDiagnostics === 'function') updateDiagnostics();
    } catch (_) {}
  }

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
      const pageIndex = Math.max(0, currentPageIndex);
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
      // Store index for post-reveal re-anchor (Patch B). The CSS restore-pending
      // guard (Patch A) locks document scroll while this runs, making the
      // scrollIntoView() above a no-op. startReadingFromPreview() re-applies it
      // after reading-restore-pending is removed and scroll is unlocked.
      window.__rcLastRestoredPageIndex = idx;
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

  function setButtonBusy(btn, busy, busyLabel) {
    if (!btn) return;
    if (busy) {
      if (!btn.dataset.idleLabel) btn.dataset.idleLabel = btn.textContent || '';
      btn.disabled = true;
      if (busyLabel) btn.textContent = busyLabel;
      return;
    }
    btn.textContent = btn.dataset.idleLabel || btn.textContent || '';
    delete btn.dataset.idleLabel;
    btn.disabled = false;
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

  async function permanentlyDeleteAllLocalBooks(ids = []) {
    const uniqueIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean)));
    for (const id of uniqueIds) {
      await localDeletedBookDelete(id);
      queueRemoteLibraryItemState(`local:${id}`, { purge: true });
    }
    return true;
  }

  window.__rcLocalBookGet = localBookGet;
  window.__rcLocalBookPut = localBookPut;
  window.__rcLocalBooksGetAll = localBooksGetAll;
  window.__rcLocalDeletedBooksGetAll = localDeletedBooksGetAll;
  libraryTrailPush('library-owner-available', { hasLocalBooksGetAll: typeof localBooksGetAll === 'function' });

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
    let lastMarker = null;

    function normalizePageMarker(raw) {
      const markerMatch = String(raw || '').match(/^page[_-]?(\d+)$/i);
      if (!markerMatch) return null;

      const pageNumber = Number(markerMatch[1]);
      // Reject implausibly large page IDs from OCR/conversion artifacts.
      if (!Number.isFinite(pageNumber) || pageNumber <= 0 || pageNumber > 9999) return null;

      return `## Page ${pageNumber}`;
    }

    const nodes = root.querySelectorAll('[id],[name],h1,h2,h3,h4,h5,h6,p,li');
    nodes.forEach((el) => {
      try {
        const marker = normalizePageMarker(el.getAttribute('id')) || normalizePageMarker(el.getAttribute('name'));
        if (marker && marker !== lastMarker) {
          blocks.push(marker);
          lastMarker = marker;
        }
      } catch (_) {}

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

  function escapeRegExp(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function isExplicitImportedPageMarker(text) {
    return /^(?:##\s*)?Page\s+\d+\s*$/i.test(String(text || '').trim());
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
      if (isExplicitImportedPageMarker(prev) || isExplicitImportedPageMarker(cur)) {
        out.push(cur);
        continue;
      }
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

  
  function chunkBlocksToPages(blocks) {
    const pagesOut = [];

    // Derive a consistent target from the chapter's own content so that every
    // chapter auto-calibrates to its density — no user knob needed.
    // NOMINAL_PAGE = ~1600 chars (~200 words). We compute how many such pages
    // the chapter would naturally produce, then set target = totalChars / count
    // so all pages land close to the same size.
    const NOMINAL_PAGE = 1600;
    const totalChars   = (blocks || []).reduce((s, b) => s + String(b || '').trim().length, 0);
    const pageCount    = Math.max(1, Math.round(totalChars / NOMINAL_PAGE));
    const target       = Math.max(400, Math.round(totalChars / pageCount));

    const minChars = Math.max(200, Math.round(target * 0.5));
    const softMax  = Math.round(target * 1.15);
    const hardMax  = Math.max(softMax + 300, Math.round(target * 2.0)); // tighter ceiling

    // A plain word: letters only, optional internal apostrophe (contractions).
    const plainWordRe = /^[A-Za-z]+(?:['\u2019][A-Za-z]+)?$/;
    const listLineRe  = /^\s*(?:\d+[.)]\s+|[-\u2022*]\s+)/i;

    // Abbreviations whose trailing dot is NOT a sentence boundary.
    // Covers titles, military ranks, civic titles, location suffixes, business/legal, and common shortenings.
    const abbrevRe = /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof|Rev|Hon|Sr|Jr|Capt|Maj|Lt|Sgt|Col|Gen|Cpl|Pvt|Cmdr|Cdr|Adm|Brig|Gov|Sen|Rep|Atty|Insp|Supt|Pres|St|Ave|Blvd|Rd|Ln|Ct|Sq|Dept|Est|Corp|Inc|Ltd|Co|Bros|Assn|Intl|etc|vs|approx|vol|chap|sec|no|art|fig|ed|trans|repr|rev|supp|pp|ibid|op|cf)\.\s*$/i;
    const initialChainRe  = /(?:\b[A-Za-z]\.){2,}\s*$/;   // "U.S.A."  "J.K."
    const singleInitialRe = /(?:^|\s)[A-Za-z]\.\s*$/;     // lone "J."

    function norm(s)  { return String(s || '').replace(/\s+/g, ' ').trim(); }
    function toks(s)  { return norm(s).split(' ').filter(Boolean); }
    function plainCount(arr) { return arr.filter(t => plainWordRe.test(t)).length; }
    function isListLine(s)   { return listLineRe.test(String(s || '').trim()); }

    // Comma/semicolon rate: how list-like or enumeration-heavy a sentence is.
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
        // A sentence-ending period is always followed by whitespace or end-of-string.
        if (ch === '.' && i + 1 < t.length && /[a-z]/.test(t[i + 1])) continue;

        const tail = t.slice(0, i + 1);
        if (abbrevRe.test(tail))                       continue;
        if (initialChainRe.test(tail))                 continue;
        if (ch === '.' && singleInitialRe.test(tail))  continue;

        // Advance past trailing closers and whitespace to the cut point.
        let cut = i + 1;
        while (cut < t.length && /['\u2019"\u201D)\]}]/.test(t[cut])) cut++;
        while (cut < t.length && /\s/.test(t[cut])) cut++;

        stops.push({ punct: i, cut });
      }
      return stops;
    }

    // Score one candidate stop.  Returns null if validation fails.
    function scoreStop(text, stop, allStops) {
      const { punct, cut } = stop;

      // ── Token-level gates ────────────────────────────────────────────────
      const preSlice  = norm(text.slice(Math.max(0, punct - 200), punct));
      const postSlice = norm(text.slice(cut, Math.min(text.length, cut + 200)));
      const preToks   = toks(preSlice);
      const postToks  = toks(postSlice);

      // Hard gate: 3 plain words must exist in each window.
      if (plainCount(preToks)  < 3) return null;
      if (plainCount(postToks) < 3) return null;

      // Hard gate: the very first token after the cut must be a plain word.
      // Catches page starts like "archives.gov/...", "32,", "04 (c)", "(c) [Limitation".
      const firstPostToken = postToks[0] || '';
      if (!plainWordRe.test(firstPostToken)) return null;

      // ── Ending sentence ────────────────────────────────────────────────
      // The sentence whose period closes this page.
      const prevStop      = [...allStops].reverse().find(s => s.cut <= Math.max(0, punct - 2));
      const sentStart     = prevStop ? prevStop.cut : 0;
      const endSentence   = norm(text.slice(sentStart, punct));
      const endLen        = plainCount(toks(endSentence));
      const endCommaRate  = commaRate(endSentence);

      // ── Starting sentence ──────────────────────────────────────────────
      // The sentence that opens the next page.
      const nextStop      = allStops.find(s => s.punct > cut);
      const nextPunct     = nextStop ? nextStop.punct : Math.min(text.length, cut + 500);
      const startSentence = norm(text.slice(cut, nextPunct));
      const startLen      = plainCount(toks(startSentence));
      const startCommaRate = commaRate(startSentence);

      let score = 0;

      // ── Sentence shape scoring ─────────────────────────────────────────
      // Both sides favour a moderate sentence length (not too terse, not sprawling).
      // Ending page: ideal 14–22 words  →  peak reward = 30 pts
      // Starting page: ideal 8–18 words →  peak reward = 22 pts
      // Score falls linearly the further the sentence deviates from the ideal band.
      const endIdeal = 18,  endBand = 10;   // peak ± band
      const strIdeal = 13,  strBand = 8;
      score += Math.max(0, endBand - Math.abs(endLen   - endIdeal)) * 3.0;
      score += Math.max(0, strBand - Math.abs(startLen - strIdeal)) * 2.75;

      // ── Comma / semicolon density penalty ─────────────────────────────
      // High comma rate signals lists, enumerations, or supporting clauses —
      // poor material for a page boundary on either side.
      // A rate of 0.12 (≈1 comma per 8 words) is the threshold where prose
      // starts feeling list-heavy; penalty scales sharply above that.
      const endCommaExcess   = Math.max(0, endCommaRate   - 0.12);
      const startCommaExcess = Math.max(0, startCommaRate - 0.12);
      score -= endCommaExcess   * 120;
      score -= startCommaExcess * 100;

      // ── Last token before punct ───────────────────────────────────────
      // If the word immediately before the period is not plain prose (e.g. a
      // number, symbol, or punctuation-laden token like "322" or "below:"),
      // the ending feels like a citation fragment or list marker.
      // Apply a heavy score penalty — but don't hard-block, so that a clean
      // page START can still rescue the break (e.g. "[00000]." → "This is...").
      const lastPreToken = preToks[preToks.length - 1] || '';
      if (!plainWordRe.test(lastPreToken)) {
        // Pure digit (e.g. list marker "2", "1"): hard block — a sentence cannot
        // end cleanly on a standalone number.
        if (/^\d+$/.test(lastPreToken)) return null;
        // Other non-plain tokens (brackets, symbols): heavy penalty but clean
        // page start can still rescue the break.
        score -= 60;
      }

      // ── Size proximity ─────────────────────────────────────────────────
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

      // ── Pass 1: tight window (target ±30%) ──────────────────────────────
      // Restricts candidates to stops near the target, enforcing size
      // consistency. A good stop here always wins over a better stop at 2×
      // target — consistency beats marginal quality gains at extreme distances.
      const windowLo = Math.round(target * 0.7);
      const windowHi = Math.round(target * 1.3);
      const tightStops = allStops.filter(s => s.cut >= windowLo && s.cut <= windowHi);
      const tightScored = tightStops.map(s => scoreStop(t, s, allStops)).filter(Boolean);
      if (tightScored.length) {
        tightScored.sort((a, b) => b.score - a.score || a.cut - b.cut);
        return tightScored[0].cut;
      }

      // ── Pass 2: full range fallback ─────────────────────────────────────
      // No scoreable stop in the tight window (dense citations, form fields,
      // vendor lists). Accept any valid stop anywhere >= minChars.
      const scored = allStops.map(s => scoreStop(t, s, allStops)).filter(Boolean);
      if (!scored.length) return -1;

      scored.sort((a, b) => b.score - a.score || a.cut - b.cut);
      return scored[0].cut;
    }

    // Find the paragraph boundary (\n\n) closest to `target` that is >= minChars.
    // Returns the index just after the boundary, or -1 if none found.
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
            // No sentence stop found. Try a paragraph boundary near target so
            // list-dense content (form fields, vendor lists) breaks gracefully
            // instead of producing one massive page.
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
      // Always start a fresh page at a major section heading.
      if (looksLikeMajorHeading(block) && buf.length >= minChars) {
        flushBuffer(true);
      }
      buf = buf ? `${buf}\n\n${block}` : block;
      flushBuffer(false);
      // Safety valve: force a break if the buffer grows far beyond hardMax.
      if (buf.length > hardMax) flushBuffer(true);
    }

    flushBuffer(true);

    // Absorb orphan pages (below minChars) into the preceding page.
    const merged = [];
    for (const p of pagesOut) {
      const page = String(p || '').trim();
      if (!page) continue;
      if (!merged.length) { merged.push(page); continue; }
      const prev = merged[merged.length - 1];
      const combined = prev + '\n\n' + page;
      // Absorb threshold: target * 0.7 so short sections (vendor lists,
      // boilerplate paragraphs) merge with the preceding page rather than
      // standing alone as micro pages. The old minChars (target * 0.5) was
      // too low — pages just above it were visibly undersized.
      const absorbThreshold = Math.round(target * 0.7);
      if (page.length < absorbThreshold && combined.length <= hardMax && !isListLine(page)) {
        merged[merged.length - 1] = combined.trim();
      } else {
        merged.push(page);
      }
    }
    return merged;
  }
  // Page-breaking for imported books now lives behind the server content route
  // (/api/content?action=page-break) so the crown-jewel chunking logic does not
  // ship to the client. The EPUB import pipeline extracts cleaned section blocks
  // here, then sends them to the backend for page construction.

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
        let cleaned = extractTextBlocksFromHtml(html)
          .map(b => isExplicitImportedPageMarker(b) ? String(b || '').trim() : cleanImportedBlock(b, { bookTitle, artifactTitles: toc.map(x => x.title) }))
          .filter(b => b && (!cleanupHeadings || !isDecorativeSpacedHeading(b)));
        cleaned = mergeFragmentedBlocks(cleaned);
        cleaned = cleaned.filter(b => b && (!cleanupHeadings || !isDecorativeSpacedHeading(b)));

        let startIdx = 0;
        let endIdx = cleaned.length;
        if (s === it.spineIndex && Number.isFinite(it.blockIndex)) startIdx = Math.min(cleaned.length, Math.max(0, it.blockIndex));
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
        for (let bi = startIdx; bi < endIdx; bi++) blocks.push(cleaned[bi]);
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

    function parseSourcePageNumber(title, fallbackIndex = 0) {
      const match = String(title || "").match(/(?:\bpage\s+|\bp\.\s*)(\d+)\b/i);
      if (match) {
        const num = Number(match[1]);
        if (Number.isFinite(num) && num > 0) return num;
      }
      return Number(fallbackIndex) + 1;
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
        if (body) pages.push({ title: cur.title, text: body, sourcePageNumber: parseSourcePageNumber(cur.title, pages.length) });
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

      // Fallback: if no H2 pages were detected, try --- separators
      if (pages.length <= 1) {
        const blocks = String(raw || "").trim().split(/\n---\n/g);
        if (blocks.length > 1) {
          const out = [];
          blocks.forEach((blk, i) => {
            const cleaned = blk.split(/\r?\n/)
              .map(l => l.trim())
              .filter(l => l && !/^\s{0,3}#{1,6}\s+/.test(l) && !/^\s*[—-]{2,}\s*$/.test(l));
            const body = cleaned.join(" ").trim();
            if (body) out.push({ title: `Page ${out.length + 1}`, text: body, sourcePageNumber: out.length + 1 });
          });
          return out.length ? out : pages;
        }
      }

      
  // If the user didn't use explicit separators (--- / ## Page X), fall back to a
  // "paragraph pages" heuristic: blocks separated by one-or-more blank lines.
  // This matches typical copy/paste behavior (news articles, essays, etc.).
  const usedExplicitSeparators = /\n\s*---\s*\n/.test(raw) || /^\s*##\s*Page\s+\d+/im.test(raw);
  if (!usedExplicitSeparators) {
    const blocks = raw
      .replace(/\r\n?/g, "\n")
      .split(/\n\s*\n+/)
      .map(b => b.trim())
      .filter(Boolean);

    // If we got multiple blocks, treat each as a page.
    if (blocks.length > 1) {
      pages = blocks.map((b, i) => ({
        title: `Page ${i + 1}`,
        text: b.replace(/\s+/g, " ").trim(),
        sourcePageNumber: i + 1
      }));
    }
  }

  return pages;
    }

    function getSequentialChapterPages(chapterIndex) {
      const idx = Number(chapterIndex);
      const pagesForChapter = parsePagesWithTitles((Number.isFinite(idx) && idx >= 0 && chapterList[idx]) ? chapterList[idx].raw : getCurrentChapterRaw());
      if (!Number.isFinite(idx) || idx <= 0) return pagesForChapter;
      let offset = 0;
      for (let i = 0; i < idx; i++) {
        offset += parsePagesWithTitles(chapterList[i]?.raw || '').length;
      }
      return pagesForChapter.map((page, localIdx) => ({
        ...page,
        sourcePageNumber: offset + localIdx + 1,
      }));
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
        return { value: idx, label: title && title !== numericLabel ? `${numericLabel} — ${title}` : numericLabel };
      });

      setSelectOptions(pageStart, opts, "Start page…");
      setSelectOptions(pageEnd, opts, "End page…");

      // Default to full range
      pageStart.value = "0";
      pageEnd.value = String(currentPages.length - 1);
    }

    function getCurrentChapterRaw() {
      if (hasExplicitChapters && Number.isFinite(currentChapterIndex) && chapterList[currentChapterIndex]) {
        return chapterList[currentChapterIndex].raw;
      }
      return currentBookRaw;
    }

    function updateNextChapterSurface() {
      const surface = document.getElementById('next-chapter-surface');
      const button = document.getElementById('next-chapter-btn');
      if (!surface || !button) return;

      const chapterIndex = Number(currentChapterIndex);
      const hasNextChapter = appMode === 'reading'
        && hasExplicitChapters
        && Array.isArray(chapterList)
        && chapterList.length > 1
        && Number.isFinite(chapterIndex)
        && chapterIndex >= 0
        && chapterIndex < chapterList.length - 1;

      surface.classList.toggle('hidden-section', !hasNextChapter);
      if (!hasNextChapter) {
        button.removeAttribute('aria-label');
        return;
      }

      const nextTitle = String(chapterList[chapterIndex + 1]?.title || `Chapter ${chapterIndex + 2}`).trim();
      button.textContent = 'Next Chapter';
      button.setAttribute('aria-label', `Next chapter: ${nextTitle}`);
    }

    function installNextChapterBridge() {
      const button = document.getElementById('next-chapter-btn');
      if (!button || button.__jublyNextChapterBound) return;
      button.__jublyNextChapterBound = true;
      button.addEventListener('click', () => {
        const chapterIndex = Number(currentChapterIndex);
        if (!hasExplicitChapters || !Array.isArray(chapterList) || !Number.isFinite(chapterIndex)) return;
        const nextChapterIndex = chapterIndex + 1;
        if (nextChapterIndex >= chapterList.length) return;
        if (!chapterSelect) return;

        // Forward user intent through the existing chapter-select runtime path.
        // Do not duplicate chapter/page/render truth in this button bridge.
        chapterSelect.value = String(nextChapterIndex);
        chapterSelect.dispatchEvent(new Event('change', { bubbles: true }));
      });
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
        const bookPages = parsePagesWithTitles(currentBookRaw);
        populatePagesSelect(bookPages);
        try { window.__rcPendingRestorePageIndex = Math.min(restorePageIndex, Math.max(0, bookPages.length - 1)); } catch (_) {}
        // Await render completion so the restore scroll finishes before the caller
        // removes reading-restore-pending and reveals pages to the user.
        const allText = bookPages.map(p => p.text).filter(Boolean).join("\n---\n");
        if (allText) await applySelectionToBulkInput(allText, { append: false, preservePendingRestore: true, pageMeta: bookPages });
        return;
      }

      chapterControls.style.display = "flex";
      const chapOpts = chapterList.map((ch, idx) => ({ value: idx, label: ch.title || `Chapter ${idx + 1}` }));
      setSelectOptions(chapterSelect, chapOpts, "Select a chapter…");
      const nextChapterIndex = Math.max(0, Math.min(Number.isFinite(restoreChapterIndex) ? restoreChapterIndex : 0, Math.max(0, chapterList.length - 1)));
      chapterSelect.value = String(nextChapterIndex);
      currentChapterIndex = nextChapterIndex;

      const chapterPages = getSequentialChapterPages(nextChapterIndex);
      populatePagesSelect(chapterPages);
      try { window.__rcPendingRestorePageIndex = Math.min(restorePageIndex, Math.max(0, chapterPages.length - 1)); } catch (_) {}
      // Await render completion before resolving.
      const chapterText = chapterPages.map(p => p.text).filter(Boolean).join("\n---\n");
      if (chapterText) await applySelectionToBulkInput(chapterText, { append: false, preservePendingRestore: true, pageMeta: chapterPages });
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
          hasExplicitChapters = countExplicitH1(currentBookRaw) > 0;
          if (hasExplicitChapters) chapterList = parseChaptersFromMarkdown(currentBookRaw);
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
    installNextChapterBridge();
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

      const chapterPages = getSequentialChapterPages(selectedIdx);
      populatePagesSelect(chapterPages);

      // Chapter entry should always begin at page 1 of that chapter.
      // Route through the existing restore-owned render path by pinning a
      // pending restore to index 0 before addPages() resets and rebuilds.
      try { window.__rcPendingRestorePageIndex = 0; } catch (_) {}

      // Immediately replace rendered page cards with the new chapter's content.
      // Routing through applySelectionToBulkInput → addPages() → render() is the
      // single authoritative card-replacement path. Calling it synchronously here
      // closes the race window between chapter assignment and card DOM update —
      // no Load button click required, no timing assumption.
      const chapterText = chapterPages.map(p => p.text).filter(Boolean).join("\n---\n");
      applySelectionToBulkInput(chapterText, { append: false, preservePendingRestore: true, pageMeta: chapterPages });
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

      const pageSlice = currentPages.slice(s, e + 1);
      const slice = pageSlice
        .map((p) => p.text)
        .filter(Boolean);
      // Keep delimiter in a single JS string line (prevents accidental raw-newline parse errors)
      applySelectionToBulkInput(slice.join("\n---\n"), { append: false, pageMeta: pageSlice });
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

      const pageSlice = currentPages.slice(s, e + 1);
      const slice = pageSlice
        .map((p) => p.text)
        .filter(Boolean);

      applySelectionToBulkInput(slice.join("\n---\n"), { append: true, pageMeta: pageSlice });
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

    // UX rule: whenever user generates new pages, start fresh (no leftover pages)
    if (pages.length > 0) resetSession({ confirm: false, preservePendingRestore: !!options.preservePendingRestore });

    // Split pasted text into pages using paragraph breaks (blank lines).
    // Still supports legacy delimiters (--- / "## Page X") if present.
    const newPages = splitIntoPages(input);
    const incomingMeta = Array.isArray(options.pageMeta) ? options.pageMeta : [];
    const nextPageMeta = (typeof getPageMetaSnapshot === "function") ? getPageMetaSnapshot() : [];
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
      nextPageMeta.push({ title: incomingMeta[pageIdx]?.title || `Page ${assignedIndex + 1}`, sourcePageNumber: Number.isFinite(Number(incomingMeta[pageIdx]?.sourcePageNumber)) ? Number(incomingMeta[pageIdx].sourcePageNumber) : (assignedIndex + 1) });
      pageData.push({
        text: pageText,
        consolidation,
        aiExpanded,
        aiFeedbackRaw,
        aiAt,
        aiRating,
        charCount: (consolidation || "").length,
        completedOnTime: true, // Assume true until sandstoned
        isSandstone,
        rating,
        // Anchors
        pageHash,
        anchors: null,
        anchorVersion: 0,
        anchorsMeta: null
      });
    }

    document.getElementById("bulkInput").value = "";
    try { if (typeof setPageMeta === "function") setPageMeta(nextPageMeta); } catch (_) {}
    schedulePersistSession();
    render();
    checkSubmitButton();
  }

  // Append pages to the existing session (does NOT clear pages/timers/ratings).
  // Uses the same splitting rules as addPages().
  async function appendPages(options = {}) {
    const input = document.getElementById("bulkInput").value;
    goalTime = parseInt(document.getElementById("goalTimeInput").value);
    goalCharCount = parseInt(document.getElementById("goalCharInput").value);
    if (!input || !input.trim()) return;

    const newPages = splitIntoPages(input);
    const incomingMeta = Array.isArray(options.pageMeta) ? options.pageMeta : [];
    const nextPageMeta = (typeof getPageMetaSnapshot === "function") ? getPageMetaSnapshot() : [];
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
      nextPageMeta.push({ title: incomingMeta[pageIdx]?.title || `Page ${assignedIndex + 1}`, sourcePageNumber: Number.isFinite(Number(incomingMeta[pageIdx]?.sourcePageNumber)) ? Number(incomingMeta[pageIdx].sourcePageNumber) : (assignedIndex + 1) });
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
        // Anchors
        pageHash,
        anchors: null,
        anchorVersion: 0,
        anchorsMeta: null
      });
    }

    document.getElementById("bulkInput").value = "";
    try { if (typeof setPageMeta === "function") setPageMeta(nextPageMeta); } catch (_) {}
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
    try { if (typeof setPageMeta === "function") setPageMeta([]); } catch (_) {}
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
          // Read Page is an explicit activation just like Bottom Play. Persist
          // the selected page immediately so quick Exit/re-enter does not depend
          // on TTS speaking long enough for another progress path to run.
          try {
            const _t = window.__rcReadingTarget || {};
            if (window.rcSync && typeof window.rcSync.scheduleProgressSync === 'function') {
              window.rcSync.scheduleProgressSync(_t.bookId || '', _t.chapterIndex != null ? _t.chapterIndex : -1, i, { reason: 'read-page' });
            }
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
    try { updateNextChapterSurface(); } catch (_) {}
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
    try { updateNextChapterSurface(); } catch (_) {}
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
      const topActions = document.createElement('div');
      topActions.className = 'library-row-actions';
      topActions.style.margin = '0 0 12px 0';
      const deleteAll = document.createElement('button');
      deleteAll.className = 'btn-danger';
      deleteAll.type = 'button';
      deleteAll.textContent = 'Delete All';
      deleteAll.addEventListener('click', async () => {
        const ok = confirm(`Permanently delete all ${deleted.length} deleted file${deleted.length === 1 ? '' : 's'}?

This removes them from Deleted Files and frees the device storage.`);
        if (!ok) return;
        setButtonBusy(deleteAll, true, 'Deleting…');
        try {
          await permanentlyDeleteAllLocalBooks(deleted.map((entry) => entry.id));
          emitDeletedChanged();
          await renderDeletedCount();
          renderDeleted();
        } catch (_) {
          setButtonBusy(deleteAll, false);
          alert('Delete all failed.');
        }
      });
      topActions.appendChild(deleteAll);
      deletedListEl.appendChild(topActions);

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
            setButtonBusy(restore, true, 'Restoring…');
            try {
              await restoreDeletedLocalBook(b.id);
              await refreshBookSelect();
              emitLibraryChanged();
              emitDeletedChanged();
              await renderDeletedCount();
              renderDeleted();
            } catch (_) {
              setButtonBusy(restore, false);
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
  var settleTimer = 0;

  function reconcileVisiblePage(reason) {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      try {
        if (!Array.isArray(pages) || !pages.length) return;
        const pageEls = Array.from(document.querySelectorAll('.page'));
        if (!pageEls.length) return;
        let bestEl = null;
        let bestIdx = -1;
        const nearBottom = (typeof window.isReadingViewportNearBottom === 'function')
          ? !!window.isReadingViewportNearBottom()
          : false;
        if (nearBottom) {
          bestEl = pageEls[pageEls.length - 1];
          bestIdx = parseInt(bestEl?.dataset?.pageIndex || String(pageEls.length - 1), 10);
        } else {
          let bestDist = Infinity;
          for (const el of pageEls) {
            const rect = el.getBoundingClientRect();
            if (rect.height <= 0) continue;
            const dataIdx = parseInt(el.dataset.pageIndex || '-1', 10);
            if (Number.isNaN(dataIdx) || dataIdx < 0) continue;
            const dist = Math.abs(rect.top);
            if (dist < bestDist) { bestDist = dist; bestIdx = dataIdx; bestEl = el; }
          }
        }
        if (!bestEl || !Number.isFinite(bestIdx) || bestIdx < 0) return;
        if (bestEl.getBoundingClientRect().height <= 0) return;
        const _pActive = (typeof window.getPlaybackStatus === 'function') && !!window.getPlaybackStatus().active;
        const _cActive = (typeof window.getCountdownStatus === 'function') && !!window.getCountdownStatus().active;
        if (!_pActive && !_cActive && !window.__rcReadingEntryRestoreSettling) {
          lastFocusedPageIndex = bestIdx;
        }
        updateReadingMetricsPage(bestIdx);
      } catch (_) {}
    });
  }

  function reconcileVisiblePageAfterSettle(reason) {
    reconcileVisiblePage(reason);
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(function () {
      settleTimer = 0;
      reconcileVisiblePage(reason + '-settled');
    }, 160);
  }

  window.addEventListener('scroll', function () { reconcileVisiblePage('scroll-tracker'); }, { passive: true });
  window.addEventListener('resize', function () { reconcileVisiblePageAfterSettle('resize-reconcile'); }, { passive: true });
  window.addEventListener('fullscreenchange', function () { reconcileVisiblePageAfterSettle('fullscreen-reconcile'); }, { passive: true });
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

window.ttsAdvancePageSession = function ttsAdvancePageSession(delta) {
  const step = Number(delta || 0);
  if (!step) return false;
  const total = Array.isArray(pages) ? pages.length : 0;
  if (!total) return false;
  let playback = { active: false, paused: false };
  try { if (typeof getPlaybackStatus === 'function') playback = getPlaybackStatus() || playback; } catch (_) {}
  if (playback.active) {
    if (playback.paused) {
      try {
        if (typeof ttsClearPausedSessionForManualPageAdvance === 'function') {
          ttsClearPausedSessionForManualPageAdvance(step, { route: 'ttsAdvancePageSession' });
        } else if (typeof ttsStop === 'function') {
          ttsStop();
        }
      } catch (_) {}
      const current = getFocusedOrInferredReadingPageIndex();
      const next = ((current + step) % total + total) % total;
      const result = window.focusReadingPage(next, { behavior: 'smooth' });
      return !!result?.ok;
    }
    try { if (typeof ttsJumpPage === 'function') return !!ttsJumpPage(step); } catch (_) {}
    return false;
  }
  try { if (typeof ttsAutoplayCancelCountdown === 'function') ttsAutoplayCancelCountdown(); } catch (_) {}
  const current = getFocusedOrInferredReadingPageIndex();
  const next = ((current + step) % total + total) % total;
  const result = window.focusReadingPage(next, { behavior: 'smooth' });
  return !!result?.ok;
};

window.startFocusedPageTts = function startFocusedPageTts() {
  const baseTarget = window.getReadingTargetContext();
  // Refuse to infer target from DOM focus or scroll. If no authoritative
  // reading target exists, block and emit diagnostics rather than guessing.
  if (!baseTarget || !baseTarget.sourceType) {
    try { if (typeof ttsDiagPush === 'function') ttsDiagPush('start-focused-blocked', { reason: 'no-reading-target', pageCount: Array.isArray(pages) ? pages.length : 0 }); } catch (_) {}
    return false;
  }
  // Bottom Play is an explicit user action. Sample the page the user is actually
  // viewing at press time, bypassing lastFocusedPageIndex because that value is
  // allowed to be a volatile restore/runtime hint and may intentionally lag
  // passive scroll during re-entry settling.
  let sampledIdx = -1;
  try {
    if (typeof inferCurrentPageIndex === 'function') sampledIdx = Number(inferCurrentPageIndex());
  } catch (_) {}
  if (!Number.isFinite(sampledIdx) || sampledIdx < 0) sampledIdx = getFocusedOrInferredReadingPageIndex();
  const idx = Math.max(0, Math.min(Number(sampledIdx) || 0, (Array.isArray(pages) ? pages.length : 1) - 1));
  const text = (Array.isArray(pages) && pages[idx]) ? pages[idx] : '';
  if (!text) return false;
  // Normalize the explicitly sampled page into runtime truth before deriving key.
  if (typeof setReadingTarget === 'function') setReadingTarget({ sourceType: baseTarget.sourceType, bookId: baseTarget.bookId, chapterIndex: baseTarget.chapterIndex, pageIndex: idx });
  try { currentPageIndex = idx; } catch (_) {}
  lastFocusedPageIndex = idx;
  try {
    if (window.rcSync && typeof window.rcSync.scheduleProgressSync === 'function') {
      window.rcSync.scheduleProgressSync(baseTarget.bookId || '', baseTarget.chapterIndex != null ? baseTarget.chapterIndex : -1, idx, { reason: 'bottom-play' });
    }
  } catch (_) {}
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

  // ── Intro hold ─────────────────────────────────────────────────────────────
  // Activated synchronously before any await so the reading surface is covered
  // from the very first frame. Texture and Wallpaper prepare behind it and
  // never become the visible first phase. Released after cards are confirmed
  // ready (after __rcLoadBook + waitForNextPaint). Message appears on the hold
  // after 1000 ms if loading is still in progress.
  const holdEl = document.getElementById('reading-intro-hold');
  const holdMsgEl = document.getElementById('reading-intro-message');
  let _holdMsgTimer = null;
  try {
    if (holdEl) {
      holdEl.classList.remove('intro-hold-fading', 'intro-hold-message-visible');
      holdEl.classList.add('intro-hold-active');
    }
  } catch (_) {}
  // ───────────────────────────────────────────────────────────────────────────

  // MUST be synchronous — before any await — so reading mode never shows stale
  // page content while network calls are in flight. Exit/re-enter does not reload
  // the URL, so clear the stale volatile scroll hint and suppress scroll-tracker
  // focus writes until restore has painted, matching cold-start behavior.
  try { lastFocusedPageIndex = -1; } catch (_) {}
  try { window.__rcReadingEntryRestoreSettling = true; } catch (_) {}
  const pagesEl = document.getElementById('pages');
  const readingModeEl = document.getElementById('reading-mode');
  try {
    if (pagesEl) pagesEl.innerHTML = '';
    if (readingModeEl) {
      readingModeEl.classList.add('reading-restore-pending');
      readingModeEl.setAttribute('data-restore-kind', 'opening');
    }
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

  // Compute restore truth. Keep a visible neutral pending surface while the
  // runtime-owned load/restore path is unresolved so cold entry never presents
  // a blank reading view. Returning restores get a more specific label.
  const hasRestore = !!(restore && Number.isFinite(Number(restore.pageIndex)) && Number(restore.pageIndex) > 0);
  try {
    if (readingModeEl) readingModeEl.setAttribute('data-restore-kind', hasRestore ? 'returning' : 'opening');
  } catch (_) {}

  // Start the 1000 ms message timer now that we know if this is a fresh open or
  // a return. If cards are ready before 1000 ms the timer is cleared and the
  // message never appears. If not, the message fades in on the existing hold.
  try {
    const msgText = hasRestore ? 'Returning to your place\u2026' : 'Preparing reading view\u2026';
    if (holdMsgEl) holdMsgEl.textContent = msgText;
    if (holdEl) _holdMsgTimer = setTimeout(() => holdEl.classList.add('intro-hold-message-visible'), 1000);
  } catch (_) {}

  // Await the runtime-owned book load path. This resolves only after render()
  // and applyPendingReadingRestore() have both completed, so #pages is already
  // scrolled to the correct position before reading-restore-pending is removed.
  if (typeof window.__rcLoadBook === 'function') {
    try { await window.__rcLoadBook(normalizedId, { restore }); } catch (_) {}
  }
  try { await waitForNextPaint(2); } catch (_) {}
  try { window.__rcReadingEntryRestoreSettling = false; } catch (_) {}

  // Cards are rendered and painted. Clear the message timer (fast load — message
  // never needed), then release the hold and the page guard simultaneously so
  // the reading surface and the hold cross-fade in a single motion.
  if (_holdMsgTimer) { clearTimeout(_holdMsgTimer); _holdMsgTimer = null; }

  // Fade out the hold. JS removes the active classes once the transition ends
  // (with a 400 ms hard fallback in case transitionend does not fire).
  try {
    if (holdEl) {
      holdEl.classList.remove('intro-hold-message-visible');
      holdEl.classList.add('intro-hold-fading');
      const releaseHold = () => holdEl.classList.remove('intro-hold-active', 'intro-hold-fading');
      holdEl.addEventListener('transitionend', releaseHold, { once: true });
      setTimeout(releaseHold, 400);
    }
  } catch (_) {}

  // Remove restore-pending — triggers the #pages opacity fade-in (0.14 s),
  // which runs simultaneously with the hold fade-out above.
  try { if (readingModeEl) readingModeEl.classList.remove('reading-restore-pending'); } catch (_) {}
  try { if (readingModeEl) readingModeEl.removeAttribute('data-restore-kind'); } catch (_) {}
  // Patch B: Re-anchor scroll to the restored page now that reading-restore-pending
  // is removed and the html overflow:hidden lock (Patch A) has lifted. The
  // scrollIntoView() call inside applyPendingReadingRestore() was a no-op while
  // the lock was active, so this is the authoritative scroll for restore sessions.
  try {
    const _ri = Number(window.__rcLastRestoredPageIndex ?? -1);
    if (Number.isFinite(_ri) && _ri >= 0) {
      const _rEl = document.querySelectorAll('.page')[_ri];
      if (_rEl) _rEl.scrollIntoView({ behavior: 'auto', block: 'start' });
      window.__rcLastRestoredPageIndex = -1;
    }
  } catch (_) {}
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
