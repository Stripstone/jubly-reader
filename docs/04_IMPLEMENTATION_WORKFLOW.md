# Jubly Reader — Implementation Workflow

This document defines the required development loop for implementation work.

Use it whether the work is produced by OpenAI, Claude, or a human.

This workflow is subordinate to project policy. It cannot be used to justify a patch that violates `03_ARCHITECTURE_AND_GUARDRAILS.md`, `02_RUNTIME_CONTRACT.md`, `05_PRODUCT_LAUNCH_AND_INTEGRATION.md`, or `06_SUPABASE_SCHEMA_REFERENCE.md`.
Read `03_ARCHITECTURE_AND_GUARDRAILS.md` alongside this workflow when a pass touches scaffold shape, ownership cleanup, or prototype-to-production migration.

## Core workflow

### 0. Verify current scaffold and artifact reality
Before planning or editing:
- start from the latest accepted artifact or current runtime state
- unpack into a fresh clean workspace
- verify shape sentinels against current project state
- confirm the pass is not using a mixed-era scaffold by accident

If the base is wrong, discard the pass and restart from the correct state.

### 0.25 Structural compliance gate
Before judging whether a patch "works," confirm that it does not violate scaffold authority, file responsibility, ownership boundaries, or duplicate-truth rules.
If it does, the patch is disqualified even when runtime smoke testing looks good.

### 0.3 Pending-surface framework check
When a pass touches auth, billing, usage, restore, account hydration, library hydration, importer-capacity checks, or any other server-backed user-visible surface:
- read `pending-surfaces.md` alongside `02_RUNTIME_CONTRACT.md` and `05_PRODUCT_LAUNCH_AND_INTEGRATION.md` before coding
- treat mismatches between code, runtime, and `pending-surfaces.md` as a documentation or implementation discrepancy that must be resolved
- update `pending-surfaces.md` in the same pass when behavior changes

### 0.5 Schema-replacement sequencing rule
When a pass is replacing a drifted durable schema before launch:
1. rewrite the docs first
2. run the replacement SQL second
3. patch the code against that new schema third

Do not finalize a runtime continuity patch against a schema that is about to be retired.

### 1. Define one bounded pass
A pass should cover one coherent runtime-owned system or one contained follow-up inside that system.

### 2. Identify the owner layer
Use the architecture doc, guardrails, and runtime contract to decide where truth belongs.
Architecture and guardrails decide whether the patch is structurally legal before runtime validation decides whether the user experience is correct.

Rule:
- upstream authority first
- nearby regression scan second
- contained patching third

### 2.5 Perspective review gate
Before accepting a diagnosis, the developer must challenge the frame they are using.

In this project, "What are we not considering?" means perspective gaps, not only edge cases. The required question is not merely "what runtime path might break?" but also "what larger owner, architecture, or upstream standard could make this local diagnosis the wrong frame?"

Use this gate when:
- a symptom crosses more than one owner boundary
- the proposed fix starts downstream from the visible symptom
- the diagnosis assumes the current architecture is basically correct
- a mature outside standard may already exist for the problem
- the issue appears in boot, auth, sync, billing, TTS, importer/library hydration, theme/appearance, or other timing-sensitive areas
- a prior fix improved one symptom while creating redundancy, duplicate truth, or a new race

Required perspective prompts:
1. What frame am I currently using?
2. What would be true if this were an architecture/ownership failure instead of a local bug?
3. What upstream owner should decide the truth before this downstream surface renders?
4. What outside standard, vendor documentation, browser/platform norm, or mature-app pattern should challenge our current approach?
5. What adjacent functionality depends on the same sequence or truth projection?
6. What first writer or first visible release might be wrong before the symptom appears?
7. What would make this patch unnecessary because the real fix belongs upstream?

The developer must report:
- current diagnosis
- alternate architecture-level diagnosis
- owner that would change if the alternate diagnosis is true
- outside standard or upstream truth checked, when relevant
- why the chosen patch is still upstream-enough and not a downstream tweak

Common rejected reasoning:
- "this is still <nearby file> ownership" without proving higher-level owner boundaries
- "the patch works in the current code" without asking whether the current code shape is the problem
- "other sites/apps must have custom handling too" without checking established platform practice
- "we can fix the visible flash/state with a delay, CSS mask, or local tweak" before proving why the wrong state was allowed to exist or render
- "this monolith owns this because the code is already there" instead of identifying the rightful owner

If the perspective review reveals a plausible architecture or owner failure, stop implementation and reclassify the pass before coding. Do not continue downstream merely because the local patch is easy.

### 2.6 Architecture normalization gate
Do not implement new behavior on top of a non-standard, mutation-prone chain merely because the local patch is possible.

