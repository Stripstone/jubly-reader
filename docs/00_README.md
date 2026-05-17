# Jubly Reader — Reduced Authoritative Documentation Stack

This is the reduced active documentation package for the current project state.

The goal of this package is to keep project authority small, current, and usable during patching, reconciliation, launch work, and compliance audit.

This package defines required policy, not helpful suggestions.
A patch that violates scaffold authority, ownership boundaries, or duplicate-truth rules is non-compliant and must be rejected even if it appears to pass runtime acceptance criteria.

## Read in this order
1. `01_PROJECT_STATE.md`
2. `03_ARCHITECTURE_AND_GUARDRAILS.md`
3. `02_RUNTIME_CONTRACT.md`
4. `05_PRODUCT_LAUNCH_AND_INTEGRATION.md`
5. `06_SUPABASE_SCHEMA_REFERENCE.md`
6. `04_IMPLEMENTATION_WORKFLOW.md`

## What changed in this reduction
The prior stack had too many overlapping docs with partial duplication across:
- architecture and guardrails
- workflow and git patch operations
- launch, business surfaces, auth/billing wiring, and code-protection policy
- schema reference and one-time replacement procedure

This reduced stack merges those overlaps into one authority path per subject.

## Active authority docs

### `01_PROJECT_STATE.md`
What exists right now.

Use this before changing code or reviewing a build.

### `03_ARCHITECTURE_AND_GUARDRAILS.md`
Who owns what, what scaffold shape is authoritative, and what patterns are forbidden.

Use this first during audits, refactors, shell/runtime cleanup, scaffold verification, and protected-logic redistribution. This is the structural compliance gate.

### `02_RUNTIME_CONTRACT.md`
What the user should experience.

Use this to judge runtime behavior and reject regressions after the structural compliance gate passes. Runtime acceptance does not legalize an ownership breach.

### `04_IMPLEMENTATION_WORKFLOW.md`
Required development loop for bounded implementation passes.

Use this after policy documents determine what is correct. It governs owner identification, proof-first debugging, patch artifact discipline, and diff-driven cleanup, but it does not override higher-order policy.

### `05_PRODUCT_LAUNCH_AND_INTEGRATION.md`
Product flow, auth/billing wiring, launch gate, and browser-vs-backend protection policy.

Use this when the pass touches acquisition flow, signed-in behavior, entitlement resolution, pricing, billing, or code-exposure decisions.

### `06_SUPABASE_SCHEMA_REFERENCE.md`
Canonical pre-launch durable schema and the replacement procedure.

Use this for table roles, durable ownership, replacement sequencing, and post-reset validation.

## Maintained framework companions

### Pending-surfaces framework
- `pending-surfaces.md`

This is the maintained runtime-experience framework companion to `02_RUNTIME_CONTRACT.md` and `05_PRODUCT_LAUNCH_AND_INTEGRATION.md`.
Treat it as required project framework for any pass that touches user-visible pending, loading, hydration, re-auth, restore, usage, entitlement, or other server-backed shell/value surfaces.
It does not override the main authority stack, but it must remain aligned with it and updated when those surfaces change.

### SQL companion
- `app_tables_canonical.sql`

This is the canonical SQL companion to `06_SUPABASE_SCHEMA_REFERENCE.md`.
Treat the SQL and schema reference as a pair.

## Informational companion artifacts

### Operational reference
- `ops/ENVIRONMENT_VARIABLES_REFERENCE.md`

This is useful during setup, but it is not a project truth document.

### Audit note
- `notes/jubly-reader-nonCompliant-compliance-assessment-v2.md`

This remains an audit note only.
It does not override the active authority stack unless its findings are deliberately promoted into the docs above.

## Reduction map
The previous stack was reduced as follows:

- `03_ARCHITECTURE_MAP.md`
- `09_ARCHITECTURAL_GUARDRAILS_AND_SCAFFOLD_DISCIPLINE.md`
- `API_ROUTE_MAP.md`

→ merged into `03_ARCHITECTURE_AND_GUARDRAILS.md`

- `04_IMPLEMENTATION_WORKFLOW.md`
- `git_workflow_cheatsheet.md`

→ merged into `04_IMPLEMENTATION_WORKFLOW.md`

- `05_LAUNCH_AND_INTEGRATION.md`
- `06_BUSINESS_SURFACES_AND_FUNCTIONALITY.md`
- `07_AUTH_BILLING_WIRING_GUIDELINE.md`
- `08_IP_AND_CODE_PROTECTION_POLICY.md`

→ merged into `05_PRODUCT_LAUNCH_AND_INTEGRATION.md`

- `SUPABASE_TABLES_REFERENCE.md`
- `SUPABASE_RESET_AND_REBUILD.md`

→ merged into `06_SUPABASE_SCHEMA_REFERENCE.md`

## Current authority clarifications locked by this reduction
- Pre-account users may read the sample book.
- `appearance_mode` is client-cache only, not a durable synced setting.
- `tts_speed` is not part of the durable settings contract.
- `use_source_page_numbers` is retired as a configurable and replaced by fixed runtime page-number behavior.
- diagnostics preferences and devtools-only toggles are not durable product truth.
- the non-compliance assessment remains an audit note, not a policy doc.

## Package maintenance rules
- Update `01_PROJECT_STATE.md` when code reality changes.
- Update `02_RUNTIME_CONTRACT.md` when user-facing behavior changes.
- Update `03_ARCHITECTURE_AND_GUARDRAILS.md` when ownership or scaffold rules change.
- Update `04_IMPLEMENTATION_WORKFLOW.md` when the default implementation loop changes.
- Update `05_PRODUCT_LAUNCH_AND_INTEGRATION.md` when product flow, launch gate, or protection policy changes.
- Update `pending-surfaces.md` when pending, loading, hydration, restore, re-auth, account, billing, usage, or other server-backed shell/value surfaces change. Keep it aligned with `02_RUNTIME_CONTRACT.md` and `05_PRODUCT_LAUNCH_AND_INTEGRATION.md`.
- Update `06_SUPABASE_SCHEMA_REFERENCE.md` and `app_tables_canonical.sql` together when durable schema changes.

## Audit and implementation gate order
1. verify the current scaffold and artifact base
2. identify the owner layer and forbidden authority surfaces
3. reject structural breaches before judging runtime comfort
4. for passes touching server-backed or hydration-backed user surfaces, verify `pending-surfaces.md` is still aligned
5. confirm runtime behavior in served testing
6. decide whether the next move is proof, a bounded patch, or diff-driven cleanup

Do not send broad implementation work based only on code suspicion.
Do not treat runtime comfort as permission to ignore architectural non-compliance.
