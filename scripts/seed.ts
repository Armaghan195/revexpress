/**
 * Fills the database with plausible demo traffic, leads and posts so the
 * dashboard can be reviewed before the site has real visitors.
 *
 *   npm run db:seed          add demo data
 *   npm run db:seed -- wipe  clear demo data first
 *
 * Everything it writes is tagged so it can be removed again: analytics rows use
 * ids prefixed "seed_", leads use "seed_", posts use slugs prefixed "demo-".
 */
import crypto from 'node:crypto';
import { query, closeDb, migrate } from '../lib/db';

// This site is one page plus the blog, so demo traffic looks like that.
const PATHS = ['/', '/', '/', '/', '/blog', '/blog/demo-best-tiktok-shop-agencies-2026'];
const SECTIONS = ['hero', 'stats', 'problem', 'engine', 'framework', 'avatars',
                  'distribution', 'results', 'pricing', 'timeline', 'contact'];
// The actual calls to action on the page.
const CTAS = ['Book a Strategy Call', 'See the Results', 'Book a Call', 'Get Started', 'Watch reel'];
const REFERRERS = [null, null, null, 'https://google.com/', 'https://chatgpt.com/', 'https://linkedin.com/feed', 'https://instagram.com/'];
const COUNTRIES = ['US', 'US', 'US', 'US', 'CN', 'KR', 'PK', 'FR', 'CA', 'GB', 'CY'];
const DEVICES: ('desktop' | 'mobile' | 'tablet')[] = ['desktop', 'desktop', 'desktop', 'mobile', 'mobile', 'tablet'];

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const rid = (p: string) => p + crypto.randomBytes(9).toString('hex');

async function wipe() {
  await query(`DELETE FROM analytics_events WHERE session_id LIKE 'seed_%'`);
  await query(`DELETE FROM analytics_pageviews WHERE session_id LIKE 'seed_%'`);
  await query(`DELETE FROM analytics_sessions WHERE id LIKE 'seed_%'`);
  await query(`DELETE FROM lead_notes WHERE lead_id LIKE 'seed_%'`);
  await query(`DELETE FROM leads WHERE id LIKE 'seed_%'`);
  await query(`DELETE FROM posts WHERE slug LIKE 'demo-%'`);
  console.log('Removed previous demo data.');
}

