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

-- --------------------------------------------------------- calendar feed

-- A secret, per-user calendar subscription link. Calendar apps (Google,
-- Outlook, Apple) fetch it without signing in, so the link itself is the
-- credential: 64 random hex characters (two v4 UUIDs, ~244 random bits).
-- Users can reset it at any time, which immediately revokes the old link.
create table if not exists public.calendar_feeds (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  token      text not null unique check (token ~ '^[0-9a-f]{64}$'),
  timezone   text not null default 'UTC' check (char_length(timezone) <= 64),
  created_at timestamptz not null default now()
);

alter table public.calendar_feeds enable row level security;
revoke all on public.calendar_feeds from anon, authenticated;

-- Returns the caller's feed token, creating it on first use. reset => true
-- issues a new token. tz is the user's IANA time zone (e.g. Europe/Paris).
create or replace function public.my_calendar_feed(tz text default null, reset boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare
  fresh  text := replace(pg_catalog.gen_random_uuid()::text, '-', '') || replace(pg_catalog.gen_random_uuid()::text, '-', '');
  result text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = 'insufficient_privilege';
  end if;
  if tz is not null and (char_length(tz) > 64 or tz !~ '^[A-Za-z0-9_+/-]+$') then
    tz := null;
  end if;
  insert into public.calendar_feeds (user_id, token, timezone)
  values (auth.uid(), fresh, coalesce(tz, 'UTC'))
  on conflict (user_id) do update set
    token    = case when reset then excluded.token else public.calendar_feeds.token end,
    timezone = coalesce(tz, public.calendar_feeds.timezone)
  returning token into result;
  return result;
end $$;

-- The feed itself: study plans for the user who owns the token. Callable
-- without signing in (calendar apps can't), but only with the exact token.
create or replace function public.calendar_feed(feed_token text)
returns table (course_id bigint, course_name text, plan jsonb, timezone text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.plan, f.timezone
  from public.calendar_feeds f
  join public.courses c on c.user_id = f.user_id
  where feed_token ~ '^[0-9a-f]{64}$'
    and f.token = feed_token
    and c.plan is not null
  order by c.id;
$$;

revoke all on function public.my_calendar_feed(text, boolean) from public, anon;
grant execute on function public.my_calendar_feed(text, boolean) to authenticated;
revoke all on function public.calendar_feed(text) from public;
grant execute on function public.calendar_feed(text) to anon, authenticated;

-- ------------------------------------------------------------------ stats

-- Tokens Claude used for each user's Coach replies, per day (for cost
-- estimates). Written by the Coach proxy with the user's own sign-in token,
-- like the message count. A user could only ever inflate their own numbers,
-- which affects nothing but the statistics.
alter table public.coach_usage add column if not exists input_tokens       bigint not null default 0;
alter table public.coach_usage add column if not exists output_tokens      bigint not null default 0;
alter table public.coach_usage add column if not exists cache_read_tokens  bigint not null default 0;
alter table public.coach_usage add column if not exists cache_write_tokens bigint not null default 0;

create or replace function public.record_coach_tokens(
  input_tokens bigint, output_tokens bigint, cache_read_tokens bigint, cache_write_tokens bigint
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  cap constant bigint := 2000000; -- far above any single reply
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = 'insufficient_privilege';
  end if;
  update public.coach_usage set
    input_tokens       = public.coach_usage.input_tokens       + least(greatest(record_coach_tokens.input_tokens, 0), cap),
    output_tokens      = public.coach_usage.output_tokens      + least(greatest(record_coach_tokens.output_tokens, 0), cap),
    cache_read_tokens  = public.coach_usage.cache_read_tokens  + least(greatest(record_coach_tokens.cache_read_tokens, 0), cap),
    cache_write_tokens = public.coach_usage.cache_write_tokens + least(greatest(record_coach_tokens.cache_write_tokens, 0), cap)
  where user_id = auth.uid() and day = (now() at time zone 'utc')::date;
end $$;

revoke all on function public.record_coach_tokens(bigint, bigint, bigint, bigint) from public, anon;
grant execute on function public.record_coach_tokens(bigint, bigint, bigint, bigint) to authenticated;

-- Accounts allowed to see the usage statistics (the site owner). Nobody can
-- read or change this list from the app; add yourself once in the SQL Editor:
--   insert into public.stats_viewers (user_id)
--   select id from auth.users where email = 'you@example.com'
--   on conflict do nothing;
create table if not exists public.stats_viewers (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.stats_viewers enable row level security;
revoke all on public.stats_viewers from anon, authenticated;

-- Totals only: no names, emails or course content ever leave this function.
-- "Active" means the account used Coach, or added or changed a course, that day.
create or replace function public.app_stats(user_limit integer default 60)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'utc')::date;
  result jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.stats_viewers v where v.user_id = auth.uid()) then
    raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
  end if;

  with activity as (
    select u.user_id, u.day from public.coach_usage u where u.day > today - 63
    union
    select c.user_id, (c.created_at at time zone 'utc')::date from public.courses c
      where c.created_at > now() - interval '63 days'
    union
    select c.user_id, (c.updated_at at time zone 'utc')::date from public.courses c
      where c.updated_at > now() - interval '63 days'
  ),
  days as (
    select (today - n)::date as day from generate_series(0, 29) n
  ),
  coach as (
    select d.day,
           coalesce(sum(least(u.count, user_limit)) filter (where u.user_id is not null), 0) as messages,
           count(u.user_id) filter (where u.count > 0)        as people,
           count(u.user_id) filter (where u.count > user_limit) as limit_hits,
           coalesce(sum(u.input_tokens), 0)                    as input_tokens,
           coalesce(sum(u.output_tokens), 0)                   as output_tokens,
           coalesce(sum(u.cache_read_tokens), 0)               as cache_read_tokens,
           coalesce(sum(u.cache_write_tokens), 0)              as cache_write_tokens
      from days d left join public.coach_usage u on u.day = d.day
     group by d.day
  )
  select jsonb_build_object(
    'generated_at', now(),
    'accounts',     (select count(*) from auth.users),
    'signups_7d',   (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'signups_30d',  (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'active_7d',    (select count(distinct a.user_id) from activity a where a.day > today - 7),
    'active_30d',   (select count(distinct a.user_id) from activity a where a.day > today - 30),
    'weekly_active', (
      select jsonb_agg(jsonb_build_object(
               'week_end', today - 7 * w,
               'active', (select count(distinct a.user_id) from activity a
                           where a.day > today - 7 * w - 7 and a.day <= today - 7 * w))
             order by w desc)
        from generate_series(0, 7) w),
    'retention_4w', (
      select jsonb_build_object(
               'cohort', count(*),
               'active', count(*) filter (where exists (
                 select 1 from activity a where a.user_id = u.id and a.day > today - 7)))
        from auth.users u
       where u.created_at <= now() - interval '28 days' and u.created_at > now() - interval '56 days'),
    'courses',        (select count(*) from public.courses),
    'courses_with_plan', (select count(*) from public.courses where plan is not null),
    'calendar_feeds', (select count(*) from public.calendar_feeds),
    'weekly_email_subscribers', (select count(*) from public.email_prefs where weekly_checkin),
    -- Study sessions checked in as done during the last 7 days, and by how many accounts
    'sessions_done_7d', (
      select count(*)
        from public.courses c,
             jsonb_array_elements(case when jsonb_typeof(c.plan -> 'sessions') = 'array' then c.plan -> 'sessions' else '[]'::jsonb end) s
       where s ->> 'status' = 'done'
         and (s ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
         and (s ->> 'date') > (today - 7)::text and (s ->> 'date') <= today::text),
    'checkin_accounts_7d', (
      select count(distinct c.user_id)
        from public.courses c,
             jsonb_array_elements(case when jsonb_typeof(c.plan -> 'sessions') = 'array' then c.plan -> 'sessions' else '[]'::jsonb end) s
       where s ->> 'status' = 'done'
         and (s ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
         and (s ->> 'date') > (today - 7)::text and (s ->> 'date') <= today::text),
    -- Study partners (tables further down; plpgsql looks them up when it runs)
    'partner_accounts', (select count(distinct i.user_id) from public.partner_invites i),
    'cheers_7d', (select count(*) from public.partner_cheers c where c.created_at > now() - interval '7 days'),
    'coach_daily', (
      select jsonb_agg(jsonb_build_object(
               'day', c.day, 'messages', c.messages, 'people', c.people, 'limit_hits', c.limit_hits,
               'input_tokens', c.input_tokens, 'output_tokens', c.output_tokens,
               'cache_read_tokens', c.cache_read_tokens, 'cache_write_tokens', c.cache_write_tokens)
             order by c.day)
        from coach c)
  ) into result;
  return result;
end $$;

revoke all on function public.app_stats(integer) from public, anon;
grant execute on function public.app_stats(integer) to authenticated;

-- ------------------------------------------------------- weekly check-in

-- Opt-in weekly email (Monday morning in the user's time zone): this week's
-- study sessions, missed sessions and the finish date. Off unless the user
-- turns it on. Each row has a secret unsubscribe token for one-click
-- unsubscribe links. Nobody can read or write this table directly.
create table if not exists public.email_prefs (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  weekly_checkin    boolean not null default false,
  timezone          text not null default 'UTC',
  unsubscribe_token text not null unique check (unsubscribe_token ~ '^[0-9a-f]{64}$'),
  last_sent_at      timestamptz,
  updated_at        timestamptz not null default now()
);
alter table public.email_prefs enable row level security;
revoke all on public.email_prefs from anon, authenticated;

create or replace function public.my_weekly_checkin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select weekly_checkin from public.email_prefs where user_id = auth.uid()), false);
$$;

-- Turns the weekly email on or off for the caller; tz is an IANA time zone
-- (e.g. "America/New_York"), ignored when unknown
create or replace function public.set_weekly_checkin(enabled boolean, tz text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  zone text := 'UTC';
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = 'insufficient_privilege';
  end if;
  if tz is not null and exists (select 1 from pg_catalog.pg_timezone_names where name = tz) then
    zone := tz;
  end if;
  insert into public.email_prefs (user_id, weekly_checkin, timezone, unsubscribe_token)
  values (auth.uid(), enabled, zone, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (user_id) do update set
    weekly_checkin = excluded.weekly_checkin,
    timezone       = case when tz is null then public.email_prefs.timezone else excluded.timezone end,
    updated_at     = now();
  return enabled;
end $$;

-- One-click unsubscribe from an email link: the token is the credential
create or replace function public.unsubscribe_weekly(token text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if token is null or token !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  update public.email_prefs set weekly_checkin = false, updated_at = now() where unsubscribe_token = token;
  return found;
end $$;

-- What a weekly email would contain for the caller (for "Send me a sample")
create or replace function public.my_weekly_digest()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'email', u.email,
    'timezone', coalesce(p.timezone, 'UTC'),
    'unsubscribe_token', p.unsubscribe_token,
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object('name', c.name, 'target_date', c.target_date, 'status', c.status, 'plan', c.plan) order by c.target_date)
        from public.courses c
       where c.user_id = u.id and c.plan is not null and c.status <> 'Completed'), '[]'::jsonb))
  from auth.users u
  left join public.email_prefs p on p.user_id = u.id
  where u.id = auth.uid();
$$;

revoke all on function public.my_weekly_checkin() from public, anon;
revoke all on function public.set_weekly_checkin(boolean, text) from public, anon;
revoke all on function public.my_weekly_digest() from public, anon;
revoke all on function public.unsubscribe_weekly(text) from public;
grant execute on function public.my_weekly_checkin() to authenticated;
grant execute on function public.set_weekly_checkin(boolean, text) to authenticated;
grant execute on function public.my_weekly_digest() to authenticated;
grant execute on function public.unsubscribe_weekly(text) to anon, authenticated;

-- The weekly job (a cron trigger in the Coach Worker) proves itself with a
-- job key. Only its SHA-256 hash is stored, in a schema the API doesn't
-- expose. To create or replace the key, run this in the SQL Editor and put
-- the result in the Worker (npx wrangler secret put DIGEST_JOB_KEY):
--   select private.new_digest_job_key();
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.job_keys (
  name       text primary key,
  key_hash   text not null,
  created_at timestamptz not null default now()
);

create or replace function private.new_digest_job_key()
returns text language plpgsql security definer set search_path = '' as $$
declare
  k text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into private.job_keys (name, key_hash)
  values ('weekly_digest', encode(sha256(convert_to(k, 'UTF8')), 'hex'))
  on conflict (name) do update set key_hash = excluded.key_hash, created_at = now();
  return k;
end $$;
revoke all on function private.new_digest_job_key() from public, anon, authenticated;

create or replace function private.check_job_key(job_key text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if job_key is null or not exists (
    select 1 from private.job_keys
     where name = 'weekly_digest' and key_hash = encode(sha256(convert_to(job_key, 'UTF8')), 'hex')
  ) then
    raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
  end if;
end $$;
revoke all on function private.check_job_key(text) from public, anon, authenticated;

-- Opted-in users whose local time is Monday, 8 AM or later, and who haven't
-- had this week's email yet (at most 100 per call)
create or replace function public.weekly_digest_due(job_key text, max_users integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.check_job_key(job_key);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', due.user_id,
             'email', u.email,
             'timezone', due.timezone,
             'unsubscribe_token', due.unsubscribe_token,
             'courses', coalesce((
               select jsonb_agg(jsonb_build_object('name', c.name, 'target_date', c.target_date, 'status', c.status, 'plan', c.plan) order by c.target_date)
                 from public.courses c
                where c.user_id = due.user_id and c.plan is not null and c.status <> 'Completed'), '[]'::jsonb)))
      from (select e.* from public.email_prefs e
             where e.weekly_checkin
               and extract(isodow from now() at time zone e.timezone) = 1
               and extract(hour from now() at time zone e.timezone) >= 8
               and (e.last_sent_at is null or e.last_sent_at < now() - interval '6 days')
             order by e.last_sent_at nulls first
             limit greatest(1, least(coalesce(max_users, 100), 100))) due
      join auth.users u on u.id = due.user_id
     where u.email is not null), '[]'::jsonb);
end $$;

-- Marks users as handled for this week (sent, or nothing to send)
create or replace function public.weekly_digest_sent(job_key text, user_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  perform private.check_job_key(job_key);
  update public.email_prefs set last_sent_at = now() where user_id = any(user_ids);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.weekly_digest_due(text, integer) from public;
revoke all on function public.weekly_digest_sent(text, uuid[]) from public;
grant execute on function public.weekly_digest_due(text, integer) to anon;
grant execute on function public.weekly_digest_sent(text, uuid[]) to anon;

-- -------------------------------------------------------------- feedback

-- Feedback from signed-in users, read and answered by the site owner
-- (accounts in stats_viewers) in the private Stats page. Users see their
-- own feedback and the replies to it. Nobody can read or write this table
-- directly; everything goes through the functions below.
create table if not exists public.feedback (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('idea', 'problem', 'praise')),
  message     text not null check (char_length(btrim(message)) between 1 and 2000),
  -- Optional app details the user chose to include (page, version, device, a few counts)
  context     jsonb check (context is null or (jsonb_typeof(context) = 'object' and octet_length(context::text) <= 2048)),
  status      text not null default 'new' check (status in ('new', 'planned', 'done', 'closed')),
  reply       text check (reply is null or char_length(reply) <= 2000),
  replied_at  timestamptz,
  reply_seen  boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists feedback_user_idx on public.feedback (user_id, created_at desc);
create index if not exists feedback_status_idx on public.feedback (status, created_at desc);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;

-- Sends feedback as the caller (at most 10 a day). Returns the new id.
create or replace function public.submit_feedback(kind text, message text, context jsonb default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  new_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = 'insufficient_privilege';
  end if;
  if (select count(*) from public.feedback f
       where f.user_id = auth.uid() and f.created_at > now() - interval '1 day') >= 10 then
    raise exception 'You''ve sent a lot of feedback today. Please try again tomorrow.' using errcode = 'check_violation';
  end if;
  insert into public.feedback (user_id, kind, message, context)
  values (auth.uid(), submit_feedback.kind, btrim(submit_feedback.message), submit_feedback.context)
  returning id into new_id;
  return new_id;
end $$;

-- The caller's own feedback, newest first, with replies
create or replace function public.my_feedback()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'kind', f.kind, 'message', f.message, 'status', f.status,
           'reply', f.reply, 'replied_at', f.replied_at, 'reply_seen', f.reply_seen, 'created_at', f.created_at)
         order by f.created_at desc), '[]'::jsonb)
    from (select * from public.feedback where user_id = auth.uid() order by created_at desc limit 50) f;
$$;

-- Marks the caller's replies as read
create or replace function public.mark_feedback_replies_seen()
returns void language sql security definer set search_path = '' as $$
  update public.feedback set reply_seen = true where user_id = auth.uid() and not reply_seen;
$$;

-- For the site owner: feedback with its context, newest first. No names or emails.
create or replace function public.admin_feedback(filter_status text default null, max_rows integer default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from public.stats_viewers v where v.user_id = auth.uid()) then
    raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', f.id, 'kind', f.kind, 'message', f.message, 'context', f.context, 'status', f.status,
             'reply', f.reply, 'replied_at', f.replied_at, 'created_at', f.created_at,
             -- A short, stable label per account, so several messages from one person can be grouped
             'author', substr(md5(f.user_id::text), 1, 6),
             'author_since', (select (u.created_at at time zone 'utc')::date from auth.users u where u.id = f.user_id))
           order by f.created_at desc)
      from (select * from public.feedback
             where filter_status is null or status = filter_status
             order by created_at desc
             limit greatest(1, least(coalesce(max_rows, 200), 500))) f), '[]'::jsonb);
