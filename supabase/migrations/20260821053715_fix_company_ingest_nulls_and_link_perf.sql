-- ============================================================================
-- Build Dallas — two bugs found on the first live company run
--
-- 1. array_agg over zero rows returns NULL, not '{}'. A company whose text
--    matched no vocabulary term was written with tags = NULL, which the NOT NULL
--    constraint rejected — and because it happened mid-batch it took the whole
--    source down with it. Every aggregate that can see an empty set is now
--    coalesced.
--
-- 2. link_events_to_companies recomputed kw_normalize() on every candidate
--    PAIR. At ~1000 companies x 362 events that is 360k normalizations of full
--    event text per run, and it hit the statement timeout the moment the
--    directory imports landed. Each side is normalized once in a materialized
--    CTE and matched with strpos, a plain substring scan.
-- ============================================================================

create or replace function public.ingest_companies(
  p_source_id  uuid,
  p_slug       text,
  p_companies  jsonb,
  p_dfw_only   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          jsonb;
  v_name     text;
  v_norm     text;
  v_loc      text;
  v_one      text;
  v_desc     text;
  v_site     text;
  v_stage    text;
  v_signal   text;
  v_sig_at   timestamptz;
  v_tags     text[];
  v_existing uuid;
  n_ins  integer := 0;
  n_upd  integer := 0;
  n_skip integer := 0;
  n_off  integer := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_companies, '[]'::jsonb))
  loop
    v_name := nullif(btrim(coalesce(r ->> 'name', '')), '');
    v_norm := public.norm_text(v_name);

    if v_name is null or length(v_norm) < 2 then
      n_skip := n_skip + 1;
      continue;
    end if;

    v_loc := nullif(btrim(coalesce(r ->> 'hq_location', '')), '');

    if p_dfw_only and not public.is_dfw(v_loc) then
      n_off := n_off + 1;
      continue;
    end if;

    v_one  := nullif(btrim(coalesce(r ->> 'one_liner', '')), '');
    v_desc := nullif(btrim(coalesce(r ->> 'description', '')), '');
    v_site := nullif(btrim(coalesce(r ->> 'website', '')), '');

    v_stage := lower(nullif(btrim(coalesce(r ->> 'stage', '')), ''));
    if v_stage is not null and v_stage not in ('idea','pre-seed','seed','series-a','series-b',
                                               'series-c-plus','growth','bootstrapped',
                                               'acquired','public','unknown') then
      v_stage := null;
    end if;

    v_signal := lower(nullif(btrim(coalesce(r ->> 'signal', '')), ''));
    if v_signal is not null and v_signal not in ('raising','accelerator','portfolio','yc',
                                                 'event_active','research','hiring','directory') then
      v_signal := 'directory';
    end if;

    begin v_sig_at := (r ->> 'signal_at')::timestamptz; exception when others then v_sig_at := null; end;
    v_sig_at := coalesce(v_sig_at, now());

    v_tags := coalesce(public.match_keywords(
      coalesce(v_name, '') || ' ' || coalesce(v_one, '') || ' ' || coalesce(v_desc, '')
    ), '{}'::text[]);

    select c.id into v_existing from public.companies c where c.name_norm = v_norm;

    if v_existing is not null then
      update public.companies c set
        one_liner      = coalesce(c.one_liner, v_one),
        description    = coalesce(c.description, v_desc),
        website        = coalesce(c.website, v_site),
        hq_location    = coalesce(c.hq_location, v_loc),
        logo_url       = coalesce(c.logo_url, nullif(btrim(coalesce(r ->> 'logo_url', '')), '')),
        stage          = coalesce(c.stage, v_stage),
        tags           = coalesce((select array_agg(distinct t order by t)
                                   from unnest(c.tags || v_tags) as t where t is not null),
                                  '{}'::text[]),
        discovered_via = coalesce((select array_agg(distinct s order by s)
                                   from unnest(c.discovered_via || array[p_slug]) as s
                                   where s is not null),
                                  array[p_slug]),
        signal         = case when c.signal_at is null or v_sig_at > c.signal_at
                              then coalesce(v_signal, c.signal) else c.signal end,
        signal_detail  = case when c.signal_at is null or v_sig_at > c.signal_at
                              then coalesce(nullif(btrim(coalesce(r ->> 'signal_detail','')),''), c.signal_detail)
                              else c.signal_detail end,
        signal_at      = greatest(coalesce(c.signal_at, v_sig_at), v_sig_at),
        last_seen_at   = greatest(coalesce(c.last_seen_at, v_sig_at), v_sig_at)
      where c.id = v_existing;
      n_upd := n_upd + 1;
    else
      insert into public.companies (
        name, description, one_liner, website, hq_location, logo_url, stage,
        tags, signal, signal_detail, signal_at, discovered_via, last_seen_at
      ) values (
        v_name, v_desc, v_one, v_site, v_loc,
        nullif(btrim(coalesce(r ->> 'logo_url', '')), ''),
        v_stage, v_tags, coalesce(v_signal, 'directory'),
        nullif(btrim(coalesce(r ->> 'signal_detail', '')), ''),
        v_sig_at, array[p_slug], v_sig_at
      );
      n_ins := n_ins + 1;
    end if;
  end loop;

  update public.company_sources s set
    last_run_at          = now(),
    last_success_at      = now(),
    consecutive_failures = 0,
    last_error           = null
  where s.id = p_source_id;

  return jsonb_build_object('inserted', n_ins, 'updated', n_upd,
                            'skipped', n_skip, 'out_of_region', n_off);
end;
$$;

create or replace function public.link_events_to_companies(p_limit integer default 20000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_link  integer := 0;
  n_fresh integer := 0;
begin
  with ev as materialized (
    select e.id, e.start_time,
           public.kw_normalize(coalesce(e.title,'') || ' ' || left(coalesce(e.description,''), 4000)) as txt
    from public.events e
    where e.status = 'active'
  ),
  co as materialized (
    -- Names shorter than 5 normalized characters are excluded: "Allen", "Loop"
    -- and "Go" would each match half the corpus.
    select c.id, public.kw_normalize(c.name) as pat
    from public.companies c
    where length(c.name_norm) >= 5
  ),
  hits as (
    select ev.id as event_id, co.id as company_id, ev.start_time
    from ev join co on strpos(ev.txt, co.pat) > 0
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
      signal    = case when c.signal_at is null or f.seen_at > c.signal_at
                       then 'event_active' else c.signal end,
      signal_at = greatest(coalesce(c.signal_at, f.seen_at), f.seen_at)
    from freshest f
    where c.id = f.company_id
    returning 1
  )
  select (select count(*) from linked), (select count(*) from bumped)
    into n_link, n_fresh;

  return jsonb_build_object('links', n_link, 'refreshed', n_fresh);
end;
$$;

revoke execute on function public.link_events_to_companies(integer) from public, anon, authenticated;
grant  execute on function public.link_events_to_companies(integer)  to service_role;
