# Reading Trainer — Business Surfaces and Intended Functionality

This document defines the intended user-facing behavior for auth, account, pricing, subscription, usage, and entitlement surfaces.

If earlier documentation, older mockups, or scaffold behavior conflict with this document, this document wins for those business surfaces.

The goal is to give implementation one clear target before Supabase and Stripe are fully wired.

## Product experience in one paragraph
The user should see value first, with almost no friction. A new visitor lands in a clean library-style app surface, sees one sample book, and can enter reading to experience the product. Ownership and expansion actions gently require account creation. Plan choice happens early and clearly through pricing. Once a user signs up and pays, the app should stay out of the way: they remain signed in, keep their place, keep their settings, understand what they have access to, and move through upgrades, downgrades, and usage resets without losing progress.

## Governing product rules
1. Reading value comes first.
2. Account-backed continuity is the real product promise.
3. Pricing should appear early, once, then get out of the way.
4. The sample book is the pre-account proof surface.
5. Do not hard-block the reading view itself for the sample flow.
6. Free, Pro, and Premium remain visible user-facing plans.
7. Usage exhaustion should fall back gracefully rather than destroy progress.
8. Tier loss should reduce capability and defaults, not delete user history.
9. Billing and account surfaces should feel like quiet support systems, not a second product.

## Business model decisions locked here
- There is no throwaway guest-session business path.
- Pre-account users land in a real app-like library surface.
- Pre-account users see Login and Sign Up in the top right.
- Pre-account users do not see Profile or token balance surfaces.
- Pre-account users may read the sample book.
- Pre-account users may not expand into full library ownership without creating an account.
- The first pricing choice is shown through plan selection.
- Flow: pricing first, then account creation, then full product.
- Free includes the currently available reading-view experience.
- Free includes 2 book import slots.
- Pro includes 5 book import slots.
- Usage resets daily.
- When higher-tier access is lost or usage runs out, the app falls back to lower-tier/default behavior without deleting saved progress.
- Premium remains visible even if parts of its packaging are still being refined.

---

# 1. User states

## 1.1 Visitor / pre-account user
A visitor has not signed in and has not created an account.

What they should see:
- app-like library entry surface
- one sample book
- Login
- Sign Up

What they should not see:
- Profile
- token balance / usage badge
- billing management
- account-only library management surfaces presented as available ownership actions

What they should be able to do:
- open the sample book
- enter reading
- use the reading view for the sample experience

What should softly prompt account creation:
- importing books
- expanding the library beyond the sample
- actions that imply durable ownership or synced continuity
- paid-only or account-only feature paths

## 1.2 Signed-in Free user
A user with an account on the Free plan.

What they should have:
- durable account identity
- 2 book import slots
- the currently available reading-view baseline
- enough usage to experience the product
- daily reset of usage allowance

What they should not have:
- higher-tier cloud voice access beyond Free allowance
- more than 2 import slots
- premium-only themes or fuller unlocks

## 1.3 Signed-in Pro user
A user with an account on the Pro plan.

What they should have:
- more books than Free
- 5 book import slots
- some cloud voices
- some themes
- more daily usage than Free

## 1.4 Signed-in Premium user
A user with the highest tier.

What they should have:
- highest usage allowance
- more of Pro+
- broadest feature unlocks
- most generous voice/theme/book capacity

Premium is distinct and remains visible user-facing.
Its exact packaging may evolve, but the tier itself is intentional and should not be hidden.

---

# 2. Page and route intent

This defines the intended product flow even if the current build is still scaffolded inside one HTML shell.

## Recommended public route set
- `/` — entry library-like experience
- `/pricing` — plan choice
- `/login` — sign in
- `/signup` — account creation after plan choice
- `/app` or `/library` — signed-in product shell
- `/billing` is not required as a dedicated app page if Stripe portal handoff is used

## Route behavior
### `/`
Purpose:
- show value quickly
- present the sample-book experience
- avoid heavy marketing friction

Primary surfaces:
- sample book
- Login
- Sign Up

