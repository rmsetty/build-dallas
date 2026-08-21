-- ============================================================================
-- Build Dallas — Part 1: core schema
-- Postgres 17 / Supabase. Safe to run once on an empty project.
-- ============================================================================

create extension if not exists pg_trgm  with schema extensions;  -- fuzzy dedupe
create extension if not exists btree_gin with schema extensions; -- composite GIN

-- Private schema: helper + trigger internals, never exposed via PostgREST.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- Shared helpers
-- ----------------------------------------------------------------------------

-- Normalizes a string for fuzzy matching: lowercase, alphanumerics only.
-- IMMUTABLE so it can back generated columns + trigram indexes.
create or replace function public.norm_text(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(regexp_replace(coalesce(p, ''), '[^a-zA-Z0-9]+', '', 'g'))
$$;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ----------------------------------------------------------------------------
-- sources
-- ----------------------------------------------------------------------------
create table public.sources (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  url                  text not null,
  source_type          text not null check (source_type in ('api', 'html')),
  platform             text not null check (platform in ('luma', 'eventbrite', 'meetup', 'html')),
  -- Per-source fetch recipe. Shape varies by platform, e.g.
  --   luma:       {"calendar_slug": "...", "endpoint": "..."}
  --   meetup:     {"group_urlname": "..."}
  --   eventbrite: {"search_path": "/d/tx--dallas/startup-events/"}
  --   html:       {"content_selector": "main", "llm_hint": "..."}
  scrape_strategy      jsonb not null default '{}'::jsonb,
  last_run_at          timestamptz,
  last_success_at      timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_error           text,
  active               boolean not null default true,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint sources_platform_url_key unique (platform, url)
);

-- The cron Worker's only query: active sources, stalest first.
create index sources_active_last_run_idx on public.sources (last_run_at nulls first) where active;

create trigger sources_set_updated_at
  before update on public.sources
  for each row execute function private.set_updated_at();


-- ----------------------------------------------------------------------------
-- events
-- ----------------------------------------------------------------------------
create table public.events (
  id               uuid primary key default gen_random_uuid(),
  source_id        uuid references public.sources(id) on delete set null,
  title            text not null,
  description      text,
  start_time       timestamptz,
  end_time         timestamptz,
  location         text,                     -- full address / "Online" as scraped
  venue            text,                     -- venue name only, used for dedupe
  url              text,
  external_id      text,                     -- platform-native id, unique per source
  raw_content_hash text,                     -- skip re-processing unchanged pages
  status           text not null default 'active'
                     check (status in ('active', 'cancelled', 'postponed', 'duplicate', 'needs_review')),
  keywords         text[] not null default '{}'::text[],
  title_norm       text generated always as (public.norm_text(title)) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint events_time_order check (end_time is null or start_time is null or end_time >= start_time)
);

create unique index events_source_external_id_key
  on public.events (source_id, external_id) where external_id is not null;

create index events_start_time_idx      on public.events (start_time);
create index events_upcoming_idx        on public.events (start_time) where status = 'active';
create index events_status_idx          on public.events (status);
create index events_source_id_idx       on public.events (source_id);
create index events_content_hash_idx    on public.events (raw_content_hash) where raw_content_hash is not null;
create index events_dedupe_idx          on public.events (title_norm, start_time);
create index events_title_trgm_idx      on public.events using gin (title_norm extensions.gin_trgm_ops);
create index events_keywords_gin_idx    on public.events using gin (keywords);

create trigger events_set_updated_at
  before update on public.events
  for each row execute function private.set_updated_at();


-- ----------------------------------------------------------------------------
-- companies
-- ----------------------------------------------------------------------------
create table public.companies (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  name_norm          text generated always as (public.norm_text(name)) stored,
  description        text,
  stage              text check (stage in ('idea', 'pre-seed', 'seed', 'series-a', 'series-b',
                                           'series-c-plus', 'growth', 'bootstrapped',
                                           'acquired', 'public', 'unknown')),
  tags               text[] not null default '{}'::text[],
  website            text,
  verified_by        uuid references auth.users(id) on delete set null,
  last_seen_event_id uuid references public.events(id) on delete set null,
  last_seen_at       timestamptz,             -- denormalized for the freshness sort on /companies
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index companies_name_norm_key    on public.companies (name_norm);
create index companies_last_seen_at_idx        on public.companies (last_seen_at desc nulls last);
create index companies_stage_idx               on public.companies (stage);
create index companies_tags_gin_idx            on public.companies using gin (tags);
create index companies_name_trgm_idx           on public.companies using gin (name_norm extensions.gin_trgm_ops);
create index companies_last_seen_event_id_idx  on public.companies (last_seen_event_id);
create index companies_verified_by_idx         on public.companies (verified_by);

create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function private.set_updated_at();


-- ----------------------------------------------------------------------------
-- people
-- ----------------------------------------------------------------------------
create table public.people (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  linkedin_url text,
  company_id   uuid references public.companies(id) on delete set null,
  role         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index people_linkedin_url_key on public.people (lower(linkedin_url)) where linkedin_url is not null;
create index people_company_id_idx          on public.people (company_id);
create index people_name_trgm_idx           on public.people using gin (public.norm_text(name) extensions.gin_trgm_ops);

create trigger people_set_updated_at
  before update on public.people
  for each row execute function private.set_updated_at();


-- ----------------------------------------------------------------------------
-- join tables
-- ----------------------------------------------------------------------------
create table public.event_company_links (
  event_id     uuid not null references public.events(id) on delete cascade,
  company_id   uuid not null references public.companies(id) on delete cascade,
  relationship text not null default 'mentioned'
                 check (relationship in ('host', 'sponsor', 'presenter', 'mentioned')),
  created_at   timestamptz not null default now(),
  primary key (event_id, company_id, relationship)
);
create index event_company_links_company_id_idx on public.event_company_links (company_id);

create table public.event_people_links (
  event_id   uuid not null references public.events(id) on delete cascade,
  person_id  uuid not null references public.people(id) on delete cascade,
  role       text not null default 'mentioned'
               check (role in ('speaker', 'host', 'organizer', 'panelist', 'mentioned')),
  created_at timestamptz not null default now(),
  primary key (event_id, person_id, role)
);
create index event_people_links_person_id_idx on public.event_people_links (person_id);


-- ----------------------------------------------------------------------------
-- profiles (extends auth.users)
-- ----------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  display_name     text,
  school           text,                        -- extracted from resume (Part 3)
  keywords         text[] not null default '{}'::text[],
  target_roles     text[] not null default '{}'::text[],
  resume_raw_text  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index profiles_keywords_gin_idx on public.profiles using gin (keywords);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- Auto-create an empty profile row on signup.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();


-- ----------------------------------------------------------------------------
-- wiki: editable-field allowlist + edit log
-- ----------------------------------------------------------------------------
create table public.wiki_editable_fields (
  entity_type text not null check (entity_type in ('company', 'event', 'person')),
  field_name  text not null,
  value_type  text not null default 'text' check (value_type in ('text', 'text[]')),
  primary key (entity_type, field_name)
);

insert into public.wiki_editable_fields (entity_type, field_name, value_type) values
  ('company', 'name',        'text'),
  ('company', 'description', 'text'),
  ('company', 'stage',       'text'),
  ('company', 'website',     'text'),
  ('company', 'tags',        'text[]'),
  ('event',   'title',       'text'),
  ('event',   'description', 'text'),
  ('event',   'location',    'text'),
  ('event',   'venue',       'text'),
  ('event',   'url',         'text'),
  ('person',  'name',        'text'),
  ('person',  'role',        'text'),
  ('person',  'linkedin_url','text');

create table public.wiki_edits (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null check (entity_type in ('company', 'event', 'person')),
  entity_id    uuid not null,
  field_name   text not null,
  old_value    text,                        -- always server-captured, never client-supplied
  new_value    text,
  submitted_by uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending'
                 check (status in ('auto_applied', 'pending', 'rejected')),
  applied_at   timestamptz,
  reviewed_by  uuid references auth.users(id) on delete set null,
  review_note  text,
  created_at   timestamptz not null default now(),
  foreign key (entity_type, field_name) references public.wiki_editable_fields (entity_type, field_name)
);

create index wiki_edits_entity_idx  on public.wiki_edits (entity_type, entity_id);
create index wiki_edits_pending_idx on public.wiki_edits (entity_type, entity_id, field_name) where status = 'pending';
create index wiki_edits_submitter_idx on public.wiki_edits (submitted_by);
create index wiki_edits_reviewed_by_idx on public.wiki_edits (reviewed_by);

-- One open suggestion per user per field: keeps corroboration counting honest.
create unique index wiki_edits_one_pending_per_user_idx
  on public.wiki_edits (entity_type, entity_id, field_name, submitted_by) where status = 'pending';


-- entity_type -> table name
create or replace function private.wiki_entity_table(p_entity_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_entity_type
           when 'company' then 'companies'
           when 'event'   then 'events'
           when 'person'  then 'people'
         end
$$;

-- Writes an approved value onto the target row. Allowlist-gated dynamic SQL.
create or replace function private.wiki_apply_edit(
  p_entity_type text, p_entity_id uuid, p_field_name text, p_new_value text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text;
  v_type  text;
begin
  select f.value_type into v_type
  from public.wiki_editable_fields f
  where f.entity_type = p_entity_type and f.field_name = p_field_name;

  if v_type is null then
    raise exception 'field %.% is not wiki-editable', p_entity_type, p_field_name;
  end if;

  v_table := private.wiki_entity_table(p_entity_type);

  -- %I quotes identifiers; v_type is constrained to 'text' | 'text[]' by CHECK.
  execute format('update public.%I set %I = $1::%s, updated_at = now() where id = $2',
                 v_table, p_field_name, v_type)
  using p_new_value, p_entity_id;
end;
$$;

-- Validate the suggestion and capture the authoritative old_value.
create or replace function private.wiki_edits_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table   text;
  v_exists  boolean;
  v_current text;
begin
  new.submitted_by := coalesce(new.submitted_by, auth.uid());
  if new.submitted_by is null then
    raise exception 'wiki edits require an authenticated submitter';
  end if;

  v_table := private.wiki_entity_table(new.entity_type);

  execute format('select exists (select 1 from public.%I t where t.id = $1)', v_table)
    into v_exists using new.entity_id;
  if not v_exists then
    raise exception 'no % with id %', new.entity_type, new.entity_id;
  end if;

  execute format('select (t.%I)::text from public.%I t where t.id = $1', new.field_name, v_table)
    into v_current using new.entity_id;

  new.old_value  := v_current;
  new.status     := 'pending';   -- the AFTER trigger is the only thing that promotes
  new.applied_at := null;
  return new;
end;
$$;

-- Auto-apply under trusted conditions:
--   (a) the submitter is the verified owner of the company, or
--   (b) 2+ different users have suggested the same value for the same field.
create or replace function private.wiki_edits_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_owner        boolean := false;
  v_corroborators   integer := 0;
  v_matching_ids    uuid[];
begin
  if new.entity_type = 'company' then
    select exists (
      select 1 from public.companies c
      where c.id = new.entity_id and c.verified_by = new.submitted_by
    ) into v_is_owner;
  end if;

  select coalesce(array_agg(e.id), '{}'::uuid[]), count(distinct e.submitted_by)
    into v_matching_ids, v_corroborators
  from public.wiki_edits e
  where e.entity_type = new.entity_type
    and e.entity_id   = new.entity_id
    and e.field_name  = new.field_name
    and e.status      = 'pending'
    and lower(btrim(coalesce(e.new_value, ''))) = lower(btrim(coalesce(new.new_value, '')));

  if v_is_owner or v_corroborators >= 2 then
    perform private.wiki_apply_edit(new.entity_type, new.entity_id, new.field_name, new.new_value);

    update public.wiki_edits
      set status = 'auto_applied', applied_at = now()
      where id = any(v_matching_ids);
  end if;

  return null;
end;
$$;

create trigger wiki_edits_validate
  before insert on public.wiki_edits
  for each row execute function private.wiki_edits_before_insert();

create trigger wiki_edits_autoapply
  after insert on public.wiki_edits
  for each row execute function private.wiki_edits_after_insert();


-- ----------------------------------------------------------------------------
-- uploads
-- ----------------------------------------------------------------------------
create table public.uploads (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid references public.events(id) on delete set null,
  uploaded_by   uuid references auth.users(id) on delete set null,
  upload_type   text not null check (upload_type in ('photo', 'flyer', 'deck', 'attendee_list', 'notes', 'other')),
  storage_path  text not null,
  status        text not null default 'pending'
                  check (status in ('pending', 'processing', 'processed', 'failed', 'rejected')),
  error_message text,
  processed_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index uploads_event_id_idx    on public.uploads (event_id);
create index uploads_uploaded_by_idx on public.uploads (uploaded_by);
create index uploads_pending_idx     on public.uploads (created_at) where status = 'pending';


-- ----------------------------------------------------------------------------
-- Dedupe RPC — fuzzy title + time-window + venue match, entirely in Postgres.
-- The queue consumer calls this over PostgREST so no fuzzy matching runs in
-- Worker JS. Returns the id of an existing duplicate, or null.
-- ----------------------------------------------------------------------------
create or replace function public.find_duplicate_event(
  p_title      text,
  p_start_time timestamptz default null,
  p_venue      text default null,
  p_window     interval default interval '12 hours',
  p_threshold  real default 0.55
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.events e
  where e.status <> 'duplicate'
    and e.title_norm operator(extensions.%) public.norm_text(p_title)
    and extensions.similarity(e.title_norm, public.norm_text(p_title)) >= p_threshold
    and (
      p_start_time is null
      or e.start_time is null
      or e.start_time between p_start_time - p_window and p_start_time + p_window
    )
    and (
      p_venue is null
      or e.venue is null
      or extensions.similarity(public.norm_text(e.venue), public.norm_text(p_venue)) >= 0.4
    )
  order by extensions.similarity(e.title_norm, public.norm_text(p_title)) desc,
           e.created_at
  limit 1
$$;

revoke execute on function public.find_duplicate_event(text, timestamptz, text, interval, real)
  from public, anon, authenticated;
grant execute on function public.find_duplicate_event(text, timestamptz, text, interval, real)
  to service_role;


-- ============================================================================
-- Row Level Security
-- ============================================================================

-- sources: operational config. RLS on, zero policies => service_role only.
alter table public.sources enable row level security;

-- Public read, service-role write (service_role bypasses RLS, so no write policies).
alter table public.events              enable row level security;
alter table public.companies           enable row level security;
alter table public.people              enable row level security;
alter table public.event_company_links enable row level security;
alter table public.event_people_links  enable row level security;
alter table public.wiki_editable_fields enable row level security;

create policy "events readable by anyone" on public.events
  for select to anon, authenticated using (true);

create policy "companies readable by anyone" on public.companies
  for select to anon, authenticated using (true);

create policy "people readable by anyone" on public.people
  for select to anon, authenticated using (true);

create policy "event_company_links readable by anyone" on public.event_company_links
  for select to anon, authenticated using (true);

create policy "event_people_links readable by anyone" on public.event_people_links
  for select to anon, authenticated using (true);

create policy "wiki_editable_fields readable by anyone" on public.wiki_editable_fields
  for select to anon, authenticated using (true);


-- profiles: strictly owner-scoped.
alter table public.profiles enable row level security;

create policy "profiles select own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

create policy "profiles insert own" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);

create policy "profiles update own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "profiles delete own" on public.profiles
  for delete to authenticated using ((select auth.uid()) = id);


-- wiki_edits: logged-in users read the full edit history, insert only as
-- themselves, and may revise/withdraw only their own still-pending suggestion.
-- status can never be self-promoted: the BEFORE trigger forces 'pending', and
-- the update policy's WITH CHECK pins it there.
alter table public.wiki_edits enable row level security;

create policy "wiki_edits readable by authenticated" on public.wiki_edits
  for select to authenticated using (true);

create policy "wiki_edits insert own" on public.wiki_edits
  for insert to authenticated
  with check ((select auth.uid()) = submitted_by);

create policy "wiki_edits update own pending" on public.wiki_edits
  for update to authenticated
  using ((select auth.uid()) = submitted_by and status = 'pending')
  with check ((select auth.uid()) = submitted_by and status = 'pending');

create policy "wiki_edits delete own pending" on public.wiki_edits
  for delete to authenticated
  using ((select auth.uid()) = submitted_by and status = 'pending');


-- uploads: owner-scoped.
alter table public.uploads enable row level security;

create policy "uploads select own" on public.uploads
  for select to authenticated using ((select auth.uid()) = uploaded_by);

create policy "uploads insert own" on public.uploads
  for insert to authenticated with check ((select auth.uid()) = uploaded_by);

create policy "uploads delete own" on public.uploads
  for delete to authenticated using ((select auth.uid()) = uploaded_by);
