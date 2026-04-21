# Documentation Alignment Prompt Ladder
 - Use this when a station’s patch notes or deliverable appear misaligned with documented process. The goal is to make them return to the docs and self-correct, not to give them the answer.

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