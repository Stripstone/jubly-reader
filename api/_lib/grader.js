// api/_lib/grader.js

export function scoreToCompassRating(overallScore) {
  const score = Number.parseFloat(overallScore);
  const s = Number.isFinite(score) ? score : 0;
  if (s >= 84) return 5;
  if (s >= 76) return 4;
  if (s >= 70) return 3;
  if (s >= 50) return 2;
  return 1;
}

export function compassEmojis(rating) {
  const filled = "🧭".repeat(rating);
  const empty = "⚪".repeat(5 - rating);
  return `${filled}${empty} (${rating}/5)`;
}

export function parseMultiCriteriaOutput(rawText) {
  const cleaned = String(rawText || "")
    .replace(/\*\*/g, "")
    .replace(/^###\s+/gm, "")
    .replace(/^##\s+/gm, "")
    .replace(/^#\s+/gm, "");

  const lines = cleaned.split("\n");

  let overallScore = null;
  let notesText = "";
  let consolidationText = "";
  let highlightCandidates = [];

  let inNotes = false;
  let inConsolidation = false;
  let inHighlights = false;

  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || "").trim();

    // Overall Score (accept decimals)
    if (line.match(/Overall Score:\s*\[?([\d.]+)%?\]?/i)) {
      const match = line.match(/Overall Score:\s*\[?([\d.]+)%?\]?/i);
      if (match) overallScore = Math.round(parseFloat(match[1]));
      continue;
    }

    if (line === "Notes" || line === "Notes:") {
      inNotes = true;
      inConsolidation = false;
      inHighlights = false;
      continue;
    }

    if (
      line.match(/Example of Strong Consolidation/i) ||
      line.match(/Strong Consolidation/i) ||
      line.match(/Better [Cc]onsolidation/i) ||
      line.match(/Improved [Cc]onsolidation/i) ||
      line.match(/A more accurate consolidation would be/i)
    ) {
      inConsolidation = true;
      inNotes = false;
      inHighlights = false;
      continue;
    }

    // Optional highlighting support used by the UI.
    // Accept both:
    //   "Highlight Snippets:" and "Highlight Snippets (Ranked Candidates):"
    if (line.match(/^Highlight Snippets(?:\s*\(.*\))?\s*:?$/i)) {
      inHighlights = true;
      inNotes = false;
      inConsolidation = false;
      continue;
    }

    if (
      line === "Success" ||
      line === "Success:" ||
      line === "Failed" ||
      line === "Failed:" ||
      line.startsWith("Page ") ||
      line.match(/^Core Idea:/i) ||
      line.match(/^Accuracy:/i) ||
      line.startsWith("---")
    ) {
      inNotes = false;
      inConsolidation = false;
      inHighlights = false;
      continue;
    }

    if (inNotes && line) {
      const c = line.replace(/^[-•]\s*/, "").replace(/^\d+\.\s*/, "");
      if (!notesText && c.length > 20) notesText = c;
    }

    if (inConsolidation && line) {
      if (/^This\s+(?:consolidation|version|feedback|output|approach|sentence)/i.test(line)) {
        inConsolidation = false;
        continue;
      }
      if (line.length > 10) consolidationText += (consolidationText ? " " : "") + line;
    }

    if (inHighlights && line) {
      // Up to 5 ranked candidates in the format:
      //   R# | CATEGORY | <verbatim substring>
      // or literal NONE.
      if (/^none\s*$/i.test(line)) {
        highlightCandidates = [];
        inHighlights = false;
        continue;
      }

      // Keep the raw line for resilience; downstream selection will sanitize and validate
      // against the exact pageText.
      let raw = line.trim();
      if (raw.length >= 3 && raw.length <= 300) {
        // Try to parse pipe-delimited fields; if not present, treat as UNKNOWN category.
        // We intentionally keep parsing permissive here and enforce correctness later.
        const cleanedLine = raw
          .replace(/^[-*•\u2022]\s+/, "")
          .replace(/^["'“”‘’]+/, "")
          .replace(/["'“”‘’]+$/, "")
          .trim();

        const parts = cleanedLine.split("|").map((p) => p.trim()).filter(Boolean);

        let reason = "";
        let category = "UNKNOWN";
        let snippet = cleanedLine;

        if (parts.length >= 3) {
          reason = parts[0];
          category = String(parts[1] || "UNKNOWN").toUpperCase();
          snippet = parts.slice(2).join(" | ").trim();
        } else if (parts.length === 2) {
          // e.g. CATEGORY | snippet
          category = String(parts[0] || "UNKNOWN").toUpperCase();
          snippet = String(parts[1] || "").trim();
        } else {
          snippet = cleanedLine;
        }

        if (snippet && snippet.length >= 3) {
          highlightCandidates.push({ reason, category, snippet });
        }
      }

      // Hard cap to keep UI sane.
      if (highlightCandidates.length >= 5) {
        inHighlights = false;
      }
    }
  }

  if (overallScore === null) overallScore = 60;
  if (!notesText) notesText = "Review the passage for key details and mechanisms.";
  if (!consolidationText) consolidationText = "Unable to generate improved consolidation.";

  return {
    overallScore,
    notesText: notesText.replace(/\s+/g, " ").trim(),
    consolidationText: consolidationText.replace(/\s+/g, " ").trim(),
    highlightCandidates,
  };
}

export function formatAs4Lines(parsed, opts = {}) {
  const rating = scoreToCompassRating(parsed.overallScore);
  const line1 = compassEmojis(rating);
  const line2 = String(parsed.notesText || "").trim();
  const line3 = "Better consolidation:";
  let line4 = String(parsed.consolidationText || "").trim();

  const limit = Number.parseInt(opts?.betterCharLimit, 10);
  if (Number.isFinite(limit) && limit > 0) {
    line4 = shrinkBetterLine(line4, limit);
  }

  return `${line1}
${line2}
${line3}
${line4}`;
}

function shrinkBetterLine(text, limit) {
  let s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return s;
  if (s.length <= limit) return s;

  // 1) Drop speaker background clauses (names/credentials) first.
  // Heuristic: remove appositives after commas that mention roles/credentials, and leading "Using X, ..." fluff.
  const bgPatterns = [
    /,\s*(a|an)\s+[\w\s-]{0,30}(student|doctor|med|masters?|phd|author|speaker|youtuber|founder)\b[^,\.]*,?/gi,
    /\b(developed|created)\s+by\s+[A-Z][a-z]+\b[^,\.]*,?/g,
    /^Using\s+[^,]{0,40},\s*/i
  ];
  for (const rx of bgPatterns) {
    s = s.replace(rx, " ").replace(/\s+/g, " ").trim();
    if (s.length <= limit) return s;
  }

  // 2) Remove exact numbers and measurement details (%, WPM, counts) when space is tight.
  s = s
    .replace(/\b\d+(?:\.\d+)?\s*(%|percent|wpm|words per minute|words\/minute)\b/gi, "")
    .replace(/\b\d+(?:\.\d+)?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= limit) return s;

  // 3) Remove extra hedges / filler phrases.
  const fillers = [
    /\b(very|really|basically|actually|just|significantly|crucial|important|in order to|it\'s crucial to|it is crucial to|you can)\b/gi,
    /\b(as you do|for example|e\.g\.|such as)\b[^,\.]*[\,\.]?/gi
  ];
  for (const rx of fillers) {
    s = s.replace(rx, " ").replace(/\s+/g, " ").trim();
    if (s.length <= limit) return s;
  }

  // 4) Prefer a single sentence: keep first sentence if multiple.
  const firstSentence = s.split(/(?<=[\.\!\?])\s+/)[0];
  if (firstSentence && firstSentence.length <= limit) return firstSentence.trim();

  // 5) Final fallback: hard cut with ellipsis (still within limit).
  if (limit <= 1) return s.slice(0, limit);
  const ell = "…";
  const maxBody = Math.max(0, limit - ell.length);
  return (s.slice(0, maxBody).trimEnd() + ell).slice(0, limit);
}

export function isValid4LineFeedback(feedback) {
  const lines = String(feedback || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length !== 4) return false;
  if (!/^\s*(?:🧭|⚪){5}\s*\(\s*[1-5]\s*\/\s*5\s*\)\s*$/.test(lines[0])) return false;
  if (!lines[1] || lines[1].length < 10) return false;
  if (lines[2] !== "Better consolidation:") return false;
  if (!lines[3] || lines[3].length < 10) return false;
  return true;
}
