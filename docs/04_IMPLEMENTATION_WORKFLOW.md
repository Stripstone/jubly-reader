# Jubly Reader — Implementation Workflow

This document defines the default development loop for implementation work.

It is agent-neutral.
Use it whether the work is produced by OpenAI, Claude, or a human.

Read `09_ARCHITECTURAL_GUARDRAILS_AND_SCAFFOLD_DISCIPLINE.md` alongside this workflow when a pass touches scaffold shape, ownership cleanup, or prototype-to-production migration.

## Core workflow

### 0. Verify current scaffold and artifact reality
Before planning or editing:
- start from the latest accepted artifact or current runtime state
- unpack into a fresh clean workspace
- verify shape sentinels against current project state
- confirm the pass is not using a mixed-era scaffold by accident

If the base is wrong, discard the pass and restart from the correct state.

### 1. Define one bounded pass
A pass should cover one coherent runtime-owned system or one contained follow-up inside that system.

### 2. Identify the owner layer
Use the architecture map, guardrails, and runtime contract to decide where truth belongs.

Rule:
- upstream authority first
- nearby regression scan second
- contained patching third

### 3. Decide whether proof comes before code
Add temporary diagnostics before patching when:
- the owner path is ambiguous
- two or more plausible layers could explain the same symptom
- a previous patch failed or fixed the wrong layer
- races, stale state, or competing callers are plausible
- runtime contradicts code-inspection confidence

Diagnostics must be:
- narrow
- removable
- aimed at one failing case end-to-end
- removed after proof is collected

### 4. Create one canonical patch artifact
The default deliverable for an implementation pass is one scoped `.diff` file.

Rules:
- one bounded pass = one canonical diff
- revise that same diff in place after runtime feedback
- do not stack forward diffs for the same pass
- produce a `.zip` only when new files or assets make that necessary
- if new files are introduced, apply the current version-marker rule for the target artifact

### 5. Runtime test
Served runtime results decide status.
Do not mark behavior fixed from code inspection alone.

Runtime testing should use the runtime experience evaluation lens in `02_RUNTIME_CONTRACT.md`.

At minimum, record observations in these categories:
- state transitions
- settings
- value rendering
- reading continuity

For each category, note:
- client immediate
- mutations
- server settle
- later truth
- must not happen

Do not mark a behavior acceptable merely because it corrected itself later.
If runtime first shows a believable wrong state, treat that as a failure unless the contract explicitly allows that transition.

### 6. Revise or reclassify
- same pass → revise the same diff
- new pass → create a new diff

Reclassify the work when:
- the owner layer was wrong
- multiple files outside current scope clearly own the remaining issue
- the current diff is patching symptoms instead of authority
- repeated revisions are not reducing the failure surface

## Architectural discipline rules for implementation

### Prototype-to-production rule
If a pass still depends on a prototype convenience:
- name it explicitly
- confirm the real target owner
- avoid letting it silently become permanent authority

### Bridge rule
If a bridge remains in place after the pass:
- say which runtime owner it is waiting on
- say why it still exists
- do not add a second bridge casually in the same area

### Scaffold rule
Do not quietly patch against the wrong scaffold and “fix it later.”
Scaffold mismatch invalidates the pass base.

### Anti-pattern rule
Do not use a pass to normalize bad architecture by accident.
If the pass would legitimize duplicate truth, reclassify it and fix ownership first.

## Patch-safety rules
- do not move runtime truth into shell
- do not remove a bridge until the runtime replacement exists
- do not widen a pass casually
- do not let one fix silently redefine ownership
- do not mix unrelated cleanup into a bounded pass
- do not treat scaffold changes as harmless file moves; they are architectural changes

## Deliverables policy
Every patch handoff should return:
1. exact files changed
2. exact behavior change
3. main regression risk
4. concise runtime validation path

Every active diff handoff should also say:
- current objective
- files in scope
- passed areas
- failed areas
- exact diff filename in play
- whether the diff is cumulative or follow-up
- latest runtime caveat, if any

## Refactor entry questions
Before starting a major refactor or redistribution pass, answer:
- what is the owner layer?
- what older layer is being retired or narrowed?
- what scaffold shape is authoritative for this pass?
- what prototype conveniences still exist here?
- what runtime behavior must remain unchanged?

If these answers are not clear, do proof or documentation sync first.

## When to stop using direct broad implementation
Stop using broad implementation passes and switch to diff-driven cleanup when:
- the owner layer is already confirmed
- the active pass already has one patch artifact
- runtime feedback is now about correction, refinement, or one remaining behavior
- the pass is no longer discovering new architecture truth

## Tooling note
Implementation agent is interchangeable.
The project authority lives in:
- runtime observation
- the core docs
- the current patch artifact

Not in the habits of any one model.
