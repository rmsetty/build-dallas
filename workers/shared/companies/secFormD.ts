import { JSON_HEADERS } from '../http.ts';
import type { CompanyParserContext, CompanySourceMessage, RawCompany } from './types.ts';

/**
 * SEC EDGAR full-text search over Form D filings.
 *
 * Form D is the exempt-offering notice, due within 15 days of the first sale of
 * securities. It is the earliest *public* evidence that a private company is
 * raising, and it usually predates any press coverage by months — which is
 * exactly the "being built now, not a completed deal" signal we want.
 *
 * Free, keyless, no rate-limit headers. The SEC does require a descriptive
 * User-Agent with contact info; sending a browser UA gets you blocked.
 */
const ENDPOINT = 'https://efts.sec.gov/LATEST/search-index';

const SEC_HEADERS: Record<string, string> = {
  'User-Agent': 'Build Dallas ecosystem index (contact: hello@builddallas.org)',
  Accept: 'application/json',
};

const DEFAULT_CITIES = [
  'Dallas', 'Fort Worth', 'Plano', 'Frisco', 'Irving', 'Richardson', 'Addison',
  'McKinney', 'Denton', 'Arlington', 'Southlake', 'Grapevine', 'Carrollton',
  'Coppell', 'Allen', 'Lewisville', 'Flower Mound', 'Rockwall', 'Prosper',
];

/**
 * Most Form D filers in a metro are not startups. Three structural filters
 * remove the overwhelming majority without touching an operating company:
 *
 *   1. Item 3C.x — the filer claims an Investment Company Act §3(c) exclusion,
 *      i.e. it IS a fund. This is a self-declared field, not a guess.
 *   2. Vehicle words — single-asset real-estate SPVs and medical-practice
 *      roll-ups ("... Apts, LLC", "... DST", "Greenville Surgery Center").
 *   3. A numbered or roman-numeral tail ("Resource Royalty 28, LLC") is a
 *      series vehicle by construction.
 */
const VEHICLE =
  /\b(fund|funds|l\.?\s?p\.?|lp|partners|partnership|capital|ventures?|realty|reit|trust|dst|properties|property|residential|apts|apartments|duplex|hotel|lodging|resort|royalty|royalties|mineral|oil|gas|opportunit\w*|investors?|investments?|advisors|equity|income|yield|credit|lending|leasing|assets?|portfolio|exchange|spe|holdco|holdings|acquisition corp|surgery center|surgical|renal|dialysis|dental|orthopedic|anesthesia|imaging center|senior living|self storage|storage|land|ranch|farms?)\b/i;

const NUMBERED_TAIL = /(\b[IVX]{1,5}|\b\d{1,4})\s*,?\s*(LLC|L\.L\.C\.|LP|L\.P\.|Inc\.?|Corp\.?)?\s*$/i;

interface EdgarHit {
  _source?: {
    display_names?: string[];
    biz_locations?: string[];
    file_date?: string;
    items?: string[];
  };
}

export async function fetchSecFormD(
  msg: CompanySourceMessage,
  ctx: CompanyParserContext,
): Promise<RawCompany[]> {
  const s = msg.scrape_strategy;
  const cities = s.cities?.length ? s.cities : DEFAULT_CITIES;
  const pages = Math.min(Math.max(s.pages ?? 4, 1), 10);
  const sinceDays = s.since_days ?? 200;

  const end = new Date();
  const start = new Date(end.getTime() - sinceDays * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const out: RawCompany[] = [];

  for (let page = 0; page < pages; page++) {
    // `dateRange=custom` is required whenever `from` is present; without it the
    // endpoint 500s rather than returning an error body.
    const url =
      `${ENDPOINT}?q=%22Dallas%22&forms=D&dateRange=custom` +
      `&startdt=${iso(start)}&enddt=${iso(end)}&from=${page * 100}`;

    const hits = await fetchWithRetry(url, ctx);
    if (!hits.length) break;

    for (const hit of hits) {
      const src = hit._source;
      if (!src) continue;

      const location = src.biz_locations?.[0] ?? '';
      if (!cities.some((c) => location.toLowerCase().startsWith(`${c.toLowerCase()},`))) continue;

      if ((src.items ?? []).some((i) => i.toUpperCase().startsWith('3C'))) continue;

      const raw = (src.display_names?.[0] ?? '').replace(/\s*\(CIK\s+\d+\)\s*$/, '').trim();
      if (!raw) continue;

      // A trailing "(TICK, TICKW)" means the filer already trades publicly, so
      // this is a follow-on raise by a listed company rather than a startup
      // round. Kept, but stage-marked so the directory can filter it out.
      const isPublic = /\([A-Z]{1,5}(?:,\s*[A-Z]{1,6})*\)\s*$/.test(raw);

      const name = raw
        .replace(/\s*\([A-Z, ]+\)\s*$/, '')
        .replace(/\s*\\[A-Z]{2}$/, '') // EDGAR's "\DE" state-of-incorporation tail
        .trim();

      if (!name || VEHICLE.test(name) || NUMBERED_TAIL.test(name)) continue;

      const filed = src.file_date ?? null;
      out.push({
        name,
        hq_location: location,
        stage: isPublic ? 'public' : 'unknown',
        signal: 'raising',
        signal_detail: filed
          ? `SEC Form D filed ${filed} — exempt offering`
          : 'SEC Form D — exempt offering',
        signal_at: filed,
      });
    }

    ctx.log(`page ${page + 1}: ${hits.length} filings, ${out.length} kept so far`);
    if (hits.length < 100) break;
  }

  return out;
}

/**
 * EDGAR intermittently 500s under load. One transient failure should not cost
 * the whole source, so back off and retry before giving up on the page.
 */
async function fetchWithRetry(url: string, ctx: CompanyParserContext): Promise<EdgarHit[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { ...JSON_HEADERS, ...SEC_HEADERS } });
    if (res.ok) {
      const body = (await res.json()) as { hits?: { hits?: EdgarHit[] } };
      return body.hits?.hits ?? [];
    }
    ctx.log(`EDGAR ${res.status}, retrying (${attempt + 1}/3)`);
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  throw new Error(`EDGAR full-text search failed after 3 attempts: ${url}`);
}
