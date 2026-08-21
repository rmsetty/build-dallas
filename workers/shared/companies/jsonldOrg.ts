import { BROWSER_HEADERS, decodeEntities } from '../http.ts';
import type { CompanyParserContext, CompanySourceMessage, RawCompany } from './types.ts';

/**
 * Generic schema.org Organization harvester.
 *
 * Portfolio pages that care about SEO publish their whole company list as a
 * CollectionPage -> ItemList -> Organization tree. Capital Factory's portfolio
 * ships 835 companies that way. Because the shape is a standard, one parser
 * covers every site that follows it — no per-site selectors to maintain.
 *
 * Two carriers are read:
 *   - <script type="application/ld+json"> ... </script>   (the normal case)
 *   - self.__next_f.push([1,"<escaped json>"])            (Next.js App Router,
 *     which streams the same JSON-LD through its flight payload instead)
 */
const ORG_TYPES = new Set(['Organization', 'Corporation', 'LocalBusiness', 'NGO', 'NewsMediaOrganization']);

export async function fetchJsonLdOrgs(
  msg: CompanySourceMessage,
  ctx: CompanyParserContext,
): Promise<RawCompany[]> {
  const res = await fetch(msg.url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`GET ${msg.url} -> ${res.status}`);
  const html = await res.text();

  const s = msg.scrape_strategy;
  const exclude = new Set((s.exclude_names ?? []).map((n) => n.toLowerCase()));
  const label = s.signal_label ?? 'Directory listing';
  const found = new Map<string, RawCompany>();

  for (const blob of extractJsonBlobs(html)) {
    let root: unknown;
    try {
      root = JSON.parse(blob);
    } catch {
      continue;
    }
    walk(root, (node) => {
      const name = decodeEntities(typeof node['name'] === 'string' ? node['name'] : null);
      if (!name || exclude.has(name.toLowerCase())) return;

      const key = name.toLowerCase();
      if (found.has(key)) return;

      found.set(key, {
        name,
        one_liner: decodeEntities(asString(node['description'])),
        website: asString(node['sameAs']) ?? externalUrl(asString(node['url']), msg.url),
        logo_url: asString(node['logo']) ?? asString(node['image']),
        hq_location: addressOf(node) ?? s.default_location ?? null,
        signal: s.signal ?? 'portfolio',
        signal_detail: label,
      });
    });
  }

  ctx.log(`${found.size} organizations in JSON-LD`);
  return [...found.values()];
}

/** Walks any JSON tree, calling `hit` on each node typed as an organization. */
function walk(root: unknown, hit: (node: Record<string, unknown>) => void): void {
  const stack: unknown[] = [root];
  // Iterative rather than recursive: these trees run thousands of nodes deep in
  // aggregate and a Worker's stack is not worth gambling on.
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (!node || typeof node !== 'object') continue;
    const obj = node as Record<string, unknown>;
    if (typeof obj['@type'] === 'string' && ORG_TYPES.has(obj['@type'])) hit(obj);
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }
}

function extractJsonBlobs(html: string): string[] {
  const out: string[] = [];

  for (const m of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    if (m[1]) out.push(m[1]);
  }

  // Next.js flight rows. The payload is a JS string literal holding JSON, so it
  // needs two parses: once to unescape the literal, once for the JSON itself.
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    if (!m[1]) continue;
    let unescaped: string;
    try {
      unescaped = JSON.parse(m[1]) as string;
    } catch {
      continue;
    }
    const start = unescaped.indexOf('{"@context"');
    if (start >= 0) out.push(unescaped.slice(start));
  }

  return out;
}

function asString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = asString(item);
      if (s) return s;
    }
  }
  if (v && typeof v === 'object') return asString((v as Record<string, unknown>)['url']);
  return null;
}

/**
 * A portfolio page usually links each company to its own profile on the same
 * host. That is not the company's website, so it is dropped rather than stored
 * as one — a wrong website is worse than a missing one in a wiki-edited table.
 */
function externalUrl(url: string | null, pageUrl: string): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const pageHost = new URL(pageUrl).hostname.replace(/^www\./, '');
    return host === pageHost ? null : url;
  } catch {
    return null;
  }
}

function addressOf(node: Record<string, unknown>): string | null {
  const address = node['address'];
  if (typeof address === 'string') return address;
  if (address && typeof address === 'object') {
    const a = address as Record<string, unknown>;
    const parts = [a['addressLocality'], a['addressRegion']].filter(
      (p): p is string => typeof p === 'string' && p.trim() !== '',
    );
    if (parts.length) return parts.join(', ');
  }
  return null;
}
