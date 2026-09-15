import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Moon, Sun } from "lucide-react";
import logo from "@/assets/build-dallas-logo.png";

export const NAV_TABS = [
  { to: "/", label: "Home" },
  { to: "/companies", label: "Companies" },
  { to: "/resources", label: "Resources" },
  { to: "/events", label: "Events" },
] as const;

function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const nextDark = !dark;
    document.documentElement.classList.toggle("dark", nextDark);
    document.documentElement.style.colorScheme = nextDark ? "dark" : "light";
    localStorage.setItem("build-dallas-theme", nextDark ? "dark" : "light");
    setDark(nextDark);
  };

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:bg-accent"
      aria-label={`Switch to ${dark ? "light" : "dark"} mode`}
      title={`Switch to ${dark ? "light" : "dark"} mode`}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-5 px-5">
        <Link to="/" className="flex shrink-0 items-center gap-2.5" aria-label="Build Dallas home">
          <img src={logo} alt="Build Dallas logo" width={32} height={32} className="h-8 w-8" />
          <span className="text-sm font-bold tracking-[0.18em]">BUILD DALLAS</span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary navigation">
          {NAV_TABS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              activeOptions={{ exact: item.to === "/" }}
              activeProps={{
                className: "rounded-full bg-accent px-4 py-2 text-sm font-medium text-foreground",
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            to="/get-connected"
            className="hidden rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition hover:-translate-y-0.5 md:block"
          >
            Get Connected
          </Link>
          <button
            type="button"
            className="rounded-full border border-border px-4 py-2 text-sm md:hidden"
            aria-label="Toggle navigation"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            Menu
          </button>
        </div>
      </div>
      {open && (
        <nav
          className="border-t border-border bg-background px-5 py-5 md:hidden"
          aria-label="Mobile navigation"
        >
          <div className="mx-auto flex max-w-6xl flex-col gap-1">
            {NAV_TABS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className="rounded-xl px-4 py-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            <Link
              to="/get-connected"
              onClick={() => setOpen(false)}
              className="mt-2 rounded-full bg-primary px-5 py-3 text-center text-sm font-semibold text-primary-foreground"
            >
              Get Connected
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 md:grid-cols-[1.2fr_1fr_auto] md:items-end">
        <div>
          <Link to="/" className="flex items-center gap-2.5">
            <img src={logo} alt="" width={28} height={28} className="h-7 w-7" />
            <span className="text-sm font-bold tracking-[0.18em]">BUILD DALLAS</span>
          </Link>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
            Helping the DFW startup ecosystem work together—and helping builders access what they
            need.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-3 text-sm text-muted-foreground">
          {NAV_TABS.slice(1).map((item) => (
            <Link key={item.to} to={item.to} className="hover:text-foreground">
              {item.label}
            </Link>
          ))}
          <Link to="/get-connected" className="hover:text-foreground">
            Get Connected
          </Link>
        </div>
        <span className="text-xs text-muted-foreground">© 2026 Build Dallas</span>
      </div>
    </footer>
  );
}

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
      <main className="mx-auto max-w-6xl px-5 pb-8 pt-16">
        <header className="reveal border-b border-border pb-12">
          <span className="kicker text-primary">{kicker}</span>
          <div className="mt-5 flex flex-wrap items-end justify-between gap-8">
            <h1 className="max-w-3xl text-5xl leading-[1.02] sm:text-6xl">{title}</h1>
            {actions}
          </div>
          {intro && (
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">{intro}</p>
          )}
        </header>
        <div className="mt-10">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}
