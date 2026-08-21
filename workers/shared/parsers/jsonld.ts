import { BROWSER_HEADERS, decodeEntities, firstString, joinLocation } from '../http.ts';
import type { RawEvent, SourceMessage } from '../types.ts';

const LD_OPEN = 'application/ld+json';

interface LdEvent {
  '@type'?: string | string[];
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  eventStatus?: string;
  identifier?: string;
  location?: unknown;
}

function isEventType(t: unknown): boolean {
  const types = Array.isArray(t) ? t : [t];
  // schema.org subtypes: BusinessEvent, EducationEvent, SocialEvent, ...
  return types.some((x) => typeof x === 'string' && /Event$/.test(x));
}

/** schema.org allows location to be a string, an object, or an array of either. */
function readLocation(loc: unknown): { venue: string | null; location: string | null } {
  const first = Array.isArray(loc) ? loc[0] : loc;
  if (typeof first === 'string') return { venue: null, location: first };
  if (!first || typeof first !== 'object') return { venue: null, location: null };

  const o = first as { name?: string; address?: unknown };
  const addr = o.address;
  if (typeof addr === 'string') return { venue: o.name ?? null, location: addr };
  if (addr && typeof addr === 'object') {
    const a = addr as { streetAddress?: string; addressLocality?: string; addressRegion?: string };
    return {
      venue: o.name ?? null,
      location: joinLocation(a.streetAddress, a.addressLocality, a.addressRegion),
    };
  }
  return { venue: o.name ?? null, location: null };
}

/** Walks nested @graph containers, which WordPress-based sites use heavily. */
function collectEvents(node: unknown, out: LdEvent[], depth = 0): void {
  if (depth > 4 || !node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectEvents(item, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;

  const obj = node as LdEvent & { '@graph'?: unknown };
  if (isEventType(obj['@type']) && obj.name) out.push(obj);
  if (obj['@graph']) collectEvents(obj['@graph'], out, depth + 1);
}

/**
 * For sites that already publish schema.org Event markup — verified on Dallas
 * Innovates (43 events) and AllEvents.in (15). Structured, exact, and it never
 * spends a Groq call.
 */
export async function fetchJsonLd(msg: SourceMessage): Promise<RawEvent[]> {
  const res = await fetch(msg.url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`jsonld ${msg.url} -> ${res.status}`);
  const html = await res.text();

  const found: LdEvent[] = [];
  let cursor = 0;

  // Scan script blocks by index rather than a global regex: these pages run to
  // several hundred KB and indexOf is dramatically cheaper than backtracking.
  for (;;) {
    const tagAt = html.indexOf(LD_OPEN, cursor);
    if (tagAt < 0) break;
    const bodyStart = html.indexOf('>', tagAt);
    const bodyEnd = bodyStart < 0 ? -1 : html.indexOf('</script>', bodyStart);
    if (bodyStart < 0 || bodyEnd < 0) break;
    cursor = bodyEnd;

    try {
      collectEvents(JSON.parse(html.slice(bodyStart + 1, bodyEnd)), found);
    } catch {
      // One malformed block should not lose the rest of the page.
    }
  }

  return found.flatMap((e) => {
    const title = decodeEntities(e.name);
    if (!title) return [];
    const { venue, location } = readLocation(e.location);
    return [
      {
        title,
        description: decodeEntities(e.description),
        // Often naive local time; ingest_events applies the source's default zone.
        start_time: e.startDate ?? null,
        end_time: e.endDate ?? null,
        venue: decodeEntities(venue),
        location: decodeEntities(location),
        url: e.url ?? null,
        external_id: firstString(e.identifier, e.url),
        cancelled: /cancelled/i.test(e.eventStatus ?? ''),
      } satisfies RawEvent,
    ];
  });
}