end $$;

-- For the site owner: sets the status, and optionally a reply (shown to the user)
create or replace function public.admin_update_feedback(feedback_id bigint, new_status text, new_reply text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from public.stats_viewers v where v.user_id = auth.uid()) then
    raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
  end if;
  update public.feedback f set
    status     = new_status,
    reply      = case when new_reply is null then f.reply else nullif(btrim(new_reply), '') end,
    replied_at = case when new_reply is not null and nullif(btrim(new_reply), '') is distinct from f.reply then now() else f.replied_at end,
    reply_seen = case when new_reply is not null and nullif(btrim(new_reply), '') is distinct from f.reply and nullif(btrim(new_reply), '') is not null then false else f.reply_seen end
  where f.id = feedback_id;
end $$;

revoke all on function public.submit_feedback(text, text, jsonb) from public, anon;
revoke all on function public.my_feedback() from public, anon;
revoke all on function public.mark_feedback_replies_seen() from public, anon;
revoke all on function public.admin_feedback(text, integer) from public, anon;
revoke all on function public.admin_update_feedback(bigint, text, text) from public, anon;
grant execute on function public.submit_feedback(text, text, jsonb) to authenticated;
grant execute on function public.my_feedback() to authenticated;
grant execute on function public.mark_feedback_replies_seen() to authenticated;
grant execute on function public.admin_feedback(text, integer) to authenticated;
grant execute on function public.admin_update_feedback(bigint, text, text) to authenticated;

