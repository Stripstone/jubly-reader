# Pending State Surface Catalog

Every user-touchable surface that pends, loads, or auths something.
Checked = banner / pending state wired. Unchecked = still needs it.

---

## Auth

| Surface | What it does | Status |
|---|---|---|
| Login page → **Sign In** button | Supabase signIn | ✅ Disables to `Please wait…` during await |
| Login page → **Create Account** button | Supabase signUp | ✅ Disables to `Please wait…` during await |
| Sidebar → **Logout** button | Supabase signOut | ✅ Banner: `Signing out…` → error with Try again / Refresh |
| App cold load (no button) | Session restore on boot | ☐ Boot scrim exists — no banner if session restore stalls or fails |

---

## Account / Profile

| Surface | What it does | Status |
|---|---|---|
| Profile → Account → **Save** (name edit) | `updateDisplayName` | ✅ Disables to `Saving…` during await |
| Profile → Account → **Save Password** | `changePassword` | ✅ Disables to `Saving…` during await |
| Profile → **Open Support Chat** button | Intercom `openChat()` | ☐ No pending state while widget loads |

---

## Billing & Subscription

| Surface | What it does | Status |
|---|---|---|
| Pricing modal → **Free / Choose Pro / Choose Premium** buttons | `fetchPublicConfig` + `fetchRuntimeSnapshot` | ✅ Disable to `Loading…` while config resolves |
| Profile → Subscription tab (renders on open) | `fetchRuntimeSnapshot` | ✅ Shows `Checking your account…` / `—` while in flight |
| Pricing modal → **Choose Pro / Choose Premium** (signed in) | `POST /api/billing?action=checkout` | ✅ Banner: `Preparing checkout…` → error with Try again |
| Profile → Subscription → **Manage Billing** button | `POST /api/billing?action=portal` | ✅ Banner: `Opening billing…` → error with Try again |
| App returns from Stripe checkout (no button) | Entitlement re-hydration after redirect | ☐ `?checkout=success` triggers policy refresh — no banner while plan truth settles |

---

## Usage

| Surface | What it does | Status |
|---|---|---|
| Nav → **Usage pill** (renders on auth) | Usage snapshot hydration | ✅ Shows `Checking…` when truth is not yet authoritative |

---

## Importer

| Surface | What it does | Status |
|---|---|---|
| Importer → **Scan Contents** button | EPUB parse via JSZip | ☐ Button disables (pre-existing) — no banner if stall or parse failure |
| Importer → **Import** button (post-scan) | `POST /api/content?action=page-break` then IndexedDB write | ☐ Progress bar exists for page creation — page-break server call has no step indicator |
| Importer → **Import** button (non-EPUB file) | Upload → FreeConvert → poll → fetch EPUB → parse | ☐ Four-step async chain — no per-step banner |
| Importer → **Import Text** button | Markdown chapter parse + IndexedDB write | ☐ No pending state during parse or write |
| Importer opens (no button) | `GET /api/app?kind=import-capacity` | ☐ Buttons lock via `_capacityVerified` flag — no copy explaining why they are locked |

---

## Library

| Surface | What it does | Status |
|---|---|---|
| Dashboard → **Library grid** (renders on auth) | IndexedDB read + remote sync | ☐ `setLibrarySurfaceState('pending')` exists — no banner if hydration stalls |
| Library modal → **Delete** book button | `syncRemoteLibraryItemState` | ☐ No button disable or feedback during delete |
| Deleted files modal → **Restore** / **Purge** buttons | `syncRemoteLibraryItemState` | ☐ No button disable or feedback during operation |

---

## Reading / TTS

| Surface | What it does | Status |
|---|---|---|
| Reading mode → **Play** button | Cloud TTS `POST /api/ai?action=tts` | ☐ No pending state while audio fetch is in flight |
| Reading mode → **Skip forward / back** buttons | Runtime route decision | ☐ Controls react immediately — if runtime loses truth, no explanation shown |

---

## Settings (durable sync)

These surfaces use local projection — the control reacts instantly — so the only
failure case is a deferred sync write error. A single shared save-failure path
is likely sufficient rather than per-control banners.

| Surface | What it does | Status |
|---|---|---|
| Reading settings → **Voice** select | Queued to durable sync | ☐ No save confirmation |
| Reading settings → **Autoplay** toggle | Queued to durable sync | ☐ No save confirmation |
| Reading settings → **Light / Dark** appearance buttons | `setAppAppearance()` → sync | ☐ No save confirmation |
| Explorer → **Font / Accent / Background / Music** controls | `explorerSettingChanged()` → sync | ☐ No save confirmation |
| Reading settings → **Reading theme** swatches | `setTheme()` → sync | ☐ No save confirmation |

---

## Summary

| Group | Wired | Remaining |
|---|---|---|
| Auth | 3 | 1 |
| Account / Profile | 2 | 1 |
| Billing & Subscription | 4 | 1 |
| Usage | 1 | 0 |
| Importer | 0 | 5 |
| Library | 0 | 3 |
| Reading / TTS | 0 | 2 |
| Settings | 0 | 5 |
| **Total** | **10** | **18** |
