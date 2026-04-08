# Vercel API (Reading Comprehension Grader)

## Endpoints

### POST /api/evaluate
Body:
- pageText (string) OR passageText
- userText (string) OR consolidation
- model (optional)

Response:
- { "feedback": "<4 lines>" }

### POST /api/summary
Final Summary / Full Chapter Consolidation.

Body:
- title (string, optional)
- pages (array) where each item may include:
  - pageText (string, optional)
  - userText (string, optional)
  - aiFeedback (string, optional)

Response:
- { "summary": "<markdown-ish text>" }

### GET /api/health
Response:
- { ok, hasOpenAIKey, model }

## Env vars (Vercel Project Settings)
- GROQ_API_KEY=...
- GROQ_MODEL=llama-3.3-70b-versatile (optional)

## CORS
Allowlisted origins live in:
- api/_lib/http.js
