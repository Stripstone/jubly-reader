# Claude Development Loop

This is a working-method note for Claude Code.

It is useful to reference during development, but it is **not** an authority document.
If it conflicts with the core package, the core package wins.

## What this document is for
Use this loop for **large bounded work**, not endless micro-correction.

Recommended model:
1. use Claude for the first bounded pass or passes to identify the owner layer and build the initial patch artifact
2. usually after 1–2 bounded passes, or once the owner layer and patch artifact are stable, switch to **diff-driven runtime cleanup**
3. keep revising the same diff artifact until the pass is cleared, unless runtime proves the owner layer was wrong

Claude should not stay in broad implementation mode after a pass has narrowed into correction, feel, or cleanup inside an already confirmed scope.

## Before a Claude pass
Before a large Claude pass is requested:
1. confirm the current runtime behavior first
2. runtime-test enough to identify the real user failure
3. describe the failure in user terms
4. define the pass using runtime success and failure conditions

If backlog or project-state docs may be behind the actual build, confirm behavior before assuming an issue is still open or unvalidated.
Do not send Claude a large pass based only on code suspicion, stale backlog state, or architectural preference.

## Core working set
Claude should usually work from:
- `04_EXECUTION_BACKLOG.md`
- `02_RUNTIME_CONTRACT.md`
- `03_ARCHITECTURE_MAP.md`
- `05_LAUNCH_AND_INTEGRATION.md`

Use `01_PROJECT_STATE.md` when current repo shape matters.

## Required pre-patch contract
Before coding, Claude should state:
1. objective
2. files in scope
3. files out of scope
4. runtime behaviors this pass must satisfy
5. behaviors assumed already correct
6. exact runtime checks that would prove those assumptions wrong
7. what outcomes would count as pass failure

A pass should not start without this contract.

## Working loop for a large Claude pass
1. Take one high-yield vertical system only.
2. State the user-visible target before changing code.
3. Name the owner file before changing code.
4. Patch narrowly within that system.
5. Leave layout alone unless the issue is the layout.
6. After patching, state what changed, what risk area was touched, and what should be runtime-tested.

## Authority-first pass design
For launch-critical issues, use this order:
1. identify the upstream runtime authority or truth model first
2. scan nearby regression paths that read, write, mirror, or infer that same truth
3. patch downstream only after the authority model and nearby regression surface are explicit

This is meant to prevent narrow local fixes from landing on the wrong layer.
A pass should not solve one downstream symptom while leaving adjacent authority paths untouched.

### What counts as nearby regression scan
Before coding, Claude should name the adjacent paths that could regress if the authority model is incomplete, especially:
- other entry paths that choose the same runtime target
- restore, restart, autoplay, skip, or resume paths touching the same truth
- source or chapter replacement paths touching the same truth
- shell bridges or inference helpers that still mirror or guess that truth

This is not a license for broad cleanup.
It is a bounded scan to keep a high-yield pass from fixing one path while missing an adjacent regression path.

## Proof discipline for launch-critical passes
For launch-critical runtime bugs, do not patch from partial confidence.

Use this proof ladder:
1. confirm the user-visible runtime symptom in the served app
2. narrow the owner path before code
3. if the owner path is still ambiguous, add temporary diagnostics
4. prove one failing case end-to-end
5. patch only after the last unresolved owner-path fork is closed
6. remove temporary diagnostics in the same resolving pass
7. re-validate in the served app

Do not treat a narrowed hypothesis as a patch target.
Do not patch because the code "looks likely."
Do not stop at end-state diagnostics if the decision path is still unclear.

## Diagnostics policy
When the owner path is ambiguous, use temporary diagnostics before patching.

Diagnostics should prove one failing case end-to-end, including:
- what the user selected
- what runtime state resolved from that selection
- what source or raw content was passed forward
- what render or update path actually fired
- whether a second competing path also fired

Diagnostics should be:
- minimal
- placed at the actual decision points
- removed after capture or in the resolving patch

Do not expand diagnostics into generalized tracing unless the pass specifically requires it.
End-state diagnostics alone are not enough if they do not explain how the app got there.

## When to stop using Claude for direct implementation
Usually after 1–2 bounded implementation passes, stop using Claude for repeated broad rewrites if:
- the owner layer is already confirmed
- the active pass already has one patch artifact
- runtime feedback is now about correction, refinement, or one remaining behavior
- the pass is no longer discovering new architecture truth

At that point, switch to **diff-driven runtime cleanup**.
The real trigger is not pass count alone. It is that the owner layer is already known, the patch artifact is stable, and the remaining work is runtime-guided cleanup rather than discovery.

## Diff-driven runtime cleanup loop
Use this mode when:
- the owner path is already known
- the active pass is still the same pass
- there is already one named diff artifact
- runtime feedback is coming from the served app
- the next move is to revise the patch, not reopen architecture

Rules:
1. keep one named diff artifact per active pass
2. prefer pass-specific filenames when practical, and keep the filename stable while it remains the same pass
3. revise that diff in place after runtime feedback
4. keep file scope the same unless runtime proves another owner file is required
5. describe runtime feedback in product terms first
6. only give micro implementation direction when the behavior is already localized and the owner layer is confirmed
7. do not convert a follow-up correction into a new broad Claude implementation pass
8. run `git apply --check` on the revised diff before handing it off or runtime-testing it

This mode is for cleanup, correction, and feel.
It is not a substitute for authority-first investigation when the owner layer is still unclear.

## When to leave diff-driven cleanup
Leave diff-driven cleanup and reopen a larger pass if runtime shows:
- the owner layer was wrong
- multiple files outside current scope clearly own the remaining issue
- the current diff is patching symptoms instead of authority
- repeated revisions are no longer reducing the failure surface

## What a diff handoff must include
Every active diff handoff should say:
- current objective
- files in scope
- passed areas
- failed areas
- exact diff filename in play
- whether the diff is cumulative or follow-up
- latest runtime caveat, if any

## Token-efficiency and handoff rules
To reduce drift and wasted context:
- keep the pass vertically bounded to one runtime-owned system
- prefer one bounded proof pass before code
- use the minimum logs needed for one failing case
- do not reopen already validated systems in a new pass
- review only touched files and touched diffs whenever possible
- when nearing usage limits, stop and return only:
  1. current proof state
  2. current owner path
  3. exact remaining patch or runtime-test steps
- restart from a compressed handoff rather than continuing broad archaeology in a long drifting thread

## Post-pass closure
A pass is not closed at "runtime seems fixed."

Closure means:
- backlog status updated
- project state updated
- short acceptance note written
- adjacent regression sweep noted
- next pass selected only after status lock

Validated work should not remain open in docs after acceptance.

## What user feedback should look like
The owner should report:
- what felt wrong as a user
- what now feels right or still wrong
- macro behavior first

Micro implementation suggestions are acceptable only when:
- the owner layer is already known
- the issue is already localized
- the suggestion stays inside the confirmed scope
- the suggestion does not move runtime truth into shell or widen the pass

## When Claude should push back
Claude should say the docs and the request do not align when:
- the request would move runtime truth into shell
- the request would make the shell guess state
- the request conflicts with the runtime contract
- the request would likely regress a launch-critical fix

## What to send back for product/doc review
Send back to product/doc review only when:
- expected behavior is unclear
- two docs disagree
- the user expectation has changed
- a requested behavior is better than the current documented contract

## Patch-safety rules
- Do not remove a shell bridge until the runtime replacement exists.
- Do not rewrite shell and runtime behavior in one pass unless the objective itself spans both.
- Do not mark behavior fixed based on code inspection alone.
- Validate in the served app, not just under `file://`.
