import { fetchJson, joinLocation } from '../http.ts';
import type { RawEvent, SourceMessage } from '../types.ts';

const API = 'https://api.lu.ma';

interface LumaEntry {
  event?: {
    api_id?: string;
    name?: string;
    start_at?: string;
    end_at?: string;
    timezone?: string;
    url?: string;
    geo_address_info?: { address?: string; city?: string; region?: string; full_address?: string };
  };
}

/**
 * lu.ma's web client talks to an unauthenticated JSON API. The *official*
 * public-api.luma.com needs a Luma Plus subscription, which the free-tier rule
 * rules out, so we use the same endpoints the site itself calls.
 *
 *   discover: /discover/get-paginated-events?discover_place_api_id=...
 *   calendar: /calendar/get-items?calendar_api_id=...
 *
 * Neither payload carries the event description — that lives behind a separate
 * per-event call. We deliberately don't make it: one subrequest per event would
 * blow the 50-subrequest ceiling, so Luma events are keyword-tagged from their
 * title alone.
 */
export async function fetchLuma(msg: SourceMessage): Promise<RawEvent[]> {
  const s = msg.scrape_strategy ?? {};
  const limit = s.pagination_limit ?? 50;

  const url =
    s.mode === 'calendar'
      ? `${API}/calendar/get-items?calendar_api_id=${encodeURIComponent(s.calendar_api_id ?? '')}` +
        `&period=future&pagination_limit=${limit}`
      : `${API}/discover/get-paginated-events?period=future&pagination_limit=${limit}` +
        `&discover_place_api_id=${encodeURIComponent(s.place_api_id ?? '')}`;

  const data = await fetchJson<{ entries?: LumaEntry[] }>(url);

  return (data.entries ?? []).flatMap((entry) => {
    const e = entry.event;
    if (!e?.name) return [];
    const geo = e.geo_address_info ?? {};
    return [
      {
        title: e.name,
        start_time: e.start_at ?? null,
        end_time: e.end_at ?? null,
        timezone: e.timezone ?? null,
        venue: geo.address ?? null,
        location: joinLocation(geo.full_address ?? geo.address, geo.city, geo.region),
        // `url` on the payload is a bare slug, not an absolute URL.
        url: e.url ? `https://lu.ma/${e.url}` : null,
        external_id: e.api_id ?? null,
      } satisfies RawEvent,
    ];
  });
}
