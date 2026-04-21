# Runtime Protection Ledger

This document protects runtime-tested Jubly Reader behavior from regression. It records accepted user-visible functionality, owner boundaries, active watch items, forbidden regressions, and validation expectations before future patches are accepted.

Status: active protection ledger.

Last major runtime evidence date: 2026-04-20.


> **Placement note:** This file is written to live at `docs/RUNTIME_PROTECTION_LEDGER.md`. Links below are relative to the `docs/` folder in the accepted target artifact.
>
> **Ledger scope:** Existing docs remain the authority for architecture, runtime contract, workflow, product/auth/billing flows, schema, and pending-surface rules. This ledger exists to preserve **runtime-tested behavior, active watches, and patch gates** by citing those owners instead of replacing them.

## 0. Documentation authority map

Use this map before treating any ledger item as standalone authority.

- Authoritative doc order and maintenance rules: [`00_README.md`](./00_README.md)
- Current code shape, product-flow intent, and local-vs-durable intent: [`01_PROJECT_STATE.md`](./01_PROJECT_STATE.md)
- User-facing runtime behavior and acceptance checks: [`02_RUNTIME_CONTRACT.md`](./02_RUNTIME_CONTRACT.md)
- Ownership split, scaffold discipline, forbidden patterns, and patch disqualifiers: [`03_ARCHITECTURE_AND_GUARDRAILS.md`](./03_ARCHITECTURE_AND_GUARDRAILS.md)
- Required implementation loop, artifact discipline, and deliverable format: [`04_IMPLEMENTATION_WORKFLOW.md`](./04_IMPLEMENTATION_WORKFLOW.md)
- Public flow, auth/billing wiring, plan model, environment variables, and operator redirect contract: [`05_PRODUCT_LAUNCH_AND_INTEGRATION.md`](./05_PRODUCT_LAUNCH_AND_INTEGRATION.md)
- Supabase durable schema, entitlement truth, and trial anti-abuse ledger: [`06_SUPABASE_SCHEMA_REFERENCE.md`](./06_SUPABASE_SCHEMA_REFERENCE.md)
- Canonical SQL companion: [`app_tables_canonical.sql`](./app_tables_canonical.sql)
- Pending/loading/hydration/account/billing surface rules: [`pending-surfaces.md`](./pending-surfaces.md)
- Operator environment and Supabase auth setup references: [`_ops/ENVIRONMENT_VARIABLES_REFERENCE.md`](./_ops/ENVIRONMENT_VARIABLES_REFERENCE.md), [`_ops/SUPABASE_AUTH_OPERATOR_VALUES.md`](./_ops/SUPABASE_AUTH_OPERATOR_VALUES.md), [`_ops/SUPABASE_CONFIRM_SIGNUP_TEMPLATE.html`](./_ops/SUPABASE_CONFIRM_SIGNUP_TEMPLATE.html)

---

## 1. Current artifact and base policy

