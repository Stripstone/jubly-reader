# Jubly Reader — Architecture and Guardrails

This document defines ownership, scaffold discipline, protected-logic placement, forbidden patterns, and structural patch disqualifiers.

Use it during audits, refactors, shell/runtime cleanup, scaffold changes, and any pass that could create duplicate truth.

## Governing rule
The shell layer presents controls and forwards intent.
The runtime layer owns launch-critical reading behavior.

The shell must not own, mirror, infer, or compete with runtime truth in launch-critical areas.
A patch that breaks this rule is non-compliant even when the runtime looks acceptable in ad hoc testing.

## Structural compliance gate
Architecture compliance is a gate, not a quality hint.
A patch must pass this document before `02_RUNTIME_CONTRACT.md` is allowed to validate user-facing behavior.
Runtime acceptance cannot legitimize a scaffold breach, ownership breach, or duplicate-truth pattern.

## Ownership split

### Shell owns
- section routing surface
- page structure and presentation
- reading chrome placement
- modal framing
- library/profile presentation
- footer/layout behavior
- theme and appearance control surfaces
- shell-safe bridge calls into runtime APIs

### Runtime owns
- reading entry
- active page truth
- page rendering
- TTS lifecycle
- autoplay and countdown truth
- playback speed truth in active runtime behavior
- importer lifecycle
- restore and reading continuity
- reading exit cleanup
- mode and tier enforcement once entitlement truth is resolved
- selected theme state
- appearance state
- Explorer settings state
- theme and music entitlement decisions
- applying theme and appearance values to the app

### Backend owns
- anchors
- evaluation
- summary
- import conversion
- cloud TTS
- prompt contracts and server helpers
- protected provider policy and non-obvious orchestration when feasible
- usage enforcement, entitlement resolution, and premium-sensitive policy where feasible

### Supabase owns
- durable account data
- durable owned-library records
- durable restore records
- compact per-book metrics
- compact daily stats
- durable entitlement records
- durable usage window summaries
- durable user preferences that are intentionally synced

Supabase stores durable truth.
It does not define runtime behavior by itself.

## Current local vs durable persistence rules
- `appearance_mode` = local client-cache only
- `tts_speed` = not a durable synced setting
- `use_source_page_numbers` = retired legacy gate, not a durable synced setting
- diagnostics preferences = not durable product truth
- devtools-only toggles = not durable product truth
- heavy local assets remain device-local

## Retired or forbidden authority surfaces
- `use_source_page_numbers` must not act as a live runtime gate
- displayed page numbers preserve source or actual document numbering when that metadata exists
- page numbering across a book is runtime behavior, not a user preference
- devtools may inspect page metadata, but must not present source-page numbering as an active behavior switch
- durable sync must not recreate retired settings as effective behavior levers

## Durable data identity rules
- `user_library_items.id` = owned-book identity
- `content_fingerprint` = optional dedupe signal only
- `user_progress.library_item_id` = restore identity
- `user_book_metrics.library_item_id` = per-book summary identity
- `user_daily_stats(user_id, stat_date)` = daily summary identity

Content identity must not silently become ownership identity.
Deleting an owned library item must clear matching restore truth and dependent summaries.

## Current file map

### Shell files
- `index.html`
- `js/shell.js`
- `css/shell.css`

### Runtime files
- `js/app.js`
- `js/state.js`
- `js/tts.js`
- `js/import.js`
- `js/library.js`
- `js/evaluation.js`
- `js/ui.js`
- `js/audio.js`
- `js/anchors.js`
- `js/utils.js`
- `js/config.js`
- `js/embers.js`
- `js/music.js`

### Backend files
- `api/app`
- `api/ai`
- `api/billing`
- `api/content`
- `api/stripe/webhook`
- `server/lib`
- `server/prompts`

## Backend route families
Consolidated route families:
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

Consolidation must not move protected logic back into the browser just to save route count.

## Scaffold discipline
Current scaffold shape is part of architecture.

For the current project state:
- repository root is the web root
- `index.html` is the live app entry
- `js/` is the live client script tree
- `css/` is the live client CSS tree
- `docs/` is documentation only

Do not patch against older scaffold shapes unless project state is formally changed first.

## Non-negotiable rules
1. One owner per launch-critical truth.
2. The scaffold is an authority surface.
3. Prototype convenience is not production authority.
4. Shell bridges are temporary by default.
5. Runtime truth must not be inferred from the DOM.
6. Protected logic must move without breaking responsiveness.
7. Broad refactors must be decomposed into bounded authority moves.
8. A runtime pass result does not override architectural non-compliance.
9. Structural compliance is required for patch acceptance, not optional cleanup for later.

## Hard implementation rules
1. Do not move reading, TTS, importer, restore, or cleanup authority into shell code.
2. Do not remove shell bridge code until the runtime replacement exists.
3. Do not treat DOM polling or mirror variables as real state.
4. Do not silently change backend contracts during frontend cleanup.
5. Do not assume module or bundler semantics.
6. Do not break scaffold load order.
7. Do not treat prototype convenience paths as production authority.
8. Do not let two layers own the same launch-critical truth.
9. Do not introduce a bridge without defining the condition for its retirement.

## Error handling standards

### Backend — explicit logging required
Every top-level `catch (err)` block in a server handler that returns a 5xx response must call `console.error("[handler-name]", err)` before returning. A swallowed error is invisible in Vercel logs and cannot be diagnosed in production.

