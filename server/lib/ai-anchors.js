// server/lib/ai-anchors.js
import { buildAnchorsMessages } from "./prompt.js";
import { json, withCors, readJsonBody } from "./http.js";
import { getAllowedBrowserOrigins } from "./origins.js";
import { normalizeAnchorsWithDebug, sha256Hex, ANCHOR_VERSION } from "./anchors.js";
import { getResolvedRuntimePolicyForRequest } from "./runtime-policy.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

export default async function handler(req, res) {
  const allowed = getAllowedBrowserOrigins();
  if (withCors(req, res, allowed)) return;

  try {
    if (req.method !== "POST") {
      return json(res, 405, { error: "Method not allowed. Use POST." });
    }

    const resolved = getResolvedRuntimePolicyForRequest(req);
    if (!resolved.policy?.features?.anchors) {
      return json(res, 403, {
        error: "Anchors are not available for the active runtime policy",
        code: "anchors_unavailable",
        meta: {
          effectiveTier: resolved.effectiveTier,
          simulationAllowed: resolved.simulationAllowed,
        },
      });
    }

    const body = await readJsonBody(req);
    const pageText = String(body?.pageText ?? "").trim();
    const maxAnchors = Number(body?.maxAnchors ?? 5);
    const debug = String(body?.debug ?? "").trim() === "1" || body?.debug === true;

    if (!pageText) {
      return json(res, 400, { error: "Missing pageText" });
    }

    if (!process.env.GROQ_API_KEY) {
      return json(res, 500, { error: "Missing GROQ_API_KEY env var" });
    }

    const pageHash = sha256Hex(pageText);
    const messages = buildAnchorsMessages({ pageText, maxAnchors });

    const upstream = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.2,
      }),
    });

    const rawText = await upstream.text();
    if (!upstream.ok) {
      return json(res, 502, { error: "Groq API error", detail: rawText });
    }

    const data = JSON.parse(rawText);
    const modelText = data?.choices?.[0]?.message?.content ?? "";

    let anchors;
    let anchorsDebug = null;
    let validation = { ok: true };
    try {
      const out = normalizeAnchorsWithDebug({ pageText, modelText, maxAnchors, debug });
      anchors = out.anchors;
      anchorsDebug = out.debug;
    } catch (e) {
      validation = { ok: false, error: String(e?.message ?? e), details: e?.details ?? null };
      return json(res, 422, {
        error: "Invalid anchor output",
        details: validation,
        meta: { pageHash, anchorVersion: ANCHOR_VERSION },
        ...(debug
          ? {
              debug: {
                pageLength: pageText.length,
                pageHash,
                rawModelOutput: modelText,
              },
            }
          : {}),
      });
    }

    const payload = {
      anchors,
      meta: { pageHash, anchorVersion: ANCHOR_VERSION },
    };

    if (debug) {
      payload.debug = {
        pageLength: pageText.length,
        pageHash,
        rawModelOutput: modelText,
        parsedAnchors: anchors,
        anchorNormalization: anchorsDebug?.normalization ?? null,
        candidates: anchorsDebug?.candidates ?? null,
        validation,
        cache: { cacheHit: false }, // client-side cache; server does not cache yet
      };
    }

    return json(res, 200, payload);
  } catch (e) {
    return json(res, 500, { error: "Server error", detail: String(e?.message ?? e) });
  }
}
