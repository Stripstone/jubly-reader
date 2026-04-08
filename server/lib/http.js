// server/lib/http.js

export function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function matchesAllowedOrigin(origin, rule) {
  if (!origin || !rule) return false;
  if (typeof rule === "string") return rule === origin;
  if (rule instanceof RegExp) return rule.test(origin);
  if (typeof rule === "function") {
    try { return !!rule(origin); } catch { return false; }
  }
  return false;
}

export function withCors(req, res, allowlistOrigins = []) {
  const origin = req.headers.origin;

  // If no Origin header, it’s likely server-to-server; allow.
  let allowedOrigin = "";
  if (!origin) {
    allowedOrigin = "*";
  } else if (allowlistOrigins.some((rule) => matchesAllowedOrigin(origin, rule))) {
    allowedOrigin = origin;
  }

  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

export async function readJsonBody(req) {
  // Vercel Node functions often already provide req.body,
  // but this keeps you safe across runtimes.
  if (req.body && typeof req.body === "object") return req.body;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
