import { useState } from "react";
import logo from "@/assets/build-dallas-logo.png";

const links = [
  { href: "#why", label: "Why Dallas" },
  { href: "#network", label: "The Network" },
  { href: "#platform", label: "Platform" },
  { href: "#launch", label: "Launch" },
];

export function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <a href="#top" className="flex items-center gap-2.5" aria-label="Build Dallas home">
          <img src={logo} alt="Build Dallas logo" width={32} height={32} className="h-8 w-8" />
          <span className="text-sm font-bold tracking-[0.18em]">BUILD DALLAS</span>
        </a>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
          <a
            href="#join"
            className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-ink-foreground transition-opacity hover:opacity-90"
          >
            Join the network
          </a>
        </nav>

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
        <nav className="border-t border-border bg-background px-5 py-3 md:hidden" aria-label="Mobile">
          <ul className="flex flex-col gap-3">
            {[...links, { href: "#join", label: "Join the network" }].map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="block py-1 text-sm text-muted-foreground hover:text-foreground"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
