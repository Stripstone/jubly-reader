// Phase-1 app loader
// Keeps compatibility with an index.html that already points at js/app.js.
// It loads the new role-based files in order, without requiring a bundler.
(function () {
  const ORDER = [
    'state.js',
    'tts.js',
    'utils.js',
    'anchors.js',
    'import.js',
    'library.js',
    'evaluation.js',
    'ui.js'
  ];

  const current = document.currentScript;
  const base = current && current.src ? current.src.replace(/[^/]+$/, '') : 'js/';

  function pushAppTrail(tag, data) {
    try {
      if (!Array.isArray(window.__rcEventTrail)) window.__rcEventTrail = [];
      window.__rcEventTrail.push(Object.assign({ t: new Date().toISOString(), tag }, data || {}));
      if (window.__rcEventTrail.length > 40) window.__rcEventTrail.shift();
      if (typeof window.updateDiagnostics === 'function') window.updateDiagnostics();
    } catch (_) {}
  }

  pushAppTrail('runtime-loader-start', { order: ORDER.slice() });

  function loadScriptSequentially(i) {
    if (i >= ORDER.length) return;
    const s = document.createElement('script');
    s.src = base + ORDER[i];
    s.async = false;
    s.onload = () => {
      if (ORDER[i] === 'library.js') pushAppTrail('library-script-loaded', { script: ORDER[i] });
      loadScriptSequentially(i + 1);
    };
    s.onerror = () => {
      console.error('Failed to load script:', ORDER[i]);
    };
    document.head.appendChild(s);
  }

  loadScriptSequentially(0);
})();
