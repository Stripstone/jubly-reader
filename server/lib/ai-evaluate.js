// server/lib/ai-evaluate.js
import { buildPromptMessages } from "./prompt.js";
import {
  parseMultiCriteriaOutput,
  formatAs4Lines,
  isValid4LineFeedback,
  scoreToCompassRating,
} from "./grader.js";
import { json, withCors, readJsonBody } from "./http.js";
import { getAllowedBrowserOrigins } from "./origins.js";
import { getResolvedRuntimePolicyForRequest } from "./runtime-policy.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile"; // replacement model per Groq deprecations

function sanitizeUserFacingFeedback(text) {
  let s = String(text || "");
  // Safety-net: the prompt should prevent this, but models can drift.
  // Replace third-person "learner" phrasing with direct second-person.
  s = s.replace(/\bThe learner's\b/gi, "Your");
  s = s.replace(/\bthe learner\b/gi, "you");
  s = s.replace(/\blearner\b/gi, "you");
  // Reduce overly judgmental phrasing if it slips through.
  s = s.replace(
    /\bindicating a lack of understanding of the task\b/gi,
    "which suggests you may have missed the goal of the task"
  );
  return s;
}

export default async function handler(req, res) {
  const allowed = getAllowedBrowserOrigins();
  if (withCors(req, res, allowed)) return;

  try {
    if (req.method !== "POST") {
      return json(res, 405, { error: "Method not allowed. Use POST." });
    }

    const resolved = getResolvedRuntimePolicyForRequest(req);
    if (!resolved.policy?.features?.aiEvaluate) {
      return json(res, 403, {
        error: "AI evaluation is not available for the active runtime policy",
        code: "ai_evaluate_unavailable",
        meta: {
          effectiveTier: resolved.effectiveTier,
          simulationAllowed: resolved.simulationAllowed,
        },
      });
    }

    const body = await readJsonBody(req);
    const pageText = String(body?.pageText ?? "").trim();
    const userText = String(body?.userText ?? "").trim();
    const pageBetterConsolidation = typeof body?.pageBetterConsolidation === "string" ? body.pageBetterConsolidation : undefined;
    const anchors = Array.isArray(body?.anchors) ? body.anchors : undefined;
    const betterCharLimit = Number.isFinite(Number.parseInt(body?.betterCharLimit, 10)) ? Number.parseInt(body.betterCharLimit, 10) : undefined;
    const bulletMaxChars = Number.isFinite(Number.parseInt(body?.bulletMaxChars, 10)) ? Number.parseInt(body.bulletMaxChars, 10) : undefined;
    const debug = String(body?.debug ?? "").trim() === "1" || body?.debug === true;

    if (!pageText || !userText) {
      return json(res, 400, { error: "Missing pageText/userText" });
    }

    if (!process.env.GROQ_API_KEY) {
      return json(res, 500, { error: "Missing GROQ_API_KEY env var" });
    }

    const messages = buildPromptMessages(pageText, userText, { pageBetterConsolidation, anchors, betterCharLimit, bulletMaxChars });

    const upstream = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.3,
      }),
    });

    const rawText = await upstream.text();
    if (!upstream.ok) {
      return json(res, 502, { error: "Groq API error", detail: rawText });
    }

    const data = JSON.parse(rawText);
    const modelText = data?.choices?.[0]?.message?.content ?? "";

    let usedModelText = modelText;
    let retryOutput = "";

    let finalParsed = parseMultiCriteriaOutput(modelText);
    let feedback = formatAs4Lines(finalParsed, { betterCharLimit });

    if (!isValid4LineFeedback(feedback)) {
      const retry = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          temperature: 0.3,
        }),
      });

      const retryText = await retry.text();
      if (retry.ok) {
        const retryData = JSON.parse(retryText);
        retryOutput = retryData?.choices?.[0]?.message?.content ?? "";
        const parsed2 = parseMultiCriteriaOutput(retryOutput);
        const feedback2 = formatAs4Lines(parsed2, { betterCharLimit });
        if (isValid4LineFeedback(feedback2)) {
          feedback = feedback2;
          finalParsed = parsed2;
          usedModelText = retryOutput;
        }
      }
    }

    // Final user-facing pass: enforce second-person, supportive wording.
    feedback = sanitizeUserFacingFeedback(feedback);

    // Highlights are a first-class feature (not diagnostics): used by the UI to visually
    // mark missed/weak core items directly in the passage text.
    //
    // Policy: keep highlights proportional to the compass rating with a small amount of leeway.
    // rating=5 -> 0-1 highlights
    // rating=4 -> 1-2 highlights
    // rating=3 -> 2-3 highlights
    // rating=2 -> 3-4 highlights
    // rating=1 -> 4-5 highlights
    const rating = scoreToCompassRating(finalParsed.overallScore);
    const missing = Math.max(0, 5 - rating);
    const maxHighlights = Math.min(5, missing + 1);

    const candidates = Array.isArray(finalParsed.highlightCandidates)
      ? finalParsed.highlightCandidates
      : [];

    const userTextLower = String(userText || "").toLowerCase();

    // Normalize a candidate line into a deterministic substring (strip decoration only).
    const normalizeSnippet = (s) => {
      let t = String(s ?? "").trim();
      if (!t) return "";
      if (/^NONE$/i.test(t)) return "";
      // Strip leading bullets
      t = t.replace(/^[-*•\u2022]\s+/, "");
      // Strip leading enumeration: 1. / 1) / (1)
      t = t.replace(/^\(?\d+\)?[.)]\s+/, "");
      // Strip wrapping quotes
      t = t.replace(/^[\"'“”‘’]+/, "").replace(/[\"'“”‘’]+$/, "");
      return t.trim();
    };

    const CATEGORY_PRIORITY = {
      MECHANISM: 1,
      CONSTRAINT: 2,
      GOAL: 3,
      DEFINITION: 4,
      OUTCOME: 5,
      FRAMING: 6,
      EXAMPLE: 7,
      UNKNOWN: 8,
    };

    const isStructural = (cat) =>
      ["MECHANISM", "CONSTRAINT", "GOAL", "DEFINITION", "OUTCOME"].includes(cat);

    // Try to find a match in pageText even if the model varies case or drops trailing punctuation.
    // Returns an object with { idx, len, matched } or null.
    const findInPage = (page, snip) => {
      if (!snip) return null;

      // 1) Exact match
      let idx = page.indexOf(snip);
      if (idx !== -1) return { idx, len: snip.length, matched: snip };

      // 2) Case-insensitive exact-length match
      const pageLower = page.toLowerCase();
      const snipLower = snip.toLowerCase();
      idx = pageLower.indexOf(snipLower);
      if (idx !== -1) {
        let len = snip.length;
        // Optionally include trailing punctuation if present in page
        const tail = page.slice(idx + len, idx + len + 1);
        if (tail && /[!?.:,;)]/.test(tail)) len += 1;
        const matched = page.slice(idx, idx + len);
        return { idx, len, matched };
      }

      // 3) Strip trailing punctuation from snippet and retry
      const stripped = snip.replace(/[!?.:,;]+$/, "").trim();
      if (stripped && stripped !== snip) return findInPage(page, stripped);

      return null;
    };

    // Sanitize, dedupe, and keep only candidates that match the pageText (with mild tolerance).
    const normalized = [];
    const seen = new Set();
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i] || {};
      const rawCategory = String(c.category || "UNKNOWN").toUpperCase().trim() || "UNKNOWN";
      const reason = String(c.reason || "").trim();
      const snip = normalizeSnippet(c.snippet ?? c);

      if (!snip) continue;
      const found = findInPage(pageText, snip);
      if (!found) continue;

      const matched = found.matched;
      const key = matched; // dedupe by matched text
      if (seen.has(key)) continue;

      seen.add(key);

      const category = CATEGORY_PRIORITY[rawCategory] ? rawCategory : "UNKNOWN";
      const redundant = userTextLower.includes(String(matched).toLowerCase());

      normalized.push({
        reason,
        category,
        snippet: matched,
        rank: i, // preserve model rank as a tie-breaker
        redundant,
      });
    }

    // Proportional bounds with small leeway (but we allow fewer highlights if the page truly has
    // fewer high-quality structural anchors).
    const minHighlights = missing; // rating=5 => 0, rating=4 => 1, ...
    const maxAllowed = Math.min(5, missing + 1);

    // NOTE: Passage highlighting has been moved to /api/anchors.
    // We intentionally do not compute or return highlight snippets here.


    // Evaluate is responsible for rating + analysis only.
    // Passage highlighting is owned by /api/anchors.
    const out = {
      feedback,
      rating,
    };
    if (debug) {
      out.debug = {
        model: MODEL,
        raw_model_output: String(usedModelText || ""),
        first_model_output: String(modelText || ""),
        retry_model_output: String(retryOutput || ""),
      };
    }
    return json(res, 200, out);
  } catch (err) {
    console.error("[ai-evaluate]", err);
    return json(res, 500, { error: "Server error", detail: String(err) });
  }
}
