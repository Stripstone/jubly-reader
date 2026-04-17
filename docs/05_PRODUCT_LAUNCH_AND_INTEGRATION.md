# Jubly Reader — Product, Launch, and Integration

This document covers:
- product flow
- business surfaces
- auth and billing wiring
- launch gating
- browser-vs-backend protection policy

If earlier docs, prototype UI, audit notes, or older onboarding language conflict with this document for those areas, this document wins.
This document does not override architectural disqualifiers; launch is not honest when it depends on structural non-compliance.

## Product experience in one paragraph
The user should see value quickly with low friction. A new visitor lands on a focused landing page, uses **Try it now** to enter the sample reading experience directly, and may exit into the intro library without creating an account. Ownership and expansion actions gently require account creation. Plan choice appears early and clearly through pricing. Once a user signs up and pays, the product should stay out of the way: they remain signed in, keep their place, keep their settings where appropriate, understand what they have access to, and move through upgrades, downgrades, and usage resets without losing progress.

## Launch promise
Launch is honest only when a user can:
- open the app with low friction
- choose or import a document
- enter reading cleanly
- read page by page
- use TTS reliably
- leave reading without lingering state
- return to the correct place

## Governing product rules
1. Reading value comes first.
2. Pre-account users may read the sample book.
3. Account-backed continuity is the real ownership promise.
4. Pricing should appear early, once, then get out of the way.
5. There is no throwaway guest-session business path.
6. Basic, Pro, and Premium remain visible user-facing plans.
7. Usage exhaustion should fall back gracefully rather than destroy progress.
8. Tier loss should reduce capability and defaults, not delete user history.
9. Billing and account surfaces should feel like quiet support systems, not a second product.

## User states

### Visitor / pre-account user
A visitor has not signed in and has not created an account.

Should see:
- landing page
- Try it now
- Login
- Sign Up

Should not see:
- Profile
- token balance or usage badge
- billing management
- account-only library ownership controls presented as already available

Should be able to:
- open the sample book
- enter reading
- use the reading view for the sample experience

Account creation should be prompted by:
- importing books
- expanding the library beyond the sample
- actions that imply durable ownership or synced continuity
- non-basic or account-only feature paths

### Signed-in Basic user
Should have:
- durable account identity
- 2 book import slots
- baseline reading-view experience
- enough usage to experience the product
- daily reset of usage allowance

### Signed-in Pro user
Should have:
- 5 book import slots
- some cloud voices
- some themes
- more daily usage than Basic

### Signed-in Premium user
Should have:
- highest usage allowance
- broadest feature unlocks
- most generous voice, theme, and book capacity

Premium remains intentional and visible even if packaging evolves later.

## Route and page intent

### Public routes
- `/` — landing page with direct sample-reading entry
- `/pricing` — intended plan-choice route; interim modal or section-based pricing may remain while route-backed flow is completed
- `/login` — sign in
- `/signup` — account creation after plan choice

### Signed-in routes
- `/app` or `/library` — main signed-in app shell
- `/reading` may remain inside the app shell rather than becoming a separate billing/auth page

### Billing route
- optional thin `/billing-return` or callback surface if Stripe return handling needs it
- otherwise Manage Billing may return directly to `/app` or subscription context

## Canonical flows

### New user acquisition flow
1. User lands on `/`
2. Sees the landing CTA **Try it now** plus Login / Sign Up
3. `Try it now` opens the sample reading experience directly with no account wall
4. Exiting sample reading reveals the intro library
5. From the intro library, account-backed actions open pricing
6. Pricing presents Basic, Pro, or Premium
7. User chooses plan
8. User completes signup or login
9. If selected plan is Basic, user enters `/app` immediately
10. If selected plan is Pro or Premium, backend initiates Stripe checkout as needed
11. Runtime boots with account and entitlement truth

### Returning user flow
1. User opens `/login` or returns with an existing session
2. Supabase resolves the session
3. If valid, user goes directly to `/app`
4. Signed-in users bypass public friction by default
5. Runtime restores owned library, progress, settings, and entitlement truth after durable state is available

### Visitor tries an account-owned action
1. Visitor taps import or owned-library action
2. Public shell opens a subtle auth prompt
3. User chooses Login or Sign Up
4. Context may be preserved as a post-auth destination hint, but do not build a fake guest ownership model

