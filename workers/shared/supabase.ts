import type { Env, IngestResult, RawEvent, SourceMessage } from './types.ts';

/**
 * Supabase REST (PostgREST) rather than a Postgres driver: Hyperdrive is a paid
 * feature and a TCP pool from a Worker is not viable on the free plan anyway.
 */
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

export interface SourceRow {
  id: string;
  url: string;
  platform: SourceMessage['platform'];
  scrape_strategy: SourceMessage['scrape_strategy'] | null;
}

export function listActiveSources(env: Env): Promise<SourceRow[]> {
  return rest<SourceRow[]>(
    env,
    'sources?active=eq.true&select=id,url,platform,scrape_strategy&order=last_run_at.asc.nullsfirst',
  );
}

/**
 * One call ingests an entire source. Dedupe, keyword tagging and the source
 * bookkeeping all happen inside Postgres, which keeps this to a single
 * subrequest no matter how many events came back — the free plan allows 50
 * subrequests per invocation, so per-event round trips would not survive a
 * busy source.
 */
export function ingestEvents(
  env: Env,
  sourceId: string,
  events: RawEvent[],
  opts: {
    requireKeywords?: boolean;
    defaultTimezone?: string;
    maxPastDays?: number;
    locationFilter?: string[];
  } = {},
): Promise<IngestResult> {
  return rest<IngestResult>(env, 'rpc/ingest_events', {
    method: 'POST',
    body: JSON.stringify({
      p_source_id: sourceId,
      p_events: events,
      p_require_keywords: opts.requireKeywords ?? false,
      p_default_timezone: opts.defaultTimezone ?? 'America/Chicago',
      p_max_past_days: opts.maxPastDays ?? 1,
      p_location_filter: opts.locationFilter ?? null,
    }),
  });
}

export async function markSourceFailed(env: Env, sourceId: string, message: string): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/mark_source_failed`, {
    method: 'POST',
    headers: restHeaders(env),
    body: JSON.stringify({ p_source_id: sourceId, p_error: message.slice(0, 500) }),
  });
  // Best effort: if we cannot even record the failure there is nothing useful
  // left to do, and throwing here would mask the original error.
  if (!res.ok) console.error(`mark_source_failed -> ${res.status}`);
}
