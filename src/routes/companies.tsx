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
  SignalBadge,
  TabBar,
  cx,
} from "@/components/site/Primitives";
import { supabase } from "@/lib/supabase";
import type { CompanyRow, CompanySignal } from "@/lib/database.types";
import { freshness, titleCase } from "@/lib/format";

export const Route = createFileRoute("/companies")({
  head: () => ({
    meta: [
      { title: "Companies — Build Dallas" },
      {
        name: "description",
        content:
          "A living directory of the companies being built across North Texas, with a freshness signal showing when each was last seen in the ecosystem.",
      },
    ],
  }),
  component: CompaniesPage,
});

const STAGES = [
  "idea",
  "pre-seed",
  "seed",
  "series-a",
  "series-b",
  "series-c-plus",
  "growth",
  "bootstrapped",
  "acquired",
  "public",
  "unknown",
] as const;

type SortKey = "signal" | "fresh" | "name" | "new";

/**
 * Region scope. Most sources publish no address at all, so "unknown" is a real
 * answer rather than a bug — folding it into the DFW view would overstate what
 * we actually know, and hiding it would throw away most of the directory.
 */
type Scope = "dfw" | "all";

const SCOPES = [
  { key: "dfw" as const, label: "DFW only" },
  { key: "all" as const, label: "All Texas" },
];

const PAGE_SIZE = 24;

/** Upper bound for the tag-facet probe. Comfortably above the table size. */
const FACET_CEILING = 3000;

/** Human labels for company_sources.slug, used to show provenance on a card. */
const SOURCE_LABELS: Record<string, string> = {
  "sec-form-d": "SEC Form D",
  "capital-factory": "Capital Factory",
  "yc-texas": "Y Combinator",
  "health-wildcatters": "Health Wildcatters",
  events: "DFW events",
};

