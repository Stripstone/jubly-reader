# Jubly Reader — Policy Compliance Reconciliation Assessment

Adjusted against the hardened authority package before build-compliance review.

Target artifact: `jubly-reader_auditCompliance.zip`

Assessment basis:
- `docs/00_README.md`
- `docs/03_ARCHITECTURE_AND_GUARDRAILS.md`
- `docs/05_PRODUCT_LAUNCH_AND_INTEGRATION.md`
- `docs/06_SUPABASE_SCHEMA_REFERENCE.md`
- `docs/app_tables_canonical.sql`
- current runtime notes already captured in the earlier audit context

## Decision

**Assessment outcome: 2**

This build remains **non-compliant on structural grounds**.
Under the hardened authority, this is not merely “concerning architecture with some useful behavior.” It is a build with **multiple grouped disqualifying breaches** across shell/entry ownership, runtime authority, durable-settings authority, and legacy/devtools override surfaces.

Under `docs/00_README.md` and `docs/03_ARCHITECTURE_AND_GUARDRAILS.md`, a patch that violates scaffold authority, ownership boundaries, or duplicate-truth rules must be rejected even if runtime behavior appears to work.

## Why this is still a “2” and not a “1”

The breach pattern is repeated, not isolated:
- shell/entry convenience code still acts as a behavior owner
- fixed runtime behavior is still routed through legacy setting gates
- retired/local-only fields still flow through durable-sync and devtools settings paths
- server durable canonicalization still preserves fields the docs now explicitly ban from durable truth
- legacy/prototype settings remain active enough to reintroduce drift after later passes

That is a grouped compliance failure, not a narrow bug lane.

## Audit interpretation under hardened authority

The older audit was directionally correct, but this adjusted version sharpens two things:

1. **Structural compliance now disqualifies before runtime comfort is judged.**
   The build does not get credit for “working” if it works from the wrong owner, wrong file, or wrong persistence surface.

2. **The crown-jewel server move should be preserved while compliance is reconciled.**
   The backend content/AI/prompt/usage direction is not the part to roll back. The reconciliation target is the ownership drift around it.

## Functionality that must survive reconciliation

This section remains explicit so another engineer can preserve healthy work while removing the non-compliant ownership around it.

### 1. Server-relocated crown-jewel content processing must survive

Keep and protect:
- `/api/content?action=page-break`
- `/api/content?action=book-import`
- `server/lib/content-page-break.js`
- `server/lib/content-page-break-core.js`
- `server/lib/content-book-import.js`
- `js/import.js` as caller/consumer of server page-break results

What survives:
- page-break orchestration stays server-owned
- importer conversion and crown-jewel content handling stay off the visible client
- the browser remains requester/consumer, not owner of the protected algorithm

What must not be reopened during reconciliation:
- page-break core redesign
- checked-marker interpretation redesign
- importer pagination rule redesign

### 2. Server-relocated AI / cloud TTS / prompt surfaces must survive

Keep and protect:
- `/api/ai?action=anchors|evaluate|summary|tts`
- `server/lib/ai-anchors.js`
- `server/lib/ai-evaluate.js`
- `server/lib/ai-summary.js`
- `server/lib/ai-tts.js`
- `server/prompts/*`

What survives:
- prompt-bearing AI work stays server-side
- cloud TTS routing and provider policy stay server-side
- visible client files remain caller / renderer surfaces, not prompt owners

What must not happen in reconciliation:
- no prompt migration back into visible client files
- no restoration of client-owned grading / anchor generation / cloud voice policy

### 3. Server-owned usage / entitlement / import-capacity checks must survive

Keep and protect:
- `/api/app?kind=runtime-config|usage-check|usage-consume|import-capacity|durable-sync`
- `server/lib/app-usage-check.js`
- `server/lib/app-usage-consume.js`
- `server/lib/app-import-capacity.js`
- server-owned billing/session routes already in place

What survives:
- entitlement, usage, and import-capacity policy remain server-owned
- the browser must not become authority for protected-action eligibility

### 4. Durable sync foundation survives, but its retired-field map does not

Keep and protect:
- backend durable snapshot / restore seam
- continuity direction for progress, sessions, library, and entitlements

What does **not** survive unchanged:
- durable treatment of `appearance_mode`
- durable treatment of `tts_speed`
- durable treatment of `use_source_page_numbers`
- any durable or devtools-controlled path that can override fixed runtime page-number behavior

### 5. Verified importer/runtime anchors survive as behavior targets

