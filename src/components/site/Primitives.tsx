import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { CompanySignal } from "@/lib/database.types";

/**
 * The class strings the landing page uses for pills, cards, inputs and buttons,
 * named once so every data route stays pixel-identical to it.
 */
export const cx = {
  card: "rounded-2xl border border-border bg-card p-6 shadow-soft",
  input:
    "w-full rounded-xl border border-border bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
  select:
    "rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
  primary:
    "rounded-full bg-ink px-6 py-3 text-sm font-medium text-ink-foreground shadow-soft transition-transform hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-60",
  secondary:
    "rounded-full border border-border bg-card px-6 py-3 text-sm font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-60",
  chip: "rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium",
} as const;

export function Chip({
  children,
  active = false,
  onClick,
  title,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const base = "rounded-full px-3 py-1.5 text-xs font-medium transition-colors";
  const look = active
    ? "bg-ink text-ink-foreground"
    : "border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground";

  if (!onClick) {
    return (
      <span title={title} className={`${base} ${active ? look : "border border-border bg-card"}`}>
        {children}
      </span>
    );
  }
  return (
    <button type="button" title={title} onClick={onClick} className={`${base} ${look}`}>
      {children}
    </button>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "auto_applied"
      ? "bg-ember text-ember-foreground"
      : status === "rejected"
        ? "bg-destructive text-destructive-foreground"
        : "border border-border bg-card text-muted-foreground";
  const label =
    status === "auto_applied" ? "APPLIED" : status === "rejected" ? "DECLINED" : "PENDING";

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[0.65rem] font-semibold tracking-[0.16em] ${tone}`}
    >
      {label}
    </span>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-6 py-16 text-center">
      <h3 className="text-2xl">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-6 py-8 text-center">
      <h3 className="text-xl">That didn't load</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export function LoadingRows({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-28 animate-pulse rounded-2xl border border-border bg-card/60" />
      ))}
    </div>
  );
}

/**
 * Segmented tab bar. The same control serves the home page's primary
 * navigation and the in-page section switches, so the two never drift apart.
 *
 * Scrolls horizontally rather than wrapping: a wrapped tab bar changes the
 * page's height as you move between tabs, which is exactly the jumpiness a tab
 * bar is supposed to remove.
 */
export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
  size = "md",
}: {
  tabs: ReadonlyArray<{ key: T; label: string; count?: number | undefined }>;
  active: T;
  onChange: (key: T) => void;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-3.5 py-1.5 text-xs" : "px-5 py-2.5 text-sm";

  return (
    <div
      role="tablist"
      className="flex gap-1 overflow-x-auto rounded-full border border-border bg-secondary/60 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={`flex shrink-0 items-center gap-2 rounded-full font-medium transition-colors ${pad} ${
              on
                ? "bg-ink text-ink-foreground shadow-soft"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {t.label}
            {typeof t.count === "number" && (
              <span className={on ? "opacity-70" : "opacity-60"}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Tab bar whose tabs are routes. Same look, but each tab is a real link. */
export function RouteTabs({ tabs }: { tabs: ReadonlyArray<{ to: string; label: string }> }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-full border border-border bg-secondary/60 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          className="shrink-0 rounded-full px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          activeProps={{
            className:
              "shrink-0 rounded-full px-5 py-2.5 text-sm font-medium bg-ink text-ink-foreground shadow-soft",
          }}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

const SIGNAL_COPY: Record<CompanySignal, { label: string; hint: string; loud: boolean }> = {
  raising: {
    label: "RAISING",
    hint: "Filed an SEC Form D — an exempt offering is under way",
    loud: true,
  },
  event_active: {
    label: "ACTIVE IN DFW",
    hint: "Named in an upcoming Dallas event listing",
    loud: true,
  },
  accelerator: {
    label: "ACCELERATOR",
    hint: "In a Dallas accelerator's current portfolio",
    loud: false,
  },
  yc: { label: "Y COMBINATOR", hint: "In the Y Combinator directory", loud: false },
  portfolio: { label: "BACKED", hint: "In a Texas venture portfolio", loud: false },
  research: { label: "RESEARCH", hint: "Spun out of a research programme", loud: false },
  hiring: { label: "HIRING", hint: "Posting open roles", loud: true },
  directory: { label: "LISTED", hint: "Found in an ecosystem directory", loud: false },
};

/** Why we believe this company is live. The loudest thing on a company card. */
export function SignalBadge({ signal }: { signal: CompanySignal | null }) {
  const copy = signal ? SIGNAL_COPY[signal] : undefined;
  if (!copy) return null;

  return (
    <span
      title={copy.hint}
      className={`rounded-full px-2.5 py-1 text-[0.65rem] font-semibold tracking-[0.16em] ${
        copy.loud
          ? "bg-ember text-ember-foreground"
          : "border border-border bg-card text-muted-foreground"
      }`}
    >
      {copy.label}
    </span>
  );
}

export function signalHint(signal: CompanySignal | null): string | null {
  return signal ? SIGNAL_COPY[signal].hint : null;
}

/**
 * Builds the page list with a sliding window and ellipses, e.g.
 *   1 … 12 13 [14] 15 16 … 45
 * Always shows the first and last page so the ends of a 45-page directory stay
 * one click away.
 */
function pageItems(page: number, pageCount: number): Array<number | "gap"> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);

  const items = new Set<number>([1, pageCount, page]);
  for (let d = 1; d <= 2; d++) {
    if (page - d > 1) items.add(page - d);
    if (page + d < pageCount) items.add(page + d);
  }
  // Keep the window a constant width at the ends, so the control does not
  // change size as you page through.
  if (page <= 4) for (let p = 2; p <= 5; p++) items.add(p);
  if (page >= pageCount - 3) for (let p = pageCount - 4; p < pageCount; p++) items.add(p);

  const sorted = [...items].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const out: Array<number | "gap"> = [];
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && p - prev > 1) out.push("gap");
    out.push(p);
  });
  return out;
}

export function Pagination({
  page,
  pageCount,
  onChange,
  label = "results",
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  label?: string;
}) {
  if (pageCount <= 1) return null;

  const go = (next: number) => onChange(Math.min(Math.max(next, 1), pageCount));
  const step =
    "rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40";

  return (
    <nav
      className="flex flex-wrap items-center justify-center gap-1.5 pt-2"
      aria-label={`${label} pagination`}
    >
      <button
        onClick={() => go(page - 1)}
        disabled={page === 1}
        className={step}
        aria-label="Previous page"
      >
        ←
      </button>

      {pageItems(page, pageCount).map((item, i) =>
        item === "gap" ? (
          <span key={`gap-${i}`} className="px-1 text-sm text-muted-foreground" aria-hidden>
            …
          </span>
        ) : (
          <button
            key={item}
            onClick={() => go(item)}
            aria-current={item === page ? "page" : undefined}
            className={`min-w-9 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              item === page
                ? "bg-ink text-ink-foreground shadow-soft"
                : "border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {item}
          </button>
        ),
      )}

      <button
        onClick={() => go(page + 1)}
        disabled={page === pageCount}
        className={step}
        aria-label="Next page"
      >
        →
      </button>
    </nav>
  );
}
