-- ============================================================================
-- Build Dallas — company discovery
--
-- The event pipeline answers "what is happening". This answers "who is being
-- built". Same shape as Part 2 on purpose: a source registry, one batch RPC
-- that does all the matching/dedupe/tagging inside Postgres, and Workers that
-- only fetch -> normalize -> POST once.
--
-- The bias throughout is toward companies that are being built RIGHT NOW, not
-- companies that already had their exit written up. That is what `signal` and
-- `signal_at` encode: the freshest piece of evidence that this company is
-- currently active, and when we saw it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Region test. IMMUTABLE so it can back a generated column.
-- ----------------------------------------------------------------------------
create or replace function public.is_dfw(p_location text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_location is null then false
    else lower(p_location) ~ ('(^|[^a-z])(' || array_to_string(array[
      'dallas','fort worth','ft worth','plano','frisco','irving','richardson',
      'addison','mckinney','allen','denton','garland','grapevine','southlake',
      'carrollton','lewisville','arlington','mesquite','rockwall','coppell',
      'flower mound','euless','bedford','farmers branch','university park',
      'highland park','the colony','little elm','prosper','celina','wylie',
      'dfw','north texas','metroplex'
    ], '|') || ')([^a-z]|$)')
  end
$$;

grant execute on function public.is_dfw(text) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- companies: enrichment for a directory rather than a stub table
-- ----------------------------------------------------------------------------
alter table public.companies
  add column one_liner      text,
  add column hq_location    text,
  add column logo_url       text,
  -- What makes us believe this company is live, and when we saw that evidence.
  add column signal         text check (signal in (
                              'raising', 'accelerator', 'portfolio', 'yc',
                              'event_active', 'research', 'hiring', 'directory')),
  add column signal_detail  text,
  add column signal_at      timestamptz,
  -- Every directory that has reported this company. Accumulates on re-ingest:
  -- a company confirmed by three independent sources is a stronger record than
  -- one seen once, and the UI ranks on that.
  add column discovered_via text[] not null default '{}'::text[],
  add column first_seen_at  timestamptz not null default now(),
  add column dfw            boolean generated always as (public.is_dfw(hq_location)) stored;

create index companies_signal_idx        on public.companies (signal);
create index companies_signal_at_idx     on public.companies (signal_at desc nulls last);
create index companies_dfw_idx           on public.companies (dfw) where dfw;
create index companies_discovered_via_idx on public.companies using gin (discovered_via);


-- ----------------------------------------------------------------------------
-- company_sources — the directories we harvest, same contract as public.sources
-- ----------------------------------------------------------------------------
create table public.company_sources (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text not null unique,
  name                 text not null,
  url                  text not null,
  platform             text not null references public.platforms(platform),
  -- Per-source recipe, e.g. {"region_filter": ["TX"], "signal": "raising"}
  scrape_strategy      jsonb not null default '{}'::jsonb,
  last_run_at          timestamptz,
  last_success_at      timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_error           text,
  active               boolean not null default true,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index company_sources_active_idx on public.company_sources (last_run_at nulls first) where active;

create trigger company_sources_set_updated_at
  before update on public.company_sources
  for each row execute function private.set_updated_at();

-- Operational config, same as public.sources: RLS on, no policies, so only
-- service_role reads it. The frontend gets provenance from discovered_via.
alter table public.company_sources enable row level security;


-- ----------------------------------------------------------------------------
-- Batch ingest — one PostgREST call per source.
--
-- Merge semantics matter more here than for events, because the same company
-- legitimately arrives from several directories. Rule: never let a later source
-- blank out a field an earlier one filled, always union tags and discovered_via,
-- and only move `signal` forward in time.
-- ----------------------------------------------------------------------------
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

    -- norm_text strips everything but alphanumerics, so a name that normalizes
    -- to fewer than 2 characters was punctuation or a stray logo filename.
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

    -- Stage is CHECK-constrained; an unrecognized value must not cost us the row.
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

    -- Same vocabulary that tags events, so a profile's keywords match companies
    -- and events through one shared term list.
    v_tags := public.match_keywords(
      coalesce(v_name, '') || ' ' || coalesce(v_one, '') || ' ' || coalesce(v_desc, ''));

    select c.id into v_existing from public.companies c where c.name_norm = v_norm;

    if v_existing is not null then
      update public.companies c set
        one_liner      = coalesce(c.one_liner, v_one),
        description    = coalesce(c.description, v_desc),
        website        = coalesce(c.website, v_site),
        hq_location    = coalesce(c.hq_location, v_loc),
        logo_url       = coalesce(c.logo_url, nullif(btrim(coalesce(r ->> 'logo_url', '')), '')),
        stage          = coalesce(c.stage, v_stage),
        tags           = (select array_agg(distinct t order by t)
                          from unnest(c.tags || v_tags) as t where t is not null),
        discovered_via = (select array_agg(distinct s order by s)
                          from unnest(c.discovered_via || array[p_slug]) as s),
        -- Freshest evidence wins, but a stale re-crawl never rewinds the clock.
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


create or replace function public.mark_company_source_failed(p_source_id uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.company_sources s set
    last_run_at          = now(),
    consecutive_failures = s.consecutive_failures + 1,
    last_error           = left(coalesce(p_error, 'unknown error'), 500),
    active               = case when s.consecutive_failures + 1 >= 7 then false else s.active end
  where s.id = p_source_id;
$$;

revoke execute on function public.ingest_companies(uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.mark_company_source_failed(uuid, text)        from public, anon, authenticated;
grant  execute on function public.ingest_companies(uuid, text, jsonb, boolean)  to service_role;
grant  execute on function public.mark_company_source_failed(uuid, text)         to service_role;
