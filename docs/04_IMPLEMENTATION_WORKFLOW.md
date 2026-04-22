# Jubly Reader — Implementation Workflow

Required loop for implementation work by OpenAI, Claude, or humans.

This workflow is subordinate to project policy. It cannot justify a patch that violates `02_RUNTIME_CONTRACT.md`, `03_ARCHITECTURE_AND_GUARDRAILS.md`, `05_PRODUCT_LAUNCH_AND_INTEGRATION.md`, `06_SUPABASE_SCHEMA_REFERENCE.md`, `pending-surfaces.md`, or the runtime protection ledger.

## 1. Operating loop

1. Start from the latest accepted base.
2. Verify scaffold/root shape.
3. Define one bounded objective.
4. Identify the rightful owner and preserved behavior.
5. Assign risk level.
6. Decide whether proof, perspective review, or normalization comes before code.
7. Produce one scoped patch artifact.
8. Validate structure before runtime comfort.
9. Test at the matching evidence level.
10. Accept, reclassify, or reject.
11. Record the next working base.

Central rule: **test broadly, patch narrowly.**

## 2. Base and scaffold gate

Before editing:
- unpack a fresh clean workspace from the accepted artifact/current accepted runtime state
- verify root `index.html`, root `js/`, root `css/` when expected, and `docs/` shape
- confirm the pass is not using a rejected candidate, stale lane, or mixed-era scaffold as its base

Wrong base invalidates the pass. Discard and restart; do not fix forward from an invalid foundation.

Prior rejected diffs and old candidates are evidence only, not foundations.

## 3. Bounded pass and owner gate

Every pass must state:
- objective
- accepted base
- files in scope and out of scope
- rightful truth owner
- behavior that must remain untouched

Owner order:
1. upstream authority
2. first writer / first visible release
3. nearby regression scan
4. contained patch

Do not patch reflection when the truth owner is wrong. Do not let shell, cache, diagnostics, bridges, or fallbacks become accidental owners.

### Pending-surface gate

When a pass touches auth, billing, usage, restore, account hydration, library hydration, importer capacity, checkout, or any server-backed user-visible surface, review `pending-surfaces.md` before coding.

If behavior changes a documented pending, settled, blocked, or error surface, update `pending-surfaces.md` in the same pass.

Do not invent new loading copy, disabled states, banners, or filler behavior when a documented pending surface already owns that state.

## 4. Risk levels

Declare risk before code.

**Green:** isolated copy/layout/CSS; no runtime truth, async ownership, or persistence.

**Yellow:** one owner file; bounded state/UI behavior; no fragile sequencing or cross-owner truth projection.

**Red:** auth, sync, public policy, billing, checkout, durable persistence, boot release, TTS, page/progress truth, external services, live session behavior, or any distrusted mutation chain.

Red work requires a runtime-path table or explicit instrumentation-first decision.

## 5. Perspective and normalization gates

Use these gates only for owner ambiguity, repeated symptom patching, non-standard chains, or architecture-level risk. Do not inflate clearly isolated owner-contained fixes into broad reviews.

### Perspective review

Use when the diagnosis may be trapped in the current code shape. Ask:
- What frame are we assuming?
- What upstream owner or outside standard could make this diagnosis wrong?
- What first writer or first visible release happens before the symptom?
- What adjacent behavior depends on the same truth or sequence?
- Would normalization make this patch unnecessary?

End with one disposition: proceed with bounded patch, instrument first, reclassify to normalization, or block pending owner clarification.

### Architecture normalization

Do not implement new behavior on top of a non-standard, mutation-prone chain just because the local patch is possible.

Trigger when multiple files write/infer the same truth, stale bridges own behavior, timing luck matters, invalid prior code remains underneath, or the chain differs from standard web/app practice without justification.

A normalization note must identify:
- intended standard pattern
- rightful owner and reflector/adapter layers
- duplicate writers/bridges/fallbacks to retire
- preserved behavior
- downstream cleanup that becomes safe only after normalization

Use status: `Blocked pending architecture normalization`.


### Stabilization before cleanup/replacement

When architecture normalization creates a contract-backed replacement path, do not treat patch-forward growth as the destination.
First prove the contract at runtime; then authorize cleanup or replacement as a separate bounded pass.

Cleanup/replacement passes must:
- preserve accepted behavior
- remove or compact obsolete bridges only after replacements are proven
- avoid new behavior unless separately approved
- keep owner boundaries intact
- state module boundaries and retirement conditions

## 6. Proof before code

Instrument before patching when the owner path is ambiguous, runtime contradicts code confidence, races/stale async responses are plausible, or external provider/schema/deployment truth may be involved.

Diagnostics must be narrow, removable, and aimed at proving one failing path end-to-end. Remove probes after proof unless accepted as devtools-only diagnostics.

When replacing or correcting durable schema before launch, update the schema docs first, apply the SQL/schema change second, then patch code against that accepted schema. Do not finalize runtime continuity code against a schema that is about to be retired.

## 7. Red-lane runtime-path table

