import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";

import { SiteHeader, SiteFooter } from "@/components/site/AppShell";
import { LiveWorkspace } from "@/components/site/LiveWorkspace";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import type { EcosystemStats } from "@/lib/database.types";
import logo from "@/assets/build-dallas-logo.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Build Dallas — DFW's Startup Ecosystem Layer" },
      {
        name: "description",
        content:
          "Build Dallas connects DFW founders, talent, capital, research, and corporations, then turns that network into ecosystem intelligence.",
      },
      { property: "og:title", content: "Build Dallas — Build the Loop" },
      {
        property: "og:description",
        content:
          "One living map of who is building across North Texas: people, companies, research, and warm-intro paths.",
      },
    ],
  }),
  component: Index,
});

const thesis = [
  [
    "01",
    "Talent",
    "Find ambitious founders and builders earlier — before they leave the region or disappear into disconnected networks.",
  ],
  [
    "02",
    "Research",
    "Surface labs, patents, researchers, and commercialization opportunities that are otherwise hard to discover.",
  ],
  [
    "03",
    "Demand",
    "Connect startups to corporate pilots, customers, procurement, operators, and domain expertise.",
  ],
  [
    "04",
    "Compounding",
    "Track what founders and early employees do next, so exits become new startups, angels, and repeat founders.",
  ],
];

const networkList = [
  [
    "01",
    "People graph",
    "founders, investors, researchers, operators, students, corporate leaders.",
  ],
  ["02", "Company graph", "companies being built now, from idea to exit."],
  [
    "03",
    "Relationship graph",
    "warm-intro paths, shared communities, previous teams, institutional links.",
  ],
  [
    "04",
    "Founder family tree",
    "which companies produce the region's next founders, angels, and early employees.",
  ],
];

const capabilities = [
  [
    "01",
    "Ingest",
    "Startup events, pitches, decks, recordings, transcripts, notes, research, and ecosystem activity.",
  ],
  [
    "02",
    "Structure",
    "Automatically build and update profiles for people, companies, investors, universities, and communities.",
  ],
  [
    "03",
    "Verify",
    "Let founders and community members correct or verify information through account-based contributions.",
  ],
  [
    "04",
    "Connect",
    "Recommend events, people, warm introductions, research matches, pilots, customers, and investors.",
  ],
  [
    "05",
    "Track",
    "Follow companies from idea → building → funding → growth → exit, then follow the people onward.",
  ],
  [
    "06",
    "Measure",
    "Quantify density, collision frequency, repeat founders, spinouts, pilots, exits, and capital recycling.",
  ],
];

const wheel = ["Founders", "Startups", "Employees", "Exits", "Angels", "New founders"];

