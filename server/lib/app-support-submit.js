// server/lib/app-support-submit.js
// Backend-owned support notification endpoint. The shell submits a bounded
// support payload; this endpoint owns mail delivery and sanitization.

import nodemailer from 'nodemailer';
import { json, withCors, readJsonBody } from './http.js';
import { optionalEnv } from './env.js';
import { getAllowedBrowserOrigins } from './origins.js';
import { getUserFromAccessToken } from './supabase.js';

const VALID_TYPES = new Set(['feedback', 'bug', 'question']);
const MAX_MESSAGE_CHARS = 5000;
const MAX_PATH_ITEMS = 6;
const MAX_DIAGNOSTICS_CHARS = 24000;
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

function clampText(value, max = 1000) {
  const text = String(value || '').replace(/\u0000/g, '').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function normalizeType(value) {
  const type = String(value || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (type === 'bug-report') return 'bug';
  return VALID_TYPES.has(type) ? type : '';
}

function normalizePath(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split('>');
  return raw.map((item) => clampText(item, 80)).filter(Boolean).slice(0, MAX_PATH_ITEMS);
}

function getBearer(req) {
  const header = String(req?.headers?.authorization || req?.headers?.Authorization || '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

function readMailerConfig() {
  const port = Number(optionalEnv('MAILGUN_SMTP_PORT', '587'));
  return {
    from: optionalEnv('FROM_EMAIL'),
    to: optionalEnv('TO_EMAIL'),
    host: optionalEnv('MAILGUN_SMTP_SERVER', 'smtp.mailgun.org'),
    port: Number.isFinite(port) && port > 0 ? port : 587,
    user: optionalEnv('MAILGUN_SMTP_LOGIN'),
    pass: optionalEnv('MAILGUN_SMTP_PASSWORD'),
  };
}

function missingMailerFields(config) {
  const missing = [];
  if (!config.from) missing.push('FROM_EMAIL');
  if (!config.to) missing.push('TO_EMAIL');
  if (!config.host) missing.push('MAILGUN_SMTP_SERVER');
  if (!config.port) missing.push('MAILGUN_SMTP_PORT');
  if (!config.user) missing.push('MAILGUN_SMTP_LOGIN');
  if (!config.pass) missing.push('MAILGUN_SMTP_PASSWORD');
  return missing;
}

function safeJson(value, maxChars = MAX_DIAGNOSTICS_CHARS) {
  let text = '';
  try { text = JSON.stringify(value || {}, null, 2); } catch (_) { text = '{}'; }
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…[truncated]` : text;
}

function safeFilename(value) {
  const name = clampText(value, 120).replace(/[^a-z0-9._-]+/gi, '_');
  return name || 'jubly-support-screenshot.png';
}

function parseDataUrlAttachment(input) {
  if (!input || typeof input !== 'object') return null;
  const dataUrl = String(input.dataUrl || '').trim();
  const match = /^data:([a-z0-9.+/-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!match) return null;
  const contentType = match[1].toLowerCase();
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(contentType)) return null;
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length || buffer.length > MAX_ATTACHMENT_BYTES) return null;
  return {
    filename: safeFilename(input.filename || `jubly-support-screenshot.${contentType.split('/')[1] || 'png'}`),
    content: buffer,
    contentType,
  };
}

function buildEmailText({ type, path, message, contactEmail, user, context, diagnostics, transcript }) {
  const identity = user?.email || contactEmail || context?.user?.email || 'anonymous/public';
  const tier = context?.policy?.tier || context?.user?.tier || 'unknown';
  const route = context?.location?.href || context?.route || 'unknown';
  return [
    'New Jubly Reader support message', '',
    `Type: ${type}`,
    `Path: ${path.length ? path.join(' > ') : 'unknown'}`,
    `Identity: ${identity}`,
    `User ID: ${user?.id || context?.user?.id || 'unknown'}`,
    `Tier: ${tier}`,
    `Route: ${route}`,
    `Timestamp: ${new Date().toISOString()}`,
    '', 'Message:', message,
    '', 'Transcript:', safeJson(transcript || [], 8000),
    '', 'Context:', safeJson(context || {}, 8000),
    '', 'Diagnostics:', safeJson(diagnostics || {}, MAX_DIAGNOSTICS_CHARS),
  ].join('\n');
}

async function resolveAuthUser(req) {
  const token = getBearer(req);
  if (!token) return null;
  try {
    const user = await getUserFromAccessToken(token);
    return user?.id ? { id: user.id, email: user.email || '' } : null;
  } catch (_) {
    return null;
  }
}

async function sendSupportEmail(config, payload) {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.port === 587,
    auth: { user: config.user, pass: config.pass },
  });
  const subjectPath = payload.path.length ? payload.path.join(' > ') : 'General';
  const attachments = [];
  const screenshot = parseDataUrlAttachment(payload.screenshot);
  if (screenshot) attachments.push(screenshot);
  return transport.sendMail({
    from: config.from,
    to: config.to,
    replyTo: payload.contactEmail || payload.user?.email || undefined,
    subject: `[Jubly Support] ${payload.type}: ${subjectPath}`.slice(0, 160),
    text: buildEmailText(payload),
    attachments,
  });
}

export default async function handler(req, res) {
  const allowedOrigins = getAllowedBrowserOrigins();
  if (withCors(req, res, allowedOrigins)) return;
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed. Use POST.' });

  const body = await readJsonBody(req);
  const type = normalizeType(body?.type);
  const message = clampText(body?.message, MAX_MESSAGE_CHARS);
  const path = normalizePath(body?.path);
  const contactEmail = clampText(body?.contactEmail, 254);
  if (!type) return json(res, 400, { ok: false, error: 'Invalid support message type.' });
  if (!message) return json(res, 400, { ok: false, error: 'Message is required.' });

  const config = readMailerConfig();
  const missing = missingMailerFields(config);
  if (missing.length) return json(res, 503, { ok: false, error: 'Support mailer is not configured.', missing });

  const payload = {
    type,
    path,
    message,
    contactEmail,
    user: await resolveAuthUser(req),
    context: body?.context && typeof body.context === 'object' ? body.context : {},
    diagnostics: body?.diagnostics && typeof body.diagnostics === 'object' ? body.diagnostics : {},
    transcript: Array.isArray(body?.transcript) ? body.transcript.slice(-30) : [],
    screenshot: body?.screenshot || null,
  };

  try {
    const sent = await sendSupportEmail(config, payload);
    return json(res, 200, { ok: true, id: sent?.messageId || null, delivered: true });
  } catch (err) {
    return json(res, 502, { ok: false, error: 'Support message could not be sent.', detail: clampText(err?.message || err, 500) });
  }
}
