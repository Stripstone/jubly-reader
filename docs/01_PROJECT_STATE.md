# Jubly Reader — Current Project State

## Summary
Jubly Reader is a static frontend plus serverless backend with a global-script runtime.

Treat the current codebase as the patch target.
Do not treat older builds, older notes, or mixed-era scaffolds as implementation truth.

The app web root lives at repository root.
The `docs/` directory is documentation only.

## Current code shape

### Shell layer
Located in:
- `index.html`
- `js/shell.js`
- `css/shell.css`

Current role:
- section layout and navigation
- modal shells
- reading chrome placement
- library/profile presentation
- footer/layout behavior
- settings tabs and presentation controls
- theme and appearance control surfaces
- shell-safe bridge calls into runtime APIs

### Runtime scaffold
Loaded by `js/app.js` in this order:
- `state.js`
- `tts.js`
- `utils.js`
- `anchors.js`
- `import.js`
- `library.js`
- `evaluation.js`
- `ui.js`

Current role:
- reading state
- active page truth
- TTS lifecycle
- importer lifecycle
- library loading and rendering
- evaluation flow
- runtime UI rules
- restore and reading continuity
- runtime-owned theme truth
- runtime-owned appearance truth
- runtime-owned entitlement checks for feature gating

### Supporting JS outside the loader
Loaded before the scaffold:
- `js/config.js`
- `js/audio.js`
- `js/embers.js`
- `js/music.js`
- `assets/books/embedded_books.js`

Current role:
- configuration/bootstrap inputs
- background audio support
- Explorer embers support
- device-local custom music persistence

### Backend
Located in:
- `api/app`
- `api/ai`
- `api/billing`
- `api/content`
- `api/stripe/webhook`
- `server/lib`
- `server/prompts`

Current role:
- public bootstrap/runtime config/health dispatch plus policy/capacity checks
- anchors, grading/evaluation, summary, and cloud TTS dispatch
- Stripe checkout and portal dispatch
- content import conversion dispatch
- Stripe webhook entitlement writes
- shared helpers and prompt contracts in server/lib and server/prompts

## Current architectural reality

### True today
- This is a global-script app, not a module/bundler app.
- Boot order matters.
- Runtime owns actual reading behavior.
- Shell still contains presentation plus transitional bridge logic.
- The app is served from repository root with `/api/*` alongside it.
- `docs/` is documentation only.
- The isolated theme system is implemented and should be treated as real code, not a plan.

### Durable persistence status
The durable model is still pre-launch transitional and should be treated as patch debt rather than launch-ready architecture.

Canonical pre-launch durable direction:
- `user_library_items` = owned-book identity
- `user_progress` = one-row-per-owned-item restore truth
- `user_book_metrics` = compact per-book summary
- `user_daily_stats` = compact per-day summary
- `user_sessions` is retired from the canonical launch model

### Current local vs durable intent
Runtime owns theme truth and appearance truth.

Persistence intent in the current authority stack:
- `appearance_mode` = client-cache only
- dismissed local UI affordances = client-cache only when appropriate
- diagnostics preferences = not durable product truth
- devtools-only toggles = not durable product truth
- `tts_speed` = not part of the durable settings contract
- `use_source_page_numbers` = retired legacy gate, not part of the durable settings contract

Page-number behavior intent:
- displayed page numbers preserve source or actual document numbering when that metadata exists
- page numbering is fixed runtime behavior, not a user preference
- devtools must not present source-page numbering as an active behavioral switch

Heavy device-local assets remain local for now:
- uploaded custom music blobs
- browser caches
- other user-provided binary assets

### Current product-flow intent
- Pre-account users may read the sample book.
- Ownership and expansion actions should prompt account creation.
- Signed-in users should bypass unnecessary public friction.
- Billing and entitlement truth should resolve through backend and durable records, not cosmetic UI state.

## What a new engineer should assume
For compliance audit, start with scaffold reality and file responsibility before judging runtime comfort.

- Preserve the current UI direction unless the bug is caused by it.
- Prefer runtime-owned fixes over new shell logic.
- Do not infer launch-critical truth from the DOM.
- Do not remove shell bridge code until the runtime replacement exists.
- Validate important behavior in a served environment.
- Treat scaffold verification as a precondition to implementation, not cleanup after patching.
- Treat browser-delivered code as inspectable and move crown-jewel decision logic backend-side when feasible.

## Current priority areas
1. restore continuity
2. TTS continuity
3. importer lifecycle
4. exit cleanup
5. shell layout stability
6. lean client plus protected-logic redistribution
7. signed-in persistence and integration after runtime behavior is stable

## Transitional debt still logged
1. Shell bridge retirement is not complete.
2. CSS surface redistribution is still deferred.
3. Durable sync is not fully aligned to the launch schema.
4. Some documents and audits from earlier passes remain useful history, but they are not implementation truth unless promoted into this reduced stack.

## What this project is not yet
It is not yet:
- a fully cleaned thin shell
- a fully integrated Supabase client app
- a finalized monetization/billing system
- a fully redistributed final CSS surface
- a fully redistributed protected-code architecture

The present target remains stable reading behavior first, then protected-logic redistribution, then layered integration.
