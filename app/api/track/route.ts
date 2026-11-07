/**
 * Analytics ingest. One endpoint for every event the tracking script sends.
 *
 * Anonymous by design: the visitor id is a random value generated in the
 * browser, there is no cross-site identifier, and no personal data is stored —
 * which is what keeps this out of cookie-banner territory.
 */
import { z } from 'zod';
import { query, queryOne } from '@/lib/db';
import { clientCountry, clientIp, json, route } from '@/lib/http';

export const runtime = 'nodejs';

// The order sections appear on the marketing page, top to bottom. Used to work
// out which of two sections is "further down" the story.
/**
 * In-memory sliding window, per IP.
 *
 * Deliberately not a database table: this runs on every beacon, and a write to
 * count writes would double the load it is meant to contain. Serverless
 * instances each keep their own counter, which is fine — the goal is to blunt a
 * flood, not to meter precisely.
 */
const TRACK_WINDOW_MS = 60_000;
const TRACK_MAX_PER_WINDOW = 60;
const trackHits = new Map<string, number[]>();

function allow(ip: string): boolean {
  const now = Date.now();
  const hits = (trackHits.get(ip) ?? []).filter(t => now - t < TRACK_WINDOW_MS);
  hits.push(now);
  trackHits.set(ip, hits);

  // Keep the map from growing forever on a long-lived instance.
  if (trackHits.size > 5000) {
    for (const [key, times] of trackHits) {
      if (!times.some(t => now - t < TRACK_WINDOW_MS)) trackHits.delete(key);
    }
  }
  return hits.length <= TRACK_MAX_PER_WINDOW;
}

const SECTION_ORDER = [
  'hero', 'stats', 'problem', 'engine', 'framework', 'avatars',
  'distribution', 'results', 'pricing', 'timeline', 'contact',
];

const Payload = z.object({
  sessionId: z.string().min(8).max(64),
  visitorId: z.string().min(8).max(64),
  type: z.enum(['pageview', 'cta_click', 'scroll', 'engaged', 'form_start', 'form_submit', 'heartbeat', 'section_view']),
  path: z.string().max(512),
  referrer: z.string().max(1024).optional().nullable(),
  label: z.string().max(200).optional().nullable(),
  value: z.number().int().min(0).max(100_000).optional().nullable(),
  device: z.enum(['desktop', 'mobile', 'tablet']).optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
  scroll: z.number().int().min(0).max(100).optional(),
  intent: z.enum(['brand', 'creator', 'unknown']).optional(),
});

function hostOf(referrer?: string | null): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

export const POST = route(async (req: Request) => {
  const parsed = Payload.safeParse(await req.json().catch(() => null));
  // A malformed beacon is never worth a 4xx: it would just retry forever.
  if (!parsed.success) return json({ ok: true, ignored: true });
  const e = parsed.data;

  // Same-origin only. A cross-site Origin is rejected outright; a *missing*
  // Origin (a script or curl, never a browser doing a real page visit) used to
  // slip through this check entirely.
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host && !origin.endsWith(host)) return json({ ok: true, ignored: true });

  // Cap how much a single caller can write. Without this the endpoint is an
  // open invitation to inflate the dashboard or grow the tables without bound.
  if (!allow(clientIp(req))) return json({ ok: true, ignored: true });

  const selfHost = host?.split(':')[0] ?? '';
  const refHost = hostOf(e.referrer);
  const external = refHost && refHost !== selfHost ? refHost : null;

  await query(
    `INSERT INTO analytics_sessions (id, visitor_id, entry_path, referrer, referrer_host, country, device, intent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING`,
    [
      e.sessionId,
      e.visitorId,
      e.path,
      e.referrer ?? null,
      external,
      clientCountry(req),
      e.device ?? 'desktop',
      e.intent ?? 'unknown',
    ],
  );

  if (e.type === 'pageview') {
    await query(
      `INSERT INTO analytics_pageviews (session_id, path) VALUES ($1, $2)`,
      [e.sessionId, e.path],
    );
    await query(
      `UPDATE analytics_sessions
          SET views = views + 1, last_seen_at = NOW()
        WHERE id = $1`,
      [e.sessionId],
    );
  } else {
    await query(
      `INSERT INTO analytics_events (session_id, type, path, label, value)
       VALUES ($1, $2, $3, $4, $5)`,
      [e.sessionId, e.type, e.path, e.label ?? null, e.value ?? null],
    );
  }

  // Remember the furthest section reached. Ordering by the section's position
  // in the page keeps "deepest" meaningful even if events arrive out of order.
  if (e.type === 'section_view' && e.label) {
    await query(
      `UPDATE analytics_sessions
          SET deepest_section = CASE
                WHEN COALESCE(array_position($2::text[], deepest_section), 0)
                     < COALESCE(array_position($2::text[], $3), 0)
                THEN $3 ELSE deepest_section END
        WHERE id = $1`,
      [e.sessionId, SECTION_ORDER, e.label],
    );
  }

  // Roll the visit-level numbers forward. GREATEST keeps these monotonic so a
  // late-arriving beacon cannot walk a session's scroll or duration backwards.
  await query(
    `UPDATE analytics_sessions
        SET last_seen_at = NOW(),
            max_scroll  = GREATEST(max_scroll, $2),
            duration_ms = GREATEST(duration_ms, $3),
            cta_clicks  = cta_clicks + $4,
            intent      = CASE WHEN $5 <> 'unknown' THEN $5 ELSE intent END,
            engaged     = engaged OR $6
      WHERE id = $1`,
    [
      e.sessionId,
      e.scroll ?? 0,
      e.durationMs ?? 0,
      e.type === 'cta_click' ? 1 : 0,
      e.intent ?? 'unknown',
      // The dashboard's own definition: 15 seconds, or half the page.
      e.type === 'engaged' || (e.durationMs ?? 0) >= 15_000 || (e.scroll ?? 0) >= 50,
    ],
  );

  if (e.type === 'pageview' || e.durationMs || e.scroll) {
    await query(
      `UPDATE analytics_pageviews
          SET duration_ms = GREATEST(duration_ms, $3),
              max_scroll  = GREATEST(max_scroll, $4)
        WHERE id = (SELECT id FROM analytics_pageviews
                     WHERE session_id = $1 AND path = $2
                     ORDER BY at DESC LIMIT 1)`,
      [e.sessionId, e.path, e.durationMs ?? 0, e.scroll ?? 0],
    );
  }

  return json({ ok: true });
});
