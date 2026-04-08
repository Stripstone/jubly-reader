# Jubly Reader — Auth and Billing Wiring Guideline

This document explains how to wire auth, pricing, subscription, billing, usage, and entitlement surfaces into the current architecture without breaking runtime authority.

If earlier documentation, scaffold behavior, or prototype UI conflict with this document for auth/billing implementation, this document wins.

## Purpose
Build real Supabase and Stripe integration in a way that feels seamless to the user and does not regress the runtime-owned reading experience.

## Non-negotiable architecture rule
The reading runtime still owns:
- reading entry
- active page truth
- TTS lifecycle
- restore and continuity
- importer lifecycle
- reading exit cleanup
- theme and appearance truth
- feature gating decisions once entitlement state is resolved

Auth, billing, and persistence must support that runtime truth rather than compete with it.

---

# 1. Target system shape

## 1.1 Surface layers
### Public shell
Purpose:
- show value quickly
- expose sample-book experience
- route users into login/signup/pricing

### Signed-in app shell
Purpose:
- host the real owned experience
- show library/profile/subscription/account surfaces
- initialize runtime with durable account state and entitlement truth

### Runtime
Purpose:
- continue owning reading behavior
- read entitlement/settings/progress from a resolved durable model
- never guess billing or auth state from DOM alone

### Supabase
Purpose:
- own identity and durable records
- store users, settings, progress, sessions, and entitlement snapshots/links

### Stripe
Purpose:
- own checkout, billing, invoices, payment methods, renewals, cancellations, and portal workflows

---

# 2. Recommended route and page tree

## Public routes
- `/` — app-like entry with sample book and Login / Sign Up
- `/pricing` — Free / Pro trial / Premium
- `/login` — sign in
- `/signup` — account creation after plan selection

## Signed-in routes
- `/app` or `/library` — main signed-in app shell
- `/reading` may remain inside the app shell rather than becoming a separate billing/auth page

## Billing route
- optional thin `/billing-return` or callback surface if Stripe return handling needs it
- otherwise Manage Billing should return to `/app` / Subscription context

## Why this split
This separates:
- public acquisition surfaces
- account/auth surfaces
- the real app shell

without fragmenting the reading runtime itself.

---

# 3. Canonical flows to wire

## 3.1 New user plan-first signup flow
1. User enters `/`.
2. User explores sample book.
3. User chooses Sign Up.
4. App sends user to `/pricing` unless a plan is already selected.
5. User selects Free, Pro trial, or Premium.
6. App stores selected plan intent temporarily.
7. App sends user to `/signup`.
8. User creates account.
9. Supabase creates/links user record.
10. If selected plan is Free, user enters `/app` immediately.
11. If selected plan is Pro trial or Premium, app initiates Stripe checkout/trial setup as needed, then returns user into `/app`.
12. Runtime boots with account and entitlement truth.

## 3.2 Returning user login flow
1. User opens `/login` or returns with an existing session.
2. Supabase resolves the session.
3. If valid, user goes directly to `/app`.
4. Signed-in users should bypass public friction by default.
5. Runtime restores owned library/progress/settings after durable state is available.

## 3.3 Visitor tries account-owned action
1. Visitor taps import or owned-library action.
2. Public shell opens subtle auth prompt.
3. User chooses Login or Sign Up.
4. Context may be preserved as a post-auth destination hint, but do not build complex guest ownership logic.

## 3.4 Upgrade from inside the app
Canonical in-app upgrade trigger should be:
- locked feature or exhausted higher-tier capability

Secondary upgrade paths:
- Subscription → View Pricing
- Subscription → Upgrade to Premium

Flow:
1. User hits locked feature or exhausted higher-tier capability.
2. App shows focused upgrade prompt with the specific value unlocked.
3. User proceeds to pricing/checkout.
4. Stripe updates billing.
5. Backend writes durable entitlement state.
6. App refreshes entitlement truth.
7. User returns to the same flow with new capability available.

## 3.5 Manage Billing flow
1. Signed-in user opens Subscription.
2. User taps Manage Billing.
3. App requests a Stripe billing portal session from backend.
4. User is handed off to Stripe portal.
5. On return, app refreshes entitlement/subscription summary.

---

# 4. Surface-by-surface wiring rules

## 4.1 `Try it free` / public Sign Up CTA
Wire to:
- pricing first

Do not wire to:
- fake login
- guest session bootstrap
- direct entry into owned app state

## 4.2 `Login`
Wire to:
- Supabase auth flow

On success:
- resolve session
- enter `/app`
- fetch durable records needed for initial shell/runtime state

## 4.3 `Continue with Google`
Wire to:
- Supabase social auth

Requirement:
- preserve pending plan intent if the user came from pricing

## 4.4 Sample book
Wire to:
- public runtime-safe reading path

Requirement:
- pre-account users may read the sample without account-backed ownership
- do not expose profile/token/account-only shell around that experience

## 4.5 Import / owned library actions
Wire visitors to:
- subtle auth prompt

Wire signed-in users to:
- runtime-owned import flow
- slot enforcement based on entitlement/plan

## 4.6 Pricing selection
Wire to:
- selected plan intent
- signup handoff

Requirement:
- Free, Pro trial, Premium must map to clear plan IDs internally
- preserve selected plan through auth and checkout

## 4.7 Checkout
Wire to:
- backend-created Stripe checkout session

Requirement:
- do not create Stripe sessions directly from fragile shell-only assumptions
- backend should know which authenticated user and which requested plan is involved

## 4.8 Manage Billing
Wire to:
- backend-created Stripe billing portal session

