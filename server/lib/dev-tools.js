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

export async function getAuthorizedDevUser(req) {
  const token = getBearer(req);
  if (!token) return { ok: false, reason: 'missing_auth', user: null, token: '' };
  const user = await getUserFromAccessToken(token).catch(() => null);
  if (!user?.id) return { ok: false, reason: 'invalid_auth', user: null, token };
  const devEmail = getDevEmail();
  const email = String(user.email || '').trim().toLowerCase();
  if (!devEmail) return { ok: false, reason: 'dev_email_unconfigured', user, token };
  if (email !== devEmail) return { ok: false, reason: 'not_dev_account', user, token };
  return { ok: true, reason: 'ok', user, token, devEmail };
}
