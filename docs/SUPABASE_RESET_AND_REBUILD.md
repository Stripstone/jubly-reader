# SUPABASE_RESET_AND_REBUILD.md

Pre-launch reset path for Jubly Reader app-owned Supabase durable tables.

## Goal
Replace drifted app tables with one canonical schema before launch.

## Tables in scope
Rebuild these only:
- `users`
- `user_settings`
- `user_progress`
- `user_sessions`
- `user_entitlements`
- `user_usage`

Do **not** rebuild Supabase auth/system tables.

## Recommended order
1. Export/back up current app tables if you want a rollback artifact.
2. Review `app_tables_canonical.sql` once more before running.
3. Run the SQL in Supabase SQL Editor.
4. Confirm the six tables, triggers, policies, and `consume_user_usage` RPC exist.
5. Re-run the durable-state runtime validation path.

## Validation after rebuild
Focus on durable exchange correctness, not visual polish first.

### Settings
- change daily goal
- refresh
- confirm the value persists and rehydrates unchanged

### Progress / restore
- enter a book/chapter/page
- leave reading
- refresh/reopen
- confirm restore lands on the correct durable position

### Sessions
- complete a reading session
- confirm history/profile metrics reflect the persisted row

### Usage
- trigger protected backend actions
- confirm `user_usage` updates correctly and does not regress to fake/local values

### Entitlements
- confirm runtime policy resolves from `user_entitlements`, not from guessed client plan state

## If something still resets after rebuild
Treat it in this order:
1. did the POST fire?
2. did Supabase accept the write?
3. did the returned snapshot contain the new value?
4. did client hydrate apply that value?

If the write succeeds and the returned snapshot is still wrong, debug server snapshot composition next.
If the write fails, fix payload/schema contract before blaming hydration.
