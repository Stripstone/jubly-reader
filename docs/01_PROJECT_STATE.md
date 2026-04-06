# Reading Trainer — Current Project State

## Summary
Reading Trainer is a static frontend plus serverless backend with a global-script runtime.

The current build is still a transitional shell/runtime hybrid, but the isolated theme system is now implemented and in an acceptable safe state.
Treat the current codebase as the patch target.
Do not treat older builds or older notes as implementation truth.

## Current code shape

### Shell layer
Located in:
- `docs/index.html`
- `docs/js/shell.js`
- `docs/css/shell.css`

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
Loaded by `docs/js/app.js` in this order:
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
- `docs/js/config.js`
- `docs/js/audio.js`
- `docs/js/embers.js`
- `docs/js/music.js`
- `docs/assets/books/embedded_books.js`

Current role:
- configuration/bootstrap inputs
- background audio support
- Explorer embers support
- device-local custom music persistence

### Backend
Located in:
- `api/anchors`
- `api/evaluate`
- `api/book-import`
- `api/health`
- `api/summary`
- `api/tts`
- `api/_lib`
- `api/prompts`

Current role:
- anchors
- grading/evaluation
- import conversion
- summary generation
- cloud TTS
- shared helpers and prompt contracts

## Current architectural reality

### True today
- This is a global-script app, not a module/bundler app.
- Boot order matters.
- Runtime owns actual reading behavior.
- Shell still contains presentation plus transitional bridge logic.
- Current code should be treated as the patch target.
- The isolated theme system is implemented and should now be treated as real code, not planned architecture.

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
- `docs/css/shell.css` is the live shell CSS surface today
- `docs/css/components.css` and `docs/css/theme.css` still reflect intended separation more than live implementation
- `docs/js/music.js` is valid supporting JS but the broader local-asset subsystem is not yet generalized
- some shell behavior still overlaps runtime-facing presentation glue even after the ownership cleanup
- some older documents describe target state more strongly than current code supports

### Recent validated changes
- The chapter-change continuity bug is resolved in the runtime layer.
- The isolated theme enhancement is implemented in a safe bounded state.
- Explorer now behaves as a reading-only theme surface rather than a whole-app recolor.

## What a new engineer should assume
- Preserve the current UI direction unless the bug is caused by it.
- Prefer runtime-owned fixes over new shell logic.
- Do not infer truth from the DOM if runtime can own it.
- Do not remove shell bridge code until the runtime replacement exists.
- Validate important behavior in a served environment.
- Do not wake up dormant CSS files just to satisfy the aspirational scaffold unless the pass is explicitly a CSS-surface redistribution pass.

## Current priority areas
1. restore continuity
2. TTS continuity
3. importer lifecycle
4. exit cleanup
5. shell layout stability
6. signed-in persistence/integration after runtime behavior is stable

## Logged transitional debt from the theme pass
1. CSS surface alignment is still deferred.
   - live theme work landed in `docs/css/shell.css`
   - intended split across `components.css` and `theme.css` is not yet live
2. Wallpaper asset localization is still deferred.
   - the current wallpaper path should eventually become a clean local asset/reference in the live scaffold
3. Theme/music support files are still narrow utilities.
   - `music.js` and `embers.js` are acceptable, but not yet part of a broader cleaned supporting-asset subsystem

## What this project is not yet
It is not yet:
- a thin shell over a fully cleaned scaffold
- a fully integrated Supabase client app
- a finalized monetization/billing system
- a fully redistributed final CSS surface

The present target remains stable reading behavior first.
