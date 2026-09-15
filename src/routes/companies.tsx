import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/site/AppShell";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import type { CompanyRow } from "@/lib/database.types";
import { titleCase } from "@/lib/format";

export const Route = createFileRoute("/companies")({
  head: () => ({
    meta: [
      { title: "Companies Building in Dallas — Build Dallas" },
      {
        name: "description",
        content: "Discover startups and emerging companies being built across Dallas-Fort Worth.",
      },
    ],
  }),
  component: CompaniesPage,
});
const stages = ["idea", "pre-seed", "seed", "series-a", "growth", "bootstrapped"];
const inputClass =
  "rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-primary";

function CompaniesPage() {
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [industry, setIndustry] = useState("");
  const [area, setArea] = useState("");
  const [selected, setSelected] = useState<CompanyRow | null>(null);
  const query = useQuery({
    queryKey: ["companies-directory"],
    enabled: supabaseConfigured,
    queryFn: async (): Promise<CompanyRow[]> => {
      const { data, error } = await supabase.from("companies").select("*").order("name").limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });
  const industries = useMemo(
    () =>
      [...new Set((query.data ?? []).flatMap((company) => company.tags ?? []))].sort().slice(0, 30),
    [query.data],
  );
  const companies = useMemo(
    () =>
      (query.data ?? []).filter((company) => {
        const term = search.trim().toLowerCase();
        const matchesSearch =
          !term ||
          company.name.toLowerCase().includes(term) ||
          company.one_liner?.toLowerCase().includes(term);
        const matchesStage = !stage || company.stage === stage;
        const matchesIndustry = !industry || company.tags?.includes(industry);
        const matchesArea =
          !area || company.hq_location?.toLowerCase().includes(area.toLowerCase());
        return matchesSearch && matchesStage && matchesIndustry && matchesArea;
      }),
    [query.data, search, stage, industry, area],
  );
  return (
    <AppShell
      kicker="Dallas–Fort Worth"
      title={
        <>
          Companies Building <span className="text-primary">in Dallas</span>
        </>
      }
      intro="Discover startups and emerging companies being built across Dallas–Fort Worth."
      actions={
        <Link
          to="/get-connected"
          className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
        >
          Submit Your Company
        </Link>
      }
    >
      <div className="grid gap-4 rounded-2xl border border-border bg-card/50 p-4 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search companies"
          className={inputClass}
        />
        <select
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          className={inputClass}
          aria-label="Industry"
        >
          <option value="">All industries</option>
          {industries.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className={inputClass}
          aria-label="Stage"
        >
          <option value="">All stages</option>
          {stages.map((item) => (
            <option key={item} value={item}>
              {titleCase(item)}
            </option>
          ))}
        </select>
        <input
          value={area}
          onChange={(e) => setArea(e.target.value)}
          placeholder="City / area"
          className={inputClass}
        />
      </div>
      {!supabaseConfigured || query.error ? (
        <DirectoryEmpty />
      ) : query.isPending ? (
        <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-2xl bg-card" />
          ))}
        </div>
      ) : companies.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-border p-14 text-center">
          <h2 className="text-2xl">No companies match those filters.</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Try a broader search or clear one of the filters.
          </p>
        </div>
      ) : (
        <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {companies.map((company) => (
            <button
              key={company.id}
              type="button"
              onClick={() => setSelected(company)}
              className="group flex min-h-44 flex-col items-center justify-center rounded-2xl border border-border bg-card p-6 text-center transition hover:-translate-y-1 hover:border-primary/60 hover:shadow-lift"
            >
              {company.logo_url ? (
                <img
                  src={company.logo_url}
                  alt=""
                  className="max-h-16 max-w-[10rem] object-contain"
                />
              ) : (
                <span className="grid h-16 w-16 place-items-center rounded-2xl bg-secondary font-display text-2xl text-primary">
                  {company.name.slice(0, 2).toUpperCase()}
                </span>
              )}
              <span className="mt-5 font-semibold">{company.name}</span>
              <span className="mt-1 text-xs text-muted-foreground">
                {company.hq_location ?? "Dallas–Fort Worth"}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-16 flex flex-wrap items-center justify-between gap-5 rounded-3xl border border-border bg-secondary/40 p-8">
        <div>
          <span className="kicker text-primary">Join the directory</span>
          <h2 className="mt-2 text-3xl">Building in Dallas?</h2>
        </div>
        <Link
          to="/get-connected"
          className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
        >
          Submit Your Company
        </Link>
      </div>
      {selected && <CompanyDialog company={selected} onClose={() => setSelected(null)} />}
    </AppShell>
  );
}

function DirectoryEmpty() {
  return (
    <div className="mt-10 grid gap-6 rounded-3xl border border-border bg-card p-9 text-center sm:p-14">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary/15 font-display text-2xl text-primary">
        BD
      </div>
      <div>
        <h2 className="text-3xl">The directory is being curated.</h2>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
          We're bringing together companies building across DFW. If your startup belongs here,
          introduce yourself.
        </p>
      </div>
      <Link
        to="/get-connected"
        className="mx-auto rounded-full border border-border px-6 py-3 text-sm font-semibold hover:bg-accent"
      >
        Submit Your Company
      </Link>
    </div>
  );
}

function CompanyDialog({ company, onClose }: { company: CompanyRow; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-background/80 p-5 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={company.name}
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <article className="w-full max-w-xl rounded-3xl border border-border bg-card p-7 shadow-lift sm:p-9">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-5">
            {company.logo_url ? (
              <img src={company.logo_url} alt="" className="h-16 w-16 rounded-xl object-contain" />
            ) : (
              <span className="grid h-16 w-16 place-items-center rounded-2xl bg-secondary font-display text-2xl text-primary">
                {company.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <div>
              <h2 className="text-3xl">{company.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {company.hq_location ?? "Dallas–Fort Worth"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <p className="mt-7 leading-relaxed text-muted-foreground">
          {company.one_liner ?? company.description ?? "Company information is coming soon."}
        </p>
        <dl className="mt-7 grid grid-cols-2 gap-5 border-y border-border py-6 text-sm">
          <div>
            <dt className="text-muted-foreground">Industry</dt>
            <dd className="mt-1 font-medium">{company.tags?.[0] ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Stage</dt>
            <dd className="mt-1 font-medium">
              {company.stage && company.stage !== "unknown" ? titleCase(company.stage) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Location</dt>
            <dd className="mt-1 font-medium">{company.hq_location ?? "Dallas–Fort Worth"}</dd>
          </div>
        </dl>
        {company.website && (
          <a
            href={company.website}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-7 inline-flex rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
          >
            Visit website ↗
          </a>
        )}
      </article>
    </div>
  );
}