### `/pricing`
Purpose:
- show the plan ladder once, early
- make the user pick Free, Pro trial, or Premium

Required options:
- Free
- Pro with 3-day trial
- Premium

### `/signup`
Purpose:
- create the account after plan choice
- preserve selected plan/trial intent through signup

### `/login`
Purpose:
- let returning users access their account and continuity quickly

### `/app` or `/library`
Purpose:
- serve as the signed-in shell for the real owned experience
- restore progress, settings, entitlement truth, and account surfaces

---

# 3. Surface inventory and intended functionality

Each surface below answers:
- where it appears
- who sees it
- what it should do
- what it should not do
- keep, merge, or remove recommendation

## 3.1 Entry and auth surfaces

### A. `Try it free`
Where:
- entry surface / landing-style CTA

Who sees it:
- visitors

Should do:
- open pricing
- present Free / Pro trial / Premium once
- continue into signup after plan selection

Should not do:
- create a throwaway guest session
- bypass plan selection
- silently log the user into a fake account

Recommendation:
- merge conceptually into the canonical Sign Up path
- acceptable as marketing copy if it still leads to pricing first

### B. `Sign Up`
Where:
- top right on public entry surfaces
- possibly pricing follow-up CTA

Who sees it:
- visitors

Should do:
- send the user into pricing if no plan is chosen yet
- send the user into signup with a selected plan if plan intent is already known

Should not do:
- drop the user into the product with no account

Recommendation:
- keep
- make this the canonical public acquisition action

### C. `Login`
Where:
- top right on public entry surfaces
- dedicated login page

Who sees it:
- visitors / returning users

Should do:
- open the login route
- sign in returning users
- return signed-in users to the app quickly

Should not do:
- send users through pricing again

Recommendation:
- keep
- make it the canonical returning-user entry

### D. `Continue with Google`
Where:
- login and/or signup

Who sees it:
- users entering auth flow

Should do:
- authenticate the user with Google
- preserve chosen plan/trial intent if arriving from pricing
- land the user in the correct post-auth destination

Should not do:
- act as a visually separate product path with different entitlement behavior

Recommendation:
- keep if launch supports Google
- otherwise hide until real

### E. `Email / Password`
Where:
- login and signup

Who sees it:
- users entering auth flow

Should do:
- authenticate or create account
- preserve plan selection

Recommendation:
- keep

### F. `Forgot password`
Where:
- login

Who sees it:
- users attempting sign-in

Should do:
- launch a real recovery flow

Should not do:
- remain visible as dead UI once auth is real

Recommendation:
- hide until real if recovery is not launch-ready
- otherwise keep as a complete path

### G. `Logout`
Where:
- Profile or account menu only

Who sees it:
- signed-in users

Should do:
- sign the user out cleanly
- clear account surfaces from the shell
- retain any allowed device-local non-account data only if product intentionally supports that

Should not do:
- just reload the page without auth state change

Recommendation:
- keep in account area only
- do not surface prominently elsewhere

## 3.2 Entry library surfaces

### H. Sample book card
Where:
- public entry library surface

Who sees it:
- everyone

Should do:
- open the sample book
- demonstrate the product with low friction
- allow reading-view access without an account

Should not do:
- imply that the visitor already owns a real library

Recommendation:
- keep
- this is the main value-proof surface

### I. Import book / library ownership actions
Where:
- library shell

Who sees it:
- visitors and signed-in users, depending on UI treatment

Should do for visitors:
- softly prompt Login or Sign Up
- explain that account creation unlocks owned books and continuity

Should do for signed-in users:
- open the import flow, subject to plan slots

Should not do:
- feel broken or unavailable without explanation

Recommendation:
- keep
- but clearly distinguish visitor prompt vs account-owned action

### J. Library management surfaces
Examples:
- add book
- manage library
- delete owned books
- expand beyond sample

Who sees them:
- ideally signed-in users only, or visibly locked for visitors

Should do for visitors:
- prompt account creation subtly

Should do for signed-in users:
- perform real library operations within slot limits

