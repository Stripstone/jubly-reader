// api/health/index.js
import { json, withCors } from "../_lib/http.js";

export default async function handler(req, res) {
  const allowed = [
    "https://stripstone.github.io",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
  if (withCors(req, res, allowed)) return;

  return json(res, 200, {
    ok: true,
    provider: "Groq",
    hasGroqKey: Boolean(process.env.GROQ_API_KEY),
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
  });
}
