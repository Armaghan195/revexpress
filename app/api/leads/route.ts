import { LeadInput, createLead, listLeads } from '@/lib/leads';
import { requireUser } from '@/lib/session';
import { clientIp, fail, json, route } from '@/lib/http';
import { query, queryOne } from '@/lib/db';

export const runtime = 'nodejs';

/** Public: the marketing site's contact form posts here. */
export const POST = route(async (req: Request) => {
  const parsed = LeadInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail('Please check the form and try again', 400, {
      fields: parsed.error.flatten().fieldErrors,
    });
  }

  // Throttle on the request's own IP, not on the session id in the payload:
  // that value comes from the browser, so a bot could rotate it and submit
  // without limit. The IP is observed server-side and cannot be chosen.
  const ip = clientIp(req);
  const recent = await queryOne<{ n: string }>(
    `SELECT COUNT(*) AS n FROM leads
      WHERE submitted_ip = $1 AND created_at > NOW() - INTERVAL '10 minutes'`,
    [ip],
  );
  if (Number(recent?.n ?? 0) >= 3) {
    return fail('We already have your details — we will be in touch shortly.', 429);
  }

  const lead = await createLead(parsed.data, ip);
  // A honeypot hit returns success so the bot does not learn it was caught.
  if (!lead) return json({ ok: true });

  if (parsed.data.session_id) {
    await query(
      `INSERT INTO analytics_events (session_id, type, path, label)
       SELECT $1, 'form_submit', $2, 'contact'
        WHERE EXISTS (SELECT 1 FROM analytics_sessions WHERE id = $1)`,
      [parsed.data.session_id, parsed.data.source_path ?? '/'],
    );
  }
  return json({ ok: true, id: lead.id });
});

/** Portal: the Leads tab reads through here. */
export const GET = route(async (req: Request) => {
  await requireUser();
  const url = new URL(req.url);
  const leads = await listLeads({
    status: (url.searchParams.get('status') as any) ?? 'all',
    type: (url.searchParams.get('type') as any) ?? 'all',
    search: url.searchParams.get('q') ?? undefined,
  });
  return json({ leads });
});
