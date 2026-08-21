/**
 * Runs the whole discovery pipeline on this machine — no Cloudflare, no queue.
 *
 * It uses the exact same parsers and the exact same ingest_events() call the
 * deployed Worker uses; the only thing replaced is the queue, which becomes a
 * small concurrency pool. So a green run here means the Worker will behave the
 * same once deployed.
 *
 *   npm run pipeline -- --dry-run              fetch + parse only, no database, no keys
 *   npm run pipeline                            fetch + parse + write to Supabase
 *   npm run pipeline -- --platform meetup,tribe
 *   npm run pipeline -- --source dec --verbose
 */
import { loadEnv, hasDatabase } from './env.ts';
import { loadCatalog, filterSources, parseArgs, type CatalogSource } from './catalog.ts';
import { runParser, getParser, missingEnv, UnavailableParserError } from '../shared/parsers/index.ts';
import { ingestEvents, markSourceFailed, listActiveSources } from '../shared/supabase.ts';
import type { Env, IngestResult, RawEvent, SourceMessage } from '../shared/types.ts';

const CONCURRENCY = 4;

interface Outcome {
  source: string;
  platform: string;
  fetched: number;
  ingest?: IngestResult;
  error?: string;
  skipped?: string;
  ms: number;
  sample?: RawEvent;
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

async function processSource(
  source: CatalogSource & { source_id: string },
  env: Env,
  opts: { dryRun: boolean; verbose: boolean },
): Promise<Outcome> {
  const started = Date.now();
  const base = { source: source.name, platform: source.platform };

  const def = getParser(source.platform);
  if (!def) {
    return { ...base, fetched: 0, skipped: `no parser for "${source.platform}"`, ms: 0 };
  }
  const missing = missingEnv(def, env);
  if (missing.length) {
    return { ...base, fetched: 0, skipped: `needs ${missing.join(', ')}`, ms: 0 };
  }

  const msg: SourceMessage = {
    source_id: source.source_id,
    url: source.url,
    platform: source.platform,
    scrape_strategy: source.scrape_strategy ?? {},
  };

  // One source failing must never affect any other, and must never abort the
  // run — the same contract the queue consumer has.
  try {
    const events = await runParser(msg, {
      env,
      log: (m) => opts.verbose && console.log(`    ${m}`),
    });

    if (opts.dryRun) {
      return { ...base, fetched: events.length, ms: Date.now() - started, sample: events[0] };
    }

    const strategy = source.scrape_strategy ?? {};
    const ingest = await ingestEvents(env, source.source_id, events, {
      requireKeywords: strategy.require_keywords,
      defaultTimezone: strategy.default_timezone,
      maxPastDays: strategy.max_past_days,
      locationFilter: strategy.location_filter,
    });

    return { ...base, fetched: events.length, ingest, ms: Date.now() - started, sample: events[0] };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (!opts.dryRun && !(err instanceof UnavailableParserError)) {
      await markSourceFailed(env, source.source_id, reason).catch(() => {});
    }
    return { ...base, fetched: 0, error: reason, ms: Date.now() - started };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const dryRun = Boolean(args['dry-run']);
  const verbose = Boolean(args['verbose']);

  const filters = {
    platforms: typeof args['platform'] === 'string' ? args['platform'].split(',') : undefined,
    match: typeof args['source'] === 'string' ? args['source'] : undefined,
    includeInactive: Boolean(args['all']),
    limit: typeof args['limit'] === 'string' ? Number(args['limit']) : undefined,
  };

  let selected: Array<CatalogSource & { source_id: string }>;

  if (dryRun) {
    // No database needed at all: the catalog file is the source list.
    selected = filterSources(loadCatalog(), filters).map((s) => ({ ...s, source_id: 'dry-run' }));
    console.log(`DRY RUN — no database writes, no credentials used\n`);
  } else {
    if (!hasDatabase(env)) {
      console.error(
        'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n' +
          'Put them in workers/.dev.vars, or run with --dry-run to skip the database entirely.',
      );
      process.exit(1);
    }
    // Live runs read the sources table, so the database stays authoritative —
    // `npm run sources:sql` is what syncs sources.json into it.
    const rows = await listActiveSources(env);
    const catalog = loadCatalog();
    selected = filterSources(
      rows.map((r) => {
        const known = catalog.find((c) => c.url === r.url && c.platform === r.platform);
        return {
          name: known?.name ?? r.url,
          url: r.url,
          source_type: known?.source_type ?? 'html',
          platform: r.platform,
          active: true,
          scrape_strategy: r.scrape_strategy ?? {},
          notes: known?.notes ?? null,
          source_id: r.id,
        };
      }),
      filters,
    ) as Array<CatalogSource & { source_id: string }>;
    console.log(`Ingesting into ${env.SUPABASE_URL}\n`);
  }

  if (!selected.length) {
    console.log('No sources matched those filters.');
    return;
  }

  console.log(`Running ${selected.length} source(s), ${CONCURRENCY} at a time...\n`);
  const started = Date.now();
  const outcomes = await pool(selected, CONCURRENCY, (s) => processSource(s, env, { dryRun, verbose }));

  // ---- report ----
  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
  console.log(`${pad('source', 46)} ${pad('platform', 11)} ${'events'.padStart(6)}  detail`);
  console.log('─'.repeat(108));

  let totalFetched = 0;
  let totalInserted = 0;
  const failures: Outcome[] = [];

  for (const o of outcomes.sort((a, b) => a.platform.localeCompare(b.platform) || a.source.localeCompare(b.source))) {
    totalFetched += o.fetched;
    let detail: string;
    if (o.skipped) {
      detail = `skipped: ${o.skipped}`;
    } else if (o.error) {
      detail = `FAILED: ${o.error.slice(0, 46)}`;
      failures.push(o);
    } else if (o.ingest) {
      totalInserted += o.ingest.inserted;
      const drops = [
        o.ingest.duplicates ? `${o.ingest.duplicates} dupe` : '',
        o.ingest.past ? `${o.ingest.past} past` : '',
        o.ingest.out_of_region ? `${o.ingest.out_of_region} off-region` : '',
        o.ingest.no_keywords ? `${o.ingest.no_keywords} off-topic` : '',
      ].filter(Boolean);
      detail = `+${o.ingest.inserted} new, ~${o.ingest.updated} updated` + (drops.length ? `, dropped ${drops.join('/')}` : '');
    } else {
      detail = o.sample?.title ? `e.g. ${o.sample.title.slice(0, 42)}` : '—';
    }
    console.log(`${pad(o.source, 46)} ${pad(o.platform, 11)} ${String(o.fetched).padStart(6)}  ${detail}`);
  }

  console.log('─'.repeat(108));
  console.log(
    `${outcomes.length} sources, ${totalFetched} events fetched` +
      (dryRun ? '' : `, ${totalInserted} inserted`) +
      `, ${failures.length} failed, ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );

  if (failures.length) {
    console.log('\nFailures (each isolated — the rest of the run was unaffected):');
    for (const f of failures) console.log(`  ${f.source}\n    ${f.error}`);
  }
}

await main();
