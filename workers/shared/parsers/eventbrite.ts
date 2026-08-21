import { BROWSER_HEADERS, firstString, joinLocation } from '../http.ts';
import type { RawEvent, SourceMessage } from '../types.ts';

interface EbEvent {
  id?: string;
  name?: string;
  summary?: string;
  full_description?: string;
  url?: string;
  start_date?: string;
  start_time?: string;
  end_date?: string;
  end_time?: string;
  timezone?: string;
  is_cancelled?: boolean;
  primary_venue?: { name?: string; address?: { city?: string; region?: string; localized_address_display?: string } };
}

/**
 * Eventbrite withdrew the public /v3/events/search/ endpoint in Dec 2019, and
 * the internal destination/search API rejects unauthenticated calls with a CSRF
 * error. What remains is the __SERVER_DATA__ blob the search page already
 * ships, which holds a page of fully structured events.
 *
 * The page is ~780KB. We do NOT JSON.parse all of it — we locate the results
 * array by marker and parse only that ~85KB slice, which keeps this well inside
 * the CPU budget.
 */
export async function fetchEventbrite(msg: SourceMessage): Promise<RawEvent[]> {
  const res = await fetch(msg.url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`eventbrite ${msg.url} -> ${res.status}`);
  const html = await res.text();

  const searchData = html.indexOf('"search_data"');
  if (searchData < 0) return [];

  const marker = '"results":[';
  const start = html.indexOf(marker, searchData);
  if (start < 0) return [];

  // The results array is followed by the aggregations block.
  const end = html.indexOf('],"aggs"', start);
  if (end < 0) return [];

  let parsed: EbEvent[];
  try {
    parsed = JSON.parse(html.slice(start + '"results":'.length, end + 1)) as EbEvent[];
  } catch {
    throw new Error('eventbrite __SERVER_DATA__ layout changed: results slice did not parse');
  }

  return parsed.flatMap((e) => {
    if (!e.name) return [];
    const venue = e.primary_venue ?? {};
    const addr = venue.address ?? {};
    return [
      {
        title: e.name,
        description: firstString(e.summary, e.full_description),
        // Eventbrite splits the local wall-clock time across two fields and
        // names the zone separately; Postgres reassembles it.
        start_time: e.start_date ? `${e.start_date}T${e.start_time ?? '00:00'}:00` : null,
        end_time: e.end_date ? `${e.end_date}T${e.end_time ?? '00:00'}:00` : null,
        timezone: e.timezone ?? null,
        venue: venue.name ?? null,
        location: joinLocation(addr.localized_address_display, addr.city, addr.region),
        url: e.url ?? null,
        external_id: e.id ?? null,
        cancelled: e.is_cancelled === true,
      } satisfies RawEvent,
    ];
  });
}
