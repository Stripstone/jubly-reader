# Pending Surfaces Framework and Catalog

This document is the maintained framework companion to `02_RUNTIME_CONTRACT.md` and `05_PRODUCT_LAUNCH_AND_INTEGRATION.md` for user-visible pending, loading, hydration, re-auth, restore, and other server-backed shell/value surfaces.

It carries operational weight similar to how `app_tables_canonical.sql` pairs with `06_SUPABASE_SCHEMA_REFERENCE.md`: it does not replace the higher-order policy docs, but passes that touch these surfaces must reference it and keep it aligned.

Every user-touchable surface that pends, loads, hydrates, or auths something should either be covered here or be intentionally classified as not needing a routine pending surface.

Status meanings:
- ✅ wired now
- ◐ wired, but intentionally inline/local rather than banner-only
- — intentionally no routine pending surface; keep immediate behavior and surface only real failure

Error action outcomes (standardized in this pass):
- `Try again` = rerun the same user action without a page reload
- `Refresh` = reload the page and re-request app-level truth
- `Open login` = open the login surface when auth is missing or expired
- `Dismiss` = close an informational or recoverable error with no immediate retry path

Notes:
- Recoverable error banners now use only these action labels.
- If a caller does not supply a recovery action, the banner falls back to `Dismiss`.
- Blocking errors still suppress dismiss actions and keep the action locked until the owner resolves them.

## Framework rules

Use this document to keep runtime experience honest during slow truth-settle paths.

Required rules:
- render the safe pending, hidden, or locked state before any await that can stall the visible surface
- never show a believable wrong account, plan, usage, subscription, continue, or restore value while truth is still settling
- keep gated actions locked until the required server-backed verification path is settled
- treat cache or last-safe projection as responsiveness help only, not as new authority
- if a surface is intentionally immediate with no routine pending state, keep that decision explicit and surface real failure honestly

Maintenance rule:
- when a pass changes one of these surfaces, update this document in the same pass or explicitly flag the discrepancy before implementation continues

---

## Auth

| Surface | What it does | Status |
|---|---|---|
| Login page → **Sign In** button | Supabase signIn | ✅ Inline button state: `Please wait…` during await |
| Login page → **Create Account** button | Supabase signUp | ✅ Inline button state: `Please wait…` during await |
| Sidebar → **Logout** button | Supabase signOut | ✅ Banner: `Signing out…` → recoverable error with standardized actions `Try again` / `Refresh` |
| App cold load (no button) | Session restore on boot | ✅ Delayed boot-scrim copy: `Checking your account…` if auth settle takes long |

---

## Account / Profile

| Surface | What it does | Status |
|---|---|---|
| Profile → Account → **Save** (name edit) | `updateDisplayName` | ✅ Inline button state: `Saving…` during await |
| Profile → Account → **Save Password** | `changePassword` | ✅ Inline button state: `Saving…` during await |
| Profile → **Start Chat** button | Intercom `openChat()` | ✅ Inline button state: `Opening…` while widget loads; failure falls back to `Dismiss` |
| Profile → **Share your thoughts** link | Intercom `openFeedback()` | ✅ Inline text swap: `Opening…` while widget loads; failure falls back to `Dismiss` |

---

## Billing & Subscription

| Surface | What it does | Status |
|---|---|---|
| Pricing modal → **Free / Choose Pro / Choose Premium** buttons | `fetchPublicConfig` + `fetchRuntimeSnapshot` | ✅ Neutral inline pending: buttons disable to `Loading…` while config resolves |
| Profile → Subscription tab (renders on open) | `fetchRuntimeSnapshot` | ✅ Inline copy: `Checking your account…` / `—` while in flight |
| Pricing modal → **Choose Pro / Choose Premium** (signed in) | `POST /api/billing?action=checkout` | ✅ Inline clicked-button state: `Preparing…` + banner: `Preparing checkout…`; error resolves to `Try again` or `Open login` if auth expired |
| Profile → Subscription → **Manage Billing** button | `POST /api/billing?action=portal` | ✅ Inline clicked-button state: `Opening…` + banner: `Opening billing…`; error resolves to `Try again` or `Open login` if auth expired |
| App returns from Stripe checkout (no button) | Entitlement re-hydration after redirect | ✅ Banner: `Updating your plan…` while policy truth settles; failure resolves to `Refresh` |
| App returns from billing portal (no button) | Billing-status re-hydration after redirect | ✅ Banner: `Refreshing billing status…` while policy truth settles; failure resolves to `Refresh` |

