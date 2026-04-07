# Jubly Reader — IP, Code Exposure, Obfuscation, and Copyright Policy

_Status: active launch policy_

## Purpose
This document explains, in plain language, how Jubly Reader should treat code exposure, code protection, copyright, trade secrets, and brand/IP policy.

This is a product-and-engineering policy document, not legal advice.

This document is not standalone.
Read it alongside:
- `02_RUNTIME_CONTRACT.md`
- `03_ARCHITECTURE_MAP.md`
- `05_LAUNCH_AND_INTEGRATION.md`
- `07_AUTH_BILLING_WIRING_GUIDELINE.md`
- `09_ARCHITECTURAL_GUARDRAILS_AND_SCAFFOLD_DISCIPLINE.md`

## The simple rule
For this system:

- **Anything shipped to the browser should be treated as inspectable.**
- **Anything we truly need to protect should not live primarily in browser JavaScript.**
- **Obfuscation is allowed as friction, not as the main protection model.**
- **Copyright protects our expression, not the underlying methods or logic alone.**
- **Trade-secret protection requires us to actually keep sensitive material secret.**

## What counts as IP in this system
High-value IP in Jubly Reader includes:

- large logic-heavy runtime systems that would help a copycat clone behavior quickly
- prompts and prompt contracts
- provider-selection and premium-feature policy
- usage / entitlement / gating logic
- evaluation, summary, import-conversion, and TTS policy logic
- any non-obvious algorithms or orchestration rules

Lower-risk material includes:

- ordinary HTML/CSS layout
- simple UI wiring
- obvious boilerplate patterns
- branding elements that are expected to be publicly visible

## Core product rule
### 1. Browser code is not secret
If code is downloaded and run by the browser, users can inspect it.

That means browser JavaScript is not where crown-jewel business logic should permanently live.

### 2. Protected logic belongs server-side when possible
If a rule is:
- business-critical
- premium-sensitive
- usage-sensitive
- provider-selection-sensitive
- algorithmically valuable

then the default target is:
- **Vercel serverless/backend code**, not the browser runtime.

### 3. The browser keeps only what it truly must do locally
The browser should keep:
- rendering
- page interaction
- local reading controls
- local runtime state needed for responsiveness
- local visual/theme application
- device-only flows that must happen in the browser

It should not be the primary home of the most valuable logic.

## Architectural discipline consequence
Protected-code work fails if scaffold and ownership discipline are weak.

Practical rule:
- first remove duplicate truth layers
- then identify crown-jewel logic in client files
- then move the protected decisions server-side where feasible
- do not let prototype conveniences or mixed-era scaffolds keep policy logic alive in the browser by accident

## Obfuscation policy
### What obfuscation is for
Obfuscation is for:
- reducing casual copying
- making inspection slower
- making production bundles less readable than development source

### What obfuscation is **not** for
Obfuscation is **not** our main protection model.
It does **not** create real secrecy if the browser still has to execute the code.

### Allowed obfuscation policy
At launch:
- production client code may be minified
- production client code may be selectively obfuscated
- production source maps should not be public unless there is a strong operational reason
- debug-only artifacts should not be exposed publicly

### Forbidden assumption
Do not say or assume:
- “the JS is safe because it is obfuscated”
- “users cannot get the code because it is minified”

## Copyright policy
### What copyright protects for us
Copyright protects our original expression, including:
- source code text
- prompt wording
- written docs
- artwork/assets
- UI copy

### What copyright does **not** protect well by itself
Copyright does not protect the underlying:
- idea
- method
- system
- process
- algorithm
- product logic in the abstract

So copyright helps, but it does not solve the "copy the behavior" problem by itself.

### Policy consequence
We should still:
- keep proper copyright notices in the repo and product where appropriate
- consider registration for important code/assets when commercially appropriate
- avoid relying on copyright alone as our secrecy plan

## Trade-secret policy
### What a trade secret means for us
If we want something to function like a trade secret, we must take reasonable steps to keep it secret.

### Practical rule
Treat these as trade-secret candidates:
- prompts
- premium-resolution logic
- provider/fallback policy
- orchestration rules
- non-obvious evaluation/import/TTS business logic

If they are crown-jewel material, they should not live mainly in browser-delivered JS.

