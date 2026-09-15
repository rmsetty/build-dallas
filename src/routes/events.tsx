import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/site/AppShell";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import type { EventRow } from "@/lib/database.types";
import { formatEventDate } from "@/lib/format";

export const Route = createFileRoute("/events")({
  head: () => ({ meta: [{ title: "Dallas Startup Events — Build Dallas" }] }),
  component: EventsPage,
});
function EventsPage() {
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["upcoming-events"],
    enabled: supabaseConfigured,
    queryFn: async (): Promise<EventRow[]> => {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .gte("start_time", new Date().toISOString())
        .order("start_time")
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  const events = useMemo(
    () =>
      (query.data ?? []).filter(
        (event) =>
          !search.trim() ||
          `${event.title} ${event.description ?? ""} ${event.location ?? ""}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [query.data, search],
  );
  return (
    <AppShell
      kicker="Across the ecosystem"
      title={
        <>
          What's happening <span className="text-primary">in Dallas.</span>
        </>
      }
      intro="Upcoming events from Build Dallas and startup communities across Dallas–Fort Worth. Each listing identifies who is hosting it."
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search events, topics, or locations"
          className="w-full max-w-xl rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-primary"
        />
        <div className="flex gap-2 text-xs">
          <span className="rounded-full bg-primary px-3 py-1.5 font-semibold text-primary-foreground">
            Build Dallas
          </span>
          <span className="rounded-full border border-border px-3 py-1.5 text-muted-foreground">
            Community event
          </span>
        </div>
      </div>
      {!supabaseConfigured || query.error ? (
        <div className="mt-10 rounded-3xl border border-border bg-card p-12 text-center">
          <h2 className="text-3xl">Events are being added now.</h2>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
            We're gathering upcoming founder, technology, investor, and community events from across
            DFW.
          </p>
          <Link
            to="/get-connected"
            className="mt-7 inline-flex rounded-full border border-border px-6 py-3 text-sm font-semibold hover:bg-accent"
          >
            Share an event
          </Link>
        </div>
      ) : (
        <div className="mt-10 grid gap-4">
          {events.map((event) => (
            <article
              key={event.id}
              className="grid gap-6 rounded-2xl border border-border bg-card p-6 transition hover:border-primary/50 md:grid-cols-[10rem_1fr_auto] md:items-center"
            >
              <div>
                <span className="kicker text-primary">Community event</span>
                <p className="mt-2 text-sm text-muted-foreground">
                  {event.start_time ? formatEventDate(event.start_time) : "Date coming soon"}
                </p>
              </div>
              <div>
                <h2 className="text-2xl">{event.title}</h2>
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                  {event.description ?? event.venue ?? event.location}
                </p>
              </div>
              {event.url && (
                <a
                  href={event.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-full border border-border px-5 py-2.5 text-center text-sm font-semibold hover:bg-accent"
                >
                  Event details ↗
                </a>
              )}
            </article>
          ))}
          {events.length === 0 && (
            <p className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
              No upcoming events match that search.
            </p>
          )}
        </div>
      )}
    </AppShell>
  );
}

export function EventCard({ event, highlight = false }: { event: EventRow; highlight?: boolean }) {
  return (
    <article
      className={`grid gap-5 rounded-2xl border bg-card p-6 transition hover:border-primary/50 md:grid-cols-[10rem_1fr_auto] md:items-center ${highlight ? "border-primary/50" : "border-border"}`}
    >
      <div>
        <span className="kicker text-primary">Community event</span>
        <p className="mt-2 text-sm text-muted-foreground">
          {event.start_time ? formatEventDate(event.start_time) : "Date coming soon"}
        </p>
      </div>
      <div>
        <h2 className="text-2xl">{event.title}</h2>
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
          {event.description ?? event.venue ?? event.location}
        </p>
      </div>
      {event.url && (
        <a
          href={event.url}
          target="_blank"
          rel="noreferrer noopener"
          className="rounded-full border border-border px-5 py-2.5 text-center text-sm font-semibold hover:bg-accent"
        >
          Event details ↗
        </a>
      )}
    </article>
  );
}
