import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/site/AppShell";
import { EmptyState, ErrorState, LoadingRows, StatusBadge, cx } from "@/components/site/Primitives";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { EntityType, WikiEditRow } from "@/lib/database.types";
import { formatDateTime, titleCase } from "@/lib/format";

export const Route = createFileRoute("/wiki/")({
  head: () => ({ meta: [{ title: "Wiki — Build Dallas" }] }),
  component: WikiIndexPage,
});

type SearchHit = { id: string; label: string; sub: string | null; type: EntityType };

function WikiIndexPage() {
  const { user, loading } = useAuth();
  const [term, setTerm] = useState("");

  const results = useQuery({
    queryKey: ["wiki-search", term.trim()],
    enabled: term.trim().length >= 2,
    queryFn: async (): Promise<SearchHit[]> => {
      const safe = term.trim().replace(/[,()*%]/g, " ");
      const [companies, events, people] = await Promise.all([
        supabase.from("companies").select("id,name,stage").ilike("name", `%${safe}%`).limit(8),
        supabase.from("events").select("id,title,venue").ilike("title", `%${safe}%`).limit(8),
        supabase.from("people").select("id,name,role").ilike("name", `%${safe}%`).limit(8),
      ]);

      const error = companies.error ?? events.error ?? people.error;
      if (error) throw error;

      return [
        ...(companies.data ?? []).map((c) => ({
          id: c.id,
          label: c.name,
          sub: c.stage ? titleCase(c.stage) : null,
          type: "company" as const,
        })),
        ...(events.data ?? []).map((e) => ({
          id: e.id,
          label: e.title,
          sub: e.venue,
          type: "event" as const,
        })),
        ...(people.data ?? []).map((p) => ({
          id: p.id,
          label: p.name,
          sub: p.role,
          type: "person" as const,
        })),
      ];
    },
  });

  const recent = useQuery({
    queryKey: ["wiki-recent"],
    enabled: Boolean(user),
    queryFn: async (): Promise<WikiEditRow[]> => {
      const { data, error } = await supabase
        .from("wiki_edits")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <AppShell
      kicker="Community corrections"
      title={
        <>
          The ecosystem knows more
          <br />
          <span className="text-primary">than the scrapers do.</span>
        </>
      }
      intro="Scraped data drifts. Anyone signed in can suggest a correction to a company, event, or person. Two people suggesting the same value applies it automatically — as does an edit from a company's verified owner."
    >
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <div className={`${cx.card} space-y-4`}>
            <label className="block">
              <span className="kicker text-muted-foreground">Find something to edit</span>
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="⌕  Search companies, events, or people"
                className={`mt-2 ${cx.input}`}
              />
            </label>

            {term.trim().length >= 2 && (
              <div className="border-t border-border pt-4">
                {results.error ? (
                  <ErrorState error={results.error} />
                ) : results.isPending ? (
                  <LoadingRows count={2} />
                ) : (results.data ?? []).length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    Nothing matches "{term.trim()}".
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {(results.data ?? []).map((hit) => (
                      <li key={`${hit.type}-${hit.id}`}>
                        <Link
                          to="/wiki/$entityType/$entityId"
                          params={{ entityType: hit.type, entityId: hit.id }}
                          className="flex items-center justify-between gap-4 py-3 transition-colors hover:text-primary"
                        >
                          <span>
                            <span className="block text-sm font-medium">{hit.label}</span>
                            {hit.sub && (
                              <span className="block text-xs text-muted-foreground">{hit.sub}</span>
                            )}
                          </span>
                          <span className="kicker shrink-0 text-muted-foreground">{hit.type}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <section>
            <h2 className="text-2xl">Recent suggestions</h2>
            <div className="mt-4">
              {loading ? (
                <LoadingRows count={2} />
              ) : !user ? (
                <EmptyState
                  title="Sign in to see the edit log"
                  body="The full history of who suggested what is visible to signed-in members only."
                  action={
                    <Link to="/login" search={{ redirect: "/wiki" }} className={cx.primary}>
                      Sign in
                    </Link>
                  }
                />
              ) : recent.error ? (
                <ErrorState error={recent.error} />
              ) : recent.isPending ? (
                <LoadingRows count={3} />
              ) : (recent.data ?? []).length === 0 ? (
                <EmptyState
                  title="No suggestions yet"
                  body="Be the first — search above, open a record, and propose a fix."
                />
              ) : (
                <ul className="space-y-3">
                  {(recent.data ?? []).map((edit) => (
                    <li
                      key={edit.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-soft"
                    >
                      <div className="min-w-0">
                        <Link
                          to="/wiki/$entityType/$entityId"
                          params={{ entityType: edit.entity_type, entityId: edit.entity_id }}
                          className="text-sm font-medium hover:text-primary"
                        >
                          {edit.entity_type} · {edit.field_name}
                        </Link>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {edit.old_value ? `${edit.old_value} → ` : "set to "}
                          <span className="text-foreground">{edit.new_value ?? "(cleared)"}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(edit.created_at)}
                        </span>
                        <StatusBadge status={edit.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-4 self-start">
          <div className="surface-ink rounded-3xl p-6">
            <span className="kicker opacity-60">How it works</span>
            <ul className="mt-4 space-y-4 text-sm">
              {[
                [
                  "01",
                  "Suggest",
                  "Pick a field and propose a value. We record the current value ourselves, so it can't be spoofed.",
                ],
                [
                  "02",
                  "Corroborate",
                  "When a second person independently suggests the same value, both edits apply instantly.",
                ],
                [
                  "03",
                  "Verified owners",
                  "An edit from a company's verified owner applies on its own.",
                ],
                [
                  "04",
                  "Everything else",
                  "Stays pending and visible in the log until someone agrees.",
                ],
              ].map(([n, t, d]) => (
                <li key={t} className="flex gap-4 border-t border-white/10 pt-4">
                  <span className="kicker opacity-50">{n}</span>
                  <p>
                    <strong>{t}</strong> <span className="opacity-75">— {d}</span>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
