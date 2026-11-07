/**
 * Dashboard queries.
 *
 * Everything is derived from three tables written by the tracking script:
 * analytics_sessions (one row per visit, rolled up as the visit happens),
 * analytics_pageviews (one row per page, with time and scroll) and
 * analytics_events (discrete things like CTA clicks and form starts).
 *
 * Rolling up into analytics_sessions at write time is what keeps these reads
 * cheap: bounce rate, views/session and scroll depth are single-table
 * aggregates rather than window functions over a raw event log.
 */
import { query, queryOne } from './db';

export type RangeKey = '24h' | '7d' | '30d' | '90d';

export const RANGES: { key: RangeKey; label: string; hours: number }[] = [
  { key: '24h', label: '24h', hours: 24 },
  { key: '7d', label: '7 days', hours: 24 * 7 },
  { key: '30d', label: '30 days', hours: 24 * 30 },
  { key: '90d', label: '90 days', hours: 24 * 90 },
];

export function resolveRange(key?: string | null) {
  const found = RANGES.find(r => r.key === key) ?? RANGES[3];
  const to = new Date();
  const from = new Date(to.getTime() - found.hours * 3600_000);
  // The comparison window is the same length, immediately before.
  const prevFrom = new Date(from.getTime() - found.hours * 3600_000);
  return { ...found, from, to, prevFrom, prevTo: from };
}

function iso(d: Date) {
  return d.toISOString();
}

