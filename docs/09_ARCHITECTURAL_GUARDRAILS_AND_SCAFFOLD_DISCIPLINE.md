# Jubly Reader — Architectural Guardrails and Scaffold Discipline

_Status: active architectural policy_

## Purpose
This document turns recent refactor pain into project rules.

It exists to prevent:
- mixed-era scaffold confusion
- prototype conveniences becoming production authority
- duplicate truth across shell/runtime/backend
- broad refactors that quietly reintroduce monolith behavior
- heavy corrective tolls caused by missing architectural standards

This document is not standalone.
Read it alongside:
- `01_PROJECT_STATE.md`
- `02_RUNTIME_CONTRACT.md`
- `03_ARCHITECTURE_MAP.md`
- `05_LAUNCH_AND_INTEGRATION.md`
- `IMPLEMENTATION_WORKFLOW.md`

## Core principle
Folder scaffolding and architecture are part of behavior discipline, not mere code organization.

If a scaffold shape, bridge pattern, or prototype convenience makes ownership ambiguous, that is an architectural problem even before runtime breaks visibly.

Treat any drift from thin-client responsibilities toward client-owned business or policy truth as protected-code regression, even if runtime behavior still appears correct.


## Durable-table discipline rule
Launch persistence must use compact, role-clean tables.

Required durable split:
- owned-book identity in `user_library_items`
- restore truth in `user_progress`
- per-book summary in `user_book_metrics`
- daily summary in `user_daily_stats`

Forbidden launch defaults:
- content fingerprint as owned-book identity
- append-only session/event growth as default product persistence
- generated helper columns in canonical write payloads
- delete flows that leave orphaned restore state behind

## Non-negotiable rules

### 1. One owner per launch-critical truth
For any launch-critical behavior, one layer owns the truth.

Examples:
- reading entry
- active page
- playback state
- resume eligibility
- importer staged file state
- mode selection
- resolved entitlement truth

If two layers appear to own the same truth, treat that as a defect or logged temporary bridge.

### 2. The scaffold is an authority surface
Current scaffold shape is part of the implementation contract.

For the current project state:
- repository root is the web root
- `index.html` is the live app entry
- `js/` is the live client script tree
- `css/` is the live client CSS tree
- `docs/` is documentation only

Do not patch against older scaffold shapes unless the project state is formally changed first.

### 3. Prototype convenience is not production authority
Prototype helpers are allowed only when explicitly bounded.

They must not silently become the real owner of:
- reading entry
- mode gating
- importer truth
- auth/billing truth
- entitlement or policy truth

### 4. Shell bridges are temporary by default
A shell bridge may exist only when the runtime replacement does not yet exist.

Every bridge should have:
- a named target runtime owner
- a removal condition
- a debt note or an active reason it still exists

### 5. Runtime truth must not be inferred from the DOM
DOM state may reflect truth.
It must not define truth for launch-critical behavior.

Do not use:
- DOM polling as authority
- hidden button clicks to create state changes
- mirrored shell variables as playback or reading truth
- cosmetic UI state as entitlement truth

### 6. Protected logic must move without breaking responsiveness
Server-protected production hardening is required, but not at the cost of local reading correctness.

The browser keeps:
- reading responsiveness
- active page truth
- rendering
- local importer lifecycle
- local playback controls and state needed for responsiveness

Backend should own where feasible:
- premium resolution
- usage enforcement
- provider policy
- prompts and non-obvious orchestration
- evaluation and import-conversion policy

### 7. Broad refactors must be decomposed into bounded authority moves
A safe refactor is not “move everything.”
It is a sequence of bounded authority corrections.

Allowed pattern:
1. identify owner
2. expose replacement seam
3. point callers to the new owner
4. runtime-validate
5. retire duplicate layer

## Required architectural decision table

### Keep local if all are true
- it must run in the browser for responsiveness or browser-only interaction
- exposing it does not materially help a copycat
- it is not premium, usage, provider, prompt, or entitlement logic
- moving it backend-side would harm the runtime contract

### Move backend-side if any are true
- it resolves plan, entitlement, trial, or usage truth
- it selects provider or fallback policy
- it contains prompts or non-obvious orchestration
- it meaningfully shortens a copycat path if left in the client
- it is business logic rather than responsiveness logic