### Policy consequence
For trade-secret candidates:
- keep them server-side when possible
- restrict access internally
- do not publish them in source maps or debug artifacts
- do not hard-code them into public bundles unless unavoidable

## Brand / trademark policy
Brand is expected to be publicly visible.
That is normal.

For brand protection:
- use the correct product name consistently
- reserve the names/domains/handles we care about
- pursue trademark registration when commercially appropriate

Brand copying is a different problem from code/logic copying.

## Jubly Reader technical policy
### Crown-jewel logic should move off exposed JS
For Jubly Reader, the default direction is:

**Keep local:**
- rendering
- reading UI flow
- local runtime responsiveness
- visual/theme application

**Move backend-side where possible:**
- TTS provider policy
- premium feature resolution
- usage enforcement
- entitlement resolution
- prompts and prompt contracts
- evaluation logic
- import conversion policy
- any algorithmically valuable decision logic

### Runtime rule remains important
We should not destroy the local reading experience just to move code.
Runtime-owned reading behavior should remain responsive and truthful locally.

So the target is **not** “move the whole app server-side.”
The target is:
- keep the browser lean
- move crown-jewel decisions out of exposed JS

## How this changes other docs
- `02_RUNTIME_CONTRACT.md` still wins on user experience. Protected-code work must not regress reading continuity, TTS truth, restore, importer honesty, or exit cleanup.
- `03_ARCHITECTURE_MAP.md` defines the browser-vs-runtime-vs-backend ownership split. This policy adds a protection rule, not a second ownership model.
- `05_LAUNCH_AND_INTEGRATION.md` must treat avoidable crown-jewel browser exposure as part of the launch gate.
- `07_AUTH_BILLING_WIRING_GUIDELINE.md` already provides the resolved entitlement object pattern that should replace scattered client-side plan logic.
- `09_ARCHITECTURAL_GUARDRAILS_AND_SCAFFOLD_DISCIPLINE.md` defines the scaffold and ownership discipline required so protected-code work does not recreate prototype debt.

## Engineer decision test
### Keep it in browser only if all are true
- it must run locally for responsiveness or browser-only interaction
- exposing it would not materially help a copycat
- it is not provider-selection, entitlement, usage, prompt, or premium-policy logic
- moving it backend-side would materially harm the runtime contract

### Move it backend-side if any are true
- it resolves plan, entitlement, or usage truth
- it selects provider or fallback policy
- it contains prompts or non-obvious orchestration
- it is algorithmically valuable
- it would materially shorten a copycat’s path if exposed in the public bundle

### Do not
- put crown-jewel policy in `config.js`
- rely on obfuscation as the main protection model
- leave old domains or public debug paths as canonical
- move code server-side in a way that breaks runtime truth promised in `02_RUNTIME_CONTRACT.md`
- keep protected logic client-side simply because prototype wiring made it convenient

## Source-map and debug policy
Production should not publicly expose:
- source maps
- debug files
- internal-only diagnostic endpoints unless explicitly needed
- hidden provider/debug switches in public bundles

## Launch requirement
Before launch, Jubly Reader should satisfy all of the following:

1. The public browser bundle does not contain avoidable crown-jewel business logic.
2. Prompts and non-obvious orchestration rules are not unnecessarily exposed in client JS.
3. Provider/fallback policy is server-owned where possible.
4. Public production bundles do not expose source maps or similar debug aids by default.
5. Branding is consistent and old domains/links are redirected to the canonical public domain.
6. The browser remains fast and truthful for reading behavior.
7. Architectural discipline is strong enough that protected logic does not quietly drift back into browser-owned prototype paths.

## What this means for engineering order
Recommended order:

1. remove duplicate truth layers in client JS
2. identify crown-jewel logic in client files
3. move those decisions to `/api/*` where feasible
4. leave only required local runtime behavior in the browser
5. add production obfuscation/minification and keep source maps private
6. keep copyright/trademark hygiene in parallel

## One-sentence policy summary
**Jubly Reader protects its real IP by keeping crown-jewel logic and prompts off exposed browser JS whenever possible, while treating client obfuscation as friction and copyright as supportive—but not sufficient—protection.**

## Source notes
- U.S. Copyright Office — Copyright Basics / Computer Programs / FAQs
- USPTO — Trade Secret Toolkit
- OWASP — Information Leakage / Source Map guidance
- MDN — client-side code and source-map behavior
