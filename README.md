# Revenue Express

The marketing site, the public blog, and the **Command Center** — an internal
portal for first-party analytics, the lead pipeline, the blog CMS and team
accounts.

One Next.js app serves all three, so the blog's SEO authority lands on the main
domain rather than a subdomain.

```
/                     marketing site (the original HTML, server-rendered)
/blog                 public blog index
/blog/<slug>          article pages, with OG tags and BlogPosting JSON-LD
/login                staff sign-in (no public signup)
/admin                Overview · Traffic · Audience · Leads · Blog · Team
/api/track            analytics ingest (called by /js/track.js)
/api/leads            lead capture (called by the contact form)
/sitemap.xml          generated from published posts
```

---

## Running it locally

```bash
npm install
npm run db:migrate                                  # create the tables
npm run admin:create -- you@company.com "Your Name"  # first super admin
npm run dev                                         # http://localhost:3000
```

With no `DATABASE_URL` the app runs **PGlite** — a real Postgres compiled to
WASM, stored in `.pgdata/`. Nothing to install, and it speaks the same SQL that
production will.

> **One process at a time.** PGlite is single-writer: stop the dev server before
> running a script like `db:seed`, or the two will fight over the lock. This
> limitation disappears once `DATABASE_URL` points at a real Postgres.

Want demo numbers on the dashboard before you have real traffic?

```bash
npm run db:seed          # ~400 sessions, 8 leads, 3 posts
npm run db:seed -- wipe  # remove them again
```

---

## Deploying to Vercel

1. **Create a Postgres database.** Neon, Supabase and Vercel Postgres all have
   a free tier that comfortably covers this. Copy the connection string.
2. **Import the repo** at vercel.com → New Project. It detects Next.js on its
   own; no build settings to change.
3. **Set the environment variables** (Project → Settings → Environment
   Variables):

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | your Postgres connection string |
   | `NEXT_PUBLIC_SITE_URL` | `https://revenueexpress.com` — used for canonical URLs, OG tags and the sitemap |
   | `TRUST_PROXY` | leave unset on Vercel or Cloudflare. Set to `1` only behind your own reverse proxy — see below |

   Rate limits key on the caller's IP. `X-Forwarded-For` is a header the *client*
   sends, so it is ignored unless `TRUST_PROXY=1` says a proxy you control
   rewrites it; otherwise anyone could pick their own limit bucket. On Vercel and
   Cloudflare the edge sets its own header and this is handled for you.

4. **Create the tables and the first admin.** Point your shell at production
   once and run:

   ```bash
   DATABASE_URL="postgres://…" npm run db:migrate
   DATABASE_URL="postgres://…" npm run admin:create -- you@company.com "Your Name"
   ```

5. **Point the domain at Vercel** and turn GitHub Pages off — Pages serves
   static files only and cannot run any of the portal.

---

## How the pieces work

### Accounts
No public signup exists. The super admin adds people in **Team**, and the system
issues a one-time password shown exactly once — only its bcrypt hash is stored.
The teammate must replace it on first sign-in.

Sessions live in the database rather than in a stateless token, so deactivating
someone takes effect immediately instead of whenever their token would expire.
Failed logins are rate limited per account and, more loosely, per IP; a correct
password clears the counter so an office behind one NAT cannot lock itself out.

### Analytics
`public/js/track.js` (~2 KB, no dependencies) posts to `/api/track`. The visitor
id is a random value in `localStorage`, there is no cross-site identifier and
nothing personal is collected — which is why no cookie banner is needed.

Each visit is rolled up into `analytics_sessions` as it happens, so the
dashboard's bounce rate, views/session and scroll depth are single-table
aggregates rather than scans over a raw event log.

"Engaged" means 15s+ on the page or 50%+ scrolled, matching the label shown on
the Traffic tab.

### Leads
The contact form collects name, email, brand, phone, monthly ad spend and what
they want to scale, and posts to `/api/leads`. The lead panel in the portal
shows exactly those fields — plus the visit that produced the enquiry. A hidden honeypot field catches bots —
they get a success response so they do not learn they were caught. Leads move
through New → Contacted → Qualified → Won/Lost, and every stage change is
written to the activity log with who moved it.

### Blog
Posts are Markdown, rendered and **sanitised server-side** — an editor account
is not a reason to allow `<script>` onto a public page. Drafts 404 publicly
until published. Publishing stamps the date once, so later edits do not reorder
the blog. Published posts appear in `sitemap.xml` automatically.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | dev server |
| `npm run build` / `npm start` | production build and serve |
| `npm run db:migrate` | apply `db/schema.sql` (idempotent) |
| `npm run db:seed [-- wipe]` | demo traffic, leads and posts |
| `npm run admin:create -- <email> "<name>" [password]` | first super admin |
| `npm run db:cleanup` | remove rows the test suites created |
| `npm test` | every suite, each against a clean database |
| `npm run test:site` / `test:portal` / `test:responsive` / `test:security` | one suite |

`tools/` holds the image utilities used to build the site's assets:
`extract-client-logos.py` (slices the client logo wall) and
`clean-ad-screenshots.py` (trims the ad creatives).

---

## Tests

```bash
npm run build     # the suites run against a production build
npm test
```

229 checks in four suites, driving a real Chrome over the DevTools Protocol with
no test dependencies added to the project:

| Suite | What it covers |
| --- | --- |
| `site` | the marketing page, its assets, layout, navigation, the contact form, the blog and its SEO output |
| `portal` | sign-in, all six tabs, analytics end to end, the lead pipeline, the blog CMS, provisioning and roles |
| `responsive` | eight screens from a 360px phone to a 1920px desktop, including iOS and Android user agents |
| `security` | an adversarial pass: forced password change, flood limits, injection, XSS, session handling, headers, data exposure |

Two things worth knowing if you extend them:

- **Rendering is asserted in pixels.** `tests/pixels.mjs` decodes screenshots with
  Node's own zlib and counts ink. Computed styles report the right colour and box
  for text that paints nothing — that is exactly how the mobile headline stayed
  broken through a passing test.
- **Each suite gets a clean database.** The runner stops the server, clears test
  rows and starts it again between suites, because the embedded database takes a
  single writer and leftover rows sit inside the lead flood limit's window.

Chrome is the only engine available here, so the suites cannot prove WebKit
behaviour. The iOS rows run Safari's user agent at Safari's viewport sizes, which
covers the size- and feature-detection branches but not the engine itself.
