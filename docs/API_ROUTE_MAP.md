# API Route Map

Consolidated Hobby-safe route families:

- `GET /api/app?kind=public-config`
- `GET /api/app?kind=runtime-config`
- `GET /api/app?kind=health`
- `POST /api/app?kind=usage-check`
- `POST /api/app?kind=import-capacity`
- `POST /api/ai?action=anchors`
- `POST /api/ai?action=evaluate`
- `POST /api/ai?action=summary`
- `POST /api/ai?action=tts`
- `POST /api/content?action=book-import`
- `POST /api/content?action=page-break`
- `POST /api/billing?action=checkout`
- `POST /api/billing?action=portal`
- `POST /api/stripe/webhook`

Only routed entrypoints remain inside `api/`. Shared server helpers live in `server/lib/`, and prompt templates live in `server/prompts/`.
