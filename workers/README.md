# Build Dallas — event discovery pipeline

Two Cloudflare Workers on the free plan. `event-cron` fans active sources onto a
queue once a day; `event-consumer` fetches and ingests one source per message.

```
Cron (12:00 UTC)  ->  event-cron  ->  Queue  ->  event-consumer  ->  Supabase
                      (read sources)              (fetch + parse)     (ingest_events)
```

## Why the work lives in Postgres

The free plan gives each invocation **10ms of CPU** and **50 subrequests**. Time
spent waiting on `fetch()` is free; parsing and looping in JS is not. So:

- **One `ingest_events()` call per source.** Dedupe, keyword tagging, timezone
  resolution, quality filters and source bookkeeping all run inside Postgres. A
  per-event REST round trip would exceed 50 subrequests on any busy source.
- **Big pages are sliced, not parsed.** Eventbrite's search page is ~780KB; the
  parser uses `indexOf` to cut out the ~85KB results array and parses only that.
- **No regex over megabytes.** `htmlToText` hard-caps input at 150KB first.
  Measured at 2.5ms on the largest seed page (dfw.community, 1.4MB).

## Per-platform strategy

| platform | source of truth | cost |
|---|---|---|
| `luma` | `api.lu.ma` discover + calendar endpoints, unauthenticated | free |
| `eventbrite` | `__SERVER_DATA__` blob on the search page | free |
| `meetup` | `__NEXT_DATA__` Apollo cache on the group page | free |
| `localist` | `/api/2/events` JSON API (UT Dallas, UNT) | free |
| `jsonld` | embedded schema.org `Event` blocks | free |
| `html` | strip tags, extract via Groq | 1 Groq call/source/day |

Only 12 of 30 sources take the LLM path, and only once a day each.

Three of these differ from the original plan, because the documented approach is
not actually available on free terms:

- **Meetup's GraphQL API** now requires OAuth behind a paid Meetup Pro plan.
- **Eventbrite's** public event-search API was withdrawn in Dec 2019, and the
  internal `destination/search` endpoint rejects unauthenticated calls.
- **Luma's** official `public-api.luma.com` needs a Luma Plus subscription
  ($59/mo). The endpoints used here are the unauthenticated ones its own web
  client calls.

## Free-tier budget

| limit | usage |
|---|---|
| Queue ops: 10,000/day | ~60/day (30 writes + 30 reads) |
| Worker requests: 100,000/day | ~35/day |
| Worker CPU: 10ms/invocation | worst measured path ~3ms |
| Subrequests: 50/invocation | ~15 (batch of 5 sources) |

## Run it locally (no Cloudflare)

`local/pipeline.ts` runs the same parsers and the same `ingest_events()` call the
deployed Worker uses. Only the queue is replaced, by a concurrency pool — so a
green local run means the Worker behaves the same once deployed.

```bash
cd workers && npm install

npm run sources                  # what's registered and which parser handles it
npm run pipeline -- --dry-run    # fetch + parse everything. No database, no keys.
npm run pipeline                 # same, but writes to Supabase
```

Useful filters — each one isolates a single source so a failure can't cascade:

```bash
npm run pipeline -- --dry-run --platform tribe,meetup
npm run pipeline -- --dry-run --source "dec" --verbose
npm run pipeline -- --dry-run --all --limit 5     # --all includes inactive sources
```

To write to a database, put credentials in `workers/.dev.vars` (gitignored, and
the same file `wrangler dev` reads):

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
```

For a fully local database instead, `supabase start` and use the local API URL
and secret key it prints.

## Adding sources and parsers

Everything is registry-driven, so neither operation touches pipeline code.

**A new source** — add one entry to `workers/sources.json`, then:

```bash
npm run sources:sql    # generates an idempotent upsert migration
```

`sources.json` is the catalog of record. The generated migration only inserts
and updates; a source dropped from the catalog is set `active = false` rather
than deleted, so its events keep their `source_id`.

**A new source type** — three steps, none of which change the consumer:

1. write `shared/parsers/<name>.ts` exporting `(msg, ctx) => Promise<RawEvent[]>`
2. add one `registerParser({...})` block in `shared/parsers/index.ts`
3. `insert into public.platforms (platform, label) values (...)`

**Turning the LLM back on** — the `html` parser is already registered and
declares `requiresEnv: ['GROQ_API_KEY']`. Until that key exists it reports as
unavailable and its sources are skipped with a reason rather than failing. Set
the key and flip those sources to `active: true`.

## Deploy

```bash
cd workers
npm install

# 1. Create the queue (free plan, no card required)
npx wrangler queues create build-dallas-event-sources

# 2. Secrets — never in wrangler.toml
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config event-cron/wrangler.toml
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config event-consumer/wrangler.toml
npx wrangler secret put GROQ_API_KEY               --config event-consumer/wrangler.toml

# optional: enables the manual-trigger endpoint on event-cron
npx wrangler secret put TRIGGER_SECRET --config event-cron/wrangler.toml

# 3. Deploy
npm run deploy:consumer   # consumer first, so the queue has a reader
npm run deploy:cron
```

The service role key is at **Supabase → Project Settings → API → service_role**.
It bypasses RLS, so it belongs only in Worker secrets — never in the frontend.

Get a free Groq key at <https://console.groq.com>.

### Trigger a run without waiting for the cron

```bash
curl -H "x-trigger-secret: $TRIGGER_SECRET" https://build-dallas-event-cron.<subdomain>.workers.dev
npx wrangler tail --config event-consumer/wrangler.toml   # watch it work
```

## Tests

```bash
npm run typecheck
npm run test:parsers   # hits the real sites — no fixtures
```

`test:parsers` deliberately has no recorded fixtures: the failure mode that
matters is a site changing shape, which a fixture would hide. It also asserts
`htmlToText` stays inside the CPU budget on the largest page in the seed set.

## Adding a source

Insert a row in `sources`. `platform` picks the parser, `scrape_strategy` (jsonb)
configures it:

```sql
insert into public.sources (name, url, source_type, platform, scrape_strategy)
values ('Some Org — events', 'https://example.org/events/', 'html', 'html',
        '{"max_html_bytes": 150000}');
```

Quality gates available on any source:

| key | effect |
|---|---|
| `require_keywords` | drop events matching zero vocabulary terms |
| `location_filter` | array of place terms an event's venue/location must match |
| `max_past_days` | how stale an event may be (default 1) |
| `default_timezone` | zone for naive timestamps (default `America/Chicago`) |

## Operating it

Every failure is recorded rather than thrown. After 3 delivery attempts the
consumer writes the error to `sources.last_error`, increments
`consecutive_failures`, and acks. A source failing 7 days straight is set
`active = false` automatically.

```sql
select name, consecutive_failures, last_success_at, left(last_error, 90)
from public.sources
where consecutive_failures > 0 or not active
order by consecutive_failures desc;
```
