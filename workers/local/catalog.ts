import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WORKERS_ROOT } from './env.ts';
import type { Platform, ScrapeStrategy } from '../shared/types.ts';

export interface CatalogSource {
  name: string;
  url: string;
  source_type: 'api' | 'html';
  platform: Platform;
  active: boolean;
  scrape_strategy: ScrapeStrategy;
  notes: string | null;
}

export function loadCatalog(): CatalogSource[] {
  const path = resolve(WORKERS_ROOT, 'sources.json');
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { sources?: CatalogSource[] };
  const sources = parsed.sources ?? [];

  const seen = new Set<string>();
  for (const s of sources) {
    const key = `${s.platform}|${s.url}`;
    if (seen.has(key)) throw new Error(`duplicate source in sources.json: ${key}`);
    seen.add(key);
  }

  return sources;
}

export interface Filters {
  platforms?: string[];
  match?: string;
  includeInactive?: boolean;
  limit?: number;
}

export function filterSources(sources: CatalogSource[], f: Filters): CatalogSource[] {
  let out = sources;
  if (!f.includeInactive) out = out.filter((s) => s.active);
  if (f.platforms?.length) out = out.filter((s) => f.platforms!.includes(s.platform));
  if (f.match) {
    const needle = f.match.toLowerCase();
    out = out.filter((s) => s.name.toLowerCase().includes(needle) || s.url.toLowerCase().includes(needle));
  }
  if (f.limit != null) out = out.slice(0, f.limit);
  return out;
}

/** Minimal flag parsing — avoids a dependency for four options. */
export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq > 0) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[arg.slice(2)] = next;
        i++;
      } else {
        out[arg.slice(2)] = true;
      }
    }
  }
  return out;
}
