# SUPABASE_RESET_AND_REBUILD.md

Pre-launch replacement path for Jubly Reader app-owned durable tables.

## Goal
Replace drifted app tables with one canonical schema before launch.

This is a **replacement** procedure, not a preservation-first migration.
At current pre-launch status, the product should prefer a clean canonical durable model over protecting ineffective test-table drift.

## Tables in scope
Replace these app-owned tables:
- `users`
- `user_settings`
- `user_library_items`
- `user_progress`
- `user_book_metrics`
- `user_daily_stats`
- `user_entitlements`
- `user_usage`

Retire or drop from canonical app use:
- `user_sessions`

Do **not** rebuild Supabase auth/system tables.

## Why the replacement is required
The old shape allowed durable drift and launch-risk patterns such as:
- content-hash identity doubling as owned-book identity
- restore truth tied too loosely to book identity
- incomplete cleanup when a book is deleted
- generated helper columns entering write paths
- append-only session rows growing by default even when the product mostly needs summaries

## Replacement order
1. Export/back up current app tables only if you want a rollback artifact.
2. Review `SUPABASE_TABLES_REFERENCE.md` and `app_tables_canonical.sql` together.
3. Run the canonical replacement SQL in Supabase SQL Editor.
4. Confirm the new launch tables, indexes, FKs, triggers, policies, and `consume_user_usage` RPC exist.
5. Confirm `user_sessions` is no longer part of the app-owned canonical surface.
6. Re-run the durable-state runtime validation path.

## Validation after replacement
Focus on durable exchange correctness first.

### Owned library identity
- import the same file twice
- confirm each import gets a distinct owned library item id
- confirm re-upload does not silently reconnect to prior progress unless the product later explicitly adds a replace/reconnect path

### Settings
- change daily goal and `use source page numbers`
- refresh
- confirm values persist and rehydrate unchanged
- confirm no partial settings write can fail because a required boolean default was omitted

### Progress / restore
- enter a book and advance
- leave reading
- refresh/reopen
- confirm restore lands on the correct durable position
- confirm delete removes the restore row for that owned item

### Metrics
- complete reading activity on a book
- confirm `user_book_metrics` updates compactly
- confirm `user_daily_stats` updates for that date

### Usage
- trigger protected backend actions
- confirm `user_usage` updates correctly and does not regress to fake/local values

### Entitlements
- confirm runtime policy resolves from `user_entitlements`, not from guessed client plan state

## If something still resets after replacement
Treat it in this order:
1. did the POST fire?
2. did Supabase accept the write?
3. did the returned snapshot contain the new value?
4. did client hydrate apply that value?

If the write succeeds and the returned snapshot is still wrong, debug server snapshot composition next.
If the write fails, fix payload/schema contract before blaming hydration.

## Explicit cleanup expectations
The canonical replacement SQL should enforce all of the following:
- `user_progress` references `user_library_items` through a foreign key
- delete or purge of a library item removes matching restore truth
- `user_book_metrics` references `user_library_items`
- `user_daily_stats` stays compact via one row per user per date
- no generated `chapter_key` or equivalent helper column is part of canonical launch writes
- `use_source_page_numbers` is required and default-backed in `user_settings`

## After SQL replacement, before code patch validation
After the replacement SQL is run, the next code pass should align these paths immediately:
- import/create owned book
- delete / purge owned book
- progress write
- restore hydrate
- metrics aggregation
- settings upsert
