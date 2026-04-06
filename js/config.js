// ===================================
// ⚙️ CONFIGURABLE SETTINGS (moved from index.html)
// ===================================

// 📏 Goals
  const DEFAULT_TIME_GOAL = 160;           // seconds
  const DEFAULT_CHAR_GOAL = 300;           // characters
  // How far from the character goal we allow before we start treating the consolidation
  // as "too short" or "too long" for scoring guidance.
  // Example: 0.25 => sweet spot is 75%–125% of the goal.
  const COMPRESSION_TOLERANCE = 0.25;
  
  // ⏱️ Sand Animation
  const SAND_START_PERCENTAGE = 0.3;  // Sand starts when 30% of time remains
  
  // 🔊 VOLUME CONTROLS (0.0 = mute, 1.0 = max)
  const SAND_VOLUME = 0.1;
  const STONE_VOLUME = 1.0;
  const MUSIC_VOLUME = 0.4;
  const REWARD_VOLUME = 1.0;
  const COMPASS_VOLUME = 1.0;
  const PAGE_TURN_VOLUME = 1.0;
  const EVALUATE_VOLUME = 0.6;
  
  // 🏆 Tier Thresholds
  const TIER_MASTERFUL = 97;
  const TIER_PROFICIENT = 90;
  const TIER_COMPETENT = 75;
  const TIER_DEVELOPING = 55;
  
  // 📊 Score Weights (total must = 100)
  const WEIGHT_COMPREHENSION = 55;
  const WEIGHT_DISCIPLINE = 25;
  const WEIGHT_COMPRESSION = 20;

  // ❤️ Support link (optional)
  // Set this to your Buy Me a Coffee page, e.g. "https://www.buymeacoffee.com/yourname"
  // If left blank, the Donate button will still render but will do nothing.
  const BUY_ME_A_COFFEE_URL = "";

// ===================================
// 🌐 API BASE RESOLUTION
// ===================================
// Keep one canonical public API origin for static-host overrides.
// Same-origin is preferred whenever the current host is already serving /api.
const JUBLY_CANONICAL_API_BASE = 'https://jubly-reader.vercel.app';

function currentOriginServesApi() {
  try {
    const { protocol, hostname } = window.location;
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    if (hostname.endsWith('.vercel.app')) return true;
    return false;
  } catch (_) {
    return false;
  }
}

function normalizeApiBase(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function resolveApiBase() {
  try {
    const qs = new URLSearchParams(window.location.search);
    const fromQs = normalizeApiBase(qs.get('api'));
    if (fromQs) return fromQs;

    const fromLs = normalizeApiBase(localStorage.getItem('rc_api_base'));
    if (fromLs) return fromLs;

    return currentOriginServesApi() ? '' : JUBLY_CANONICAL_API_BASE;
  } catch (_) {
    return JUBLY_CANONICAL_API_BASE;
  }
}

function apiUrl(path) {
  const base = resolveApiBase();
  return base ? `${base}${path}` : path;
}
