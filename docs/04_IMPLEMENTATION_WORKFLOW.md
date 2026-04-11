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


### 0.5 Schema-replacement sequencing rule
When a pass is replacing a drifted durable schema before launch:
1. rewrite the docs first
2. run the replacement SQL second
3. patch the code against that new schema third

Do not finalize a runtime continuity patch against a schema that is about to be retired.

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

### 3.5 Responsiveness-first interaction rules
When a pass touches a user-visible transition, apply these rules by default:

- render the safe pending or hidden state before any await that could stall the visible surface
- open modal shells immediately when local knowledge is enough to present them safely
- keep gated action buttons locked until server-backed checks settle instead of delaying the whole surface
- gate account-backed rendering on explicit hydration or confirmation seams, not inferred readiness
- when using cache for responsiveness, treat it as projection only; replay only dirty unconfirmed mutations rather than blindly resending all cached values
- if a visible surface will update after hydration, reserve its layout space or stabilize its position so late text does not shake the page

These rules exist to prevent the app from feeling like a form submission, a buffering video, or a glitchy catch-up UI.

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

During runtime testing, call out these failure shapes explicitly when they occur:
- stale content visible before a pending state appears
- a modal shell delayed by server verification instead of opening immediately
- action controls left interactable before required verification settles
- intermediate dashboard or library states flashing before hydration completes
- layout shifts caused by late subtitle or status text
- a visibility gate that can hang indefinitely because a retry chain or promise never settles

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

### Responsive persistence rule
For settings and similar durable preferences, prefer this model:
- confirmed server baseline
- immediate local projection of user intent
- dirty tracking for unconfirmed fields
- replay of dirty unconfirmed mutations after refresh

Do not rely on a debounce timer alone as the only protection for user intent.
Do not let cache become the confirmed baseline unless the server actually confirmed it.

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
