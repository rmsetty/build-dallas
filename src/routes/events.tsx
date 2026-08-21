import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/site/AppShell";
import {
  Chip,
  EmptyState,
  ErrorState,
  LoadingRows,
  Pagination,
  cx,
} from "@/components/site/Primitives";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { RankedEvent } from "@/lib/database.types";
import { formatEventDate, formatEventTime } from "@/lib/format";
import { googleCalendarUrl } from "@/lib/calendar";

export const Route = createFileRoute("/events")({
  head: () => ({
    meta: [
      { title: "Events — Build Dallas" },
      {
        name: "description",
        content:
          "Every upcoming startup and tech event across DFW, collected daily from Luma, Meetup, Eventbrite, universities, and local organizations.",
      },
    ],
  }),
  component: EventsPage,
});

const WINDOWS = [
  { key: "all", label: "Any time", days: null },
  { key: "7", label: "Next 7 days", days: 7 },
  { key: "30", label: "Next 30 days", days: 30 },
  { key: "90", label: "Next 90 days", days: 90 },
] as const;

type WindowKey = (typeof WINDOWS)[number]["key"];
type SortKey = "soonest" | "match";

const PAGE_SIZE = 20;

/**
 * Ceiling for the ranked branch. recommended_events() applies its own
 * LIMIT/OFFSET inside Postgres, and PostgREST filters run on whatever it
 * returns — so paging has to happen at the PostgREST layer, and this number
 * must stay comfortably above the number of active upcoming events for the
 * counts to be exact.
 */
const RANKED_CEILING = 2000;

