// js/annotations.js
// Notes & Flashcards annotation layer.
// Presentation owns the widget surface; runtime remains the source of TTS pause/highlight truth.
(function () {
  const PREF_KEY = 'jubly:annotations-widget-enabled';
  const LOCAL_KEY = 'jubly:annotations-local-v1';
  const SYNC_KIND = '/api/app?kind=durable-sync';

  const state = {
    mounted: false,
    enabled: false,
    open: false,
    annotations: [],
    activeEditor: '',
    status: '',
    target: null,
    deletingId: '',
    els: {},
  };

  function readPref() {
    try { return localStorage.getItem(PREF_KEY) === '1'; } catch (_) { return false; }
  }

  function writePref(enabled) {
    try { localStorage.setItem(PREF_KEY, enabled ? '1' : '0'); } catch (_) {}
  }

  function isReadingVisible() {
    try {
      const reading = document.getElementById('reading-mode');
      if (!reading) return false;
      if (reading.classList.contains('hidden-section')) return false;
      const styles = window.getComputedStyle ? window.getComputedStyle(reading) : null;
      return !styles || styles.display !== 'none';
    } catch (_) { return false; }
  }

  function getSessionToken() {
    try { return window.rcAuth && typeof window.rcAuth.getAccessToken === 'function' ? window.rcAuth.getAccessToken() : ''; } catch (_) { return ''; }
  }

  function getReadingTarget() {
    try { return Object.assign({}, window.__rcReadingTarget || {}); } catch (_) { return {}; }
  }

  function getPlayback() {
    try { return (typeof window.getPlaybackStatus === 'function') ? window.getPlaybackStatus() : null; } catch (_) { return null; }
  }

  function isTtsPaused() {
    const playback = getPlayback();
    return !!(playback && playback.active && playback.paused && !playback.cloudRestartInFlight);
  }

  function findHighlightedSpan() {
    try {
      const spans = Array.from(document.querySelectorAll('#reading-mode .tts-sentence'));
      if (!spans.length) return null;
      let best = null;
      let bestAlpha = 0;
      spans.forEach((span) => {
        const raw = (window.getComputedStyle ? window.getComputedStyle(span).getPropertyValue('--tts-alpha') : '') || span.style.getPropertyValue('--tts-alpha') || '0';
        const alpha = Number(raw);
        if (Number.isFinite(alpha) && alpha > bestAlpha) {
          best = span;
          bestAlpha = alpha;
        }
      });
      return bestAlpha > 0.35 ? best : null;
    } catch (_) { return null; }
  }

  function textHash(text) {
    const input = String(text || '');
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function getCurrentTarget() {
    const playback = getPlayback();
    const reading = getReadingTarget();
    const span = findHighlightedSpan();
    const text = String((span && span.textContent) || '').replace(/\s+/g, ' ').trim();
    const pageIndexFromReading = Number(reading.pageIndex);
    const pageIndex = Number.isFinite(pageIndexFromReading) && pageIndexFromReading >= 0 ? pageIndexFromReading : 0;
    const blockIndex = Number.isFinite(Number(playback && playback.activeBlockIndex)) ? Number(playback.activeBlockIndex) : -1;
    if (!playback || !playback.active || !text || blockIndex < 0) return null;
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

  function loadLocalAnnotations() {
    try {
      const rows = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
      return Array.isArray(rows) ? rows.filter(Boolean) : [];
    } catch (_) { return []; }
  }

  function saveLocalAnnotations(rows) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(Array.isArray(rows) ? rows : [])); } catch (_) {}
  }

  function uid() {
    try { if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID(); } catch (_) {}
    return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function syncAnnotations(action, payload) {
    const token = await Promise.resolve(getSessionToken()).catch(() => '');
    if (!token) return null;
    const res = await fetch(SYNC_KIND, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, payload }),
    });
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

  function setEnabled(enabled, options = {}) {
    state.enabled = !!enabled;
    if (options.persist !== false) writePref(state.enabled);
    document.body.classList.toggle('annotations-widget-enabled', state.enabled);
    if (!state.enabled) {
      state.open = false;
      state.activeEditor = '';
    }
    render();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function annotationLabel(row) {
    return row && row.type === 'flashcard' ? 'Flashcard' : 'Note';
  }

  function targetPreview(target) {
    return String(target && target.highlightedText || '').trim() || 'No active highlighted sentence.';
  }

  function renderWidgetList() {
    const list = state.els.list;
    if (!list) return;
    const rows = (state.annotations || []).filter((row) => !row.deleted_at).slice(0, 20);
    if (!rows.length) {
      list.innerHTML = '<div class="annotations-empty">Saved notes and flashcards will appear here.</div>';
      return;
    }
    list.innerHTML = rows.map((row) => {
      const title = annotationLabel(row);
      const preview = row.type === 'flashcard'
        ? (row.flashcard_front || row.highlighted_text || '')
        : (row.note_text || row.highlighted_text || '');
      const disabled = state.deletingId && String(state.deletingId) === String(row.id) ? ' disabled' : '';
      const deleteLabel = disabled ? 'Deleting…' : 'Delete';
      return `<div class="annotations-widget-item" data-annotation-id="${escapeHtml(row.id)}"><button class="annotations-jump" type="button" data-annotation-jump><strong>${escapeHtml(title)}</strong><span>${escapeHtml(preview)}</span><em>Tap to jump to reading point</em></button><button class="annotations-delete" type="button" data-annotation-delete${disabled}>${escapeHtml(deleteLabel)}</button></div>`;
    }).join('');
  }

  function render() {
    if (!state.mounted) return;
    const visible = !!state.enabled && isReadingVisible();
    state.els.root.hidden = !visible;
    const checkbox = document.getElementById('annotationsWidgetToggle');
    if (checkbox && checkbox.checked !== state.enabled) checkbox.checked = state.enabled;
    if (!visible) return;

    const paused = isTtsPaused();
    state.target = paused ? getCurrentTarget() : null;
    if (state.els.trigger) {
      state.els.trigger.disabled = !paused || !state.target;
      const sub = state.els.trigger.querySelector('[data-annotation-sub]');
      if (sub) sub.textContent = paused ? (state.target ? 'Open tools for the highlighted sentence' : 'No highlighted sentence available') : 'Pause TTS to save this sentence';
    }
    state.els.card.classList.toggle('open', !!state.open && !!state.target);
    if (state.els.current) state.els.current.textContent = `“${targetPreview(state.target)}”`;
    state.els.noteEditor.classList.toggle('active', state.activeEditor === 'note');
    state.els.flashEditor.classList.toggle('active', state.activeEditor === 'flashcard');
    state.els.actions.hidden = !!state.activeEditor;
    state.els.saved.classList.toggle('active', !!state.status);
    state.els.saved.innerHTML = state.status ? `<strong>${escapeHtml(state.status)}</strong>Revisit from the widget and jump back to this reading location.` : '';
    state.els.panel.classList.toggle('open', !!state.els.panel.classList.contains('open'));
    renderWidgetList();
  }

  function pauseTtsIfNeeded() {
    const playback = getPlayback();
    if (playback && playback.active && !playback.paused && typeof window.ttsPause === 'function') {
      try { window.ttsPause(); } catch (_) {}
    }
  }

  function closeWidgetPanel() {
    if (state.els && state.els.panel) state.els.panel.classList.remove('open');
  }

  function closeHelpPanel() {
    try {
      if (window.rcHelp && typeof window.rcHelp.close === 'function') window.rcHelp.close();
    } catch (_) {}
  }

  function showToast(message) {
    if (!state.els || !state.els.toast) return;
    state.els.toast.textContent = String(message || 'Done.');
    state.els.toast.classList.add('show');
    setTimeout(() => state.els.toast && state.els.toast.classList.remove('show'), 1800);
  }

  async function deleteAnnotation(row) {
    if (!row || !row.id) return;
    const id = String(row.id);
    const deletedAt = new Date().toISOString();
    state.deletingId = id;
    state.annotations = (state.annotations || []).map((item) => String(item.id) === id ? Object.assign({}, item, { deleted_at: deletedAt, updated_at: deletedAt }) : item);
    saveLocalAnnotations(state.annotations);
    renderWidgetList();
    try {
      if (!id.startsWith('local-')) await syncAnnotations('delete_annotation', { id });
      showToast('Deleted.');
    } catch (_) {
      showToast('Deleted locally. Sync will need retry.');
    } finally {
      state.deletingId = '';
      renderWidgetList();
    }
  }

  async function saveAnnotation(type) {
    const target = state.target || getCurrentTarget();
    if (!target) return;
    const now = new Date().toISOString();
    const noteText = state.els.noteText ? String(state.els.noteText.value || '').trim() : '';
    const flashFront = state.els.flashFront ? String(state.els.flashFront.value || '').trim() : '';
    const flashBack = state.els.flashBack ? String(state.els.flashBack.value || '').trim() : '';
    const row = {
      id: uid(),
      type,
      book_id: target.bookId,
      source_type: target.sourceType,
      chapter_index: target.chapterIndex,
      page_index: target.pageIndex,
      page_key: target.pageKey,
      block_index: target.blockIndex,
      highlighted_text: target.highlightedText,
      text_hash: target.textHash,
      note_text: type === 'note' ? (noteText || target.highlightedText) : null,
      flashcard_front: type === 'flashcard' ? (flashFront || target.highlightedText) : null,
      flashcard_back: type === 'flashcard' ? flashBack : null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    state.annotations = [row].concat(state.annotations || []);
    saveLocalAnnotations(state.annotations);
    state.status = type === 'flashcard' ? 'Flashcard saved.' : 'Note saved.';
    state.activeEditor = '';
    render();
    try {
      const synced = await syncAnnotations('save_annotation', row);
      if (synced && synced.row && synced.row.id) {
        state.annotations = state.annotations.map((item) => item.id === row.id ? Object.assign({}, row, synced.row) : item);
        saveLocalAnnotations(state.annotations);
        render();
      }
    } catch (_) {
      // Local cache keeps the user-created note visible; sync can be retried by later implementation.
    }
  }

  function jumpToAnnotation(row) {
    if (!row) return;
    pauseTtsIfNeeded();
    try {
      if (typeof window.setReadingTarget === 'function') {
        window.setReadingTarget({ sourceType: row.source_type || '', bookId: row.book_id || '', chapterIndex: row.chapter_index, pageIndex: row.page_index });
      }
    } catch (_) {}
    try {
      const page = document.querySelector(`#reading-mode .page[data-page-index="${Number(row.page_index) || 0}"]`);
      if (page) page.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (_) {}
    state.els.panel.classList.remove('open');
    if (state.els.toast) {
      state.els.toast.classList.add('show');
      setTimeout(() => state.els.toast && state.els.toast.classList.remove('show'), 1800);
    }
  }

  async function hydrateAnnotations() {
    state.annotations = loadLocalAnnotations();
    render();
    const remote = await fetchRemoteAnnotations().catch(() => null);
    if (Array.isArray(remote)) {
      state.annotations = remote.concat(state.annotations.filter((row) => String(row.id || '').startsWith('local-')));
      saveLocalAnnotations(state.annotations);
      render();
    }
  }

  function injectSettingsRow() {
    const panel = document.getElementById('rs-panel-general');
    if (!panel || document.getElementById('annotationsWidgetToggle')) return;
    const row = document.createElement('div');
    row.className = 'rs-simple-row annotations-setting-row';
    row.innerHTML = `
      <div>
        <p class="rs-row-title">Notes &amp; Flashcards Widget</p>
        <p class="rs-row-sub">Show the annotation entrypoint and floating notes widget while reading.</p>
      </div>
      <label class="rs-toggle-row">
        <span class="text-slate-400">Show widget</span>
        <input type="checkbox" id="annotationsWidgetToggle" style="accent-color:var(--theme-accent); width:15px; height:15px; cursor:pointer;">
      </label>`;
    panel.appendChild(row);
    const input = row.querySelector('#annotationsWidgetToggle');
    input.checked = !!state.enabled;
    input.addEventListener('change', () => setEnabled(!!input.checked));
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
        <button class="annotations-trigger" type="button" data-annotation-trigger disabled>
          <span class="annotations-plus">＋</span>
          <span><strong>Annotate current highlight</strong><small data-annotation-sub>Pause TTS to save this sentence</small></span>
          <span class="annotations-chev">⌄</span>
        </button>
        <div class="annotations-editor-card" data-annotation-editor>
          <div class="annotations-editor-head"><strong>Current highlight</strong><span>Paused</span></div>
          <div class="annotations-current" data-annotation-current></div>
          <p class="annotations-hint">Annotation unlocks after TTS is paused. Nothing is inserted into the reading text.</p>
          <div class="annotations-actions" data-annotation-actions>
            <button type="button" class="annotations-primary" data-annotation-note>Save Note</button>
            <button type="button" class="annotations-secondary" data-annotation-flash>Make Flashcard</button>
          </div>
          <div class="annotations-form" data-note-editor>
            <textarea data-note-text placeholder="Add a note about this highlighted sentence…"></textarea>
            <div class="annotations-row"><button type="button" data-save-note>Save note</button><button type="button" data-cancel>Cancel</button></div>
          </div>
          <div class="annotations-form" data-flash-editor>
            <input data-flash-front placeholder="Flashcard front" />
            <textarea data-flash-back placeholder="Flashcard back"></textarea>
            <div class="annotations-row"><button type="button" data-save-flash>Save card</button><button type="button" data-cancel>Cancel</button></div>
          </div>
          <div class="annotations-saved" data-annotation-saved></div>
        </div>
      </div>
      <div class="annotations-float">
        <div class="annotations-panel" data-widget-panel>
          <div class="annotations-panel-head"><strong>Notes &amp; Flashcards</strong><button type="button" data-widget-close aria-label="Close notes widget">✕</button></div>
          <div class="annotations-list" data-widget-list></div>
        </div>
        <button type="button" class="annotations-widget-button" data-widget-toggle aria-label="Open notes and flashcards">📝</button>
      </div>
      <div class="annotations-toast" data-annotation-toast>Jumped to the saved reading point.</div>`;
    document.body.appendChild(root);
    state.els = {
      root,
      trigger: root.querySelector('[data-annotation-trigger]'),
      card: root.querySelector('[data-annotation-editor]'),
      current: root.querySelector('[data-annotation-current]'),
      actions: root.querySelector('[data-annotation-actions]'),
      noteEditor: root.querySelector('[data-note-editor]'),
      flashEditor: root.querySelector('[data-flash-editor]'),
      noteText: root.querySelector('[data-note-text]'),
      flashFront: root.querySelector('[data-flash-front]'),
      flashBack: root.querySelector('[data-flash-back]'),
      saved: root.querySelector('[data-annotation-saved]'),
      panel: root.querySelector('[data-widget-panel]'),
      list: root.querySelector('[data-widget-list]'),
      toast: root.querySelector('[data-annotation-toast]'),
    };
    root.querySelector('[data-annotation-trigger]').addEventListener('click', () => {
      if (!isTtsPaused()) return;
      state.open = !state.open;
      state.activeEditor = '';
      state.status = '';
      render();
    });
    root.querySelector('[data-annotation-note]').addEventListener('click', () => {
      const target = state.target || getCurrentTarget();
      if (state.els.noteText) state.els.noteText.value = '';
      state.activeEditor = 'note';
      state.status = '';
      render();
      setTimeout(() => { try { state.els.noteText.focus(); } catch (_) {} }, 0);
    });
    root.querySelector('[data-annotation-flash]').addEventListener('click', () => {
      const target = state.target || getCurrentTarget();
      if (state.els.flashFront) state.els.flashFront.value = targetPreview(target);
      if (state.els.flashBack) state.els.flashBack.value = '';
      state.activeEditor = 'flashcard';
      state.status = '';
      render();
      setTimeout(() => { try { state.els.flashBack.focus(); } catch (_) {} }, 0);
    });
    root.querySelector('[data-save-note]').addEventListener('click', () => saveAnnotation('note'));
    root.querySelector('[data-save-flash]').addEventListener('click', () => saveAnnotation('flashcard'));
    root.querySelectorAll('[data-cancel]').forEach((btn) => btn.addEventListener('click', () => { state.activeEditor = ''; render(); }));
    root.querySelector('[data-widget-toggle]').addEventListener('click', () => {
      pauseTtsIfNeeded();
      const willOpen = !state.els.panel.classList.contains('open');
      if (willOpen) closeHelpPanel();
      state.els.panel.classList.toggle('open');
      renderWidgetList();
    });
    root.querySelector('[data-widget-close]').addEventListener('click', () => state.els.panel.classList.remove('open'));
    root.querySelector('[data-widget-list]').addEventListener('click', (event) => {
      const item = event.target.closest('[data-annotation-id]');
      if (!item) return;
      const id = item.getAttribute('data-annotation-id');
      const row = (state.annotations || []).find((entry) => String(entry.id) === String(id));
      if (event.target.closest('[data-annotation-delete]')) {
        deleteAnnotation(row);
        return;
      }
      if (event.target.closest('[data-annotation-jump]')) jumpToAnnotation(row);
    });
    state.mounted = true;
    state.enabled = readPref();
    setEnabled(state.enabled, { persist: false });
    hydrateAnnotations();
    setInterval(render, 700);
  }

  document.addEventListener('DOMContentLoaded', mount);
  document.addEventListener('rc:auth-changed', () => hydrateAnnotations());
  document.addEventListener('rc:reading-opened', render);
  document.addEventListener('rc:reading-closed', render);

  window.rcAnnotations = {
    setEnabled,
    isEnabled: () => !!state.enabled,
    closeWidget: closeWidgetPanel,
    closePanel: closeWidgetPanel,
    refresh: render,
    list: () => (state.annotations || []).slice(),
  };
})();
