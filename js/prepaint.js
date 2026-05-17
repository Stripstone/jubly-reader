    (function rcPrePaintAppearance() {
        var report = {
            appearancePrePaintApplied: false,
            modeAtFirstPaint: 'light',
            modeAfterRuntime: null,
            changedAfterPaint: false,
            shellFirstAppearanceWriter: false,
            firstWriter: 'index.html',
            source: 'default'
        };
        try {
            var root = document.documentElement;
            var mode = 'light';
            var source = 'default';
            try {
                var raw = window.localStorage ? localStorage.getItem('rc_appearance_prefs') : null;
                if (raw) {
                    var parsed = JSON.parse(raw) || {};
                    var stored = parsed.appearance_mode || parsed.mode || parsed.appearance;
                    if (stored === 'dark' || stored === 'light') {
                        mode = stored;
                        source = 'local-storage';
                    }
                }
            } catch (_) {}
            if (source === 'default') {
                try {
                    var match = String(document.cookie || '').match(/(?:^|; )rc_appearance_mode=([^;]+)/);
                    if (match && match[1]) {
                        var cookieMode = decodeURIComponent(match[1]);
                        if (cookieMode === 'dark' || cookieMode === 'light') {
                            mode = cookieMode;
                            source = 'local-cookie';
                        }
                    }
                } catch (_) {}
            }
            root.classList.remove('app-light', 'app-dark');
            root.classList.add(mode === 'dark' ? 'app-dark' : 'app-light');
            root.setAttribute('data-app-appearance', mode);
            root.setAttribute('data-appearance-prepaint-applied', 'true');
            root.setAttribute('data-appearance-first-writer', 'index.html');
            root.style.colorScheme = mode;
            root.style.backgroundColor = mode === 'dark' ? '#0f172a' : '#ffffff';
            report.appearancePrePaintApplied = true;
            report.modeAtFirstPaint = mode;
            report.source = source;
            report.appliedAtMs = (window.performance && typeof window.performance.now === 'function') ? window.performance.now() : null;
        } catch (err) {
            report.error = err && err.message ? err.message : 'appearance-prepaint-error';
        }
        window.__rcAppearanceFirstPaint = report;
    })();