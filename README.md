# Lovely Website Forge

make this a good website

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/b42132a8-6a80-441d-ae35-59ca460ab896).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Build Dallas app routes

Every route reads live data from Supabase in the browser — no Worker sits in the
read path. The home page is not a brochure: its tab bar queries the same tables
the full pages do.

| route | what it does |
|---|---|
| `/` | Hero plus a live tabbed workspace (Events / Companies / People) with real rows and search, and counters from `ecosystem_stats()`. |
| `/events` | Upcoming DFW events, filterable by date window, tag, and free text. Signed-in users with a profile can switch the sort to keyword-match ranking. |
| `/companies` | Company directory. Scope (DFW / all Texas), stage, activity signal, tag and free text; sorted by the freshest evidence that the company is live. |
| `/people` | Member directory, ranked by keyword overlap with you, plus the mapped ecosystem people. Listing is opt-in. |
| `/profile` | Resume or LinkedIn PDF upload, parsed in the browser with pdf.js and matched by `apply_resume_text()`. Also holds your directory listing and the visibility switch. |
| `/wiki` | Community corrections. Any signed-in user can suggest a field change; two people agreeing (or a company's verified owner) applies it automatically. |
| `/login` | Supabase email/password auth. Only profile edits and wiki edits are gated — reads are public. |

### Company discovery

`workers/` runs two pipelines. `npm run pipeline` collects events; `npm run
companies` collects the companies being built, from four free, keyless sources:

| source | signal | notes |
|---|---|---|
| SEC Form D (EDGAR full-text search) | `raising` | Filed within 15 days of first sale, usually months before any press. Funds excluded via the filer's own Item 3C claim. |
| Capital Factory portfolio | `portfolio` | 835 companies published as schema.org `Organization` JSON-LD. Texas-wide, not DFW-only. |
| Y Combinator (yc-oss mirror) | `yc` | Small volume, best record quality. Matched per-location so "Frisco, CO" never counts as Frisco, TX. |
| Health Wildcatters portfolio | `accelerator` | Dallas healthtech. Logo wall only — names recovered from image alt text. |

Two Postgres-only passes then run: `extract_companies_from_events()` mines new
company names out of event text, and `link_events_to_companies()` connects every
known company to the events naming it, which is what keeps `last_seen_at` honest.

Every company card shows its `signal` (why we think it is live), when we saw that
evidence, and which directories reported it — two independent sources agreeing is
a stronger record than one, and the UI says so.

### Privacy

Profiles are private by default. `public.profiles` gained a "readable when
`is_public`" policy for the member directory, so resume text was moved out to
`public.profile_resumes`, which stays owner-only. Nothing on a profile row is
anything but directory content.

### Environment

Copy `.env.example` to `.env` and fill in your project's values:

```sh
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

Both are safe in the browser: every table is behind RLS, so the publishable key
can only read what `anon` is allowed to read and can only write a `wiki_edits`
row as the signed-in user.

Ranking, keyword matching, dedupe, company merging, and the wiki auto-apply rules
all run inside Postgres. The frontend issues one PostgREST request per view and
does no scoring of its own.
