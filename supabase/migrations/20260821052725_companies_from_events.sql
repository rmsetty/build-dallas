-- ============================================================================
-- Build Dallas — companies from events (zero network calls)
--
-- The richest Dallas-specific company signal we already own is the event corpus:
-- 362 upcoming events whose titles and descriptions name the orgs hosting,
-- sponsoring and pitching. Mining it costs one function call and no API budget.
--
-- Two passes, deliberately separate:
--   1. extract  — find NEW company names in event text (precision over recall;
--                 a junk row in a searchable directory is worse than a miss)
--   2. link     — connect events to companies we already know, which is what
--                 keeps `last_seen_at` on /companies honest
-- ============================================================================

-- Phrases that match the grammar of a company mention but are not companies.
-- Checked against norm_text output, so spacing and punctuation do not matter.
create or replace function private.is_junk_company(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.norm_text(p_name) = any (array[
    'us','our','ourteam','the','thisevent','theevent','theteam','thecommunity',
    'thefollowing','ourpartners','ourfriends','ourhosts','ourteamat','me','you',
    'yourhost','yourhosts','popular','demand','thecity','thedallas','members',
    'thesponsors','oursponsors','local','severallocal','manylocal','anumber',
    'community','industry','avarietyof','allofour','someofour','variousof',
    'oneofour','partners','sponsors','friends','volunteers','attendees','guests'
  ])
  -- A trailing preposition/conjunction means the capture ran past the name.
  or public.norm_text(p_name) ~ '(and|with|for|from|that|which|who|will|are|is)$'
  or length(public.norm_text(p_name)) < 4
$$;


-- Tidy one raw regex capture into a company name, or NULL if it is not one.
create or replace function private.clean_company_name(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_raw, ''));
begin
  -- Strip markup leftovers and collapse whitespace.
  v := regexp_replace(v, '<[^>]*>', ' ', 'g');
  v := btrim(regexp_replace(v, '\s+', ' ', 'g'));

  -- Cut at the first clause boundary: captures routinely run into the next
  -- sentence ("Hosted by Capital Factory and join us at 6pm").
  v := split_part(v, ' — ', 1);
  v := split_part(v, ' – ', 1);
  v := regexp_replace(v, '\s+(and|&|plus|with|at|on|in|for|to)\s.*$', '', 'i');

  -- Drop possessives, trailing punctuation and enclosing brackets.
  v := regexp_replace(v, '[''’]s$', '', 'i');
  v := btrim(v, ' .,;:!?-–—''"“”()[]');

  -- Keep it to a plausible name length: 1-5 words.
  if v = '' or array_length(regexp_split_to_array(v, '\s+'), 1) > 5 then
    return null;
  end if;
  if length(v) > 60 then
    return null;
  end if;

  -- Must start with a capital or digit; a lowercase start means the regex
  -- caught ordinary prose rather than a proper noun.
  if v !~ '^[A-Z0-9]' then
    return null;
  end if;

  if private.is_junk_company(v) then
    return null;
  end if;

  return v;
end;
$$;