### Upgrade from inside the app
1. User hits a locked feature or exhausted higher-tier capability
2. App shows a focused upgrade prompt tied to the value unlocked
3. User proceeds to pricing or checkout
4. Stripe updates billing
5. Backend writes durable entitlement state
6. App refreshes entitlement truth
7. User returns to the same flow with new capability available

### Manage Billing flow
1. Signed-in user opens Subscription
2. User taps Manage Billing
3. App requests a Stripe billing portal session from backend
4. User is handed off to Stripe portal
5. On return, the app refreshes entitlement and subscription summary

## Surface wiring rules

### Public surfaces
- avoid `free` as canonical plan vocabulary; marketing copy may invite trial, but product/runtime language must stay `basic / pro / premium`
- `Sign Up` is the canonical public acquisition action
- `Login` is the canonical returning-user entry
- `Try it now` is the canonical landing CTA for entering the sample reading experience
- `Continue with Google` and Email/Password should preserve selected plan intent
- sample-book reading should remain available pre-account
- account-only actions should prompt pricing/auth rather than pretending to work

### Signed-in surfaces
- `Profile` appears only for signed-in users
- `Manage Billing` should be a thin launcher into Stripe portal
- subscription summary should display resolved durable entitlement truth
- token or usage display should appear only where it is truly helpful and backed by real values
- manual tier selector buttons are development-only and must not remain production authority

### Pending and re-hydration framework requirement
- account, billing, usage, restore, and other server-backed shell/value surfaces must use safe pending, neutral, hidden, or locked states rather than believable wrong values
- `pending-surfaces.md` is the maintained framework companion for these surfaces and must be updated when they change
- dead-end account or billing buttons are launch failures, not minor polish issues
- interim modal or section-based public flows still have to obey this framework while route-backed final surfaces are being completed

## Data ownership and authority map

### Shell owns
- route and page presentation
- prompts and modals
- CTA placement
- displaying resolved account and subscription summaries
- handing user intent to auth, billing, and runtime APIs

### Runtime owns
- reading behavior
- active page truth
- restore and continuity
- importer lifecycle
- applying allowed feature fallbacks once entitlement truth is known

### Supabase owns
- auth identity
- durable user row
- owned library items
- progress
- compact metrics
- daily stats
- user preferences that are intentionally durable
- entitlement snapshot or linkage fields needed by the app

### Stripe owns
- plan purchase
- trials
- recurring billing
- invoices
- payment methods
- billing portal operations

### Backend owns
- verifying the authenticated user
- creating Stripe checkout sessions
- creating Stripe billing portal sessions
- verifying Stripe webhooks
- writing resulting entitlement state to durable records
- provider selection, prompt-bearing work, and other protected logic moved off the browser

## Plan and feature resolution model
Public plan labels:
- Basic
- Pro
- Premium

At runtime boot, derive one resolved entitlement object such as:
- `tier`
- `status`
- `provider`
- `import_slot_limit`
- `usage_daily_limit`
- `cloud_voice_access`
- `theme_access`
- `premium_feature_flags`

`tier` is the canonical runtime feature-gate vocabulary and must use only `basic / pro / premium`.
`provider` and `status` support billing/source interpretation, but must not replace `tier` as the feature gate.
Shell and runtime should consume resolved entitlement truth.
Do not scatter plan logic across many DOM checks or cosmetic UI states.

## Usage, slots, downgrade, and reset behavior

### Daily usage reset
The user-facing promise is daily reset.
Implementation should prefer one clear server-side interpretation rather than client-local ambiguity.

### Exhaustion rule
When usage is exhausted:
- preserve progress
- preserve settings that are meant to persist
- preserve uploaded book references and history when feasible
- disable or reduce higher-tier actions
- fall back to lower-tier or default paths

### Slot enforcement rule
When plan limit becomes lower than current owned count:
- do not auto-delete books
- disallow new additions beyond the lower limit
- if the user deletes one while over the new limit, do not reopen blocked capacity until they are within plan limit

### Theme and feature fallback rule
When a feature is no longer allowed:
- keep account history intact
- revert active surface to the nearest allowed default
- explain the state change calmly where needed

## Launch gate
A patch or build cannot be launch-acceptable merely because user-visible flows appear to work.
If launch-critical truth lives in the wrong owner layer, wrong file family, or wrong persistence surface, the build is structurally non-compliant and launch is not honest.


