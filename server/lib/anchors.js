// server/lib/anchors.js
import crypto from "node:crypto";

// Bump when matching/normalization semantics change so cached anchors refresh.
// v5: anchors endpoint no longer emits pageBetterConsolidation (evaluate owns that).
export const ANCHOR_VERSION = 5;

// Conservative caps to keep UI stable.
const MAX_QUOTE_LEN = 220;
const MAX_TERMS = 6;
const MAX_TERM_LEN = 36;

// Deterministic filtering for anchor term normalization.
// Goal: prefer core concepts (nouns/ideas) over glue-verbs ("feels", "is", etc.).
const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','been','being','but','by','can','could','did','do','does','doing',
  'for','from','had','has','have','having','he','her','here','hers','him','his','how','i','if','in','into',
  'is','it','its','just','like','may','me','more','most','my','no','not','of','off','on','one','or','our',
  'out','over','people','so','some','such','than','that','the','their','them','then','there','these','they',
  'this','those','to','too','under','up','us','was','we','were','what','when','where','which','who','why',
  'will','with','without','you','your'
]);

const WEAK_VERBS = new Set([
  'be','been','being','is','are','was','were','am',
  'have','has','had','having',
  'do','does','did','doing',
  'get','gets','got','getting',
  'make','makes','made','making',
  'feel','feels','felt','feeling',
  // common "action" verbs / helper words that tend to become unhelpful anchor keywords
  // (we prefer the nouns/concepts around them)
  'create','creates','created','creating',
  'need','needs','needed','needing',
  'start','starts','started','starting',
  'earn','earns','earned','earning',
  'move','moves','moved','moving',
  'begin','begins','began','beginning',
  'able','right'
]);

// Normalize a token into a stable trigger key.
// Matching robustness is primarily handled in the UI via "trim variants".
function baseForm(token) {
  let t = String(token ?? '').toLowerCase().trim();
  if (!t) return '';
  t = t.replace(/[^a-z0-9]/g, '');
  return t;
}

function tokenizeBase(text) {
  const s = String(text ?? '').toLowerCase();
  const words = s.split(/[^a-z0-9]+/g).filter(Boolean);
  const out = [];
  for (const w of words) {
    const b = baseForm(w);
    if (!b) continue;
    if (b.length < 4) continue;
    if (STOPWORDS.has(b)) continue;
    if (WEAK_VERBS.has(b)) continue;
    out.push(b);
  }
  return out;
}

function buildFreqMap(pageText) {
  const freq = new Map();
  const toks = tokenizeBase(pageText);
  for (const t of toks) freq.set(t, (freq.get(t) || 0) + 1);
  return freq;
}

export function sha256Hex(text) {
  const h = crypto.createHash("sha256");
  h.update(String(text ?? ""), "utf8");
  return h.digest("hex");
}

function stripCodeFences(s) {
  let t = String(s ?? "").trim();
  // Remove ```json ... ``` wrappers if present.
  t = t.replace(/^```[a-zA-Z]*\s*/i, "").replace(/```\s*$/i, "");
  return t.trim();
}

function extractFirstJsonObject(text) {
  const t = stripCodeFences(text);
  // Fast path: already looks like JSON.
  if (t.startsWith("{") && t.endsWith("}")) return t;

  // Best-effort: find the first balanced {...} block.
  const start = t.indexOf("{");
  if (start === -1) return "";
  let depth = 0;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return "";
}

function normalizeTerm(x) {
  const t = String(x ?? "").trim();
  if (!t) return "";
  // Keep terms simple and UI-safe.
  const cleaned = t
    .replace(/[\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-*•\u2022]\s+/, "")
    .trim();
  if (!cleaned) return "";
  return cleaned.slice(0, MAX_TERM_LEN);
}