function EventsPage() {
  const { user, loading: authLoading } = useAuth();

  const [windowKey, setWindowKey] = useState<WindowKey>("all");
  const [sort, setSort] = useState<SortKey>("soonest");
  const [search, setSearch] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  // Recomputed once per filter change rather than per render, so the query key
  // stays stable and react-query doesn't refetch on every keystroke elsewhere.
  const range = useMemo(() => {
    const days = WINDOWS.find((w) => w.key === windowKey)?.days ?? null;
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = days === null ? null : new Date(from.getTime() + days * 86_400_000);
    return { from: from.toISOString(), to: to?.toISOString() ?? null };
  }, [windowKey]);

  const rankable = Boolean(user) && sort === "match";

  const { data, isPending, error } = useQuery({
    queryKey: ["events", { ...range, tags, search: search.trim(), rankable, page }],
    // Auth has to settle first, otherwise the ranked call runs unauthenticated
    // and every score comes back 0.
    enabled: !authLoading,
    // Paging swaps the whole list; holding the previous page under the new one
    // keeps the layout from collapsing to a spinner on every click.
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<{ rows: RankedEvent[]; total: number }> => {
      const columns = "id,title,description,start_time,end_time,location,venue,url,keywords";
      const term = search.trim();

      // Both branches filter in PostgREST: `overlaps` rides the GIN index on
      // events.keywords, and the ranked branch is the Part 3 SQL function, so
      // scoring and sorting never leave Postgres.
      const query = rankable
        ? supabase.rpc(
            "recommended_events",
            { p_limit: RANKED_CEILING, p_from: range.from },
            { count: "exact" },
          )
        : supabase
            .from("events")
            .select(columns, { count: "exact" })
            .eq("status", "active")
            .gte("start_time", range.from)
            .order("start_time", { ascending: true });

      if (range.to) query.lte("start_time", range.to);
      if (tags.length) query.overlaps("keywords", tags);
      if (term) {
        const safe = term.replace(/[,()*]/g, " ");
        query.or(`title.ilike.%${safe}%,description.ilike.%${safe}%,venue.ilike.%${safe}%`);
      }

      // One page over the wire instead of the whole board.
      const from = (page - 1) * PAGE_SIZE;
      query.range(from, from + PAGE_SIZE - 1);

      const { data, error, count } = await query;
      if (error) throw error;

      // The plain-table branch has no score columns; default them so one card
      // component renders both shapes.
      const rows = (data ?? []).map((row) => {
        const event = row as RankedEvent;
        return {
          ...event,
          match_score: event.match_score ?? 0,
          matched_terms: event.matched_terms ?? [],
        };
      });
      return { rows, total: count ?? rows.length };
    },
  });

  const events = useMemo(() => data?.rows ?? [], [data]);
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /**
   * Tag chips have to describe the whole filtered board, not the 20 rows on
   * screen — otherwise the available filters would change under you as you
   * page. This asks for the keyword column only, so it stays cheap.
   */
  const facets = useQuery({
    queryKey: ["event-facets", { ...range, search: search.trim() }],
    enabled: !authLoading,
    staleTime: 60_000,
    queryFn: async (): Promise<string[][]> => {
      const term = search.trim();
      const query = supabase
        .from("events")
        .select("keywords")
        .eq("status", "active")
        .gte("start_time", range.from)
        .limit(RANKED_CEILING);
      if (range.to) query.lte("start_time", range.to);
      if (term) {
        const safe = term.replace(/[,()*]/g, " ");
        query.or(`title.ilike.%${safe}%,description.ilike.%${safe}%,venue.ilike.%${safe}%`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((r) => r.keywords ?? []);
    },
  });

  // Any filter change invalidates the current page number.
  const resetPage = () => setPage(1);

  // Tag chips reflect what's actually on the board right now — a filter that
  // can only ever return zero results isn't worth showing.
  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const keywords of facets.data ?? [])
      for (const k of keywords) counts.set(k, (counts.get(k) ?? 0) + 1);
    for (const t of tags) if (!counts.has(t)) counts.set(t, 0);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 24);
  }, [facets.data, tags]);

  const toggleTag = (tag: string) => {
    resetPage();
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  return (
    <AppShell
      kicker="Live from the ecosystem"
      title={
        <>
          What's happening in DFW
          <br />
          <span className="text-primary">this month.</span>
        </>
      }
      intro="Collected once a day from Luma, Meetup, Eventbrite, university centers, and local organizations. No duplicates, no dead calendars."
    >
      <div className="space-y-6">
        {/* Filters */}
        <div className={`${cx.card} space-y-4`}>
          <div className="flex flex-wrap gap-3">
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                resetPage();
              }}
              placeholder="⌕  Search events, venues, or topics"
              aria-label="Search events"
              className={`min-w-[16rem] flex-1 ${cx.input}`}
            />
            <select
              value={windowKey}
              onChange={(e) => {
                setWindowKey(e.target.value as WindowKey);
                resetPage();
              }}
              aria-label="Date range"
              className={cx.select}
            >
              {WINDOWS.map((w) => (
                <option key={w.key} value={w.key}>
                  {w.label}
                </option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as SortKey);
                resetPage();
              }}
              aria-label="Sort order"
              className={cx.select}
              disabled={!user}
              title={user ? undefined : "Sign in and add a profile to rank by keyword match"}
            >
              <option value="soonest">Soonest first</option>
              <option value="match">Best match for me</option>
            </select>
          </div>

          {availableTags.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              {availableTags.map(([tag, count]) => (
                <Chip
                  key={tag}
                  active={tags.includes(tag)}
                  onClick={() => toggleTag(tag)}
                  title={`${count} event${count === 1 ? "" : "s"}`}
                >
                  {tag}
                </Chip>
              ))}
              {tags.length > 0 && (
                <button
                  onClick={() => {
                    setTags([]);
                    resetPage();
                  }}
                  className="px-2 py-1.5 text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {!user && !authLoading && (
            <p className="border-t border-border pt-4 text-sm text-muted-foreground">
              <Link
                to="/login"
                search={{ redirect: "/profile" }}
                className="font-medium text-primary hover:underline"
              >
                Sign in and add your resume
              </Link>{" "}
              to rank this list by how well each event matches your background.
            </p>
          )}
        </div>

        {/* Results */}
        {error ? (
          <ErrorState error={error} />
        ) : isPending ? (
          <LoadingRows />
        ) : events.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            body={
              tags.length || search.trim() || windowKey !== "all"
                ? "No events match these filters. Try widening the date range or clearing tags."
                : "The discovery pipeline hasn't landed any upcoming events for this window yet. It runs daily at 12:00 UTC."
            }
            action={
              tags.length || search.trim() ? (
                <button
                  onClick={() => {
                    setTags([]);
                    setSearch("");
                    setWindowKey("all");
                    resetPage();
                  }}
                  className={cx.secondary}
                >
                  Clear filters
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {total} event{total === 1 ? "" : "s"}
              {rankable ? " ranked by keyword overlap with your profile" : " sorted by date"}
              {pageCount > 1 && ` · page ${page} of ${pageCount}`}
            </p>
            <div className="space-y-4">
              {events.map((event) => (
                <EventCard key={event.id} event={event} highlight={rankable} />
              ))}
            </div>
            <Pagination
              page={page}
              pageCount={pageCount}
              label="events"
              onChange={(next) => {
                setPage(next);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}

export function EventCard({ event, highlight }: { event: RankedEvent; highlight?: boolean }) {
  const matched = new Set(event.matched_terms ?? []);
  const time = formatEventTime(event.start_time);
  // Null when the listing has no usable start time — hide the control rather
  // than hand someone a calendar entry with the wrong date on it.
  const addToCalendar = googleCalendarUrl(event);

  return (
    <article className="grid gap-6 rounded-2xl border border-border bg-card p-6 shadow-soft transition-transform hover:-translate-y-0.5 md:grid-cols-[8rem_1fr]">
      <div className="border-border md:border-r md:pr-6">
        <div className="kicker text-ember">{formatEventDate(event.start_time)}</div>
        {time && <div className="mt-1 font-display text-2xl">{time}</div>}
        {highlight && event.match_score > 0 && (
          <div className="mt-3 inline-flex rounded-full bg-ember px-2.5 py-1 text-[0.65rem] font-bold tracking-[0.16em] text-ember-foreground">
            {event.match_score} MATCH{event.match_score === 1 ? "" : "ES"}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-2xl leading-snug">{event.title}</h3>
        {(event.venue || event.location) && (
          <p className="mt-1 text-sm text-muted-foreground">
            {[event.venue, event.location].filter(Boolean).join(" · ")}
          </p>
        )}
        {event.description && (
          <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{event.description}</p>
        )}

        {event.keywords?.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {event.keywords.slice(0, 10).map((k) => (
              <span
                key={k}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                  matched.has(k)
                    ? "bg-ember text-ember-foreground"
                    : "border border-border bg-card text-muted-foreground"
                }`}
              >
                {k}
              </span>
            ))}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-5 text-sm">
          {event.url && (
            <a
              href={event.url}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-primary hover:underline"
            >
              View event ↗
            </a>
          )}
          {addToCalendar && (
            <a
              href={addToCalendar}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
            >
              <span aria-hidden>＋</span> Add to Google Calendar
            </a>
          )}
          <Link
            to="/wiki/$entityType/$entityId"
            params={{ entityType: "event", entityId: event.id }}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Suggest an edit
          </Link>
        </div>
      </div>
    </article>
  );
}
