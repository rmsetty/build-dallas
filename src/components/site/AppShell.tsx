import { useState, type ReactNode } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import logo from "@/assets/build-dallas-logo.png";
import { useAuth } from "@/lib/auth";

/**
 * The product surfaces. These are the tabs — the home page's own sections are
 * not navigation, they are page content you scroll to.
 */
export const NAV_TABS = [
  { to: "/events", label: "Events" },
  { to: "/companies", label: "Companies" },
  { to: "/people", label: "People" },
  { to: "/wiki", label: "Wiki" },
] as const;

function AccountControl({ compact = false }: { compact?: boolean }) {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  if (loading) return null;

  return user ? (
    <div className={compact ? "flex flex-col gap-2" : "flex items-center gap-2"}>
      <Link
        to="/profile"
        className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
      >
        Profile
      </Link>
      <button
        onClick={async () => {
          await signOut();
          router.invalidate();
        }}
        className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        Sign out
      </button>
    </div>
  ) : (
    <Link
      to="/login"
      className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-ink-foreground transition-opacity hover:opacity-90"
    >
      Sign in
    </Link>
  );
}

/**
 * One header for every page, landing page included. The tab bar is the primary
 * navigation everywhere, so moving between the marketing page and the live data
 * never changes the furniture under your cursor.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
        <Link to="/" className="flex shrink-0 items-center gap-2.5" aria-label="Build Dallas home">
          <img src={logo} alt="Build Dallas logo" width={32} height={32} className="h-8 w-8" />
          <span className="text-sm font-bold tracking-[0.18em]">BUILD DALLAS</span>
        </Link>

        <nav className="hidden md:flex" aria-label="Primary">
          <div className="flex gap-1 rounded-full border border-border bg-secondary/60 p-1">
            {NAV_TABS.map((t) => (
              <Link
                key={t.to}
                to={t.to}
                className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                activeProps={{
                  className:
                    "rounded-full px-4 py-1.5 text-sm font-medium bg-ink text-ink-foreground shadow-soft",
                }}
              >
                {t.label}
              </Link>
            ))}
          </div>
        </nav>

        <div className="hidden shrink-0 md:block">
          <AccountControl />
        </div>

        <button
          className="rounded-md border border-border px-3 py-1.5 text-sm md:hidden"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          Menu
        </button>
      </div>

      {open && (
        <nav
          className="border-t border-border bg-background px-5 py-3 md:hidden"
          aria-label="Mobile"
        >
          <ul className="flex flex-col gap-3">
            {NAV_TABS.map((t) => (
              <li key={t.to}>
                <Link
                  to={t.to}
                  onClick={() => setOpen(false)}
                  className="block py-1 text-sm text-muted-foreground hover:text-foreground"
                  activeProps={{ className: "block py-1 text-sm text-foreground" }}
                >
                  {t.label}
                </Link>
              </li>
            ))}
            <li className="pt-1">
              <AccountControl compact />
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-5 py-10 text-sm">
        <Link to="/" className="flex items-center gap-2.5">
          <img src={logo} alt="" width={28} height={28} loading="lazy" className="h-7 w-7" />
          <span className="font-bold tracking-[0.18em]">BUILD DALLAS</span>
        </Link>
        <p className="max-w-sm text-muted-foreground">
          Events and companies are collected daily from public DFW sources. Spot something wrong?
          Suggest an edit — corroborated corrections apply themselves.
        </p>
        <div className="flex gap-5 text-muted-foreground">
          {NAV_TABS.map((t) => (
            <Link key={t.to} to={t.to} className="hover:text-foreground">
              {t.label}
            </Link>
          ))}
        </div>
        <span className="text-muted-foreground">© 2026 Build Dallas</span>
      </div>
    </footer>
  );
}

/** Page chrome for every data route. */
export function AppShell({
  kicker,
  title,
  intro,
  actions,
  children,
}: {
  kicker: string;
  title: ReactNode;
  intro?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-5 pb-6 pt-14">
        <header className="reveal">
          <span className="kicker text-muted-foreground">{kicker}</span>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
            <h1 className="max-w-2xl text-4xl leading-tight sm:text-5xl">{title}</h1>
            {actions}
          </div>
          {intro && <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{intro}</p>}
        </header>
        <div className="mt-10">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}