-- ---------------------------------------------------------- study partners

-- A learner can share their study progress with up to 5 people (a friend, a
-- mentor, a classmate), each through their own secret link (64 random hex
-- characters; the link is the credential, like the calendar feed). Partners
-- don't need an account. They see a read-only summary: this week's sessions,
-- the streak, and whether each plan is on track. Course and module names are
-- shared only if the learner turns that on. Partners can send one-tap cheers
-- from a fixed list (no free text, so a link can't be used to send messages).
-- Stopping sharing deletes the invite, and the link stops working at once.
-- Nobody can read or write these tables directly.
create table if not exists public.partner_invites (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  token          text not null unique check (token ~ '^[0-9a-f]{64}$'),
  -- What the learner calls this partner ("Sam", "My mentor"); shown only to the learner
  label          text not null check (char_length(btrim(label)) between 1 and 40),
  -- How the partner sees the learner ("Alex")
  display_name   text not null check (char_length(btrim(display_name)) between 1 and 40),
  show_names     boolean not null default false,
  timezone       text not null default 'UTC' check (char_length(timezone) <= 64),
  created_at     timestamptz not null default now(),
  last_viewed_at timestamptz
);
create index if not exists partner_invites_user_idx on public.partner_invites (user_id);
alter table public.partner_invites enable row level security;
revoke all on public.partner_invites from anon, authenticated;

create table if not exists public.partner_cheers (
  id         bigint generated always as identity primary key,
  invite_id  bigint not null references public.partner_invites (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('keep_going', 'proud', 'streak', 'you_got_this')),
  seen       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists partner_cheers_user_idx on public.partner_cheers (user_id, created_at desc);
create index if not exists partner_cheers_invite_idx on public.partner_cheers (invite_id, created_at desc);
alter table public.partner_cheers enable row level security;
revoke all on public.partner_cheers from anon, authenticated;

-- The caller's partners, with their links and how they've used them
create or replace function public.my_partners()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'label', i.label, 'display_name', i.display_name, 'token', i.token,
           'show_names', i.show_names, 'created_at', i.created_at, 'last_viewed_at', i.last_viewed_at,
           'cheers', (select count(*) from public.partner_cheers c where c.invite_id = i.id))
         order by i.created_at), '[]'::jsonb)
    from public.partner_invites i
   where i.user_id = auth.uid();
