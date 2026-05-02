// js/annotations.js
// Notes & Flashcards annotation layer.
// UI forwards annotation and navigation intent only; reading/TTS runtime remains the source of page, highlight, and playback truth.
(function () {
  const PREF_KEY = 'jubly:annotations-widget-enabled';
  const LOCAL_KEY = 'jubly:annotations-local-v2';
  const SYNC_KIND = '/api/app?kind=durable-sync';

  const state = {
    mounted: false,
    enabled: false,
    open: false,
    annotations: [],
    activeEditor: '',
    target: null,
    navigationPending: false,
    deletingId: '',
    activeTab: 'notes',
    flashPreviewSide: 'front',
    savedFlashSides: {},
    expandedWidgetId: '',
    editingWidgetId: '',
    sourcePromptId: '',
    activeWidgetFlashId: '',
    els: {},
  };

  function readPref() { try { return localStorage.getItem(PREF_KEY) === '1'; } catch (_) { return false; } }
  function writePref(enabled) { try { localStorage.setItem(PREF_KEY, enabled ? '1' : '0'); } catch (_) {} }
  function uid() {
    try { if (crypto && typeof crypto.randomUUID === 'function') return `local-${crypto.randomUUID()}`; } catch (_) {}
    return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function textHash(text) {
    const input = String(text || '');
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) { hash ^= input.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
  function loadLocalAnnotations() {
    try { const rows = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); return Array.isArray(rows) ? rows.filter(Boolean) : []; } catch (_) { return []; }
  }
  function saveLocalAnnotations(rows) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(Array.isArray(rows) ? rows : [])); } catch (_) {} }
  function getSessionToken() { try { return window.rcAuth && typeof window.rcAuth.getAccessToken === 'function' ? window.rcAuth.getAccessToken() : ''; } catch (_) { return ''; } }
  function getReadingTarget() { try { return Object.assign({}, window.__rcReadingTarget || {}); } catch (_) { return {}; } }
  function getReadingContext() {
    const target = getReadingTarget();
    try {
      if (typeof window.getReadingTargetContext === 'function') {
        return Object.assign({}, target, window.getReadingTargetContext() || {});
      }
    } catch (_) {}
    return target;
  }
  function sameBook(row, ctx = getReadingContext()) {
    if (!row) return false;
    const activeBookId = String(ctx.bookId || '');
    const activeSourceType = String(ctx.sourceType || '');
    return !!activeBookId && String(row.book_id || '') === activeBookId && String(row.source_type || '') === activeSourceType;
  }
  function getPlayback() { try { return typeof window.getPlaybackStatus === 'function' ? window.getPlaybackStatus() : null; } catch (_) { return null; } }
  function isTtsPaused() {
    const playback = getPlayback();
    return !!(playback && playback.active && playback.paused && !playback.cloudRestartInFlight);
  }
  function isReadingVisible() {
    try {
      const reading = document.getElementById('reading-mode');
      if (!reading || reading.classList.contains('hidden-section')) return false;
      const styles = getComputedStyle(reading);
      return !styles || styles.display !== 'none';
    } catch (_) { return false; }
  }
  function findHighlightedSpan() {
    try {
      const spans = Array.from(document.querySelectorAll('#reading-mode .tts-sentence'));
      let best = null;
      let bestAlpha = 0;
      spans.forEach((span) => {
        const raw = (getComputedStyle(span).getPropertyValue('--tts-alpha') || span.style.getPropertyValue('--tts-alpha') || '0');
        const alpha = Number(raw);
        if (Number.isFinite(alpha) && alpha > bestAlpha) { best = span; bestAlpha = alpha; }
      });
      return bestAlpha > 0.35 ? best : null;
    } catch (_) { return null; }
  }
  function getCurrentTarget() {
    const playback = getPlayback();
    const reading = getReadingContext();
    const span = findHighlightedSpan();
    const text = String((span && span.textContent) || '').replace(/\s+/g, ' ').trim();
    const pageIndex = Number.isFinite(Number(reading.pageIndex)) && Number(reading.pageIndex) >= 0 ? Number(reading.pageIndex) : 0;
    const blockIndex = Number.isFinite(Number(playback && playback.activeBlockIndex)) ? Number(playback.activeBlockIndex) : -1;
    if (!playback || !playback.active || !text || blockIndex < 0 || !String(reading.bookId || '')) return null;
    return {
      bookId: String(reading.bookId || ''),
      sourceType: String(reading.sourceType || ''),
      chapterIndex: Number.isFinite(Number(reading.chapterIndex)) ? Number(reading.chapterIndex) : -1,
      pageIndex,
      pageKey: String(playback.key || ''),
      blockIndex,
      highlightedText: text,
      textHash: textHash(text),
    };
  }
  function annotationKeyFromTarget(target) {
    if (!target) return '';
    return [target.bookId || '', target.sourceType || '', target.chapterIndex, target.pageIndex, target.blockIndex, target.textHash || ''].join('|');
  }
  function annotationKey(row) {
    if (!row) return '';
    return [row.book_id || '', row.source_type || '', row.chapter_index, row.page_index, row.block_index, row.text_hash || ''].join('|');
  }
  function normalizeRemoteAnnotation(row) {
    return Object.assign({}, row || {}, { sync_status: 'synced', local_status: 'synced' });
  }
  function markPending(row) {
    return Object.assign({}, row || {}, { sync_status: 'pending', local_status: 'pending', local_updated_at: new Date().toISOString() });
  }
  function markSynced(localRow, serverRow) {
    return Object.assign({}, localRow || {}, serverRow || {}, { sync_status: 'synced', local_status: 'synced', local_updated_at: (serverRow && serverRow.updated_at) || (localRow && localRow.local_updated_at) || new Date().toISOString() });
  }
  function mergeRemoteAnnotations(remoteRows, localRows) {
    const locals = Array.isArray(localRows) ? localRows.filter(Boolean) : [];
    const remotes = Array.isArray(remoteRows) ? remoteRows.filter(Boolean).map(normalizeRemoteAnnotation) : [];
    if (!locals.length) return remotes;

    // User action / local cache truth wins over server hydrate. Server rows fill gaps only.
    const byKey = new Map();
    remotes.forEach((row) => {
      const key = annotationKey(row) || String(row.id || '');
      if (key) byKey.set(key, row);
    });
    locals.forEach((row) => {
      const key = annotationKey(row) || String(row.id || '');
      if (key) byKey.set(key, row);
    });
    return Array.from(byKey.values()).sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
  }
  function allLiveAnnotations() { return (state.annotations || []).filter((row) => row && !row.deleted_at); }
  function liveAnnotations() { const ctx = getReadingContext(); return allLiveAnnotations().filter((row) => sameBook(row, ctx)); }
  function annotationForTarget(target) { const key = annotationKeyFromTarget(target); return key ? allLiveAnnotations().find((row) => annotationKey(row) === key) || null : null; }
  function trimPreview(value, limit = 42) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > limit ? `${text.slice(0, Math.max(1, limit - 1))}…` : text;
  }
  function previewFor(row) { return row && row.type === 'flashcard' ? (row.flashcard_front || '') : (row && (row.note_text || '')) || ''; }
  function sourcePreviewFor(row) { return trimPreview(row && row.highlighted_text, 36); }
  function getChapterTitle(chapterIndex) {
    const idx = Number(chapterIndex);
    try {
      const select = document.getElementById('chapterSelect');
      if (select && Number.isFinite(idx) && idx >= 0) {
        const option = Array.from(select.options || []).find((opt) => Number(opt.value) === idx);
        const label = String((option && option.textContent) || '').trim();
        if (label) return label;
      }
    } catch (_) {}
    return Number.isFinite(idx) && idx >= 0 ? 'Chapter ' + (idx + 1) : 'Chapter';
  }
  function chapterLabelFor(row) {
    return 'CH: “' + trimPreview(getChapterTitle(row && row.chapter_index), 12) + '”';
  }
  function locationMetaFor(row) {
    if (!row) return '';
    const page = Number(row.page_index);
    const pageText = Number.isFinite(page) && page >= 0 ? 'Page ' + (page + 1) : 'Page';
    const sourcePreview = sourcePreviewFor(row);
    return chapterLabelFor(row) + ' · ' + pageText + (sourcePreview ? ' · “' + escapeHtml(sourcePreview) + '”' : '');
  }
  function fillEditorFromAnnotation(row) {
    if (!row) return;
    state.activeEditor = row.type === 'flashcard' ? 'flashcard' : 'note';
    if (row.type === 'flashcard') {
      state.flashPreviewSide = 'front';
      state.els.flashFront.value = row.flashcard_front || '';
      state.els.flashBack.value = row.flashcard_back || '';
      state.els.flashPreview.querySelector('strong').textContent = 'Front';
      state.els.flashPreviewText.textContent = row.flashcard_front || '';
    } else {
      state.els.noteText.value = row.note_text || '';
    }
  }

  async function syncAnnotations(action, payload) {
    const token = await Promise.resolve(getSessionToken()).catch(() => '');
    if (!token) return null;
    const res = await fetch(SYNC_KIND, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action, payload }) });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok || !data || data.ok === false) throw new Error((data && (data.error || data.reason)) || 'Annotation sync failed.');
    return data;
  }
  async function fetchRemoteAnnotations() {
    const token = await Promise.resolve(getSessionToken()).catch(() => '');
    if (!token) return null;
    const res = await fetch(`${SYNC_KIND}&scope=annotations`, { headers: { Authorization: `Bearer ${token}` } });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok || !data || data.ok === false) return null;
    return Array.isArray(data.rows) ? data.rows : [];
  }

  function showToast(message) {
    if (!state.els.toast) return;
    state.els.toast.textContent = String(message || 'Done.');
    state.els.toast.classList.add('show');
    setTimeout(() => state.els.toast && state.els.toast.classList.remove('show'), 1800);
  }
  function helpIsAvailable() {
    if (!(window.rcHelp && typeof window.rcHelp.openChat === 'function')) return false;
    // Treat Help as an available shared utility only while its launcher/panel is mounted.
    // A hard-close removes the Help root and should leave Notes as a standalone utility.
    return !!document.getElementById('jubly-support-widget');
  }
  function closeHelpPanel() { try { if (window.rcHelp && typeof window.rcHelp.close === 'function') window.rcHelp.close(); } catch (_) {} }
  function utilityMode(visible = (!!state.enabled && isReadingVisible())) {
    const notesAvailable = !!visible;
    const helpAvailable = helpIsAvailable();
    if (notesAvailable && helpAvailable) return 'shared';
    if (notesAvailable) return 'notes-only';
    if (helpAvailable) return 'help-only';
    return 'none';
  }
  function applyUtilityMode(visible = (!!state.enabled && isReadingVisible())) {
    const mode = utilityMode(visible);
    try {
      document.body.classList.toggle('annotations-shared-utility-active', mode === 'shared');
      document.body.classList.toggle('annotations-notes-only-utility-active', mode === 'notes-only');
    } catch (_) {}
    if (state.els.root) state.els.root.setAttribute('data-utility-mode', mode);
    if (state.els.utilityMenu) state.els.utilityMenu.classList.toggle('multi', mode === 'shared');
    const helpChoice = state.els.root ? state.els.root.querySelector('[data-open-help]') : null;
    const notesChoice = state.els.root ? state.els.root.querySelector('[data-open-notes]') : null;
    if (helpChoice) helpChoice.hidden = mode !== 'shared';
    if (notesChoice) notesChoice.hidden = mode !== 'shared';
    if (state.els.launcher) {
      state.els.launcher.textContent = mode === 'shared' ? '☰' : '📝';
      state.els.launcher.setAttribute('aria-label', mode === 'shared' ? 'Open reading utilities' : 'Open notes and flashcards');
    }
    if (mode !== 'shared' && state.els.utilityMenu) state.els.utilityMenu.classList.remove('open');
  }
  function setEnabled(enabled, options = {}) {
    state.enabled = !!enabled;
    if (options.persist !== false) writePref(state.enabled);
    document.body.classList.toggle('annotations-widget-enabled', state.enabled);
    document.body.classList.toggle('annotations-utility-active', state.enabled && isReadingVisible());
    if (!state.enabled) { state.open = false; state.activeEditor = ''; closeWidgetPanel(); document.body.classList.remove('annotations-utility-active'); }
    applyUtilityMode(state.enabled && isReadingVisible());
    render();
  }

  function renderSaved(row) {
    if (!state.els.saved) return;
    if (!row) { state.els.saved.classList.remove('active'); state.els.saved.innerHTML = ''; return; }
    if (row.type === 'flashcard') {
      const side = state.savedFlashSides[String(row.id)] === 'back' ? 'back' : 'front';
      const text = side === 'front' ? (row.flashcard_front || '') : (row.flashcard_back || '');
      state.els.saved.innerHTML = `<div class="annotations-flash-preview" data-saved-flash><strong>${side === 'front' ? 'Front' : 'Back'}</strong><span>${escapeHtml(text)}</span></div><em class="annotations-source-meta">${locationMetaFor(row)}</em><div class="annotations-row"><button type="button" data-edit-current>Edit</button><button type="button" data-delete-current>Delete</button></div>`;
      const preview = state.els.saved.querySelector('[data-saved-flash]');
      preview.addEventListener('click', () => {
        const nextSide = state.savedFlashSides[String(row.id)] === 'back' ? 'front' : 'back';
        state.savedFlashSides[String(row.id)] = nextSide;
        preview.querySelector('strong').textContent = nextSide === 'front' ? 'Front' : 'Back';
        preview.querySelector('span').textContent = nextSide === 'front' ? (row.flashcard_front || '') : (row.flashcard_back || '');
      });
    } else {
      state.els.saved.innerHTML = `<strong>Note</strong>${escapeHtml(row.note_text || '')}<em class="annotations-source-meta">${locationMetaFor(row)}</em><div class="annotations-row"><button type="button" data-edit-current>Edit</button><button type="button" data-delete-current>Delete</button></div>`;
    }
    state.els.saved.classList.add('active');
  }

  function renderWidgetLists() {
    const notesList = state.els.notesList;
    const flashList = state.els.flashcardsList;
    if (!notesList || !flashList) return;
    const rows = liveAnnotations();
    const ctx = getReadingContext();
    const activeChapter = Number.isFinite(Number(ctx.chapterIndex)) ? Number(ctx.chapterIndex) : -1;
    const renderRows = (type) => {
      const matching = rows.filter((row) => row.type === type);
      if (!matching.length) return '<div class="annotations-empty">No saved items for this book yet.</div>';
      return matching.slice(0, 40).map((row) => {
        const deleting = state.deletingId && String(state.deletingId) === String(row.id);
        const sameChapter = Number(row.chapter_index) === activeChapter;
        const sourceDisabled = deleting || state.navigationPending;
        const location = locationMetaFor(row);
        const expanded = String(state.expandedWidgetId || '') === String(row.id);
        const editing = String(state.editingWidgetId || '') === String(row.id);
        const activeFlash = expanded && String(state.activeWidgetFlashId || '') === String(row.id);
        const side = state.savedFlashSides[String(row.id)] === 'back' ? 'back' : 'front';
        const displayText = side === 'front' ? (row.flashcard_front || '') : (row.flashcard_back || '');
        const previewCard = type === 'flashcard'
          ? `<div class="annotations-flash-preview" data-widget-flash data-active="${activeFlash ? 'true' : 'false'}"><strong>${side === 'front' ? 'Front' : 'Back'}</strong><span>${escapeHtml(displayText)}</span></div>`
          : `<button class="annotations-item-view" type="button" data-annotation-view><span>${escapeHtml(row.note_text || '')}</span></button>`;
        const sourceText = (expanded || editing) ? `<div class="annotations-modal-source-text${editing ? ' editing-source' : ''}"${editing ? '' : ' data-widget-source-text'}><div class="annotations-context-label">Highlighted passage</div>“${escapeHtml(row.highlighted_text || '')}”</div>` : '';
        const editorHtml = editing ? inlineEditorMarkup(row) : '';
        const showSourcePrompt = String(state.sourcePromptId || '') === String(row.id);
        if (editing) {
          return `<div class="annotations-widget-item editing expanded" data-annotation-id="${escapeHtml(row.id)}"><div class="annotations-item-main"><strong>${type === 'flashcard' ? 'Flashcard' : 'Note'}</strong>${sourceText}<div class="annotations-inline-editor open" data-inline-editor>${editorHtml}</div></div></div>`;
        }
        return `<div class="annotations-widget-item${expanded ? ' expanded' : ''}" data-annotation-id="${escapeHtml(row.id)}"><div class="annotations-item-main"><strong>${type === 'flashcard' ? 'Flashcard' : 'Note'}</strong>${sourceText}${previewCard}<em class="annotations-source-meta">${location}</em><em class="annotations-source-unavailable" data-source-prompt${showSourcePrompt ? '' : ' hidden'}>Open this chapter to view the source.</em><div class="annotations-inline-editor" data-inline-editor></div></div><div class="annotations-item-actions"><button class="annotations-source" type="button" data-annotation-jump${sourceDisabled ? ' disabled' : ''}>Source</button><button class="annotations-edit" type="button" data-annotation-edit>Edit</button><button class="annotations-delete" type="button" data-annotation-delete${deleting ? ' disabled' : ''}>${deleting ? 'Deleting…' : 'Delete'}</button></div></div>`;
      }).join('');
    };
    notesList.innerHTML = renderRows('note');
    flashList.innerHTML = renderRows('flashcard');
  }


  function refreshAnnotationSurfaces() {
    render();
    try {
      if (state.els.panel && state.els.panel.classList.contains('open')) renderWidgetLists();
    } catch (_) {}
  }

  function render() {
    if (!state.mounted) return;
    const visible = !!state.enabled && isReadingVisible();
    document.body.classList.toggle('annotations-utility-active', visible);
    state.els.root.hidden = !visible;
    applyUtilityMode(visible);
    document.body.classList.toggle('annotations-navigation-pending', !!state.navigationPending);
    const checkbox = document.getElementById('annotationsWidgetToggle');
    if (checkbox && checkbox.checked !== state.enabled) checkbox.checked = state.enabled;
    if (!visible) return;

    const paused = isTtsPaused();
    state.target = paused ? getCurrentTarget() : null;
    const currentRow = annotationForTarget(state.target);
    state.els.cardRoot.classList.toggle('visible', !!paused && !!state.target);
    state.els.trigger.disabled = !paused || !state.target || state.navigationPending;
    const sub = state.els.trigger.querySelector('[data-annotation-sub]');
    if (sub) sub.textContent = paused ? (state.target ? 'Open tools for the highlighted sentence' : 'No highlighted sentence available') : 'Pause TTS to save this sentence';
    state.els.card.classList.toggle('open', !!state.open && !!state.target);
    state.els.actions.hidden = !!currentRow || !!state.activeEditor;
    state.els.noteEditor.classList.toggle('active', state.activeEditor === 'note');
    state.els.flashEditor.classList.toggle('active', state.activeEditor === 'flashcard');
    if (state.els.noteContext) state.els.noteContext.textContent = `“${state.target ? state.target.highlightedText : ''}”`;
    if (state.els.flashContext) state.els.flashContext.textContent = `“${state.target ? state.target.highlightedText : ''}”`;
    if (state.activeEditor) renderSaved(null);
    else renderSaved(currentRow);
    if (!currentRow && !state.activeEditor) renderSaved(null);
    state.els.panel.classList.toggle('open', state.els.panel.classList.contains('open'));
    const modalOpen = !!(state.els.panel && state.els.panel.classList.contains('open'));
    // The annotation card re-renders on a short interval to track TTS pause/highlight truth.
    // Do not rebuild the modal lists during that polling loop: replacing the scrollable
    // list while the user is scrolling can trigger browser scroll anchoring/jitter.
    // Modal actions that mutate list state call renderWidgetLists() directly.
    if (!modalOpen) renderWidgetLists();
    renderTabs();
  }

  async function deleteAnnotation(row) {
    if (!row || !row.id) return;
    const id = String(row.id);
    const now = new Date().toISOString();
    const tombstone = Object.assign({}, row, {
      deleted_at: now,
      updated_at: now,
      sync_status: 'pending-delete',
      local_status: 'pending-delete',
      local_updated_at: now,
    });

    // User delete is local truth immediately. Keep a local tombstone so a later
    // server hydrate cannot resurrect the row while the hard-delete is settling.
    state.annotations = (state.annotations || []).map((item) => String(item.id) === id ? tombstone : item);
    saveLocalAnnotations(state.annotations);
    state.activeEditor = '';
    state.editingWidgetId = '';
    state.expandedWidgetId = String(state.expandedWidgetId || '') === id ? '' : state.expandedWidgetId;
    state.sourcePromptId = String(state.sourcePromptId || '') === id ? '' : state.sourcePromptId;
    refreshAnnotationSurfaces();

    if (id.startsWith('local-')) return;

    try {
      await syncAnnotations('delete_annotation', { id });
      state.annotations = (state.annotations || []).map((item) => String(item.id) === id
        ? Object.assign({}, item, { sync_status: 'deleted', local_status: 'deleted', local_updated_at: new Date().toISOString() })
        : item);
      saveLocalAnnotations(state.annotations);
    } catch (_) {
      state.annotations = (state.annotations || []).map((item) => String(item.id) === id
        ? Object.assign({}, item, { sync_status: 'delete-failed', local_status: 'pending-delete', local_updated_at: new Date().toISOString() })
        : item);
      saveLocalAnnotations(state.annotations);
    } finally {
      refreshAnnotationSurfaces();
    }
  }

  async function saveAnnotation(type) {
    const target = state.target || getCurrentTarget();
    if (!target) return;
    const existing = annotationForTarget(target);
    const now = new Date().toISOString();
    const noteText = String(state.els.noteText.value || '').trim();
    const front = String(state.els.flashFront.value || '').trim();
    const back = String(state.els.flashBack.value || '').trim();
    if (existing) {
      const next = markPending(Object.assign({}, existing, {
        type, annotation_type: type, updated_at: now,
        note_text: type === 'note' ? noteText : null,
        flashcard_front: type === 'flashcard' ? front : null,
        flashcard_back: type === 'flashcard' ? back : null,
      }));
      state.annotations = (state.annotations || []).map((item) => String(item.id) === String(existing.id) ? next : item);
      saveLocalAnnotations(state.annotations);
      state.activeEditor = '';
      render();
      try {
        const synced = await syncAnnotations('save_annotation', next);
        if (synced && synced.row && synced.row.id) {
          state.annotations = state.annotations.map((item) => String(item.id) === String(next.id) ? markSynced(next, synced.row) : item);
          saveLocalAnnotations(state.annotations);
          render();
        }
      } catch (_) {}
      return;
    }
    const row = {
      id: uid(), type, book_id: target.bookId, source_type: target.sourceType,
      chapter_index: target.chapterIndex, page_index: target.pageIndex, page_key: target.pageKey,
      block_index: target.blockIndex, highlighted_text: target.highlightedText, text_hash: target.textHash,
      note_text: type === 'note' ? noteText : null,
      flashcard_front: type === 'flashcard' ? front : null,
      flashcard_back: type === 'flashcard' ? back : null,
      created_at: now, updated_at: now, deleted_at: null, sync_status: 'pending', local_status: 'pending', local_updated_at: now,
    };
    state.annotations = [row].concat((state.annotations || []).filter((item) => annotationKey(item) !== annotationKey(row)));
    saveLocalAnnotations(state.annotations);
    state.activeEditor = '';
    render();
    try {
      const synced = await syncAnnotations('save_annotation', row);
      if (synced && synced.row && synced.row.id) {
        state.annotations = state.annotations.map((item) => item.id === row.id ? markSynced(row, synced.row) : item);
        saveLocalAnnotations(state.annotations);
        render();
      }
    } catch (_) {}
  }

  function findAnnotationTargetElement(row) {
    const pageIndex = Number(row && row.page_index);
    const blockIndex = Number(row && row.block_index);
    if (!Number.isFinite(pageIndex)) return null;
    const pages = Array.from(document.querySelectorAll('#reading-mode .page'));
    const page = pages[pageIndex] || document.querySelector(`#reading-mode .page[data-page-index="${pageIndex}"]`);
    if (!page) return null;
    if (Number.isFinite(blockIndex) && blockIndex >= 0) {
      const sentence = page.querySelector(`.tts-sentence[data-tts-sent="${blockIndex}"]`);
      if (sentence) return sentence;
    }
    return page.querySelector('.page-text') || page;
  }

  function inlineEditorMarkup(row) {
    if (!row) return '';
    if (row.type === 'flashcard') {
      return `<input data-edit-front value="${escapeHtml(row.flashcard_front || '')}" /><textarea data-edit-back>${escapeHtml(row.flashcard_back || '')}</textarea><div class="annotations-row"><button type="button" data-save-edit>Save</button><button type="button" data-cancel-edit>Cancel</button></div>`;
    }
    return `<textarea data-edit-note>${escapeHtml(row.note_text || '')}</textarea><div class="annotations-row"><button type="button" data-save-edit>Save</button><button type="button" data-cancel-edit>Cancel</button></div>`;
  }

  function renderInlineEditor(item, row) {
    if (!item || !row) return;
    state.editingWidgetId = String(row.id || '');
    state.expandedWidgetId = String(row.id || '');
    renderWidgetLists();
  }

  async function saveInlineEdit(item, row) {
    if (!item || !row) return;
    const next = markPending(Object.assign({}, row, { updated_at: new Date().toISOString() }));
    if (row.type === 'flashcard') {
      next.flashcard_front = String((item.querySelector('[data-edit-front]') || {}).value || '').trim();
      next.flashcard_back = String((item.querySelector('[data-edit-back]') || {}).value || '').trim();
    } else {
      next.note_text = String((item.querySelector('[data-edit-note]') || {}).value || '').trim();
    }
    state.annotations = (state.annotations || []).map((entry) => String(entry.id) === String(row.id) ? next : entry);
    saveLocalAnnotations(state.annotations);
    state.editingWidgetId = '';
    refreshAnnotationSurfaces();
    try {
      const synced = await syncAnnotations('save_annotation', next);
      if (synced && synced.row && synced.row.id) {
        state.annotations = state.annotations.map((entry) => String(entry.id) === String(next.id) ? markSynced(next, synced.row) : entry);
        saveLocalAnnotations(state.annotations);
        refreshAnnotationSurfaces();
      }
    } catch (_) { showToast('Saved locally. Sync will retry after refresh.'); }
  }

  async function jumpToAnnotation(row) {
    if (!row || state.navigationPending) return;
    const ctx = getReadingContext();
    if (!sameBook(row, ctx)) { showToast('Open that book to view this annotation.'); return; }
    if (Number(row.chapter_index) !== Number(ctx.chapterIndex)) { showToast(`Open Chapter ${Number(row.chapter_index) + 1 || 1} to view this annotation.`); return; }
    state.navigationPending = true;
    closeWidgetPanel();
    render();
    try {
      if (typeof window.setReadingTarget === 'function') window.setReadingTarget({ sourceType: row.source_type || '', bookId: row.book_id || '', chapterIndex: row.chapter_index, pageIndex: row.page_index });
      const targetIndex = Number(row.page_index) || 0;
      if (typeof window.focusReadingPage === 'function') window.focusReadingPage(targetIndex, { behavior: 'smooth', reason: 'annotation-jump' });
      else {
        const page = document.querySelector(`#reading-mode .page[data-page-index="${targetIndex}"]`);
        if (page) page.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (_) {
      showToast('Could not jump to saved location.');
    } finally {
      state.navigationPending = false;
      render();
    }
  }

  async function hydrateAnnotations() {
    state.annotations = loadLocalAnnotations();
    render();
    const remote = await fetchRemoteAnnotations().catch(() => null);
    if (Array.isArray(remote)) {
      state.annotations = mergeRemoteAnnotations(remote, state.annotations);
      saveLocalAnnotations(state.annotations);
      render();
    }
  }

  function injectSettingsRow() {
    const panel = document.getElementById('rs-panel-general');
    if (!panel || document.getElementById('annotationsWidgetToggle')) return;
    const row = document.createElement('div');
    row.className = 'rs-simple-row annotations-setting-row';
    row.innerHTML = `<div><p class="rs-row-title">Notes &amp; Flashcards Widget</p><p class="rs-row-sub">Show the annotation entrypoint and floating notes widget while reading.</p></div><label class="rs-toggle-row"><span class="text-slate-400">Show widget</span><input type="checkbox" id="annotationsWidgetToggle" style="accent-color:var(--theme-accent); width:15px; height:15px; cursor:pointer;"></label>`;
    panel.appendChild(row);
    const input = row.querySelector('#annotationsWidgetToggle');
    input.checked = !!state.enabled;
    input.addEventListener('change', () => setEnabled(!!input.checked));
  }

  function closeWidgetPanel() {
    if (state.els.panel) state.els.panel.classList.remove('open');
    if (state.els.utilityMenu) state.els.utilityMenu.classList.remove('open');
    if (state.els.launcher) state.els.launcher.classList.remove('open');
    try { document.body.classList.remove('annotations-modal-open'); } catch (_) {}
    applyUtilityMode(state.enabled && isReadingVisible());
  }

  function mount() {
    if (state.mounted || !document.body) return;
    injectSettingsRow();
    const root = document.createElement('section');
    root.id = 'annotations-widget';
    root.className = 'annotations-widget';
    root.hidden = true;
    root.innerHTML = `
      <div class="annotations-card" data-annotation-card>
        <button class="annotations-trigger" type="button" data-annotation-trigger disabled><span class="annotations-plus">＋</span><span><strong>Annotate current highlight</strong><small data-annotation-sub>Pause TTS to save this sentence</small></span><span class="annotations-chev">⌄</span></button>
        <div class="annotations-editor-card" data-annotation-editor>
          <p class="annotations-hint">Choose what to save from the current highlighted passage.</p>
          <div class="annotations-actions" data-annotation-actions><button type="button" class="annotations-primary" data-annotation-note>Make Note</button><button type="button" class="annotations-secondary" data-annotation-flash>Make Flashcard</button></div>
          <div class="annotations-form" data-note-editor><div class="annotations-context-label">Highlighted passage</div><div class="annotations-current" data-note-context></div><textarea data-note-text placeholder="Write your note…"></textarea><div class="annotations-row"><button type="button" data-save-note>Save note</button><button type="button" data-cancel>Cancel</button></div></div>
          <div class="annotations-form" data-flash-editor><div class="annotations-context-label">Highlighted passage</div><div class="annotations-current" data-flash-context></div><div class="annotations-context-label">Flashcard preview</div><div class="annotations-flash-preview" data-flash-preview><strong>Front</strong><span data-flash-preview-text></span></div><input data-flash-front placeholder="Flashcard front" /><textarea data-flash-back placeholder="Flashcard back"></textarea><div class="annotations-row"><button type="button" data-save-flash>Save card</button><button type="button" data-cancel>Cancel</button></div></div>
          <div class="annotations-saved" data-annotation-saved></div>
        </div>
      </div>
      <div class="annotations-float">
        <div class="annotations-utility-menu" data-utility-menu><button type="button" data-open-notes><span>📝</span><strong>Notes</strong></button><button type="button" data-open-help><span>?</span><strong>Help</strong></button></div>
        <button type="button" class="annotations-widget-button" data-widget-toggle aria-label="Open utilities">📝</button>
      </div>
      <div class="annotations-modal-backdrop" data-widget-panel><div class="annotations-panel"><div class="annotations-panel-head"><strong>Notes &amp; Flashcards</strong><button type="button" data-widget-close aria-label="Close notes widget">✕</button></div><div class="annotations-tabs"><button type="button" data-tab="notes">Notes</button><button type="button" data-tab="flashcards">Flashcards</button></div><div class="annotations-list" data-notes-list></div><div class="annotations-list" data-flashcards-list></div></div></div>
      <div class="annotations-toast" data-annotation-toast></div>`;
    document.body.appendChild(root);
    state.els = {
      root, cardRoot: root.querySelector('[data-annotation-card]'), trigger: root.querySelector('[data-annotation-trigger]'), card: root.querySelector('[data-annotation-editor]'), actions: root.querySelector('[data-annotation-actions]'), noteEditor: root.querySelector('[data-note-editor]'), flashEditor: root.querySelector('[data-flash-editor]'), noteText: root.querySelector('[data-note-text]'), noteContext: root.querySelector('[data-note-context]'), flashContext: root.querySelector('[data-flash-context]'), flashFront: root.querySelector('[data-flash-front]'), flashBack: root.querySelector('[data-flash-back]'), flashPreview: root.querySelector('[data-flash-preview]'), flashPreviewText: root.querySelector('[data-flash-preview-text]'), saved: root.querySelector('[data-annotation-saved]'), panel: root.querySelector('[data-widget-panel]'), notesList: root.querySelector('[data-notes-list]'), flashcardsList: root.querySelector('[data-flashcards-list]'), utilityMenu: root.querySelector('[data-utility-menu]'), launcher: root.querySelector('[data-widget-toggle]'), toast: root.querySelector('[data-annotation-toast]'),
    };
    root.querySelector('[data-annotation-trigger]').addEventListener('click', () => { if (!state.enabled || !isTtsPaused() || state.navigationPending) return; state.open = !state.open; state.activeEditor = ''; render(); });
    root.querySelector('[data-annotation-note]').addEventListener('click', () => { state.activeEditor = 'note'; state.els.noteText.value = ''; render(); setTimeout(() => { try { state.els.noteText.focus(); } catch (_) {} }, 0); });
    root.querySelector('[data-annotation-flash]').addEventListener('click', () => { state.flashPreviewSide = 'front'; state.els.flashFront.value = ''; state.els.flashBack.value = ''; state.els.flashPreview.querySelector('strong').textContent = 'Front'; state.els.flashPreviewText.textContent = ''; state.activeEditor = 'flashcard'; render(); setTimeout(() => { try { state.els.flashFront.focus(); } catch (_) {} }, 0); });
    state.els.flashPreview.addEventListener('click', () => { state.flashPreviewSide = state.flashPreviewSide === 'front' ? 'back' : 'front'; state.els.flashPreview.querySelector('strong').textContent = state.flashPreviewSide === 'front' ? 'Front' : 'Back'; state.els.flashPreviewText.textContent = state.flashPreviewSide === 'front' ? state.els.flashFront.value : state.els.flashBack.value; });
    state.els.flashFront.addEventListener('input', () => { if (state.flashPreviewSide === 'front') state.els.flashPreviewText.textContent = state.els.flashFront.value; });
    state.els.flashBack.addEventListener('input', () => { if (state.flashPreviewSide !== 'front') state.els.flashPreviewText.textContent = state.els.flashBack.value; });
    root.querySelector('[data-save-note]').addEventListener('click', () => saveAnnotation('note'));
    root.querySelector('[data-save-flash]').addEventListener('click', () => saveAnnotation('flashcard'));
    root.querySelectorAll('[data-cancel]').forEach((btn) => btn.addEventListener('click', () => { state.activeEditor = ''; render(); }));
    state.els.saved.addEventListener('click', (event) => {
      const row = annotationForTarget(state.target);
      if (event.target.closest('[data-delete-current]')) { deleteAnnotation(row); return; }
      if (event.target.closest('[data-edit-current]')) { fillEditorFromAnnotation(row); render(); }
    });
    state.els.launcher.addEventListener('click', () => {
      const mode = utilityMode(state.enabled && isReadingVisible());
      if (state.els.panel.classList.contains('open')) { closeWidgetPanel(); return; }
      if (mode === 'shared') {
        closeHelpPanel();
        state.els.utilityMenu.classList.toggle('open');
        state.els.launcher.classList.toggle('open', state.els.utilityMenu.classList.contains('open'));
        return;
      }
      if (mode === 'notes-only') {
        closeHelpPanel();
        state.els.utilityMenu.classList.remove('open');
        state.els.panel.classList.add('open');
        state.els.launcher.classList.add('open');
        document.body.classList.add('annotations-modal-open');
        renderWidgetLists();
      }
    });
    root.querySelector('[data-open-notes]').addEventListener('click', () => { closeHelpPanel(); state.els.utilityMenu.classList.remove('open'); state.els.panel.classList.add('open'); state.els.launcher.classList.add('open'); document.body.classList.add('annotations-modal-open'); renderWidgetLists(); });
    root.querySelector('[data-open-help]').addEventListener('click', () => { closeWidgetPanel(); try { window.rcHelp.openChat(); } catch (_) {} });
    root.querySelector('[data-widget-close]').addEventListener('click', closeWidgetPanel);
    root.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => { state.activeTab = btn.getAttribute('data-tab') === 'flashcards' ? 'flashcards' : 'notes'; renderTabs(); }));
    root.querySelector('[data-widget-panel]').addEventListener('pointerdown', (event) => {
      if (event.target === event.currentTarget) closeWidgetPanel();
    });
    root.querySelector('[data-widget-panel]').addEventListener('click', (event) => {
      const deleteBtn = event.target.closest('[data-annotation-delete]');
      const item = event.target.closest('[data-annotation-id]');
      if (!item) return;
      const row = liveAnnotations().find((entry) => String(entry.id) === String(item.getAttribute('data-annotation-id')));
      if (deleteBtn) { deleteAnnotation(row); return; }
      if (event.target.closest('[data-widget-source-text]')) {
        state.expandedWidgetId = '';
        if (row && row.type === 'flashcard') {
          state.activeWidgetFlashId = '';
          state.savedFlashSides[String(row.id)] = 'front';
        }
        renderWidgetLists();
        return;
      }
      if (event.target.closest('[data-widget-flash]')) {
        state.sourcePromptId = '';
        if (String(state.activeWidgetFlashId || '') !== String(row.id)) {
          state.activeWidgetFlashId = String(row.id);
          state.expandedWidgetId = String(row.id);
          state.savedFlashSides[String(row.id)] = 'front';
        } else {
          const nextSide = state.savedFlashSides[String(row.id)] === 'back' ? 'front' : 'back';
          state.savedFlashSides[String(row.id)] = nextSide;
        }
        renderWidgetLists();
        return;
      }
      if (event.target.closest('[data-annotation-view]')) {
        state.sourcePromptId = '';
        state.expandedWidgetId = String(state.expandedWidgetId || '') === String(row.id) ? '' : String(row.id);
        if (String(state.expandedWidgetId || '') !== String(row.id)) state.activeWidgetFlashId = '';
        renderWidgetLists();
        return;
      }
      if (event.target.closest('[data-annotation-edit]')) { state.sourcePromptId = ''; renderInlineEditor(item, row); return; }
      const saveEdit = event.target.closest('[data-save-edit]');
      if (saveEdit) { saveInlineEdit(item, row); return; }
      if (event.target.closest('[data-cancel-edit]')) { state.editingWidgetId = ''; renderWidgetLists(); return; }
      if (event.target.closest('[data-annotation-jump]')) {
        const ctx = getReadingContext();
        if (row && Number(row.chapter_index) !== Number(ctx.chapterIndex)) {
          state.sourcePromptId = String(row.id || '');
          renderWidgetLists();
          return;
        }
        jumpToAnnotation(row);
      }
    });
    state.mounted = true;
    state.enabled = readPref();
    setEnabled(state.enabled, { persist: false });
    hydrateAnnotations();
    setInterval(render, 700);
  }

  function renderTabs() {
    if (!state.els.root) return;
    state.els.root.querySelectorAll('[data-tab]').forEach((btn) => btn.classList.toggle('active', btn.getAttribute('data-tab') === state.activeTab));
    state.els.notesList.classList.toggle('active', state.activeTab === 'notes');
    state.els.flashcardsList.classList.toggle('active', state.activeTab === 'flashcards');
  }

  document.addEventListener('DOMContentLoaded', mount);
  document.addEventListener('rc:auth-changed', () => hydrateAnnotations());
  document.addEventListener('rc:reading-opened', render);
  document.addEventListener('rc:reading-closed', render);

  window.rcAnnotations = { setEnabled, isEnabled: () => !!state.enabled, closeWidget: closeWidgetPanel, closePanel: closeWidgetPanel, refresh: render, list: () => liveAnnotations().slice() };
})();
