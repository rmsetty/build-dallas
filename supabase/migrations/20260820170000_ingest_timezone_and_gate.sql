-- ============================================================================
-- Build Dallas — timezone-aware ingest + keyword gate
--
-- Two things the parsers need that Postgres does far better than a Worker:
--
-- 1. TIMEZONES. Eventbrite ships "2026-09-02" + "18:00" + "America/Chicago" as
--    three separate fields, and schema.org dates are frequently naive. Turning
--    a wall-clock time in an IANA zone into a correct UTC instant needs a tz
--    database, which a Worker does not have without shipping a library. Postgres
--    has one built in, so the parsers pass the local string plus a zone name and
--    `AT TIME ZONE` does the conversion for free.
--
-- 2. A KEYWORD GATE. University calendars are 90% registration deadlines and
--    self-defense classes. require_keywords drops any event that matches zero
--    vocabulary terms, reusing the tagging pass we already run.
-- ============================================================================

drop function if exists public.ingest_events(uuid, jsonb);

create or replace function public.ingest_events(
  p_source_id        uuid,
  p_events           jsonb,
  p_require_keywords boolean default false,
  p_default_timezone text default 'America/Chicago'
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
  v_ext       text;
  v_tz        text;
  v_kw        text[];
  v_cancelled boolean;
  v_existing  uuid;
  v_dup       uuid;
  n_ins   integer := 0;
  n_upd   integer := 0;
  n_dup   integer := 0;
  n_skip  integer := 0;
  n_nokw  integer := 0;
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
    v_ext   := nullif(btrim(coalesce(r ->> 'external_id', '')), '');
    v_tz    := coalesce(nullif(btrim(coalesce(r ->> 'timezone', '')), ''), p_default_timezone);
    v_cancelled := lower(coalesce(r ->> 'cancelled', '')) in ('true', 't', '1');

    v_start := private.parse_event_ts(r ->> 'start_time', v_tz);
    v_end   := private.parse_event_ts(r ->> 'end_time',   v_tz);
    if v_start is not null and v_end is not null and v_end < v_start then
      v_end := null;
    end if;

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
        location         = coalesce(nullif(btrim(coalesce(r ->> 'location', '')), ''), e.location),
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
      p_source_id, v_title, v_desc, v_start, v_end,
      nullif(btrim(coalesce(r ->> 'location', '')), ''),
      v_venue,
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
                            'skipped', n_skip, 'no_keywords', n_nokw);
end;
$$;

-- Accepts an ISO string that may or may not carry an offset. With an offset (or
-- a trailing Z) it is already an instant; without one it is wall-clock time in
-- p_tz. Returns null rather than raising on anything unparseable.
create or replace function private.parse_event_ts(p_raw text, p_tz text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_clean text := nullif(btrim(coalesce(p_raw, '')), '');
begin
  if v_clean is null then
    return null;
  end if;

  begin
    if v_clean ~ '(Z|z|[+-][0-9]{2}:?[0-9]{2})$' then
      return v_clean::timestamptz;
    end if;
    return (v_clean::timestamp) at time zone coalesce(p_tz, 'America/Chicago');
  exception when others then
    return null;
  end;
end;
$$;

revoke execute on function public.ingest_events(uuid, jsonb, boolean, text) from public, anon, authenticated;
grant  execute on function public.ingest_events(uuid, jsonb, boolean, text) to service_role;