function CompaniesPage() {
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<string>("");
  const [tags, setTags] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>("signal");
  const [scope, setScope] = useState<Scope>("all");
  const [signal, setSignal] = useState<CompanySignal | "">("");
  const [page, setPage] = useState(1);

  // Any filter change invalidates the current page number.
  const resetPage = () => setPage(1);

  const { data, isPending, error } = useQuery({
    queryKey: ["companies", { search: search.trim(), stage, tags, sort, scope, signal, page }],
    // Paging swaps the whole grid; holding the previous page under the new one
    // keeps the layout from collapsing to a spinner on every click.
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<{ rows: CompanyRow[]; total: number }> => {
      const query = supabase.from("companies").select("*", { count: "exact" });

      const term = search.trim();
      if (term) {
        const safe = term.replace(/[,()*]/g, " ");
        query.or(`name.ilike.%${safe}%,one_liner.ilike.%${safe}%,description.ilike.%${safe}%`);
      }
      if (stage) query.eq("stage", stage);
      if (signal) query.eq("signal", signal);
      if (tags.length) query.overlaps("tags", tags);
      // `dfw` is a stored generated column, so this is an index scan, not a
      // string match run over every row.
      if (scope === "dfw") query.eq("dfw", true);

      // The point of the directory is "who is active", not "who exists", so the
      // default order is by the freshest piece of evidence we hold.
      // nullsFirst:false keeps never-seen companies last.
      if (sort === "signal") query.order("signal_at", { ascending: false, nullsFirst: false });
      else if (sort === "fresh")
        query.order("last_seen_at", { ascending: false, nullsFirst: false });
      else if (sort === "new") query.order("first_seen_at", { ascending: false });
      else query.order("name", { ascending: true });

      // Name is the tiebreaker on every sort: signal_at and last_seen_at have
      // large ties, and without a stable second key Postgres is free to return
      // the same company on two different pages.
      if (sort !== "name") query.order("name", { ascending: true });

      // One page over the wire instead of the whole 1,000-row directory.
      const from = (page - 1) * PAGE_SIZE;
      query.range(from, from + PAGE_SIZE - 1);

      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data ?? [], total: count ?? (data ?? []).length };
    },
  });

  const companies = useMemo(() => data?.rows ?? [], [data]);
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /**
   * Tag chips describe the whole filtered directory, not the 24 cards on
   * screen — otherwise the available filters would shift under you as you page.
   * Selecting only the tags column keeps this cheap.
   */
  const facets = useQuery({
    queryKey: ["company-facets", { search: search.trim(), stage, scope, signal }],
    staleTime: 60_000,
    queryFn: async (): Promise<string[][]> => {
      const query = supabase.from("companies").select("tags").limit(FACET_CEILING);
      const term = search.trim();
      if (term) {
        const safe = term.replace(/[,()*]/g, " ");
        query.or(`name.ilike.%${safe}%,one_liner.ilike.%${safe}%,description.ilike.%${safe}%`);
      }
      if (stage) query.eq("stage", stage);
      if (signal) query.eq("signal", signal);
      if (scope === "dfw") query.eq("dfw", true);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((r) => r.tags ?? []);
    },
  });

  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const rowTags of facets.data ?? [])
      for (const t of rowTags) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const t of tags) if (!counts.has(t)) counts.set(t, 0);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 20);
  }, [facets.data, tags]);

  const toggleTag = (tag: string) => {
    resetPage();
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  return (
    <AppShell
      kicker="The directory"
      title={
        <>
          Companies being built
          <br />
          <span className="text-primary">across North Texas.</span>
        </>
      }
      intro="Assembled from SEC exempt-offering filings, Texas accelerator and venture portfolios, the Y Combinator directory, and the companies named at DFW events — each card showing what tells us the company is live right now."
    >
      <div className="space-y-6">
        <div className={`${cx.card} space-y-4`}>
          <div className="flex flex-wrap items-center gap-3">
            <TabBar
              tabs={SCOPES}
              active={scope}
              onChange={(next) => {
                setScope(next);
                resetPage();
              }}
              size="sm"
            />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                resetPage();
              }}
              placeholder="⌕  Search companies"
              aria-label="Search companies"
              className={`min-w-[16rem] flex-1 ${cx.input}`}
            />
            <select
              value={stage}
              onChange={(e) => {
                setStage(e.target.value);
                resetPage();
              }}
              aria-label="Stage"
              className={cx.select}
            >
              <option value="">All stages</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </select>
            <select
              value={signal}
              onChange={(e) => {
                setSignal(e.target.value as CompanySignal | "");
                resetPage();
              }}
              aria-label="Activity signal"
              className={cx.select}
            >
              <option value="">Any signal</option>
              <option value="raising">Raising now</option>
              <option value="event_active">Active at DFW events</option>
              <option value="accelerator">In an accelerator</option>
              <option value="yc">Y Combinator</option>
              <option value="portfolio">Venture backed</option>
            </select>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as SortKey);
                resetPage();
              }}
              aria-label="Sort order"
              className={cx.select}
            >
              <option value="signal">Freshest signal</option>
              <option value="fresh">Most recently seen</option>
              <option value="new">Newest to the directory</option>
              <option value="name">A–Z</option>
            </select>
          </div>

          {availableTags.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              {availableTags.map(([tag, count]) => (
                <Chip
                  key={tag}
                  active={tags.includes(tag)}
                  onClick={() => toggleTag(tag)}
                  title={`${count} compan${count === 1 ? "y" : "ies"}`}
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
        </div>

        {error ? (
          <ErrorState error={error} />
        ) : isPending ? (
          <LoadingRows />
        ) : companies.length === 0 ? (
          <EmptyState
            title="No companies yet"
            body={
              search.trim() || stage || tags.length || signal || scope === "dfw"
                ? "Nothing matches those filters. Try widening the scope to all of Texas, or clearing the signal filter."
                : "Companies arrive from the discovery pipeline. Run `npm run companies` in workers/ to populate the directory."
            }
            action={
              <Link to="/events" className={cx.secondary}>
                Browse events instead
              </Link>
            }
          />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {total.toLocaleString()} compan{total === 1 ? "y" : "ies"}
              {pageCount > 1 && ` · page ${page} of ${pageCount}`}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {companies.map((company) => (
                <CompanyCard key={company.id} company={company} />
              ))}
            </div>
            <Pagination
              page={page}
              pageCount={pageCount}
              label="companies"
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

function CompanyCard({ company }: { company: CompanyRow }) {
  // Prefer the signal date: it is the date of the evidence (the filing, the
  // event) rather than the date we happened to crawl.
  const fresh = freshness(company.signal_at ?? company.last_seen_at);
  const dot =
    fresh.tone === "live"
      ? "bg-ember"
      : fresh.tone === "recent"
        ? "bg-primary"
        : "bg-muted-foreground/50";

  const sources = (company.discovered_via ?? []).map((slug) => SOURCE_LABELS[slug] ?? slug);

  return (
    <article className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-soft transition-transform hover:-translate-y-1">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-2xl leading-snug">{company.name}</h3>
          <span className="kicker mt-1 block text-muted-foreground">
            {[
              company.stage && company.stage !== "unknown" ? titleCase(company.stage) : null,
              company.hq_location ?? "Location unknown",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium">
          <span
            className={`h-2 w-2 rounded-full ${fresh.tone === "live" ? "animate-pulse" : ""} ${dot}`}
          />
          {fresh.label}
        </span>
      </div>

      {/* Why we think this company is live — the reason the card exists. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <SignalBadge signal={company.signal} />
        {company.signal_detail && (
          <span className="text-xs text-muted-foreground">{company.signal_detail}</span>
        )}
      </div>

      {(company.one_liner ?? company.description) && (
        <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">
          {company.one_liner ?? company.description}
        </p>
      )}

      {company.tags?.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {company.tags.slice(0, 6).map((t) => (
            <span
              key={t}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {sources.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          {/* Two independent directories agreeing is a meaningfully stronger
              record than one, so say so rather than just listing them. */}
          {sources.length > 1 ? "Confirmed by " : "Found via "}
          {sources.join(", ")}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-5 pt-5 text-sm">
        {company.website && (
          <a
            href={company.website}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-primary hover:underline"
          >
            Website ↗
          </a>
        )}
        <Link
          to="/wiki/$entityType/$entityId"
          params={{ entityType: "company", entityId: company.id }}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Suggest an edit
        </Link>
        {company.verified_by && (
          <span className="ml-auto text-xs text-muted-foreground">✓ Owner verified</span>
        )}
      </div>
    </article>
  );
}