function Index() {
  const [notice, setNotice] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  // One RPC for every counter on the page: the alternative is four COUNT(*)
  // round trips from the browser on first paint.
  const stats = useQuery({
    queryKey: ["ecosystem-stats"],
    enabled: supabaseConfigured,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<EcosystemStats> => {
      const { data, error } = await supabase.rpc("ecosystem_stats");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3600);
    return () => clearTimeout(t);
  }, [notice]);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setJoined(true);
    setNotice("Thanks — you're on the list. We'll be in touch soon.");
  };

  const n = (v: number | undefined) => (v === undefined ? "—" : v.toLocaleString());

  return (
    <div id="top" className="min-h-screen">
      <SiteHeader />

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-primary/15 blur-3xl" />
          <div className="pointer-events-none absolute -right-32 top-40 h-[24rem] w-[24rem] rounded-full bg-ember/15 blur-3xl" />
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-20 md:grid-cols-[1.05fr_0.95fr] md:py-24">
            <div className="reveal">
              <div className="kicker inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-ember" />
                DFW's startup ecosystem layer
              </div>
              <h1 className="mt-6 text-5xl leading-[1.05] sm:text-6xl lg:text-7xl">
                DFW has the inputs.
                <br />
                <span className="text-primary">We build the loop.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg text-muted-foreground">
                Build Dallas connects founders, investors, researchers, operators, students,
                corporations, and communities — then turns those connections into a living map of
                what is being built across North Texas.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to="/companies"
                  className="rounded-full bg-ink px-6 py-3 text-sm font-medium text-ink-foreground shadow-soft transition-transform hover:-translate-y-0.5"
                >
                  Browse who's building
                </Link>
                <Link
                  to="/profile"
                  className="rounded-full border border-border bg-card px-6 py-3 text-sm font-medium transition-colors hover:bg-accent"
                >
                  Get your matches
                </Link>
              </div>
              <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-border pt-6">
                {[
                  [n(stats.data?.companies), "companies tracked"],
                  [n(stats.data?.events), "upcoming DFW events"],
                  [n(stats.data?.companies_raising), "raising right now"],
                ].map(([value, label]) => (
                  <div key={label}>
                    <dt className="font-display text-2xl">{value}</dt>
                    <dd className="mt-1 text-xs text-muted-foreground">{label}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="relative mx-auto aspect-square w-full max-w-md">
              <div className="orbit-ring absolute inset-0 rounded-full border border-border" />
              <div className="orbit-ring absolute inset-10 rounded-full border border-dashed border-primary/30" />
              <div className="absolute inset-24 rounded-full bg-card shadow-lift" />
              <img
                src={logo}
                alt="Build Dallas"
                width={512}
                height={512}
                className="absolute left-1/2 top-1/2 w-28 -translate-x-1/2 -translate-y-1/2"
              />
              {["Founders", "Capital", "Research", "Talent", "Corporates"].map((label, i) => {
                const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
                return (
                  <span
                    key={label}
                    className="absolute rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-soft"
                    style={{
                      left: `${50 + 44 * Math.cos(angle)}%`,
                      top: `${50 + 44 * Math.sin(angle)}%`,
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          </div>
        </section>

        {/*
          The working surface, straight after the hero rather than buried in a
          "platform" section: this is the product, and it is live.
        */}
        <section className="mx-auto max-w-6xl px-5 pb-8">
          <LiveWorkspace />
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Live data from {n(stats.data?.sources)} public DFW sources, refreshed daily. Anything
            wrong?{" "}
            <Link to="/wiki" className="text-primary hover:underline">
              Suggest an edit
            </Link>{" "}
            — two members agreeing applies it automatically.
          </p>
        </section>

        {/* Launch strip */}
        <section className="mx-auto max-w-6xl px-5 pt-12">
          <div className="surface-ink flex flex-wrap items-center justify-between gap-6 rounded-3xl p-8">
            <div className="max-w-md">
              <span className="kicker opacity-70">Launched August 7, 2026</span>
              <h2 className="mt-2 text-3xl">Born inside the ecosystem, not in a boardroom.</h2>
            </div>
            <div className="text-sm opacity-85">
              <strong className="block">Dallas Startup Week Happy Hour</strong>
              <span>Renaissance Dallas at Plano Legacy West · 258 attended</span>
            </div>
            <div className="rounded-full bg-ember px-4 py-2 text-xs font-bold tracking-[0.16em] text-ember-foreground">
              SOLD OUT
            </div>
          </div>
        </section>

        {/* Thesis */}
        <section className="mx-auto max-w-6xl px-5 py-24">
          <span className="kicker text-muted-foreground">The thesis</span>
          <div className="mt-4 grid gap-8 md:grid-cols-2">
            <h2 className="text-4xl leading-tight sm:text-5xl">
              Dallas doesn't lack resources.
              <br />
              It lacks coordination.
            </h2>
            <p className="text-lg text-muted-foreground">
              DFW already has talent, research, corporate demand, capital, accelerators,
              universities, and communities. But they operate in separate orbits. Build Dallas
              connects those pieces early enough that startups, knowledge, capital, and experienced
              people compound here.
            </p>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {thesis.map(([num, heading, body], i) => (
              <article
                key={heading}
                className={`rounded-2xl border p-6 transition-transform hover:-translate-y-1 ${
                  i === 3 ? "surface-ink border-transparent" : "border-border bg-card shadow-soft"
                }`}
              >
                <span className="kicker opacity-60">{num}</span>
                <h3 className="mt-3 text-2xl">{heading}</h3>
                <p className={`mt-2 text-sm ${i === 3 ? "opacity-80" : "text-muted-foreground"}`}>
                  {body}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* Network */}
        <section className="surface-ink">
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-24 md:grid-cols-2">
            <div>
              <span className="kicker opacity-60">The network</span>
              <h2 className="mt-4 text-4xl leading-tight">
                One graph for the people, companies, institutions, and activity shaping DFW.
              </h2>
              <p className="mt-4 opacity-80">
                An ecosystem memory layer: who is building, who is helping, who knows whom, where
                activity is happening, and what changed since yesterday.
              </p>
              <ul className="mt-8 space-y-4">
                {networkList.map(([num, title, body]) => (
                  <li key={title} className="flex gap-4 border-t border-white/10 pt-4">
                    <span className="kicker opacity-50">{num}</span>
                    <p className="text-sm">
                      <strong>{title}</strong> <span className="opacity-75">— {body}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <svg
                viewBox="0 0 700 560"
                role="img"
                aria-label="Illustrative DFW founder network graph"
                className="w-full"
              >
                <g stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5">
                  <line x1="350" y1="280" x2="165" y2="150" />
                  <line x1="350" y1="280" x2="540" y2="125" />
                  <line x1="350" y1="280" x2="130" y2="390" />
                  <line x1="350" y1="280" x2="555" y2="405" />
                  <line x1="350" y1="280" x2="350" y2="90" />
                  <line x1="350" y1="280" x2="355" y2="485" />
                  <line x1="165" y1="150" x2="350" y2="90" />
                  <line x1="540" y1="125" x2="555" y2="405" />
                  <line x1="130" y1="390" x2="355" y2="485" />
                  <line x1="555" y1="405" x2="355" y2="485" />
                </g>
                <g fontSize="18" fill="currentColor" textAnchor="middle" fontWeight="500">
                  <circle cx="350" cy="280" r="68" fill="var(--color-primary)" />
                  <text x="350" y="275">
                    BUILD
                  </text>
                  <text x="350" y="300">
                    DALLAS
                  </text>
                  <circle cx="165" cy="150" r="48" fill="var(--color-ember)" fillOpacity="0.9" />
                  <text x="165" y="155">
                    Founder
                  </text>
                  {[
                    [540, 125, "Investor"],
                    [130, 390, "Research"],
                    [555, 405, "Corporate"],
                    [350, 90, "Talent"],
                    [355, 485, "Startup"],
                  ].map(([x, y, label]) => (
                    <g key={label as string}>
                      <circle
                        cx={x as number}
                        cy={y as number}
                        r="46"
                        fill="currentColor"
                        fillOpacity="0.1"
                        stroke="currentColor"
                        strokeOpacity="0.3"
                      />
                      <text x={x as number} y={(y as number) + 5}>
                        {label}
                      </text>
                    </g>
                  ))}
                </g>
              </svg>
              <div className="flex items-center gap-2 px-3 pb-2 text-xs opacity-70">
                <span className="h-2 w-2 animate-pulse rounded-full bg-ember" />
                Illustrative network layer
              </div>
            </div>
          </div>
        </section>

        {/* Capabilities */}
        <section className="border-y border-border bg-secondary/50">
          <div className="mx-auto max-w-6xl px-5 py-24">
            <span className="kicker text-muted-foreground">What the full system will do</span>
            <h2 className="mt-4 max-w-3xl text-4xl leading-tight">
              From scattered signals to a searchable, living map of DFW.
            </h2>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {capabilities.map(([num, heading, body]) => (
                <article
                  key={heading}
                  className="rounded-2xl border border-border bg-card p-6 shadow-soft"
                >
                  <span className="kicker text-ember">{num}</span>
                  <h3 className="mt-2 text-2xl">{heading}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Flywheel */}
        <section className="mx-auto max-w-6xl px-5 py-24">
          <span className="kicker text-muted-foreground">The end state</span>
          <div className="mt-4 grid items-center gap-14 md:grid-cols-2">
            <div>
              <h2 className="text-4xl leading-tight">
                Make it easier for the next great DFW company to start here — and stay connected
                here.
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Not another directory or event calendar. A compounding system: founders create
                companies, companies create experienced employees, exits create investors, research
                creates spinouts, corporations create demand, and the network makes each next
                connection easier.
              </p>
              <a
                href="#join"
                className="mt-6 inline-block font-medium text-primary hover:underline"
              >
                Help build the loop →
              </a>
            </div>
            <div className="relative mx-auto aspect-square w-full max-w-sm">
              <div className="absolute inset-0 rounded-full border border-dashed border-border" />
              <div className="absolute left-1/2 top-1/2 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink font-display text-xl text-ink-foreground">
                DFW
              </div>
              {wheel.map((label, i) => {
                const angle = (i / wheel.length) * Math.PI * 2 - Math.PI / 2;
                return (
                  <span
                    key={label}
                    className="absolute rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-soft"
                    style={{
                      left: `${50 + 45 * Math.cos(angle)}%`,
                      top: `${50 + 45 * Math.sin(angle)}%`,
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          </div>
        </section>

        {/* Join */}
        <section id="join" className="mx-auto max-w-6xl px-5 pb-24">
          <div className="surface-ink grid gap-10 rounded-3xl p-8 sm:p-12 md:grid-cols-2">
            <div>
              <span className="kicker opacity-60">Build with us</span>
              <h2 className="mt-3 text-3xl leading-tight sm:text-4xl">
                Founders. Investors. Researchers. Operators. Students. Community builders.
              </h2>
              <p className="mt-4 opacity-80">
                Build Dallas is assembling the people who want DFW's startup ecosystem to compound
                faster and stay connected across city, industry, institution, and generation.
              </p>
              <p className="mt-4 text-sm opacity-70">
                Already have an account?{" "}
                <Link to="/people" className="underline">
                  See who else is here
                </Link>
                .
              </p>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <input
                aria-label="Name"
                name="name"
                required
                placeholder="Your name"
                className="w-full rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-ember"
              />
              <input
                aria-label="Email"
                type="email"
                name="email"
                required
                placeholder="Email"
                className="w-full rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-ember"
              />
              <select
                aria-label="Role"
                name="role"
                required
                defaultValue=""
                className="w-full rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-ink-foreground focus:outline-none focus:ring-2 focus:ring-ember [&>option]:text-foreground"
              >
                <option value="" disabled>
                  I am a...
                </option>
                {[
                  "Founder / Builder",
                  "Investor",
                  "Researcher / University",
                  "Corporate / Operator",
                  "Student",
                  "Community Organizer",
                  "Other",
                ].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
              <button
                type="submit"
                className="w-full rounded-xl bg-ember px-4 py-3 text-sm font-semibold text-ember-foreground transition-opacity hover:opacity-90"
              >
                {joined ? "You're on the list" : "Join the network"}
              </button>
              <small className="block opacity-60">
                Demo form — connect this to your email list or database later.
              </small>
            </form>
          </div>
        </section>
      </main>

      <SiteFooter />

      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-5 py-3 text-sm text-ink-foreground shadow-lift"
        >
          {notice}
        </div>
      )}
    </div>
  );
}