### Treat as temporary debt if both are true
- it currently lives in a suboptimal layer
- moving it safely requires a bounded seam pass first

## Prototype-to-production migration standard
Before a prototype convenience may remain in the codebase during hardening, document all of the following:
- what it currently does
- who should really own it
- why it still exists
- how runtime validation will prove it can be retired

Examples:
- local tier simulation
- fake auth or billing surfaces
- shell auto-load helpers
- permissive client-only gating
- hidden compatibility branches to old scaffold assumptions

## Anti-pattern blacklist
These require explicit justification or removal.

### State and ownership anti-patterns
- duplicate truth in shell and runtime
- reading entry split across shell and runtime without a defined owner
- mode changes accepted before entitlement is checked
- importer staged state controlled by multiple layers
- restore truth attached to content identity instead of owned-book identity
- delete lifecycle split between local UI and remote durable truth
- playback controls claiming success when runtime state did not change

### Scaffold anti-patterns
- patching from an older scaffold while current docs declare a new one
- mixing scaffold redistribution into an unrelated corrective pass
- leaving mixed-era folder shapes available as silent bases for later work

### Refactor anti-patterns
- broad rewrites without explicit owner confirmation
- moving code server-side purely for secrecy while harming responsiveness
- leaving prototype shortcuts in place after the runtime owner exists
- continuing to add bridges without defining their retirement

### Deployment-limit consolidation rule
When platform limits require fewer backend entrypoints:
- consolidate backend routes by relevance, not convenience
- prefer stable backend families such as app/config, AI, and billing
- keep external webhook paths separate when raw-body handling or third-party configuration stability benefits from it
- do not push protected logic back into client code just to reduce serverless function count
- do not merge unrelated responsibilities into a vague monolith endpoint if it makes ownership less clear or increases regression risk

## Refactor entry checklist
Before starting a major refactor or redistribution pass, answer all of these:
1. What is the exact owner layer for the target behavior?
2. What current layer is acting as a duplicate or temporary bridge?
3. What scaffold shape is authoritative for this pass?
4. What prototype conveniences are in play?
5. What behavior must remain unchanged in runtime?
6. What validation path will prove the refactor did not regress the runtime contract?

If these cannot be answered, do proof first.

## Refactor exit checklist
A refactor is not considered complete until all are true:
- the new owner is explicit
- the old duplicate owner is removed or logged as temporary debt
- runtime validation confirms behavior stayed truthful
- docs reflect the new reality
- the scaffold shape used for the pass matches current project state

## Scaffold verification checklist
Before any implementation pass, verify all of the following:
- root `index.html` exists
- root `js/` exists
- root `css/` exists if the current project state expects it
- `docs/` contains docs only
- no older app root is being treated as current authority

If the scaffold fails this check:
- stop the pass
- confirm the real current artifact
- rewrite docs or archive stale guidance before proceeding

## Version-marker rule for artifact handoff
If a pass introduces new files into the target artifact:
- increment the root version marker as the project currently defines it

If a pass edits only existing files:
- leave the version marker unchanged
- rely on the diff artifact for change visibility

This exists to catch environment mismatch and hallucinated scaffold drift faster.

## Required documentation sync rule
When architecture or scaffold reality changes, update the following in the same documentation cycle:
- `01_PROJECT_STATE.md`
- `03_ARCHITECTURE_MAP.md`
- this document
- `IMPLEMENTATION_WORKFLOW.md` if the working loop changes

Do not let current code, scaffold shape, and architecture docs drift apart for convenience.

## Launch relevance
This document is part of launch readiness even before production promotion.

Why:
- poor scaffold discipline causes wrong-base regressions
- weak ownership creates runtime dishonesty
- prototype conveniences left in place become production bugs
- protected-logic redistribution only works cleanly if ownership and scaffold discipline are stable first

## One-sentence summary
**Jubly Reader treats scaffold shape, ownership boundaries, bridge retirement, and prototype-to-production discipline as first-class architecture, so refactors do not repeatedly recreate monolith behavior or duplicate truth.**