---

## Usage

| Surface | What it does | Status |
|---|---|---|
| Nav → **Usage pill** (renders on auth) | Usage snapshot hydration | ✅ Inline neutral pending: `Checking…` until truth is authoritative |

---

## Importer

| Surface | What it does | Status |
|---|---|---|
| Importer → **Scan Contents** button | EPUB parse via JSZip | ✅ Inline button state: `Scanning…` + existing inline step text such as `Reading book…` |
| Importer → **Import** button (post-scan) | `POST /api/content?action=page-break` then IndexedDB write | ✅ Inline progress stage now includes explicit page-builder step before save |
| Importer → **Import** button (non-EPUB file) | Upload → FreeConvert → poll → fetch EPUB → parse | ✅ Existing inline multi-step copy retained (`Preparing upload…`, `Uploading…`, `Converting…`, `Reading book…`) |
| Importer → **Import Text** button | Markdown chapter parse + IndexedDB write | ✅ Inline button state: `Importing…` + progress stage appears before page-break await |
| Importer opens (no button) | `GET /api/app?kind=import-capacity` | ✅ Inline copy while actions are locked: `Checking import availability…` |

---

## Library

| Surface | What it does | Status |
|---|---|---|
| Dashboard → **Library grid** (renders on auth) | IndexedDB read + remote sync | ✅ In-surface pending remains the primary seam; delayed banner appears only if hydration noticeably stalls |
| Library modal → **Delete** book button | `syncRemoteLibraryItemState` | ✅ Inline button state: `Deleting…` on the clicked row |
| Deleted files modal → **Restore** button | `syncRemoteLibraryItemState` | ✅ Inline button state: `Restoring…` on the clicked row |
| Deleted files modal → **Delete** button | `syncRemoteLibraryItemState` | ✅ Inline button state: `Deleting…` on the clicked row |
| Deleted files modal → **Delete All** button | `syncRemoteLibraryItemState` | ✅ Inline button state: `Deleting…` while batch delete runs |

---

## Reading / TTS

| Surface | What it does | Status |
|---|---|---|
| Reading mode → **Play** / `Read page` cloud start | Cloud TTS `POST /api/ai?action=tts` | ✅ No routine pending banner; preserve normal countdown/flow. Surface only real playback errors with `Try again`. Transient cloud/server transport failures must stop cleanly and leave Play immediately retryable. |
| Reading mode → **Skip forward / back** buttons | Runtime route decision | — Intentionally no routine pending state; keep immediate response and surface only real failure |

---

## Settings / persistence

These surfaces use immediate local projection by design. The control should react right away.
Pending UI should not be added to every control.

| Surface group | What it does | Status |
|---|---|---|
| Durable synced settings (voice, volume, autoplay, durable theme/font/daily-goal paths) | Queued to durable sync | ✅ Shared failure seam only: banner on sync error — `Your changes weren’t saved yet.` → `Try again` |
| Local-only appearance and Explorer cosmetics that are not durable truth | Local projection | — No routine pending banner |

---

## Summary

| Group | Wired / intentional | Remaining follow-up |
|---|---|---|
| Auth | 4 | 0 |
| Account / Profile | 4 | 0 |
| Billing & Subscription | 6 | 0 |
| Usage | 1 | 0 |
| Importer | 5 | 0 |
| Library | 5 | 0 |
| Reading / TTS | 1 wired, 1 intentionally immediate | 0 |
| Settings / persistence | 1 wired, 1 intentionally immediate | 0 |
| **Total surfaces covered** | **27** | **0 in this bounded pass** |

## Notes locked by this pass

- Button-owned waits prefer inline busy states before any global banner.
- App-level or cross-surface truth settles may use the bottom interaction banner.
- Skip controls remain immediate; adding routine pending there would mask a deeper runtime issue.
- Settings stay optimistic/local first; the shared save-failure seam is enough for this pass.
- Recoverable error banners now standardize to `Try again`, `Refresh`, `Open login`, or `Dismiss`.