## 4.9 Subscription summary
Wire to:
- durable entitlement/subscription state

Should display:
- current plan
- renewal/cancel status where relevant
- feature summary
- current slot/usage limits if user-facing

## 4.10 Usage balance
Wire to:
- durable usage or server-authoritative usage summary if needed
- optionally mirrored locally for display only

Do not:
- let shell invent usage truth
- expose prototype diagnostic counters as production truth

---

# 5. Data ownership and authority map

## 5.1 Shell owns
- route/page presentation
- prompts and modals
- CTA placement
- displaying resolved account/subscription summaries
- handing user intent to auth/billing/runtime APIs

## 5.2 Runtime owns
- reading behavior
- active page truth
- restore and continuity
- importer lifecycle
- applying lower-tier fallbacks to runtime-owned feature sets
- enforcing feature access once entitlement truth is known

## 5.3 Supabase owns
- auth identity
- session state
- durable user row
- progress
- settings
- session/history
- entitlement snapshot or linkage fields needed by the app

## 5.4 Stripe owns
- plan purchase
- trial state
- recurring billing
- invoices
- payment methods
- billing portal operations

## 5.5 Backend owns
- verifying the authenticated user
- creating Stripe checkout sessions
- creating Stripe billing portal sessions
- verifying Stripe webhooks
- writing resulting entitlement state to durable records

---

# 6. Suggested durable record shape

This is conceptual guidance, not a strict schema.

## Supabase durable records should cover
- `users`
- `user_settings`
- `user_progress`
- `user_sessions`
- `user_entitlements`
- optional `user_usage` summary if daily usage is persisted server-side

## Entitlement record should answer
- current plan
- trial status
- billing status
- effective feature limits
- slot limits
- usage allowances
- renewal/end date if relevant

Runtime should consume resolved entitlement truth, not reconstruct it from Stripe concepts directly.

---

# 7. Plan and feature resolution model

## 7.1 Public plan labels
- Free
- Pro
- Premium

## 7.2 Internal resolution model
At runtime boot, derive one resolved entitlement object such as:
- `plan_id`
- `import_slot_limit`
- `usage_daily_limit`
- `cloud_voice_access`
- `theme_access`
- `premium_feature_flags`

This resolved object is what shell and runtime should read.

Do not scatter plan logic across many DOM checks or one-off `if premium then ...` rules.

## 7.3 Why this matters
This keeps plan changes, downgrades, and trials from leaking Stripe details all over the frontend.

---

# 8. Downgrade and exhaustion wiring

## 8.1 Exhaustion rule
When usage is exhausted:
- preserve progress
- preserve settings
- preserve existing uploaded book references/history when feasible
- disable or reduce higher-tier actions
- fall back to lower-tier/default paths

## 8.2 Slot enforcement rule
When plan limit becomes lower than current owned count:
- do not auto-delete books
- disallow new additions beyond the lower limit
- if the user deletes one while over the new limit, do not reopen blocked capacity until they are within plan limit

## 8.3 Theme and feature fallback rule
When a feature is no longer allowed:
- keep account history intact
- revert active surface to the nearest allowed default
- explain the state change calmly where needed

---

# 9. Daily usage reset guidance

The user-facing promise is daily reset.
Implementation should prefer one clear server-side interpretation rather than client-local ambiguity.

Recommended direction:
- backend/server-authoritative daily reset window
- frontend displays remaining daily allowance only

Why:
- prevents timezone confusion
- prevents client tampering from becoming the source of truth
- aligns better with billing/entitlement records

---

# 10. Production cleanup required before or during integration

## Remove or hide from production
- manual tier selector buttons used for local simulation
- fake login path
- fake logout reload path
- always-visible pre-account token balance surfaces
- any dead-end billing buttons

## Replace with real flows
- `login()` scaffold → Supabase auth
- local tier simulation → resolved entitlement object
- static subscription summary → durable subscription truth
- pricing modal-only thinking → route-backed pricing surface

---

# 11. Safe implementation sequence

## Phase 1 — Public surface cleanup
- split or route public entry, pricing, login, signup surfaces
- remove pre-account Profile/token/business clutter
- keep sample-book proof path working

## Phase 2 — Supabase auth foundation
- implement session-aware login/signup
- establish post-auth routing
- add signed-in bypass of public friction

## Phase 3 — Durable account and entitlement model
- create durable records
- resolve plan and feature limits into one frontend-readable object
- make shell display resolved truth

## Phase 4 — Stripe purchase and billing portal
- implement checkout session creation
- implement webhook verification
- implement durable entitlement updates
- implement billing portal handoff

## Phase 5 — Runtime integration
- feed resolved entitlement object into runtime-owned gating
- implement graceful exhaustion/downgrade fallback behavior
- verify restore/progress continuity remains intact

---

# 12. Anti-patterns to avoid

Do not:
- keep auth and billing as dead buttons while pretending they are real
- put Stripe logic directly into fragile shell click handlers without backend verification
- let shell infer plan truth from cosmetic UI state
- let runtime reconstruct billing truth from scattered frontend values
- destroy progress or uploaded-state history on downgrade
- create a guest-state ownership model just to avoid designing the real acquisition path
- split reading runtime authority across many page-specific scripts

---

# 13. Implementation-ready summary

Build toward this user experience:
- visitor sees sample value quickly
- plan choice happens early and clearly
- account creation makes ownership real
- signed-in users skip unnecessary friction
- Stripe handles money
- Supabase handles identity and durable records
- runtime keeps owning the actual reading experience
- upgrade, downgrade, and exhaustion all feel calm and non-destructive

