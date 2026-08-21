const DALLAS_TZ = "America/Chicago";

const dayFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: DALLAS_TZ,
});

const timeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: DALLAS_TZ,
});

/** Events are stored as timestamptz; the ecosystem lives in one timezone. */
export function formatEventDate(iso: string | null): string {
  if (!iso) return "Date TBA";
  return dayFmt.format(new Date(iso));
}

export function formatEventTime(iso: string | null): string | null {
  if (!iso) return null;
  return timeFmt.format(new Date(iso));
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const t = formatEventTime(iso);
  return t ? `${formatEventDate(iso)} · ${t}` : formatEventDate(iso);
}

/** "3d ago" — used for the company freshness indicator. */
export function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

/**
 * Freshness buckets for the /companies "last seen" indicator. Colour comes from
 * the existing palette only — ember for live, muted as it ages.
 */
export function freshness(iso: string | null): {
  label: string;
  tone: "live" | "recent" | "stale" | "unknown";
} {
  if (!iso) return { label: "Not seen yet", tone: "unknown" };
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  const label = relativeTime(iso) ?? "unknown";
  if (days <= 14) return { label, tone: "live" };
  if (days <= 90) return { label, tone: "recent" };
  return { label, tone: "stale" };
}

export function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .map((w) => (w.length <= 1 ? w.toUpperCase() : `${w.charAt(0).toUpperCase()}${w.slice(1)}`))
    .join(" ");
}
