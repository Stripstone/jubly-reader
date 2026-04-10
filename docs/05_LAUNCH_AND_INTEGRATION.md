# Jubly Reader — Launch and Integration

This document covers launch gating and external integration.

`08_IP_AND_CODE_PROTECTION_POLICY.md` is part of this launch package.
If browser-vs-backend exposure decisions are relevant to launch readiness, read `08` alongside this document.
Read `09_ARCHITECTURAL_GUARDRAILS_AND_SCAFFOLD_DISCIPLINE.md` alongside this document when scaffold or ownership stability is part of launch risk.

## Launch promise
Launch is honest only when a user can:
- open the app with low friction
- choose or import a document
- enter reading cleanly
- read page by page
- use TTS reliably
- leave reading without lingering state
- return to the correct place

## Launch gate

### Runtime-owned requirements
These must be true in code and runtime behavior:
- reading entry is runtime-owned
- restore is runtime-owned
- TTS behavior is runtime-owned
- importer reset is runtime-owned
- exit cleanup is runtime-owned
- tier/mode enforcement is runtime-owned once entitlement truth is resolved
- theme and appearance truth are runtime-owned

### Shell-owned requirements
These must be true in presentation:
- layout is stable
- controls are reachable
- library/profile are centered and not clipped
- footer behaves correctly
- theme/tier visuals match actual runtime state
- theme controls stay as presentation surfaces, not policy owners

### Architectural discipline requirements
These must be true before launch is considered honest:
- current production artifact matches the documented scaffold shape
- prototype-only conveniences are removed, locked to development, or clearly non-authoritative
- no launch-critical truth is split across shell and runtime without an explicit temporary bridge rule
- mixed-era scaffold assumptions are not present in packaging, deployment, or patch flow
- current architecture docs and current code agree on where app truth lives

### Code-exposure requirements
These must be true before launch is considered honest:
- the public browser bundle does not contain avoidable crown-jewel business logic
- the frontend bundle is limited to presentation, local responsiveness, and thin adapters rather than owning protected business or policy truth
- prompts and non-obvious orchestration rules are not unnecessarily exposed in client JS
- provider/fallback policy is server-owned where feasible
- public production bundles do not expose source maps or similar debug aids by default
- old public domains and links redirect to the canonical public domain
- protected-code work does not break runtime reading responsiveness or truth

## Current launch priorities
1. runtime continuity first
2. shell layout stability second
3. protected-logic redistribution and code-exposure reduction third
4. architectural/scaffold integrity fourth
5. launch regression testing fifth
6. external integrations after that

## Supabase role
Supabase is the cloud persistence layer for runtime-owned truths.

It should store:
- users
- progress
- sessions
- settings
- future entitlements

It should not:
- replace runtime state logic
- become a shell-side state model
- define restore behavior by itself

## Current settings/persistence direction
The theme enhancement now uses a runtime-owned persistence seam.

That means:
- runtime owns theme truth
- runtime owns appearance truth
- runtime owns Explorer settings truth
- durable prefs are routed through adapter functions
- local-only heavy assets remain device-local

This keeps later Supabase work additive rather than forcing a theme ownership rewrite.

### Durable sync-safe preference examples
- `theme_id`
- `appearance`
- Explorer options
- ambience toggles
- diagnostics preference

### Local-only heavy assets for now
- uploaded custom music blobs
- user-provided binary assets
- caches

## Current Supabase scope

### Planned durable records
- account state
- reading progress
- settings
- session history
- future billing/entitlement state

### Still pending
- frontend `supabase-js` integration
- signed-in progress sync
- signed-in settings sync
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

## Runtime validation lens

Use the runtime experience evaluation lens from `02_RUNTIME_CONTRACT.md` when judging launch readiness.

For persistence and account-backed behavior, always check:
- state transitions
- settings
- value rendering
- reading continuity

For each category, judge:
- client immediate
- mutations
- server settle
- later truth
- must not happen

Launch is not honest if the app merely settles to the right answer later after first showing a believable wrong state.

Examples of launch-failing patterns:
- flashing page 1 before restore catches up
- showing a believable but wrong usage value before account truth loads
- showing a setting change immediately and then snapping back unexpectedly
- leaving stale signed-in or continue state visible after sign-out


### Reading continuity
- open document
- advance beyond page 1
- leave and return
- confirm correct page restore

### TTS
- current page playback is correct
- pause/play is correct
- speed is correct on start, resume, and page transition
- speed changes during active TTS behave according to the runtime contract
- exit stops reading-owned audio cleanly

### Importer
- close clears staged state
- dismiss clears staged state if supported
- reopen shows clean state

### Layout
- footer stays below content
- library/profile do not clip or overlay
- reading controls remain reachable at narrow widths

### Themes / appearance
- switching theme preserves reading layout stability
- Explorer customization stays scoped to reading content only
- bars remain governed by global Light/Dark appearance
- theme gating follows runtime-owned entitlement checks
- child modals in reading stack above parent reading settings correctly

### Architectural/scaffold integrity
- deployed artifact matches the documented folder scaffold
- no production path depends on dev-only simulation controls
- no launch-critical truth is only reachable through shell workaround paths
- current docs still match the live artifact shape used for deployment

### Code exposure
- old public domains redirect to the canonical domain
- public bundles do not expose source maps by default
- crown-jewel provider/premium/orchestration policy is not left in browser JS unnecessarily
- the browser remains fast and truthful for reading behavior after redistribution

### Signed-in persistence later
- settings restore after sign-in
- progress restores to correct source/page across devices
- session history does not overwrite restore truth
- durable prefs restore without trying to sync heavy local-only assets blindly

## Open integration questions
- when should signed-in users bypass landing friction?
- what is the exact runtime API surface for reading entry/exit after cleanup?
- what should be synced immediately versus deferred until after launch?
- when should theme/appearance persistence adapters start reading from Supabase-backed records rather than local-only durable prefs?
