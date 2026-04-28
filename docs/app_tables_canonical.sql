-- Jubly Reader — canonical pre-launch app tables
-- Reduced authority version aligned to 06_SUPABASE_SCHEMA_REFERENCE.md
--
-- WARNING:
-- This script intentionally replaces the current app-owned durable tables.
-- Existing test data in those app tables will be dropped.
-- Supabase auth/system tables are NOT touched.

begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop table if exists public.user_sessions cascade;
drop table if exists public.user_usage cascade;
drop table if exists public.user_entitlements cascade;
drop table if exists public.user_daily_stats cascade;
drop table if exists public.user_book_metrics cascade;
drop table if exists public.user_progress cascade;
drop table if exists public.user_library_items cascade;
drop table if exists public.user_settings cascade;
drop table if exists public.users cascade;

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  auth_provider text,
  status text not null default 'active' check (status in ('active', 'disabled', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_users_set_updated_at
before update on public.users
for each row execute function public.set_updated_at();

-- user_settings intentionally excludes local-only, retired, and devtools-only fields.
-- In particular, do not reintroduce appearance_mode, tts_speed, or use_source_page_numbers here.
create table public.user_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  theme_id text not null default 'default',
  font_id text not null default 'Lora',
  tts_voice_id text,
  tts_volume numeric(4,2) not null default 0.50 check (tts_volume >= 0.00 and tts_volume <= 1.00),
  autoplay_enabled boolean not null default false,
  music_enabled boolean not null default true,
  particles_enabled boolean not null default true,
  daily_goal_minutes integer not null default 15 check (daily_goal_minutes >= 5 and daily_goal_minutes <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_user_settings_set_updated_at
before update on public.user_settings
for each row execute function public.set_updated_at();

create table public.user_library_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  source_kind text not null,
  source_name text,
  content_fingerprint text,
  storage_kind text not null,
  storage_ref text,
  import_kind text,
  byte_size bigint not null default 0 check (byte_size >= 0),
  page_count integer not null default 0 check (page_count >= 0),
  status text not null default 'active' check (status in ('active', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  purge_after timestamptz,
  unique (id, user_id),
  check (
    (status = 'active' and deleted_at is null)
    or (status = 'deleted' and deleted_at is not null)
  )
);

create index idx_user_library_items_user_status_updated
  on public.user_library_items (user_id, status, updated_at desc);

create index idx_user_library_items_deleted_purge
  on public.user_library_items (status, purge_after)
  where status = 'deleted';

create index idx_user_library_items_user_fingerprint
  on public.user_library_items (user_id, content_fingerprint)
  where content_fingerprint is not null;

create trigger trg_user_library_items_set_updated_at
before update on public.user_library_items
for each row execute function public.set_updated_at();

create table public.user_progress (
  library_item_id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  current_chapter_id text,
  current_page_index integer not null default 0 check (current_page_index >= 0),
  page_count integer not null default 0 check (page_count >= 0),
  last_read_at timestamptz,
  session_version integer not null default 1 check (session_version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_user_progress_library_owner
    foreign key (library_item_id, user_id)
    references public.user_library_items(id, user_id)
    on delete cascade
);

create index idx_user_progress_user_last_read
  on public.user_progress (user_id, last_read_at desc nulls last);

create trigger trg_user_progress_set_updated_at
before update on public.user_progress
for each row execute function public.set_updated_at();

create table public.user_book_metrics (
  library_item_id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  minutes_read_total integer not null default 0 check (minutes_read_total >= 0),
  pages_completed_total integer not null default 0 check (pages_completed_total >= 0),
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  completed_at timestamptz,
  completion_count integer not null default 0 check (completion_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_user_book_metrics_library_owner
    foreign key (library_item_id, user_id)
    references public.user_library_items(id, user_id)
    on delete cascade
);

create index idx_user_book_metrics_user_last_opened
  on public.user_book_metrics (user_id, last_opened_at desc nulls last);

create trigger trg_user_book_metrics_set_updated_at
before update on public.user_book_metrics
for each row execute function public.set_updated_at();

create table public.user_daily_stats (
  user_id uuid not null references public.users(id) on delete cascade,
  stat_date date not null,
  minutes_read integer not null default 0 check (minutes_read >= 0),
  pages_read integer not null default 0 check (pages_read >= 0),
  sessions_count integer not null default 0 check (sessions_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, stat_date)
);

create index idx_user_daily_stats_user_date_desc
  on public.user_daily_stats (user_id, stat_date desc);

create trigger trg_user_daily_stats_set_updated_at
before update on public.user_daily_stats
for each row execute function public.set_updated_at();

create table public.user_entitlements (
  user_id uuid primary key references public.users(id) on delete cascade,
  provider text not null default 'manual',
  plan_id text not null default 'free',
  tier text not null default 'free' check (tier in ('free', 'paid', 'premium')),
  status text not null default 'inactive',
  stripe_customer_id text,
  stripe_subscription_id text,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_user_entitlements_tier_status
  on public.user_entitlements (tier, status);

create trigger trg_user_entitlements_set_updated_at
before update on public.user_entitlements
for each row execute function public.set_updated_at();

create table public.user_usage (
  user_id uuid primary key references public.users(id) on delete cascade,
  window_start timestamptz not null,
  window_end timestamptz not null,
  used_units bigint not null default 0 check (used_units >= 0),
  used_api_calls integer not null default 0 check (used_api_calls >= 0),
  last_consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (window_end > window_start)
);

create index idx_user_usage_window_bounds
  on public.user_usage (window_start, window_end);

create trigger trg_user_usage_set_updated_at
before update on public.user_usage
for each row execute function public.set_updated_at();

alter table public.users enable row level security;
alter table public.user_settings enable row level security;
alter table public.user_library_items enable row level security;
alter table public.user_progress enable row level security;
alter table public.user_book_metrics enable row level security;
alter table public.user_daily_stats enable row level security;
alter table public.user_entitlements enable row level security;
alter table public.user_usage enable row level security;

create policy users_select_own
  on public.users for select to authenticated using (auth.uid() = id);

create policy user_settings_select_own
  on public.user_settings for select to authenticated using (auth.uid() = user_id);

create policy user_library_items_select_own
  on public.user_library_items for select to authenticated using (auth.uid() = user_id);

create policy user_progress_select_own
  on public.user_progress for select to authenticated using (auth.uid() = user_id);

create policy user_book_metrics_select_own
  on public.user_book_metrics for select to authenticated using (auth.uid() = user_id);

create policy user_daily_stats_select_own
  on public.user_daily_stats for select to authenticated using (auth.uid() = user_id);

create policy user_entitlements_select_own
  on public.user_entitlements for select to authenticated using (auth.uid() = user_id);

create policy user_usage_select_own
  on public.user_usage for select to authenticated using (auth.uid() = user_id);

revoke all on table public.users from anon, authenticated;
revoke all on table public.user_settings from anon, authenticated;
revoke all on table public.user_library_items from anon, authenticated;
revoke all on table public.user_progress from anon, authenticated;
revoke all on table public.user_book_metrics from anon, authenticated;
revoke all on table public.user_daily_stats from anon, authenticated;
revoke all on table public.user_entitlements from anon, authenticated;
revoke all on table public.user_usage from anon, authenticated;

grant select on table public.users to authenticated;
grant select on table public.user_settings to authenticated;
grant select on table public.user_library_items to authenticated;
grant select on table public.user_progress to authenticated;
grant select on table public.user_book_metrics to authenticated;
grant select on table public.user_daily_stats to authenticated;
grant select on table public.user_entitlements to authenticated;
grant select on table public.user_usage to authenticated;

create or replace function public.consume_user_usage(
  p_user_id uuid,
  p_used_units bigint default 0,
  p_used_api_calls integer default 1,
  p_window_start timestamptz default null,
  p_window_end timestamptz default null
)
returns public.user_usage
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz := coalesce(p_window_start, date_trunc('day', now()));
  v_end timestamptz := coalesce(p_window_end, date_trunc('day', now()) + interval '1 day');
  v_row public.user_usage;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if v_end <= v_start then
    raise exception 'window_end must be greater than window_start';
  end if;

  insert into public.user_usage (
    user_id,
    window_start,
    window_end,
    used_units,
    used_api_calls,
    last_consumed_at
  ) values (
    p_user_id,
    v_start,
    v_end,
    greatest(coalesce(p_used_units, 0), 0),
    greatest(coalesce(p_used_api_calls, 0), 0),
    now()
  )
  on conflict (user_id)
  do update
    set window_start = excluded.window_start,
        window_end = excluded.window_end,
        used_units = public.user_usage.used_units + greatest(coalesce(p_used_units, 0), 0),
        used_api_calls = public.user_usage.used_api_calls + greatest(coalesce(p_used_api_calls, 0), 0),
        last_consumed_at = now(),
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.purge_deleted_library_items(
  p_before timestamptz default now(),
  p_limit integer default 500
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  with doomed as (
    select id
    from public.user_library_items
    where status = 'deleted'
      and purge_after is not null
      and purge_after <= p_before
    order by purge_after asc, updated_at asc
    limit greatest(coalesce(p_limit, 500), 1)
  ), deleted as (
    delete from public.user_library_items uli
    using doomed
    where uli.id = doomed.id
    returning 1
  )
  select count(*) into v_deleted from deleted;

  return coalesce(v_deleted, 0);
end;
$$;

revoke all on function public.consume_user_usage(uuid, bigint, integer, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.purge_deleted_library_items(timestamptz, integer) from public, anon, authenticated;

grant execute on function public.consume_user_usage(uuid, bigint, integer, timestamptz, timestamptz) to service_role;
grant execute on function public.purge_deleted_library_items(timestamptz, integer) to service_role;

commit;
