# SUPABASE_TABLES_REFERENCE.md

Canonical pre-launch reference for Jubly Reader app-owned Supabase tables.

This document exists to prevent schema drift.

## Core rule

These tables store **durable** truth only.

They do **not** move live reading ownership out of runtime.

- **Server** owns durable mutation and resolved durable/business snapshot truth.
- **Runtime** owns reading entry, restore application timing, active page truth, playback truth, and exit cleanup.
- **Shell/dev tools** may render or inspect durable truth, but must not become competing owners or bypass paths.

## Launch table set

- `users`
- `user_settings`
- `user_progress`
- `user_sessions`
- `user_entitlements`
- `user_usage`

Do **not** use app patches to add ad hoc side tables for the same domains.

---

# 1. users

## Purpose
Auth-linked profile/account shell.

## Durable owner
Server-backed account/profile sync.

## Written by
- `sync_user`
- future real profile/account update endpoints

## Read by
- signed-in account/profile presentation
- diagnostics/dev tools
- display-name/auth-provider surfaces

## Canonical columns
- `id` — UUID, matches `auth.users.id`
- `display_name`
- `email`
- `auth_provider`
- `status`
- `created_at`
- `updated_at`

## Key rules
- `id` is the primary key.
- This table is **not billing truth**.
- Billing/plan status belongs in `user_entitlements`.
- `status` is broad account status only.

## Must never be used for
- feature gating
- restore continuity
- usage counters
- Stripe state authority

---

# 2. user_settings

## Purpose
Durable user preferences.

## Durable owner
Server-authoritative settings sync.

## Written by
- `sync_settings`
- future server-backed profile/settings actions only

## Read by
- runtime hydration
- shell/profile/settings surfaces
- diagnostics/dev tools

## Canonical columns
- `user_id` — PK/FK to `users.id`
- `theme_id`
- `font_id`
- `tts_speed`
- `tts_voice_id`
- `tts_volume`
- `autoplay_enabled`
- `music_enabled`
- `particles_enabled`
- `use_source_page_numbers`
- `appearance_mode`
- `daily_goal_minutes`
- `created_at`
- `updated_at`

## Dropped columns (removed — theme-definition fields re-homed to runtime/local)
The following columns were removed from `user_settings` as part of the theme ownership correction pass.
They are now owned by runtime/local theme prefs (`rc_theme_prefs` localStorage) and must not be recreated here.
- `explorer_accent_swatch` → `rcTheme` runtime, `rc_theme_prefs` local
- `explorer_background_mode` → `rcTheme` runtime, `rc_theme_prefs` local
- `particle_preset_id` → `rcTheme.settings.emberPreset`, `rc_theme_prefs` local
- `music_profile_id` → `rcTheme.settings.music`, device-local track selection
- `last_goal_celebrated_on` → `rc_profile_prefs` localStorage, `normalizeProfilePrefs()` in `state.js`

## Key rules
- One row per user.
- Required booleans/default-backed fields must never depend on partial client payloads being perfect.
- Server upserts should merge/coerce before write.
- `daily_goal_minutes` is constrained to the current launch contract range.
- `use_source_page_numbers` is `NOT NULL` with a DB default so settings writes do not fail on partial payloads.
- Dropped columns listed above must never be re-added as Explorer-specific DB fields. Cross-device theme persistence, if needed later, goes through a generic theme-overrides model.

## Must never be used for
- active playback state
- live current page truth
- restore application timing
- entitlement / billing truth

---

# 3. user_progress

## Purpose
Authoritative restore/continuity table.

## Durable owner
Server-backed progress sync.

## Written by
- `write_progress`
- page-change capture flushes
- preview/start flushes
- reading exit flushes

## Read by
- restore lookup
- book/library continuity summaries
- diagnostics/dev tools

## Canonical columns
- `id`
- `user_id`
- `book_id`
- `source_type`
- `source_id`
- `chapter_id`
- `page_count`
- `last_page_index`
- `last_read_at`
- `is_active`
- `session_version`
- `created_at`
- `updated_at`