### Runtime-owned requirements
These must be true in code and runtime behavior:
- reading entry is runtime-owned
- restore is runtime-owned
- TTS behavior is runtime-owned
- importer reset is runtime-owned
- exit cleanup is runtime-owned
- tier and mode enforcement is runtime-owned once entitlement truth is resolved
- theme and appearance truth are runtime-owned

### Shell-owned requirements
These must be true in presentation:
- layout is stable
- controls are reachable
- library and profile are centered and not clipped
- footer behaves correctly
- theme and tier visuals match actual runtime state
- theme controls stay presentation-only, not policy owners

### Architectural requirements
These must be true before launch is honest:
- current production artifact matches the documented scaffold shape
- prototype-only conveniences are removed, locked to development, or clearly non-authoritative
- no launch-critical truth is split across shell and runtime without an explicit temporary bridge rule
- current architecture docs and current code agree on where truth lives
- shell HTML and shell presentation files do not become hidden owners of launch-critical behavior
- retired legacy gates do not survive as live behavior switches

### Code-exposure requirements
These must be true before launch is honest:
- the public browser bundle does not contain avoidable crown-jewel business logic
- the frontend bundle is limited to presentation, local responsiveness, and thin adapters
- prompts and non-obvious orchestration rules are not unnecessarily exposed in client JS
- provider and fallback policy is server-owned where feasible
- public production bundles do not expose source maps by default
- protected-code work does not break runtime reading responsiveness or truth

## Minimal frontend and protected-logic policy
Anything shipped to the browser should be treated as inspectable.

The frontend should keep only what must remain browser-side for:
- rendering and presentation
- local reading interaction and responsiveness
- local runtime state required for truthful controls
- visual and theme application
- device-only flows
- thin adapters that call backend-owned truth

The frontend must not be the primary home of:
- entitlement, plan, trial, or usage truth
- provider-selection or fallback policy
- prompts or prompt contracts
- premium-resolution logic
- non-obvious orchestration or algorithmically valuable rules
- hidden debug or override paths that expose internal policy

Obfuscation may be used as friction, not as the main protection model.

## Current settings and persistence direction
- theme truth is runtime-owned
- appearance truth is runtime-owned
- `appearance_mode` persists locally only
- `tts_speed` is not part of the durable synced settings contract
- `use_source_page_numbers` is retired as a configurable and replaced by fixed runtime page-number behavior
- diagnostics preferences and devtools-only toggles are not durable product truth
- heavy local assets remain device-local

## Current Supabase scope
Planned durable records:
- users
- owned library items
- reading progress
- compact per-book metrics
- compact daily stats
- durable user preferences that are intentionally synced
- entitlement state
- usage window summary

Still pending:
- frontend `supabase-js` integration
- signed-in progress sync
- signed-in durable settings sync
- backend JWT verification
- Stripe webhook write path
- auth-linked routing decisions

## Environment variables
Authoritative names:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SECRET_KEY`

Rules:
- only `SUPABASE_URL` and `SUPABASE_ANON_KEY` belong in frontend client initialization
- `SUPABASE_SECRET_KEY` is backend-only

## Validation checklist
First apply the structural compliance gate from `03_ARCHITECTURE_AND_GUARDRAILS.md`.
Use the runtime evaluation lens from `02_RUNTIME_CONTRACT.md` only after that gate passes.

For persistence and account-backed behavior, always check:
- state transitions
- settings
- value rendering
- reading continuity

Launch-failing examples include:
- changing account, billing, or usage loading behavior without updating `pending-surfaces.md`
- flashing page 1 before restore catches up
- showing a believable but wrong usage value before account truth loads
- showing a setting change immediately and then snapping back unexpectedly
- leaving stale signed-in or continue state visible after sign-out
- delaying a modal shell until server verification returns
- allowing gated actions before required verification settles


Structural launch failures also include:
- launch-critical logic inserted into `index.html` or shell presentation files as an owner
- duplicate truth across shell, runtime, backend, or durable sync
- DOM-driven authority or hidden control clicks used as real state
- durable settings or devtools resurrecting retired behavior gates
- accepting a patch because it "works" while documented ownership remains violated

## Production cleanup required before or during integration
Remove or hide from production:
- manual tier selector buttons used for simulation
- fake login path
- fake logout reload path
- always-visible pre-account token balance surfaces
- dead-end billing buttons

Replace with real flows:
- login scaffold → Supabase auth
- local entitlement simulation → resolved entitlement object
- static subscription summary → durable subscription truth
- pricing modal-only thinking → route-backed pricing surface
