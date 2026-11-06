-- KeepOnCourse database: run once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: every statement replaces or skips what already exists.
--
-- Security model
-- * Row-level security: a signed-in user can only see and change their own rows.
-- * Anonymous visitors (the "anon" role) get no access at all.
-- * Column grants: the app can write only the editable fields. id, user_id
--   and timestamps are set by the database and can't be forged.
-- * The same limits as the web app (lengths, statuses, real dates) are
--   enforced here too, so a modified client can't bypass them.

-- ---------------------------------------------------------------- courses

create table if not exists public.courses (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 100),
  description text not null check (char_length(btrim(description)) between 1 and 1000),
  target_date date not null,
  status      text not null default 'Not Started'
              check (status in ('Not Started', 'In Progress', 'Completed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

create index if not exists courses_user_target_idx on public.courses (user_id, target_date);

-- Study plan (modules + scheduled sessions), written by the app. Must be a JSON
-- object of at most 64 KB, so the column can't be used to store arbitrary data.
alter table public.courses add column if not exists plan jsonb;
alter table public.courses drop constraint if exists courses_plan_shape;
alter table public.courses add constraint courses_plan_shape
  check (plan is null or (jsonb_typeof(plan) = 'object' and octet_length(plan::text) <= 65536));

alter table public.courses enable row level security;

drop policy if exists "Users read their own courses" on public.courses;
create policy "Users read their own courses" on public.courses
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users add their own courses" on public.courses;
create policy "Users add their own courses" on public.courses
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Users update their own courses" on public.courses;
create policy "Users update their own courses" on public.courses
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete their own courses" on public.courses;
create policy "Users delete their own courses" on public.courses
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Least privilege: Supabase grants everything by default; narrow it down
revoke all on public.courses from anon, authenticated;
grant select, delete on public.courses to authenticated;
grant insert (name, description, target_date, status, plan) on public.courses to authenticated;
grant update (name, description, target_date, status, plan) on public.courses to authenticated;

-- Keep updated_at current
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists courses_touch_updated_at on public.courses;
create trigger courses_touch_updated_at
  before update on public.courses
  for each row execute function public.touch_updated_at();

-- Abuse guard: at most 500 courses per account
create or replace function public.enforce_course_limit()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.courses where user_id = new.user_id) >= 500 then
    raise exception 'You can keep up to 500 courses.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists courses_enforce_limit on public.courses;
create trigger courses_enforce_limit
  before insert on public.courses
  for each row execute function public.enforce_course_limit();

-- --------------------------------------------------------- delete account

-- Lets a signed-in user delete their own account (their courses go with it,
-- via ON DELETE CASCADE). SECURITY DEFINER is needed to touch auth.users;
-- it only ever deletes the caller's own row.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = 'insufficient_privilege';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ------------------------------------------------------------ coach usage

-- Daily Coach message counts for signed-in users. Nobody can read or write
-- this table directly; the Coach proxy calls the functions below with the
-- user's own sign-in token, so each user can only ever count against
-- themselves. Days are in UTC.
create table if not exists public.coach_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  count   integer not null default 0 check (count >= 0),
  primary key (user_id, day)
);

alter table public.coach_usage enable row level security;
revoke all on public.coach_usage from anon, authenticated;

-- Counts one Coach message for the caller and returns today's total
create or replace function public.use_coach_message()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  used integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = 'insufficient_privilege';
  end if;
  insert into public.coach_usage (user_id, day, count)
  values (auth.uid(), (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set count = public.coach_usage.count + 1
  returning count into used;
  return used;
end $$;

-- Today's total for the caller, without counting anything
create or replace function public.coach_messages_used()
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select count from public.coach_usage
      where user_id = auth.uid() and day = (now() at time zone 'utc')::date),
    0);
$$;

revoke all on function public.use_coach_message() from public, anon;
revoke all on function public.coach_messages_used() from public, anon;
grant execute on function public.use_coach_message() to authenticated;
grant execute on function public.coach_messages_used() to authenticated;
