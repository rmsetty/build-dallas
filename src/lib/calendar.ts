const GOOGLE_CALENDAR = "https://calendar.google.com/calendar/render";

/** Google's TEMPLATE format wants basic-form UTC: 20260821T054602Z */
function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]|\.\d{3}/g, "");
}

export type CalendarEvent = {
  title: string;
  description?: string | null;
  start_time: string | null;
  end_time?: string | null;
  location?: string | null;
  venue?: string | null;
  url?: string | null;
};

/**
 * A prefilled "add to Google Calendar" link.
 *
 * Deliberately a plain link rather than a Calendar API integration: it needs no
 * OAuth scope, no token storage, and no backend — the user stays in control and
 * sees exactly what is being added before saving it.
 *
 * Returns null when the event has no usable start time, so the caller can hide
 * the control instead of offering a broken one.
 */
export function googleCalendarUrl(event: CalendarEvent): string | null {
  if (!event.start_time) return null;

  const start = new Date(event.start_time);
  if (Number.isNaN(start.getTime())) return null;

  const parsedEnd = event.end_time ? new Date(event.end_time) : null;
  const end =
    parsedEnd && !Number.isNaN(parsedEnd.getTime()) && parsedEnd > start
      ? parsedEnd
      : // Most scraped listings carry no end time. Two hours is the usual
        // length of a meetup and is easy for the user to adjust in Google.
        new Date(start.getTime() + 2 * 60 * 60 * 1000);

  const details = [
    event.description?.trim().slice(0, 900),
    event.url ? `Event page: ${event.url}` : null,
    "Added from Build Dallas — builddallas.org",
  ]
    .filter(Boolean)
    .join("\n\n");

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    // Both stamps are UTC-suffixed, so no ctz parameter — passing one as well
    // makes Google reinterpret the times in that zone and shift the event.
    dates: `${stamp(start)}/${stamp(end)}`,
    details,
  });

  const where = [event.venue, event.location].filter(Boolean).join(", ");
  if (where) params.set("location", where);

  return `${GOOGLE_CALENDAR}?${params.toString()}`;
}