async function seedTraffic(days = 60) {
  let sessions = 0;
  let views = 0;

  for (let d = days; d >= 0; d--) {
    // Traffic ramps up over time, with a weekend dip, so the trend line looks
    // like a real site rather than noise.
    const day = new Date(Date.now() - d * 86_400_000);
    const weekday = day.getUTCDay();
    const ramp = Math.max(0, 1 - d / days);
    const weekend = weekday === 0 || weekday === 6 ? 0.55 : 1;
    const count = Math.round((3 + Math.random() * 22) * ramp * weekend);

    for (let i = 0; i < count; i++) {
      const at = new Date(day);
      at.setUTCHours(7 + Math.floor(Math.random() * 14), Math.floor(Math.random() * 60));
      const id = rid('seed_');
      const visitor = 'seed_v' + Math.floor(Math.random() * Math.max(4, count * days * 0.55));
      const entry = pick(PATHS);
      const referrer = pick(REFERRERS);
      const pages = 1 + (Math.random() < 0.32 ? Math.floor(Math.random() * 3) : 0);
      const scroll = Math.floor(Math.random() * 100);
      const duration = Math.floor(Math.random() * 90_000);
      const engaged = duration >= 15_000 || scroll >= 50;

      await query(
        `INSERT INTO analytics_sessions
           (id, visitor_id, started_at, last_seen_at, entry_path, referrer, referrer_host,
            country, device, intent, views, max_scroll, duration_ms, cta_clicks, engaged)
         VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          id, visitor, at.toISOString(), entry, referrer,
          referrer ? new URL(referrer).hostname.replace(/^www\./, '') : null,
          pick(COUNTRIES), pick(DEVICES),
          Math.random() < 0.82 ? 'brand' : Math.random() < 0.5 ? 'creator' : 'unknown',
          pages, scroll, duration, Math.random() < 0.12 ? 1 : 0, engaged,
        ],
      );
      sessions++;

      for (let p = 0; p < pages; p++) {
        const path = p === 0 ? entry : pick(PATHS);
        const pvAt = new Date(at.getTime() + p * 45_000);
        await query(
          `INSERT INTO analytics_pageviews (session_id, path, at, duration_ms, max_scroll)
           VALUES ($1,$2,$3,$4,$5)`,
          [id, path, pvAt.toISOString(), Math.floor(Math.random() * 70_000), scroll],
        );
        views++;
      }

      // How far down the page this visit got, and the CTA it clicked.
      if (entry === '/') {
        const reached = 1 + Math.floor(Math.random() * SECTIONS.length);
        for (let sIdx = 0; sIdx < reached; sIdx++) {
          await query(
            `INSERT INTO analytics_events (session_id, type, path, label, at)
             VALUES ($1,'section_view','/',$2,$3)`,
            [id, SECTIONS[sIdx], at.toISOString()],
          );
        }
        await query('UPDATE analytics_sessions SET deepest_section = $2 WHERE id = $1',
          [id, SECTIONS[reached - 1]]);
      }
      if (Math.random() < 0.12) {
        await query(
          `INSERT INTO analytics_events (session_id, type, path, label, at)
           VALUES ($1,'cta_click',$2,$3,$4)`,
          [id, entry, pick(CTAS), at.toISOString()],
        );
      }
      if (Math.random() < 0.07) {
        await query(
          `INSERT INTO analytics_events (session_id, type, path, at) VALUES ($1,'form_start',$2,$3)`,
          [id, '/', at.toISOString()],
        );
      }
    }
  }
  console.log(`Seeded ${sessions} sessions and ${views} page views.`);
}

// Obviously fictional, and carrying only the fields the contact form collects:
// name, email, brand, phone, ad-spend band and the free-text goal.
const LEADS: [string, string, string, string, string][] = [
  ['Jordan Smith', 'jordan@northpeak.example', 'Northpeak Supplements', '+1 415 555 0142', '$50K – $250K'],
  ['Priya Raman', 'priya@lumenskin.example', 'Lumen Skin', '+44 7700 900410', '$10K – $50K'],
  ['Marco Silva', 'marco@atlasgear.example', 'Atlas Gear', '', '$250K+'],
  ['Chloe Bennett', 'chloe@verdantbotanics.example', 'Verdant Botanics', '+1 213 555 0188', 'Under $10K'],
  ['Daniel Okafor', 'daniel@corefuel.example', 'CoreFuel', '+1 646 555 0125', '$50K – $250K'],
  ['Hannah Weiss', 'hannah@brightwell.example', 'Brightwell Home', '', '$10K – $50K'],
  ['Tomas Novak', 'tomas@peakform.example', 'PeakForm Nutrition', '+420 601 555 019', '$250K+'],
  ['Aisha Rahman', 'aisha@sundropbeauty.example', 'Sundrop Beauty', '+971 50 555 0173', 'Under $10K'],
];

async function seedLeads() {
  const GOALS = [
    'We have great organic content but no paid distribution system behind it.',
    'Creative fatigue is killing our ROAS. We need volume we can actually test.',
    'Looking to scale TikTok and Meta together without doubling our CAC.',
    'We want a creator engine we do not have to manage day to day.',
  ];
  // Attach each demo lead to a demo visit, so the "Their visit" panel shows the
  // journey behind the enquiry exactly as it will for a real submission.
  const visits = await query<{ id: string }>(
    `SELECT id FROM analytics_sessions
      WHERE id LIKE 'seed_%' AND entry_path = '/' AND deepest_section = 'contact'
      ORDER BY started_at DESC LIMIT $1`,
    [LEADS.length],
  );

  for (let i = 0; i < LEADS.length; i++) {
    const [name, email, brand, phone, spend] = LEADS[i];
    const created = new Date(Date.now() - i * 1.4 * 86_400_000);
    await query(
      `INSERT INTO leads (id, name, email, brand, phone, type, status, ad_spend,
                          message, source_path, session_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'brand','new',$6,$7,'/',$8,$9,$9)`,
      [
        rid('seed_'), name, email, brand, phone || null, spend, pick(GOALS),
        visits.rows[i]?.id ?? null, created.toISOString(),
      ],
    );
  }
  console.log(`Seeded ${LEADS.length} leads.`);
}

const POSTS = [
  ['demo-best-tiktok-shop-agencies-2026', 'Best TikTok Shop Agencies in 2026: Top 5 Partners Ranked',
   'A no-fluff guide to the best TikTok Shop agencies in 2026 — who they suit, what they charge, and where each one is strongest.',
   ['TikTok Shop', 'Agencies']],
  ['demo-tiktok-shop-tap-vs-tsp', 'TikTok Shop TAP Agency vs TSP Agency: Which Partner Is Right?',
   'Confused about TikTok Shop TAP agencies and TSP agencies? This guide explains how the two models differ and which one fits your stage.',
   ['TikTok Shop', 'TikTok Shop Agency']],
  ['demo-creator-marketplace-access-vs-control', 'The TikTok Shop Creator Marketplace: Access vs. Control',
   'Finding creators is easy. Directing them to blow up a new SKU is the hard part. Here is how we think about the trade-off.',
   ['Creator Marketplace', 'TikTok Shop']],
];

async function seedPosts() {
  for (let i = 0; i < POSTS.length; i++) {
    const [slug, title, excerpt, tags] = POSTS[i] as [string, string, string, string[]];
    const published = new Date(Date.now() - (i + 1) * 3 * 86_400_000);
    await query(
      `INSERT INTO posts (id, slug, title, excerpt, body_md, tags, status, published_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'published',$7,$7,$7)
       ON CONFLICT (slug) DO NOTHING`,
      [
        rid('post_'), slug, title, excerpt,
        `## Why this matters\n\n${excerpt}\n\n### What we look at\n\n- Creator volume and retention\n- Cost per acquired customer\n- Content velocity across platforms\n\n> Demo content, seeded so the blog and its SEO markup can be reviewed before real posts exist.\n\n### The short version\n\nPick the partner whose incentives match the outcome you are paying for.`,
        JSON.stringify(tags), published.toISOString(),
      ],
    );
  }
  console.log(`Seeded ${POSTS.length} blog posts.`);
}

async function main() {
  await migrate();
  if (process.argv.includes('wipe')) await wipe();
  await seedTraffic();
  await seedLeads();
  await seedPosts();
  console.log('\nDone. Sign in at /login to review.');
  await closeDb();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
