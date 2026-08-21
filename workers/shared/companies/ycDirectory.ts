import { JSON_HEADERS } from '../http.ts';
import type { CompanyParserContext, CompanySourceMessage, RawCompany } from './types.ts';

/**
 * Y Combinator company directory.
 *
 * YC's own directory is an Algolia index whose keys are embedded in their
 * bundle and rotate. yc-oss publishes the same data as a plain static JSON file
 * on GitHub Pages — free, keyless, stable, and CORS-open. One fetch, no paging.
 *
 * Volume is small for DFW (a dozen or so), but the records are the highest
 * quality of any source here: real one-liners, team size, batch, and a live
 * active/acquired status.
 */
interface YcCompany {
  name?: string;
  website?: string;
  all_locations?: string;
  one_liner?: string;
  long_description?: string;
  small_logo_thumb_url?: string;
  team_size?: number;
  industry?: string;
  batch?: string;
  status?: string;
  stage?: string;
  tags?: string[];
}

export async function fetchYcDirectory(
  msg: CompanySourceMessage,
  ctx: CompanyParserContext,
): Promise<RawCompany[]> {
  const res = await fetch(msg.url, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`GET ${msg.url} -> ${res.status}`);
  const all = (await res.json()) as YcCompany[];

  const region = (msg.scrape_strategy.region_match ?? ['TX']).map((r) => r.toLowerCase());
  const out: RawCompany[] = [];

  for (const c of all) {
    const name = c.name?.trim();
    if (!name) continue;

    const locations = (c.all_locations ?? '').trim();
    if (!locations) continue;

    // all_locations is "Dallas, TX, USA; San Francisco, CA, USA" — match per
    // location, not against the whole string, so "Frisco, CO" never counts as
    // Frisco, TX and a Dallas office is found even when it is listed second.
    const matched = locations
      .split(';')
      .map((l) => l.trim())
      .find((l) => region.some((r) => l.toLowerCase().includes(r)));
    if (!matched) continue;

    out.push({
      name,
      one_liner: c.one_liner ?? null,
      description: c.long_description ?? null,
      website: c.website ?? null,
      hq_location: matched,
      logo_url: c.small_logo_thumb_url ?? null,
      stage: ycStage(c),
      signal: 'yc',
      signal_detail: [
        c.batch ? `Y Combinator ${c.batch}` : 'Y Combinator',
        c.status,
        c.team_size ? `${c.team_size} people` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }

  ctx.log(`${out.length} of ${all.length} YC companies matched ${region.join('/')}`);
  return out;
}

/** Maps YC's status/stage vocabulary onto the companies.stage CHECK list. */
function ycStage(c: YcCompany): string | null {
  const status = (c.status ?? '').toLowerCase();
  if (status === 'acquired') return 'acquired';
  if (status === 'public') return 'public';
  if (status === 'inactive') return null;

  switch ((c.stage ?? '').toLowerCase()) {
    case 'growth':
      return 'growth';
    case 'early':
      return 'seed';
    default:
      return 'unknown';
  }
}
