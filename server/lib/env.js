export function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function optionalEnv(name, fallback = '') {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

export function requestOrigin(req) {
  // APP_BASE_URL is the canonical public-origin contract for auth emails and
  // verified continuation. Header fallback is only for local/dev requests where
  // the host is explicitly present; never invent localhost for deployed email
  // redirects because that leaks into Supabase confirmation URLs.
  const explicit = optionalEnv('APP_BASE_URL');
  if (explicit) return explicit.replace(/\/$/, '');

  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').trim();
  if (!host) return '';
  const forwarded = String(req?.headers?.['x-forwarded-proto'] || '').trim().toLowerCase();
  const isLocal = /^localhost(?::\d+)?$/.test(host) || /^127\.0\.0\.1(?::\d+)?$/.test(host);
  const proto = forwarded === 'http' || (isLocal && !forwarded) ? 'http' : 'https';
  return `${proto}://${host}`;
}
