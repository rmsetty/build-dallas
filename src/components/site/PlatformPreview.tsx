import { useState } from "react";

type PanelKey = "events" | "match" | "companies" | "graph" | "research" | "health";

const tabs: { key: PanelKey; icon: string; label: string; title: string }[] = [
  { key: "events", icon: "↗", label: "Discover", title: "Discover DFW" },
  { key: "match", icon: "◎", label: "Match", title: "Personal game plan" },
  { key: "companies", icon: "◫", label: "Companies", title: "Companies being built" },
  { key: "graph", icon: "⌘", label: "Graph", title: "Warm-intro paths" },
  { key: "research", icon: "⌁", label: "Research", title: "Research to company" },
  { key: "health", icon: "◌", label: "Ecosystem", title: "Ecosystem health" },
];

const Soon = () => (
  <span className="inline-flex rounded-full bg-ember/15 px-2.5 py-1 text-[0.65rem] font-semibold tracking-[0.16em] text-ember-foreground">
    COMING SOON
  </span>
);

export function PlatformPreview({ onNotice }: { onNotice: (msg: string) => void }) {
  const [active, setActive] = useState<PanelKey>("events");
  const current = tabs.find((t) => t.key === active)!;

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-lift md:grid md:grid-cols-[220px_1fr]">
      <aside className="flex flex-col gap-1 border-b border-border bg-secondary/60 p-4 md:border-b-0 md:border-r">
        <div className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                active === t.key
                  ? "bg-ink text-ink-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <span aria-hidden>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
        <div className="mt-4 hidden rounded-lg border border-dashed border-border px-3 py-2 text-[0.65rem] font-semibold tracking-[0.18em] text-muted-foreground md:block">
          PREVIEW MODE
        </div>
      </aside>

      <div className="p-5 sm:p-7">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <span className="kicker text-muted-foreground">Build Dallas Intelligence</span>
            <strong className="block font-display text-xl font-normal">{current.title}</strong>
          </div>
          <button
            onClick={() => onNotice("Accounts and live alerts are coming in a later build.")}
            className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-accent"
          >
            Follow activity
          </button>
        </div>

        {active === "events" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <div className="flex-1 rounded-xl border border-border bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
                ⌕ Search events, founders, companies, or topics
              </div>
              <button
                onClick={() => onNotice("Event ingestion from Luma, Eventbrite and more is planned.")}
                className="rounded-xl bg-ink px-4 py-3 text-sm font-medium text-ink-foreground"
              >
                Sync sources
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <article className="surface-ink md:col-span-2 rounded-2xl p-6">
                <div className="mb-3 flex items-center justify-between text-[0.65rem] font-semibold tracking-[0.18em] opacity-80">
                  <span>FEATURED</span>
                  <span>AUG 7</span>
                </div>
                <h3 className="text-2xl">Dallas Startup Week Happy Hour</h3>
                <p className="mt-2 text-sm opacity-80">
                  Founders, builders, investors, creatives, and operators connecting across DFW.
                </p>
                <div className="mt-5 flex flex-wrap gap-2 text-xs opacity-90">
                  {["Plano", "258 went", "Build Dallas launch"].map((m) => (
                    <span key={m} className="rounded-full border border-white/20 px-3 py-1">
                      {m}
                    </span>
                  ))}
                </div>
              </article>
              {[
                {
                  h: "Personalized event recommendations",
                  p: "Upload LinkedIn or a resume to rank which events are worth your time.",
                  b: "Upload profile",
                  t: "Profile ingestion arrives with the matching backend.",
                },
                {
                  h: "Who should you meet?",
                  p: "Rank attendees by relevance and show the best warm-intro path.",
                  b: "Preview matches",
                  t: "Participant matching is a planned tool feature.",
                },
              ].map((c) => (
                <article key={c.h} className="rounded-2xl border border-border p-5">
                  <Soon />
                  <h3 className="mt-3 text-lg">{c.h}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{c.p}</p>
                  <button
                    onClick={() => onNotice(c.t)}
                    className="mt-4 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-accent"
                  >
                    {c.b}
                  </button>
                </article>
              ))}
            </div>
          </div>
        )}

        {active === "match" && (
          <div className="space-y-5">
            <Soon />
            <h3 className="text-2xl">Upload your profile. Get a DFW game plan.</h3>
            <p className="text-sm text-muted-foreground">
              LinkedIn or resume in → relevant events, people, communities, companies, and warm-intro
              paths out.
            </p>
            <button
              onClick={() => onNotice("Uploads are disabled in this public preview.")}
              className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border bg-muted/40 px-6 py-12 transition-colors hover:bg-accent"
            >
              <span className="text-2xl">↑</span>
              <strong>Drop LinkedIn PDF or resume here</strong>
              <span className="text-xs text-muted-foreground">PDF · DOCX · profile export</span>
            </button>
          </div>
        )}

        {active === "companies" && (
          <div className="space-y-5">
            <Soon />
            <h3 className="text-2xl">Companies being built now.</h3>
            <p className="text-sm text-muted-foreground">
              A living database of startups before the press release or announced round.
            </p>
            <div className="overflow-hidden rounded-xl border border-border text-sm">
              <div className="grid grid-cols-4 bg-muted/70 px-4 py-2 text-xs font-semibold tracking-wide text-muted-foreground">
                <span>Company</span>
                <span>Stage</span>
                <span>Signal</span>
                <span>Last activity</span>
              </div>
              {[
                ["Demo Startup 01", "Building", "Hiring", "2d ago"],
                ["Demo Startup 02", "Idea", "Research spinout", "5d ago"],
                ["Demo Startup 03", "Funding", "Customer pilot", "1w ago"],
              ].map((r) => (
                <div key={r[0]} className="grid grid-cols-4 border-t border-border px-4 py-3">
                  {r.map((c, i) => (
                    <span key={c} className={i === 0 ? "font-medium" : "text-muted-foreground"}>
                      {c}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {active === "graph" && (
          <div className="space-y-5">
            <Soon />
            <h3 className="text-2xl">Find the shortest warm-intro path.</h3>
            <p className="text-sm text-muted-foreground">
              Track who knows whom across founders, investors, universities, corporations, and
              previous companies.
            </p>
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-muted/40 p-5 text-sm">
              {["You", "Community organizer", "Founder", "Investor"].map((n, i) => (
                <span key={n} className="flex items-center gap-3">
                  {i > 0 && <b className="text-ember">→</b>}
                  <span className="rounded-full bg-card px-3 py-1.5 shadow-soft">{n}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {active === "research" && (
          <div className="space-y-5">
            <Soon />
            <h3 className="text-2xl">Turn research into companies.</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ["Research signal", "New patent, lab result, grant, or commercialization lead."],
                ["Founder fit", "Match domain builders and operators who could take it to market."],
                ["Corporate fit", "Surface local design partners, customers, and pilots."],
              ].map(([t, d]) => (
                <div key={t} className="rounded-2xl border border-border p-5">
                  <strong className="text-sm">{t}</strong>
                  <p className="mt-1 text-sm text-muted-foreground">{d}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {active === "health" && (
          <div className="space-y-5">
            <Soon />
            <h3 className="text-2xl">Is the ecosystem actually compounding?</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["New startups", "idea → building"],
                ["Funding", "capital formation"],
                ["Repeat founders", "experience recycling"],
                ["Spinouts", "research → company"],
                ["Corporate pilots", "local demand"],
                ["Founder density", "collision frequency"],
                ["Exits → angels", "capital recycling"],
                ["Employees → founders", "talent recycling"],
              ].map(([t, d]) => (
                <div key={t} className="rounded-xl border border-border p-4">
                  <strong className="block text-sm">{t}</strong>
                  <span className="text-xs text-muted-foreground">{d}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
