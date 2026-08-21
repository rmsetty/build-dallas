import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { AppShell } from "@/components/site/AppShell";
import { cx } from "@/components/site/Primitives";
import { useAuth } from "@/lib/auth";

type Search = { redirect?: string | undefined };

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    redirect: typeof search["redirect"] === "string" ? (search["redirect"] as string) : undefined,
  }),
  head: () => ({ meta: [{ title: "Sign in — Build Dallas" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { user, loading, signIn, signUp } = useAuth();
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Already signed in (or just finished): go where the user was headed.
  useEffect(() => {
    if (!loading && user) navigate({ to: redirect ?? "/events" });
  }, [loading, user, redirect, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signin") {
        await signIn(email, password);
      } else {
        const { needsConfirmation } = await signUp(email, password);
        if (needsConfirmation) {
          setNotice("Check your inbox — confirm the email address to finish signing up.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      kicker="Accounts"
      title={mode === "signin" ? "Sign in to Build Dallas." : "Create your Build Dallas account."}
      intro="An account unlocks resume-based event matching and lets you suggest corrections to the wiki. Reading events and companies never requires one."
    >
      <div className="grid gap-10 md:grid-cols-[minmax(0,26rem)_1fr]">
        <form onSubmit={submit} className={`${cx.card} space-y-3`}>
          <label className="block">
            <span className="kicker text-muted-foreground">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={`mt-2 ${cx.input}`}
            />
          </label>
          <label className="block">
            <span className="kicker text-muted-foreground">Password</span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              className={`mt-2 ${cx.input}`}
            />
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && <p className="text-sm text-primary">{notice}</p>}

          <button type="submit" disabled={busy} className={`w-full ${cx.primary}`}>
            {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode((m) => (m === "signin" ? "signup" : "signin"));
              setError(null);
              setNotice(null);
            }}
            className="w-full pt-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {mode === "signin" ? "No account? Create one" : "Already have an account? Sign in"}
          </button>
        </form>

        <div className="space-y-4 self-start">
          {[
            [
              "Keyword matching",
              "Your resume is tokenized against the same vocabulary that tags every event, so /events can rank by overlap.",
            ],
            [
              "Wiki edits",
              "Suggest a fix to any company, event, or person. Two people agreeing applies it automatically.",
            ],
            [
              "Your data stays yours",
              "Profile rows are RLS-scoped to your user id — nobody else can read your resume text.",
            ],
          ].map(([h, p]) => (
            <article key={h} className="rounded-2xl border border-border p-5">
              <h3 className="text-lg">{h}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{p}</p>
            </article>
          ))}
          <p className="text-sm text-muted-foreground">
            Just browsing?{" "}
            <Link to="/events" className="font-medium text-primary hover:underline">
              Skip to the events →
            </Link>
          </p>
        </div>
      </div>
    </AppShell>
  );
}