A chain is considered mutation-prone when behavior depends on overlapping writers, hidden order-of-execution assumptions, stale bridge code, fallback ownership, timing luck, or side effects spread across multiple files. These chains must be flagged before implementation because they create redundant patchwork and make invalid prior code look like a permanent foundation.

Trigger this gate when:
- the same bug class reappears in adjacent forms
- multiple files can write or infer the same truth
- a bridge, fallback, or diagnostic path has become a de facto owner
- the proposed fix requires understanding too many side effects before the visible symptom
- the current behavior relies on timing luck, cached state, auth order, hydration order, or async response order
- prior rejected or invalid code would remain underneath the new implementation
- the proposed patch would add behavior to a chain the team already distrusts
- the current chain differs from standard web/app practice and no one has justified why it should be custom

Scope guard: the perspective and normalization gates are required when owner ambiguity, repeated symptom patching, non-standard chains, or architecture-level risk exists; they must not be used to inflate clearly isolated, owner-contained fixes into broad architecture reviews.

When this gate triggers, the developer must pause normal implementation and produce an architecture-normalization note before coding. The note must answer:
1. What standard pattern should this area follow?
2. What part of the current chain is non-standard or mutation-prone?
3. Which file or layer should own the truth?
4. Which files or layers should only reflect, adapt, or transport that truth?
5. Which old bridges, fallbacks, duplicate writers, or downstream patches become unnecessary after normalization?
6. What behavior must be preserved while normalizing?
7. What downstream cleanup is safe only after the owner chain is normalized?

The normalization note must end with a concrete disposition: proceed with the original bounded patch, instrument first, reclassify to an architecture normalization pass, or block pending clarification/owner decision. It must not end as open-ended analysis.

Allowed outcomes:
- continue with the original patch only if the chain is standard enough and the owner is still correct
- reclassify the work as an architecture normalization pass
- instrument first if the first writer or rightful owner is still unknown
- block the feature or bug patch until the chain is normalized

Architecture normalization is a valid implementation outcome. A pass that removes duplicate writers, retires fallback ownership, clarifies first writers, or aligns a flow with a standard pattern should be treated as progress even when it does not add user-visible features.

Rejected reasoning:
- "the code already works this way, so we should patch here"
- "this file is large, so it must own the behavior"
- "we can fix the symptom faster downstream"
- "the current chain is ugly, but changing it is out of scope" when that chain is the reason the bug exists
- "the previous patch is close, so build on it" when that patch was never accepted as the base

Use the status `Blocked pending architecture normalization` when a behavior patch would otherwise be built on a chain that is not fit to extend.

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

### 3.25 Careful development rule
When implementation work encounters a discrepancy between:
- active documentation
- canonical SQL or schema
- runtime behavior
- diagnostics
- accepted prior patches

the developer must stop and flag the discrepancy before continuing if it could change:
- ownership
- entitlement truth
- persistence truth
- runtime gating
- scaffold authority
- accepted base assumptions

Do not pick the most likely meaning and continue coding.
Do not normalize conflicting terms into a local convenience interpretation.
Do not produce a patch that silently resolves ambiguity by mutation.

Required best practice in this project is:
- stop
- state the discrepancy clearly
- identify the affected owner, path, or field
- request clarification or escalation
- resume only after the discrepancy is resolved or the pass is explicitly re-scoped

A developer is expected to be careful, not merely productive.
A patch that works by mutating unresolved truth is not a successful patch.

### 3.3 Mutation prevention rule
Treat any of the following as a stop signal:
- two fields appear to represent the same truth
- user-facing terminology and durable terminology differ
- SQL and active docs define different canonical values
- a fix requires a layer to temporarily own truth that it does not normally own
- a patch only works when compared against an older or mixed base
- runtime truth and diagnostics disagree in a way that changes implementation meaning

When one of these appears, do not continue implementation until it is flagged.

### 3.5 Responsiveness-first interaction rules
When a pass touches a user-visible transition, apply these rules by default:
- render the safe pending or hidden state before any await that could stall the visible surface
- open modal shells immediately when local knowledge is enough to present them safely
- keep gated action buttons locked until server-backed checks settle instead of delaying the whole surface
- gate account-backed rendering on explicit hydration or confirmation seams, not inferred readiness
- when using cache for responsiveness, treat it as projection only
- reserve layout space when late hydration text would otherwise shake the page

For server-backed or hydration-backed user surfaces, these rules are not complete until the pass also remains aligned with `pending-surfaces.md`.

### 4. Create one canonical patch artifact
The default deliverable for an implementation pass is one scoped `.diff` file.

Rules:
- one bounded pass = one canonical diff
- revise that same diff in place after runtime feedback
- do not stack forward diffs for the same pass
- produce a `.zip` only when new files or assets make that necessary
- if new files are introduced, apply the current version-marker rule for the target artifact