The earlier audit’s preservation targets remain valid:
- the validated 311-page importer anchor for the benchmark EPUB remains protected
- Next/autoplay, last-page detection, importer settle honesty, and Explorer-only lag reduction remain valid behavior targets

These survive as **behavior targets** only. They do not justify preserving the wrong owners currently approximating them.

## Current grouped breaches

### Group A — Shell / entry surface is still owning behavior it should not own

**Policy conflict:** `docs/03_ARCHITECTURE_AND_GUARDRAILS.md` defines shell as presenter / intent-forwarder only and treats scaffold/owner breaches as disqualifying.

Current build concerns:
- `index.html` still contains inline appearance bootstrap logic that reads local state and applies appearance classes before runtime becomes the sole owner.
- Specifically, `index.html` reads `rc_appearance_prefs` / cookie state and applies `app-light` / `app-dark` classes directly in the shell entry surface.
- This means the shell entry is not just presenting structure; it is performing behavior/state application.

Why this matters:
- hardened authority now treats this as a structural owner breach, not a harmless startup convenience
- runtime acceptance cannot legalize a shell-entry behavior owner

### Group B — Fixed runtime behavior is still preference-gated by legacy settings

**Policy conflict:** `docs/02_RUNTIME_CONTRACT.md` and `docs/03_ARCHITECTURE_AND_GUARDRAILS.md` now define page-number behavior as fixed runtime truth, not a configurable behavior.

Current build concerns:
- `js/state.js` still defines `usesSourcePageNumbers()` and returns `prefs?.use_source_page_numbers !== false`
- that leaves page numbering under a preference gate even though the docs now define source/actual numbering as fixed runtime behavior when metadata exists

Why this matters:
- this is no longer just stale preference plumbing
- it is a direct conflict with finalized documentation intent

### Group C — Retired / local-only fields are still active in durable-sync client paths

**Policy conflict:** `docs/00_README.md`, `docs/05_PRODUCT_LAUNCH_AND_INTEGRATION.md`, and `docs/06_SUPABASE_SCHEMA_REFERENCE.md` remove `appearance_mode`, `tts_speed`, and `use_source_page_numbers` from durable settings truth.

Current build concerns:
- `js/sync.js` still sends `tts_speed` in the settings row and still rehydrates `tts_speed` back into the live shell speed control
- `js/devtools.js` still sends and displays:
  - `appearance_mode`
  - `tts_speed`
  - `use_source_page_numbers`
- this makes retired or local-only fields look like active product truth again

Why this matters:
- duplicate truth remains alive across runtime, sync, and devtools
- later patches can silently resurrect behavior the docs now explicitly retire

### Group D — Server durable canonicalization is part of the breach cluster

**Policy conflict:** `docs/06_SUPABASE_SCHEMA_REFERENCE.md` and `docs/app_tables_canonical.sql` explicitly exclude `appearance_mode`, `tts_speed`, and `use_source_page_numbers` from canonical durable settings authority.

Current build concerns:
- `server/lib/app-durable-sync.js` still canonicalizes:
  - `tts_speed`
  - `use_source_page_numbers`
  - `appearance_mode`
- `server/lib/app-dev-tools.js` still canonicalizes the same retired fields

Why this matters:
- the backend content/AI protection direction is still healthy and should be preserved
- but backend durable-settings canonicalization is **not** cleanly aligned with the hardened docs
- this is no longer only “client drift”; it is also a schema-policy breach

### Group E — Legacy/devtools paths remain active enough to reintroduce ownership drift

**Policy conflict:** `docs/03_ARCHITECTURE_AND_GUARDRAILS.md` forbids retired gates from remaining as live runtime authority surfaces.

Current build concerns:
- devtools still exposes source-page toggle behavior as if it were a valid active setting
- devtools still exposes appearance and TTS speed as settings-row authorities rather than keeping them in their proper local/runtime-only lanes
- those tools are not isolated enough from live product truth

Why this matters:
- even if a single runtime lane looks fixed, stale authority surfaces can take it back later
- that is exactly the debt pattern the hardened docs are meant to stop

## Areas that are healthier / should not be rolled back

### Backend content / AI / prompt protection direction is still correct

This remains the main “preserve” conclusion from the older audit.

The server/api family is **not** the main source of non-compliance in these crown-jewel lanes:
- server-owned content conversion and page-break routing
- server-owned prompt files
- server-owned AI dispatch
- server-owned billing / usage / entitlement policy

