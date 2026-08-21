-- ============================================================================
-- Build Dallas — member directory
--
-- "See everyone else on the site" needs profiles to be readable by other
-- members. RLS is row-level, not column-level, so simply adding a policy for
-- public rows would expose resume_raw_text along with the rest of the row.
--
-- So the resume moves out first. After this migration public.profiles contains
-- nothing that is not intended to be shown, which makes the visibility policy
-- a one-liner instead of a thing to be careful about.
-- ============================================================================

create table public.profile_resumes (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  raw_text   text,
  updated_at timestamptz not null default now()
);

alter table public.profile_resumes enable row level security;

create policy "profile_resumes select own" on public.profile_resumes
  for select to authenticated using ((select auth.uid()) = profile_id);
create policy "profile_resumes insert own" on public.profile_resumes
  for insert to authenticated with check ((select auth.uid()) = profile_id);
create policy "profile_resumes update own" on public.profile_resumes
  for update to authenticated
  using ((select auth.uid()) = profile_id) with check ((select auth.uid()) = profile_id);
create policy "profile_resumes delete own" on public.profile_resumes
  for delete to authenticated using ((select auth.uid()) = profile_id);

insert into public.profile_resumes (profile_id, raw_text)
select id, resume_raw_text from public.profiles where resume_raw_text is not null;

alter table public.profiles drop column resume_raw_text;


-- Directory fields. is_public defaults to FALSE: appearing in a public
-- directory is a choice the member makes on /profile, not a side effect of
-- signing up.
alter table public.profiles
  add column is_public    boolean not null default false,
  add column headline     text,
  add column role_label   text,
  add column linkedin_url text,
  add column website      text;

create index profiles_is_public_idx on public.profiles (is_public) where is_public;
create index profiles_role_label_idx on public.profiles (role_label) where is_public;

create policy "profiles select public" on public.profiles
  for select to anon, authenticated using (is_public);


-- ----------------------------------------------------------------------------
-- Resume application, updated for the split table.
-- ----------------------------------------------------------------------------
create or replace function public.apply_resume_text(p_text text, p_store_raw boolean default true)
returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_kw  text[];
begin
  if v_uid is null then
    raise exception 'must be signed in to update a profile';
  end if;

  v_kw := coalesce(public.match_keywords(p_text), '{}'::text[]);

  insert into public.profiles (id, keywords)
  values (v_uid, v_kw)
  on conflict (id) do update set keywords = excluded.keywords;

  if p_store_raw then
    insert into public.profile_resumes (profile_id, raw_text, updated_at)
    values (v_uid, p_text, now())
    on conflict (profile_id) do update
      set raw_text = excluded.raw_text, updated_at = now();
  end if;

  return v_kw;
end;
$$;

grant execute on function public.apply_resume_text(text, boolean) to authenticated;


-- ----------------------------------------------------------------------------
-- Directory read. SECURITY INVOKER, so the "is_public" policy above is what
-- actually decides who is listed — the function adds ranking, not access.
--
-- Ranking runs here rather than in the client for the same reason /events does
-- it: sorting by shared-keyword overlap requires the whole set.
-- ----------------------------------------------------------------------------
create or replace function public.member_directory(
  p_search text default null,
  p_role   text default null,
  p_limit  integer default 200,
  p_offset integer default 0
)
returns table (
  id             uuid,
  display_name   text,
  headline       text,
  role_label     text,
  school         text,
  keywords       text[],
  target_roles   text[],
  linkedin_url   text,
  website        text,
  created_at     timestamptz,
  shared_count   integer,
  shared_terms   text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (
    select coalesce(
      (select p.keywords from public.profiles p where p.id = (select auth.uid())),
      '{}'::text[]
    ) as kw
  )
  select
    p.id, p.display_name, p.headline, p.role_label, p.school,
    p.keywords, p.target_roles, p.linkedin_url, p.website, p.created_at,
    public.array_overlap_count(p.keywords, me.kw) as shared_count,
    array(select unnest(p.keywords) intersect select unnest(me.kw)) as shared_terms
  from public.profiles p cross join me
  where p.is_public
    and p.id is distinct from (select auth.uid())
    and (p_role is null or p.role_label = p_role)
    and (
      p_search is null or btrim(p_search) = ''
      or p.display_name ilike '%' || p_search || '%'
      or p.headline     ilike '%' || p_search || '%'
      or p.school       ilike '%' || p_search || '%'
      or exists (select 1 from unnest(p.keywords) k where k ilike '%' || p_search || '%')
    )
  order by public.array_overlap_count(p.keywords, me.kw) desc,
           p.created_at desc
  limit greatest(p_limit, 0) offset greatest(p_offset, 0)
$$;

grant execute on function public.member_directory(text, text, integer, integer) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- Public counters. The directory only lists members who opted in, so the
-- landing page needs a way to say "1,076 companies / 362 events" without
-- reading either table in full from the browser.
-- ----------------------------------------------------------------------------
create or replace function public.ecosystem_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'events',          (select count(*) from public.events
                         where status = 'active' and start_time >= now()),
    'companies',       (select count(*) from public.companies),
    'companies_dfw',   (select count(*) from public.companies where dfw),
    'companies_raising',(select count(*) from public.companies where signal = 'raising'),
    'members',         (select count(*) from public.profiles where is_public),
    'sources',         (select count(*) from public.sources where active)
                       + (select count(*) from public.company_sources where active),
    'updated_at',      now()
  )
$$;

grant execute on function public.ecosystem_stats() to anon, authenticated;


-- ----------------------------------------------------------------------------
-- Re-tag existing rows against the corrected vocabulary.
--
-- match_keywords() reads keywords.active at call time, so deactivating 'go' and
-- 'ama' in an earlier migration only changed how NEW rows are tagged. The rows
-- already in the table kept their false-positive tags until re-tagged.
-- ----------------------------------------------------------------------------
update public.events e
   set keywords = coalesce(public.match_keywords(
         coalesce(e.title,'') || ' ' || coalesce(e.description,'')), '{}'::text[])
 where e.keywords && array['go','ama'];

update public.companies c
   set tags = coalesce(public.match_keywords(
         coalesce(c.name,'') || ' ' || coalesce(c.one_liner,'') || ' ' || coalesce(c.description,'')), '{}'::text[])
 where c.tags && array['go','ama'];
