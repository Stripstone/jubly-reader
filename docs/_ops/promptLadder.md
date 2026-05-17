# Documentation Alignment Prompt Ladder
- Use this when a station’s patch notes or deliverable appear misaligned with documented process. The goal is to make them return to the docs and self-correct, not to give them the answer.

'' Central prompts = make leadership classify before directing.
'' Engineer prompts = make stations self-correct before patching.

-----------------------------------------------------------------------------------------------------------------

1. Central Engineer
 - Use these to make Central reassess against the docs before assigning work, accepting artifacts, or continuing patch-forward development.

## Multiple lanes idle

Multiple lanes appear to be idle.

Before assigning or withholding work, please review the documented workflow for lane pacing, bounded slices, validation work, and integration-risk work.

Then reassess the team state and explain which stations have useful bounded work available right now, and which are intentionally idle with reason.

## Same lane fails runtime multiple times

This lane has failed runtime multiple times.

Before assigning another patch, please assess which documented process highlights the current failure points and how that process redirects the work toward the documented architectural result.

Decide whether the lane should continue, pause, split, or be reclassified before more patching.

## Deliverable has red flags

This deliverable appears to have multiple documented-process red flags.

Before directing the engineers, review the relevant docs and classify the central decision required. Do not prescribe fixes until the gate and artifact status are clear.


-----------------------------------------------------------------------------------------------------------------


2. ## ## ## ## Engineers
- Use these to redirect engineers back to the docs before they claim readiness, accept artifacts, or continue failure patterns during complex patch efforts.

---
## Patch Attempt 1 — Overconfidence Detected
- Use when the handoff sounds too confident, claims readiness too early, or treats an unproven patch as runtime-ready.

I noticed a documentation item that your work may not align with.

Before moving forward, please review the relevant documented process and decide whether this is actually ready for runtime testing.

---
## Patch Attempt 2 — Selective Reading / Ignored Documentation
- Use when they appear to have missed or selectively read the relevant documentation. Review the docs yourself, but do not give them the answer.

Not accepted.

This still appears misaligned with the documented process in [insert doc / section].

Please revisit that documentation and explain what needs to change before this can proceed.

---
## Patch Attempt 3 — Process Failure
- Use when there is repeated procedural failure, wrong artifact status, wrong base, wrong owner scope, or another disconnect that makes continued patching unsafe.

Process hold.

Do not produce another patch yet. First identify which documented gate failed, what artifact/status this work actually has, and what corrected deliverable shape is appropriate.