$$;

-- Invites a partner (at most 5). Returns the new invite's id and token.
create or replace function public.create_partner_invite(label text, display_name text, show_names boolean default false, tz text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  zone    text := 'UTC';
  new_id  bigint;
  new_tok text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = 'insufficient_privilege';
  end if;
  -- One at a time per account, so two quick clicks can't go past the limit
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('partner_invites:' || auth.uid()::text));
  if (select count(*) from public.partner_invites i where i.user_id = auth.uid()) >= 5 then
    raise exception 'You can have up to 5 study partners. Stop sharing with one to invite someone new.' using errcode = 'check_violation';
  end if;
  if tz is not null and exists (select 1 from pg_catalog.pg_timezone_names where name = tz) then
    zone := tz;
  end if;
  insert into public.partner_invites (user_id, token, label, display_name, show_names, timezone)
  values (auth.uid(), new_tok, btrim(create_partner_invite.label), btrim(create_partner_invite.display_name),
          coalesce(create_partner_invite.show_names, false), zone)
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'token', new_tok);
end $$;

-- Changes what one partner sees: course names, and the name they see you as
create or replace function public.update_partner_invite(invite_id bigint, show_names boolean, display_name text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = 'insufficient_privilege';
  end if;
  update public.partner_invites i set
    show_names   = coalesce(update_partner_invite.show_names, i.show_names),
    display_name = coalesce(nullif(btrim(update_partner_invite.display_name), ''), i.display_name)
  where i.id = invite_id and i.user_id = auth.uid();
  return found;
end $$;

-- Stops sharing with a partner: their link stops working, and their cheers are deleted
create or replace function public.delete_partner_invite(invite_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = 'insufficient_privilege';
  end if;
  delete from public.partner_invites i where i.id = invite_id and i.user_id = auth.uid();
  return found;
end $$;

-- What a partner sees, by link. Callable without signing in, but only with
-- the exact token. Sessions carry only dates, lengths and check-ins; names of
-- courses and modules are included only when the learner allowed it.
create or replace function public.partner_view(token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  inv public.partner_invites;
begin
  if token is null or token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select * into inv from public.partner_invites i where i.token = partner_view.token;
  if not found then
    return null;
  end if;
  -- Remember when the partner last looked (at most once an hour)
  if inv.last_viewed_at is null or inv.last_viewed_at < now() - interval '1 hour' then
    update public.partner_invites set last_viewed_at = now() where id = inv.id;
  end if;
  return jsonb_build_object(
    'display_name', inv.display_name,
    'show_names', inv.show_names,
    'timezone', inv.timezone,
    'cheers_today', (select count(*) from public.partner_cheers c
                      where c.invite_id = inv.id and c.created_at > now() - interval '1 day'),
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', case when inv.show_names then c.name end,
               'target_date', c.target_date,
               'status', c.status,
               'modules', (select coalesce(jsonb_agg(jsonb_build_object(
                                    'title', case when inv.show_names then left(m ->> 'title', 80) end,
                                    'done', (m -> 'done') = 'true'::jsonb)), '[]'::jsonb)
                             from jsonb_array_elements(case when jsonb_typeof(c.plan -> 'modules') = 'array' then c.plan -> 'modules' else '[]'::jsonb end) m
                            where jsonb_typeof(m) = 'object'),
               'sessions', (select coalesce(jsonb_agg(jsonb_build_object(
                                    'date', s -> 'date', 'minutes', s -> 'minutes', 'module', s -> 'module',
                                    'status', s -> 'status', 'actual_minutes', s -> 'actual_minutes')), '[]'::jsonb)
                              from jsonb_array_elements(case when jsonb_typeof(c.plan -> 'sessions') = 'array' then c.plan -> 'sessions' else '[]'::jsonb end) s
                             where jsonb_typeof(s) = 'object'))
             order by (c.status = 'Completed'), c.target_date, c.id)
        from public.courses c
       where c.user_id = inv.user_id and c.plan is not null), '[]'::jsonb));
