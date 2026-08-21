-- ============================================================================
-- Build Dallas — keyword vocabulary + batch ingest RPC
--
-- Design note (Cloudflare free tier): the queue consumer gets 10ms of CPU and
-- 50 subrequests per invocation. Deduplicating and keyword-tagging N events
-- one REST call at a time would blow the subrequest ceiling on any busy source
-- (100 events = 100 calls). So the entire ingest of one source collapses into a
-- SINGLE PostgREST call to public.ingest_events(), which loops, fuzzy-dedupes,
-- tags keywords and updates the source row inside Postgres. The Worker's only
-- job is fetch -> normalize -> one POST.
-- ============================================================================

-- Two new platforms found while verifying the seed sources:
--   'localist' — UT Dallas + UNT run Localist, which exposes a free JSON API
--   'jsonld'   — Dallas Innovates and AllEvents.in embed schema.org Event
--                blocks, so they parse structurally and never need the LLM
alter table public.sources drop constraint sources_platform_check;
alter table public.sources add constraint sources_platform_check
  check (platform in ('luma', 'eventbrite', 'meetup', 'localist', 'jsonld', 'html'));


-- ----------------------------------------------------------------------------
-- Keyword vocabulary
--
-- A table rather than a hardcoded constant in Worker source: the same list has
-- to drive event tagging (Part 2) and resume tagging (Part 3), and a table can
-- be edited from SQL or the frontend without redeploying anything.
-- ----------------------------------------------------------------------------
create table public.keywords (
  term     text primary key,
  category text not null check (category in ('role', 'industry', 'tool', 'stage', 'event_type')),
  aliases  text[] not null default '{}'::text[],
  active   boolean not null default true
);

create index keywords_category_idx on public.keywords (category) where active;

alter table public.keywords enable row level security;
create policy "keywords readable by anyone" on public.keywords
  for select to anon, authenticated using (true);


