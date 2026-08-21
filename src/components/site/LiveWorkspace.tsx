import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { supabase, supabaseConfigured } from "@/lib/supabase";
import { formatEventDate, formatEventTime, freshness, relativeTime } from "@/lib/format";
import { googleCalendarUrl } from "@/lib/calendar";
import { SignalBadge, TabBar, cx } from "@/components/site/Primitives";
import type { CompanyRow, DirectoryMember, EventRow } from "@/lib/database.types";

type Tab = "events" | "companies" | "people";

const TABS = [
  { key: "events" as const, label: "Events" },
  { key: "companies" as const, label: "Companies" },
  { key: "people" as const, label: "People" },
];

const PLACEHOLDER: Record<Tab, string> = {
  events: "Search upcoming DFW events — AI, pitch nights, hiring…",
  companies: "Search companies being built — fintech, robotics, health…",
  people: "Search members by name, headline, school, or skill",
};

const DEEP_LINK: Record<Tab, string> = {
  events: "/events",
  companies: "/companies",
  people: "/people",
};

/**
 * The home page's working surface: real rows from the live database, not a
 * mockup. Tabs switch between the three things the product actually does, and
 * every tab hands off to its full page with one click.
 *
 * Reads go straight to PostgREST from the browser — anon-key, RLS-guarded,
 * no Worker in the path.
 */
export function LiveWorkspace() {
  const [tab, setTab] = useState<Tab>("events");
  const [term, setTerm] = useState("");
  const search = term.trim();
  // PostgREST's or() takes a comma-separated filter list, so these characters
  // would otherwise be read as syntax rather than as part of the search text.
  const safe = search.replace(/[,()*]/g, " ");

  const events = useQuery({
    queryKey: ["home-events", safe],
    enabled: supabaseConfigured && tab === "events",
    queryFn: async () => {
      let q = supabase
        .from("events")
        .select("id,title,description,start_time,end_time,location,venue,url,keywords,status")
        .eq("status", "active")
        .gte("start_time", new Date().toISOString())
        .order("start_time", { ascending: true })
        .limit(6);
      if (safe) q = q.or(`title.ilike.%${safe}%,description.ilike.%${safe}%,venue.ilike.%${safe}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as EventRow[];
    },
  });

  const companies = useQuery({
    queryKey: ["home-companies", safe],
    enabled: supabaseConfigured && tab === "companies",
    queryFn: async () => {
      let q = supabase
        .from("companies")
        .select(
          "id,name,one_liner,description,stage,tags,website,hq_location,dfw,signal,signal_detail,signal_at,discovered_via,last_seen_at",
        )
        .order("signal_at", { ascending: false, nullsFirst: false })
        .limit(6);
      if (safe) q = q.or(`name.ilike.%${safe}%,one_liner.ilike.%${safe}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CompanyRow[];
    },
  });

  const people = useQuery({
    queryKey: ["home-people", safe],
    enabled: supabaseConfigured && tab === "people",
    queryFn: async (): Promise<DirectoryMember[]> => {
      const { data, error } = await supabase.rpc("member_directory", {
        p_search: safe || null,
        p_limit: 6,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const active = tab === "events" ? events : tab === "companies" ? companies : people;
  const rows = useMemo(() => active.data ?? [], [active.data]);

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-lift">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-secondary/40 p-4">
        <TabBar tabs={TABS} active={tab} onChange={setTab} />
        <Link
          to={DEEP_LINK[tab]}
          className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
        >
          Open {tab} →
        </Link>
      </div>

      <div className="p-5 sm:p-7">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={PLACEHOLDER[tab]}
          aria-label={PLACEHOLDER[tab]}
          className={cx.input}
        />

        <div className="mt-5">
          {!supabaseConfigured && (
            <Notice>
              Not connected. Set <code>VITE_SUPABASE_URL</code> and{" "}
              <code>VITE_SUPABASE_ANON_KEY</code> to see live data here.
            </Notice>
          )}

          {supabaseConfigured && active.isPending && (
            <div className="space-y-3" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-xl border border-border bg-muted/40"
                />
              ))}
            </div>
          )}

          {supabaseConfigured && active.error && (
            <Notice>
              {active.error instanceof Error ? active.error.message : "Query failed."}
            </Notice>
          )}

          {supabaseConfigured && !active.isPending && !active.error && rows.length === 0 && (
            <Notice>
              {search
                ? `Nothing matches “${search}” yet.`
                : tab === "people"
                  ? "No members have published a profile yet. Yours could be the first."
                  : "Nothing here yet."}
            </Notice>
          )}

          {supabaseConfigured && !active.isPending && !active.error && rows.length > 0 && (
            <div className="space-y-3">
              {tab === "events" &&
                (events.data ?? []).map((e) => <EventRowItem key={e.id} event={e} />)}
              {tab === "companies" &&
                (companies.data ?? []).map((c) => <CompanyRowItem key={c.id} company={c} />)}
              {tab === "people" &&
                (people.data ?? []).map((m) => <PersonRowItem key={m.id} member={m} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/40 px-5 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border p-4 transition-colors hover:bg-accent/50">
      {children}
    </div>
  );
}

function EventRowItem({ event }: { event: EventRow }) {
  const addToCalendar = googleCalendarUrl(event);
  return (
    <Row>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg">
          {event.url ? (
            <a
              href={event.url}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:underline"
            >
              {event.title}
            </a>
          ) : (
            event.title
          )}
        </h3>
        <span className="text-xs font-semibold tracking-[0.14em] text-ember">
          {formatEventDate(event.start_time)}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {[formatEventTime(event.start_time), event.venue ?? event.location]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {event.keywords.slice(0, 5).map((k) => (
          <span
            key={k}
            className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
          >
            {k}
          </span>
        ))}
        {addToCalendar && (
          <a
            href={addToCalendar}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto shrink-0 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent"
          >
            ＋ Google Calendar
          </a>
        )}
      </div>
    </Row>
  );
}

function CompanyRowItem({ company }: { company: CompanyRow }) {
  const fresh = freshness(company.last_seen_at ?? company.signal_at);
  return (
    <Row>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg">
          {company.website ? (
            <a
              href={company.website}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:underline"
            >
              {company.name}
            </a>
          ) : (
            company.name
          )}
        </h3>
        <SignalBadge signal={company.signal} />
      </div>
      {company.one_liner && (
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{company.one_liner}</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {[company.hq_location ?? "Location unknown", company.signal_detail, fresh.label]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </Row>
  );
}

function PersonRowItem({ member }: { member: DirectoryMember }) {
  return (
    <Row>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg">{member.display_name?.trim() || "Build Dallas member"}</h3>
        {member.shared_count > 0 && (
          <span className="rounded-full bg-ember px-2.5 py-1 text-[0.65rem] font-semibold tracking-[0.16em] text-ember-foreground">
            {member.shared_count} IN COMMON
          </span>
        )}
      </div>
      {member.headline && <p className="mt-1 text-sm text-muted-foreground">{member.headline}</p>}
      <p className="mt-2 text-xs text-muted-foreground">
        {[member.role_label, member.school, `joined ${relativeTime(member.created_at)}`]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </Row>
  );
}