end $$;

-- A one-tap cheer from a partner's link (at most 5 a day per link)
create or replace function public.send_cheer(token text, kind text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  inv public.partner_invites;
begin
  if token is null or token !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  select * into inv from public.partner_invites i where i.token = send_cheer.token for update;
  if not found then
    return false;
  end if;
  if (select count(*) from public.partner_cheers c
       where c.invite_id = inv.id and c.created_at > now() - interval '1 day') >= 5 then
    raise exception 'That''s plenty of cheering for today. Thank you! Come back tomorrow.' using errcode = 'check_violation';
  end if;
  insert into public.partner_cheers (invite_id, user_id, kind) values (inv.id, inv.user_id, send_cheer.kind);
  return true;
end $$;

-- The caller's cheers from the last 30 days, newest first, with who sent them
create or replace function public.my_cheers()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'from', i.label, 'seen', c.seen, 'created_at', c.created_at)
         order by c.created_at desc), '[]'::jsonb)
    from (select * from public.partner_cheers
           where user_id = auth.uid() and created_at > now() - interval '30 days'
           order by created_at desc limit 30) c
    join public.partner_invites i on i.id = c.invite_id;
$$;

create or replace function public.mark_cheers_seen()
returns void language sql security definer set search_path = '' as $$
  update public.partner_cheers set seen = true where user_id = auth.uid() and not seen;
$$;

revoke all on function public.my_partners() from public, anon;
revoke all on function public.create_partner_invite(text, text, boolean, text) from public, anon;
revoke all on function public.update_partner_invite(bigint, boolean, text) from public, anon;
revoke all on function public.delete_partner_invite(bigint) from public, anon;
revoke all on function public.my_cheers() from public, anon;
revoke all on function public.mark_cheers_seen() from public, anon;
revoke all on function public.partner_view(text) from public;
revoke all on function public.send_cheer(text, text) from public;
grant execute on function public.my_partners() to authenticated;
grant execute on function public.create_partner_invite(text, text, boolean, text) to authenticated;
grant execute on function public.update_partner_invite(bigint, boolean, text) to authenticated;
grant execute on function public.delete_partner_invite(bigint) to authenticated;
grant execute on function public.my_cheers() to authenticated;
grant execute on function public.mark_cheers_seen() to authenticated;
grant execute on function public.partner_view(text) to anon, authenticated;
grant execute on function public.send_cheer(text, text) to anon, authenticated;
