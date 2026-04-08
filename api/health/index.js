// api/health/index.js
import { json, withCors } from "../_lib/http.js";
import { getAllowedBrowserOrigins } from "../_lib/origins.js";

export default async function handler(req, res) {
  const allowed = getAllowedBrowserOrigins();
  if (withCors(req, res, allowed)) return;

  return json(res, 200, {
    ok: true,
    provider: "Groq",
    hasGroqKey: Boolean(process.env.GROQ_API_KEY),
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
  });
}
