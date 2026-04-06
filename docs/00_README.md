# Reading Trainer — Documentation Package

This is the active documentation set for the current project state.

The goal is to keep the package small, current, and easy to use during patching.

## Read in this order
1. `01_PROJECT_STATE.md`
2. `02_RUNTIME_CONTRACT.md`
3. `03_ARCHITECTURE_MAP.md`
4. `04_EXECUTION_BACKLOG.md`
5. `05_LAUNCH_AND_INTEGRATION.md`

## Core authority docs

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

## Supporting policy and planning docs
- `06_BUSINESS_SURFACES_AND_FUNCTIONALITY.md`
- `07_AUTH_BILLING_WIRING_GUIDELINE.md`
- `08_IP_AND_CODE_PROTECTION_POLICY.md`

Use these when the pass touches business flows, billing/auth wiring, or browser-vs-backend code exposure decisions.

## Implementation workflow
The preferred implementation workflow is now **scoped diff-driven patching** once the owner layer is known.

Default rules:
- one bounded pass at a time
- one canonical `.diff` per active pass
- runtime feedback revises that same diff in place
- do not stack forward diffs for the same pass
- create a `.zip` alongside the diff only when new files or assets make that necessary

See:
- `IMPLEMENTATION_WORKFLOW.md`
- `git_workflow_cheatsheet.md`

## Important clarification
The shell layer is not only `docs/index.html`.

For the current codebase, the shell layer includes:
- `docs/index.html`
- `docs/js/shell.js`
- live shell-facing CSS in `docs/css/`

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
- `docs/css/shell.css` is the live shell CSS patch surface today
- `docs/css/components.css` and `docs/css/theme.css` still describe the intended split, but they are not the live implementation surface yet

Treat that as logged debt, not as a reason to patch against dormant CSS files by default.

## Agent note
`CLAUDE_DEVELOPMENT_LOOP.md` is no longer a core process authority.
If you keep it at all, treat it as archived tool-specific history.
The active process truth now lives in the agent-neutral implementation workflow and the core docs above.

## Rules for keeping this package accurate
- Update `01_PROJECT_STATE.md` when code reality changes.
- Update `02_RUNTIME_CONTRACT.md` when user-facing behavior changes.
- Update `03_ARCHITECTURE_MAP.md` when ownership boundaries change.
- Update `04_EXECUTION_BACKLOG.md` after implementation or validation status changes.
- Update `05_LAUNCH_AND_INTEGRATION.md` when launch gates or integration scope changes.
- Update `IMPLEMENTATION_WORKFLOW.md` when the default development loop changes.
- Update `git_workflow_cheatsheet.md` when the patch artifact commands or naming standards change.

## Retired documents
Older overlapping docs should be treated as archive/reference material, not active sources of truth, once this package is adopted.

## Before an implementation pass
Before handing a large objective to any agent:
1. runtime-test enough to identify the real user failure
2. write the request using explicit runtime success and failure conditions
3. decide whether the next move is proof instrumentation, a bounded patch pass, or diff-driven cleanup

Do not send a large pass based only on code suspicion.
