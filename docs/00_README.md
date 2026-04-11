# Jubly Reader — Documentation Package

This is the active documentation set for the current project state.

The goal is to keep the package small, current, and reliable during patching and major refactors.

## Read in this order
1. `01_PROJECT_STATE.md`
2. `02_RUNTIME_CONTRACT.md`
3. `03_ARCHITECTURE_MAP.md`
4. `09_ARCHITECTURAL_GUARDRAILS_AND_SCAFFOLD_DISCIPLINE.md`
5. `04_IMPLEMENTATION_WORKFLOW.md`
6. `05_LAUNCH_AND_INTEGRATION.md`

## Core authority docs

### `01_PROJECT_STATE.md`
What exists right now.

Use this before changing code.

### `02_RUNTIME_CONTRACT.md`
What the user should experience.

Use this to judge behavior and reject regressions.
It also contains the runtime experience evaluation lens used during runtime testing.

### `03_ARCHITECTURE_MAP.md`
Who owns what.

Use this to decide whether a fix belongs in shell, runtime, backend, persistence, or protected-server logic.

### `09_ARCHITECTURAL_GUARDRAILS_AND_SCAFFOLD_DISCIPLINE.md`
What architectural behavior is forbidden, what scaffold discipline is non-negotiable, and how prototype conveniences must be retired.

Use this during refactors, scaffold changes, ownership cleanup, and any pass that risks introducing duplicate truth.

### `04_IMPLEMENTATION_WORKFLOW.md`
Current approach to implementing features.

Use this as guidelines.

### `05_LAUNCH_AND_INTEGRATION.md`
What must be true before launch and how external integration fits.

Use this for launch gating, browser-vs-backend protection decisions, and Supabase/integration planning.

## Supporting policy and planning docs
- `06_BUSINESS_SURFACES_AND_FUNCTIONALITY.md`
- `07_AUTH_BILLING_WIRING_GUIDELINE.md`
- `08_IP_AND_CODE_PROTECTION_POLICY.md`

Use these when the pass touches business flows, billing/auth wiring, or browser-vs-backend code exposure decisions.

`08_IP_AND_CODE_PROTECTION_POLICY.md` is now an active launch companion, not an optional side note.

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
The app web root is now the repository root.

For the current codebase, the shell layer includes:
- `index.html`
- `js/shell.js`
- live shell-facing CSS in `css/`

That does **not** change ownership.
It only clarifies where current shell behavior lives.
Runtime still owns reading entry, active page truth, TTS, restore, importer state, countdown truth, theme truth, appearance truth, and reading exit cleanup.

## Architectural standards note
The project now treats scaffold shape and architectural discipline as first-class authority.

That means:
- folder scaffolding is part of architecture, not cosmetic organization
- mixed-era scaffolds must not silently steer implementation
- prototype conveniences must be marked, bounded, and retired deliberately
- shell bridges are temporary unless explicitly promoted and documented
- duplicate truth across shell/runtime/backend is a defect, not an implementation style

See:
- `03_ARCHITECTURE_MAP.md`
- `09_ARCHITECTURAL_GUARDRAILS_AND_SCAFFOLD_DISCIPLINE.md`
- `IMPLEMENTATION_WORKFLOW.md`

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
- `css/components.css` and `css/themeExplorer.css` describe the live reading-theme split.

Treat that as logged debt, not as a reason to patch against dormant CSS files by default.

## Archive note
`archive/CLAUDE_DEVELOPMENT_LOOP.md` is retained only as archived tool-specific history.
It is not a core process authority.
The active process truth lives in the agent-neutral implementation workflow and the core docs above.

## Rules for keeping this package accurate
- Update `01_PROJECT_STATE.md` when code reality changes.
- Update `02_RUNTIME_CONTRACT.md` when user-facing behavior changes.
- Update `03_ARCHITECTURE_MAP.md` when ownership boundaries change.
- Update `04_EXECUTION_BACKLOG.md` after implementation or validation status changes.
- Update `05_LAUNCH_AND_INTEGRATION.md` when launch gates or integration scope changes.
- Update `08_IP_AND_CODE_PROTECTION_POLICY.md` when browser-vs-backend protection policy changes.
- Update `09_ARCHITECTURAL_GUARDRAILS_AND_SCAFFOLD_DISCIPLINE.md` when architectural discipline or scaffold rules change.
- Update `IMPLEMENTATION_WORKFLOW.md` when the default development loop changes.
- Update `git_workflow_cheatsheet.md` when the patch artifact commands or naming standards change.

## During major refactors
If a document is clearly out of sync with the live scaffold shape or ownership model:
- do not quietly keep using it as authority
- either rewrite it into sync
- or archive it explicitly

Do not let mixed-era docs silently steer implementation.

## Before an implementation pass
Before handing a large objective to any agent:
1. runtime-test enough to identify the real user failure
2. write the request using explicit runtime success and failure conditions
3. decide whether the next move is proof instrumentation, a bounded patch pass, or diff-driven cleanup

Do not send a large pass based only on code suspicion.
