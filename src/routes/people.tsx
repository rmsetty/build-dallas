import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/site/AppShell";
import {
  Chip,
  EmptyState,
  ErrorState,
  LoadingRows,
  TabBar,
  cx,
} from "@/components/site/Primitives";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { relativeTime, titleCase } from "@/lib/format";
import type { DirectoryMember, PersonRow } from "@/lib/database.types";

export const Route = createFileRoute("/people")({
  head: () => ({
    meta: [
      { title: "People — Build Dallas" },
      {
        name: "description",
        content:
          "Everyone on Build Dallas: members who have published a profile, and the founders and operators mapped across the DFW ecosystem.",
      },
    ],
  }),
  component: PeoplePage,
});

type Tab = "members" | "ecosystem";

const ROLES = [
  "Founder / Builder",
  "Investor",
  "Researcher / University",
  "Corporate / Operator",
  "Student",
  "Community Organizer",
  "Other",
] as const;

function PeoplePage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("members");
  const [term, setTerm] = useState("");
  const [role, setRole] = useState("");

  const members = useQuery({
    queryKey: ["members", term, role],
    enabled: supabaseConfigured,
    queryFn: async (): Promise<DirectoryMember[]> => {
      // Ranking by shared keywords needs the whole opted-in set, so it runs in
      // Postgres. Signed out, every shared_count comes back 0 and the ordering
      // falls through to newest-first.
      const { data, error } = await supabase.rpc("member_directory", {
        p_search: term.trim() || null,
        p_role: role || null,
        p_limit: 200,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const ecosystem = useQuery({
    queryKey: ["ecosystem-people", term],
    enabled: supabaseConfigured && tab === "ecosystem",
    queryFn: async () => {
      let query = supabase
        .from("people")
        .select("id,name,role,linkedin_url,company_id,created_at,updated_at")
        .order("name")
        .limit(200);
      if (term.trim()) query = query.ilike("name", `%${term.trim()}%`);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as PersonRow[];
    },
  });

  const memberRows = useMemo(() => members.data ?? [], [members.data]);
  const tabs = [
    { key: "members" as const, label: "Members", count: memberRows.length },
    { key: "ecosystem" as const, label: "Ecosystem", count: ecosystem.data?.length },
  ];

  return (
    <AppShell
      kicker="The people graph"
      title="Who else is here."
      intro="Members who have published a profile, ranked by how much your keywords overlap with theirs. Upload a resume on your profile and this page reorders itself around you."
      actions={
        <Link to="/profile" className={cx.primary}>
          {user ? "Edit your profile" : "Publish your profile"}
        </Link>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <TabBar tabs={tabs} active={tab} onChange={setTab} />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search names, headlines, schools, or skills"
          aria-label="Search people"
          className={`${cx.input} max-w-md flex-1`}
        />
        {tab === "members" && (
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            aria-label="Filter by role"
            className={cx.select}
          >
            <option value="">Every role</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
      </div>

      {!supabaseConfigured && (
        <div className="mt-8">
          <EmptyState
            title="Not connected yet"
            body="Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then reload."
          />
        </div>
      )}

      {supabaseConfigured && tab === "members" && (
        <section className="mt-8">
          {members.isPending && <LoadingRows count={4} />}
          {members.error && <ErrorState error={members.error} />}
          {!members.isPending && !members.error && memberRows.length === 0 && (
            <EmptyState
              title={term || role ? "Nobody matches that yet" : "The directory is just opening"}
              body={
                term || role
                  ? "Try a broader search — the directory only lists members who have chosen to appear."
                  : "Members appear here only after switching their profile to public. Be the first: upload a resume, then flip the visibility toggle."
              }
              action={
                <Link to="/profile" className={cx.primary}>
                  Publish your profile
                </Link>
              }
            />
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {memberRows.map((m) => (
              <MemberCard key={m.id} member={m} />
            ))}
          </div>
        </section>
      )}

      {supabaseConfigured && tab === "ecosystem" && (
        <section className="mt-8">
          {ecosystem.isPending && <LoadingRows count={3} />}
          {ecosystem.error && <ErrorState error={ecosystem.error} />}
          {!ecosystem.isPending && !ecosystem.error && (ecosystem.data ?? []).length === 0 && (
            <EmptyState
              title="No mapped people yet"
              body="This tab holds founders, organizers and operators extracted from event listings and company records, separately from site accounts. Nothing has been extracted into it yet."
            />
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {(ecosystem.data ?? []).map((p) => (
              <article key={p.id} className={cx.card}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-xl">{p.name}</h3>
                  {p.linkedin_url && (
                    <a
                      href={p.linkedin_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="shrink-0 text-sm text-primary hover:underline"
                    >
                      LinkedIn ↗
                    </a>
                  )}
                </div>
                {p.role && <p className="mt-1 text-sm text-muted-foreground">{p.role}</p>}
                <div className="mt-4">
                  <Link
                    to="/wiki/$entityType/$entityId"
                    params={{ entityType: "person", entityId: p.id }}
                    className="text-sm text-primary hover:underline"
                  >
                    Suggest an edit
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <p className="mt-10 text-sm text-muted-foreground">
        Profiles are private by default. Nothing appears on this page until a member turns
        visibility on, and resume text is never shown here or readable by anyone else.
      </p>
    </AppShell>
  );
}

function MemberCard({ member }: { member: DirectoryMember }) {
  const name = member.display_name?.trim() || "Build Dallas member";
  const initials =
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join("") || "BD";

  const shared = new Set(member.shared_terms);
  // Shared keywords first: the overlap is the reason to read this card at all.
  const keywords = [...member.keywords].sort(
    (a, b) => Number(shared.has(b)) - Number(shared.has(a)),
  );

  return (
    <article className={cx.card}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-semibold text-ink-foreground">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl">{name}</h3>
            {member.shared_count > 0 && (
              <span className="rounded-full bg-ember px-2.5 py-1 text-[0.65rem] font-semibold tracking-[0.16em] text-ember-foreground">
                {member.shared_count} IN COMMON
              </span>
            )}
          </div>
          {member.headline && <p className="mt-1 text-sm">{member.headline}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {[member.role_label, member.school, `joined ${relativeTime(member.created_at)}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      {member.target_roles.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          Looking for: {member.target_roles.map(titleCase).join(", ")}
        </p>
      )}

      {keywords.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {keywords.slice(0, 10).map((k) => (
            <span
              key={k}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                shared.has(k)
                  ? "bg-ember/15 text-ember-foreground"
                  : "border border-border bg-card text-muted-foreground"
              }`}
            >
              {k}
            </span>
          ))}
          {keywords.length > 10 && <Chip>+{keywords.length - 10}</Chip>}
        </div>
      )}

      {(member.linkedin_url || member.website) && (
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          {member.linkedin_url && (
            <a
              href={member.linkedin_url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary hover:underline"
            >
              LinkedIn ↗
            </a>
          )}
          {member.website && (
            <a
              href={member.website}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary hover:underline"
            >
              Website ↗
            </a>
          )}
        </div>
      )}
    </article>
  );
}