function normalizeQuote(x) {
  let q = String(x ?? "").trim();
  if (!q) return "";
  // Strip wrapping quotes and leading bullets.
  q = q.replace(/^[-*•\u2022]\s+/, "");
  q = q.replace(/^[\"'“”‘’]+/, "").replace(/[\"'“”‘’]+$/, "");
  q = q.replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return "";
  return q.slice(0, MAX_QUOTE_LEN);
}

// Find an exact substring in pageText, with mild tolerance:
// - allow case-insensitive matching
// - allow dropping trailing punctuation in the quote
// Returns the exact matched substring from pageText, or "".
function findQuoteInPage(pageText, quote) {
  const page = String(pageText ?? "");
  const q = String(quote ?? "");
  if (!page || !q) return "";

  // 1) Exact match
  let idx = page.indexOf(q);
  if (idx !== -1) return page.slice(idx, idx + q.length);

  // 2) Case-insensitive match, then return the exact substring
  const pl = page.toLowerCase();
  const ql = q.toLowerCase();
  idx = pl.indexOf(ql);
  if (idx !== -1) return page.slice(idx, idx + q.length);

  // 3) Strip trailing punctuation and retry
  const stripped = q.replace(/[!?.:,;]+$/, "").trim();
  if (stripped && stripped !== q) return findQuoteInPage(page, stripped);

  return "";
}

function stableAnchorId(i) {
  // Deterministic IDs based on normalized ordering.
  return `a${i + 1}`;
}

// Diagnostics helper: normalize "candidates" (ranked snippet ideas) without affecting
// the runtime anchor contract. This must never throw; diagnostics should not break
// the endpoint.
function normalizeCandidatesForDebug({ pageText, candidatesArr }) {
  try {
    const page = String(pageText ?? "");
    if (!Array.isArray(candidatesArr)) return null;

    const out = [];
    for (const c of candidatesArr) {
      if (!c || typeof c !== "object") continue;
      const rank = Number(c.rank);
      const label = typeof c.label === "string" ? c.label.trim() : "";
      const q0 = normalizeQuote(c.quote ?? c.snippet ?? c.text ?? "");
      if (!q0) continue;
      const matched = findQuoteInPage(page, q0);
      if (!matched) continue;
      out.push({
        rank: Number.isFinite(rank) ? rank : null,
        label: label || null,
        quote: matched,
      });
    }

    // Keep ordering deterministic.
    out.sort((a, b) => {
      const ar = a.rank ?? 1e9;
      const br = b.rank ?? 1e9;
      if (ar !== br) return ar - br;
      return a.quote.length - b.quote.length;
    });

    return out.slice(0, 12);
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

function rankAndCapTerms({ candidates, freqMap, max = 5 }) {
  const seen = new Set();
  const ordered = [];
  for (const c of candidates) {
    const b = baseForm(c);
    if (!b) continue;
    if (b.length < 4) continue;
    if (STOPWORDS.has(b)) continue;
    if (WEAK_VERBS.has(b)) continue;
    if (seen.has(b)) continue;
    seen.add(b);
    ordered.push({ term: b, freq: freqMap?.get(b) ?? 9999, len: b.length, srcRank: ordered.length });
  }

  ordered.sort((a, b) => {
    if (a.freq !== b.freq) return a.freq - b.freq; // prefer rarer
    if (b.len !== a.len) return b.len - a.len; // then longer
    return a.srcRank - b.srcRank;
  });

  return ordered.slice(0, max).map(x => x.term);
}

// Core contract: LLM proposes, backend normalizes/dedupes/validates.
// Throws an Error with .details for structured error responses.
export function normalizeAnchors({ pageText, modelText, maxAnchors = 5 } = {}) {
  const { anchors } = normalizeAnchorsWithDebug({ pageText, modelText, maxAnchors, debug: false });
  return anchors;
}

// Same as normalizeAnchors, but optionally returns detailed normalization info for diagnostics.
export function normalizeAnchorsWithDebug({ pageText, modelText, maxAnchors = 5, debug = false } = {}) {
  const page = String(pageText ?? "");
  const cap = Math.max(1, Math.min(12, Number(maxAnchors) || 5));

  const freqMap = buildFreqMap(page);
  // For "no filler" enforcement: only allow final trigger terms that actually occur in the page.
  // (Models may propose extra conceptual terms; we keep them only if grounded in page text.)
  const pageTokenSet = new Set(Array.from(freqMap.keys()));

  const jsonStr = extractFirstJsonObject(modelText);
  if (!jsonStr) {
    const err = new Error("Invalid anchor output");
    err.details = {
      reason: "no_json_object",
      modelTextPreview: String(modelText ?? "").slice(0, 400),
    };
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    const err = new Error("Invalid anchor output");
    err.details = {
      reason: "json_parse_error",
      message: String(e?.message ?? e),
      jsonPreview: jsonStr.slice(0, 400),
    };
    throw err;
  }

  const arr = Array.isArray(parsed?.anchors) ? parsed.anchors : null;
  if (!arr) {
    const err = new Error("Invalid anchor output");
    err.details = { reason: "missing_anchors_array", parsedType: typeof parsed };
    throw err;
  }

  // NOTE: Anchors endpoint no longer emits a page-level "better consolidation".
  // We intentionally ignore any legacy model output field to keep responsibilities clean.

  // Optional: ranked candidate snippets (diagnostics only).
  const candidatesArr = Array.isArray(parsed?.candidates) ? parsed.candidates : null;

  // (legacy) consolidation intentionally ignored.


  // Normalize items.
  const raw = arr.slice(0, Math.max(0, cap * 3)); // allow extra for dedupe
  const seen = new Set();
  const out = [];
  const debugAnchors = [];

  for (let i = 0; i < raw.length; i++) {
    const it = raw[i] ?? {};
    const quote = normalizeQuote(it.quote ?? it.snippet ?? it.text ?? "");
    if (!quote) continue;

    const matched = findQuoteInPage(page, quote);
    if (!matched) continue;

    // Terms and optional synonyms
    const termsInRaw = Array.isArray(it.terms) ? it.terms : [];
    const synInRaw = Array.isArray(it.synonyms) ? it.synonyms : [];

    const modelTerms = termsInRaw
      .map((t) => normalizeTerm(t))
      .filter(Boolean);
    const modelSynonyms = synInRaw
      .map((t) => normalizeTerm(t))
      .filter(Boolean);

    // Also include literal content words from the quote to avoid missing key words like "generational".
    const quoteTokens = tokenizeBase(matched);

    const candidates = [];
    // Ground model-proposed terms/synonyms: only keep tokens that appear somewhere in the page.
    // This prevents invented filler like "comprehension" unless it exists in the source text.
    for (const t of modelTerms) {
      for (const tok of tokenizeBase(t)) if (pageTokenSet.has(tok)) candidates.push(tok);
    }
    for (const s of modelSynonyms) {
      for (const tok of tokenizeBase(s)) if (pageTokenSet.has(tok)) candidates.push(tok);
    }
    candidates.push(...quoteTokens);

    const normalizedTerms = rankAndCapTerms({ candidates, freqMap, max: 5 });

    // Keep within caps for UI and transport.
    const terms = normalizedTerms.slice(0, MAX_TERMS).map((t) => t.slice(0, MAX_TERM_LEN));

    // Weight (optional). Keep it small.
    let weight = Number(it.weight);
    if (!Number.isFinite(weight)) weight = 1;
    weight = Math.max(1, Math.min(3, Math.round(weight)));

    const key = matched.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      // temporary id; finalized after ordering
      id: "",
      quote: matched,
      terms,
      weight,
      _rank: i, // preserve model rank as a tie-breaker
    });

    if (debug) {
      // Best-effort reporting of what was kept vs dropped.
      const finalSet = new Set(terms);
      const rawTokens = [...new Set(candidates.map((c) => baseForm(c)).filter(Boolean))];
      const rejected = rawTokens.filter((t) => !finalSet.has(t));
      debugAnchors.push({
        quote: matched,
        modelTerms,
        modelSynonyms,
        normalizedTerms: terms,
        rejectedTermsPreview: rejected.slice(0, 12),
      });
    }
  }

  if (out.length === 0) {
    const err = new Error("Invalid anchor output");
    err.details = {
      reason: "no_valid_anchors",
      note: "All candidates failed substring/normalization constraints.",
    };
    throw err;
  }

  // Deterministic ordering: earlier appearance in pageText, then longer quote, then model rank.
  const indexed = out
    .map((a) => {
      const idx = page.indexOf(a.quote);
      return { ...a, _idx: idx === -1 ? 1e9 : idx };
    })
    .sort((a, b) => {
      if (a._idx !== b._idx) return a._idx - b._idx;
      if (b.quote.length !== a.quote.length) return b.quote.length - a.quote.length;
      return a._rank - b._rank;
    })
    .slice(0, cap);

  // Finalize ids and remove internal fields.
  const anchors = indexed.map((a, i) => ({
    id: stableAnchorId(i),
    quote: a.quote,
    terms: a.terms,
    weight: a.weight,
  }));

  return {
    anchors,
    pageBetterConsolidation: null,
    debug: debug
      ? {
          normalization: debugAnchors,
          candidates: normalizeCandidatesForDebug({ pageText: page, candidatesArr }),
          pageBetterConsolidation: null,
        }
      : null,
  };
}
