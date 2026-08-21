-- ============================================================================
-- Build Dallas — Part 3: profile <-> event keyword matching
--
-- Scoring runs in Postgres, not the client: the ranking has to sort the whole
-- upcoming set before paginating, so doing it in JS would mean shipping every
-- event to the browser on each page load.
--
-- Zero external calls. Pure array intersection against the same vocabulary that
-- tagged the events at ingest time.
-- ============================================================================

create or replace function public.array_overlap_count(a text[], b text[])
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select count(*)::integer
  from (select unnest(coalesce(a, '{}'::text[]))
        intersect
        select unnest(coalesce(b, '{}'::text[]))) as shared
$$;

-- Upcoming events ranked by overlap with the caller's profile keywords.
--
-- SECURITY INVOKER on purpose: RLS then does the right thing automatically —
-- the profiles lookup can only ever see the caller's own row, and anonymous
-- callers simply score 0 and get a plain chronological list.
create or replace function public.recommended_events(
  p_limit        integer default 50,
  p_offset       integer default 0,
  p_from         timestamptz default now(),
  p_only_matches boolean default false
)
returns table (
  id           uuid,
  title        text,
  description  text,
  start_time   timestamptz,
  end_time     timestamptz,
  location     text,
  venue        text,
  url          text,
  keywords     text[],
  match_score  integer,
  matched_terms text[]
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
    e.id, e.title, e.description, e.start_time, e.end_time,
    e.location, e.venue, e.url, e.keywords,
    public.array_overlap_count(e.keywords, me.kw) as match_score,
    array(select unnest(e.keywords) intersect select unnest(me.kw)) as matched_terms
  from public.events e cross join me
  where e.status = 'active'
    and (e.start_time is null or e.start_time >= p_from)
    -- `&&` is answerable from events_keywords_gin_idx, so the "show me only
    -- what matches" path stays an index scan instead of a full sort.
    and (not p_only_matches or e.keywords && me.kw)
  order by public.array_overlap_count(e.keywords, me.kw) desc,
           e.start_time asc nulls last
  limit greatest(p_limit, 0) offset greatest(p_offset, 0)
$$;

grant execute on function public.array_overlap_count(text[], text[]) to anon, authenticated;
grant execute on function public.recommended_events(integer, integer, timestamptz, boolean) to anon, authenticated;


-- Extracts profile keywords from resume text using the same vocabulary the
-- events were tagged with. Called from /profile after client-side PDF parsing,
-- so the raw resume text never has to leave the user's session except to be
-- stored on their own RLS-protected row.
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

  v_kw := public.match_keywords(p_text);

  insert into public.profiles (id, keywords, resume_raw_text)
  values (v_uid, v_kw, case when p_store_raw then p_text else null end)
  on conflict (id) do update
    set keywords        = excluded.keywords,
        resume_raw_text = case when p_store_raw then excluded.resume_raw_text
                               else public.profiles.resume_raw_text end;

  return v_kw;
end;
$$;

grant execute on function public.apply_resume_text(text, boolean) to authenticated;
