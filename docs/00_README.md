# Reading Trainer — Documentation Package

This is the active documentation set for the current project state.

The goal is to keep the package small, current, and easy to use during patching.

## Read in this order
1. `01_PROJECT_STATE.md`
2. `02_RUNTIME_CONTRACT.md`
3. `03_ARCHITECTURE_MAP.md`
4. `04_EXECUTION_BACKLOG.md`
5. `05_LAUNCH_AND_INTEGRATION.md`

## What each file does

### `01_PROJECT_STATE.md`
What exists right now.

Use this before changing code.

### `02_RUNTIME_CONTRACT.md`
What the user should experience.

Use this to judge behavior and reject regressions.

### `03_ARCHITECTURE_MAP.md`
Who owns what.

Use this to decide whether a fix belongs in shell, runtime, backend, or persistence.

### `04_EXECUTION_BACKLOG.md`
What still needs repair.

Use this as the working patch list.

### `05_LAUNCH_AND_INTEGRATION.md`
What must be true before launch and how external integration fits.

Use this for launch gating and Supabase/integration planning.

## Important clarification
The shell layer is not only `index.html`.

For the current codebase, the shell layer includes:
- `index.html`
- `js/shell.js`
- live shell-facing CSS in `css/`

That does **not** change ownership.
It only clarifies where current shell behavior lives.
Runtime still owns reading entry, active page truth, TTS, restore, importer state, countdown truth, theme truth, appearance truth, and reading exit cleanup.

## Current documentation note
The theme enhancement is now implemented.

That means the docs now treat these as current reality:
- runtime-owned theme state exists
- runtime-owned appearance state exists
- Explorer customization lives in Reading Settings → Themes
- Profile Appearance is global Light/Dark only
- custom music is device-local and separate from durable preferences

The CSS surface is still slightly transitional:
- `css/shell.css` is the live shell CSS patch surface today
- `css/components.css` and `css/theme.css` still describe the intended split, but they are not the live implementation surface yet

Treat that as logged debt, not as a reason to patch against dormant CSS files by default.

## Optional companion for Claude work
`CLAUDE_DEVELOPMENT_LOOP.md` is a working-method note.

It is useful to hand directly to Claude Code, but it is **not** an authority document.
If it conflicts with the five core docs above, the five core docs win.

## Rules for keeping this package accurate
- Update `01_PROJECT_STATE.md` when code reality changes.
- Update `02_RUNTIME_CONTRACT.md` when user-facing behavior changes.
- Update `03_ARCHITECTURE_MAP.md` when ownership boundaries change.
- Update `04_EXECUTION_BACKLOG.md` after implementation or validation status changes.
- Update `05_LAUNCH_AND_INTEGRATION.md` when launch gates or integration scope changes.
- Update `CLAUDE_DEVELOPMENT_LOOP.md` only when the collaboration method changes.

## Retired documents
Older overlapping docs should be treated as archive/reference material, not active sources of truth, once this package is adopted.

## Before a Claude pass
Before handing a large objective to Claude:
1. runtime-test enough to identify the real user failure
2. write the Claude request using explicit runtime success and failure conditions

Do not send Claude a large pass based only on code suspicion.
