# SUPABASE_TABLES_REFERENCE.md

Canonical pre-launch reference for Jubly Reader app-owned Supabase tables.

This document exists to prevent schema drift, accidental row explosion, and launch-breaking ownership confusion.

## Core rule

These tables store **durable truth only**.

They do **not** move live reading ownership out of runtime.

- **Server** owns durable mutation and resolved durable/business snapshot truth.
- **Runtime** owns reading entry, restore application timing, active page truth, playback truth, and exit cleanup.
- **Shell/dev tools** may render or inspect durable truth, but must not become competing owners or bypass paths.

## Launch table set

- `users`
- `user_settings`
- `user_library_items`
- `user_progress`
- `user_book_metrics`
- `user_daily_stats`
- `user_entitlements`
- `user_usage`

## Explicit non-launch table

- `user_sessions`

`user_sessions` is intentionally retired from the canonical launch model.
Do not keep or recreate an append-only session ledger as default product persistence unless the project later decides it truly needs one.

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
The following columns are runtime/local concerns and must not be recreated here.
- `explorer_accent_swatch`
- `explorer_background_mode`
- `particle_preset_id`
- `music_profile_id`
- `last_goal_celebrated_on`

## Key rules
- One row per user.
- Required booleans/default-backed fields must never depend on partial client payloads being perfect.
- Server upserts must merge/coerce before write.
- `daily_goal_minutes` is constrained to the current launch contract range.
- `use_source_page_numbers` is `NOT NULL` with a DB default so settings writes do not fail on partial payloads.

## Must never be used for
- active playback state
- live current page truth
- restore application timing
- entitlement / billing truth

---

# 3. user_library_items

## Purpose
Authoritative user-owned library registry.

This table represents the user's owned book entry.
It is the lifecycle anchor for restore, cleanup, soft-delete, and future storage management.

## Durable owner
Server-backed library ownership sync.

## Written by
- import success path
- future rename / archive / delete / restore actions
- future storage-management actions

## Read by
- library presentation
- import-capacity checks
- delete / restore flows
- diagnostics/dev tools
- restore lookup bootstrap

## Canonical columns
- `id` — UUID primary key; the owned-book identity
- `user_id`
- `title`
- `source_kind` — for example `upload_file`, `pasted_text`
- `source_name`
- `content_fingerprint` — nullable dedupe signal only
- `storage_kind` — for example `device_local`
- `storage_ref` — nullable
- `import_kind` — for example `epub`, `pdf`, `text`
- `byte_size`
- `page_count`
- `status` — `active` or `deleted`
- `created_at`
- `updated_at`
- `deleted_at`
- `purge_after`

## Key rules
- One row represents one owned library item, not one content fingerprint.
- `id` is the canonical identity used by downstream durable tables.
- `content_fingerprint` is **not** restore identity and **not** delete identity.
- Uploading the same underlying file again must create a new `user_library_items.id` unless the product explicitly invokes a replace/reconnect action.
- Soft-delete lives here.

## Must never be used for
- live current page truth
- billing or usage authority
- theme/settings truth

---

# 4. user_progress

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
- continue reading summaries
- diagnostics/dev tools

## Canonical columns
- `library_item_id` — PK/FK to `user_library_items.id`
- `user_id`
- `current_chapter_id`
- `current_page_index`
- `page_count`
- `last_read_at`
- `session_version`
- `created_at`
- `updated_at`

## Identity / uniqueness
Current launch identity is:
- one row per `library_item_id`

## Key rules
- This is the **only durable restore authority**.
- One owned book = one progress row max.
- Runtime still decides **when** restore is applied.
- Delete or permanent purge of a library item must remove the matching progress row.
- No generated helper columns such as `chapter_key` belong in canonical launch schema.

## Must never be used for
- append-only analytics history
- per-chapter fanout records
- session summaries
- plan / billing / usage state

---

# 5. user_book_metrics

## Purpose
Compact per-book summary and profile/library metrics.

This replaces most product-facing need for an append-only `user_sessions` table.

## Durable owner
Server-backed session-summary aggregation.

## Written by
- reading exit flushes
- completion/session-close flows
- future reconciliation tools if needed

## Read by
- profile metrics
- library summaries
- completion history
- diagnostics/dev tools

## Canonical columns
- `library_item_id` — PK/FK to `user_library_items.id`
- `user_id`
- `minutes_read_total`
- `pages_completed_total`
- `first_opened_at`
- `last_opened_at`
- `completed_at`
- `completion_count`
- `created_at`
- `updated_at`

## Key rules
- One summary row per owned book.
- This is aggregate product data, not event history.
- Permanent delete of the owned library item should remove this row unless the product later explicitly decides to preserve historical metrics after deletion.

## Must never be used for
- restore fallback truth
- active page/chapter truth
- billing or usage authority

---

# 6. user_daily_stats

## Purpose
Compact daily profile/activity summary.

## Durable owner
Server-backed daily aggregation.

## Written by
- reading exit flushes
- summary aggregation paths

## Read by
- daily/weekly profile summaries
- diagnostics/dev tools

## Canonical columns
- `user_id`
- `stat_date`
- `minutes_read`
- `pages_read`
- `sessions_count`
- `created_at`
- `updated_at`

## Identity / uniqueness
- one row per `user_id + stat_date`

## Key rules
- This table exists to keep long-term metrics compact.
- It intentionally avoids a large append-only session/event table for normal launch usage.

## Must never be used for
- restore truth
- library ownership truth
- billing or usage authority

---

# 7. user_entitlements

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

# 8. user_usage

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

## Must never be used for
- entitlement truth
- restore or settings state
- client-guessed spend authority

---

# 9. RLS intent

Current launch intent is strict:

- authenticated users may **read their own rows**
- direct client durable writes are **not** the normal launch path
- service-role/server paths perform the real durable mutations

If future direct client writes are ever allowed, update this document first and then change SQL consciously.

---

# 10. Cross-table guardrails

## One table, one role
Do not split one durable domain across multiple pseudo-authority tables.

## No mixed restore truth
- `user_library_items` = owned-book identity
- `user_progress` = restore truth
- `user_book_metrics` = per-book summary
- `user_daily_stats` = daily summary

## No content-fingerprint ownership
- `content_fingerprint` may help dedupe or replace flows
- it must not become the canonical owned-book id
- it must not silently reconnect deleted or replaced books to old progress

## No append-only default session ledger
The launch model intentionally avoids `user_sessions` row growth as a default persistence surface.
If a future analytics/event table is added, it must be documented as a separate intentional system.

## Cleanup must follow ownership
- deleting an owned library item must also clear its restore truth
- soft-delete and purge policy must be explicit
- orphaned progress/metric rows are defects

## No fake defaults in place of schema discipline
If a field must exist, give it a DB default and a stable server-side merge path.

## No drifted enums/checks
Constraints must match what the real app/server contract writes.
Do not keep legacy checks that reject the current launch payload.

---

# 11. Related server actions

Current or expected code paths tied to this schema:

- `sync_user`
- `sync_settings`
- owned-library import/create actions
- owned-library delete / restore / purge actions
- `write_progress`
- per-book metrics aggregation
- daily summary aggregation
- usage reset / usage consume paths
- Stripe entitlement upsert paths

Any future patch changing these actions must review this document and the canonical SQL together.