These should remain intact during reconciliation.

### Important refinement

The backend is not fully outside the breach cluster.

What is healthy:
- protected content/AI/prompt/usage routing direction

What is not healthy:
- backend durable-settings canonicalizers still preserving retired fields

So the correct interpretation is:
- **preserve backend crown-jewel protection**
- **reconcile backend durable-settings ownership drift**

## Reconciliation strategy

Because this is a **2**, the patch plan must remain **broad and directive**.

### Directive 1 — Re-establish clean ownership boundaries before fixing runtime symptoms

Do not start by “making the current behavior work again.”
First restore the owner map:
- `index.html` = shell entry only
- shell = presentation and intent forwarding only
- runtime = reading behavior, page-number behavior, appearance application, playback truth, restore application
- sync/durable layer = durable account/progress/session/library truth only where docs still allow it
- server routes = protected logic, policy, and durable seams

### Directive 2 — Preserve the crown-jewel server move while removing client and sync convenience owners

Keep and protect:
- `/api/content?action=page-break`
- `/api/content?action=book-import`
- `/api/ai?action=anchors|evaluate|summary|tts`
- `/api/app?kind=runtime-config|usage-check|usage-consume|import-capacity|durable-sync`

Remove or re-home:
- shell/bootstrap logic that directly restores or applies behavior outside runtime ownership
- retired settings flowing through sync/devtools/server canonicalizers
- duplicate truth that overrides fixed runtime behavior later

### Directive 3 — Remove shell/entry behavior ownership

Corrective direction:
- remove behavior-restoring/bootstrap logic from `index.html`
- keep any startup smoothness mechanism only if it is explicitly documented as a thin bridge and retired immediately after runtime ownership is restored
- shell remains presenter / bridge only

### Directive 4 — Collapse duplicate state owners and retire forbidden fields from active paths

Corrective direction:
- `appearance_mode` = local client-cache only
- `tts_speed` = not a durable synced setting
- `use_source_page_numbers` = retired legacy gate; fixed runtime behavior instead
- diagnostics and devtools-only toggles = not product-truth settings rows

That means removing these fields from:
- effective runtime gating
- sync collection / hydration
- devtools settings authority
- backend durable canonicalization

### Directive 5 — Reconcile runtime behavior only after owner cleanup passes

Once duplicate owners are removed, re-validate:
- source/actual page-number handoff across the book
- Next/autoplay page-session behavior
- last-page reconciliation after viewport changes
- Explorer lag reduction without behavior drift

Do **not** treat runtime comfort as permission to postpone owner cleanup.

### Directive 6 — Keep passes bounded and non-regressive

Do not:
- reopen page-break core or protected prompt logic without a separate proven need
- reopen billing/usage architecture because durable-settings ownership is wrong
- preserve structural breaches merely because they look stable in runtime

## Practical patch grouping for reconciliation

### Pass A — Structural owner cleanup
Focus files likely to require correction:
- `index.html`
- `js/shell.js`
- `js/state.js`
- `js/sync.js`
- `js/devtools.js`
- `server/lib/app-durable-sync.js`
- `server/lib/app-dev-tools.js`

Goal:
- one owner per truth
- no shell-entry behavior ownership
- no retired fields flowing as durable truth
- no fixed runtime behavior still controlled by settings rows

### Pass B — Runtime behavior restoration through the correct owner
Focus files likely to require correction:
- `js/state.js`
- `js/library.js`
- `js/evaluation.js`
- `js/embers.js`

Goal:
- preserve importer/runtime behavior anchors
- preserve crown-jewel server ownership
- restore required user-facing behavior only after Pass A removes duplicate owners

### Pass C — Regression-trap cleanup
Focus files likely to require correction:
- `server/lib/content-page-break.js`
- `server/lib/content-page-break-core.js`
- any callers relying on omitted defaults

Goal:
- remove easy fallback paths that can silently reintroduce drift
- keep crown-jewel logic server-owned while reducing silent regression traps

## Compliance verdict on the target build

Current build status:
- **not policy-compliant**
- **structurally disqualified before runtime acceptance is considered**
- **contains healthy protected-server work that must be preserved during reconciliation**
- **requires broad reconciliation, not a surgical patch list**

## Final answer

**2 — many breaches**

Provide a **broad and directive patch plan** grouped by ownership and behavior domains, while explicitly protecting the server-relocated crown-jewel functionality and removing shell/entry ownership, duplicate durable truth, and retired settings authority from the active runtime path.
