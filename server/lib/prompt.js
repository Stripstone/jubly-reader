// server/lib/prompt.js
import fs from "node:fs";
import path from "node:path";

// Cache prompts by filename to support multiple prompt templates.
const cachedPrompts = new Map();

function readPromptTemplate(filename) {
  const key = String(filename || "").trim() || "promptGrader.md";
  if (cachedPrompts.has(key)) return cachedPrompts.get(key);

  // Prefer .md for system prompts (readability), but keep backward compatibility
  // in case a deployment still has the old .txt filename.
  const base = path.join(process.cwd(), "server", "prompts");
  const tryPaths = [path.join(base, key)];
  if (key === "promptGrader.md") {
    tryPaths.push(path.join(base, "promptGrader.txt"));
  }

  let txt = null;
  for (const p of tryPaths) {
    try {
      txt = fs.readFileSync(p, "utf8");
      break;
    } catch (_) {
      // continue
    }
  }
  if (txt === null) {
    throw new Error(`Missing prompt template: ${key}`);
  }
  cachedPrompts.set(key, txt);
  return txt;
}

// Backwards compatible: page-level grader prompt.
// Optional opts allow passing stable page-level guidance (e.g., anchors endpoint output).
export function buildPromptMessages(pageText, userText, opts = {}) {
  const promptTemplate = readPromptTemplate("promptGrader.md");

  const extras = [];
  if (typeof opts.pageBetterConsolidation === "string" && opts.pageBetterConsolidation.trim()) {
    extras.push("---PASSAGE REFERENCE CONSOLIDATION---");
    extras.push(opts.pageBetterConsolidation.trim());
    extras.push("");
  }
  if (Array.isArray(opts.anchors) && opts.anchors.length) {
    // Keep compact + stable: quote + terms (+ weight for grader-only structural spine).
    const compactAnchors = opts.anchors
      .map(a => ({ quote: a?.quote, terms: a?.terms, weight: a?.weight }))
      .slice(0, 12);
    extras.push("---ANCHORS---");
    extras.push(JSON.stringify(compactAnchors));
    extras.push("");

  if (Number.isFinite(Number.parseInt(opts.betterCharLimit, 10))) {
    extras.push("---CONSTRAINTS---");
    extras.push(JSON.stringify({
      betterCharLimit: Number.parseInt(opts.betterCharLimit, 10),
      bulletMaxChars: Number.isFinite(Number.parseInt(opts.bulletMaxChars, 10)) ? Number.parseInt(opts.bulletMaxChars, 10) : undefined
    }));
    extras.push("");
  }
  }

  // Match your local “template + appended content” behavior
  const userBlock = [
    "---PAGE CONTENT---",
    pageText,
    "",
    "---USER CONSOLIDATION---",
    userText,
    "",
    ...extras,
    "---",
    "",
    "Provide your grading now:",
  ].join("\n");

  return [
    { role: "system", content: promptTemplate },
    { role: "user", content: userBlock },
  ];
}

// Final Summary / Full Chapter Consolidation prompt.
// Accepts an array of pages with text + user consolidation + optional aiFeedback.
export function buildFinalSummaryMessages({ title = "", pages = [] } = {}) {
  const promptTemplate = readPromptTemplate("promptFinalSummary.txt");

  const safeTitle = String(title || "").trim();
  const pageArr = Array.isArray(pages) ? pages : [];

  const chunks = [];
  if (safeTitle) {
    chunks.push(`---CHAPTER TITLE---\n${safeTitle}\n`);
  }

  for (let i = 0; i < pageArr.length; i++) {
    const p = pageArr[i] || {};
    const pageText = String(p.pageText ?? "").trim();
    const userText = String(p.userText ?? "").trim();
    const aiFeedback = String(p.aiFeedback ?? "").trim();

    if (!pageText && !userText && !aiFeedback) continue;

    chunks.push(`---PAGE ${i + 1}---`);
    if (pageText) chunks.push(`PAGE CONTENT:\n${pageText}`);
    if (userText) chunks.push(`USER CONSOLIDATION:\n${userText}`);
    if (aiFeedback) chunks.push(`AI FEEDBACK (optional):\n${aiFeedback}`);
    chunks.push("");
  }

  const userBlock = [
    chunks.join("\n"),
    "---",
    "Create the final chapter summary now.",
  ].join("\n");

  return [
    { role: "system", content: promptTemplate },
    { role: "user", content: userBlock },
  ];
}

// Anchors prompt: page-only core idea targets.
export function buildAnchorsMessages({ pageText = "", maxAnchors = 5 } = {}) {
  const templateRaw = readPromptTemplate("promptAnchors.txt");
  const cap = Math.max(1, Math.min(12, Number(maxAnchors) || 5));
  const promptTemplate = templateRaw.replace(/\{\{MAX_ANCHORS\}\}/g, String(cap));

  const userBlock = [
    "---PAGE CONTENT---",
    String(pageText ?? ""),
    "---",
  ].join("\n");

  return [
    { role: "system", content: promptTemplate },
    { role: "user", content: userBlock },
  ];
}
