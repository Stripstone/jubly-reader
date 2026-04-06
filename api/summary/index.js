// api/summary/index.js
import { buildFinalSummaryMessages } from "../_lib/prompt.js";
import { json, withCors, readJsonBody } from "../_lib/http.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

export default async function handler(req, res) {
  const allowed = [
    "https://stripstone.github.io",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
  if (withCors(req, res, allowed)) return;

  try {
    if (req.method !== "POST") {
      return json(res, 405, { error: "Method not allowed. Use POST." });
    }

    const body = await readJsonBody(req);
    const title = String(body?.title ?? "").trim();
    const pages = Array.isArray(body?.pages) ? body.pages : [];

    const hasAnyContent = pages.some((p) => {
      const pageText = String(p?.pageText ?? "").trim();
      const userText = String(p?.userText ?? "").trim();
      const aiFeedback = String(p?.aiFeedback ?? "").trim();
      return pageText || userText || aiFeedback;
    });

    if (!hasAnyContent) {
      return json(res, 400, { error: "Missing pages content" });
    }

    if (!process.env.GROQ_API_KEY) {
      return json(res, 500, { error: "Missing GROQ_API_KEY env var" });
    }

    const messages = buildFinalSummaryMessages({ title, pages });

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
    const summary = data?.choices?.[0]?.message?.content ?? "";

    return json(res, 200, { summary });
  } catch (err) {
    return json(res, 500, { error: "Server error", detail: String(err) });
  }
}