> **Doc authority:** artifact/base discipline is governed by [`00_README.md`](./00_README.md#package-maintenance-rules), [`04_IMPLEMENTATION_WORKFLOW.md`](./04_IMPLEMENTATION_WORKFLOW.md#0-verify-current-scaffold-and-artifact-reality), and [`04_IMPLEMENTATION_WORKFLOW.md`](./04_IMPLEMENTATION_WORKFLOW.md#deliverables-policy). This ledger adds the current tested-artifact interpretation and runtime-preservation notes.


### Runtime artifacts in scope

Current high-value tested artifacts:

- `jubly-reader-ttsv4.zip`
- `jubly-reader-ttsv5.zip`

Prior accepted runtime base:

- `restoration_integrated_runtime.zip`

Previously tracked runtime-test candidate:

- `batch2_core_public_tts_v3_runtime_candidate.zip`

### Current base rule

Future work must patch forward from the latest runtime-tested accepted environment unless a wrong-base or base-integrity issue is found.

When multiple tested artifacts are in scope, every review or patch handoff must explicitly identify:

1. the artifact used as base,
2. whether it is accepted, tested-reference, runtime-candidate, or fallback-only,
3. whether any later tested behavior must be preserved even if the patch base is older.

### Current artifact interpretation

- `jubly-reader-ttsv4.zip` is a packaged runtime candidate / tested reference with strong TTS runtime evidence.
- `jubly-reader-ttsv5.zip` is important and in scope, but should not be overstated as final unless the specific lane being discussed has been runtime-accepted against it.
- For TTS-sensitive work, preserve the tested v4 behavior unless a later artifact is explicitly identified as the accepted successor.
- For billing/auth work, use the latest billing/auth runtime artifact for that branch, not a TTS artifact, unless the lane is being integrated.

### Required handoff format for future accepted artifacts

Every future patch or acceptance handoff must include:

- base artifact,
- diff name,
- runtime artifact zip name,
- changed files,
- behavior changed,
- behavior intentionally preserved,
- regression risk,
- runtime validation path,
- next patch base.

---

## 2. Non-negotiable owner boundaries

> **Doc authority:** owner boundaries are restated from [`03_ARCHITECTURE_AND_GUARDRAILS.md`](./03_ARCHITECTURE_AND_GUARDRAILS.md#ownership-split), [`05_PRODUCT_LAUNCH_AND_INTEGRATION.md`](./05_PRODUCT_LAUNCH_AND_INTEGRATION.md#data-ownership-and-authority-map), and [`01_PROJECT_STATE.md`](./01_PROJECT_STATE.md#current-code-shape). This ledger records runtime-specific consequences of violating those boundaries.


### Shell / presentation owner

The shell may own presentation, routing display, modal display, public CTA surfaces, visual layout, and user-facing staged flow.

The shell must not own:

- reading truth,
- playback truth,
- page/progress truth,
- billing truth,
- entitlement truth,
- trial eligibility,
- provider/cloud voice policy,
- durable settings truth.

Forbidden shell fixes:

- hidden clicks,
- shell-owned playback mirrors,
- z-index-only fixes for state bugs,
- DOM class truth substitution,
- shell variables pretending to be runtime truth,
- pricing/auth state patched by hiding symptoms instead of proving whether a modal should be open.

### Runtime / reading owner

Runtime owns:

- reading entry,
- page activation,
- current-page/progress truth,
- playback lifecycle,
- TTS session state,
- local pending state,
- user-visible reading continuity.

Runtime truth beats shell guesses. Current page, playback, pause/resume, narration, and TTS route state must come from explicit runtime activation and runtime playback state, not passive scroll or visual inference.

### Backend / durable owner

Backend owns:

- checkout,
- entitlements,
- trial eligibility,
- trial anti-abuse,
- provider policy,
- usage checks,
- durable records,
- Supabase/Stripe-facing truth seams.

Durable truth must not be guessed by the client. Billing, trial, entitlement, auth redirect, and deployment defects require checking code plus Supabase, Stripe, Vercel/env, and schema truth before accepting a fix.

---

## 3. Operational standards that protect the file map

> **Doc authority:** scaffold, workflow, and compliance gate requirements are owned by [`00_README.md`](./00_README.md#audit-and-implementation-gate-order), [`03_ARCHITECTURE_AND_GUARDRAILS.md`](./03_ARCHITECTURE_AND_GUARDRAILS.md#scaffold-discipline), and [`04_IMPLEMENTATION_WORKFLOW.md`](./04_IMPLEMENTATION_WORKFLOW.md#core-workflow). This ledger keeps those requirements adjacent to the tested-regression record.


The project has already seen structural drift where runtime behavior appeared acceptable while the wrong owner held the behavior. Future work must protect the file map as strongly as runtime behavior.

### Required workflow

1. Start from the latest accepted base or the explicitly named current runtime candidate.
2. Unpack into a clean workspace.
3. Verify root shape before patching:
   - root `index.html`,
   - root `js/`,
   - docs in `docs/`,
   - no accidental nested artifact root.
4. Review at minimum docs 00–03 before coding.
5. Research upstream truth before patching symptoms.
6. Produce one bounded diff against the named base.
7. Produce a runtime artifact zip when the patch is intended for runtime testing.
8. Preserve passing behavior unless runtime evidence proves it is wrong.

### Structural compliance gate

A patch can be rejected even if it appears to work at runtime if it violates owner boundaries, duplicate-truth rules, scaffold authority, retired settings policy, or backend/server responsibility.

### Crown-jewel server moves to preserve

Do not roll back protected backend moves during reconciliation:

- server-owned content page-break/import routing,
- server-owned AI/prompt surfaces,
- server-owned cloud TTS/provider policy,
- server-owned usage/import-capacity/entitlement checks,
- server-owned checkout/trial eligibility.

### Retired fields that must not reappear as durable truth

- `appearance_mode` as backend/durable setting,
- `tts_speed` as durable synced setting,
- `use_source_page_numbers` as a live runtime gate.

Appearance may persist locally only. Dismissed local UI affordances may persist locally only. Shell navigation state, diagnostics preferences, and devtools-only toggles must not become durable product truth.

---

## 4. Cross-cutting rendering and state-hallucination guardrails

> **Doc authority:** safe state rendering and duplicate-truth rejection are owned by [`02_RUNTIME_CONTRACT.md`](./02_RUNTIME_CONTRACT.md#runtime-experience-evaluation-lens), [`pending-surfaces.md`](./pending-surfaces.md#framework-rules), and [`03_ARCHITECTURE_AND_GUARDRAILS.md`](./03_ARCHITECTURE_AND_GUARDRAILS.md#anti-pattern-blacklist). The specific billing-over-reading and sync-bleed notes below are runtime evidence captured by this ledger.


### General rendering risk

Known risk:

General rendering may rarely show billing/pricing UI merged with or competing against other elements, especially during extreme latency.

Working hypothesis:

This may be CSS/render arbitration or competing surface ownership. Do not assume the fix is z-index, hiding, or code-only state mutation until runtime evidence proves whether the modal should have been open.

Protection rule:

1. First determine whether the billing/pricing surface should be open at all.
2. Then determine whether the defect is state ownership, sync/hydration, shell routing, CSS/layout, or latency timing.
3. Do not mask the issue by merely hiding or layering one surface over another unless investigation proves the content is valid and only visually mis-layered.

### Sync as upstream truth guard

Confirmed runtime truth:

Sync is one of the most important upstream guards against hallucinated client state.

Runtime proof:

A sync modification fixed logged-in entitlements bleeding into signed-out value-first surfaces. That bleed also contributed to public surface mutation and public TTS cloud-drop behavior caused by signed-out routes inheriting account-required cloud state.

Protection rule:

1. When signed-in truth appears in signed-out/public surfaces, inspect sync and runtime policy projection before patching presentation symptoms.
2. Public/value-first surfaces must not inherit paid entitlements, cloud capability, dashboard state, Explorer state, or explicit cloud voice execution.
3. Sync fixes must preserve durable signed-in preferences while clearing transient/session/public projections when account truth is gone.

---

## 5. Public intro and signed-out behavior

> **Doc authority:** public-entry and sample-reading behavior is owned by [`05_PRODUCT_LAUNCH_AND_INTEGRATION.md`](./05_PRODUCT_LAUNCH_AND_INTEGRATION.md#visitor--pre-account-user), [`05_PRODUCT_LAUNCH_AND_INTEGRATION.md`](./05_PRODUCT_LAUNCH_AND_INTEGRATION.md#new-user-acquisition-flow), [`05_PRODUCT_LAUNCH_AND_INTEGRATION.md`](./05_PRODUCT_LAUNCH_AND_INTEGRATION.md#public-surfaces), and [`02_RUNTIME_CONTRACT.md`](./02_RUNTIME_CONTRACT.md#public-sample-flow). This ledger records tested regressions and exact copy that must not drift.


### Protected public flow

Protected behavior:

1. Signed-out visitors land on the landing page, not the intro library.
2. Primary CTA is **Try it now**.
3. **Try it now** opens sample reading directly.
4. Sample reading does not require account creation.
5. Exiting sample reading lands in the intro library.
6. The intro library exposes both:
   - a sample/value path,
   - a conversion/pricing/auth path.
7. Intro-library conversion CTA should read **Get Started**.
8. Pricing-modal Basic CTA should read **Continue for free**.

Must not regress:

- public sample reading blocked by account creation,
- sample exit returning to the wrong public surface,
- signed-out landing inheriting signed-in dashboard/Explorer state,
- signed-out landing inheriting paid/cloud account state,
- intro-library CTA copy regressing to unclear **Continue with Basic**.

### Signed-out appearance protection

Confirmed issue class:

Signed-out landing previously inherited prior-session dark appearance while **Try it now** normalized to expected default theme. This narrowed the defect to signed-out landing boot rather than universal public state.

Protected behavior:

- Public/signed-out landing must be public-safe before account truth exists.
- Public sample entry must not inherit prior signed-in appearance or Explorer state.
- Appearance boot fixes should apply only where appropriate; do not break logged-in account appearance ownership.

---

## 6. Pricing, auth, and verified continuation

> **Doc authority:** pricing/auth flows are owned by [`05_PRODUCT_LAUNCH_AND_INTEGRATION.md`](./05_PRODUCT_LAUNCH_AND_INTEGRATION.md#email-verification-flow), [`05_PRODUCT_LAUNCH_AND_INTEGRATION.md`](./05_PRODUCT_LAUNCH_AND_INTEGRATION.md#operator-redirect-contract), [`pending-surfaces.md`](./pending-surfaces.md#billing--subscription), [`_ops/SUPABASE_AUTH_OPERATOR_VALUES.md`](./_ops/SUPABASE_AUTH_OPERATOR_VALUES.md), and [`_ops/SUPABASE_CONFIRM_SIGNUP_TEMPLATE.html`](./_ops/SUPABASE_CONFIRM_SIGNUP_TEMPLATE.html). This ledger tracks runtime-confirmed cleanup obligations and pending-state regressions.


### Protected pricing/auth behavior

Protected behavior:

1. Pricing opens only from pricing/account/gated paths.
2. Pricing modal should appear in a settled state.
3. Button text should not visibly mutate after the modal opens.
4. Plans remain Basic / Pro / Premium.
5. Basic free CTA is **Continue for free**.
6. Existing-account detection steers to Log In instead of showing fake account-created success.
7. Paid plan intent survives account creation and verification.
8. Verified Pro/Premium continuation proceeds to checkout when auth/session/provider state allows it.
9. Logged-in upgrade paths go directly to checkout.
10. Basic/free verification behavior remains separate from paid checkout continuation.
11. Stale paid-intent markers must be cleared outside active auth/checkout paths.

### Pricing modal pending-state watch

Runtime observation:

Pricing modal opening showed button text mutating after the modal appeared. The desired behavior is for the modal to pop in as one coherent surface, even if opening is delayed slightly to settle plan/button truth first.

Protection rule:

- Do not accept pricing modal behavior where user-visible button text morphs after first paint.
- This is a pending-surface issue, not just copy polish.
- Fix should preserve pricing/auth owner boundaries and not invent a parallel pricing path.

### Email-step validation protection

Runtime observation:

An invalid address such as `a@a.c` passed the email step and failed only at final account creation. That was rejected as split validation.

Protected behavior:

- Email-step validation and final submit validation must use the same validator or remain functionally in sync.
- Invalid email should be caught on the email step, not only after username/password entry.
- Stronger production-grade validation is preferred over bare `x@x.x` acceptance.
- Provider truth still governs final deliverability and rate-limit behavior.

### Existing-account steer and stale paid-intent cleanup

Runtime observation:

The existing-account path could steer to Log In, and Back cleared billing markers, but logo/home return to landing could still leave `tier=pro` visible in the URL.

Protected behavior:

- If an existing-account email is steered to Log In, backing out must clear stale paid-intent markers.
- Logo/home return must also clear stale paid-intent markers outside the active auth/checkout path.
- `tier=pro`, `tier=premium`, and `next=checkout` must not linger on signed-out landing after the user abandons the paid flow.

### Verification redirect contract

Protected redirect source:

- Use `APP_BASE_URL` as the canonical public app origin.
- Do not rely on localhost fallback behavior.
- Supabase Site URL should be the bare app origin, not a view URL.
- Redirect correctness is app code plus Supabase dashboard/operator config together.

Protected Supabase redirect allow-list values:

- `APP_BASE_URL/?view=login-page`
- `APP_BASE_URL/?view=login-page&auth=verified`
- `APP_BASE_URL/?view=login-page&auth=verified&next=checkout&tier=pro`
- `APP_BASE_URL/?view=login-page&auth=verified&next=checkout&tier=premium`

Protected behavior:

- Basic/free verification returns to login without paid markers.
- Pro/Premium verification returns to login with `auth=verified`, `next=checkout`, and the selected tier preserved.
- Login after verified Pro/Premium continuation should enter checkout rather than stall.
- Whether verification is required before sign-in is code plus Supabase confirmation settings, not app code alone.

### HTML email protection

Protected behavior:

- Confirmation email should be a real styled HTML email, not a raw/default-looking provider message.
- The email template must preserve Supabase’s provider-backed confirmation URL token flow.
- Do not replace `{{ .ConfirmationURL }}` with a static preview URL.
- The template should return the user to the app-owned verified login continuation flow.

---

## 7. Billing, trial, checkout, and entitlement protection

> **Doc authority:** plan vocabulary, checkout, environment variables, and entitlement/trial truth are owned by [`05_PRODUCT_LAUNCH_AND_INTEGRATION.md`](./05_PRODUCT_LAUNCH_AND_INTEGRATION.md#plan-and-feature-resolution-model), [`05_PRODUCT_LAUNCH_AND_INTEGRATION.md`](./05_PRODUCT_LAUNCH_AND_INTEGRATION.md#environment-variables), [`06_SUPABASE_SCHEMA_REFERENCE.md`](./06_SUPABASE_SCHEMA_REFERENCE.md#7-user_entitlements), [`06_SUPABASE_SCHEMA_REFERENCE.md`](./06_SUPABASE_SCHEMA_REFERENCE.md#9-user_trial_claims), and [`_ops/ENVIRONMENT_VARIABLES_REFERENCE.md`](./_ops/ENVIRONMENT_VARIABLES_REFERENCE.md). This ledger adds tested failure modes and acceptance-protection language.


### Canonical entitlement vocabulary

Protected vocabulary:

- `basic`
- `pro`
- `premium`

Stripe-backed paid plans:

- `pro`
- `premium`

Forbidden regression:

- Do not reintroduce `plan_id` as entitlement truth. Entitlement reads/writes use `tier`.

### `user_entitlements` canonical shape

Protected expected columns:

- `user_id`
- `provider`
- `tier`
- `status`
- `stripe_customer_id`
- `stripe_subscription_id`
- `period_start`
- `period_end`
- `created_at`
- `updated_at`

Must not regress:

- no select/upsert should reference nonexistent `plan_id`,
- active Pro trial must resolve as Pro entitlement at the app level,
- post-Stripe return must not show stale Basic when server entitlement truth is Pro/Premium/trial.

### Pro trial behavior

Protected behavior:

1. Pro trial appears only on actual Pro checkout entry.
2. Premium does not inherit the Pro trial.
3. Trial decisioning is server checkout creation, not redirect URL logic.
4. Trial eligibility is server-side.
5. Trial eligibility accounts for:
   - unique account,
   - no prior trial already consumed,
   - no prior trial from the same server-observed IP footprint when enabled.
6. Ineligible users should not see trial-specific CTA copy.
7. Stripe checkout should show trial terms only when trial is granted.

Protected env/config:

- `PLAN_REQUIRE_CARD`
- `PLAN_PRO_TRIAL_DAYS`
- `PLAN_PREMIUM_TRIAL_DAYS`
- `PLAN_TRIAL_MISSING_PAYMENT_METHOD_BEHAVIOR`
- `PLAN_ALLOW_PROMOTION_CODES`
- `PLAN_LIMIT_ONE_SUBSCRIPTION`
- `PLAN_TRIAL_REQUIRE_UNIQUE_IP`

Preferred trial policy:

- New user on a fresh account and fresh server-observed IP can be offered Pro trial.
- A user who first chooses Basic and later upgrades to Pro can be offered trial if eligibility remains valid.
- Once a user starts or consumes the Pro trial, the trial is no longer offered to that account.
- Once a trial expires, it is no longer offered to that account.
- Unique-IP enforcement uses durable server-side hashed footprint, not local cache and not raw IP as product truth.

### `user_trial_claims` protection

Protected anti-abuse ledger concept:

A durable trial-claim ledger should track trial consumption and server-observed IP footprint in a way that avoids client/local-cache authority.

Expected concepts:

- `user_id`
- `tier`
- `ip_fingerprint_hash`
- `claim_status`
- `claim_reason`
- `claimed_at`
- `created_at`
- `updated_at`
- `expires_at`
- optional notes/metadata

Must not regress:

- Trial anti-abuse must not move client-side.
- IP footprint should be hashed.
- Trial availability should not be inferred from redirect parameters alone.

---

## 8. Reading and page authority protection

> **Doc authority:** reading continuity, page navigation, and active-page ownership are owned by [`02_RUNTIME_CONTRACT.md`](./02_RUNTIME_CONTRACT.md#reading-contract), [`02_RUNTIME_CONTRACT.md`](./02_RUNTIME_CONTRACT.md#page-navigation), [`03_ARCHITECTURE_AND_GUARDRAILS.md`](./03_ARCHITECTURE_AND_GUARDRAILS.md#runtime-owns), and [`01_PROJECT_STATE.md`](./01_PROJECT_STATE.md#current-local-vs-durable-intent). This ledger preserves the runtime-tested page-authority outcomes.


### Page truth

Current page equals the last runtime-activated page.

Valid activation sources:

1. Restore
2. Explicit Play
3. Read Page
4. Next / Previous
5. TTS-controlled page handoff

Invalid page truth sources:

- passive scroll,
- viewport inference,
- pointer/touch start,
- resize,
- fullscreen,
- `.page-active` as source of truth,
- shell mirrored variables.

Protected implementation principle:

`markActiveReadingPage()` remains the effective activation write path for page mirrors, progress, and runtime page state.

### Runtime-confirmed page authority behavior

Confirmed behavior from regression testing:

- Passive scroll did not overwrite current-page truth.
- Play activation stored the expected page.
- TTS Next activation updated the expected page/block truth.
- Refresh/re-entry restored the runtime-activated page rather than the merely scrolled visual position.

Must not regress:

1. Passive scroll must not write page/progress truth.
2. Bottom Play may sample visible page once as explicit user action, then must bring that page into view and start there.
3. Read Page explicitly targets its page.
4. Next during silent/non-speaking state advances page only and must not unexpectedly start narration.
5. Next during active speaking advances page and continues narration.

---

## 9. TTS and playback protection

> **Doc authority:** TTS user-facing behavior is owned by [`02_RUNTIME_CONTRACT.md`](./02_RUNTIME_CONTRACT.md#tts-contract), local/backend placement by [`03_ARCHITECTURE_AND_GUARDRAILS.md`](./03_ARCHITECTURE_AND_GUARDRAILS.md#required-local-vs-backend-placement), and cloud TTS pending/error surface expectations by [`pending-surfaces.md`](./pending-surfaces.md#reading--tts). This ledger records the tested v2/v3/v4 TTS wins and regressions that must not return.


### TTS atomicity

Confirmed project truth:

TTS is atomic and high-risk. Careless patching must be narrow before runtime validation.

Protection rule:

1. Reject broad TTS rewrites unless runtime evidence proves the owner sequence is fundamentally broken.
2. Reject patches that casually alter broader playback/event sequencing.
3. Even narrow TTS changes require extensive runtime testing.
4. Prefer visibility-first, request-id-safe, owner-local changes before changing playback sequence logic.

### Shared playback truth

Protected behavior:

1. Page Read and bottom Play/Pause reflect one shared runtime playback state.
2. Play → Pause → Next shows Play, not stale Resume.
3. Resume must not appear for stale cloud sessions with no live block/marks state.
4. Runtime must not expose fake-active playback state.

Fake-active examples that must not return:

- playback active with `activeBlockIndex = -1`,
- playback active with `blockCount = 0`,
- paused cloud session with no live marks but `canResume = true`,
- controls implying Resume when no valid resumable session exists.

### Phase 1 / full-page promotion protection

Runtime-confirmed protected wins from the v2/v3/v4 sequence:

1. Box 8 / trailing same-page text coverage was fixed and runtime-confirmed reachable.
2. Phase 1 pause/resume works in the unpromoted window and no longer restarts block 0.
3. Paused Phase 1 skip → Resume works and does not reset.
4. Natural Phase 1 handoff can play smoothly through the page and into the next page.
5. Promoted same-page replay, Stop → Play, and skip spam remain smooth.
6. Final-block/page handoff behavior works.
7. Short/micro pages, including tiny text import, play normally without stale Phase 1 behavior.

Previously observed failures that must not return:

- passive Phase 1 → full-page promotion duplicating the current/just-spoken block,
- valid paused Phase 1 session classified as stale and restarted from block 0,
- ended Phase 1 window settling into stale Resume before promotion,
- full-page marks/text ending before visible same-page content,
- highlight rollback during promotion,
- alternating fail/pass same-page replay after promotion.

### End-of-chapter protection

Protected behavior:

1. Natural last-page finish resolves to visual **End of Chapter** closure.
2. End-of-Chapter remains visual-only.
3. No spoken End-of-Chapter announcement is accepted yet.
4. Controls settle cleanly with Play available.
5. No autoplay/countdown into nowhere.
6. Replay after exhausted content must not lock controls.

### Public/browser route protection

Runtime-confirmed behavior:

- Signed-out/public sample reading passed natural playthrough, skip behavior, and Exit with no unexpected behavior or stale Resume.

Protected behavior:

1. Signed-out/public sample TTS routes as public/basic.
2. Public sample must not inherit signed-in cloud capability.
3. Public sample must not execute stale explicit cloud voice selection.
4. Logout/public reset clears transient session voice selection and pending runtime policy projection.
5. Public sample should not attempt Azure/cloud route.
6. Public sample should not show cloud/websocket errors caused by stale signed-in state.

### Voice, route, and speed protection

Runtime-confirmed behavior:

- Speed and voice surface behavior passed at user-visible level.
- Voice stayed coherent during playback.
- Explicit cloud route remained or returned as expected in later movement tests.

Watch:

- If diagnostics show the route never actually changed during a voice test, treat that as a route-verification watch rather than a surface pass.
- Explicit cloud selection must not silently downgrade to browser voice when signed in and eligible.

---

## 10. Cloud restart latency protection

> **Doc authority:** transient cloud/server failures and pending-surface standards are owned by [`03_ARCHITECTURE_AND_GUARDRAILS.md`](./03_ARCHITECTURE_AND_GUARDRAILS.md#error-handling-standards), [`02_RUNTIME_CONTRACT.md`](./02_RUNTIME_CONTRACT.md#pending-and-re-hydration-surfaces-are-part-of-runtime-truth), and [`pending-surfaces.md`](./pending-surfaces.md#reading--tts). The severe-throttling skip/restart delay is runtime evidence captured here.


### Runtime-confirmed latency finding

Under severe throttling, rapid cloud skips can move highlight/session intent before the actual cloud restart applies.

Key observed class:

- `cloud-restart-request` accepted a skip target,
- highlight/session state advanced immediately,
- `cloud-restart-applied` lagged significantly under severe throttling,
- audio eventually recovered when the restart applied or bandwidth improved.

Interpretation:

This is not currently stale Resume, Phase 1 corruption, or replay failure. It is a latency UX/visibility gap around pending cloud seek/restart.

### Protection rule

Preserve v4 TTS behavior. Do not reopen Phase 1 promotion, replay, or skip core solely because of this latency finding.

Future Lane C / latency bucket should focus on:

1. visible pending state during cloud restart/seek,
2. request-id-safe pending cleanup,
3. elapsed timing from request to applied/failed,
4. optional coalescing of actual skip intents while restart is in-flight,
5. preserving skip eligibility outside the actual in-flight restart window,
6. pause during pending restart clearing/unmuting through existing pause cleanup.

Required user-visible states may include:

- Loading audio…
- Still loading audio… poor connection may slow this down.
- Poor connection — still trying to load this audio.

Must not regress:

- old restart promises clearing newer pending state,
- broad skip disabling,
- replay/skip rewrites caused by a visibility issue,
- diagnostics-only pending with no user-visible truth.

---

## 11. Autoplay and countdown protection

> **Doc authority:** autoplay countdown and TTS control truth are owned by [`02_RUNTIME_CONTRACT.md`](./02_RUNTIME_CONTRACT.md#tts-contract) and [`03_ARCHITECTURE_AND_GUARDRAILS.md`](./03_ARCHITECTURE_AND_GUARDRAILS.md#runtime-owns). The full-page pre-synth rule is a project-approved optimization proposal tracked by this ledger, not a replacement for the runtime contract.


### Protected autoplay behavior

Must not regress:

1. Autoplay countdown must not strand controls.
2. Countdown policy belongs on the Read Page / autoplay handoff path, not inside skip buttons.
3. Autoplay must not create fake-active playback.
4. Autoplay must not start from stale page/progress truth.
5. Countdown cancellation must not force full-page promotion from sampling only.

### Autoplay full-page pre-synth proposal

Status:

- User-approved concept / separate optimization slice.
- Should not be mixed into a core bugfix unless runtime proves the same owner owns both.

Rule:

If the prior page completed naturally during autoplay/countdown flow, and the user did not skip on that prior page, then during the next page’s 3…2…1 countdown the runtime may pre-synthesize the next page as full-page directly.

Purpose:

Avoid entering Phase 1 block-window on clearly engaged autoplay continuation.

Guardrails:

- Apply only to autoplay continuation.
- Do not apply to normal Play, Read Page, manual page entry, or exploratory sampled listening.
- Do not apply after prior-page skip.
- Do not apply after manual page change.
- Do not apply if countdown was canceled.
- Do not apply on public/browser route.
- Use explicit one-transition state.
- Clear on page entry, cancel, manual navigation, skip, stop, exit, or route change.
- If pre-synth fails or is not ready by countdown completion, fall back to normal Phase 1.
- Keep Case B as normal Phase 1 promotion owner.
- Do not reopen replay/skip/cache-contract work.

Required diagnostics:

- prior page completed naturally,
- prior page skip count,
- countdown pre-synth requested / ready / failed,
- chosen next-page mode: autoplay-full-page vs phase1-block-window,
- fallback reason,
- artifact cache status,
- marks count.

---

## 12. Settings, mobile modal, and layout protection

> **Doc authority:** settings/runtime behavior is owned by [`02_RUNTIME_CONTRACT.md`](./02_RUNTIME_CONTRACT.md#settings), reading settings layout by [`02_RUNTIME_CONTRACT.md`](./02_RUNTIME_CONTRACT.md#reading-settings), local-vs-durable settings rules by [`03_ARCHITECTURE_AND_GUARDRAILS.md`](./03_ARCHITECTURE_AND_GUARDRAILS.md#current-local-vs-durable-persistence-rules), and settings pending policy by [`pending-surfaces.md`](./pending-surfaces.md#settings--persistence). This ledger adds mobile-landscape and interruption evidence.


### Protected settings behavior

Must not regress:

1. Settings toggles open and closed on repeat press.
2. Settings modal header and close X remain reachable in mobile landscape.
3. Long settings content scrolls internally, not by leaking page/background scroll.
4. Desktop/tablet settings layout remains unchanged unless intentionally patched.
5. Appearance preference is local-only.
6. Dismissed local UI affordances may persist locally only.
7. Shell navigation/view state, diagnostics preferences, and devtools-only toggles must not become durable client-cached state.

### Runtime-confirmed mobile/layout watch

Observed issue:

- Settings modal was too tall in mobile landscape.
- Top bar / close X was outside the viewport.
- Mobile TTS itself worked.
- Mobile users are likely to leave the site, switch apps, lock screen, use dictation, play video/music, and return.

Protection rule:

Mobile settings/layout can be patched as a shell/CSS bucket, but it must not touch TTS/runtime authority.

Expected mobile settings result:

- header and close X reachable without page-background scroll,
- long settings content scrolls internally,
- bottom bars remain usable,
- Exit/page counter remain visible,
- desktop/tablet layout unchanged unless intentionally scoped.

### Mobile/interruption behavior to preserve

Runtime-confirmed behavior:

- TTS continued when moving to a new tab and turning the phone screen off.
- Dictation interrupted seamlessly: TTS paused and resumed afterward.
- Playing video paused TTS; after leaving video, app still exposed Resume.
- Playing music paused TTS similarly, waiting for Resume.

Must not regress:

- no active-but-silent state after interruption,
- no stale Resume/no-marks state after interruption,
- no route downgrade after returning,
- no layout overlap preventing controls after mobile interaction.

---

## 13. Diagnostics and pending surfaces

> **Doc authority:** pending/loading/hydration rules are owned by [`pending-surfaces.md`](./pending-surfaces.md#framework-rules) and [`02_RUNTIME_CONTRACT.md`](./02_RUNTIME_CONTRACT.md#responsiveness-patterns-required-by-this-contract). Error surfacing/retry discipline is owned by [`03_ARCHITECTURE_AND_GUARDRAILS.md`](./03_ARCHITECTURE_AND_GUARDRAILS.md#error-handling-standards).


Protected behavior:

1. Diagnostics expose enough truth to debug runtime failures.
2. Diagnostics must not be the only user-visible surface for a real pending/error state.
3. User-visible pending states should be honest and non-spammy.
4. Transient failures should get limited automatic recovery before scary error banners appear.
5. Persistent failure banners should describe persistent failure, not transient recovery attempts.

Known required visibility areas:

- no-voice state,
- blocked-error state,
- stale cloud session / no live marks state,
- cloud restart pending / slow / very slow state,
- usage-gated TTS behavior,
- backend audio vs marks cache capability,
- runtime route selection: public/browser/cloud,
- natural end-of-window handoff state,
- promotion requested / pending / ready / failed,
- chosen handoff block,
- text length / marks coverage / last range end.

Pending-surface standard:

- Do not show scary failure banners as the first response to transient issues.
- Attempt limited recovery first.
- If a pending state affects the user, it must be visible to the user, not diagnostics-only.
- Copy must be truthful about pending/settled state.

---

## 14. Runtime acceptance checklist

> **Doc authority:** runtime acceptance is owned by [`02_RUNTIME_CONTRACT.md`](./02_RUNTIME_CONTRACT.md#acceptance-checks), product validation by [`05_PRODUCT_LAUNCH_AND_INTEGRATION.md`](./05_PRODUCT_LAUNCH_AND_INTEGRATION.md#validation-checklist), and runtime-test discipline by [`04_IMPLEMENTATION_WORKFLOW.md`](./04_IMPLEMENTATION_WORKFLOW.md#5-runtime-test). This checklist narrows those docs into owner-specific release checks.


Use this as a risk-adjusted checklist. Do not run the entire matrix for every tiny patch. Match depth to the touched owner area.

### Always-worth-checking basics

1. Cold boot settles into the correct public/signed-in surface without obvious wrong-state flash.
2. Public sample reading opens without account wall.
3. Exiting sample reading lands in expected public shell.
4. Settings opens and closes normally.
5. Signed-out/public mode does not show stale signed-in entitlement, appearance, Explorer, or cloud voice state.

### Reading/TTS checks when runtime or TTS was touched

1. Play / Pause / Resume / Next / Read Page behave coherently.
2. Speaking Next advances page/block and continues narration as expected.
3. Silent Next advances page only and does not unexpectedly start narration.
4. Read Page targets the selected page.
5. Bottom Play samples visible page once, brings it into view, and starts there.
6. Passive scroll does not write current-page/progress truth.
7. End-of-Chapter resolves visually with controls idle and Play available.
8. Replay after exhausted content does not lock controls.
9. Autoplay handoff does not strand controls.
10. Public sample TTS does not attempt cloud/Azure route.
11. Phase 1 pause/resume does not restart block 0.
12. Paused Phase 1 skip/resume does not reset.
13. Promoted same-page replay + skip spam remain smooth.
14. Box 8-style trailing text remains reachable.
15. Slow cloud restart, if in scope, shows honest pending state without breaking skip/pause behavior.

### Billing/auth checks when account, sync, entitlement, pricing, or shell auth was touched

1. Signed-out landing is correct and public-safe.
2. Try it now opens sample reading.
3. Sample Exit lands in intro library.
4. Intro library CTA copy is correct.
5. Pricing Basic button says **Continue for free**.
6. Pricing modal does not visibly mutate button text after first paint.
7. Email-step validation catches invalid emails before username/password.
8. Existing-account steer goes to Log In honestly.
9. Back and logo/home clear stale paid-intent markers outside active checkout path.
10. Basic verification returns to login with no paid markers.
11. Pro verification returns to login with Pro intent preserved.
12. Login after verified Pro continuation enters checkout.
13. Premium checkout starts correctly and does not inherit Pro trial.
14. Trial/entitlement state is checked against server/vendor truth when implicated.
15. Supabase redirect config and `APP_BASE_URL` are verified when auth callback behavior is implicated.

### Layout/rendering checks when shell, modal, or CSS was touched

1. Major modal surfaces do not visibly compete for the same space.
2. Settings header/close X are reachable in mobile landscape.
3. Long modal/settings content scrolls internally.
4. Bottom bars do not overlap or stack incorrectly.
5. Extreme latency is observed when a change could affect shell hydration or modal arbitration.
6. No z-index-only or hiding-only fix is accepted unless valid open/closed state has been proven.

---

## 15. Active watch buckets

> **Doc authority:** watch buckets must still obey the owner and runtime docs cited above. Each bucket below is ledger-owned as a runtime-tested open item until it is promoted into an accepted artifact and, when necessary, into the appropriate authority doc under [`00_README.md`](./00_README.md#package-maintenance-rules).


### Bucket A — Latency visibility / Lane C

Status:

- active or pending branch work.

Problem:

- Under severe throttling, rapid cloud skips can advance highlight/session intent before cloud restart applies.

Acceptance target:

- user-visible pending state,
- request-id-safe cleanup,
- no broad skip rewrite,
- no reopening of v4 TTS core.

### Bucket B — Autoplay full-page pre-synth

Status:

- separate feature slice.

Problem/opportunity:

- Engaged autoplay continuation should not always pay Phase 1 duplicate-window cost.

Acceptance target:

- full-page pre-synth during countdown only after natural prior-page completion with no skip/manual/cancel,
- fallback to Phase 1 if not ready,
- no public/browser route application,
- no replay/skip/cache-contract rewrite.

### Bucket C — Mobile settings/layout

Status:

- active or pending shell/CSS bucket.

Problem:

- Settings modal too tall in mobile landscape; close/header outside viewport.

Acceptance target:

- close/header reachable,
- internal scroll,
- no background scroll leak,
- no TTS/runtime ownership change.

### Bucket D — Pricing/auth cleanup

Status:

- active or pending billing/auth correction bucket.

Problems:

- pricing modal button text mutation,
- stale paid marker after logo/home abandonment,
- email-step validation split,
- HTML email/operator config verification,
- Supabase email rate limiting can interrupt testing.

Acceptance target:

- settled pricing first paint,
- URL paid markers cleared outside active checkout path,
- email-step and final validation synced,
- styled HTML confirmation template with provider-backed confirmation URL,
- verified continuation tested after Supabase rate limit clears.

---

## 16. Forbidden future fixes without dedicated review

> **Doc authority:** these prohibitions condense [`03_ARCHITECTURE_AND_GUARDRAILS.md`](./03_ARCHITECTURE_AND_GUARDRAILS.md#patch-disqualifiers), [`03_ARCHITECTURE_AND_GUARDRAILS.md`](./03_ARCHITECTURE_AND_GUARDRAILS.md#anti-pattern-blacklist), and [`04_IMPLEMENTATION_WORKFLOW.md`](./04_IMPLEMENTATION_WORKFLOW.md#patch-safety-rules).


Do not accept future patches that:

1. Move reading/playback truth into shell.
2. Use DOM class state as source of current-page truth.
3. Reintroduce passive scroll as page/progress owner.
4. Reintroduce fake-active TTS state.
5. Treat cloud voice selection as executable truth in public/signed-out route.
6. Reintroduce `plan_id` as entitlement truth.
7. Guess trial eligibility client-side.
8. Hide modal leaks with z-index alone before proving whether the modal should be open.
9. Add spoken End-of-Chapter without a dedicated accepted design.
10. Add voice preview that interferes with active reading.
11. Persist retired settings as backend/client durable state.
12. Patch against the wrong base or chain diffs on stale workspaces.
13. Skip root-shape verification before patching.
14. Ignore Supabase, Stripe, Vercel, env, or schema truth when billing/auth/entitlement/deployment behavior is implicated.
15. Treat diagnostics-only visibility as sufficient for a real user-facing pending state.
16. Patch CSS/layout around a runtime ownership bug without proving the owner first.
17. Reopen broad TTS sequencing to fix a narrow latency visibility problem.
18. Mix autoplay pre-synth optimization into unrelated TTS bugfixes without explicit approval.

---

## 17. High-risk owner files

> **Doc authority:** file responsibility comes from [`01_PROJECT_STATE.md`](./01_PROJECT_STATE.md#current-code-shape), [`03_ARCHITECTURE_AND_GUARDRAILS.md`](./03_ARCHITECTURE_AND_GUARDRAILS.md#current-file-map), and the route/file maps in [`05_PRODUCT_LAUNCH_AND_INTEGRATION.md`](./05_PRODUCT_LAUNCH_AND_INTEGRATION.md#data-ownership-and-authority-map). This ledger marks files as high-risk based on tested regression history.


Revise as the codebase changes.

### Runtime/TTS

- `js/tts.js`
- `js/library.js`
- `js/state.js`
- `js/sync.js`
- `server/lib/ai-tts.js`

### Auth/billing/trial

- `js/auth.js`
- `js/billing.js`
- `js/shell.js`
- `server/lib/billing-checkout.js`
- `server/lib/billing-trials.js`
- `server/lib/billing-trial-eligibility.js`
- `server/lib/app-public-config.js`
- `server/lib/env.js`
- `server/lib/app-auth-email-check.js`

### Shell/layout/rendering

- `css/shell.css`
- `index.html`
- any file controlling modal arbitration, pricing modal display, settings modal layout, or boot-time surface selection.

### Durable/sync/devtools

- `js/sync.js`
- `js/state.js`
- `js/devtools.js`
- `server/lib/app-durable-sync.js`
- `server/lib/app-dev-tools.js`

---

## 18. Artifact acceptance record template

> **Doc authority:** deliverable fields and handoff obligations are owned by [`04_IMPLEMENTATION_WORKFLOW.md`](./04_IMPLEMENTATION_WORKFLOW.md#deliverables-policy). This template adds the project’s runtime-protection fields.


Use this section for every future accepted runtime artifact.

### Artifact: `__________`

**Accepted date:** `__________`

**Based on:** `__________`

**Diffs included:**

- `__________`
- `__________`

**Changed files:**

- `__________`

**Behavior accepted:**

- `__________`

**Behavior explicitly not accepted / held:**

- `__________`

**Runtime tests passed:**

- `__________`

**Known regression risks / watches:**

- `__________`

**External truth checked:**

- Supabase: yes / no / not relevant
- Stripe: yes / no / not relevant
- Vercel/env: yes / no / not relevant
- Schema/docs: yes / no / not relevant

**Next patch base:** `__________`

---

## 19. Open decisions to resolve as the system stabilizes

> **Doc authority:** when an open decision changes project truth, update the owning doc listed in [`00_README.md`](./00_README.md#package-maintenance-rules) rather than letting this ledger become the only source.


1. Which artifact is the current preferred integrated patch base after active branches land?
2. Which artifacts are tested references but no longer patch bases?
3. Is `jubly-reader-ttsv5.zip` accepted as successor in any specific lane, or still under observation?
4. What is the final status of Lane C latency visibility?
5. What is the final status of autoplay full-page pre-synth?
6. What is the final status of mobile settings/modal layout?
7. What is the final status of Group A auth/pricing cleanup after Supabase rate limits clear?
8. Which vendor settings are confirmed in Supabase for auth confirmation and redirect allow-list?
9. Which Vercel/env values are confirmed for `APP_BASE_URL`, trial flags, and checkout behavior?
10. Which runtime checklist items become mandatory for every release versus only owner-specific releases?

---

## 20. Short engineer reminder

> **Doc authority:** this reminder summarizes [`03_ARCHITECTURE_AND_GUARDRAILS.md`](./03_ARCHITECTURE_AND_GUARDRAILS.md), [`04_IMPLEMENTATION_WORKFLOW.md`](./04_IMPLEMENTATION_WORKFLOW.md), and [`02_RUNTIME_CONTRACT.md`](./02_RUNTIME_CONTRACT.md). The detailed rules live there.


When in doubt:

- preserve tested behavior,
- patch from the named base,
- keep owner boundaries clean,
- prove external truth when billing/auth/entitlements are involved,
- do not widen TTS unless runtime evidence demands it,
- do not use shell/CSS to hide runtime state bugs,
- return a diff and runtime zip when runtime validation is expected,
- document what changed and what was deliberately preserved.
