import { addLeadNote, getLead, getLeadContext, listLeadNotes, setLeadStatus, STATUSES } from '@/lib/leads';
import { requireUser } from '@/lib/session';
import { fail, json, route } from '@/lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  const lead = await getLead(id);
  if (!lead) return fail('Lead not found', 404);
  return json({
    lead,
    notes: await listLeadNotes(id),
    context: await getLeadContext(lead.session_id),
  });
});

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  if (typeof body.status === 'string') {
    if (!STATUSES.includes(body.status)) return fail('Unknown pipeline stage');
    const lead = await setLeadStatus(id, body.status, user.id, user.name);
    if (!lead) return fail('Lead not found', 404);
    return json({ lead, notes: await listLeadNotes(id) });
  }

  if (typeof body.note === 'string' && body.note.trim()) {
    const notes = await addLeadNote(id, body.note.trim().slice(0, 2000), user.id);
    return json({ lead: await getLead(id), notes });
  }

  return fail('Nothing to update');
});
