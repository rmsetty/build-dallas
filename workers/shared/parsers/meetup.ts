import { BROWSER_HEADERS, joinLocation } from '../http.ts';
import type { RawEvent, SourceMessage } from '../types.ts';

const NEXT_DATA_OPEN = '<script id="__NEXT_DATA__" type="application/json">';

interface ApolloVenue {
  __typename?: string;
  name?: string;
  address?: string;
  city?: string;
  state?: string;
}

interface ApolloEvent {
  __typename?: string;
  id?: string;
  title?: string;
  description?: string;
  dateTime?: string;
  endTime?: string;
  eventUrl?: string;
  isOnline?: boolean;
  status?: string;
  venue?: { __ref?: string };
}

/**
 * Meetup's GraphQL API now requires OAuth behind a paid Meetup Pro plan, so the
 * "public GraphQL endpoint" approach is not available on free tier. Group pages
 * ship a ~58KB __NEXT_DATA__ blob containing a normalized Apollo cache with the
 * events fully populated — title, dateTime, endTime, description, eventUrl and
 * a venue reference — with no auth at all.
 *
 * The cache also holds PAST events (the page queries both directions), so we
 * filter to future ones here.
 */
export async function fetchMeetup(msg: SourceMessage): Promise<RawEvent[]> {
  const res = await fetch(msg.url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`meetup ${msg.url} -> ${res.status}`);
  const html = await res.text();

  const open = html.indexOf(NEXT_DATA_OPEN);
  if (open < 0) return [];
  const close = html.indexOf('</script>', open);
  if (close < 0) return [];

  let apollo: Record<string, unknown>;
  try {
    const data = JSON.parse(html.slice(open + NEXT_DATA_OPEN.length, close)) as {
      props?: { pageProps?: { __APOLLO_STATE__?: Record<string, unknown> } };
    };
    apollo = data.props?.pageProps?.__APOLLO_STATE__ ?? {};
  } catch {
    throw new Error('meetup __NEXT_DATA__ did not parse');
  }

  const now = Date.now();
  const out: RawEvent[] = [];

  for (const [key, node] of Object.entries(apollo)) {
    if (!key.startsWith('Event:')) continue;
    const e = node as ApolloEvent;
    if (!e.title || !e.dateTime) continue;

    const startMs = Date.parse(e.dateTime);
    if (Number.isNaN(startMs) || startMs < now) continue; // cache includes past events

    const venueRef = e.venue?.__ref;
    const venue = venueRef ? (apollo[venueRef] as ApolloVenue | undefined) : undefined;
    const isOnline = e.isOnline === true || venue?.name === 'Online event';

    out.push({
      title: e.title,
      description: e.description ?? null,
      // Meetup timestamps already carry a numeric offset.
      start_time: e.dateTime,
      end_time: e.endTime ?? null,
      venue: isOnline ? null : (venue?.name ?? null),
      location: isOnline ? 'Online' : joinLocation(venue?.address, venue?.city, venue?.state),
      url: e.eventUrl ?? null,
      external_id: e.id ?? null,
      cancelled: (e.status ?? '').toUpperCase() === 'CANCELLED',
    });
  }

  return out;
}
