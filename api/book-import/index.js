// api/pdf-to-epub/index.js
// Proxies PDF → EPUB conversion through the FreeConvert API.
// The API key stays server-side; the client does all three steps via query param:
//
//   POST ?step=upload   → { importTaskId, uploadUrl, signature }
//   POST ?step=convert  → body: { importTaskId } → { exportTaskId }
//   POST ?step=status   → body: { exportTaskId } → { status, url? }
//
// The client uploads the PDF directly to FreeConvert between steps 1 and 2,
// bypassing Vercel's body size limit. Polling (step=status) is also client-side
// so no single function invocation risks a timeout.

import { json, withCors, readJsonBody } from "../_lib/http.js";

const FC_API = "https://api.freeconvert.com/v1";

function requiredEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`${name} env var is not set`);
  return v.trim();
}

function fcHeaders() {
  return {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Authorization": `Bearer ${requiredEnv("FREECONVERT_API_KEY")}`,
  };
}

export default async function handler(req, res) {
  const allowed = [
    "https://stripstone.github.io",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
  // withCors handles OPTIONS preflight and sets headers on all responses.
  // Returns true if it already responded (preflight), so we stop here.
  if (withCors(req, res, allowed)) return;

  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed. Use POST." });
  }

  const step = req.query.step;

  try {
    // ── step=upload ─────────────────────────────────────────────────────────
    // Create a FreeConvert upload task. Returns the upload URL and signature
    // so the client can POST the PDF directly to FreeConvert, bypassing
    // Vercel's request body size limit entirely.
    if (step === "upload") {
      const r = await fetch(`${FC_API}/process/import/upload`, {
        method: "POST",
        headers: fcHeaders(),
      });
      const data = await r.json();
      if (!r.ok) return json(res, r.status, { error: "Upload task failed", detail: data });
      return json(res, 200, {
        importTaskId: data.id,
        uploadUrl:    data.result.form.url,
        signature:    data.result.form.parameters.signature,
      });
    }

    // ── step=convert ─────────────────────────────────────────────────────────
    // Kick off pdf→epub conversion and create an export task.
    // Returns exportTaskId for the client to poll.
    if (step === "convert") {
      const body = await readJsonBody(req);
      const { importTaskId } = body || {};
      if (!importTaskId) return json(res, 400, { error: "importTaskId required" });

      const convertRes = await fetch(`${FC_API}/process/convert`, {
        method: "POST",
        headers: fcHeaders(),
        body: JSON.stringify({
          input:         importTaskId,
          input_format:  "pdf",
          output_format: "epub",
        }),
      });
      const convertData = await convertRes.json();
      if (!convertRes.ok) return json(res, convertRes.status, { error: "Convert failed", detail: convertData });

      const exportRes = await fetch(`${FC_API}/process/export/url`, {
        method: "POST",
        headers: fcHeaders(),
        body: JSON.stringify({ input: [convertData.id] }),
      });
      const exportData = await exportRes.json();
      if (!exportRes.ok) return json(res, exportRes.status, { error: "Export task failed", detail: exportData });

      return json(res, 200, { exportTaskId: exportData.id });
    }

    // ── step=status ──────────────────────────────────────────────────────────
    // Polled by the client every 2s. Returns { status, url } when done.
    if (step === "status") {
      const body = await readJsonBody(req);
      const { exportTaskId } = body || {};
      if (!exportTaskId) return json(res, 400, { error: "exportTaskId required" });

      const r = await fetch(`${FC_API}/process/tasks/${exportTaskId}`, {
        headers: fcHeaders(),
      });
      const data = await r.json();
      if (!r.ok) return json(res, r.status, { error: "Status check failed", detail: data });

      return json(res, 200, {
        status: data.status,
        url:    data.status === "completed" ? (data.result?.url ?? null) : null,
      });
    }

    return json(res, 400, { error: `Unknown step: ${step}` });

  } catch (err) {
    console.error("[pdf-to-epub]", err);
    return json(res, 500, { error: err.message || "Internal server error" });
  }
}