-- Normalize for whole-token matching: lowercase, keep + # . (c++, c#, node.js),
-- everything else becomes a space, and pad both ends so '% term %' matches a
-- term sitting at the very start or end of the text.
create or replace function public.kw_normalize(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select ' ' || regexp_replace(lower(coalesce(p, '')), '[^a-z0-9+#.]+', ' ', 'g') || ' '
$$;

-- Returns the sorted set of vocabulary terms present in p_text. Whole-token
-- only, so "ai" does not match "chair" and "r" does not match "react".
create or replace function public.match_keywords(p_text text)
returns text[]
language sql
stable
set search_path = ''
as $$
  with n as (select public.kw_normalize(p_text) as t)
  select coalesce(array_agg(distinct k.term order by k.term), '{}'::text[])
  from public.keywords k, n
  where k.active
    and exists (
      select 1
      from unnest(array[k.term] || k.aliases) as pat
      where n.t like '%' || public.kw_normalize(pat) || '%'
    )
$$;


-- ----------------------------------------------------------------------------
-- Batch ingest
-- ----------------------------------------------------------------------------
create or replace function public.ingest_events(p_source_id uuid, p_events jsonb)
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
  v_cancelled boolean;
  v_existing  uuid;
  v_dup       uuid;
  n_ins  integer := 0;
  n_upd  integer := 0;
  n_dup  integer := 0;
  n_skip integer := 0;
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
    v_cancelled := lower(coalesce(r ->> 'cancelled', '')) in ('true', 't', '1');

    -- Scraped timestamps are the least trustworthy field on the payload; a bad
    -- one should cost us the date, not the event.
    begin v_start := (r ->> 'start_time')::timestamptz; exception when others then v_start := null; end;
    begin v_end   := (r ->> 'end_time')::timestamptz;   exception when others then v_end   := null; end;
    if v_start is not null and v_end is not null and v_end < v_start then
      v_end := null;
    end if;

    -- 1. Same source, same platform id -> refresh the row we already have.
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
        keywords         = public.match_keywords(v_title || ' ' || coalesce(v_desc, ''))
      where e.id = v_existing;
      n_upd := n_upd + 1;
      continue;
    end if;

    -- 2. Same event reached us through a different source (Luma AND Eventbrite
    --    AND the org's own site all list the same mixer).
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
      public.match_keywords(v_title || ' ' || coalesce(v_desc, ''))
    );
    n_ins := n_ins + 1;
  end loop;

  update public.sources s set
    last_run_at          = now(),
    last_success_at      = now(),
    consecutive_failures = 0,
    last_error           = null
  where s.id = p_source_id;

  return jsonb_build_object('inserted', n_ins, 'updated', n_upd,
                            'duplicates', n_dup, 'skipped', n_skip);
end;
$$;


-- Failure path for the consumer's catch block: record it against the source
-- instead of throwing, so one broken site never stalls the queue.
create or replace function public.mark_source_failed(p_source_id uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sources s set
    last_run_at          = now(),
    consecutive_failures = s.consecutive_failures + 1,
    last_error           = left(coalesce(p_error, 'unknown error'), 500),
    -- park a source that has failed every day for a week
    active               = case when s.consecutive_failures + 1 >= 7 then false else s.active end
  where s.id = p_source_id;
$$;

revoke execute on function public.ingest_events(uuid, jsonb)     from public, anon, authenticated;
revoke execute on function public.mark_source_failed(uuid, text)  from public, anon, authenticated;
grant  execute on function public.ingest_events(uuid, jsonb)      to service_role;
grant  execute on function public.mark_source_failed(uuid, text)   to service_role;


-- ----------------------------------------------------------------------------
-- Vocabulary seed (~190 terms). Edit freely: INSERT/UPDATE/DELETE here changes
-- both event tagging and resume matching with no redeploy.
-- ----------------------------------------------------------------------------
insert into public.keywords (term, category, aliases) values
-- roles
('software engineer','role','{"software developer","swe","software engineering"}'),
('backend engineer','role','{"back end engineer","backend developer"}'),
('frontend engineer','role','{"front end engineer","frontend developer"}'),
('full stack engineer','role','{"full stack developer","fullstack"}'),
('mobile engineer','role','{"ios engineer","android engineer","mobile developer"}'),
('ml engineer','role','{"machine learning engineer","mle"}'),
('data scientist','role','{"data science"}'),
('data engineer','role','{"data engineering"}'),
('data analyst','role','{"business analyst"}'),
('product manager','role','{"product management","pm","associate product manager"}'),
('product designer','role','{}'),
('ux designer','role','{"ux research","user experience"}'),
('ui designer','role','{"ui design"}'),
('designer','role','{"design"}'),
('quant','role','{"quantitative researcher","quantitative developer","quantitative analyst"}'),
('trader','role','{"trading"}'),
('investment banking','role','{"investment banker"}'),
('venture capital','role','{"vc","venture capitalist"}'),
('private equity','role','{"pe"}'),
('founder','role','{"co-founder","cofounder","founding team"}'),
('cto','role','{"chief technology officer"}'),
('ceo','role','{"chief executive officer"}'),
('cfo','role','{"chief financial officer"}'),
('coo','role','{"chief operating officer"}'),
('engineering manager','role','{"eng manager"}'),
('devops','role','{"dev ops","platform engineer"}'),
('site reliability engineer','role','{"sre"}'),
('security engineer','role','{"appsec","infosec"}'),
('qa engineer','role','{"quality assurance","test engineer"}'),
('solutions architect','role','{"solution architect"}'),
('sales engineer','role','{"technical sales"}'),
('growth marketer','role','{"growth marketing","demand generation"}'),
('community manager','role','{"community lead"}'),
('recruiter','role','{"talent acquisition","recruiting"}'),
('chief of staff','role','{}'),
('consultant','role','{"consulting"}'),
('research scientist','role','{"research engineer"}'),
('intern','role','{"internship"}'),
('new grad','role','{"entry level","university grad"}'),
-- industries
('fintech','industry','{"financial technology"}'),
('biotech','industry','{"biotechnology"}'),
('healthtech','industry','{"health tech","digital health"}'),
('medtech','industry','{"medical device"}'),
('edtech','industry','{"education technology"}'),
('proptech','industry','{"real estate technology"}'),
('insurtech','industry','{}'),
('legaltech','industry','{"legal tech"}'),
('agtech','industry','{"agriculture technology"}'),
('climate tech','industry','{"climatetech","cleantech","clean energy"}'),
('energy','industry','{"oil and gas","renewables"}'),
('aerospace','industry','{"space","satellite"}'),
('defense','industry','{"defense tech","govtech"}'),
('robotics','industry','{"robot"}'),
('hardware','industry','{"deep tech","deeptech"}'),
('semiconductors','industry','{"chips","semiconductor"}'),
('saas','industry','{"b2b saas","software as a service"}'),
('marketplace','industry','{}'),
('ecommerce','industry','{"e-commerce","retail tech"}'),
('logistics','industry','{"supply chain","freight"}'),
('cybersecurity','industry','{"cyber security","security"}'),
('blockchain','industry','{"web3","crypto","defi"}'),
('gaming','industry','{"game dev","esports"}'),
('media','industry','{"adtech","creator economy"}'),
('hr tech','industry','{"hrtech","future of work"}'),
('manufacturing','industry','{"industrial"}'),
('life sciences','industry','{"pharma","pharmaceutical"}'),
('telehealth','industry','{"telemedicine"}'),
('ai','industry','{"artificial intelligence","a.i."}'),
('machine learning','industry','{"ml"}'),
('deep learning','industry','{"neural network","neural networks"}'),
('computer vision','industry','{"cv","image recognition"}'),
('nlp','industry','{"natural language processing"}'),
('generative ai','industry','{"genai","gen ai"}'),
('llm','industry','{"large language model","large language models"}'),
('ai agents','industry','{"agentic","autonomous agents"}'),
('mlops','industry','{"ml ops"}'),
('data infrastructure','industry','{"data platform","data pipeline"}'),
('analytics','industry','{"business intelligence","bi"}'),
('cloud','industry','{"cloud computing"}'),
('devtools','industry','{"developer tools","dx"}'),
('api','industry','{"apis"}'),
('open source','industry','{"oss"}'),
('quantum computing','industry','{"quantum"}'),
('ar/vr','industry','{"augmented reality","virtual reality","xr","spatial computing"}'),
('iot','industry','{"internet of things","embedded"}'),
('mobility','industry','{"autonomous vehicles","self driving","ev"}'),
-- tools & languages
('python','tool','{}'),
('javascript','tool','{"js"}'),
('typescript','tool','{"ts"}'),
('react','tool','{"react.js","reactjs"}'),
('next.js','tool','{"nextjs"}'),
('node.js','tool','{"nodejs","node"}'),
('java','tool','{}'),
('c++','tool','{"cpp"}'),
('c#','tool','{"csharp",".net","dotnet"}'),
('go','tool','{"golang"}'),
('rust','tool','{}'),
('ruby','tool','{"rails","ruby on rails"}'),
('swift','tool','{}'),
('kotlin','tool','{}'),
('php','tool','{}'),
('scala','tool','{}'),
('sql','tool','{}'),
('postgres','tool','{"postgresql"}'),
('mysql','tool','{}'),
('mongodb','tool','{"mongo"}'),
('redis','tool','{}'),
('kafka','tool','{}'),
('spark','tool','{"apache spark","pyspark"}'),
('snowflake','tool','{}'),
('databricks','tool','{}'),
('airflow','tool','{}'),
('dbt','tool','{}'),
('tableau','tool','{}'),
('power bi','tool','{"powerbi"}'),
('pytorch','tool','{"torch"}'),
('tensorflow','tool','{"tf"}'),
('scikit-learn','tool','{"sklearn"}'),
('pandas','tool','{}'),
('numpy','tool','{}'),
('hugging face','tool','{"huggingface"}'),
('langchain','tool','{}'),
('openai','tool','{"gpt","chatgpt"}'),
('anthropic','tool','{"claude"}'),
('aws','tool','{"amazon web services","ec2","s3","lambda"}'),
('azure','tool','{}'),
('gcp','tool','{"google cloud"}'),
('kubernetes','tool','{"k8s"}'),
('docker','tool','{"containers"}'),
('terraform','tool','{"infrastructure as code"}'),
('git','tool','{"github","gitlab"}'),
('figma','tool','{}'),
('solidity','tool','{"smart contracts","smart contract"}'),
('ethereum','tool','{}'),
('unity','tool','{}'),
('matlab','tool','{}'),
('excel','tool','{"spreadsheets"}'),
('salesforce','tool','{}'),
('hubspot','tool','{}'),
('stripe','tool','{}'),
('supabase','tool','{}'),
('cloudflare','tool','{"workers"}'),
-- stages
('pre-seed','stage','{"preseed","pre seed"}'),
('seed','stage','{"seed round","seed stage"}'),
('series a','stage','{"series-a"}'),
('series b','stage','{"series-b"}'),
('series c','stage','{"series-c"}'),
('growth stage','stage','{"late stage"}'),
('bootstrapped','stage','{"bootstrapping"}'),
('angel investor','stage','{"angel","angels","angel investing"}'),
('accelerator','stage','{"incubator","y combinator","techstars"}'),
('venture backed','stage','{"vc backed"}'),
('ipo','stage','{"public offering"}'),
('acquisition','stage','{"acquired","m&a","exit"}'),
('fundraising','stage','{"raising","raise","capital raise"}'),
('term sheet','stage','{}'),
('cap table','stage','{"captable","equity"}'),
('valuation','stage','{}'),
('runway','stage','{"burn rate"}'),
('mvp','stage','{"minimum viable product","prototype"}'),
('product market fit','stage','{"pmf"}'),
('go to market','stage','{"gtm"}'),
-- event types
('pitch night','event_type','{"pitch event","pitch competition","pitch contest","shark tank"}'),
('demo day','event_type','{"demoday"}'),
('hackathon','event_type','{"hack day","hackfest","codeathon"}'),
('office hours','event_type','{"1:1 office hours"}'),
('mixer','event_type','{"social mixer","networking mixer"}'),
('networking','event_type','{"speed networking","network"}'),
('workshop','event_type','{"hands on workshop","training"}'),
('panel','event_type','{"panel discussion","fireside chat"}'),
('conference','event_type','{"summit","symposium","expo"}'),
('meetup','event_type','{"meet up"}'),
('career fair','event_type','{"job fair","hiring event","hiring"}'),
('info session','event_type','{"information session","open house"}'),
('bootcamp','event_type','{"boot camp"}'),
('roundtable','event_type','{"round table"}'),
('happy hour','event_type','{"drinks","social hour"}'),
('lunch and learn','event_type','{"lunch & learn","breakfast"}'),
('webinar','event_type','{"virtual event","online event"}'),
('ama','event_type','{"ask me anything","q&a"}'),
('showcase','event_type','{"expo hall","startup showcase"}'),
('competition','event_type','{"challenge","contest"}'),
('startup week','event_type','{"innovation week","tech week"}'),
('coworking','event_type','{"co-working","cowork"}'),
('mentorship','event_type','{"mentoring","mentor"}'),
('launch party','event_type','{"launch event"}'),
('investor day','event_type','{"lp day","investor summit"}');
