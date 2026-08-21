-- ============================================================================
-- Build Dallas — ingest quality filters
--
-- Three problems showed up running the parsers against the live sources:
--
--   1. STALE EVENTS. dallasinnovates.com/calendar/ publishes schema.org Events
--      going back months (a January museum exhibit came back first). An
--      upcoming-events product should not import them.
--
--   2. OUT-OF-REGION EVENTS. The "Startup Valley" Luma calendar is global, not
--      Dallas — the first entry returned was a pitch night in Sydney. A
--      calendar-scoped source needs a geographic gate that a place-scoped one
--      does not.
--
--   3. OFF-TOPIC EVENTS. Broad aggregators and university calendars carry
--      soccer exhibits and registration deadlines alongside the startup events.
--      require_keywords already existed; this extends it to those sources.
--
-- All three are per-source policy, so they become ingest_events parameters
-- driven by scrape_strategy rather than logic baked into a Worker.
-- ============================================================================

drop function if exists public.ingest_events(uuid, jsonb, boolean, text);

create or replace function public.ingest_events(
  p_source_id        uuid,
  p_events           jsonb,
  p_require_keywords boolean default false,
  p_default_timezone text default 'America/Chicago',
  p_max_past_days    integer default 1,
  p_location_filter  text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r           jsonb;
  v_title     text;
  v_desc      text;
  v_start     timestamptz;
  v_end       timestamptz;
  v_venue     text;
  v_loc       text;
  v_ext       text;
  v_tz        text;
  v_kw        text[];
  v_place     text;
  v_cancelled boolean;
  v_existing  uuid;
  v_dup       uuid;
  n_ins   integer := 0;
  n_upd   integer := 0;
  n_dup   integer := 0;
  n_skip  integer := 0;
  n_nokw  integer := 0;
  n_past  integer := 0;
  n_geo   integer := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb))
  loop
    v_title := nullif(btrim(coalesce(r ->> 'title', '')), '');
    if v_title is null then
      n_skip := n_skip + 1;
      continue;
    end if;

    v_desc  := nullif(btrim(coalesce(r ->> 'description', '')), '');
    v_venue := nullif(btrim(coalesce(r ->> 'venue', '')), '');
    v_loc   := nullif(btrim(coalesce(r ->> 'location', '')), '');
    v_ext   := nullif(btrim(coalesce(r ->> 'external_id', '')), '');
    v_tz    := coalesce(nullif(btrim(coalesce(r ->> 'timezone', '')), ''), p_default_timezone);
    v_cancelled := lower(coalesce(r ->> 'cancelled', '')) in ('true', 't', '1');

    v_start := private.parse_event_ts(r ->> 'start_time', v_tz);
    v_end   := private.parse_event_ts(r ->> 'end_time',   v_tz);
    if v_start is not null and v_end is not null and v_end < v_start then
      v_end := null;
    end if;

    -- 1. Stale. Undated events are kept: plenty of real listings omit a date,
    --    and dropping them would lose more than it saves.
    if v_start is not null and v_start < now() - make_interval(days => greatest(p_max_past_days, 0)) then
      n_past := n_past + 1;
      continue;
    end if;

    -- 2. Out of region. Only applied when a source actually declares a filter.
    --    An event with no place at all cannot clear a geographic gate.
    if p_location_filter is not null and cardinality(p_location_filter) > 0 then
      v_place := public.kw_normalize(coalesce(v_loc, '') || ' ' || coalesce(v_venue, ''));
      if not exists (
        select 1 from unnest(p_location_filter) as term
        where v_place like '%' || public.kw_normalize(term) || '%'
      ) then
        n_geo := n_geo + 1;
        continue;
      end if;
    end if;

    -- 3. Off topic.
    v_kw := public.match_keywords(v_title || ' ' || coalesce(v_desc, ''));
    if p_require_keywords and cardinality(v_kw) = 0 then
      n_nokw := n_nokw + 1;
      continue;
    end if;

    v_existing := null;
    if v_ext is not null then
      select e.id into v_existing
      from public.events e
      where e.source_id = p_source_id and e.external_id = v_ext;
    end if;

    if v_existing is not null then
      update public.events e set
        title            = v_title,
        description      = coalesce(v_desc, e.description),
        start_time       = coalesce(v_start, e.start_time),
        end_time         = coalesce(v_end, e.end_time),
        location         = coalesce(v_loc, e.location),
        venue            = coalesce(v_venue, e.venue),
        url              = coalesce(nullif(btrim(coalesce(r ->> 'url', '')), ''), e.url),
        raw_content_hash = coalesce(nullif(r ->> 'raw_content_hash', ''), e.raw_content_hash),
        status           = case when v_cancelled then 'cancelled' else e.status end,
        keywords         = v_kw
      where e.id = v_existing;
      n_upd := n_upd + 1;
      continue;
    end if;

    v_dup := public.find_duplicate_event(v_title, v_start, v_venue);
    if v_dup is not null then
      n_dup := n_dup + 1;
      continue;
    end if;

    insert into public.events (
      source_id, title, description, start_time, end_time,
      location, venue, url, external_id, raw_content_hash, status, keywords
    ) values (
      p_source_id, v_title, v_desc, v_start, v_end, v_loc, v_venue,
      nullif(btrim(coalesce(r ->> 'url', '')), ''),
      v_ext,
      nullif(r ->> 'raw_content_hash', ''),
      case when v_cancelled then 'cancelled' else 'active' end,
      v_kw
    );
    n_ins := n_ins + 1;
  end loop;

  update public.sources s set
    last_run_at          = now(),
    last_success_at      = now(),
    consecutive_failures = 0,
    last_error           = null
  where s.id = p_source_id;

  return jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'duplicates', n_dup,
                            'skipped', n_skip, 'no_keywords', n_nokw,
                            'past', n_past, 'out_of_region', n_geo);
end;
$$;

revoke execute on function public.ingest_events(uuid, jsonb, boolean, text, integer, text[])
  from public, anon, authenticated;
grant execute on function public.ingest_events(uuid, jsonb, boolean, text, integer, text[])
  to service_role;


-- ----------------------------------------------------------------------------
-- Apply the new policy to the sources that need it
-- ----------------------------------------------------------------------------

-- Startup Valley is a worldwide calendar; keep only the DFW metro.
update public.sources
set scrape_strategy = scrape_strategy || jsonb_build_object(
      'location_filter', jsonb_build_array(
        'texas', 'tx', 'dallas', 'fort worth', 'plano', 'richardson', 'irving',
        'frisco', 'addison', 'arlington', 'denton', 'grapevine', 'carrollton',
        'allen', 'mckinney', 'garland', 'lewisville', 'southlake', 'coppell',
        'las colinas', 'farmers branch', 'university park', 'highland park')),
    notes = coalesce(notes, '') || ' Global calendar — location_filter restricts it to DFW.'
where url = 'https://lu.ma/StartupValley';

-- Broad aggregators: require at least one vocabulary hit.
update public.sources
set scrape_strategy = scrape_strategy || '{"require_keywords": true}'::jsonb
where url in ('https://dallasinnovates.com/calendar/', 'https://allevents.in/dallas/startup');
