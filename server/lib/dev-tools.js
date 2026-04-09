import { optionalEnv } from './env.js';
import { getUserFromAccessToken } from './supabase.js';

export function getBearer(req) {
  const header = String(req?.headers?.authorization || req?.headers?.Authorization || '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

export function getDevEmail() {
  return String(optionalEnv('DEV_CREDA', '') || '').trim().toLowerCase();
}

export async function getAuthorizedUser(req) {
  const token = getBearer(req);
  if (!token) return { ok: false, reason: 'missing_auth', user: null, token: '' };
  const user = await getUserFromAccessToken(token).catch(() => null);
  if (!user?.id) return { ok: false, reason: 'invalid_auth', user: null, token };
  return { ok: true, reason: 'ok', user, token };
}

export async function getAuthorizedDevUser(req) {
  const auth = await getAuthorizedUser(req);
  if (!auth.ok) return auth;
  const devEmail = getDevEmail();
  const email = String(auth.user.email || '').trim().toLowerCase();
  if (!devEmail) return { ok: false, reason: 'dev_email_unconfigured', user: auth.user, token: auth.token };
  if (email !== devEmail) return { ok: false, reason: 'not_dev_account', user: auth.user, token: auth.token };
  return { ok: true, reason: 'ok', user: auth.user, token: auth.token, devEmail };
}
