import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteFooter, SiteHeader } from "@/components/site/AppShell";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import type { CompanyRow } from "@/lib/database.types";
import logo from "@/assets/build-dallas-logo.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Build Dallas — Build in Dallas" },
      {
        name: "description",
        content: "Build Dallas helps the DFW startup ecosystem work together.",
      },
    ],
  }),
  component: HomePage,
});

const whatWeDo = [
  [
    "01",
    "Connect",
    "Connect founders with relevant people, communities, corporations, investors, and programs.",
  ],
  [
    "02",
    "Resources",
    "Aggregate startup resources, software benefits, services, and partner opportunities.",
  ],
  [
    "03",
    "Showcase",
    "Highlight the startups and builders creating companies across Dallas–Fort Worth.",
  ],
  [
    "04",
    "Community",
    "Bring together startup organizations, operators, students, and ecosystem partners.",
  ],
];
const partnerPlaceholders = [
  "Corporate partners",
  "City partners",
  "Startup programs",
  "Universities",
  "Investors",
];
const communities = [
  "Stripe Dallas",
  "SIP",
  "Claude Community",
  "Community logo",
  "Community logo",
];
const Arrow = () => (
  <span aria-hidden className="transition-transform group-hover:translate-x-1">
    →
  </span>
);

function HomePage() {
  const companies = useQuery({
    queryKey: ["home-company-preview"],
    enabled: supabaseConfigured,
    queryFn: async (): Promise<CompanyRow[]> => {
      const { data, error } = await supabase.from("companies").select("*").order("name").limit(8);
      if (error) throw error;
      return data ?? [];
    },
  });
  const companyPreview = companies.data?.length
    ? companies.data
    : Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: "Company", logo_url: null }));
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden border-b border-border">
          <div className="pointer-events-none absolute left-1/2 top-[-22rem] h-[46rem] w-[46rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
          <div className="mx-auto grid min-h-[42rem] max-w-6xl items-center gap-14 px-5 py-20 md:grid-cols-[1.15fr_0.85fr]">
            <div className="reveal">
              <span className="kicker inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-2 text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" /> DFW's Startup Ecosystem
              </span>
              <h1 className="mt-7 text-6xl leading-[0.95] sm:text-7xl lg:text-[6.2rem]">
                Build in <span className="text-primary">Dallas.</span>
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
                Build Dallas connects startups across North Texas with the companies, communities,
                programs, partners, and resources that can help them grow.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link
                  to="/companies"
                  className="group rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground shadow-soft transition hover:-translate-y-0.5"
                >
                  Explore the Ecosystem <Arrow />
                </Link>
                <Link
                  to="/get-connected"
                  className="rounded-full border border-border bg-card px-6 py-3.5 text-sm font-semibold transition hover:bg-accent"
                >
                  Get Connected
                </Link>
              </div>
            </div>
            <div className="relative mx-auto flex aspect-square w-full max-w-md items-center justify-center">
              <div className="absolute inset-2 rounded-full border border-border/70" />
              <div className="absolute inset-14 rounded-full border border-dashed border-primary/40" />
              <div className="absolute inset-28 rounded-full bg-card shadow-lift" />
              <img src={logo} alt="Build Dallas" className="relative z-10 w-28" />
              {["Startups", "Resources", "Community", "Programs", "Partners"].map((item, index) => {
                const angle = (index / 5) * Math.PI * 2 - Math.PI / 2;
                return (
                  <span
                    key={item}
                    className="absolute rounded-full border border-border bg-background px-3 py-2 text-xs font-medium shadow-soft"
                    style={{
                      left: `${50 + 45 * Math.cos(angle)}%`,
                      top: `${50 + 45 * Math.sin(angle)}%`,
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    {item}
                  </span>
                );
              })}
            </div>
          </div>
        </section>
        <section className="mx-auto grid max-w-6xl gap-10 px-5 py-24 md:grid-cols-[0.8fr_1.2fr]">
          <div>
            <span className="kicker text-primary">Our mission</span>
            <h2 className="mt-4 text-4xl sm:text-5xl">Helping Dallas startups grow here.</h2>
          </div>
          <p className="self-end text-lg leading-relaxed text-muted-foreground">
            Dallas already has founders, talent, capital, corporations, universities, accelerators,
            and communities. Build Dallas brings those pieces together so founders can more easily
            find the people, programs, resources, and opportunities they need.
          </p>
        </section>
        <section className="border-y border-border bg-card/25">
          <div className="mx-auto max-w-6xl px-5 py-24">
            <span className="kicker text-primary">What we do</span>
            <h2 className="mt-4 max-w-2xl text-4xl sm:text-5xl">
              Practical support for people building here.
            </h2>
            <div className="mt-12 grid gap-4 md:grid-cols-4">
              {whatWeDo.map(([number, title, copy]) => (
                <article
                  key={title}
                  className="group rounded-2xl border border-border bg-card p-6 transition hover:-translate-y-1 hover:border-primary/50"
                >
                  <span className="kicker text-primary">{number}</span>
                  <h3 className="mt-12 text-2xl">{title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-5 py-24">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <span className="kicker text-primary">Working across the ecosystem</span>
              <h2 className="mt-4 text-4xl">Ecosystem partners</h2>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              Organizations helping make Dallas a stronger place to start and grow a company.
            </p>
          </div>
          <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-5">
            {partnerPlaceholders.map((name, index) => (
              <div
                key={name}
                className="flex h-32 items-center justify-center bg-card px-5 text-center"
              >
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {name}
                  <br />
                  <span className="mt-2 inline-block text-primary/70">0{index + 1}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="border-y border-border bg-secondary/30">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <span className="kicker text-primary">Local communities</span>
            <h2 className="mt-4 text-4xl">Communities building Dallas</h2>
            <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {communities.map((name, index) => (
                <div
                  key={`${name}-${index}`}
                  className="flex min-h-28 items-center gap-4 rounded-2xl border border-border bg-background p-5"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/15 font-display text-xl text-primary">
                    {name === "Community logo" ? "+" : name.charAt(0)}
                  </span>
                  <span className="text-sm font-semibold">{name}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-5 py-24">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <span className="kicker text-primary">The ecosystem</span>
              <h2 className="mt-4 text-4xl">Companies building in Dallas</h2>
            </div>
            <Link to="/companies" className="group text-sm font-semibold text-primary">
              Explore Companies <Arrow />
            </Link>
          </div>
          <div className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-4">
            {companyPreview.map((company) => (
              <div
                key={company.id}
                className="group flex h-32 items-center justify-center rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-1 hover:border-primary/50"
              >
                {company.logo_url ? (
                  <img
                    src={company.logo_url}
                    alt={company.name}
                    className="max-h-14 max-w-[9rem] object-contain"
                  />
                ) : (
                  <span className="grid h-14 w-14 place-items-center rounded-2xl bg-secondary font-display text-2xl text-muted-foreground">
                    {company.name === "Company" ? "·" : company.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-5 pb-8">
          <div className="surface-ink relative overflow-hidden rounded-3xl border border-primary/20 p-9 sm:p-12">
            <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
            <div className="relative grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
              <div>
                <span className="kicker text-primary">Founder support</span>
                <h2 className="mt-4 text-4xl">Resources for builders</h2>
                <p className="mt-5 max-w-2xl leading-relaxed text-muted-foreground">
                  We're working with partners to aggregate and negotiate resources for startups
                  building in Dallas—including software, cloud infrastructure, professional
                  services, programs, workspace, and other founder benefits.
                </p>
                <p className="mt-3 text-sm text-muted-foreground">
                  Looking for something specific? Tell us what you need and we'll see what we can
                  connect you with.
                </p>
              </div>
              <Link
                to="/resources"
                className="group rounded-full bg-primary px-6 py-3.5 text-center text-sm font-semibold text-primary-foreground"
              >
                Request a Resource <Arrow />
              </Link>
            </div>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-5 py-24 text-center">
          <span className="kicker text-primary">Build with us</span>
          <h2 className="mt-4 text-5xl sm:text-6xl">Building something in Dallas?</h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Whether you're looking for resources, programs, partners, customers, investors, or
            connections, tell us what you need.
          </p>
          <Link
            to="/get-connected"
            className="mt-8 inline-flex rounded-full bg-primary px-7 py-4 text-sm font-semibold text-primary-foreground shadow-soft transition hover:-translate-y-0.5"
          >
            Get Connected
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