-- ----------------------------------------------------------------------------
-- Pass 1 — extract company names out of event text.
-- ----------------------------------------------------------------------------
create or replace function public.extract_companies_from_events(
  p_since timestamptz default null,
  p_limit integer default 2000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e         record;
  m         text[];
  v_name    text;
  v_rel     text;
  v_id      uuid;
  v_norm    text;
  n_new  integer := 0;
  n_link integer := 0;
  n_seen integer := 0;
begin
  for e in
    select ev.id, ev.title, ev.description, ev.start_time, ev.keywords
    from public.events ev
    where ev.status = 'active'
      and (p_since is null or ev.updated_at >= p_since)
    order by ev.start_time nulls last
    limit greatest(p_limit, 0)
  loop
    -- Each pattern carries the relationship it implies, so "sponsored by" does
    -- not get filed as a host.
    for v_rel, m in
      select 'host',      regexp_matches(coalesce(e.title,'') || '. ' || coalesce(e.description,''),
               '(?:hosted|organized|organised|presented|produced)\s+by\s+([A-Z0-9][^.,;:!?\n|•·]{2,60})', 'gi')
      union all
      select 'sponsor',   regexp_matches(coalesce(e.description,''),
               '(?:sponsored|powered|supported|underwritten)\s+by\s+([A-Z0-9][^.,;:!?\n|•·]{2,60})', 'gi')
      union all
      select 'sponsor',   regexp_matches(coalesce(e.description,''),
               'in\s+partnership\s+with\s+([A-Z0-9][^.,;:!?\n|•·]{2,60})', 'gi')
      union all
      -- Legal/industry suffixes are the highest-precision pattern we have: a
      -- token sequence ending in "Labs"/"Ventures"/"Inc" is almost never prose.
      select 'mentioned', regexp_matches(coalesce(e.title,'') || '. ' || coalesce(e.description,''),
               '([A-Z][A-Za-z0-9&''.-]*(?:\s+[A-Z][A-Za-z0-9&''.-]*){0,3}\s+(?:Inc|Inc\.|LLC|L\.L\.C\.|Labs|Laboratories|Technologies|Technology|Ventures|Capital|Partners|Robotics|Systems|Software|Biosciences|Therapeutics|Health|Analytics|Networks|Studios|Holdings|Group|Solutions|Industries|Dynamics|Sciences))\M', 'g')
    loop
      v_name := private.clean_company_name(m[1]);
      continue when v_name is null;

      v_norm := public.norm_text(v_name);
      select c.id into v_id from public.companies c where c.name_norm = v_norm;

      if v_id is null then
        insert into public.companies (name, signal, signal_detail, signal_at,
                                      discovered_via, last_seen_event_id, last_seen_at,
                                      hq_location, tags)
        values (v_name, 'event_active',
                'Named in "' || left(e.title, 80) || '"',
                coalesce(e.start_time, now()),
                array['events'], e.id, coalesce(e.start_time, now()),
                'Dallas–Fort Worth, TX', e.keywords)
        returning id into v_id;
        n_new := n_new + 1;
      else
        n_seen := n_seen + 1;
      end if;

      insert into public.event_company_links (event_id, company_id, relationship)
      values (e.id, v_id, v_rel)
      on conflict do nothing;
      if found then n_link := n_link + 1; end if;
    end loop;
  end loop;

  return jsonb_build_object('new_companies', n_new, 'links', n_link, 'already_known', n_seen);
end;
$$;


-- ----------------------------------------------------------------------------
-- Pass 2 — link events to companies we already know, and refresh freshness.
--
-- Runs AFTER every directory import, so a company harvested from YC or a Form D
-- filing picks up "seen at a Dallas event last week" as its freshness signal.
-- ----------------------------------------------------------------------------
create or replace function public.link_events_to_companies(p_limit integer default 5000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_link integer := 0;
  n_fresh integer := 0;
begin
  -- Whole-token containment via kw_normalize (the padded, punctuation-stripped
  -- form), so "Latica" matches "Latica," but not "Laticalabs". Names shorter
  -- than 5 normalized characters are excluded: "Allen" and "Go" would match
  -- half the corpus.
  with hits as (
    select ev.id as event_id, c.id as company_id, ev.start_time
    from public.events ev
    join public.companies c
      on length(c.name_norm) >= 5
     and public.kw_normalize(coalesce(ev.title,'') || ' ' || coalesce(ev.description,''))
           like '%' || public.kw_normalize(c.name) || '%'
    where ev.status = 'active'
    limit greatest(p_limit, 0)
  ),
  linked as (
    insert into public.event_company_links (event_id, company_id, relationship)
    select event_id, company_id, 'mentioned' from hits
    on conflict do nothing
    returning 1
  ),
  freshest as (
    select company_id, max(start_time) as seen_at
    from hits where start_time is not null
    group by company_id
  ),
  bumped as (
    update public.companies c set
      last_seen_at       = greatest(coalesce(c.last_seen_at, f.seen_at), f.seen_at),
      last_seen_event_id = coalesce(
        (select h.event_id from hits h
          where h.company_id = c.id order by h.start_time desc nulls last limit 1),
        c.last_seen_event_id),
      signal      = case when c.signal_at is null or f.seen_at > c.signal_at
                         then 'event_active' else c.signal end,
      signal_at   = greatest(coalesce(c.signal_at, f.seen_at), f.seen_at)
    from freshest f
    where c.id = f.company_id
    returning 1
  )
  select (select count(*) from linked), (select count(*) from bumped)
    into n_link, n_fresh;

  return jsonb_build_object('links', n_link, 'refreshed', n_fresh);
end;
$$;

revoke execute on function public.extract_companies_from_events(timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.link_events_to_companies(integer)                    from public, anon, authenticated;
grant  execute on function public.extract_companies_from_events(timestamptz, integer)  to service_role;
grant  execute on function public.link_events_to_companies(integer)                    to service_role;


-- ----------------------------------------------------------------------------
-- Vocabulary fix, flagged during Part 4 verification.
--
-- 'go' matched the ordinary English verb on 25 events and 'ama' matched inside
-- ordinary prose. Both were producing false tags on events, and would now do
-- the same to every company description we ingest. Deactivated rather than
-- deleted so the term and its aliases stay recoverable.
-- ----------------------------------------------------------------------------
update public.keywords set active = false where term in ('go', 'ama');