Before coding red work, cover:
- happy path
- not-ready/pending path
- cancel/exit path
- stale/late async result
- route/account/session switch
- failure/recovery
- preserved behaviors
- diagnostics or harness needed

This is a checkpoint tool, not routine message format.

## 8. Patch artifact rules

Default deliverable: one scoped `.diff`.

Rules:
- one bounded pass = one canonical diff
- revise the same diff within the same pass
- do not stack forward diffs for the same pass
- do not mix unrelated cleanup into behavior work
- do not widen owner scope without reclassification
- produce a zip only when delivery/new files/assets require it

A patch can appear to work and still be rejected for wrong base, wrong owner, duplicate truth, scaffold drift, or structural violation.

## 9. Runtime test and acceptance protocol

Use the full protocol only at decision checkpoints: before red-risk coding, after meaningful runtime results, on failure, on owner ambiguity, before base promotion, or before closure.

For green updates, use the shortest natural message that still states result, owner, and next action.

Evidence levels:
1. **Surface observation** — user-visible behavior.
2. **Diagnostics** — runtime state snapshot.
3. **Harness/probe** — structured report for timing/async/ownership issues.
4. **Live credentialed validation** — required for real auth/session/sync/deployment bugs.

Do not close a live-session bug from simulated objects when the original failure involved deployed auth, sync, redirect, cookie, local storage, or runtime policy projection.

Decision-result format:
- Result:
- Classification:
- Likely owner:
- Continue or stop:
- Next test or patch target:

Classifications: pass, pass with watch, fail/blocker, diagnostics gap, wrong-owner suspicion.

Harnesses must be dev-only/diagnostics-only, copyable, scoped to the owner under test, and must not require credentials in chat or become product behavior, durable state, or a second truth owner.

For user-visible transitions, prefer an honest pending state over hiding, freezing, or rendering a believable wrong final state. A visible surface must be final, or explicitly pending/blocked with owner and reason. Do not use arbitrary waits, CSS masks, or disabled controls as substitutes for owner readiness.

### Dashboard/library release settlement

When signed-in dashboard release depends on library/importer hydration, treat release as a surface transaction, not a direct `showSection('dashboard')` reveal. Start refresh/login settlement while the dashboard remains behind the boot/settlement boundary.

Release rules:
- If `populated`, `empty`, or `error` owner truth resolves inside the quick settlement threshold, release dashboard directly in that final visible state.
- If final truth has not resolved by the threshold, release a neutral signed-in pending dashboard/library surface with owner/reason.
- Once neutral pending is shown, keep it visible for a minimum readable duration before replacing it with final truth, so the first visible frame is not a flicker.
- If owner truth resolves `empty`, show library-empty/import guidance only after empty truth plus the documented empty grace.

This threshold/grace is allowed only as a documented release transaction. It must not become arbitrary delay, CSS masking, or a substitute for owner truth. Shell owns the release/presentation decision; library/import owners still own book/import truth.

## 10. Stop signals

Stop and reclassify when evidence suggests:
- public state inherits private/account capability
- stale async result controls a newer route/session
- passive observation writes authoritative state
- active runtime state lacks honest owner data or pending/error surface
- presentation masking is proposed before proving the surface should exist
- docs, schema, diagnostics, external truth, and runtime disagree on the same value

## 11. Watch, blocker, backlog, debt

Use precise buckets:
- **Blocker:** violates owner boundary, protected behavior, safety, or acceptance requirement.
- **Watch:** acceptable for this pass; needs owner and retirement condition.
- **Backlog:** real issue outside this pass.
- **Accepted debt:** temporary state explicitly allowed with owner and retirement condition.

## 12. Preserve suite

Each accepted base should maintain a short preserve suite: behavior future patches must not regress.

A patch must state which preserve items it touches, avoids, or requires runtime validation for. Keep preserve suites short and principle-focused; lane-specific lists belong in notes or appendices.

## 13. Deliverables and status

Every handoff should include:
1. base artifact
2. files changed
3. behavior changed and preserved
4. main regression risk
5. validation performed
6. structural compliance verdict
7. runtime evidence level or validation path
8. temporary debt, with owner and retirement condition
9. next working base decision

Valid statuses: investigating, instrumenting, structurally acceptable, runtime-testable, runtime accepted, rejected wrong-base, rejected wrong-owner, rejected overbroad, rejected insufficient simulation, blocked pending architecture normalization, closed.

## 14. Reclassify or stop

Reclassify when the owner was wrong, the base invalid, the patch is downstream symptom relief, revisions are not shrinking failure surface, a bridge/fallback would become permanent owner, or external truth must be verified first.

When in doubt, prefer a smaller proof pass over a broader behavior patch.

## 15. Minimal diff commands

```bat
cd C:\Users\Triston Barker\Documents\GitHub\jubly-reader\
git status
git diff -- <file1> <file2> > patch.diff
git apply --check patch.diff
git diff --name-only
```

Before exporting, confirm root shape and file scope. Stage only files in the accepted pass.
