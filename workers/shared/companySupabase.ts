import type { Env } from './types.ts';
import type {
  CompanyIngestResult,
  CompanyPlatform,
  CompanyScrapeStrategy,
  RawCompany,
} from './companies/types.ts';

function restHeaders(env: Env): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function rest<T>(env: Env, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...restHeaders(env), ...(init?.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    throw new Error(`supabase ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export interface CompanySourceRow {
  id: string;
  slug: string;
  name: string;
  url: string;
  platform: CompanyPlatform;
  scrape_strategy: CompanyScrapeStrategy | null;
}

export function listActiveCompanySources(env: Env): Promise<CompanySourceRow[]> {
  return rest<CompanySourceRow[]>(
    env,
    'company_sources?active=eq.true&select=id,slug,name,url,platform,scrape_strategy' +
      '&order=last_run_at.asc.nullsfirst',
  );
}

/**
 * Ingests a directory in fixed-size batches.
 *
 * The single-call-per-source contract the event pipeline uses does not survive
 * here: Capital Factory returns 835 companies, and keyword-tagging each one
 * inside the RPC blew past Supabase's statement timeout. Chunking keeps every
 * statement short while still holding the whole run to a handful of
 * subrequests, which is what the Workers free tier actually cares about.
 *
 * Batches are also sorted by name so that two sources touching the same company
 * always take row locks in the same order — an unsorted run deadlocked against
 * itself the moment two directories overlapped.
 */
const BATCH_SIZE = 120;

export async function ingestCompanies(
  env: Env,
  sourceId: string,
  slug: string,
  companies: RawCompany[],
  opts: { dfwOnly?: boolean } = {},
): Promise<CompanyIngestResult> {
  const sorted = [...companies].sort((a, b) => a.name.localeCompare(b.name));
  const total: CompanyIngestResult = { inserted: 0, updated: 0, skipped: 0, out_of_region: 0 };

  for (let i = 0; i < sorted.length; i += BATCH_SIZE) {
    const batch = await rest<CompanyIngestResult>(env, 'rpc/ingest_companies', {
      method: 'POST',
      body: JSON.stringify({
        p_source_id: sourceId,
        p_slug: slug,
        p_companies: sorted.slice(i, i + BATCH_SIZE),
        p_dfw_only: opts.dfwOnly ?? false,
      }),
    });
    total.inserted += batch.inserted;
    total.updated += batch.updated;
    total.skipped += batch.skipped;
    total.out_of_region += batch.out_of_region;
  }

  // An empty source still needs its bookkeeping row touched, which the RPC only
  // does as part of a call.
  if (!sorted.length) {
    await rest<CompanyIngestResult>(env, 'rpc/ingest_companies', {
      method: 'POST',
      body: JSON.stringify({
        p_source_id: sourceId,
        p_slug: slug,
        p_companies: [],
        p_dfw_only: opts.dfwOnly ?? false,
      }),
    });
  }

  return total;
}

export async function markCompanySourceFailed(
  env: Env,
  sourceId: string,
  message: string,
): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/mark_company_source_failed`, {
    method: 'POST',
    headers: restHeaders(env),
    body: JSON.stringify({ p_source_id: sourceId, p_error: message.slice(0, 500) }),
  });
  if (!res.ok) console.error(`mark_company_source_failed -> ${res.status}`);
}

/** Mines company mentions out of the event corpus. Pure Postgres, no network. */
export function extractCompaniesFromEvents(env: Env): Promise<{ new_companies: number; links: number }> {
  return rest(env, 'rpc/extract_companies_from_events', { method: 'POST', body: '{}' });
}

/**
 * Connects every known company to the events that mention it and refreshes
 * last_seen_at. Run AFTER the directory imports: that is what turns "a company
 * that filed a Form D" into "a company that filed a Form D and showed up at a
 * Dallas event last week".
 */
export function linkEventsToCompanies(env: Env): Promise<{ links: number; refreshed: number }> {
  return rest(env, 'rpc/link_events_to_companies', { method: 'POST', body: '{}' });
}
