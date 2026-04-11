# Jubly Reader — Architecture Map

This document defines ownership.

Use it to decide where code should live and what should not be duplicated.
Read `09_ARCHITECTURAL_GUARDRAILS_AND_SCAFFOLD_DISCIPLINE.md` alongside this document during refactors, scaffold changes, or any pass that could create duplicate truth.

## Governing rule
The shell layer presents controls and forwards intent.
The runtime layer owns launch-critical reading behavior.

The shell must not own, mirror, infer, or compete with runtime truth in launch-critical areas.

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
- playback speed truth
- importer lifecycle
- restore and reading continuity
- reading exit cleanup
- mode/tier gating logic once entitlement truth is resolved
- selected theme state
- appearance state
- Explorer settings state
- theme/music entitlement decisions
- applying theme/appearance values to the app

### Backend owns
- anchors
- evaluation
- summary
- import conversion
- cloud TTS
- prompt contracts and server helpers
- protected provider policy and non-obvious orchestration when feasible

### Supabase owns
- durable account data
- durable settings
- durable owned-library records
- durable restore records
- compact per-book metrics
- compact daily stats
- durable entitlement records
- durable usage window summaries

Supabase does not define runtime behavior.
It stores durable records that runtime interprets.


## Durable data identity rules

Supabase durable identity is split intentionally:
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

### Documentation files
- `docs/*.md`

## API family note
Backend entrypoints may be consolidated by relevance when deployment limits require it, but the owner rules do not change.

That means:
- app/bootstrap/runtime-policy concerns may share one backend family
- anchors/evaluate/summary may share one backend family
- billing checkout and portal may share one backend family
- webhook stays separate when raw-body handling or external endpoint stability makes that safer
- consolidation must not move protected logic back into the browser just to save route count
- consolidation should prefer latency-safe grouping over unrelated monolith endpoints

## Scaffold discipline
Folder scaffolding is not a presentation preference.
It is part of architecture.

For the current project state:
- the app web root is repository root
- `index.html` is the live shell HTML entry
- `js/` contains the live shell/runtime/supporting JS
- `css/` contains the live shell-facing CSS surface
- `docs/` is documentation only

Do not quietly reintroduce older scaffold shapes.
If scaffold shape changes, update this document and `01_PROJECT_STATE.md` in the same pass.

## Hard implementation rules
1. Do not move reading, TTS, importer, restore, or cleanup authority into shell code.
2. Do not remove shell bridge code until the runtime replacement exists.
3. Do not treat DOM polling or mirror variables as real state.
4. Do not silently change backend contracts during frontend cleanup.
5. Do not assume module or bundler semantics.
6. Do not break scaffold load order.
7. Do not treat prototype convenience paths as production authority.
8. Do not let two layers own the same launch-critical truth.
9. Do not introduce a bridge without also defining the condition for its retirement.

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

## Decision rules

### Put it in shell only if
- it is purely presentational
- it does not create or infer runtime state
- it does not duplicate lifecycle logic
- it cannot regress a runtime-owned fix

### Put it in runtime if it affects
- reading entry or exit
- current page truth
- playback
- speed
- autoplay or countdown
- importer state
- restore
- owned-book identity or delete cleanup
- progress or completion truth
- mode or tier enforcement once runtime has resolved entitlement truth
- selected theme or appearance truth
- theme gating or custom music permission

### Put it backend-side when feasible if it affects
- provider selection or fallback policy
- premium-resolution logic
- usage enforcement
- prompt logic or prompt contracts
- evaluation/import/TTS orchestration
- any non-obvious rule that would materially help a copycat if exposed

## Required local vs backend placement

### Must stay local
- reading entry responsiveness
- active page truth
- page rendering and visible card replacement
- local playback controls and runtime state needed for responsiveness
- importer staged-state truth in the browser
- theme/appearance application

### May stay local temporarily
- shell bridges waiting for an explicit runtime replacement
- local development simulation surfaces that are clearly bounded and not production authority
- transitional CSS surfaces documented as debt

### Must move backend-side before launch when feasible
- premium-resolution logic
- usage enforcement
- provider/fallback policy
- prompts and non-obvious orchestration
- evaluation/import conversion rules that are valuable beyond ordinary UI wiring

## Prototype-to-production rule
Prototype conveniences are allowed only if all are true:
- they are explicitly named as temporary
- the real owner is known
- the removal or retirement condition is documented
- they are not silently treated as launch-ready authority

Examples of prototype conveniences that require explicit retirement planning:
- dev-tier simulation controls
- fake auth or fake billing flows
- shell auto-click bridges
- DOM polling used to trigger runtime behavior
- permissive client-side gating that is meant to be server-resolved later

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

## Runtime anti-pattern blacklist
Treat these as architectural defects unless explicitly documented as temporary and justified:
- DOM polling as truth
- mirroring runtime state in shell variables
- auto-clicking buttons to trigger hidden state changes
- duplicate mode/tier checks in multiple files
- content-hash identity silently reused as owned-book identity
- restore keyed to a content fingerprint instead of an owned library item
- append-only session history used as default product persistence when compact summaries would do
- shell-side fallback logic that silently becomes runtime authority
- production policy derived from cosmetic UI state
- prototype helper paths that bypass the real owner layer
- broad scaffold reshapes mixed into unrelated bug-fix passes

## Theme rule
Themes are a presentation layer over one locked reading layout.

That means:
- theme truth belongs in runtime
- appearance truth belongs in runtime
- shell may surface swatches, tabs, and controls, but not theme truth
- themes may change decorative surfaces and ambience, not reading flow truth
- heavy local assets stay separate from durable sync-safe preferences

### Current persistence seam
Runtime should persist theme/appearance through adapter functions rather than hardcoded backend assumptions.

For now, local storage-backed adapters are acceptable.
That seam exists so Supabase can later wrap or replace durable persistence without changing runtime ownership.

## Current CSS note
The intended long-term split is still:
- structure in `components.css`
- appearance in `theme.css`

But the live implementation surface today is:
- `css/shell.css`

Treat this as logged transitional debt.
Do not wake up dormant CSS files during unrelated passes unless the pass is explicitly a CSS-surface redistribution pass.

## Redistribution rule
When shell behavior and scaffold behavior overlap, the scaffold wins by default unless the concern is purely presentational.

## Code exposure rule
Anything shipped to the browser is inspectable.

Rules:
- the client target is a lean runtime shell: presentation, local responsiveness, and thin backend adapters — not protected business or policy ownership
- keep runtime-owned reading responsiveness local
- do not move reading continuity, active page truth, or local control truth server-side just for secrecy
- move crown-jewel business logic, premium resolution, provider policy, prompt logic, usage enforcement, and non-obvious orchestration backend-side when feasible
- do not rely on obfuscation as the ownership model
- do not let `config.js` become a second hidden authority layer for protected decisions

## Implementation artifact rule
Once the owner layer is known, prefer a scoped pass diff over a sprawling rewrite.

Default:
- one bounded pass
- one canonical diff
- runtime feedback revises that same diff in place until the pass is accepted or reclassified

## Safe migration pattern
1. expose runtime API
2. point shell control at runtime API
3. verify behavior
4. remove duplicate shell logic

## Unsafe migration pattern
1. remove shell bridge first
2. assume runtime replacement already exists
3. rewrite layout and behavior at the same time
4. validate only under `file://`
