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

  function loadScriptSequentially(i) {
    if (i >= ORDER.length) return;
    const s = document.createElement('script');
    s.src = base + ORDER[i];
    s.async = false;
    s.onload = () => loadScriptSequentially(i + 1);
    s.onerror = () => {
      console.error('Failed to load script:', ORDER[i]);
    };
    document.head.appendChild(s);
  }

  loadScriptSequentially(0);
})();