Recommendation:
- keep
- but avoid implying true ownership before auth

## 3.3 Reading surfaces with business impact

### K. Reading view entry from sample
Who sees it:
- visitors and signed-in users

Should do:
- open reading normally for the sample path
- avoid a hard auth wall at reading entry

Should not do:
- block the sample reading experience

Recommendation:
- keep
- sample reading is part of acquisition

### L. Browser TTS
Who sees it:
- plan-dependent

Business intent:
- paid value starts even at the baseline level
- browser TTS is part of the product stack users pay for, not merely an internal fallback

Free intent:
- enough TTS/value to experience the product

Pro/Premium intent:
- more access and expanded voice options

### M. Cloud voices
Who sees them:
- Pro and above within allowance/rules

Should do:
- feel like an upgrade in quality and breadth

Should not do:
- replace the baseline reading experience itself

### N. Themes and premium ambience surfaces
Who sees them:
- all users as UI surfaces if aspiration is desired, but higher tiers unlock more

Should do:
- serve as secondary upsell surfaces

Should not do:
- become the main monetization story ahead of reading value

Recommendation:
- keep gating, but subordinate to reading/AI value

## 3.4 Pricing and subscription surfaces

### O. `Subscribe`
Where:
- public nav or relevant entry surface

Should do:
- open pricing

Should not do:
- compete with multiple equivalent upgrade buttons if one canonical upgrade path already exists

Recommendation:
- remove from signed-out/public view if Sign Up already covers acquisition cleanly
- keep only if it serves a distinct public pricing purpose

### P. Pricing modal or pricing page
Should do:
- present exactly three options:
  - Free
  - Pro trial (3 days)
  - Premium
- make the plan ladder understandable immediately
- hand the selected plan into signup/login

Should not do:
- feel like a dead marketing detour
- reappear repeatedly once the user has already chosen

Recommendation:
- keep, but promote it from modal-only thinking into a route-backed surface

### Q. `Current Plan`
Where:
- pricing surface when the active plan matches the card

Should do:
- be passive / non-destructive
- indicate no action required

Recommendation:
- keep

### R. `Try for Free`
Where:
- pricing / auth copy

Should do:
- map to Free plan selection or public acquisition path

Recommendation:
- merge semantically with Sign Up / Try it free
- avoid multiple labels for the same action unless the copy context truly differs

### S. `Upgrade`
Where:
- pricing or upsell surfaces

Should do:
- move the user toward paid plan selection or checkout

Should not do:
- be ambiguous about which plan it upgrades to

Recommendation:
- keep only where plan target is explicit

### T. `View Pricing`
Where:
- signed-in subscription area

Should do:
- show pricing and plan comparison for someone already inside the app

Recommendation:
- keep as a secondary signed-in comparison surface

### U. `Upgrade to Premium`
Where:
- subscription / plan management area

Should do:
- initiate the Premium upgrade path directly

Recommendation:
- keep only in signed-in subscription context

### V. `Manage Billing`
Where:
- signed-in subscription area

Should do:
- hand off to Stripe billing portal
- optionally follow a light in-app summary

Should not do:
- duplicate all Stripe billing UX inside the app unless intentionally built later

Recommendation:
- keep
- make it a thin Stripe portal launcher

## 3.5 Account and subscription status surfaces

### W. Profile
Who sees it:
- signed-in users only

Should do:
- show account identity and account-owned settings
- provide logout
- provide access to subscription summary

Should not do:
- appear for visitors

### X. Token / usage balance display
Who sees it:
- signed-in users only

Should do:
- appear where it helps, not where it adds anxiety

Recommendation:
- remove from pre-account surfaces
- keep available in subscription/account contexts
- only show persistent top-nav usage if it becomes truly helpful and stable

### Y. Subscription summary cards
Examples:
- current plan
- renews
- features included
- limits/slots

Should do:
- reflect real billing and entitlement truth

Should not do:
- remain decorative once billing is wired

Recommendation:
- keep
- make them authoritative after Stripe/Supabase integration

