export function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function optionalEnv(name, fallback = '') {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

function stripTrailingSlash(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function isLocalHost(host) {
  return /^localhost(?::\d+)?$/i.test(String(host || '').trim()) || /^127\.0\.0\.1(?::\d+)?$/i.test(String(host || '').trim());
}

function isLocalOrigin(origin) {
  try {
    const parsed = new URL(String(origin || '').trim());
    return isLocalHost(parsed.host);
  } catch (_) {
    return false;
  }
}

export function requestOrigin(req) {
  const explicit = stripTrailingSlash(optionalEnv('APP_BASE_URL'));
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').trim();
  const forwarded = String(req?.headers?.['x-forwarded-proto'] || '').trim().toLowerCase();
  const hasNonLocalHost = !!host && !isLocalHost(host);

  if (explicit) {
    if (!(isLocalOrigin(explicit) && hasNonLocalHost)) return explicit;
  }

  if (!host) return '';
  const proto = forwarded === 'http' || (isLocalHost(host) && !forwarded) ? 'http' : 'https';
  return `${proto}://${host}`;
}
