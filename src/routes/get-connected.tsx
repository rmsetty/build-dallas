import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AppShell } from "@/components/site/AppShell";

export const Route = createFileRoute("/get-connected")({
  head: () => ({ meta: [{ title: "Get Connected — Build Dallas" }] }),
  component: GetConnectedPage,
});
const needs = [
  "Software / Startup Resources",
  "Corporate Programs / Pilots",
  "Investor Connections",
  "Accelerators / Programs",
  "Community / Events",
  "Hiring / Talent",
  "Customers / Partnerships",
  "University / Research Connections",
  "Something Else",
];
const field =
  "w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary";

function GetConnectedPage() {
  const [selected, setSelected] = useState("");
  const [sent, setSent] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSent(true);
  };
  return (
    <AppShell
      kicker="Navigate the ecosystem"
      title={
        <>
          What do you <span className="text-primary">need?</span>
        </>
      }
      intro="Tell us what you're looking for and we'll try to connect you with the right people, programs, companies, or resources across Dallas–Fort Worth."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {needs.map((need) => (
          <button
            key={need}
            type="button"
            onClick={() => setSelected(need)}
            className={`min-h-24 rounded-2xl border p-5 text-left text-sm font-semibold transition ${selected === need ? "border-primary bg-primary/15 text-primary" : "border-border bg-card hover:-translate-y-0.5 hover:border-primary/50"}`}
          >
            <span className="flex items-center justify-between gap-4">
              {need}
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs ${selected === need ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}
              >
                {selected === need ? "✓" : "+"}
              </span>
            </span>
          </button>
        ))}
      </div>
      <section className="mt-16 grid gap-10 md:grid-cols-[0.75fr_1.25fr]">
        <div>
          <span className="kicker text-primary">Tell us more</span>
          <h2 className="mt-4 text-4xl">Start with the need—not the perfect introduction.</h2>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Keep it simple. A few useful details help us understand where to point you next.
          </p>
        </div>
        <form
          onSubmit={submit}
          className="grid gap-4 rounded-3xl border border-border bg-card p-6 sm:grid-cols-2 sm:p-8"
        >
          <input required name="name" placeholder="Name" className={field} />
          <input required type="email" name="email" placeholder="Email" className={field} />
          <input name="company" placeholder="Company / Organization" className={field} />
          <input name="website" placeholder="Website" className={field} />
          <input
            required
            name="need"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            placeholder="What are you looking for?"
            className={`${field} sm:col-span-2`}
          />
          <textarea
            required
            name="details"
            placeholder="Tell us more"
            rows={5}
            className={`${field} resize-none sm:col-span-2`}
          />
          {sent ? (
            <p className="rounded-xl bg-primary/15 px-4 py-3 text-sm text-primary sm:col-span-2">
              Thanks—we'll review your request and follow up.
            </p>
          ) : (
            <button className="rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground sm:col-span-2">
              Get Connected
            </button>
          )}
        </form>
      </section>
    </AppShell>
  );
}