### Z. Tier selector buttons inside Profile
Current prototype behavior:
- local/dev simulation

Intended product behavior:
- users should not manually simulate plan changes in production UI

Recommendation:
- remove from production surfaces
- keep only as development/debug tooling if needed

---

# 4. Usage, slots, and downgrade behavior

## 4.1 Usage model
Users should not think in raw model tokens.
The product should present understandable usage/value tied to their plan.

### Free
- enough usage to experience the product
- daily reset
- baseline reading experience
- 2 import slots

### Pro
- more daily usage than Free
- 5 import slots
- some cloud voices
- some themes

### Premium
- highest daily usage
- broadest unlocks
- most generous capacity

## 4.2 Daily reset
Usage resets daily.
Engineering may implement the exact reset mechanism later, but the user-facing promise is daily refresh, not rolling confusion.

## 4.3 Exhaustion behavior
When usage runs out:
- do not delete progress
- do not remove owned history records
- do not erase uploaded books outright
- remove or disable access to higher-tier actions until reset or upgrade
- fall back to defaults and lower-tier capability

Examples:
- if a user drops from 5 slots to 2, existing books remain visible/preserved, but no new slot beyond the lower limit opens up
- if a premium feature is no longer allowed, the UI falls back to the lower-tier default
- restore and continuity remain intact

## 4.4 Downgrade behavior
On downgrade or entitlement loss:
- preserve account
- preserve progress
- preserve history
- preserve uploaded item references if feasible
- enforce lower-tier limits prospectively rather than destructively

---

# 5. Canonical flows

## 5.1 New user acquisition flow
1. User lands on `/`
2. Sees sample book and Login / Sign Up
3. Can open the sample and read
4. When ready to own/expand, chooses Sign Up
5. Pricing presents Free / Pro trial / Premium
6. User chooses plan
7. User completes signup
8. User enters signed-in app shell

## 5.2 Returning user flow
1. User lands on `/login` or enters app directly if session exists
2. Signs in
3. Goes straight to owned app shell
4. Restores progress/settings/entitlement truth

## 5.3 Visitor tries an account-owned action
1. Visitor taps import or owned-library action
2. App shows subtle prompt to Login or Sign Up
3. If user chooses Sign Up, preserve context and selected intent where useful

## 5.4 User hits a locked feature or exhausted usage
1. User attempts higher-tier action
2. App explains why access is limited
3. App offers focused upgrade path
4. On successful upgrade, the user should return to the same flow with the feature unlocked where possible

## 5.5 User manages billing
1. Signed-in user opens Subscription
2. Sees current plan and summary
3. Uses Manage Billing
4. App hands off to Stripe portal
5. On return, entitlement and subscription UI refresh

---

# 6. Recommended surface reductions before implementation

These reductions are recommended to keep the product frictionless and avoid wiring redundant surfaces.

## Keep
- Login
- Sign Up
- sample book
- pricing route/page
- View Pricing in subscription context
- Manage Billing in subscription context
- Upgrade to Premium in subscription context

## Merge / simplify
- `Try it free` → should behave like public Sign Up entry into pricing
- `Try for free` → same underlying action as public Sign Up / Free plan selection
- multiple public upgrade/subscribe labels → collapse into one clear acquisition path

## Remove from pre-account surfaces
- Profile
- token balance pill
- subscription summary surfaces
- billing controls

## Remove from production app surfaces
- manual tier selector buttons used for local simulation

## Keep as secondary, not primary, monetization prompts
- theme/music locked prompts

The main monetization story should remain:
- see value in reading
- create account to own the experience
- choose a plan for more capacity and better features

---

# 7. Engineering consequences of this document

This document implies:
- route-backed auth and pricing surfaces are now worth building
- the signed-out entry should feel like a thin app shell, not a marketing wall
- the current single-shell scaffold may need to split into focused HTML pages for entry, login, signup, and pricing
- production UI should stop exposing dev-only tier simulation surfaces
- pre-account users should experience value without pretending they already have account-backed ownership
- entitlement loss must be non-destructive

