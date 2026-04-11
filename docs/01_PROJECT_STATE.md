# Jubly Reader — Current Project State

## Summary
Jubly Reader is a static frontend plus serverless backend with a global-script runtime.

The current build is still a transitional shell/runtime hybrid, but the isolated theme system is implemented and in an acceptable safe state.
Treat the current codebase as the patch target.
Do not treat older builds or older notes as implementation truth.

The app web root now lives at repository root.
The `docs/` directory is now for project markdown docs, not the app shell.

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
- theme/appearance control surfaces
- shell-side bridge calls into runtime APIs

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
- TTS
- importer
- library loading and rendering
- evaluation flow
- runtime UI rules
- restore and reading continuity logic
- runtime-owned theme truth
- runtime-owned appearance truth
- runtime-owned entitlement checks for theme/music gating

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
- Current code should be treated as the patch target.
- The isolated theme system is implemented and should now be treated as real code, not planned architecture.
- The app is now served from root with `/api/*` alongside it.
- `docs/` is now documentation only.


### Durable persistence status
The current validated runtime artifact still reflects a transitional durable model that is being retired before launch.

Canonical pre-launch replacement direction:
- `user_library_items` becomes the owned-book identity table
- `user_progress` becomes one-row-per-owned-item restore truth
- `user_book_metrics` and `user_daily_stats` replace default append-only session history for product-facing summaries
- `user_sessions` is no longer treated as canonical launch persistence

Until the replacement SQL and follow-up code pass land, treat durable table drift as known pre-launch debt rather than launch-ready architecture.

### Architectural discipline now treated as active project state
- folder scaffolding is part of architecture and must be treated as an authority surface
- the repository-root web app shape is intentional, not a cosmetic preference
- mixed-era scaffolds are a real regression risk and must be rejected before patching
- temporary shell bridges are allowed only when the runtime replacement does not yet exist
- prototype conveniences must not silently become production authority
- duplicate truth across shell/runtime/backend is treated as architectural debt or a defect

See:
- `03_ARCHITECTURE_MAP.md`
- `09_ARCHITECTURAL_GUARDRAILS_AND_SCAFFOLD_DISCIPLINE.md`
- `IMPLEMENTATION_WORKFLOW.md`

### Theme system now implemented
- selected theme state belongs to runtime
- appearance state belongs to runtime
- shell controls call runtime APIs for theme/appearance/settings changes
- Explorer customization lives in Reading Settings → Themes
- Profile → Settings → Appearance is global Light/Dark only
- Explorer visuals are scoped to reading content only
- Explorer background modes now exist: Plain, Texture, Wallpaper
- custom music is bounded to Explorer Themes, stored device-local, and kept separate from durable preferences
- runtime owns the theme/music access checks; shell reflects locked/unlocked state

### Still transitional
- `css/shell.css` is the live shell CSS surface today
- `css/components.css` and `css/theme.css` still reflect intended separation more than live implementation
- `js/music.js` is valid supporting JS but the broader local-asset subsystem is not yet generalized
- some shell behavior still overlaps runtime-facing presentation glue even after the ownership cleanup
- some older documents may still describe target state more strongly than current code supports if they have not been synchronized yet

### Recent validated changes
- The chapter-change continuity bug is resolved in the runtime layer.
- The isolated theme enhancement is implemented in a safe bounded state.
- Explorer now behaves as a reading-only theme surface rather than a whole-app recolor.
- The app web root has moved from `docs/` to repository root.
- Silent Polly synthesis fallback has been removed from cloud TTS behavior.

## What a new engineer should assume
- Preserve the current UI direction unless the bug is caused by it.
- Prefer runtime-owned fixes over new shell logic.
- Do not infer truth from the DOM if runtime can own it.
- Do not remove shell bridge code until the runtime replacement exists.
- Validate important behavior in a served environment.
- Do not wake up dormant CSS files just to satisfy the aspirational scaffold unless the pass is explicitly a CSS-surface redistribution pass.
- Treat browser-delivered code as inspectable and move crown-jewel decision logic backend-side when feasible.
- Treat scaffold verification as a precondition to implementation, not a cleanup step after patching.

## Current priority areas
1. restore continuity
2. TTS continuity
3. importer lifecycle
4. exit cleanup
5. shell layout stability
6. lean client + protected-logic redistribution
7. signed-in persistence/integration after runtime behavior is stable

## Logged transitional debt from the theme pass
1. CSS surface alignment is still deferred.
   - live theme work landed in `css/shell.css`
   - intended split across `components.css` and `theme.css` is not yet live
2. Wallpaper asset localization is still deferred.
   - the current wallpaper path should eventually become a clean local asset/reference in the live scaffold
3. Theme/music support files are still narrow utilities.
   - `music.js` and `embers.js` are acceptable, but not yet part of a broader cleaned supporting-asset subsystem
4. Some shell bridge behavior still needs deliberate retirement.
   - these bridges must be tracked as temporary architecture, not accepted as permanent truth layers

## What this project is not yet
It is not yet:
- a thin shell over a fully cleaned scaffold
- a fully integrated Supabase client app
- a finalized monetization/billing system
- a fully redistributed final CSS surface
- a fully redistributed protected-code architecture

The present target remains stable reading behavior first, then protected-logic redistribution, then layered integration.
