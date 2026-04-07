const EXACT_BROWSER_ORIGINS = [
  'https://jubly-reader.vercel.app',
  'https://stripstone.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const JUBLY_VERCEL_PREVIEW_RE = /^https:\/\/jubly-reader(?:-[a-z0-9-]+)?\.vercel\.app$/i;

export function isJublyBrowserOrigin(origin) {
  if (!origin) return false;
  if (EXACT_BROWSER_ORIGINS.includes(origin)) return true;
  return JUBLY_VERCEL_PREVIEW_RE.test(String(origin));
}

export function getAllowedBrowserOrigins() {
  return [...EXACT_BROWSER_ORIGINS, isJublyBrowserOrigin];
}