### 5. Runtime test
Served runtime results decide runtime status only after the structural compliance gate passes.
Do not mark behavior fixed from code inspection alone.
Do not mark a patch acceptable merely because runtime looks good if the patch is structurally non-compliant.

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

Do not mark behavior acceptable merely because it corrected itself later.

### 5.1 Runtime evidence harnesses
Manual visual runtime testing is not sufficient for fast transitions, auth/session projection, shell boot settlement, billing redirects, or TTS state races when the user-visible state can change too quickly to observe reliably.

When a runtime issue depends on live browser/session behavior, prefer a dev-only validation harness or diagnostic probe that runs inside the user's browser or staging environment and emits a structured report.

Use this path when:
- visual interpretation is slow, ambiguous, or timing-sensitive
- the issue involves auth, sync, entitlement, checkout, runtime policy, TTS route, shell boot release, or public/signed-out projection
- a simulated local test is useful but not equivalent to deployed credentialed validation
- a reviewer needs to evaluate runtime truth without operating the browser manually

Harness rules:
- probes must be dev-only, diagnostics-only, or behind an existing devtools gate
- probes must not become product behavior, durable state, or a second owner of runtime truth
- probes must not require credentials to be pasted into chat or committed to code
- credentialed execution should happen in the user's browser, local machine, staging environment, or CI secrets controlled by the project owner
- the report should be copyable JSON or plain text, not only screenshots
- the report must identify the runtime state owner and the exact transition being validated
- remove the probe after proof is collected unless it is accepted as a durable devtools-only diagnostic surface

A runtime evidence report should include, when relevant:
- artifact or deployed build identifier
- current route/surface and selected section
- auth user present or absent
- entitlement tier and source
- runtime policy route, cloud capability, and policy source/reason
- session voice selection present or absent
- pending/staged/snapshot projection state
- visible badges or gated controls present or absent
- boot release reason, relative timestamps, and settlement state
- user-visible pending/error surface state
- expected state for the transition and actual state observed

For credentialed browser validation, the preferred flow is:
1. create or use a private staging test account controlled by the project owner
2. keep it non-admin, disposable, and free of production customer data
3. execute the login/logout/checkout/TTS flow in the real browser or staging CI
4. export the structured harness report
5. review the report against owner boundaries and runtime expectations
6. only then mark the behavior runtime-accepted or reclassify the failing owner

Do not close a live-session bug solely from simulated auth objects if the original failure involved deployed auth, sync, redirect, cookie, local storage, or runtime policy projection behavior. Simulations may make a patch runtime-testable, but the live harness report is the acceptance evidence.

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
- confirmed server baseline when the setting is actually durable
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
- do not treat scaffold changes as harmless file moves
- do not accept "good enough because it works" as a patch rationale
- do not let runtime comfort override structural disqualification

## Deliverables policy
Every patch handoff should return:
1. exact files changed
2. exact behavior change
3. main regression risk
4. concise runtime validation path
5. structural compliance verdict against `03_ARCHITECTURE_AND_GUARDRAILS.md`
6. any explicit temporary debt still present, with owner and retirement condition

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

## Diff and git appendix

### Canonical diff lifecycle
For one active pass:
- create one canonical diff
- runtime-test it
- revise that same diff in place after feedback
- do not stack forward diffs for the same pass
- start a new diff only when the work becomes a new pass

### Repo entry
```bat
cd C:\Users\Triston Barker\Documents\GitHub\jubly-reader\
```

### Check state before patching
```bat
git status
```

Before editing, also verify:
- root `index.html` exists
- root `js/` exists
- root `css/` exists if current docs expect it
- `docs/` contains docs only

### Export a scoped diff
```bat
git diff -- <file1> <file2> <file3> > quick_patch.diff
```

Example:
```bat
git diff -- index.html css/shell.css js/evaluation.js js/shell.js > quick_patch.diff
```

### Validate the diff
```bat
git apply --check quick_patch.diff
```

### Open the diff
```bat
notepad quick_patch.diff
```

### Standard review block
```bat
cd C:\Users\Triston Barker\Documents\GitHub\jubly-reader\
git status
git diff -- <file1> <file2> <file3> > quick_patch.diff
git apply --check quick_patch.diff
notepad quick_patch.diff
```

### Show changed file names only
```bat
git diff --name-only
```

### Stage only pass files
```bat
git add <file1> <file2> <file3>
```

### Commit
```bat
git commit -m "Polish reading playback follow-up"
```

### Show latest commit
```bat
git log --oneline -1
```

### Export the last commit
```bat
git show --stat --patch HEAD > last-commit.txt
```

### Compare current branch against main
```bat
git diff main...HEAD > branch-vs-main.diff
```
