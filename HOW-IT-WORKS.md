# How it works

A plain-English walkthrough of what runs behind Revenue Express: what happens
on every visit, where the numbers on the dashboard come from, how a lead
travels from the contact form to the pipeline, how accounts and the blog work,
and what protects it all.

If you only read one section, read **[The shape of the system](#1-the-shape-of-the-system)**.

---

## Contents

1. [The shape of the system](#1-the-shape-of-the-system)
2. [The database](#2-the-database)
3. [Accounts, sessions and access](#3-accounts-sessions-and-access)
4. [Analytics: from a visit to a dashboard number](#4-analytics-from-a-visit-to-a-dashboard-number)
5. [Leads: from the contact form to the pipeline](#5-leads-from-the-contact-form-to-the-pipeline)
6. [The blog and how it earns SEO](#6-the-blog-and-how-it-earns-seo)
7. [Security](#7-security)
8. [What happens on deploy](#8-what-happens-on-deploy)
9. [Costs, limits and what to watch](#9-costs-limits-and-what-to-watch)
10. [Common tasks](#10-common-tasks)

---

## 1. The shape of the system

There is **one application**. It serves the marketing site, the public blog and
the internal portal from the same domain and the same deployment.

```
                    ┌──────────────────────────────────────────┐
  visitor  ───────► │  Next.js app (Vercel)                    │
                    │                                          │
                    │   /            marketing site            │
                    │   /blog        public blog               │
                    │   /login       staff sign-in             │
                    │   /admin       Command Center            │
                    │   /api/*       endpoints                 │
                    └───────────────┬──────────────────────────┘
                                    │ SQL
                                    ▼
                          ┌───────────────────┐
                          │  Postgres         │
                          │  9 tables         │
                          └───────────────────┘
```

**Why one app rather than two.** The blog's whole purpose is SEO. Search engines
credit authority to a *domain*. If the blog lived on `blog.revenueexpress.com`
or a separate host, the authority its articles earn would accumulate somewhere
other than the site you actually want to rank. Keeping `/blog` on the main
domain means every article strengthens the domain that sells.

**Why "server-rendered" matters.** Every public page arrives at the browser as
finished HTML. A crawler that does not run JavaScript still sees the full
article text, the headings and the meta tags. Had the blog been a client-side
app fetching posts after load, crawlers would frequently see an empty shell.

**The three layers.**

| Layer | Where | What it does |
| --- | --- | --- |
| Pages | `app/` | What the visitor sees. Mostly server components: they query the database directly and return HTML. |
| Endpoints | `app/api/` | Accept data — a tracked event, a lead, a login, a blog post. Validate, then write. |
| Logic | `lib/` | The real work: `db.ts`, `auth.ts`, `session.ts`, `analytics.ts`, `leads.ts`, `posts.ts`. Pages and endpoints stay thin and call into here. |

---

## 2. The database

Nine tables. Every query is parameterised — values are sent separately from the
SQL, never pasted into the string — which is what makes SQL injection
structurally impossible rather than merely unlikely.

| Table | Holds |
| --- | --- |
| `users` | staff accounts: email, name, role, bcrypt password hash, active flag |
| `sessions` | live sign-ins, one row per device |
| `login_attempts` | failed and successful sign-ins, for rate limiting |
| `analytics_sessions` | one row per visit, with running totals |
| `analytics_pageviews` | one row per page viewed, with time and scroll |
| `analytics_events` | discrete events: CTA clicks, form starts, submissions |
| `leads` | everyone who submits the contact form |
| `lead_notes` | notes and stage changes, with who and when |
| `posts` | blog posts, drafts included |

### Two databases, one dialect

- **In production:** real Postgres (Neon, Supabase or Vercel Postgres).
- **On your machine:** if `DATABASE_URL` is unset, the app runs **PGlite** —
  Postgres compiled to WebAssembly, storing to `.pgdata/`.

`lib/db.ts` picks between them at startup and exposes one `query()` function, so
**the same SQL runs in both**. You can develop with nothing installed, and
nothing behaves differently when it reaches production.

> PGlite is single-writer. Stop the dev server before running a script like
> `db:seed`, or the two processes will contend for the lock. This restriction
> disappears the moment `DATABASE_URL` points at a real server.

---

## 3. Accounts, sessions and access

### There is no signup page

Deliberately. This is an internal tool, so the only way to get an account is for
an admin to create one.

**Creating a teammate** (Team tab → Add a teammate):

1. Admin enters a name, email and access level.
2. The system generates a readable one-time password — `Kfp3-Xm9tR-2vQ` style,
   no ambiguous characters, so it survives being read aloud.
3. It is hashed with **bcrypt** (cost 12) and only the hash is stored. The
   plain password is shown to the admin **once** and is then unrecoverable.
4. The account is flagged `must_change_password`.

**First sign-in:** the teammate is sent straight to the password screen and
cannot reach the dashboards until they have set their own password. Changing it
signs out every other device.

### Why sessions live in the database

When someone signs in, the server generates a random token, stores its **SHA-256
hash** in `sessions`, and sends the token to the browser as an `HttpOnly`
cookie. `HttpOnly` means JavaScript cannot read it, so a script injected onto
the page cannot steal the session.

The common alternative — a self-contained JWT — cannot be revoked. If you fired
someone, their token would keep working until it expired.

Here, **deactivating a teammate deletes their sessions and takes effect on their
very next click.** That was worth the one extra database read per request.

### Two roles

| | Member | Admin |
| --- | --- | --- |
| Dashboards, leads, blog | ✅ | ✅ |
| Create / deactivate accounts | ❌ | ✅ |
| Reset another person's password | ❌ | ✅ |

The system refuses to let the last active admin be deactivated or demoted —
otherwise nobody could ever provision an account again.

---

## 4. Analytics: from a visit to a dashboard number

### What runs in the browser

`public/js/track.js` — about 2 KB, no dependencies.

It assigns two identifiers:

- a **visitor id**, random, kept in `localStorage`, so returning visitors are
  recognised as the same person;
- a **session id**, kept in `sessionStorage`, expiring after 30 idle minutes,
  which is the industry convention for a "visit".

Both are random values generated in the browser. **There is no name, no email,
no fingerprint and no cross-site identifier.** That is what keeps this outside
cookie-banner territory: nothing personal is collected.

It reports:

| Event | When |
| --- | --- |
| `pageview` | on load |
| `section_view` | each section of the page first comes properly into view |
| `scroll` | as you scroll, recording the deepest point reached |
| `engaged` | at 15 seconds, or 50% scrolled — whichever comes first |
| `cta_click` | any button or call-to-action click, with its label |
| `form_start` | first keystroke in the contact form |
| `form_submit` | successful submission |
| `heartbeat` | when the tab is hidden or closed, carrying the final time and scroll |

The closing beat uses `navigator.sendBeacon`, which browsers deliver even as the
page is being destroyed — which is exactly when the final numbers matter.

### What happens on the server

`POST /api/track` validates the payload, then does two things:

1. Appends a row to `analytics_pageviews` or `analytics_events`.
2. **Updates the running totals on the visit's row** in `analytics_sessions` —
   deepest scroll, longest duration, CTA count, engaged flag.

That second step is the important design decision. Because each visit is
summarised *as it happens*, the dashboard reads a handful of pre-aggregated
rows instead of scanning a raw event log. Bounce rate, views-per-session and
scroll depth become simple averages over one table. The dashboard stays fast at
a million events, not just a thousand.

Totals use `GREATEST(existing, incoming)`, so a beacon that arrives late can
never walk a session's numbers backwards.

### How each figure is defined

| Metric | Definition |
| --- | --- |
| **Unique visitors** | distinct visitor ids in the period |
| **Page views** | rows in `analytics_pageviews` |
| **Sessions** | visits — a new one starts after 30 idle minutes |
| **Bounce rate** | visits with one page view that never became engaged |
| **Engaged sessions** | visits with 15s+ or 50%+ scroll |
| **Avg. time on page** | mean of per-page durations, ignoring zeroes |
| **Avg. scroll depth** | mean of the deepest scroll per visit |
| **CTA clicks** | `cta_click` events, broken down by which button |
| **How far they get** | share of visits reaching each section of the page |
| **New vs returning** | whether the visitor had been here before this window |
| **Lead conversion** | leads created ÷ unique visitors |

Every card also shows a **change figure**. That compares the selected window
against the window immediately before it — the last 30 days against the 30 days
prior. Early on you will see "▲ 100%" a lot, which simply means the previous
window had no data to compare against.

### Why "how far they get" replaces "top pages"

The marketing site is **one page with eleven anchor sections** plus the blog. On
a site like that, "which page did they view" is nearly always "/" and tells you
nothing. What matters is how far down the story a visitor gets before leaving.

The tracking script watches each section come into view and reports it once. The
dashboard then shows the share of visits reaching each one, in page order, so it
reads as a funnel down the page:

```
Hero            69%
Proof stats     62%
The problem     56%
The engine      50%
Framework       42%   ← where attention starts dropping
Avatar discovery 36%
Distribution    31%
```

That points straight at the section to rewrite. A "top pages" list never could.

### The funnel

Visitors → CTA Clicks → Form Starts → Submissions, each step showing its
conversion against the step above. A big drop between *CTA Clicks* and *Form
Starts* means people are reaching the form and not beginning it; a drop between
*Form Starts* and *Submissions* means the form itself is losing them.

---

## 5. Leads: from the contact form to the pipeline

**Before this build, the contact form threw submissions away.** It played a
confetti animation and discarded the data. Nothing was stored, nothing was sent.

Now:

The form asks for **name, email, brand, phone, monthly ad spend** and what they
want to scale. Every field it collects appears on the lead panel, and nothing
appears there that the form does not collect — the panel is derived from the
form, not from a template.

1. Visitor fills in the form on the marketing page.
2. First keystroke fires `form_start` — that is the funnel's third step.
3. On submit, the browser posts to `POST /api/leads`.
4. The server validates the shape of the data (a real email, sane lengths).
5. **Honeypot check.** The form contains a `website` field hidden from people
   but visible to bots. Anything that fills it in gets a *success* response and
   is silently discarded, so the bot never learns it was caught.
6. **Flood check.** More than three submissions from the same visitor in ten
   minutes are refused politely.
7. The lead is written to `leads` with `status = 'new'`, along with which page
   it came from and which analytics session it belonged to.
8. A `form_submit` event is recorded, completing the funnel.
9. The Leads tab badge increments immediately.

### The pipeline

**New → Contacted → Qualified → Won / Lost.**

Because each lead stores the analytics session it came from, the panel also
shows **the visit behind the enquiry**: where they arrived from, how long they
stayed, how far down the page they got, and how many CTAs they clicked. That is
the context that tells you whether to call them first.

Clicking a stage writes the change and appends a line to the activity log —
*"Armaghan moved this from new to qualified"* — so the team can see who did what.
Notes can be added to the same log. Email and WhatsApp buttons open pre-addressed
messages.

Filters (stage, brand vs creator, free-text search) run as SQL, not in the
browser, so they stay fast as the list grows.

---

## 6. The blog and how it earns SEO

Posts are written in **Markdown** in the Command Center and stored in `posts`.

### Draft and publish

A draft is invisible to the public — `/blog/your-slug` returns a genuine 404,
not a hidden page. Publishing stamps `published_at` **once**; later edits update
the content without reordering the blog.

### The URL

Slugs are generated from the title (`Best TikTok Shop Agencies` →
`best-tiktok-shop-agencies`) and made unique automatically. You can override it.
Slugs are stable once published — changing one breaks any link pointing at it.

### What each article emits

- A `<title>` and meta description (the SEO fields, falling back to the title
  and excerpt).
- A **canonical URL**, so a post reachable by more than one address does not
  compete with itself.
- **Open Graph and Twitter tags**, so links unfurl properly in messages.
- **`BlogPosting` structured data** — machine-readable headline, dates, author
  and keywords, which is what qualifies a result for richer treatment.

The editor shows a **live preview of the Google result** as you type, so you can
see the title and description the way a searcher will.

### The sitemap

`/sitemap.xml` is generated on request from the database. Publishing a post puts
it in the sitemap immediately; no rebuild, no manual step. `/robots.txt` points
crawlers at the sitemap and keeps them out of `/admin`, `/login` and `/api`.

### Why Markdown is sanitised

Post content is converted to HTML on the server and then **stripped of anything
dangerous** — `<script>` tags, `onerror` handlers, and similar. Only staff can
write posts, but an editor account is not a reason to allow arbitrary JavaScript
onto a public page: one compromised account should not become a compromised
site. External links automatically get `rel="noopener noreferrer"`.

---

## 7. Security

| Risk | What stops it |
| --- | --- |
| Password theft from a database leak | bcrypt (cost 12) — hashes are impractical to reverse |
| Session theft via injected script | `HttpOnly` cookie; JavaScript cannot read it |
| A fired employee keeping access | sessions are server-side; deactivation is immediate |
| Password guessing | rate limited per account, and more loosely per IP |
| Finding out which emails have accounts | identical error and timing for wrong password and unknown account |
| SQL injection | every query parameterised; values never concatenated into SQL |
| XSS through blog content | server-side sanitising with an allowlist |
| Spam in the pipeline | hidden honeypot field plus a flood limit keyed on the caller's observed IP |
| A provisioned account being used before its owner claims it | the one-time password unlocks nothing but the password screen |
| Flooding the analytics tables | per-IP cap on the tracking endpoint |
| Clickjacking / MIME sniffing | `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` |
| Injected script finding somewhere to run or somewhere to send data | `Content-Security-Policy` |
| A page quietly asking for the camera, mic or location | `Permissions-Policy` denies all of them |
| Portal appearing in search results | `robots.txt` disallow plus `noindex` on portal pages |

**On the rate limiter.** Per-account limiting is strict; per-IP is deliberately
looser, because an entire office shares one address and colleagues should not be
able to lock each other out. A correct password clears the counter, so an
earlier run of failures cannot strand someone who then signs in successfully.

**On what counts as "the caller's IP".** Every limit keys on this value, so a
caller who can choose it has no limits at all. `X-Forwarded-For` is a header
*the client sends*, so it is ignored by default. The IP comes from the header
the hosting edge sets and overwrites — `x-vercel-forwarded-for` on Vercel,
`cf-connecting-ip` on Cloudflare. Behind your own reverse proxy, set
`TRUST_PROXY=1`; `X-Forwarded-For` is then honoured, but read from the *end* of
the chain — the entry your proxy appended, describing the connection it actually
received — rather than the start, which the client wrote.

**On the one-time password.** Until a new teammate replaces it, their account can
do exactly one thing: set a password. The guard is server-side, in `requireUser()`,
so it holds for the API as well as the screens — a client that simply declines to
follow the redirect gets 403 from every endpoint.

**What is deliberately *not* here:** two-factor authentication, and password
reset by email. Both need an email service wired up. Right now, a forgotten
password is fixed by an admin clicking **Reset password**, which issues a fresh
one-time password. For a small internal team that is a reasonable trade; if the
team grows, 2FA is the first thing I would add.

---

## 8. What happens on deploy

1. You push to GitHub.
2. Vercel builds the app and runs it in its own environment.
3. Public pages are served from the edge; pages that read the database are
   rendered per request.
4. `DATABASE_URL` connects the running app to Postgres.

The database is **separate from the deployment**. Deploying does not touch your
data; leads and posts survive every deploy. Conversely, a schema change needs
`npm run db:migrate` run against production — the deploy will not do it for you.

**GitHub Pages cannot host this.** Pages serves static files only: no server, no
database, no logins. The domain has to point at Vercel.

---

## 9. Costs, limits and what to watch

**Cost at your scale: nothing.** Vercel's Hobby tier and a free Neon/Supabase
database comfortably cover a marketing site with a blog and a handful of staff
accounts. Cost appears at serious traffic, or when you want the team on a paid
Vercel plan for collaboration features.

**What to watch:**

- **Database size.** Analytics rows accumulate. At tens of thousands of visits a
  month this is trivial, but eventually old `analytics_events` rows should be
  pruned — the rolled-up session rows are what the dashboard needs, so raw
  events can be deleted after a few months without losing any chart.
- **Sessions table.** Expired rows are ignored but not automatically removed; a
  periodic delete keeps it tidy.
- **One admin.** If only one person is an admin and they lose access, nobody can
  provision accounts. Make a second admin.

---

## 10. Common tasks

**Add a teammate.** Team → Add a teammate → send them the one-time password.
It is shown once.

**Someone forgot their password.** Team → Reset password. That signs them out
everywhere and issues a new one-time password.

**Someone leaves.** Team → Deactivate. Their sessions die immediately. The
account is kept so their name still appears correctly on past lead notes.

**Write a post.** Blog → New post. Fill in the title, excerpt and body, add
tags, check the search preview, then Publish. It appears on `/blog` and in the
sitemap at once.

**Unpublish something.** Open it, set status to Draft, save. It returns a 404
publicly but is kept in the CMS.

**See where traffic comes from.** Traffic tab → Referrers. "Direct" means no
referrer was sent — typed URLs, bookmarks, and most links from apps.

**Check if the site is converting.** Overview → Conversion Funnel, and the
Lead Conversion card.

---

*Reference for the file layout, environment variables and deployment steps:
[README.md](README.md).*
