import { fetchJson, firstString, joinLocation } from '../http.ts';
import type { RawEvent, SourceMessage } from '../types.ts';

interface LocalistEnvelope {
  events?: Array<{
    event?: {
      id?: number;
      title?: string;
      description_text?: string;
      description?: string;
      localist_url?: string;
      url?: string;
      location_name?: string;
      address?: string;
      room_number?: string;
      event_instances?: Array<{ event_instance?: { start?: string; end?: string } }>;
    };
  }>;
}

/**
 * UT Dallas and UNT both run Localist, which exposes a free, unauthenticated
 * JSON API at /api/2/events. Its `description_text` field is already
 * plain text, so no tag stripping and no LLM call.
 *
 * A university-wide calendar is mostly registration deadlines, so these sources
 * set require_keywords and let ingest_events drop anything that matches no
 * vocabulary term.
 */
export async function fetchLocalist(msg: SourceMessage): Promise<RawEvent[]> {
  const s = msg.scrape_strategy ?? {};
  const base = (s.api_base ?? msg.url).replace(/\/+$/, '');
  const url = `${base}/api/2/events?days=${s.days ?? 120}&pp=${s.pp ?? 100}`;

  const data = await fetchJson<LocalistEnvelope>(url);

  return (data.events ?? []).flatMap((wrapper) => {
    const e = wrapper.event;
    if (!e?.title) return [];
    const instance = e.event_instances?.[0]?.event_instance;
    return [
      {
        title: e.title,
        description: firstString(e.description_text, e.description),
        // Localist timestamps carry an offset.
        start_time: instance?.start ?? null,
        end_time: instance?.end ?? null,
        venue: e.location_name ?? null,
        location: joinLocation(e.address, e.room_number),
        url: firstString(e.localist_url, e.url),
        external_id: e.id != null ? String(e.id) : null,
      } satisfies RawEvent,
    ];
  });
}
