# Reading Trainer — Architecture Map

This document defines ownership.

Use it to decide where code should live and what should not be duplicated.

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
- mode/tier gating logic
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

### Supabase owns
- durable account data
- durable settings
- durable progress records
- durable sessions/history
- future entitlement records

Supabase does not define runtime behavior.
It stores durable records that runtime interprets.

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
- `api/*`

## Hard implementation rules
1. Do not move reading, TTS, importer, restore, or cleanup authority into shell code.
2. Do not remove shell bridge code until the runtime replacement exists.
3. Do not treat DOM polling or mirror variables as real state.
4. Do not silently change backend contracts during frontend cleanup.
5. Do not assume module or bundler semantics.
6. Do not break scaffold load order.

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
- progress or completion truth
- mode or tier enforcement
- selected theme or appearance truth
- theme gating or custom music permission

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
