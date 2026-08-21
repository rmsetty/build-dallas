import { BROWSER_HEADERS } from '../http.ts';
import type { RawEvent, SourceMessage } from '../types.ts';

/**
 * Generic iCalendar (.ics) reader.
 *
 * Worth having as its own platform because .ics is the lowest common
 * denominator: Meetup, Google Calendar, The Events Calendar, Localist and most
 * university and chamber calendars all publish one. Any site that does becomes
 * a structured source for free.
 */

/** RFC 5545 folds long lines by starting continuations with a space or tab. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Prop {
  value: string;
  params: Record<string, string>;
}

function parseLine(line: string): { name: string; prop: Prop } | null {
  const colon = line.indexOf(':');
  if (colon < 0) return null;

  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [rawName, ...paramParts] = left.split(';');
  if (!rawName) return null;

  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
  }

  return { name: rawName.toUpperCase(), prop: { value, params } };
}

/**
 * Converts an iCal date-time to an ISO string plus, when the value is local
 * wall-clock time, the zone it belongs to. Postgres does the actual instant
 * resolution, so we never need a timezone database here.
 *
 *   20260902T180000Z             -> 2026-09-02T18:00:00Z   (already an instant)
 *   TZID=America/Chicago:2026... -> 2026-09-02T18:00:00 + zone
 *   20260902                     -> 2026-09-02             (all-day)
 */
export function icalDate(prop: Prop | undefined): { iso: string | null; tz: string | null } {
  if (!prop?.value) return { iso: null, tz: null };
  const v = prop.value.trim();
  const tz = prop.params['TZID'] ?? null;

  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly) return { iso: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`, tz };

  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!dt) return { iso: null, tz: null };

  const iso = `${dt[1]}-${dt[2]}-${dt[3]}T${dt[4]}:${dt[5]}:${dt[6]}${dt[7] ? 'Z' : ''}`;
  return { iso, tz: dt[7] ? null : tz };
}

export async function fetchIcal(msg: SourceMessage): Promise<RawEvent[]> {
  const s = msg.scrape_strategy ?? {};
  // webcal:// is just https:// with a different scheme registered to a client.
  const url = (s.feed_url ?? msg.url).replace(/^webcal:\/\//i, 'https://');

  const res = await fetch(url, { headers: { ...BROWSER_HEADERS, Accept: 'text/calendar,*/*' } });
  if (!res.ok) throw new Error(`ical ${url} -> ${res.status}`);
  const body = await res.text();

  if (!body.includes('BEGIN:VCALENDAR')) {
    throw new Error(`ical ${url} did not return a calendar (got ${body.slice(0, 40)}...)`);
  }

  const out: RawEvent[] = [];
  let current: Record<string, Prop> | null = null;

  for (const line of unfold(body)) {
    if (line.startsWith('BEGIN:VEVENT')) {
      current = {};
      continue;
    }
    if (line.startsWith('END:VEVENT')) {
      if (current) out.push(toRawEvent(current));
      current = null;
      continue;
    }
    if (!current) continue;

    const parsed = parseLine(line);
    // First occurrence wins, so RECURRENCE-ID overrides don't clobber the base.
    if (parsed && !(parsed.name in current)) current[parsed.name] = parsed.prop;
  }

  return out.filter((e) => e.title);
}

function toRawEvent(props: Record<string, Prop>): RawEvent {
  const start = icalDate(props['DTSTART']);
  const end = icalDate(props['DTEND']);
  const locationProp = props['LOCATION'];
  const location = locationProp ? unescapeText(locationProp.value) : null;

  return {
    title: props['SUMMARY'] ? unescapeText(props['SUMMARY'].value) : '',
    description: props['DESCRIPTION'] ? unescapeText(props['DESCRIPTION'].value) : null,
    start_time: start.iso,
    end_time: end.iso,
    timezone: start.tz,
    location,
    // .ics has one free-text LOCATION; treat its first segment as the venue.
    venue: location ? (location.split(',')[0]?.trim() ?? null) : null,
    url: props['URL']?.value?.trim() || null,
    external_id: props['UID']?.value?.trim() || null,
    cancelled: (props['STATUS']?.value ?? '').toUpperCase() === 'CANCELLED',
  };
}
