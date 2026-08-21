-- ============================================================================
-- Build Dallas — company extraction precision
--
-- The first pass over the event corpus produced 20 companies of which only ~4
-- were real: "Venture Capital", "Student Health", "Enterprise Technology", plus
-- a couple of person names. Two rules fix it:
--
--   1. A candidate whose every token is a generic ecosystem word is an industry
--      phrase, not a company name.
--   2. A candidate without a strong legal suffix has to appear across TWO
--      different events before it earns a row — the same corroboration idea the
--      wiki uses for edits, applied to extraction.
--
-- The suffix list also shrank hard: "Health", "Capital", "Systems" and
-- "Technology" match ordinary title-case noun phrases and caused most of the
-- junk on their own.
-- ============================================================================

delete from public.event_company_links l
 using public.companies c
 where l.company_id = c.id and c.discovered_via = array['events'];
delete from public.companies where discovered_via = array['events'];

create or replace function private.generic_company_token(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(p) = any (array[
    'a','an','the','of','and','or','for','in','at','to','with','on','by','your','our','my','this','that',
    'tech','technology','technologies','digital','software','hardware','cloud','data','ai','analytics',
    'health','healthcare','medical','mental','physical','wellness','fitness','care',
    'capital','venture','ventures','fund','funds','investment','investments','equity','finance','financial',
    'science','sciences','research','innovation','engineering','information','systems','system',
    'enterprise','business','corporate','professional','industry','industries','market','marketing','sales',
    'startup','startups','founder','founders','entrepreneur','entrepreneurs','entrepreneurship',
    'learning','education','training','school','college','university','student','students','academy',
    'summit','expo','conference','workshop','session','sessions','seminar','webinar','meetup','event','events',
    'network','networking','community','group','club','association','society','institute','center','centre',
    'solutions','services','service','consulting','management','manager','director','officer','leadership',
    'transformation','strategy','strategies','development','design','product','project','program','programs',
    'dallas','texas','fort','worth','plano','frisco','irving','richardson','denton','arlington','dfw','north',
    'america','american','usa','us','global','world','national','international','regional','local',
    'day','days','night','week','weekend','month','year','annual','today','todays','tomorrow','new','next',
    'january','february','march','april','may','june','july','august','september','october','november','december',
    'first','second','third','best','top','free','live','online','virtual','open','future','young','women','men',
    'invest','investing','money','job','jobs','career','careers','hiring','talent','people','team','teams',
    'food','culture','house','party','social','happy','hour','lunch','breakfast','dinner','coffee',
    'assurance','security','compliance','quality','support','supporting','building','build','make','making'
  ])
$$;

create or replace function private.is_junk_company(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    length(public.norm_text(p_name)) < 4
    or public.norm_text(p_name) ~ '(and|with|for|from|that|which|who|will|are|is|the)$'
    or not exists (
      select 1 from unnest(regexp_split_to_array(btrim(p_name), '\s+')) as tok
      where regexp_replace(tok, '[^A-Za-z0-9]', '', 'g') <> ''
        and not private.generic_company_token(regexp_replace(tok, '[^A-Za-z0-9]', '', 'g'))
    )
$$;

create or replace function private.clean_company_name(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_raw, ''));
begin
  v := regexp_replace(v, '<[^>]*>', ' ', 'g');
  v := btrim(regexp_replace(v, '\s+', ' ', 'g'));

  v := split_part(v, ' — ', 1);
  v := split_part(v, ' – ', 1);
  v := regexp_replace(v, '\s+(and|or|&|plus|with|at|on|in|for|to|from)\s.*$', '', 'i');

  v := regexp_replace(v, '[''’]s$', '', 'i');
  v := btrim(v, ' .,;:!?-–—''"“”()[]');

  if v = '' or coalesce(array_length(regexp_split_to_array(v, '\s+'), 1), 0) > 4 then
    return null;
  end if;
  if length(v) > 60 or v !~ '^[A-Z0-9]' then
    return null;
  end if;
  if private.is_junk_company(v) then
    return null;
  end if;

  return v;
end;
$$;

create or replace function private.strong_company_name(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_name ~ '\m(Inc|Inc\.|LLC|L\.L\.C\.|Ltd|Corp|Corp\.|Co\.|Labs|Biosciences|Bioscience|Therapeutics|Robotics|Ventures|Holdings|Technologies|Studios|Dynamics|Diagnostics|Pharmaceuticals)\M$'
$$;

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
  n_new  integer := 0;
  n_link integer := 0;
begin
  with src as (
    select ev.id as event_id, ev.title, ev.description, ev.start_time, ev.keywords
    from public.events ev
    where ev.status = 'active'
      and (p_since is null or ev.updated_at >= p_since)
    order by ev.start_time nulls last
    limit greatest(p_limit, 0)
  ),
  raw as (
    -- Title and description join on a NEWLINE, never '. ': the capture classes
    -- below stop at \n, so a '. ' join let a title's tail bleed into the next
    -- match ("Expo. TECHSPO Dallas-Fort Worth Technology").
    select s.event_id, s.title, s.start_time, s.keywords, x.rel, x.m[1] as raw_name
    from src s
    cross join lateral (
      select 'host'::text as rel,
             regexp_matches(coalesce(s.title,'') || E'\n' || coalesce(s.description,''),
               '(?:hosted|organized|organised|presented|produced)\s+by\s+([A-Z0-9][^.,;:!?\n|•·]{2,60})', 'gi') as m
      union all
      select 'sponsor',
             regexp_matches(coalesce(s.description,''),
               '(?:sponsored|powered|supported|underwritten)\s+by\s+([A-Z0-9][^.,;:!?\n|•·]{2,60})', 'gi')
      union all
      select 'sponsor',
             regexp_matches(coalesce(s.description,''),
               'in\s+partnership\s+with\s+([A-Z0-9][^.,;:!?\n|•·]{2,60})', 'gi')
      union all
      select 'mentioned',
             regexp_matches(coalesce(s.title,'') || E'\n' || coalesce(s.description,''),
               '([A-Z][A-Za-z0-9&''.-]*(?:\s+[A-Z][A-Za-z0-9&''.-]*){0,3}\s+(?:Inc|Inc\.|LLC|L\.L\.C\.|Ltd|Corp|Corp\.|Labs|Biosciences|Bioscience|Therapeutics|Robotics|Ventures|Holdings|Technologies|Studios|Dynamics|Diagnostics|Pharmaceuticals))\M', 'g')
    ) x
  ),
  cand as (
    select private.clean_company_name(raw_name) as name,
           public.norm_text(private.clean_company_name(raw_name)) as nname,
           event_id, title, start_time, keywords, rel
    from raw
    where private.clean_company_name(raw_name) is not null
  ),
  accepted as (
    select nname,
           (array_agg(name order by length(name) desc))[1] as name,
           count(distinct event_id)                        as event_count,
           bool_or(private.strong_company_name(name))      as strong
    from cand
    group by nname
    having bool_or(private.strong_company_name(name)) or count(distinct event_id) >= 2
  ),
  ins as (
    insert into public.companies (name, signal, signal_detail, signal_at,
                                  discovered_via, last_seen_event_id, last_seen_at,
                                  hq_location, tags)
    select a.name, 'event_active',
           case when a.strong then 'Named in a Dallas event listing'
                else 'Named across ' || a.event_count || ' Dallas event listings' end,
           coalesce(f.start_time, now()),
           array['events'], f.event_id, coalesce(f.start_time, now()),
           'Dallas–Fort Worth, TX', coalesce(f.keywords, '{}'::text[])
    from accepted a
    cross join lateral (
      select c.event_id, c.start_time, c.keywords
      from cand c where c.nname = a.nname
      order by c.start_time desc nulls last limit 1
    ) f
    where not exists (select 1 from public.companies c2 where c2.name_norm = a.nname)
    returning id, name_norm
  ),
  -- Rows inserted above are invisible to a plain read of public.companies in
  -- this same statement, so the id lookup unions both halves.
  resolved as (
    select a.nname, co.id
    from accepted a join public.companies co on co.name_norm = a.nname
    union
    select i.name_norm, i.id from ins i
  ),
  lnk as (
    insert into public.event_company_links (event_id, company_id, relationship)
    select distinct c.event_id, r.id, c.rel
    from cand c join resolved r on r.nname = c.nname
    on conflict do nothing
    returning 1
  )
  select (select count(*) from ins), (select count(*) from lnk)
    into n_new, n_link;

  return jsonb_build_object('new_companies', n_new, 'links', n_link);
end;
$$;

revoke execute on function public.extract_companies_from_events(timestamptz, integer) from public, anon, authenticated;
grant  execute on function public.extract_companies_from_events(timestamptz, integer)  to service_role;
