import { decodeEntities, fetchJson, joinLocation } from '../http.ts';
import type { RawEvent, SourceMessage } from '../types.ts';

interface TribeVenue {
  venue?: string;
  address?: string;
  city?: string;
  province?: string;
  state?: string;
}

interface TribeEvent {
  id?: number;
  title?: string;
  excerpt?: string;
  description?: string;
  url?: string;
  start_date?: string;
  end_date?: string;
  timezone?: string;
  status?: string;
  is_virtual?: boolean;
  venue?: TribeVenue | unknown[];
}

/**
 * "The Events Calendar", the most common WordPress events plugin, ships a free
 * unauthenticated REST API at /wp-json/tribe/events/v1/events. Any WordPress
 * site running it becomes a structured source with no LLM and no key.
 *
 * Verified against thedec.co, which exposes 113 events this way — the site that
 * previously needed an LLM pass.
 *
 * `venue` is an object when set and an empty ARRAY when not, which is a PHP
 * json_encode artifact rather than a schema, so it needs a shape check.
 */
export async function fetchTribe(msg: SourceMessage): Promise<RawEvent[]> {
  const s = msg.scrape_strategy ?? {};
  const base = (s.api_base ?? msg.url).replace(/\/+$/, '');
  const perPage = Math.min(s.per_page ?? 50, 50);

  // start_date=today keeps the response to upcoming events only.
  const today = new Date().toISOString().slice(0, 10);
  const url = `${base}/wp-json/tribe/events/v1/events?per_page=${perPage}&start_date=${today}`;

  const data = await fetchJson<{ events?: TribeEvent[] }>(url);

  return (data.events ?? []).flatMap((e) => {
    const title = decodeEntities(e.title);
    if (!title) return [];
    if (e.status && e.status !== 'publish') return [];

    const venue = !Array.isArray(e.venue) && e.venue ? (e.venue as TribeVenue) : {};

    return [
      {
        title,
        description: decodeEntities(e.excerpt ?? e.description),
        // "2026-08-25 15:00:00" local, with the zone in its own field.
        start_time: e.start_date ? e.start_date.replace(' ', 'T') : null,
        end_time: e.end_date ? e.end_date.replace(' ', 'T') : null,
        timezone: e.timezone ?? null,
        venue: e.is_virtual ? null : decodeEntities(venue.venue),
        location: e.is_virtual
          ? 'Online'
          : joinLocation(venue.address, venue.city, venue.province ?? venue.state),
        url: e.url ?? null,
        external_id: e.id != null ? String(e.id) : null,
      } satisfies RawEvent,
    ];
  });
}