Correct pattern (match `content-book-import.js`):
```js
} catch (err) {
  console.error("[handler-name]", err);
  return json(res, 500, { error: "Server error", detail: String(err) });
}
```

Silent catch blocks that discard errors in business-critical paths are a patch disqualifier. Noise-suppression `catch (_) {}` inside utility helpers is acceptable only where failure is genuinely non-fatal and the outer call path has its own error reporting.

### Frontend — retry before surface
User-facing "Try again" messages and failure toasts must not appear on the first failure of a network or cloud action. The runtime must attempt 2–3 automatic retries before surfacing an error to the user. Immediate error display for transient failures degrades trust and is premature. The retry attempts must be silent from the user's perspective. Only surface the error after retries are exhausted.

## Patch disqualifiers
Reject a patch even if runtime behavior looks acceptable when any of the following are true:
- launch-critical behavior is added to `index.html`, shell HTML, or shell presentation files as an owner rather than a thin presentation or bridge surface
- shell, runtime, backend, or durable sync each believe they own the same launch-critical truth
- DOM state, hidden button clicks, mirrored shell variables, or polling loops act as authority
- a mixed-era scaffold or wrong-base artifact is used for the pass
- a retired legacy gate still acts as a live behavior switch
- a bridge becomes a silent permanent owner instead of a tracked temporary seam
- code placement violates the documented file responsibility map

A disqualified patch must be rejected or reclassified before runtime polish discussion continues.

## Current load order
`app.js` loads runtime files in this order:
- `state.js`
- `tts.js`
- `utils.js`
- `anchors.js`
- `import.js`
- `library.js`
- `evaluation.js`
- `ui.js`

Supporting JS loaded before the scaffold includes:
- `config.js`
- `audio.js`
- `embers.js`
- `music.js`

This order is part of the runtime contract.

## Protected-code rule
Anything shipped to the browser should be treated as inspectable.

Keep local only what must remain local for:
- rendering and presentation
- reading responsiveness
- active page truth
- local playback controls
- local importer staged-state truth
- theme and appearance application
- device-only flows

Move backend-side when feasible if any of the following are true:
- it resolves plan, entitlement, or usage truth
- it selects provider or fallback policy
- it contains prompts or non-obvious orchestration
- it is algorithmically valuable
- exposing it would materially shorten a copycat path

Do not rely on obfuscation as the ownership model.

## Required local vs backend placement

### Must stay local
- reading entry responsiveness
- active page truth
- page rendering and visible card replacement
- local playback controls and runtime state needed for responsiveness
- importer staged-state truth in the browser
- theme and appearance application

### May stay local temporarily
- shell bridges waiting for an explicit runtime replacement
- local development simulation surfaces clearly bounded and not production authority
- transitional CSS surfaces documented as debt

### Must move backend-side before launch when feasible
- premium-resolution logic
- usage enforcement
- provider and fallback policy
- prompts and non-obvious orchestration
- evaluation and import-conversion rules valuable beyond ordinary UI wiring

## Prototype-to-production rule
Prototype conveniences are allowed only if all are true:
- they are explicitly named as temporary
- the real owner is known
- the removal or retirement condition is documented
- they are not silently treated as launch-ready authority

## Bridge lifecycle rule
A shell/runtime bridge is acceptable only when:
- the runtime replacement does not yet exist
- the bridge points to a known target runtime API or behavior
- the bridge does not create a second competing owner
- the bridge is tracked as temporary architecture

A bridge should be removed when:
- the runtime replacement exists
- runtime validation proves the replacement owns the behavior cleanly
- the bridge is no longer reducing risk

## Anti-pattern blacklist
Treat these as defects unless explicitly documented as temporary and justified:
- duplicate truth in shell and runtime
- reading entry split across shell and runtime without a defined owner
- DOM polling as authority
- mirroring runtime state in shell variables
- hidden button clicks to create state changes
- duplicate mode or tier checks in multiple files
- content-hash identity silently reused as owned-book identity
- restore keyed to content fingerprint instead of owned item
- append-only session history as default product persistence
- shell-side fallback logic that silently becomes runtime authority
- production policy derived from cosmetic UI state
- applying a pending or hidden safe state only after awaited network work
- delaying a modal shell when only its actions need verification
- leaving gated actions clickable before required verification completes
- retry chains or visibility gates that can hang the page
- broad scaffold reshapes mixed into unrelated bug-fix passes

## Refactor entry checklist
Before starting a major refactor or redistribution pass, answer:
1. What is the exact owner layer for the target behavior?
2. What current layer is acting as a duplicate or temporary bridge?
3. What scaffold shape is authoritative for this pass?
4. What prototype conveniences are in play?
5. What behavior must remain unchanged in runtime?
6. What validation path will prove the refactor did not regress the runtime contract?

If these cannot be answered, do proof first.

## Refactor exit checklist
A refactor is not complete until:
- the new owner is explicit
- the old duplicate owner is removed or logged as temporary debt
- runtime validation confirms behavior stayed truthful
- docs reflect the new reality
- the scaffold shape used for the pass matches current project state

## Scaffold verification checklist
Before any implementation pass, verify:
- root `index.html` exists
- root `js/` exists
- root `css/` exists if the current project state expects it
- `docs/` contains docs only
- no older app root is being treated as current authority

If the scaffold fails this check:
- stop the pass
- confirm the real current artifact
- rewrite docs or archive stale guidance before proceeding
