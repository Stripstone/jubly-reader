# Jubly Reader — Supabase Schema Reference

Canonical pre-launch reference for Jubly Reader app-owned durable tables.

This document defines:
- canonical durable table roles
- durable ownership boundaries
- replacement sequencing before launch
- post-replacement validation

These tables store durable truth only.
They do not move live reading ownership out of runtime.
A schema that appears convenient does not legalize wrong ownership in shell, runtime, or devtools.

## Core rules
- Server owns durable mutation and resolved durable or business snapshot truth.
- Runtime owns reading entry, restore application timing, active page truth, playback truth, and exit cleanup.
- Shell and dev tools may render or inspect durable truth, but must not become competing owners or bypass paths.
- One table, one durable role.
- Content fingerprint is never owned-book identity.
- Append-only session growth is not the canonical launch persistence model.

## Schema safeguards in place
- `user_settings.tts_voice_id` is validated and normalized through `normalizeVoiceId()` in both `server/lib/app-durable-sync.js` and `server/lib/app-dev-tools.js` before any write to Supabase. Malformed, empty, or overlong values are coerced to `null`.
- Client hydration in `js/sync.js` validates `tts_voice_id` against resolved runtime policy before applying it to `window.__rcSessionVoiceSelection`. Cloud-type IDs are rejected when the account does not have `cloudVoiceAccess`.
- Client write path in `js/sync.js` guards against persisting a tier-incompatible cloud voice ID when the account policy does not permit cloud voices.
- Session voice selection is cleared on signout in `js/sync.js` to prevent account-to-account voice state leakage.

## Launch table set
- `users`
- `user_settings`
- `user_library_items`
- `user_progress`
- `user_book_metrics`
- `user_daily_stats`
- `user_entitlements`
- `user_usage`
- `user_trial_claims`

## Explicit non-launch table
- `user_sessions`

`user_sessions` is intentionally retired from the canonical launch model.

## Durable settings intent
`user_settings` stores only user preferences that are intentionally durable.

It does not define live reading state.

Current exclusions from the durable settings contract:
- `appearance_mode`
- `tts_speed`
- `use_source_page_numbers`
- diagnostics preferences
- devtools-only toggles
- heavy local-only asset selections

## 1. users

### Purpose
Auth-linked profile and account shell.

### Canonical columns
- `id`
- `display_name`
- `email`
- `auth_provider`
- `status`
- `created_at`
- `updated_at`

### Must never be used for
- feature gating
- restore continuity
- usage counters
- Stripe state authority

## 2. user_settings

### Purpose
Durable user preferences that are intentionally synced.

### Canonical columns
- `user_id`
- `theme_id`
- `font_id`
- `tts_voice_id`
- `tts_volume`
- `autoplay_enabled`
- `music_enabled`
- `particles_enabled`
- `daily_goal_minutes`
- `created_at`
- `updated_at`

### Dropped from the canonical launch schema
Do not recreate these in `user_settings`:
- `appearance_mode` — **dropped from Supabase table 2026-04-19**
- `tts_speed` — **dropped from Supabase table 2026-04-19**
- `use_source_page_numbers` — **dropped from Supabase table 2026-04-19**
- `explorer_accent_swatch`
- `explorer_background_mode`
- `particle_preset_id`
- `music_profile_id`
- `last_goal_celebrated_on`

Additional launch rule:
- `use_source_page_numbers` is a retired legacy gate and must not be reintroduced as a durable, local, or devtools-controlled behavior switch
- displayed page numbers preserve source or actual document numbering through the runtime path when that metadata exists

### Key rules
- one row per user
- required booleans and defaults must not depend on perfect client payloads
- server upserts must merge or coerce before write
- `daily_goal_minutes` should remain constrained to the current launch contract range

### Must never be used for
- active playback state
- live current page truth
- restore application timing
- entitlement or billing truth

## 3. user_library_items

### Purpose
Authoritative user-owned library registry.

### Canonical columns
- `id`
- `user_id`
- `title`
- `source_kind`
- `source_name`
- `content_fingerprint`
- `storage_kind`
- `storage_ref`
- `import_kind`
- `byte_size`
- `page_count`
- `status`
- `created_at`
- `updated_at`
- `deleted_at`
- `purge_after`

### Key rules
- `id` remains the canonical owned-book identity and restore/progress foreign key
- importer durable settlement treats `user_id + non-empty content_fingerprint` as the reconnect/idempotency key for active imported content
- when `content_fingerprint` is missing, durable library idempotency falls back to `user_id + storage_ref`
- duplicate active rows for the same idempotency key count as one capacity identity; targeted delete/restore settles the fingerprint group without adding new status values

## 4. user_progress

### Purpose
Authoritative restore and continuity table.

### Canonical columns
- `library_item_id`
- `user_id`
- `current_chapter_id`
- `current_page_index`
- `page_count`
- `last_read_at`
- `session_version`
- `created_at`
- `updated_at`

### Key rules
- one owned book = one progress row max
- this is the only durable restore authority
- runtime still decides when restore is applied
- delete or purge of a library item must remove the matching progress row
- generated helper columns such as `chapter_key` do not belong in the canonical launch schema

## 5. user_book_metrics

### Purpose
Compact per-book summary and profile/library metrics.