/** Percentage change, guarding the divide-by-zero that a brand-new site hits. */
function delta(current: number, previous: number): { pct: number; dir: 'up' | 'down' | 'flat' } {
  if (previous === 0) return current === 0 ? { pct: 0, dir: 'flat' } : { pct: 100, dir: 'up' };
  const pct = Math.round(((current - previous) / previous) * 100);
  return { pct: Math.abs(pct), dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}

const num = (v: unknown) => Number(v ?? 0);

export interface Stat {
  value: number;
  delta: { pct: number; dir: 'up' | 'down' | 'flat' };
}

async function scalar(sql: string, params: unknown[]): Promise<number> {
  const row = await queryOne<{ v: string | number | null }>(sql, params);
  return num(row?.v);
}

/** Runs a metric over the current and previous window and packages the delta. */
async function stat(sql: string, r: ReturnType<typeof resolveRange>): Promise<Stat> {
  const [current, previous] = await Promise.all([
    scalar(sql, [iso(r.from), iso(r.to)]),
    scalar(sql, [iso(r.prevFrom), iso(r.prevTo)]),
  ]);
  return { value: current, delta: delta(current, previous) };
}

/* ------------------------------------------------------------------ trend */

export interface TrendPoint {
  date: string;
  views: number;
  visitors: number;
}

/**
 * Daily views and unique visitors. Days with no traffic are filled in here
 * rather than in SQL, so the chart keeps an even x-axis on both databases.
 */
export async function getTrend(r: ReturnType<typeof resolveRange>): Promise<TrendPoint[]> {
  const bucketByHour = r.key === '24h';
  const trunc = bucketByHour ? 'hour' : 'day';

  const { rows } = await query<{ bucket: string; views: string; visitors: string }>(
    `SELECT date_trunc('${trunc}', pv.at) AS bucket,
            COUNT(*) AS views,
            COUNT(DISTINCT s.visitor_id) AS visitors
       FROM analytics_pageviews pv
       JOIN analytics_sessions s ON s.id = pv.session_id
      WHERE pv.at >= $1 AND pv.at < $2
      GROUP BY 1 ORDER BY 1`,
    [iso(r.from), iso(r.to)],
  );

  const found = new Map(
    rows.map(row => [new Date(row.bucket).toISOString().slice(0, bucketByHour ? 13 : 10), row]),
  );

  const points: TrendPoint[] = [];
  const step = bucketByHour ? 3600_000 : 86_400_000;
  const start = bucketByHour
    ? new Date(Math.floor(r.from.getTime() / step) * step)
    : new Date(Date.UTC(r.from.getUTCFullYear(), r.from.getUTCMonth(), r.from.getUTCDate()));

  for (let t = start.getTime(); t <= r.to.getTime(); t += step) {
    const d = new Date(t);
    const key = d.toISOString().slice(0, bucketByHour ? 13 : 10);
    const hit = found.get(key);
    points.push({
      date: d.toISOString(),
      views: num(hit?.views),
      visitors: num(hit?.visitors),
    });
  }
  return points;
}

/* ---------------------------------------------------------------- listings */

export interface BarItem {
  label: string;
  value: number;
  meta?: string;
}

export async function getTopPages(r: ReturnType<typeof resolveRange>, limit = 6): Promise<BarItem[]> {
  const { rows } = await query<{ path: string; views: string; avg_ms: string }>(
    `SELECT path, COUNT(*) AS views, COALESCE(AVG(NULLIF(duration_ms, 0)), 0) AS avg_ms
       FROM analytics_pageviews
      WHERE at >= $1 AND at < $2
      GROUP BY path ORDER BY views DESC LIMIT ${limit}`,
    [iso(r.from), iso(r.to)],
  );
  return rows.map(row => ({
    label: row.path,
    value: num(row.views),
    meta: `${Math.round(num(row.avg_ms) / 1000)}s`,
  }));
}

export async function getReferrers(r: ReturnType<typeof resolveRange>, limit = 6): Promise<BarItem[]> {
  const { rows } = await query<{ host: string | null; n: string }>(
    `SELECT COALESCE(NULLIF(referrer_host, ''), 'Direct') AS host, COUNT(*) AS n
       FROM analytics_sessions
      WHERE started_at >= $1 AND started_at < $2
      GROUP BY 1 ORDER BY n DESC LIMIT ${limit}`,
    [iso(r.from), iso(r.to)],
  );
  return rows.map(row => ({ label: row.host || 'Direct', value: num(row.n) }));
}

async function groupBy(
  column: string,
  r: ReturnType<typeof resolveRange>,
  limit = 8,
): Promise<BarItem[]> {
  const { rows } = await query<{ k: string; n: string }>(
    `SELECT COALESCE(NULLIF(${column}, ''), 'unknown') AS k, COUNT(*) AS n
       FROM analytics_sessions
      WHERE started_at >= $1 AND started_at < $2
      GROUP BY 1 ORDER BY n DESC LIMIT ${limit}`,
    [iso(r.from), iso(r.to)],
  );
  return rows.map(row => ({ label: row.k, value: num(row.n) }));
}

export const getDevices = (r: ReturnType<typeof resolveRange>) => groupBy('device', r, 3);
export const getCountries = (r: ReturnType<typeof resolveRange>) => groupBy('country', r, 8);

/**
 * How far down the page visitors get.
 *
 * The marketing site is one page with anchor sections, so "top pages" says
 * almost nothing — nearly every visit is "/". Section reach is the real
 * engagement signal: it shows exactly where the story loses people.
 */
export const SECTIONS: { id: string; label: string }[] = [
  { id: 'hero', label: 'Hero' },
  { id: 'stats', label: 'Proof stats' },
  { id: 'problem', label: 'The problem' },
  { id: 'engine', label: 'The engine' },
  { id: 'framework', label: 'Framework' },
  { id: 'avatars', label: 'Avatar discovery' },
  { id: 'distribution', label: 'Distribution' },
  { id: 'results', label: 'Results' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'contact', label: 'Contact form' },
];

export async function getSectionReach(r: ReturnType<typeof resolveRange>): Promise<BarItem[]> {
  const { rows } = await query<{ label: string; n: string }>(
    `SELECT label, COUNT(DISTINCT session_id) AS n
       FROM analytics_events
      WHERE type = 'section_view' AND label IS NOT NULL AND at >= $1 AND at < $2
      GROUP BY label`,
    [iso(r.from), iso(r.to)],
  );
  const counts = new Map(rows.map(row => [row.label, num(row.n)]));
  const sessions = await scalar(
    `SELECT COUNT(*) AS v FROM analytics_sessions WHERE started_at >= $1 AND started_at < $2`,
    [iso(r.from), iso(r.to)],
  );
  // Kept in page order rather than sorted by size, so the drop-off is readable
  // as a funnel down the page.
  return SECTIONS.filter(sec => counts.has(sec.id)).map(sec => ({
    label: sec.label,
    value: counts.get(sec.id) ?? 0,
    meta: sessions ? `${Math.round(((counts.get(sec.id) ?? 0) / sessions) * 100)}%` : undefined,
  }));
}

/** Which call to action actually gets clicked. */
export async function getCtaBreakdown(
  r: ReturnType<typeof resolveRange>,
  limit = 6,
): Promise<BarItem[]> {
  const { rows } = await query<{ label: string | null; n: string }>(
    `SELECT COALESCE(NULLIF(label, ''), 'Unlabelled') AS label, COUNT(*) AS n
       FROM analytics_events
      WHERE type = 'cta_click' AND at >= $1 AND at < $2
      GROUP BY 1 ORDER BY n DESC LIMIT ${limit}`,
    [iso(r.from), iso(r.to)],
  );
  return rows.map(row => ({ label: row.label || 'Unlabelled', value: num(row.n) }));
}

/**
 * New versus returning. Replaces the "audience intent" split, which only makes
 * sense on a site with separate brand and creator applications — this one has
 * a single contact form.
 */
export async function getNewVsReturning(r: ReturnType<typeof resolveRange>): Promise<BarItem[]> {
  const row = await queryOne<{ returning: string; total: string }>(
    `SELECT COUNT(*) FILTER (WHERE prior > 0) AS returning, COUNT(*) AS total
       FROM (
         SELECT s.visitor_id,
                (SELECT COUNT(*) FROM analytics_sessions p
                  WHERE p.visitor_id = s.visitor_id AND p.started_at < $1) AS prior
           FROM analytics_sessions s
          WHERE s.started_at >= $1 AND s.started_at < $2
          GROUP BY s.visitor_id
       ) q`,
    [iso(r.from), iso(r.to)],
  );
  const total = num(row?.total);
  const returning = num(row?.returning);
  return [
    { label: 'New visitors', value: total - returning },
    { label: 'Returning', value: returning },
  ];
}

/* --------------------------------------------------------------- overview */

export async function getOverview(r: ReturnType<typeof resolveRange>) {
  const visitors = await stat(
    `SELECT COUNT(DISTINCT visitor_id) AS v FROM analytics_sessions
      WHERE started_at >= $1 AND started_at < $2`,
    r,
  );
  const views = await stat(
    `SELECT COUNT(*) AS v FROM analytics_pageviews WHERE at >= $1 AND at < $2`,
    r,
  );
  const avgTime = await stat(
    `SELECT COALESCE(AVG(NULLIF(duration_ms, 0)), 0) AS v FROM analytics_pageviews
      WHERE at >= $1 AND at < $2`,
    r,
  );
  const submissions = await stat(
    `SELECT COUNT(*) AS v FROM leads WHERE created_at >= $1 AND created_at < $2`,
    r,
  );

  const ctaClicks = await scalar(
    `SELECT COUNT(*) AS v FROM analytics_events
      WHERE type = 'cta_click' AND at >= $1 AND at < $2`,
    [iso(r.from), iso(r.to)],
  );
  const formStarts = await scalar(
    `SELECT COUNT(DISTINCT session_id) AS v FROM analytics_events
      WHERE type = 'form_start' AND at >= $1 AND at < $2`,
    [iso(r.from), iso(r.to)],
  );

  const conversion = visitors.value ? (submissions.value / visitors.value) * 100 : 0;

  return {
    visitors,
    views,
    avgTimeMs: avgTime,
    submissions,
    conversionPct: Math.round(conversion * 10) / 10,
    funnel: [
      { label: 'Visitors', value: visitors.value, tone: 'cyan' as const },
      { label: 'CTA Clicks', value: ctaClicks, tone: 'violet' as const },
      { label: 'Form Starts', value: formStarts, tone: 'lime' as const },
      { label: 'Submissions', value: submissions.value, tone: 'pink' as const },
    ],
  };
}

/* ---------------------------------------------------------------- traffic */

export async function getTraffic(r: ReturnType<typeof resolveRange>) {
  const sessions = await stat(
    `SELECT COUNT(*) AS v FROM analytics_sessions WHERE started_at >= $1 AND started_at < $2`,
    r,
  );
  // A bounce is a single-page visit that never became engaged.
  const bounceRate = await stat(
    `SELECT COALESCE(
              100.0 * SUM(CASE WHEN views <= 1 AND engaged = FALSE THEN 1 ELSE 0 END)
              / NULLIF(COUNT(*), 0), 0) AS v
       FROM analytics_sessions WHERE started_at >= $1 AND started_at < $2`,
    r,
  );
  const engagedRate = await stat(
    `SELECT COALESCE(100.0 * SUM(CASE WHEN engaged THEN 1 ELSE 0 END)
            / NULLIF(COUNT(*), 0), 0) AS v
       FROM analytics_sessions WHERE started_at >= $1 AND started_at < $2`,
    r,
  );
  const ctaClicks = await stat(
    `SELECT COUNT(*) AS v FROM analytics_events
      WHERE type = 'cta_click' AND at >= $1 AND at < $2`,
    r,
  );
  return { sessions, bounceRate, engagedRate, ctaClicks };
}

/* --------------------------------------------------------------- audience */

export async function getAudience(r: ReturnType<typeof resolveRange>) {
  const visitors = await stat(
    `SELECT COUNT(DISTINCT visitor_id) AS v FROM analytics_sessions
      WHERE started_at >= $1 AND started_at < $2`,
    r,
  );
  const scroll = await stat(
    `SELECT COALESCE(AVG(NULLIF(max_scroll, 0)), 0) AS v FROM analytics_sessions
      WHERE started_at >= $1 AND started_at < $2`,
    r,
  );
  const sessionsPerVisitor = await stat(
    `SELECT COALESCE(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT visitor_id), 0), 0) AS v
       FROM analytics_sessions WHERE started_at >= $1 AND started_at < $2`,
    r,
  );
  const viewsPerSession = await stat(
    `SELECT COALESCE(AVG(NULLIF(views, 0)), 0) AS v FROM analytics_sessions
      WHERE started_at >= $1 AND started_at < $2`,
    r,
  );
  return { visitors, scroll, sessionsPerVisitor, viewsPerSession };
}

/* ------------------------------------------------------------------ leads */

export async function getPipelineSnapshot() {
  // Reflects what this site actually captures: one contact form, whose key
  // qualifier is the monthly ad spend band the visitor selects.
  const row = await queryOne<Record<string, string>>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS uncontacted,
            SUM(CASE WHEN status IN ('contacted','qualified') THEN 1 ELSE 0 END) AS in_progress,
            SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) AS won,
            SUM(CASE WHEN ad_spend IN ('$50K – $250K', '$250K+') THEN 1 ELSE 0 END) AS high_spend,
            SUM(CASE WHEN phone IS NOT NULL AND phone <> '' THEN 1 ELSE 0 END) AS reachable
       FROM leads`,
  );
  const published = await queryOne<{ n: string }>(
    `SELECT COUNT(*) AS n FROM posts WHERE status = 'published'`,
  );
  return {
    total: num(row?.total),
    uncontacted: num(row?.uncontacted),
    inProgress: num(row?.in_progress),
    won: num(row?.won),
    highSpend: num(row?.high_spend),
    reachable: num(row?.reachable),
    postsPublished: num(published?.n),
  };
}

/** Leads grouped by the ad-spend band they picked on the form. */
export async function getSpendBands(): Promise<BarItem[]> {
  const { rows } = await query<{ band: string | null; n: string }>(
    `SELECT COALESCE(NULLIF(ad_spend, ''), 'Not given') AS band, COUNT(*) AS n
       FROM leads GROUP BY 1 ORDER BY n DESC`,
  );
  return rows.map(row => ({ label: row.band || 'Not given', value: num(row.n) }));
}

export async function getNewLeadCount(): Promise<number> {
  return scalar(`SELECT COUNT(*) AS v FROM leads WHERE status = 'new'`, []);
}
