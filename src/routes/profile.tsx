import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/site/AppShell";
import { Chip, EmptyState, ErrorState, LoadingRows, cx } from "@/components/site/Primitives";
import { EventCard } from "./events";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { KeywordRow, ProfileRow, RankedEvent } from "@/lib/database.types";
import { detectSchool, extractPdfText, matchCompanyNames } from "@/lib/resume";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "Your profile — Build Dallas" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <AppShell kicker="Your profile" title="Loading your profile…">
        <LoadingRows count={2} />
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell
        kicker="Your profile"
        title="Sign in to build your match profile."
        intro="Your resume is matched against the same keyword vocabulary that tags every event, entirely inside Postgres. Nothing is sent to an external API."
      >
        <EmptyState
          title="An account is required"
          body="Profiles are row-level-secured to your user id, so we need to know who you are before storing anything."
          action={
            <Link to="/login" search={{ redirect: "/profile" }} className={cx.primary}>
              Sign in or create an account
            </Link>
          }
        />
      </AppShell>
    );
  }

  return <ProfileEditor />;
}

function ProfileEditor() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState("");
  const [storeRaw, setStoreRaw] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: async (): Promise<ProfileRow | null> => {
      const { data, error } = await supabase.from("profiles").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const roleKeywords = useQuery({
    queryKey: ["keywords", "role"],
    queryFn: async (): Promise<KeywordRow[]> => {
      const { data, error } = await supabase
        .from("keywords")
        .select("*")
        .eq("category", "role")
        .eq("active", true)
        .order("term");
      if (error) throw error;
      return data ?? [];
    },
  });

  const profile = profileQuery.data;

  // Resume text lives in profile_resumes, not on the profile row: profiles is
  // readable by other members once you publish, and this never should be.
  const resumeQuery = useQuery({
    queryKey: ["profile-resume"],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("profile_resumes")
        .select("raw_text")
        .maybeSingle();
      if (error) throw error;
      return data?.raw_text ?? null;
    },
  });
  const storedResume = resumeQuery.data;

  // Seed the textarea with whatever was stored last, so re-running extraction
  // after editing the text is possible without re-uploading the PDF.
  useEffect(() => {
    if (storedResume && !text) setText(storedResume);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedResume]);

  const analyze = useMutation({
    mutationFn: async (resumeText: string) => {
      const { data: keywords, error } = await supabase.rpc("apply_resume_text", {
        p_text: resumeText,
        p_store_raw: storeRaw,
      });
      if (error) throw error;

      // School and company mentions are derived in the browser and written to
      // the caller's own profile row; RLS makes that safe without a Worker.
      const school = detectSchool(resumeText);
      if (school) await supabase.from("profiles").update({ school }).eq("id", profile!.id);

      const { data: companies } = await supabase.from("companies").select("id,name").limit(1000);
      const mentioned = matchCompanyNames(resumeText, companies ?? []);

      return { keywords: keywords ?? [], school, mentioned };
    },
    onSuccess: (result) => {
      setStatus(
        `Matched ${result.keywords.length} keyword${result.keywords.length === 1 ? "" : "s"}` +
          (result.school ? ` · school: ${result.school}` : ""),
      );
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["profile-resume"] });
      queryClient.invalidateQueries({ queryKey: ["recommended"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });

  const toggleRole = useMutation({
    mutationFn: async (role: string) => {
      const current = profile?.target_roles ?? [];
      const next = current.includes(role) ? current.filter((r) => r !== role) : [...current, role];
      const { error } = await supabase
        .from("profiles")
        .update({ target_roles: next })
        .eq("id", profile!.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile"] }),
  });

  const saveDetails = useMutation({
    mutationFn: async (patch: Partial<ProfileRow>) => {
      const { error } = await supabase.from("profiles").update(patch).eq("id", profile!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
    },
  });

  const recommended = useQuery({
    queryKey: ["recommended", profile?.keywords],
    enabled: Boolean(profile?.keywords?.length),
    queryFn: async (): Promise<RankedEvent[]> => {
      const { data, error } = await supabase.rpc("recommended_events", {
        p_limit: 12,
        p_only_matches: true,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const onFile = async (file: File) => {
    setParseError(null);
    setStatus(null);
    try {
      const extracted =
        file.type === "application/pdf" ? await extractPdfText(file) : await file.text();
      if (!extracted.trim())
        throw new Error("No selectable text found — this may be a scanned PDF.");
      setText(extracted);
      analyze.mutate(extracted);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Could not read that file.");
    }
  };

  const keywords = profile?.keywords ?? [];

  return (
    <AppShell
      kicker="Your profile"
      title={
        <>
          Your background,
          <br />
          <span className="text-primary">turned into a filter.</span>
        </>
      }
      intro="Upload a resume or LinkedIn export. We extract the terms that overlap our event vocabulary and rank every upcoming event against them — no embeddings, no external API calls."
    >
      {/*
        Both tracks are minmax(0,…) and both children carry min-w-0: a grid
        track defaults to min-width:auto, so a single long unbreakable string —
        a raw error, a pasted resume line, a long event title — was widening the
        track past the container and crushing the layout to the left.
      */}
      <div className="grid gap-10 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        {/* Upload column */}
        <div className="min-w-0 space-y-5">
          <div className={`${cx.card} space-y-4`}>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.txt,.md"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border bg-muted/40 px-6 py-12 transition-colors hover:bg-accent"
            >
              <span className="text-2xl">↑</span>
              <strong>Upload resume or LinkedIn PDF</strong>
              <span className="text-xs text-muted-foreground">
                PDF · TXT · parsed in your browser
              </span>
            </button>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or paste it
              <span className="h-px flex-1 bg-border" />
            </div>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder="Paste resume text, a LinkedIn 'About' section, or anything describing what you work on."
              className={`${cx.input} max-w-full resize-y`}
            />

            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={storeRaw}
                onChange={(e) => setStoreRaw(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Keep the raw text for next time (stored in a table only you can read)
            </label>

            <button
              type="button"
              disabled={!text.trim() || analyze.isPending}
              onClick={() => analyze.mutate(text)}
              className={`w-full ${cx.primary}`}
            >
              {analyze.isPending ? "Matching…" : "Extract keywords"}
            </button>

            {parseError && <p className="break-words text-sm text-destructive">{parseError}</p>}
            {analyze.error && (
              <p className="break-words text-sm text-destructive">{String(analyze.error)}</p>
            )}
            {status && <p className="break-words text-sm text-primary">{status}</p>}
          </div>

          {profile?.school && (
            <div className="rounded-2xl border border-border p-5">
              <span className="kicker text-muted-foreground">School</span>
              <p className="mt-1 text-lg">{profile.school}</p>
            </div>
          )}

          {profile && <VisibilityCard profile={profile} save={saveDetails} />}
        </div>

        {/* Result column */}
        <div className="min-w-0 space-y-8">
          <section>
            <h2 className="text-2xl">Your keywords</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              These are matched against each event's tags with a Postgres array intersection.
            </p>
            {profileQuery.isPending ? (
              <LoadingRows count={1} />
            ) : keywords.length === 0 ? (
              <p className="mt-4 rounded-2xl border border-dashed border-border bg-muted/40 px-5 py-8 text-center text-sm text-muted-foreground">
                Nothing extracted yet — upload or paste a resume to get started.
              </p>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {keywords.map((k) => (
                  <span
                    key={k}
                    className="rounded-full bg-ember px-3 py-1.5 text-xs font-medium text-ember-foreground"
                  >
                    {k}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-2xl">Roles you're targeting</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Optional. Stored on your profile for future matching work.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {(roleKeywords.data ?? []).map((k) => (
                <Chip
                  key={k.term}
                  active={(profile?.target_roles ?? []).includes(k.term)}
                  onClick={() => toggleRole.mutate(k.term)}
                >
                  {k.term}
                </Chip>
              ))}
            </div>
          </section>

          <section>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-2xl">Recommended for you</h2>
              <Link to="/events" className="text-sm font-medium text-primary hover:underline">
                See all events →
              </Link>
            </div>
            {/*
              Capped and scrolled in place: the ranked list runs to a dozen
              cards and was pushing the whole page down past the controls that
              produce it.
            */}
            <div className="mt-4 max-h-[34rem] space-y-4 overflow-y-auto rounded-2xl border border-border bg-muted/30 p-4">
              {recommended.error ? (
                <ErrorState error={recommended.error} />
              ) : keywords.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border bg-muted/40 px-5 py-8 text-center text-sm text-muted-foreground">
                  Add keywords first and ranked events show up here.
                </p>
              ) : recommended.isPending ? (
                <LoadingRows count={2} />
              ) : (recommended.data ?? []).length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border bg-muted/40 px-5 py-8 text-center text-sm text-muted-foreground">
                  No upcoming event overlaps your keywords yet. The list refreshes as the pipeline
                  ingests new events.
                </p>
              ) : (
                (recommended.data ?? []).map((event) => (
                  <EventCard key={event.id} event={event} highlight />
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

const ROLE_LABELS = [
  "Founder / Builder",
  "Investor",
  "Researcher / University",
  "Corporate / Operator",
  "Student",
  "Community Organizer",
  "Other",
] as const;

/**
 * Directory identity and the visibility switch.
 *
 * Publishing is opt-in and off by default. That is why the resume moved to its
 * own table: this toggle flips a row-level policy on public.profiles, so every
 * column on that row has to be something the member meant to show.
 */
function VisibilityCard({
  profile,
  save,
}: {
  profile: ProfileRow;
  save: { mutate: (patch: Partial<ProfileRow>) => void; isPending: boolean };
}) {
  const [form, setForm] = useState({
    display_name: profile.display_name ?? "",
    headline: profile.headline ?? "",
    role_label: profile.role_label ?? "",
    linkedin_url: profile.linkedin_url ?? "",
    website: profile.website ?? "",
  });
  const [saved, setSaved] = useState(false);

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
      setSaved(false);
    },
  });

  const submit = () => {
    save.mutate({
      display_name: form.display_name.trim() || null,
      headline: form.headline.trim() || null,
      role_label: form.role_label || null,
      linkedin_url: form.linkedin_url.trim() || null,
      website: form.website.trim() || null,
    });
    setSaved(true);
  };

  return (
    <div className={`${cx.card} space-y-4`}>
      <div>
        <h2 className="text-xl">Your listing</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What other members see on the People page.
        </p>
      </div>

      <input
        {...field("display_name")}
        placeholder="Display name"
        aria-label="Display name"
        className={cx.input}
      />
      <input
        {...field("headline")}
        placeholder="One line — what you're working on"
        aria-label="Headline"
        className={cx.input}
      />
      <select {...field("role_label")} aria-label="Role" className={`w-full ${cx.select}`}>
        <option value="">I am a…</option>
        {ROLE_LABELS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <input
        {...field("linkedin_url")}
        placeholder="LinkedIn URL (optional)"
        aria-label="LinkedIn URL"
        className={cx.input}
      />
      <input
        {...field("website")}
        placeholder="Website (optional)"
        aria-label="Website"
        className={cx.input}
      />

      <button
        type="button"
        onClick={submit}
        disabled={save.isPending}
        className={`w-full ${cx.secondary}`}
      >
        {save.isPending ? "Saving…" : saved ? "Saved" : "Save listing"}
      </button>

      <div
        className={`flex items-start gap-3 rounded-xl border p-4 ${
          profile.is_public ? "border-ember/40 bg-ember/10" : "border-border bg-muted/40"
        }`}
      >
        <input
          id="is-public"
          type="checkbox"
          checked={profile.is_public}
          onChange={(e) => save.mutate({ is_public: e.target.checked })}
          className="mt-0.5 h-4 w-4 rounded border-border"
        />
        <label htmlFor="is-public" className="text-sm">
          <strong className="block">
            {profile.is_public ? "You're listed in the directory" : "List me in the directory"}
          </strong>
          <span className="text-muted-foreground">
            Shows your name, headline, role, school and keywords on{" "}
            <Link to="/people" className="text-primary hover:underline">
              People
            </Link>
            . Your resume text is never included. Turn this off any time.
          </span>
        </label>
      </div>
    </div>
  );
}