### Canonical columns
- `library_item_id`
- `user_id`
- `minutes_read_total`
- `pages_completed_total`
- `first_opened_at`
- `last_opened_at`
- `completed_at`
- `completion_count`
- `created_at`
- `updated_at`

### Key rules
- one summary row per owned book
- this is aggregate product data, not event history
- permanent delete of the owned library item should remove this row unless product policy changes later

## 6. user_daily_stats

### Purpose
Compact daily profile and activity summary.

### Canonical columns
- `user_id`
- `stat_date`
- `minutes_read`
- `pages_read`
- `sessions_count`
- `created_at`
- `updated_at`

### Key rules
- one row per user plus date
- keep long-term metrics compact
- do not recreate restore truth here

## 7. user_entitlements

### Purpose
Billing, entitlement, and feature-gate truth.

### Canonical columns
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

### Canonical meanings
- `tier` = the canonical runtime feature-gate vocabulary and must use only `basic`, `pro`, or `premium`
- `provider` = entitlement source, currently `system` for the Basic baseline and `stripe` for subscription-backed Pro/Premium entitlements
- `status` = current entitlement lifecycle state, currently `active`, `trialing`, `past_due`, or `inactive`

### Key rules
- one current resolved entitlement row per user
- runtime feature gating resolves from `tier`, not from guessed client plan state
- `provider` and `status` support billing/source interpretation but must not replace `tier` as the canonical feature gate
- `plan_id` is not canonical durable truth in the reduced launch model

## 8. user_usage

### Purpose
Current server-authoritative usage window summary.

### Canonical columns
- `user_id`
- `window_start`
- `window_end`
- `used_units`
- `used_api_calls`
- `last_consumed_at`
- `created_at`
- `updated_at`

### Key rules
- one current summary row per user
- this is not a historical event ledger
- window ordering must always be valid
- counters are non-negative

## 9. user_trial_claims

### Purpose
Server-owned anti-abuse ledger for trial eligibility and enforcement.

### Canonical columns
- `id`
- `user_id`
- `tier`
- `ip_fingerprint_hash`
- `claim_status`
- `claimed_at`
- `expires_at`
- `notes`
- `created_at`
- `updated_at`

### Canonical meanings
- `tier` = the trial-eligible paid plan this claim applies to, currently `pro` or `premium`
- `ip_fingerprint_hash` = hashed server-observed IP footprint used only for anti-abuse checks
- `claim_status` = current server interpretation of the claim, currently `granted`, `blocked`, or `expired`

### Key rules
- this table is server-owned and is not a client-readable product surface
- no raw IP addresses should be stored here; only hashed server-observed footprints
- this table supports rules like one trial per account and, when enabled, one trial per server-observed IP footprint
- local cache, shell copy, or Stripe UI must not become the owner of trial-abuse truth

## RLS intent
Current launch intent is strict:
- authenticated users may read their own rows for user-facing tables only
- `user_trial_claims` remains server-owned with no client read or write path
- direct client durable writes are not the normal launch path
- service-role or server paths perform real durable mutations

## Cross-table guardrails
- `user_library_items` = owned-book identity
- `user_progress` = restore truth
- `user_book_metrics` = per-book summary
- `user_daily_stats` = daily summary

Deleting an owned library item must clear its restore truth and dependent per-book summary rows.

## Replacement procedure before launch
This is a replacement procedure, not a preservation-first migration.

### Goal
Replace drifted app tables with one canonical schema before launch.

### Replacement order
1. Export current app tables only if you want rollback material.
2. Review this document and `app_tables_canonical.sql` together.
3. Run the canonical replacement SQL in Supabase SQL Editor.
4. Confirm the new launch tables, indexes, FKs, triggers, policies, and helper RPCs exist.
5. Confirm `user_sessions` is no longer part of the app-owned canonical surface.
6. Re-run the durable-state runtime validation path.

### Validation after replacement

#### Owned library identity
- import the same file twice
- confirm each import gets a distinct owned library item id
- confirm re-upload does not silently reconnect to prior progress unless the product later explicitly adds a replace or reconnect path

#### Settings
- change a durable setting such as daily goal
- refresh
- confirm the value persists and rehydrates unchanged
- confirm no partial settings write fails because a required boolean default was omitted

#### Progress and restore
- enter a book and advance
- leave reading
- refresh or reopen
- confirm restore lands on the correct durable position
- confirm delete removes the restore row for that owned item

#### Metrics
- complete reading activity on a book
- confirm `user_book_metrics` updates compactly
- confirm `user_daily_stats` updates for that date

#### Usage
- trigger protected backend actions
- confirm `user_usage` updates correctly and does not regress to fake or local values

#### Entitlements
- confirm runtime policy resolves from `user_entitlements.tier`, not from guessed client plan state or legacy plan labels

#### Trial anti-abuse
- grant one trial through the server billing path
- confirm `user_trial_claims` records the account plus tier claim
- when unique-IP enforcement is enabled, confirm a second account from the same server-observed IP footprint is blocked from receiving another trial

## If something still resets after replacement
Treat it in this order:
1. did the POST fire?
2. did Supabase accept the write?
3. did the returned snapshot contain the new value?
4. did client hydrate apply that value?

If the write succeeds and the returned snapshot is still wrong, debug server snapshot composition next.
If the write fails, fix payload and schema contract before blaming hydration.