## Identity / uniqueness
Current launch identity is:
- `user_id`
- `book_id`
- `source_type`
- `source_id`
- `chapter_id` (normalized so null does not create duplicate “same target” rows)

## Key rules
- This is the **only durable restore authority**.
- Current launch contract uses `source_type = 'book'`.
- `user_sessions` must never be used as the restore fallback truth.
- Runtime still decides **when** restore is applied.

## Must never be used for
- append-only analytics history
- session summaries
- plan / billing / usage state

---

# 4. user_sessions

## Purpose
Append-only reading session history and analytics.

## Durable owner
Server-backed session recording.

## Written by
- `record_session`
- reading completion/session-close flows

## Read by
- profile metrics
- daily/weekly minutes summaries
- book completion history
- diagnostics/dev tools

## Canonical columns
- `id`
- `user_id`
- `pages_completed`
- `minutes_listened`
- `source_type`
- `source_id`
- `book_id`
- `chapter_id`
- `mode`
- `tts_seconds`
- `completed`
- `started_at`
- `ended_at`
- `elapsed_seconds`
- `created_at`
- `updated_at`

## Key rules
- Append-only history.
- `created_at` must have a DB default.
- Current launch contract uses `source_type = 'book'`.
- This table is **not restore truth**.

## Must never be used for
- last-read restore fallback
- authoritative current page/chapter
- billing or usage authority

---

# 5. user_entitlements

## Purpose
Billing / plan / feature truth.

## Durable owner
Stripe webhook/backend entitlement resolution.

## Written by
- Stripe webhook handling
- controlled debug/dev-only entitlement tools if allowed

## Read by
- runtime policy resolution
- billing portal / checkout decisions
- account entitlement surfaces

## Canonical columns
- `user_id`
- `provider`
- `plan_id`
- `tier`
- `status`
- `stripe_customer_id`
- `stripe_subscription_id`
- `period_start`
- `period_end`
- `created_at`
- `updated_at`

## Key rules
- One current resolved entitlement row per user.
- Current launch tiers are `free`, `paid`, `premium`.
- Runtime consumes resolved entitlement truth from here rather than reconstructing Stripe logic in the browser.

## Must never be used for
- profile display shell fields
- live reading/session behavior
- restore truth

---

# 6. user_usage

## Purpose
Current server-authoritative usage window summary.

## Durable owner
Server-owned usage consumption/reset logic.

## Written by
- usage consumption path
- reset usage window actions
- optional RPC `consume_user_usage`

## Read by
- account usage surfaces
- diagnostics/dev tools
- backend capacity checks

## Canonical columns
- `user_id`
- `window_start`
- `window_end`
- `used_units`
- `used_api_calls`
- `last_consumed_at`
- `created_at`
- `updated_at`

## Key rules
- One current summary row per user.
- This is **not** a historical event ledger.
- Window ordering must always be valid.
- Counters are non-negative.
- Launch SQL includes an optional `consume_user_usage` RPC aligned to current tier limits.

## Must never be used for
- entitlement truth
- restore or settings state
- client-guessed spend authority

---

# 7. RLS intent

Current launch intent is strict:

- authenticated users may **read their own rows**
- direct client durable writes are **not** the normal launch path
- service-role/server paths perform the real durable mutations

If future direct client writes are ever allowed, update this document first and then change SQL consciously.

---

# 8. Cross-table guardrails

## One table, one role
Do not split one durable domain across multiple pseudo-authority tables.

## No mixed restore truth
- `user_progress` = restore truth
- `user_sessions` = history only

## No mixed billing truth
- `user_entitlements` = billing/plan truth
- `users` = account shell only

## No fake defaults in place of schema discipline
If a field must exist, give it a DB default and a stable server-side merge path.

## No drifted enums/checks
Constraints must match what the real app/server contract writes.
Do not keep legacy checks that reject the current launch payload.

---

# 9. Related server actions

Current code paths tied to this schema:

- `sync_user`
- `sync_settings`
- `write_progress`
- `record_session`
- usage reset / usage consume paths
- Stripe entitlement upsert paths

Any future patch changing these actions must review this document and the canonical SQL together.
