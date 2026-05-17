// ===================================
// 🎵 Audio (iPad Safari-friendly)
// ===================================
// iOS/iPadOS Safari often blocks audio until it's "unlocked" by a real user
// gesture. This file provides:
//  - A one-time unlock on first tap/click/key
//  - A safe play helper with small retries
//  - A global mute flag shared with app.js

(() => {
  const music = document.getElementById('bgMusic');
  const musicIcon = document.getElementById('musicIcon');

  // Expose for app.js (it references `music` and `allSoundsMuted`).
  window.music = music;
  window.allSoundsMuted = true; // start muted

  const audioEls = [
    document.getElementById('sandSound'),
    document.getElementById('stoneSound'),
    document.getElementById('rewardSound'),
    document.getElementById('compassSound'),
    document.getElementById('pageTurnSound'),
    document.getElementById('evaluateSound'),
    music,
  ].filter(Boolean);

  let unlocked = false;

  function warmupEl(el) {
    // Silent play/pause reset. If it fails, we just ignore.
    const prevMuted = el.muted;
    const prevVol = el.volume;
    try {
      el.muted = true;
      el.volume = 0;
      el.currentTime = 0;
    } catch (_) {}

    try {
      const p = el.play();
      if (p && typeof p.then === 'function') {
        return p
          .then(() => {
            el.pause();
            el.currentTime = 0;
          })
          .catch(() => {})
          .finally(() => {
            el.muted = prevMuted;
            el.volume = prevVol;
          });
      }
    } catch (_) {}

    try {
      el.pause();
      el.currentTime = 0;
    } catch (_) {}

    el.muted = prevMuted;
    el.volume = prevVol;
    return Promise.resolve();
  }

  async function unlockAllAudioOnce() {
    if (unlocked) return;
    if (document.hidden) return; // don't try while backgrounded
    unlocked = true;
    await Promise.all(audioEls.map(warmupEl));
  }

  function armUnlockListeners() {
    const handler = () => unlockAllAudioOnce();
    ['pointerdown', 'touchend', 'mousedown', 'keydown'].forEach((evt) => {
      document.addEventListener(evt, handler, { once: true, passive: true });
    });
  }

  // Arm immediately, and re-arm after returning to the tab.
  armUnlockListeners();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) armUnlockListeners();
  });

  async function playWithRetry(el, { restart = true, loop = null, retries = 2, delayMs = 120 } = {}) {
    if (!el) return false;
    if (document.hidden) return false;

    // Respect mute for SFX (music is controlled by toggleMusic).
    if (window.allSoundsMuted && el !== music) return false;

    await unlockAllAudioOnce();

    try {
      if (loop !== null) el.loop = loop;
      if (restart) el.currentTime = 0;
      const p = el.play();
      if (p && typeof p.then === 'function') await p;
      return true;
    } catch (_) {
      if (retries <= 0) return false;
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(playWithRetry(el, { restart, loop, retries: retries - 1, delayMs }));
        }, delayMs);
      });
    }
  }

  // Public helpers used by app.js (optional but makes Safari more consistent).
  window.playSfx = (el, opts) => playWithRetry(el, opts);
  window.stopSfx = (el, reset = false) => {
    if (!el) return;
    try {
      el.pause();
      if (reset) el.currentTime = 0;
    } catch (_) {}
  };

  // ===================================
  // 🔊 MUSIC TOGGLE
  // ===================================
  window.toggleMusic = async function toggleMusic() {
    window.allSoundsMuted = !window.allSoundsMuted;

    if (window.allSoundsMuted) {
      // Mute all sounds
      audioEls.forEach((el) => {
        try { el.pause(); } catch (_) {}
      });
      if (musicIcon) musicIcon.textContent = '🔇';
    } else {
      // Unmute: start background music; SFX play when triggered.
      await unlockAllAudioOnce();
      if (musicIcon) musicIcon.textContent = '🔊';
      playWithRetry(music, { restart: false, loop: true, retries: 1 });
    }
  };
})();
