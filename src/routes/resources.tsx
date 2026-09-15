import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AppShell } from "@/components/site/AppShell";

export const Route = createFileRoute("/resources")({
  head: () => ({ meta: [{ title: "Resources for Dallas Builders — Build Dallas" }] }),
  component: ResourcesPage,
});
const categories = [
  "Software & Cloud",
  "Legal",
  "Banking & Finance",
  "Hiring & Talent",
  "Workspace",
  "Corporate Programs",
  "Accelerators",
  "Fundraising",
  "Marketing & Growth",
  "Other",
];
const field =
  "w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary";

function ResourcesPage() {
  const [category, setCategory] = useState("");
  const [sent, setSent] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSent(true);
  };
  return (
    <AppShell
      kicker="Founder support"
      title={
        <>
          Resources for <span className="text-primary">Dallas Builders</span>
        </>
      }
      intro="Build Dallas works with ecosystem partners to aggregate resources, startup programs, software benefits, services, and opportunities for companies building in Dallas."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {categories.map((item, index) => (
          <button
            key={item}
            type="button"
            onClick={() => {
              setCategory(item);
              document.getElementById("resource-request")?.scrollIntoView({ behavior: "smooth" });
            }}
            className="group min-h-36 rounded-2xl border border-border bg-card p-5 text-left transition hover:-translate-y-1 hover:border-primary/60"
          >
            <span className="kicker text-primary">{String(index + 1).padStart(2, "0")}</span>
            <h2 className="mt-8 text-xl">{item}</h2>
          </button>
        ))}
      </div>
      <div className="mt-16 rounded-3xl border border-primary/25 bg-primary/10 p-8 sm:p-10">
        <span className="kicker text-primary">In progress</span>
        <p className="mt-4 max-w-3xl text-lg leading-relaxed">
          We're actively building partnerships and negotiating benefits for companies in the Build
          Dallas ecosystem.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Availability will vary by partner and company. Tell us what would be useful—we'll focus on
          tangible opportunities we can help you access today.
        </p>
      </div>
      <section
        id="resource-request"
        className="mt-20 grid gap-10 scroll-mt-28 md:grid-cols-[0.8fr_1.2fr]"
      >
        <div>
          <span className="kicker text-primary">Request a resource</span>
          <h2 className="mt-4 text-4xl">What would help you build faster?</h2>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Looking for something specific? Tell us what you need and we'll see what we can connect
            you with.
          </p>
        </div>
        <form
          onSubmit={submit}
          className="grid gap-4 rounded-3xl border border-border bg-card p-6 sm:grid-cols-2 sm:p-8"
        >
          <input required name="name" placeholder="Name" className={field} />
          <input required type="email" name="email" placeholder="Email" className={field} />
          <input name="company" placeholder="Company" className={field} />
          <input name="website" placeholder="Website" className={field} />
          <input
            required
            name="request"
            placeholder="What are you looking for?"
            className={`${field} sm:col-span-2`}
          />
          <select
            required
            name="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={`${field} text-muted-foreground sm:col-span-2`}
          >
            <option value="">Select a category</option>
            {categories.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <textarea
            name="details"
            placeholder="Additional details"
            rows={4}
            className={`${field} resize-none sm:col-span-2`}
          />
          {sent ? (
            <p className="rounded-xl bg-primary/15 px-4 py-3 text-sm text-primary sm:col-span-2">
              Thanks—we've received your request.
            </p>
          ) : (
            <button className="rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground sm:col-span-2">
              Request a Resource
            </button>
          )}
        </form>
      </section>
      <section className="mt-20 flex flex-wrap items-center justify-between gap-7 rounded-3xl border border-border bg-secondary/40 p-8 sm:p-10">
        <div>
          <span className="kicker text-primary">For service providers and programs</span>
          <h2 className="mt-3 text-3xl">Have a resource for founders?</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Help DFW startups access something genuinely useful.
          </p>
        </div>
        <a
          href="#resource-request"
          className="rounded-full border border-border bg-card px-6 py-3 text-sm font-semibold hover:bg-accent"
        >
          Partner With Build Dallas
        </a>
      </section>
    </AppShell>
  );
}
