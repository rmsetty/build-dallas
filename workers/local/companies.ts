/**
 * Company discovery pipeline, run locally.
 *
 * Same shape as local/pipeline.ts: same parsers, same ingest RPC, the queue
 * replaced by a small concurrency pool. A green run here means the Worker will
 * behave identically once deployed.
 *
 *   npm run companies -- --dry-run          fetch + parse only, no database
 *   npm run companies                        fetch + parse + write to Supabase
 *   npm run companies -- --source yc --verbose
 *   npm run companies -- --skip-derive       directories only, no event mining
 */
import { loadEnv, hasDatabase } from './env.ts';
import { parseArgs } from './catalog.ts';
import {
  runCompanyParser,
  getCompanyParser,
  missingCompanyEnv,
  UnavailableCompanyParserError,
} from '../shared/companies/index.ts';
import {
  listActiveCompanySources,
  ingestCompanies,
  markCompanySourceFailed,
  extractCompaniesFromEvents,
  linkEventsToCompanies,
  type CompanySourceRow,
} from '../shared/companySupabase.ts';
import type { Env } from '../shared/types.ts';
import type { CompanyIngestResult, CompanySourceMessage, RawCompany } from '../shared/companies/types.ts';

// Serial on purpose. Directory sources overlap heavily (a Capital Factory
// company is often also a YC company), so running them in parallel means two
// transactions updating the same companies rows in opposite orders — which
// deadlocked. There are only a handful of sources; the parallelism bought
// nothing worth that.
const CONCURRENCY = 1;

interface Outcome {
  source: string;
  platform: string;
  fetched: number;
  ingest?: CompanyIngestResult;
  error?: string;
  skipped?: string;
  ms: number;
  sample?: RawCompany;
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
  row: CompanySourceRow,
  env: Env,
  opts: { dryRun: boolean; verbose: boolean },
): Promise<Outcome> {
  const started = Date.now();
  const base = { source: row.name, platform: row.platform };

  const def = getCompanyParser(row.platform);
  if (!def) return { ...base, fetched: 0, skipped: `no parser for "${row.platform}"`, ms: 0 };

  const missing = missingCompanyEnv(def, env);
  if (missing.length) return { ...base, fetched: 0, skipped: `needs ${missing.join(', ')}`, ms: 0 };

  const strategy = row.scrape_strategy ?? {};
  const msg: CompanySourceMessage = {
    source_id: row.id,
    slug: row.slug,
    url: row.url,
    platform: row.platform,
    scrape_strategy: strategy,
  };

  // One source failing must never affect another, and must never abort the run.
  try {
    const companies = await runCompanyParser(msg, {
      env,
      log: (m) => opts.verbose && console.log(`    ${m}`),
    });

    if (opts.dryRun) {
      return { ...base, fetched: companies.length, ms: Date.now() - started, sample: companies[0] };
    }

    const ingest = await ingestCompanies(env, row.id, row.slug, companies, {
      dfwOnly: strategy.dfw_only,
    });
    return { ...base, fetched: companies.length, ingest, ms: Date.now() - started, sample: companies[0] };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (!opts.dryRun && !(err instanceof UnavailableCompanyParserError)) {
      await markCompanySourceFailed(env, row.id, reason).catch(() => {});
    }
    return { ...base, fetched: 0, error: reason, ms: Date.now() - started };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const dryRun = Boolean(args['dry-run']);
  const verbose = Boolean(args['verbose']);
  const match = typeof args['source'] === 'string' ? args['source'].toLowerCase() : null;

  if (!hasDatabase(env)) {
    console.error(
      'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n' +
        'Put them in workers/.dev.vars. Unlike the event pipeline, --dry-run still needs them:\n' +
        'the company source list lives in the database, not in a checked-in catalog file.',
    );
    process.exit(1);
  }

  let sources = await listActiveCompanySources(env);
  if (match) {
    sources = sources.filter(
      (s) => s.slug.toLowerCase().includes(match) || s.name.toLowerCase().includes(match),
    );
  }
  if (typeof args['platform'] === 'string') {
    const platforms = args['platform'].split(',');
    sources = sources.filter((s) => platforms.includes(s.platform));
  }

  if (!sources.length) {
    console.log('No company sources matched those filters.');
    return;
  }

  console.log(
    dryRun
      ? 'DRY RUN — fetch + parse only, nothing written\n'
      : `Ingesting companies into ${env.SUPABASE_URL}\n`,
  );
  console.log(`Running ${sources.length} source(s), ${CONCURRENCY} at a time...\n`);

  const started = Date.now();
  const outcomes = await pool(sources, CONCURRENCY, (s) => processSource(s, env, { dryRun, verbose }));

  const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
  console.log(`${pad('source', 34)} ${pad('platform', 14)} ${'found'.padStart(6)}  detail`);
  console.log('─'.repeat(104));

  let totalFetched = 0;
  let totalInserted = 0;
  const failures: Outcome[] = [];

  for (const o of outcomes.sort((a, b) => a.platform.localeCompare(b.platform) || a.source.localeCompare(b.source))) {
    totalFetched += o.fetched;
    let detail: string;
    if (o.skipped) {
      detail = `skipped: ${o.skipped}`;
    } else if (o.error) {
      detail = `FAILED: ${o.error.slice(0, 48)}`;
      failures.push(o);
    } else if (o.ingest) {
      totalInserted += o.ingest.inserted;
      const drops = [
        o.ingest.out_of_region ? `${o.ingest.out_of_region} off-region` : '',
        o.ingest.skipped ? `${o.ingest.skipped} unusable` : '',
      ].filter(Boolean);
      detail =
        `+${o.ingest.inserted} new, ~${o.ingest.updated} merged` +
        (drops.length ? `, dropped ${drops.join('/')}` : '');
    } else {
      detail = o.sample?.name ? `e.g. ${o.sample.name.slice(0, 44)}` : '—';
    }
    console.log(`${pad(o.source, 34)} ${pad(o.platform, 14)} ${String(o.fetched).padStart(6)}  ${detail}`);
  }

  console.log('─'.repeat(104));
  console.log(
    `${outcomes.length} sources, ${totalFetched} companies found` +
      (dryRun ? '' : `, ${totalInserted} new`) +
      `, ${failures.length} failed, ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );

  if (failures.length) {
    console.log('\nFailures (each isolated — the rest of the run was unaffected):');
    for (const f of failures) console.log(`  ${f.source}\n    ${f.error}`);
  }

  // Both of these are pure Postgres. They run last because linking is only
  // meaningful once the directories have landed.
  if (!dryRun && !args['skip-derive']) {
    const mined = await extractCompaniesFromEvents(env);
    console.log(`\nMined from event text: +${mined.new_companies} companies, ${mined.links} links`);
    const linked = await linkEventsToCompanies(env);
    console.log(`Linked to events:      ${linked.links} links, ${linked.refreshed} freshness updates`);
  }
}

await main();
