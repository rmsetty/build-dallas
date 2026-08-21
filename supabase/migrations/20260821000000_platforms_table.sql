-- ============================================================================
-- Build Dallas — platforms as data, not a constraint
--
-- sources.platform was a CHECK constraint, which meant every new source type
-- required a migration that dropped and recreated the constraint. Adding a
-- platform should be an INSERT.
--
-- The registry in workers/shared/parsers/index.ts is the code half of this;
-- this table is the data half. A platform with no registered parser is caught
-- at runtime with a clear message rather than a constraint violation at insert.
-- ============================================================================

create table public.platforms (
  platform     text primary key,
  label        text not null,
  requires_llm boolean not null default false,
  notes        text,
  created_at   timestamptz not null default now()
);

alter table public.platforms enable row level security;
create policy "platforms readable by anyone" on public.platforms
  for select to anon, authenticated using (true);

insert into public.platforms (platform, label, requires_llm, notes) values
  ('luma',       'Luma',                 false, 'api.lu.ma discover + calendar endpoints, unauthenticated'),
  ('eventbrite', 'Eventbrite',           false, '__SERVER_DATA__ blob on the search page'),
  ('meetup',     'Meetup',               false, '__NEXT_DATA__ Apollo cache on the group page'),
  ('localist',   'Localist',             false, '/api/2/events JSON API'),
  ('tribe',      'The Events Calendar',  false, '/wp-json/tribe/events/v1/events REST API'),
  ('ical',       'iCalendar feed',       false, 'RFC 5545 .ics feed'),
  ('jsonld',     'schema.org JSON-LD',   false, 'embedded ld+json Event blocks'),
  ('html',       'HTML via LLM',         true,  'strip tags, extract with Groq — needs GROQ_API_KEY');

alter table public.sources drop constraint sources_platform_check;
alter table public.sources
  add constraint sources_platform_fkey
  foreign key (platform) references public.platforms(platform);

create index sources_platform_idx on public.sources (platform);
