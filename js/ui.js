// Split from original app.js during role-based phase-1 restructure.
// File: ui.js
// Note: This is still global-script architecture (no bundler/modules required).

  // ☰ Mobile Top Menu
  // ===================================

  (function initTopMenu() {
    const btn = document.getElementById('topMenuBtn');
    const menu = document.getElementById('topMenu');
    const mHow = document.getElementById('topMenuHow');
    const mImport = document.getElementById('topMenuImport');
    const mLib = document.getElementById('topMenuLibrary');

    const howBtn = document.getElementById('howItWorksBtn');
    const importBtn = document.getElementById('importBookBtn');
    const libBtn = document.getElementById('manageLibraryBtn');

    if (!btn || !menu) return;

    function toggle(force) {
      const willOpen = typeof force === 'boolean' ? force : (menu.style.display === 'none' || !menu.style.display);
      menu.style.display = willOpen ? 'block' : 'none';
      btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });

    document.addEventListener('click', () => toggle(false));
    menu.addEventListener('click', (e) => e.stopPropagation());

    mHow?.addEventListener('click', () => { toggle(false); howBtn?.click(); });
    mImport?.addEventListener('click', () => { toggle(false); importBtn?.click(); });
    mLib?.addEventListener('click', () => { toggle(false); libBtn?.click(); });
  })();

  // ===================================
  // 📘 How This Works (Instructions Modal)
  // ===================================

  (function initHowItWorksModal() {
    const btn = document.getElementById('howItWorksBtn');
    const modal = document.getElementById('howItWorksModal');
    const closeBtn = document.getElementById('howItWorksClose');
    const donateBtn = document.getElementById('donateBtn');

    // Wire donate link from config if present
    try {
      if (donateBtn && typeof BUY_ME_A_COFFEE_URL === 'string' && BUY_ME_A_COFFEE_URL.trim()) {
        donateBtn.href = BUY_ME_A_COFFEE_URL.trim();
      }
    } catch (_) {
      // ignore
    }


    // Support footer is now static at the bottom of the page (no banner logic).

    function openModal() {
      if (!modal) return;
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      // Focus close for accessibility
      if (closeBtn) closeBtn.focus();
    }

    function closeModal() {
      if (!modal) return;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      if (btn) btn.focus();
    }

    if (btn) btn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    // Click outside modal closes
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
    }

    // ESC closes
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && modal.style.display !== 'none') {
        closeModal();
      }
    });
  })();

  // ===================================
  // 🛠️ Utility Panels (Volume + Diagnostics)
  // ===================================

  (function initUtilityPanels() {
    const musicToggleBtn = document.getElementById('musicToggle');
    const toggleMusicBtn = document.getElementById('toggleMusicBtn');
    const volumePanel = document.getElementById('volumePanel');
    const volumeCloseBtn = document.getElementById('volumeCloseBtn');

    // Diagnostics are debug-only and must not alter the normal UI layout.
    // We build the button + panel dynamically (appended to <body>) so it cannot
    // create empty boxes inside .top-controls.
    let diagBtn = null;
    let diagPanel = null;
    let diagCloseBtn = null;
    let diagText = null;
    let diagClearCacheBtn = null;
    let diagCopyBtn = null;

    // URL flag: show diagnostics when debug is present/truthy.
    const debugEnabled = isDebugEnabledFromUrl();

    // If any legacy diag elements exist in the DOM (from older patches), hide them
    // so they don't consume layout space.
    ['diagBtn', 'diagPanel'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        try { el.style.display = 'none'; } catch (_) {}
      }
    });

    // Hide any legacy "debug" dropdown/controls if present.
    if (debugEnabled) {
      const legacySelectors = [
        '#debugControls', '#debugControl', '#debugPanelLegacy', '#debugSelect', '#debugMode',
        '#debugDropdown', '#debugToggle', '#debugMenu', '.debug-controls', '.debug-control',
        '.debug-dropdown', '.debug-select', '.debug-toggle'
      ];
      legacySelectors.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          try { el.style.display = 'none'; } catch (_) {}
        });
      });
    }

    function hideAllPanels() {
      if (volumePanel) volumePanel.style.display = 'none';
      if (diagPanel) diagPanel.style.display = 'none';
    }

    // Volume panel wiring
    if (volumePanel) {
      const sliders = {
        voice: document.getElementById('vol_voice'),
        music: document.getElementById('vol_music'),
        sand: document.getElementById('vol_sand'),
        stone: document.getElementById('vol_stone'),
        reward: document.getElementById('vol_reward'),
        compass: document.getElementById('vol_compass'),
        pageTurn: document.getElementById('vol_pageTurn'),
        evaluate: document.getElementById('vol_evaluate'),
      };

      function syncSlidersFromState() {
        if (sliders.voice) sliders.voice.value = String(Math.max(0, Math.min(1, Number(TTS_STATE.volume ?? 1))));
        if (sliders.music) sliders.music.value = String(music.volume);
        if (sliders.sand) sliders.sand.value = String(sandSound.volume);
        if (sliders.stone) sliders.stone.value = String(stoneSound.volume);
        if (sliders.reward) sliders.reward.value = String(rewardSound.volume);
        if (sliders.compass) sliders.compass.value = String(compassSound.volume);
        if (sliders.pageTurn) sliders.pageTurn.value = String(pageTurnSound.volume);
        if (sliders.evaluate) sliders.evaluate.value = String(evaluateSound.volume);
      }

      function setVoiceVariant(v) {
        const vv = String(v || '').toLowerCase() === 'male' ? 'male' : 'female';
        TTS_STATE.voiceVariant = vv;
        try { localStorage.setItem('rc_voice_variant', vv); } catch (_) {}
        try { window.__rcSessionVoiceVariant = vv; } catch (_) {}
      }

      // Voice selects — two dropdowns, one per gender.
      // Selecting from either dropdown sets both the active variant and specific voice.
      // Free tier: browser voices only.
      // Paid/Premium: server-backed cloud voices at the top, browser voices below.
      const voiceFemaleSelect = document.getElementById('voiceFemaleSelect');
      const voiceMaleSelect   = document.getElementById('voiceMaleSelect');

      const BAD_VOICES = [
        'Albert','Bad News','Bells','Boing','Bubbles','Cellos',
        'Deranged','Good News','Hysterical','Jester','Organ',
        'Superstar','Whisper','Zarvox','Trinoids'
      ];

      const FEMALE_NAMES = ['Aria','Jenny','Samantha','Karen','Moira','Serena','Tessa','Zira','Eva','Susan','Victoria','Fiona','Allison','Ava','Nora'];
      const MALE_NAMES   = ['Daniel','Rishi','Alex','Guy','Ryan','Fred','David','Mark','Tom','Bruce','James'];

      function buildVoiceSelect(selectEl, gender) {
        if (!selectEl) return;
        const resolvedPolicy = (window.rcPolicy && typeof window.rcPolicy.get === 'function') ? window.rcPolicy.get() : null;
        const cloudVoicesAllowed = !!resolvedPolicy?.features?.cloudVoices;
        const isFree      = !cloudVoicesAllowed;
        const isActive    = String(TTS_STATE?.voiceVariant || 'female').toLowerCase() === gender;
        const savedBrowser = (() => { try { return (typeof getStoredSelectedVoice === 'function' ? getStoredSelectedVoice() : (window.__rcSessionVoiceSelection || '')) || ''; } catch(_) { return ''; } })();
        const savedVariant = (() => { try { return String(TTS_STATE?.voiceVariant || window.__rcSessionVoiceVariant || 'female'); } catch(_) { return 'female'; } })();
        const isThisVoiceActive = isActive && (savedVariant === gender);

        const allVoices = (window.speechSynthesis?.getVoices() || [])
          .filter(v => !BAD_VOICES.some(b => v.name.includes(b)))
          .filter(v => (v.lang || '').toLowerCase().startsWith('en'));

        const nameList  = gender === 'female' ? FEMALE_NAMES : MALE_NAMES;
        const quality   = allVoices.filter(v => nameList.some(n => v.name.toLowerCase().includes(n.toLowerCase())));

        const hasAnyVoices = quality.length > 0 || (!isFree);
        const bothListsEmpty = !allVoices.length;

        selectEl.innerHTML = '';

        // Placeholder option — uses 'hidden' not 'disabled' so Firefox/LibreWolf
        // renders the text correctly as the visible selection label.
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.hidden = true;
        if (bothListsEmpty) {
          placeholder.textContent = gender === 'female' ? 'Female' : 'Male';
        } else if (!hasAnyVoices) {
          placeholder.textContent = gender === 'female' ? 'Female — none found' : 'Male — none found';
        } else {
          placeholder.textContent = gender === 'female' ? 'Female' : 'Male';
        }
        placeholder.selected = !isThisVoiceActive || (!savedBrowser && savedVariant !== gender && isFree);
        selectEl.appendChild(placeholder);

        // Cloud voices for Paid/Premium — Azure Neural voice catalogue
        // Voices match what Edge browser exposes natively, so Edge users
        // may get these for free via browserSpeakQueue (see tts.js Edge optimisation).
        if (!isFree) {
          const cloudGrp = document.createElement('optgroup');
          cloudGrp.label = '☁️ Cloud (Neural)';

          const AZURE_VOICES = gender === 'female'
            ? [
                { id: 'en-US-AriaNeural',     label: 'Aria (US)' },
                { id: 'en-US-JennyNeural',    label: 'Jenny (US)' },
                { id: 'en-US-SaraNeural',     label: 'Sara (US)' },
                { id: 'en-GB-SoniaNeural',    label: 'Sonia (UK)' },
                { id: 'en-AU-NatashaNeural',  label: 'Natasha (AU)' },
              ]
            : [
                { id: 'en-US-RyanNeural',     label: 'Ryan (US)' },
                { id: 'en-US-GuyNeural',      label: 'Guy (US)' },
                { id: 'en-US-DavisNeural',    label: 'Davis (US)' },
                { id: 'en-GB-RyanNeural',     label: 'Ryan (UK)' },
                { id: 'en-AU-WilliamNeural',  label: 'William (AU)' },
              ];

          AZURE_VOICES.forEach(v => {
            const opt = document.createElement('option');
            opt.value = `cloud:${v.id}`;
            opt.textContent = v.label;
            if (savedVariant === gender && savedBrowser === `cloud:${v.id}`) opt.selected = true;
            if (!savedBrowser && savedVariant === gender && v === AZURE_VOICES[0]) opt.selected = true;
            cloudGrp.appendChild(opt);
          });
          selectEl.appendChild(cloudGrp);
        }

        // Browser voices — no group label on free tier
        if (quality.length) {
          if (isFree) {
            // Free: no optgroup label, voices appear directly
            quality.forEach(v => {
              const opt = document.createElement('option');
              opt.value = v.name;
              opt.textContent = v.name.replace(/^com\.apple\.[^.]+\./, '').replace(/-compact$/, '');
              if (v.name === savedBrowser && savedVariant === gender) opt.selected = true;
              selectEl.appendChild(opt);
            });
          } else {
            const grp = document.createElement('optgroup');
            grp.label = '🖥️ Browser';
            quality.forEach(v => {
              const opt = document.createElement('option');
              opt.value = v.name;
              opt.textContent = v.name.replace(/^com\.apple\.[^.]+\./, '').replace(/-compact$/, '');
              if (v.name === savedBrowser && savedVariant === gender) opt.selected = true;
              grp.appendChild(opt);
            });
            selectEl.appendChild(grp);
          }
        }

        // Accent border on the active dropdown
        selectEl.style.borderColor = isThisVoiceActive
          ? 'var(--accent, #c17d4a)'
          : 'var(--border)';
      }

      function populateBrowserVoicePicker() {
        buildVoiceSelect(voiceFemaleSelect, 'female');
        buildVoiceSelect(voiceMaleSelect,   'male');
      }

      function handleVoiceSelectChange(selectEl, gender) {
        if (!selectEl) return;
        selectEl.addEventListener('change', () => {
          const val = selectEl.value;
          if (!val) return;
          setVoiceVariant(gender);
          if (val.startsWith('polly:') || val.startsWith('cloud:')) {
            // Cloud voice — store the full value so cloudFetchUrl can forward the selected model id
            try { window.__rcSessionVoiceSelection = val; } catch(_) {}
          } else {
            // Browser voice
            try { window.__rcSessionVoiceSelection = val; } catch(_) {}
          }
          populateBrowserVoicePicker();
        });
      }

      handleVoiceSelectChange(voiceFemaleSelect, 'female');
      handleVoiceSelectChange(voiceMaleSelect,   'male');

      function openReadingSettingsModal() {
        syncSlidersFromState();
        populateBrowserVoicePicker();
        // PATCH(modal-visibility): style.display is the sole visibility authority.
        // hidden-section class manipulation removed — it caused divergence when
        // any code path set only one of the two systems.
        try {
          volumePanel.setAttribute('aria-hidden', 'false');
          volumePanel.style.visibility = '';
          volumePanel.style.display = 'flex';
          volumePanel.style.top = '';
          volumePanel.style.left = '';
        } catch (_) {}
        return true;
      }

      function closeReadingSettingsModal() {
        // PATCH(modal-visibility): style.display only — no hidden-section toggle.
        volumePanel.style.display = 'none';
        volumePanel.setAttribute('aria-hidden', 'true');
        return false;
      }

      function toggleReadingSettingsModal() {
        const open = volumePanel.style.display === 'flex';
        hideAllPanels();
        if (open) return false;
        return openReadingSettingsModal();
      }

      window.openReadingSettingsModal = openReadingSettingsModal;
      window.closeReadingSettingsModal = closeReadingSettingsModal;
      window.toggleReadingSettingsModal = toggleReadingSettingsModal;
      window.isReadingSettingsModalOpen = () => volumePanel.style.display === 'flex';

      // Repopulate when voices load asynchronously (Chrome/Edge)
      window.populateBrowserVoicePicker = populateBrowserVoicePicker;

      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.addEventListener('voiceschanged', populateBrowserVoicePicker);
      }

      Object.entries(sliders).forEach(([key, el]) => {
        if (!el) return;
        el.addEventListener('input', () => setVolume(key, el.value));
      });

      // Open the volume panel from the existing music button or top-bar Settings button.
      if (musicToggleBtn) {
        musicToggleBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          toggleReadingSettingsModal();
        });
      }

      const topSettingsBtn = document.getElementById('openReadingSettings');
      if (topSettingsBtn) {
        topSettingsBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          toggleReadingSettingsModal();
        });
      }

      if (volumeCloseBtn) volumeCloseBtn.addEventListener('click', () => closeReadingSettingsModal());
      if (volumePanel) {
        volumePanel.addEventListener('click', (ev) => {
          if (ev.target === volumePanel) closeReadingSettingsModal();
        });
      }
      if (toggleMusicBtn) toggleMusicBtn.addEventListener('click', () => window.toggleMusic && window.toggleMusic());
    }

    // Diagnostics panel wiring (debug-only)
    function ensureDiagUI() {
      if (!debugEnabled) return;
      if (diagBtn && diagPanel && diagText) return;

      // Button: fixed top-left everywhere by request.
      diagBtn = document.createElement('button');
      diagBtn.id = 'diagnosticsToggle';
      diagBtn.type = 'button';
      diagBtn.className = 'music-button';
      diagBtn.title = 'Diagnostics';
      diagBtn.innerHTML = '<span id="diagIcon">🔧</span>';
      document.body.appendChild(diagBtn);
      diagBtn.style.position = 'fixed';
      diagBtn.style.top = '16px';
      diagBtn.style.left = '16px';
      diagBtn.style.right = 'auto';
      diagBtn.style.bottom = 'auto';
      diagBtn.style.zIndex = '1001';

      // Panel: same conventions as the Sound panel (fixed, above the button)
      diagPanel = document.createElement('div');
      diagPanel.id = 'diagPanel';
      diagPanel.style.display = 'none';
      diagPanel.style.position = 'fixed';
      diagPanel.style.zIndex = '1000';
      diagPanel.style.width = '420px';
      diagPanel.style.maxWidth = '92vw';
      diagPanel.style.padding = '12px';
      diagPanel.style.border = '2px solid var(--border)';
      diagPanel.style.borderRadius = '10px';
      diagPanel.style.background = 'var(--secondary-bg)';
      diagPanel.style.boxShadow = '0 8px 28px rgba(0,0,0,0.22)';
      diagPanel.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
          <strong style="font-size: 13px; opacity:0.9;">Diagnostics</strong>
          <button type="button" id="diagCloseBtn" style="padding:6px 10px;">✕</button>
        </div>
        <textarea id="diagText" readonly style="width:100%; height: 220px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 12px; padding: 10px;"></textarea>
        <div style="display:flex; gap:10px; margin-top:10px; justify-content:flex-end;">
          <button type="button" id="diagClearCacheBtn" title="Clears all local cache/state for clean testing">Delete cache</button>
          <button type="button" id="diagCopyBtn">Copy</button>
        </div>
      `;
      document.body.appendChild(diagPanel);

      diagCloseBtn = diagPanel.querySelector('#diagCloseBtn');
      diagText = diagPanel.querySelector('#diagText');
      diagClearCacheBtn = diagPanel.querySelector('#diagClearCacheBtn');
      diagCopyBtn = diagPanel.querySelector('#diagCopyBtn');

      function positionPanelAboveButton(btn, panel) {
        if (!btn || !panel) return;
        try {
          panel.style.visibility = 'hidden';
          panel.style.display = 'block';
          const rect = btn.getBoundingClientRect();
          const panelW = panel.offsetWidth;
          const panelH = panel.offsetHeight;
          const gap = 10;
          const top = Math.max(10, Math.min(window.innerHeight - panelH - 10, rect.bottom + gap));
          const left = Math.max(10, Math.min(window.innerWidth - panelW - 10, rect.left));
          panel.style.top = `${top}px`;
          panel.style.left = `${left}px`;
        } catch (_) {}
        panel.style.visibility = 'visible';
      }

      function setDiagVisible(v) {
        if (!diagPanel || !diagText) return;
        if (!v) {
          diagPanel.style.display = 'none';
          return;
        }
        const totalSpent = Object.values(sessionTokens?.spent || {}).reduce((a, b) => a + b, 0);
        const merged = {
          tokens: {
            tier: (window.rcPolicy && typeof window.rcPolicy.getTier === 'function') ? window.rcPolicy.getTier() : (typeof appTier !== 'undefined' ? appTier : 'unknown'),
            remaining: sessionTokens?.remaining ?? '—',
            allowance: (window.rcPolicy && typeof window.rcPolicy.getUsageDailyLimit === 'function') ? window.rcPolicy.getUsageDailyLimit() : '—',
            totalSpent,
            breakdown: sessionTokens?.spent || {},
          },
          stored: {
            persistenceMode: (window.__rcRuntimePersistenceStripped ? 'stripped-for-stabilization' : 'normal'),
            tier: null,
            voiceVariant: null,
            voiceSelection: null,
            ttsSpeed: null,
            autoplay: null,
          },
          tts: {
            variant: TTS_STATE?.voiceVariant || 'female',
            activeBrowserVoice: TTS_STATE?.activeBrowserVoiceName || null,
            support: (typeof window.getTtsSupportStatus === 'function') ? window.getTtsSupportStatus() : null,
            allEnglishVoices: (() => {
              try {
                return (window.speechSynthesis?.getVoices() || [])
                  .filter(v => (v.lang || '').toLowerCase().startsWith('en'))
                  .map(v => v.name);
              } catch(_) { return []; }
            })(),
          },
          ttsRuntime: (typeof window.getTtsDiagnosticsSnapshot === 'function') ? window.getTtsDiagnosticsSnapshot() : null,
          shell: (typeof window.getShellDiagnosticsSnapshot === 'function') ? window.getShellDiagnosticsSnapshot() : null,
          runtime: (typeof window.getRuntimeUiState === 'function') ? window.getRuntimeUiState() : null,
          restore: (typeof window.getReadingRestoreStatus === 'function') ? window.getReadingRestoreStatus() : null,
          importer: (typeof window.getImporterDiagnosticsSnapshot === 'function') ? window.getImporterDiagnosticsSnapshot() : null,
          ai: lastAIDiagnostics || null,
          anchors: lastAnchorsDiagnostics || null,
        };
        const hasAny = Boolean(merged.ai || merged.anchors);
        const dump = JSON.stringify(merged, null, 2);
        diagText.value = dump;
        diagPanel.style.display = 'block';
        positionPanelAboveButton(diagBtn, diagPanel);
      }

      window.updateDiagnostics = function updateDiagnostics() {
        try {
          if (diagPanel && diagPanel.style.display === 'block') setDiagVisible(true);
        } catch (_) {}
      };

      diagBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const isOpen = diagPanel && diagPanel.style.display === 'block';
        hideAllPanels();
        setDiagVisible(!isOpen);
      });

      if (diagCloseBtn) diagCloseBtn.addEventListener('click', () => setDiagVisible(false));
      if (diagClearCacheBtn) {
        diagClearCacheBtn.addEventListener('click', async () => {
          const ok = window.confirm(
            'Delete cache?\n\nThis clears ALL local browser storage for this app (including saved work) and reloads the page.'
          );
          if (!ok) return;

          try { localStorage.clear(); } catch (_) {}
          try { sessionStorage.clear(); } catch (_) {}

          // Best-effort: clear Service Worker Cache Storage if present.
          try {
            if (window.caches && caches.keys) {
              const keys = await caches.keys();
              await Promise.all(keys.map((k) => caches.delete(k)));
            }
          } catch (_) {}

          // Reload for a clean boot.
          try {
            window.location.reload();
          } catch (_) {
            window.location.href = window.location.href;
          }
        });
      }
      if (diagCopyBtn && diagText) {
        diagCopyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(diagText.value || '');
            diagCopyBtn.textContent = 'Copied';
            setTimeout(() => (diagCopyBtn.textContent = 'Copy'), 900);
          } catch (_) {
            diagText.select();
            document.execCommand('copy');
          }
        });
      }

      // Ctrl+Alt+D toggles diagnostics (debug-only)
      document.addEventListener('keydown', (e) => {
        if (!debugEnabled) return;
        if (!(e.ctrlKey && e.altKey && (e.key === 'd' || e.key === 'D'))) return;
        const isOpen = diagPanel && diagPanel.style.display === 'block';
        hideAllPanels();
        setDiagVisible(!isOpen);
      });
    }

    // Build debug UI only when enabled.
    ensureDiagUI();

    // Click outside closes panels (lightweight)
    document.addEventListener('click', (e) => {
      const t = e.target;
      const inVol = volumePanel && volumePanel.contains(t);
      const inDiag = diagPanel && diagPanel.contains(t);
      const inModalOverlay = !!(t && t.closest && t.closest('.modal-overlay'));
      const isVolBtn = musicToggleBtn && (t === musicToggleBtn || musicToggleBtn.contains(t));
      const isDiagBtn = diagBtn && (t === diagBtn || diagBtn.contains(t));
      if (inVol || inDiag || inModalOverlay || isVolBtn || isDiagBtn) return;
      hideAllPanels();
    });
  })();

// ===================================
// 🗂️ Mode Selector
// ===================================
(function initModeSelector() {
  const select = document.getElementById('modeSelect');
  if (!select) return;

  try {
    const saved = localStorage.getItem('rc_app_mode');
    if (saved && ['reading','comprehension','research','thesis'].includes(saved)) appMode = saved === 'thesis' ? 'research' : saved;
  } catch (_) {}

  select.value = appMode;

  select.addEventListener('change', () => {
    const newMode = select.value;
    if (newMode === appMode) return;

    const hasPages = typeof pages !== 'undefined' && Array.isArray(pages) && pages.length > 0;
    if (hasPages) {
      const ok = window.confirm(`Switch mode? Your consolidations will be preserved.`);
      if (!ok) { select.value = appMode; return; }
    }

    appMode = newMode;
    try { localStorage.setItem('rc_app_mode', appMode); } catch (_) {}
    render();
  });
})();

// ===================================
// 💳 Tier Selector
// ===================================
(function initTierSelector() {
  const select = document.getElementById('tierSelect');
  if (!select) return;

  const VALID_TIERS = ['free', 'paid', 'premium'];

  // Restore persisted tier
  select.value = appTier;

  function applyTierSimulationUi() {
    const policyApi = window.rcPolicy || {};
    const simulationAllowed = typeof policyApi.canSimulateTier === 'function' ? !!policyApi.canSimulateTier() : false;
    select.disabled = !simulationAllowed;
    const buttonRows = new Set();
    document.querySelectorAll('.tier-btn').forEach((btn) => {
      btn.disabled = !simulationAllowed;
      const row = btn.parentElement;
      if (row) buttonRows.add(row);
    });
    buttonRows.forEach((row) => {
      row.style.display = simulationAllowed ? '' : 'none';
    });
  }

  async function syncTierPolicy(nextTier) {
    const targetTier = VALID_TIERS.includes(String(nextTier || '').toLowerCase()) ? String(nextTier).toLowerCase() : 'free';
    appTier = targetTier;
    if (window.rcPolicy && typeof window.rcPolicy.refreshForTier === 'function') {
      try { await window.rcPolicy.refreshForTier(targetTier); } catch (_) {}
    } else {
      try { if (typeof tokenReset === 'function') tokenReset(); } catch (_) {}
    }
    select.value = (window.rcPolicy && typeof window.rcPolicy.getTier === 'function') ? window.rcPolicy.getTier() : appTier;
    applyTierSimulationUi();
    applyTierAccess();
    try { if (typeof window.populateBrowserVoicePicker === 'function') window.populateBrowserVoicePicker(); } catch (_) {}
  }

  select.addEventListener('change', () => {
    const policyApi = window.rcPolicy || {};
    if (typeof policyApi.canSimulateTier === 'function' && !policyApi.canSimulateTier()) {
      select.value = typeof policyApi.getTier === 'function' ? policyApi.getTier() : 'free';
      return;
    }
    const newTier = select.value;
    if (!VALID_TIERS.includes(newTier) || newTier === appTier) return;
    syncTierPolicy(newTier);
  });

  document.addEventListener('rc:runtime-policy-changed', () => {
    try {
      select.value = (window.rcPolicy && typeof window.rcPolicy.getTier === 'function') ? window.rcPolicy.getTier() : appTier;
      applyTierSimulationUi();
      applyTierAccess();
    } catch (_) {}
  });

  // Apply on boot
  syncTierPolicy(appTier);

  function applyTierAccess() {
    const policyApi = window.rcPolicy || {};
    const canComprehension = typeof policyApi.canUseMode === 'function' ? policyApi.canUseMode('comprehension') : false;
    const canResearch = typeof policyApi.canUseMode === 'function' ? policyApi.canUseMode('research') : false;
    const canAiEvaluate = typeof policyApi.canUseAiEvaluate === 'function' ? policyApi.canUseAiEvaluate() : false;
    const canAnchors = typeof policyApi.canUseAnchors === 'function' ? policyApi.canUseAnchors() : false;

    const modeSelect = document.getElementById('modeSelect');
    if (modeSelect) {
      const comprehensionOpt = modeSelect.querySelector('option[value="comprehension"]');
      const researchOpt = modeSelect.querySelector('option[value="research"]');
      if (comprehensionOpt) comprehensionOpt.disabled = !canComprehension;
      if (researchOpt) researchOpt.disabled = !canResearch;

      if (appMode === 'comprehension' && !canComprehension) {
        modeSelect.value = 'reading';
        appMode = 'reading';
        if (typeof applyModeVisibility === 'function') applyModeVisibility();
      }
      if (appMode === 'research' && !canResearch) {
        modeSelect.value = 'reading';
        appMode = 'reading';
        if (typeof applyModeVisibility === 'function') applyModeVisibility();
      }
    }

    const isReadingMode = appMode === 'reading';
    document.querySelectorAll('.anchors-row').forEach(el => {
      el.style.display = (!canAnchors || isReadingMode) ? 'none' : '';
    });

    document.querySelectorAll('.ai-btn, #submitBtn').forEach(el => {
      el.style.display = (!canAiEvaluate || isReadingMode) ? 'none' : '';
    });
  }
})();

// ===================================
// 📝 Research Input
// ===================================
(function initThesisInput() {
  const input = document.getElementById('thesisInput');
  if (!input) return;
  try { input.value = localStorage.getItem('rc_thesis_text') || ''; } catch (_) {}
  thesisText = input.value;

  input.addEventListener('input', () => {
    thesisText = input.value;
    try { localStorage.setItem('rc_thesis_text', thesisText); } catch (_) {}
  });
})();

// ===================================
// ▶ Autoplay Toggle
// ===================================
(function initAutoplayToggle() {
  const checkbox = document.getElementById('autoplayToggle');
  if (!checkbox) return;
  try {
    checkbox.checked = localStorage.getItem('rc_autoplay') === '1';
    AUTOPLAY_STATE.enabled = checkbox.checked;
  } catch (_) {
    checkbox.checked = !!AUTOPLAY_STATE.enabled;
  }
  checkbox.addEventListener('change', () => {
    AUTOPLAY_STATE.enabled = checkbox.checked;
    try { localStorage.setItem('rc_autoplay', checkbox.checked ? '1':'0'); } catch (_) {}
    if (!AUTOPLAY_STATE.enabled) ttsAutoplayCancelCountdown();
  });
})();

// --- Boot: restore local session if present ---
try {
  if (loadPersistedSessionIfAny()) {
    render();
    updateDiagnostics();
    // Ensure we can rehydrate per-page saved work even if the session snapshot lacked hashes.
    ensurePageHashesAndRehydrate();
  }
} catch (_) {}
// ===================================
// Footer-aware music button position
// (updates on scroll AND on content size changes)
// ===================================
(function () {
  const musicBtn = document.getElementById("musicToggle");
  if (!musicBtn) return;

  const SNAP_THRESHOLD = 140; // px

  function updateMusicOffset() {
    const doc = document.documentElement;

    const scrollBottom = window.scrollY + window.innerHeight;
    const docBottom = doc.scrollHeight;

    const nearBottom = (docBottom - scrollBottom) <= SNAP_THRESHOLD;

    musicBtn.style.bottom = nearBottom
      ? `calc(var(--support-footer-height) + 20px)`
      : `20px`;

  }

  // Throttle to one update per frame (prevents observer spam)
  let raf = 0;
  function scheduleUpdate() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      updateMusicOffset();
    });
  }

  // Initial
  scheduleUpdate();

  // Scroll/resize
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate);
  window.addEventListener("load", scheduleUpdate);

  // Content-size changes (load pages / clear pages / render())
  const pagesEl = document.getElementById("pages");
  const footerEl = document.getElementById("supportFooter");

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(scheduleUpdate);
    if (pagesEl) ro.observe(pagesEl);
    ro.observe(document.body);
    if (footerEl) ro.observe(footerEl);
  }

  // Optional: DOM mutations (covers cases where size changes without a resize)
  if (pagesEl && window.MutationObserver) {
    const mo = new MutationObserver(scheduleUpdate);
    mo.observe(pagesEl, { childList: true, subtree: true, characterData: true });
  }
})();

window.updateDiagnostics = window.updateDiagnostics || function updateDiagnostics() {};
