// Split from original app.js during role-based phase-1 restructure.
// File: import.js
// Note: This is still global-script architecture (no bundler/modules required).

  // 📚 BOOK IMPORT (manifest-based)
  // ===================================
  // Notes:
  // - Static hosts cannot list directories. We rely on a manifest at: assets/books/index.json
  // - Loading a selection fills #bulkInput, then calls addPages() (existing behavior preserved).

  function titleFromBookId(id) {
    if (!id) return "";
    let t = String(id);
    t = t.replace(/^BOOK[_-]*/i, "");
    t = t.replace(/[_-]+/g, " ");
    t = t.replace(/([a-z])([A-Z])/g, "$1 $2");
    return t.trim().replace(/\s+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  }

  function splitIntoPages(raw) {
    // Primary UX: users paste normal text (paragraphs separated by blank lines).
    // We also support legacy delimiters (---, "## Page X") without requiring them.
    let input = String(raw || "");
    input = input.replace(/\r\n?/g, "\n").trim();
    if (!input) return [];

    // Normalize "## Page X" into a hard delimiter
    input = input.replace(/^\s*##\s*Page\s+\d+.*$/gim, "\n\n---\n\n");

    // Split on explicit hard delimiters first.
    const hardChunks = input.split(/\n\s*---\s*\n/g);

    // Paragraph splitting (blank lines) + fallback for single-newline paragraphs.
    const out = [];

    const startsNewParagraph = (prevLine, nextLine) => {
      if (!prevLine || !nextLine) return false;
      const prevEndsSentence = /[.!?\"”']\s*$/.test(prevLine.trim());
      const nextStartsPara = /^[A-Z0-9“"'\(\[]/.test(nextLine.trim());
      return prevEndsSentence && nextStartsPara;
    };

    for (const hc of hardChunks) {
      const chunk = String(hc || "").trim();
      if (!chunk) continue;

      // 1) Normal: blank-line-separated paragraphs.
      let paras = chunk.split(/\n\s*\n+/g).map(s => s.trim()).filter(Boolean);

      // 2) Fallback: single newlines between paragraphs (common when copying from web).
      if (paras.length <= 1 && /\n/.test(chunk)) {
        const lines = chunk.split(/\n+/).map(l => l.trimEnd());
        const tmp = [];
        let buf = [];
        for (let i = 0; i < lines.length; i++) {
          const line = (lines[i] || "").trim();
          if (!line) continue;
          if (/^[#—]/.test(line)) continue;
          buf.push(line);
          const next = (lines[i + 1] || "").trim();
          if (startsNewParagraph(line, next)) {
            tmp.push(buf.join(" ").replace(/\s+/g, " ").trim());
            buf = [];
          }
        }
        if (buf.length) tmp.push(buf.join(" ").replace(/\s+/g, " ").trim());
        if (tmp.length > 1) paras = tmp;
      }

      for (const p of paras) {
        const cleaned = p
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !/^[#—]/.test(l))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (cleaned) out.push(cleaned);
      }
    }

    return out;
  }


async function requestServerPageBreak(payload) {
  const response = await fetch(apiUrl('/api/content?action=page-break'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Page breaking failed (${response.status})`);
  return data || {};
}

  function parseChaptersFromMarkdown(raw) {
    const text = String(raw || "");
    const lines = text.split(/\r?\n/);

    const chapters = [];
    let current = null;

    function pushCurrent() {
      if (!current) return;
      const rawText = current.rawLines.join("\n").trim();
      if (rawText) chapters.push({ title: current.title, raw: rawText });
    }

    for (const line of lines) {
      // H1 headings define chapters
      const h1 = line.match(/^\s{0,3}#\s+(.*)\s*$/);
      if (h1) {
        pushCurrent();
        const title = (h1[1] || "").trim() || `Chapter ${chapters.length + 1}`;
        current = { title, rawLines: [] };
        continue;
      }

      // Everything else belongs to the current chapter (or implicit intro)
      if (!current) current = { title: "Introduction", rawLines: [] };
      current.rawLines.push(line);
    }

    pushCurrent();
    return chapters;
  }

  // ===================================

  // ─── Non-EPUB Import Support ────────────────────────────────────────────────
  // Non-EPUB files (PDF, DOCX, MOBI, RTF, ODT, TXT, HTML, FB2, etc.) are converted
  // to EPUB server-side via the FreeConvert API, proxied through /api/content?action=book-import
  // to keep the API key off the client.
  //
  // Flow:
  //   1. POST /api/content?action=book-import?step=upload  → get FreeConvert upload URL + signature
  //   2. POST directly to FreeConvert upload URL (bypasses Vercel body limits)
  //   3. POST /api/content?action=book-import?step=convert → kick off {format}→EPUB conversion
  //   4. Poll  /api/content?action=book-import?step=status → wait for completion, get EPUB URL
  //   5. Fetch EPUB → load into JSZip → hand off to existing epubParseToc flow
  //
  // After step 5, the conversion path is invisible — the chapter picker and import
  // pipeline run identically to a natively uploaded EPUB.
  // ─── End Non-EPUB Import Support ─────────────────────────────────────────────

  // ➕ Import Book UI (local-first)
  // ===================================

  (function initEpubImportModal() {
    const openBtn = document.getElementById('importBookBtn');
    const modal = document.getElementById('importBookModal');
    const closeBtn = document.getElementById('importBookClose');

    const dropzone = document.getElementById('importDropzone');
    const browseBtn = document.getElementById('importBrowseBtn');
    const fileInput = document.getElementById('importFileInput');
    const scanBtn = document.getElementById('importScanBtn');
    const uploadStatus = document.getElementById('importUploadStatus');
    const modeFileBtn = document.getElementById('importModeFile');
    const modeTextBtn = document.getElementById('importModeText');
    const filePanel = document.getElementById('importFilePanel');
    const textPanel = document.getElementById('importTextPanel');
    const textTitleInput = document.getElementById('importTextTitle');
    const textBodyInput = document.getElementById('importTextBody');
    const textImportBtn = document.getElementById('importTextImportBtn');

    const stageUpload = document.getElementById('importStageUpload');
    const stagePick = document.getElementById('importStagePick');
    const stageProgress = document.getElementById('importStageProgress');

    const tocList = document.getElementById('importTocList');
    const filterInput = document.getElementById('importFilter');
    const selectAllBtn = document.getElementById('importSelectAll');
    const selectNoneBtn = document.getElementById('importSelectNone');
    const selectMainBtn = document.getElementById('importSelectMain');
    const selectionMeta = document.getElementById('importSelectionMeta');
    const advancedToggleBtn = document.getElementById('importAdvancedToggle');
    const advancedPanel = document.getElementById('importAdvancedPanel');
    const doImportBtn = document.getElementById('importDoImport');
    const backBtn = document.getElementById('importBackBtn');

    const keepParasChk = document.getElementById('importKeepParagraphs');
    const cleanupHeadingsChk = document.getElementById('importCleanupHeadings');
    const breakByPageNumberChk = document.getElementById('importBreakByPageNumber');

    const previewTitle = document.getElementById('importPreviewTitle');
    const previewBody = document.getElementById('importPreviewBody');

    const progMeta = document.getElementById('importProgressMeta');
    const progFill = document.getElementById('importProgressFill');
    const progDetail = document.getElementById('importProgressDetail');
    const doneBtn = document.getElementById('importDoneBtn');

    if (!openBtn || !modal) return;

    let _file = null;
    let _zip = null;
    let _needsConversion = false; // true for any non-EPUB format that goes through /api/content?action=book-import
    let _inputFormat = '';        // the source format string passed to FreeConvert (e.g. 'pdf', 'docx')
    let _tocItems = []; // {id,title,href,selected,tags,type,preview}
    let _activeId = null;
    let _spineHrefs = [];
    let _bookTitle = '';

    let _advancedMode = false;
    let _inputMode = 'file';

    // Action locks — prevent duplicate concurrent operations.
    // _capacityVerified: false until background server check resolves after modal open.
    //   Action buttons are disabled during this window to prevent capacity bypass.
    // _scanInProgress / _importInProgress: prevent re-entrant scans or imports from
    //   rapid button clicks. Set synchronously before the first await in each operation.
    let _capacityVerified = false;
    let _scanInProgress = false;
    let _importInProgress = false;

    function _setActionButtonsLocked(locked) {
      // Apply/release the capacity verification lock on action surfaces.
      // Each button's final enabled state also respects its own readiness condition.
      if (scanBtn) scanBtn.disabled = locked || !_file;
      if (doImportBtn) doImportBtn.disabled = locked || !(_tocItems.some(x => x.selected));
      if (textImportBtn) textImportBtn.disabled = locked || !(textBodyInput && String(textBodyInput.value || '').trim());
    }

    function resetImporterState(opts = {}) {
      const keepModalOpen = !!opts.keepModalOpen;
      _file = null;
      _zip = null;
      _needsConversion = false;
      _inputFormat = '';
      _tocItems = [];
      _activeId = null;
      _spineHrefs = [];
      _bookTitle = '';
      // Reset action locks on every close. Next open will re-verify capacity.
      if (!keepModalOpen) {
        _capacityVerified = false;
        _scanInProgress = false;
        _importInProgress = false;
      }
      setAdvancedMode(false);
      if (fileInput) fileInput.value = '';
      if (dropzone) dropzone.classList.remove('is-dragover');
      if (uploadStatus) { uploadStatus.style.display = 'none'; uploadStatus.textContent = ''; }
      if (tocList) tocList.innerHTML = '';
      if (filterInput) filterInput.value = '';
      if (selectionMeta) selectionMeta.textContent = 'No sections selected';
      if (previewTitle) previewTitle.textContent = '';
      if (previewBody) previewBody.innerHTML = '';
      if (progMeta) progMeta.textContent = '';
      if (progDetail) progDetail.textContent = '';
      if (progFill) progFill.style.width = '0%';
      if (doneBtn) doneBtn.style.display = 'none';
      if (scanBtn) scanBtn.disabled = true;
      if (doImportBtn) doImportBtn.disabled = true;
      if (textTitleInput) textTitleInput.value = '';
      if (textBodyInput) textBodyInput.value = '';
      _inputMode = 'file';
      syncInputMode();
      if (!keepModalOpen) {
        if (modal) modal.style.display = 'none';
        if (modal) modal.setAttribute('aria-hidden', 'true');
      }
      showStage('upload');
      return true;
    }

    window.resetImporterState = function runtimeResetImporterState(opts = {}) {
      return resetImporterState(opts);
    };

    // One authoritative entry path when a file is already in hand (e.g. page-level
    // drag/drop). Opens the modal immediately — same pattern as showModal() — so there
    // is no perceptible delay between drop and modal appearance. Action buttons are
    // locked until the background server capacity check resolves.
    window.openImporterWithFile = async function openImporterWithFile(file) {
      if (!file || !modal) return false;

      // Signal immediately (synchronous, before any await) that the drop was received.
      // This gives the user visible feedback during the local IndexedDB snapshot fetch.
      try { document.body.classList.add('import-drop-pending'); } catch (_) {}

      const localSnapshot = await getImportCapacitySnapshot();
      syncImportEntryState(localSnapshot);

      // Open the modal right away — do not wait for the server.
      _capacityVerified = false;
      resetImporterState({ keepModalOpen: true });
      setStatus(describeCapacity(localSnapshot));
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      _setActionButtonsLocked(true);
      onFileSelected(file);

      try { document.body.classList.remove('import-drop-pending'); } catch (_) {}

      // Background: confirm with server. Unlock or close based on response.
      guardImportCapacity().then(guard => {
        if (modal.style.display === 'none') return;
        setStatus(describeCapacity(guard.snapshot));
        if (!guard.ok) {
          resetImporterState({ keepModalOpen: false });
        } else {
          _capacityVerified = true;
          _setActionButtonsLocked(false);
        }
      }).catch(() => {
        _capacityVerified = true;
        _setActionButtonsLocked(false);
      });

      return true;
    };

    window.getImporterDiagnosticsSnapshot = function getImporterDiagnosticsSnapshot() {
      return {
        hasFile: !!_file,
        fileName: _file ? _file.name : null,
        hasZip: !!_zip,
        needsConversion: !!_needsConversion,
        inputFormat: _inputFormat || '',
        tocCount: Array.isArray(_tocItems) ? _tocItems.length : 0,
        activeId: _activeId || null,
        modalOpen: modal ? modal.style.display === 'flex' : false,
        inputMode: _inputMode
      };
    };

    function setAdvancedMode(on) {
      _advancedMode = !!on;
      if (advancedPanel) advancedPanel.style.display = _advancedMode ? 'block' : 'none';
      if (tocList) tocList.style.display = _advancedMode ? 'none' : 'block';
      if (filterInput) filterInput.style.display = _advancedMode ? 'none' : 'block';

      // Hide selection tools when in advanced mode to avoid cramped layout.
      const tools = document.querySelector('.import-picker-tools');
      if (tools) tools.style.display = _advancedMode ? 'none' : '';

      if (advancedToggleBtn) advancedToggleBtn.textContent = _advancedMode ? 'Contents' : 'Advanced';
    }

    function syncInputMode() {
      const isText = _inputMode === 'text';
      if (modeFileBtn) {
        modeFileBtn.classList.toggle('active', !isText);
        modeFileBtn.setAttribute('aria-pressed', !isText ? 'true' : 'false');
      }
      if (modeTextBtn) {
        modeTextBtn.classList.toggle('active', isText);
        modeTextBtn.setAttribute('aria-pressed', isText ? 'true' : 'false');
      }
      if (filePanel) filePanel.classList.toggle('hidden-section', isText);
      if (textPanel) textPanel.classList.toggle('hidden-section', !isText);
      if (scanBtn) scanBtn.classList.toggle('hidden-section', isText);
      if (textImportBtn) textImportBtn.classList.toggle('hidden-section', !isText);
      if (isText) syncTextImportState();
    }

    function syncTextImportState() {
      if (!textImportBtn) return;
      const hasText = !!(textBodyInput && String(textBodyInput.value || '').trim());
      textImportBtn.disabled = !hasText;
      if (_inputMode === 'text') setStatus(hasText ? 'Text will be split into pages using the normal importer page-breaking behavior.' : 'Paste text to import it as a book.');
    }

    function generateLocalImportId(prefix = 'upl') {
      const safePrefix = String(prefix || 'upl').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'upl';
      try {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') return `${safePrefix}-${window.crypto.randomUUID()}`;
      } catch (_) {}
      return `${safePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    async function completeImportAndReturn(countLabel) {
      try { if (typeof window.__rcRefreshBookSelect === 'function') await window.__rcRefreshBookSelect(); } catch (_) {}
      try { window.dispatchEvent(new CustomEvent('rc:local-library-changed', { detail: { count: await getLocalBookCount() } })); } catch (_) {}
      try { syncImportEntryState(await getImportCapacitySnapshot()); } catch (_) {}
      setStatus(countLabel || 'Import complete');
      hideModal();
    }

    
async function savePastedTextImport() {
  if (_importInProgress || !_capacityVerified) return;
  const raw = String(textBodyInput && textBodyInput.value || '').trim();
  if (!raw) return;
  _importInProgress = true;
  if (textImportBtn) textImportBtn.disabled = true;

  try {
    const guard = await guardImportCapacity();
    syncImportEntryState(guard.snapshot);
    if (!guard.ok) return;

    const pageBreak = await requestServerPageBreak({
      kind: 'text',
      raw,
      options: {
        pageSize: document.getElementById('importPageSize') ? Number(document.getElementById('importPageSize').value || 1600) : 1600,
        breakByPageNumber: !(breakByPageNumberChk && breakByPageNumberChk.checked === false),
      },
    });
    const pages = Array.isArray(pageBreak?.pages) ? pageBreak.pages : [];
    if (!pages.length) {
      setStatus('No readable pages were found in the pasted text.');
      return;
    }

    showStage('progress');
    doneBtn.style.display = 'none';
    setProgress(15, 'Preparing text import', `${pages.length} pages detected`);

    const stamp = new Date();
    const title = String(textTitleInput && textTitleInput.value || '').trim() || `Pasted Text ${stamp.toLocaleDateString()} ${stamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    const id = generateLocalImportId('text');
    const markdown = String(pageBreak?.markdown || '').trim();
    const record = {
      id,
      title,
      createdAt: Date.now(),
      sourceName: 'Pasted Text',
      importKind: 'text',
      byteSize: raw.length,
      pageCount: Number(pageBreak?.pageCount || pages.length),
      markdown,
    };

    setProgress(75, 'Saving to device', `${pages.length} pages created`);
    if (typeof window.__rcLocalBookPut === 'function') await window.__rcLocalBookPut(record);
    else if (typeof localBookPut === 'function') await localBookPut(record);
    setProgress(100, 'Import complete', `${pages.length} pages created`);
    // Consume usage post-commit: book is already saved, so the import
    // succeeds regardless of the verdict. The verdict is informational.
    try {
      if (window.rcUsage && typeof window.rcUsage.consume === 'function') {
        const usageVerdict = await window.rcUsage.consume('book_import');
        const usageMsg = _describeUsageConsumeVerdict(usageVerdict);
        if (usageMsg) setProgress(100, 'Import complete', usageMsg);
      }
    } catch (_) {}
    await completeImportAndReturn(`${pages.length} pages created`);
  } catch (e) {
    console.error('Text import error:', e);
    setProgress(100, 'Import failed', 'Try again with different text.');
    doneBtn.style.display = 'inline-block';
  } finally {
    _importInProgress = false;
    if (textImportBtn) textImportBtn.disabled = !(textBodyInput && String(textBodyInput.value || '').trim());
  }
}

async function showModal() {
      // Open the modal immediately using the local capacity snapshot — no perceptible lag.
      // Action buttons are locked until the server confirms capacity, preventing the window
      // where a user could start an import before a server-side denial arrives.
      const localSnapshot = await getImportCapacitySnapshot();
      syncImportEntryState(localSnapshot);
      resetImporterState({ keepModalOpen: true });
      _capacityVerified = false;
      setStatus(describeCapacity(localSnapshot));
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      syncInputMode();
      syncTextImportState();
      // Lock all action buttons until server check resolves.
      _setActionButtonsLocked(true);

      guardImportCapacity().then(guard => {
        if (modal.style.display === 'none') return;
        setStatus(describeCapacity(guard.snapshot));
        if (!guard.ok) {
          // Server denied — close modal (guardImportCapacity already set status and
          // may have opened the pricing modal).
          resetImporterState({ keepModalOpen: false });
        } else {
          // Server confirmed capacity — unlock actions.
          _capacityVerified = true;
          _setActionButtonsLocked(false);
        }
      }).catch(() => {
        // Server unreachable — trust local verdict and unlock.
        _capacityVerified = true;
        _setActionButtonsLocked(false);
      });
    }

    function hideModal() {
      resetImporterState({ keepModalOpen: false });
    }

    function showStage(which) {
      if (stageUpload) stageUpload.style.display = (which === 'upload') ? 'block' : 'none';
      if (stagePick) stagePick.style.display = (which === 'pick') ? 'block' : 'none';
      if (stageProgress) stageProgress.style.display = (which === 'progress') ? 'block' : 'none';
      if (which === 'pick') setAdvancedMode(false);
    }

    function setStatus(msg) {
      if (!uploadStatus) return;
      uploadStatus.style.display = msg ? 'block' : 'none';
      uploadStatus.textContent = msg || '';
    }

    async function getLocalBookCount() {
      try {
        if (typeof localBooksGetAll === 'function') {
          const books = await localBooksGetAll();
          return Array.isArray(books) ? books.length : 0;
        }
      } catch (_) {}
      return 0;
    }

    async function getImportCapacitySnapshot() {
      const count = await getLocalBookCount();
      const limit = (window.rcPolicy && typeof window.rcPolicy.getImportSlotLimit === 'function')
        ? window.rcPolicy.getImportSlotLimit()
        : null;
      const hasCapacity = (window.rcPolicy && typeof window.rcPolicy.hasImportCapacity === 'function')
        ? window.rcPolicy.hasImportCapacity(count)
        : true;
      return { count, limit, hasCapacity };
    }

    function getAuthHeaders() {
      try {
        const token = window.rcAuth && typeof window.rcAuth.getAccessToken === 'function'
          ? window.rcAuth.getAccessToken()
          : '';
        return token ? { Authorization: `Bearer ${token}` } : {};
      } catch (_) { return {}; }
    }

    async function guardImportCapacity() {
      const snapshot = await getImportCapacitySnapshot();
      // Pass 3: back the capacity verdict with a server-owned policy check.
      // The server resolves its own tier (production ignores client claims).
      // count is still client-provided (interim until Pass 4 durable tracking).
      let hasCapacity = snapshot.hasCapacity;
      try {
        const resp = await fetch(
          (typeof apiUrl === 'function' ? apiUrl('/api/app?kind=import-capacity') : '/api/app?kind=import-capacity'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ count: snapshot.count }),
            cache: 'no-store',
          }
        );
        if (resp.ok) {
          const data = await resp.json();
          hasCapacity = !!data.hasCapacity;
          // Sync server-resolved limit back so display stays accurate.
          if (typeof data.limit !== 'undefined') snapshot.limit = data.limit;
        }
      } catch (_) {
        // Server unreachable: fall back to client snapshot verdict.
        // BRIDGE: client verdict is the fallback until server is reachable.
        // Real owner: /api/app?kind=import-capacity.
      }
      if (hasCapacity) return { ok: true, snapshot };
      const msg = snapshot.limit == null
        ? 'Import is currently unavailable.'
        : `This tier is full (${snapshot.count}/${snapshot.limit} saved books). Delete a book or upgrade to add another.`;
      setStatus(msg);
      try { if (typeof openModal === 'function') openModal('pricing-modal'); } catch (_) {}
      return { ok: false, snapshot, message: msg };
    }

    function describeCapacity(snapshot) {
      if (!snapshot) return '';
      return snapshot.limit == null
        ? `Saved on this device: ${snapshot.count}`
        : `Saved on this device: ${snapshot.count}/${snapshot.limit}`;
    }

    // Returns a human-readable note about a usage consume verdict, or null if
    // no extra message is needed (e.g. allowed, or server was simply unavailable).
    function _describeUsageConsumeVerdict(verdict) {
      if (!verdict || verdict.allowed) return null;
      const reason = String(verdict.reason || '');
      if (reason === 'daily_limit_reached') return 'Daily import limit reached — resets at midnight UTC.';
      if (reason === 'auth_required') return 'Sign in to track your import usage.';
      // server_unavailable and server_error: book is saved, usage just wasn't recorded.
      return null;
    }

    function syncImportEntryState(snapshot) {
      if (!openBtn) return;
      const blocked = !!snapshot && snapshot.hasCapacity === false;
      openBtn.dataset.slotBlocked = blocked ? 'true' : 'false';
      openBtn.title = blocked
        ? `Import limit reached (${snapshot.count}/${snapshot.limit}). Delete a book or upgrade to add another.`
        : 'Import a book to this device';
    }

    function setProgress(pct, meta, detail) {
      if (progFill) progFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
      if (progMeta) progMeta.textContent = meta || '';
      if (progDetail) progDetail.textContent = detail || '';
    }

    function escapeHtmlLite(s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function updateSelectionMeta() {
      if (!selectionMeta) return;
      const n = _tocItems.filter(x => x.selected).length;
      const total = _tocItems.length;
      selectionMeta.textContent = `Selected: ${n}/${total}`;
      if (doImportBtn) doImportBtn.disabled = n === 0;
    }

    function renderToc() {
      if (!tocList) return;
      const q = String(filterInput?.value || '').trim().toLowerCase();
      tocList.innerHTML = '';
      const frag = document.createDocumentFragment();
      _tocItems.forEach((it) => {
        if (q && !String(it.title || '').toLowerCase().includes(q)) return;
        const row = document.createElement('div');
        row.className = 'toc-row' + (it.id === _activeId ? ' is-active' : '');
        row.dataset.id = it.id;

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!it.selected;
        cb.addEventListener('click', (e) => {
          e.stopPropagation();
          it.selected = cb.checked;
          updateSelectionMeta();
        });

        const body = document.createElement('div');
        const t = document.createElement('div');
        t.className = 'toc-title';
        t.textContent = it.title || 'Untitled';

        const meta = document.createElement('div');
        meta.className = 'toc-meta';
        meta.textContent = it.type === 'chapter' ? 'Chapter' : (it.type || 'Section');

        const pills = document.createElement('div');
        pills.className = 'toc-pills';
        (it.tags || []).forEach((p) => {
          const pill = document.createElement('span');
          pill.className = 'toc-pill';
          pill.textContent = p;
          pills.appendChild(pill);
        });

        body.appendChild(t);
        body.appendChild(meta);
        if (pills.childNodes.length) body.appendChild(pills);

        row.appendChild(cb);
        row.appendChild(body);

        row.addEventListener('click', async () => {
          _activeId = it.id;
          renderToc();
          if (previewTitle) previewTitle.textContent = it.title || 'Untitled';
          if (previewBody) previewBody.textContent = 'Loading preview…';
          try {
            // Preview the whole section range (from this TOC href until next TOC href in spine order)
            const spine = Array.isArray(_spineHrefs) ? _spineHrefs : [];
            const hrefToIndex = new Map(spine.map((h, idx) => [_normEpubHref(h), idx]));
            const start = hrefToIndex.get(_normEpubHref(it.href));
            let end = spine.length;
            for (let j = it._order + 1; j < _tocItems.length; j++) {
              const nxt = _tocItems[j];
              const ni = hrefToIndex.get(_normEpubHref(nxt.href));
              if (typeof ni === 'number' && typeof start === 'number' && ni > start) { end = ni; break; }
            }
            let nextSameSpine = null;
            for (let j = it._order + 1; j < _tocItems.length; j++) {
              const nxt = _tocItems[j];
              const ni = hrefToIndex.get(_normEpubHref(nxt.href));
              if (typeof ni === 'number' && typeof start === 'number' && ni === start && Number.isFinite(nxt.blockIndex)) {
                nextSameSpine = nxt;
                break;
              }
              if (typeof ni === 'number' && typeof start === 'number' && ni > start) break;
            }
            const blocks = [];
            if (typeof start === 'number') {
              for (let s = start; s < end; s++) {
                const html = await zipReadText(_zip, spine[s]);
                const cleanupHeadings = !!cleanupHeadingsChk?.checked;
                let cleaned = extractTextBlocksFromHtml(html)
                  .map(b => cleanImportedBlock(b, { bookTitle: _bookTitle || '', artifactTitles: _tocItems.map(x => x.title) }))
                  .filter(b => b && (!cleanupHeadings || !isDecorativeSpacedHeading(b)));
                cleaned = mergeFragmentedBlocks(cleaned)
                  .filter(b => b && (!cleanupHeadings || !isDecorativeSpacedHeading(b)));
                let startIdx = 0;
                let endIdx = cleaned.length;
                if (s === start && Number.isFinite(it.blockIndex)) startIdx = Math.min(cleaned.length, Math.max(0, it.blockIndex));
                if (s === start && nextSameSpine && Number.isFinite(nextSameSpine.blockIndex)) endIdx = Math.min(endIdx, Math.max(startIdx, nextSameSpine.blockIndex));
                if (s === end - 1 && !nextSameSpine) {
                  for (let j = it._order + 1; j < _tocItems.length; j++) {
                    const nxt = _tocItems[j];
                    const ni = hrefToIndex.get(_normEpubHref(nxt.href));
                    if (typeof ni === 'number' && ni === s && Number.isFinite(nxt.blockIndex)) { endIdx = Math.min(endIdx, Math.max(startIdx, nxt.blockIndex)); break; }
                    if (typeof ni === 'number' && ni > s) break;
                  }
                }
                for (let bi = startIdx; bi < endIdx; bi++) blocks.push(cleaned[bi]);
              }
            }
            const sample = (blocks || []).slice(0, 10).join('\n\n');
            if (previewBody) previewBody.textContent = sample || '(No preview available)';
          } catch (e) {
            if (previewBody) previewBody.textContent = '(Preview failed to load)';
          }
        });

        frag.appendChild(row);
      });
      tocList.appendChild(frag);
    }

    async function onFileSelected(file) {
      _file = file || null;
      _zip = null;
      _needsConversion = false;
      _inputFormat = '';
      _tocItems = [];
      _activeId = null;

      if (_file) {
        const ext = (_file.name.match(/\.([^.]+)$/i) || [])[1]?.toLowerCase() || '';
        const CONVERSION_FORMATS = {
          pdf: 'pdf', doc: 'doc', docx: 'docx', rtf: 'rtf',
          odt: 'odt', txt: 'txt', text: 'txt', html: 'html', htm: 'html',
          mobi: 'mobi', fb2: 'fb2'
        };
        if (ext === 'epub') {
          _needsConversion = false;
          _inputFormat = 'epub';
        } else if (CONVERSION_FORMATS[ext]) {
          _needsConversion = true;
          _inputFormat = CONVERSION_FORMATS[ext];
        }
        _bookTitle = _file.name.replace(/\.[^.]+$/, '').trim();
      } else {
        _bookTitle = '';
      }

      if (!scanBtn) return;
      if (!_file) { scanBtn.disabled = true; setStatus(''); return; }
      scanBtn.disabled = false;
      const fileType = _inputFormat.toUpperCase() || 'Unknown';
      setStatus(`Selected: ${_file.name} (${Math.round((_file.size || 0) / 1024)} KB) — ${fileType}`);
    }

    async function scanContents() {
      if (!_file || _scanInProgress || !_capacityVerified) return;
      // Lock immediately — before any await — so rapid clicks cannot trigger
      // concurrent scans regardless of which code path runs next.
      _scanInProgress = true;
      if (scanBtn) scanBtn.disabled = true;

      try {

      // Branch to the FreeConvert conversion path for all non-EPUB formats.
      if (_needsConversion) { await scanContentsViaConversion(); return; }

      // Guard: if the file isn't recognized as EPUB or a convertible format, stop early.
      if (_inputFormat !== 'epub') {
        setStatus(`Unsupported file type. Please upload an EPUB, PDF, DOCX, MOBI, RTF, ODT, FB2, TXT, or HTML file.`);
        return;
      }

      if (!window.JSZip) {
        setStatus('JSZip failed to load. Check your network connection.');
        return;
      }

      try {
        setStatus('Reading book…');
        const buf = await _file.arrayBuffer();
        _zip = await JSZip.loadAsync(buf);
        const opfPath = await epubFindOpfPath(_zip);
        if (!opfPath) throw new Error('OPF not found');
        const { metadata, items, spineHrefs } = await epubParseToc(_zip, opfPath);
        _spineHrefs = Array.isArray(spineHrefs) ? spineHrefs : [];
        const baseTitle = (metadata?.title || _file.name.replace(/\.epub$/i, '')).trim();
        _bookTitle = baseTitle;

        // Build toc list with ids
        _tocItems = (items || []).map((it, idx) => {
          const t = (it.title || `Section ${idx + 1}`).trim();

          // Drop obvious junk: TOC titles that are actually full paragraphs.
          const words = t.split(/\s+/).filter(Boolean);
          const looksLikeParagraph = (t.length > 120) || (t.length > 80 && words.length > 14) || (words.length > 24);
          if (looksLikeParagraph) return null;

          const cls = classifySection(t);
          return {
            id: `${idx}:${t}`,
            title: t,
            href: it.href,
            blockIndex: Number.isFinite(it.blockIndex) ? it.blockIndex : null,
            _order: idx,
            type: cls.type,
            tags: cls.tags,
            selected: defaultSelectedForTitle(t)
          };
        }).filter(Boolean);

        // De-dupe obvious junk: empty titles, duplicates by href
        const seenLoc = new Set();
        _tocItems = _tocItems.filter((x) => {
          if (!x.title || x.title.length < 2) return false;
          if (!x.href) return false;
          const locKey = `${x.href}|${Number.isFinite(x.blockIndex) ? x.blockIndex : ''}|${x.title.toLowerCase()}`;
          if (seenLoc.has(locKey)) return false;
          seenLoc.add(locKey);
          return true;
        });

        // Ensure stable order field after filtering
        _tocItems.forEach((x, i) => { x._order = i; });

        // Default preview
        if (previewTitle) previewTitle.textContent = baseTitle;
        if (previewBody) previewBody.textContent = 'Select a section on the left to preview it.';

        updateSelectionMeta();
        renderToc();
        showStage('pick');
      } catch (e) {
        console.error('Book scan error:', e);
        setStatus('Failed to scan book. Try another file.');
      } finally {
        if (scanBtn) scanBtn.disabled = !_file;
      }

      } finally {
        // Release the in-progress lock whether the scan succeeded, failed, or was
        // short-circuited by an early return. Button state is managed by the inner
        // finally above; this only resets the concurrency guard.
        _scanInProgress = false;
      }
    }

    async function scanContentsViaConversion() {
      const formatLabel = _inputFormat.toUpperCase();
      try {
        scanBtn.disabled = true;

        if (!window.JSZip) {
          setStatus('JSZip failed to load. Check your network connection.');
          return;
        }

        const endpoint = apiUrl('/api/content?action=book-import');

        // ── Step 1: Get a FreeConvert upload URL (API key stays server-side) ──
        setStatus('Preparing upload…');
        const uploadTaskRes = await fetch(`${endpoint}?step=upload`, { method: 'POST' });
        if (!uploadTaskRes.ok) throw new Error(`Upload task failed (${uploadTaskRes.status})`);
        const { importTaskId, uploadUrl, signature } = await uploadTaskRes.json();

        // ── Step 2: Upload file directly to FreeConvert ───────────────────────
        // Uploading directly avoids Vercel's body size limit entirely.
        setStatus(`Uploading ${formatLabel} (${Math.round(_file.size / 1024)} KB)…`);
        const formData = new FormData();
        formData.append('signature', signature);
        formData.append('file', _file, _file.name);
        const uploadRes = await fetch(uploadUrl, { method: 'POST', body: formData });
        if (!uploadRes.ok) throw new Error(`${formatLabel} upload to FreeConvert failed`);

        // ── Step 3: Kick off conversion to EPUB ───────────────────────────────
        setStatus(`Starting ${formatLabel} → EPUB conversion…`);
        const convertRes = await fetch(`${endpoint}?step=convert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ importTaskId, inputFormat: _inputFormat }),
        });
        if (!convertRes.ok) throw new Error(`Conversion start failed (${convertRes.status})`);
        const { exportTaskId } = await convertRes.json();

        // ── Step 4: Poll until done (max 90 seconds) ──────────────────────────
        let epubUrl = null;
        for (let i = 0; i < 45; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const statusRes = await fetch(`${endpoint}?step=status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ exportTaskId }),
          });
          if (!statusRes.ok) throw new Error('Status check failed');
          const { status, url } = await statusRes.json();
          if (status === 'completed' && url) { epubUrl = url; break; }
          if (status === 'failed') throw new Error('FreeConvert reported conversion failed');
          setStatus(`Converting ${formatLabel} → EPUB… (${(i + 1) * 2}s)`);
        }
        if (!epubUrl) throw new Error('Conversion timed out after 90s');

        // ── Step 5: Fetch EPUB and hand off to the existing EPUB scan flow ────
        setStatus('Downloading converted EPUB…');
        const epubRes = await fetch(epubUrl);
        if (!epubRes.ok) throw new Error('Failed to download converted EPUB');
        const epubBuf = await epubRes.arrayBuffer();

        setStatus('Reading book…');
        _zip = await JSZip.loadAsync(epubBuf);
        const opfPath = await epubFindOpfPath(_zip);
        if (!opfPath) throw new Error('OPF not found in converted EPUB');
        const { metadata, items, spineHrefs } = await epubParseToc(_zip, opfPath);
        _spineHrefs = Array.isArray(spineHrefs) ? spineHrefs : [];
        const baseTitle = (metadata?.title || _bookTitle).trim();
        _bookTitle = baseTitle;

        _tocItems = (items || []).map((it, idx) => {
          const t = (it.title || `Section ${idx + 1}`).trim();
          const words = t.split(/\s+/).filter(Boolean);
          const looksLikeParagraph = (t.length > 120) || (t.length > 80 && words.length > 14) || (words.length > 24);
          if (looksLikeParagraph) return null;
          const cls = classifySection(t);
          return {
            id: `${idx}:${t}`,
            title: t,
            href: it.href,
            blockIndex: Number.isFinite(it.blockIndex) ? it.blockIndex : null,
            _order: idx,
            type: cls.type,
            tags: cls.tags,
            selected: defaultSelectedForTitle(t)
          };
        }).filter(Boolean);

        const seenLoc = new Set();
        _tocItems = _tocItems.filter((x) => {
          if (!x.title || x.title.length < 2) return false;
          if (!x.href) return false;
          const locKey = `${x.href}|${Number.isFinite(x.blockIndex) ? x.blockIndex : ''}|${x.title.toLowerCase()}`;
          if (seenLoc.has(locKey)) return false;
          seenLoc.add(locKey);
          return true;
        });
        _tocItems.forEach((x, i) => { x._order = i; });

        if (previewTitle) previewTitle.textContent = baseTitle;
        if (previewBody) previewBody.textContent = 'Select a section on the left to preview it.';

        updateSelectionMeta();
        renderToc();
        showStage('pick');
      } catch (e) {
        console.error('Book conversion scan error:', e);
        // Show a plain message plus a fallback link in case the API is rate-limited or unavailable.
        const plainMsg = `Failed to convert ${formatLabel}: ${e.message || 'Unknown error'}. `;
        const fallbackMsg = `You can convert it yourself at `;
        if (uploadStatus) {
          uploadStatus.style.display = 'block';
          uploadStatus.innerHTML =
            escapeHtmlLite(plainMsg) +
            escapeHtmlLite(fallbackMsg) +
            `<a href="https://www.freeconvert.com/epub-converter" target="_blank" rel="noopener noreferrer">freeconvert.com/epub-converter</a>` +
            ` and then import the resulting EPUB here.`;
        }
      } finally {
        scanBtn.disabled = !_file;
      }
    }

    async function doImportSelected() {
      if (!_file || !_zip || _importInProgress || !_capacityVerified) return;
      const selectedIds = new Set(_tocItems.filter(x => x.selected).map(x => x.id));
      if (selectedIds.size === 0) return;
      // Lock immediately — before any await — so rapid clicks cannot trigger concurrent imports.
      _importInProgress = true;
      if (doImportBtn) doImportBtn.disabled = true;

      try {
        // Re-verify capacity at write time as a server-side safety check.
        // (Capacity was already verified when the modal opened, but this catches
        // edge cases like another device importing during the same session.)
        const guard = await guardImportCapacity();
        syncImportEntryState(guard.snapshot);
        if (!guard.ok) {
          showStage('upload');
          return;
        }


showStage('progress');
doneBtn.style.display = 'none';
setProgress(0, 'Preparing', '');

        const buf = await _file.arrayBuffer();
        const bookHash = await hashArrayBufferSha256(buf);

        const id = generateLocalImportId('upl');
        const title = _file.name.replace(/\.[^.]+$/, '').trim();

        const total = selectedIds.size;
        let createdPages = 0;

        // Build markdown
        // keepParasChk is currently informational; paragraph preservation is the default behavior.
        const cleanupHeadings = !!cleanupHeadingsChk?.checked;

        const sections = await epubExtractSelectedSections(
          _zip,
          _tocItems,
          selectedIds,
          _spineHrefs,
          {
            cleanupHeadings,
            bookTitle: title,
            onProgress: ({ done, total }) => {
              const pct = total ? Math.round((done / total) * 55) : 0;
              setProgress(pct, `Extracting sections (${done}/${total})`, `${createdPages} pages prepared`);
            }
          }
        );

        setProgress(72, 'Breaking pages', 'Preparing document pages');
        const pageBreak = await requestServerPageBreak({
          kind: 'sections',
          sections,
          options: {
            pageSize: document.getElementById('importPageSize') ? Number(document.getElementById('importPageSize').value || 1600) : 1600,
            breakByPageNumber: !(breakByPageNumberChk && breakByPageNumberChk.checked === false),
          },
        });
        const md = String(pageBreak?.markdown || '').trim();
        createdPages = Number(pageBreak?.pageCount || (md.match(/^\s*##\s+/gm) || []).length);
        setProgress(92, 'Saving to device', `${createdPages} pages created`);

        const record = {
          id,
          title,
          createdAt: Date.now(),
          sourceName: _file.name,
          contentFingerprint: bookHash,
          importKind: (_inputFormat || 'epub').toLowerCase(),
          byteSize: _file.size || 0,
          pageCount: createdPages,
          markdown: md
        };
        await localBookPut(record);

        setProgress(100, 'Import complete', `${createdPages} pages created`);
        // Consume usage post-commit: book is already saved, so the import
        // succeeds regardless of the verdict. The verdict is informational.
        try {
          if (window.rcUsage && typeof window.rcUsage.consume === 'function') {
            const usageVerdict = await window.rcUsage.consume('book_import');
            const usageMsg = _describeUsageConsumeVerdict(usageVerdict);
            if (usageMsg) setProgress(100, 'Import complete', usageMsg);
          }
        } catch (_) {}
        await completeImportAndReturn(`${createdPages} pages created`);
      } catch (e) {
        console.error('EPUB import error:', e);
        setProgress(100, 'Import failed', 'Try again with a different file.');
        doneBtn.style.display = 'inline-block';
      } finally {
        // Always release the import lock so the user can retry without reopening the modal.
        _importInProgress = false;
        if (doImportBtn) doImportBtn.disabled = !(_tocItems.some(x => x.selected));
      }
    }

    function setAllSelected(v) {
      _tocItems.forEach((it) => (it.selected = !!v));
      updateSelectionMeta();
      renderToc();
    }

    function selectMain() {
      _tocItems.forEach((it) => {
        it.selected = (it.type === 'chapter' || it.type === 'intro');
      });
      updateSelectionMeta();
      renderToc();
    }

    // Open/close
    openBtn.addEventListener('click', showModal);
    try { getImportCapacitySnapshot().then(syncImportEntryState).catch(() => {}); } catch (_) {}
    window.addEventListener('rc:runtime-policy-changed', () => {
      try { getImportCapacitySnapshot().then(syncImportEntryState).catch(() => {}); } catch (_) {}
    });
    window.addEventListener('rc:local-library-changed', () => {
      try { getImportCapacitySnapshot().then(syncImportEntryState).catch(() => {}); } catch (_) {}
    });

    // Upload
    // Keep behavior consistent: desktop supports click-to-browse + drag/drop.
    // Mobile/tablet: click-to-browse should open the file picker reliably.
    browseBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fileInput?.click();
    });
    dropzone?.addEventListener('click', (e) => {
      // If the click was on a button (Browse), don't double-trigger.
      const btn = e.target && e.target.closest ? e.target.closest('button') : null;
      if (btn) return;
      fileInput?.click();
    });
    dropzone?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') fileInput?.click();
    });
    fileInput?.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      onFileSelected(f);
    });

    // Drag/drop
    const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter','dragover','dragleave','drop'].forEach((ev) => {
      dropzone?.addEventListener(ev, prevent);
    });
    dropzone?.addEventListener('drop', (e) => {
      const f = e.dataTransfer?.files && e.dataTransfer.files[0];
      if (f) onFileSelected(f);
    });

    modeFileBtn?.addEventListener('click', () => { _inputMode = 'file'; syncInputMode(); });
    modeTextBtn?.addEventListener('click', () => { _inputMode = 'text'; syncInputMode(); });
    textTitleInput?.addEventListener('input', syncTextImportState);
    textBodyInput?.addEventListener('input', syncTextImportState);
    textImportBtn?.addEventListener('click', savePastedTextImport);
    scanBtn?.addEventListener('click', scanContents);
    backBtn?.addEventListener('click', () => showStage('upload'));
    filterInput?.addEventListener('input', renderToc);
    selectAllBtn?.addEventListener('click', () => setAllSelected(true));
    selectNoneBtn?.addEventListener('click', () => setAllSelected(false));
    selectMainBtn?.addEventListener('click', selectMain);
    advancedToggleBtn?.addEventListener('click', () => setAdvancedMode(!_advancedMode));
    doImportBtn?.addEventListener('click', doImportSelected);
    doneBtn?.addEventListener('click', hideModal);

    // Close button and backdrop click both clear all staged state completely.
    closeBtn?.addEventListener('click', hideModal);
    modal?.addEventListener('click', (e) => { if (e.target === modal) hideModal(); });
  })();

  // ===================================
