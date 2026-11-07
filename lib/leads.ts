/** Lead capture and the CRM pipeline behind the Leads tab. */
import { z } from 'zod';
import { query, queryOne } from './db';
import { newId } from './auth';

export const STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'] as const;
export type LeadStatus = (typeof STATUSES)[number];
export const LEAD_TYPES = ['brand', 'creator'] as const;
export type LeadType = (typeof LEAD_TYPES)[number];

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  brand: string | null;
  role_title: string | null;
  type: LeadType;
  status: LeadStatus;
  category: string | null;
  location: string | null;
  annual_revenue: string | null;
  monthly_gmv: string | null;
  ad_spend: string | null;
  biggest_need: string | null;
  goal: string | null;
  message: string | null;
  source_path: string | null;
  /** The analytics visit this enquiry came from, used to show its journey. */
  session_id: string | null;
  submitted_ip: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadNote {
  id: number;
  lead_id: string;
  kind: 'note' | 'status';
  body: string;
  created_at: string;
  author: string | null;
}

/** What the public contact form is allowed to send. */
export const LeadInput = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(60).optional().nullable(),
  brand: z.string().trim().max(160).optional().nullable(),
  role_title: z.string().trim().max(120).optional().nullable(),
  type: z.enum(LEAD_TYPES).optional(),
  category: z.string().trim().max(120).optional().nullable(),
  location: z.string().trim().max(120).optional().nullable(),
  annual_revenue: z.string().trim().max(60).optional().nullable(),
  monthly_gmv: z.string().trim().max(60).optional().nullable(),
  ad_spend: z.string().trim().max(60).optional().nullable(),
  biggest_need: z.string().trim().max(4000).optional().nullable(),
  goal: z.string().trim().max(4000).optional().nullable(),
  message: z.string().trim().max(4000).optional().nullable(),
  source_path: z.string().trim().max(512).optional().nullable(),
  session_id: z.string().trim().max(64).optional().nullable(),
  // Honeypot: a real person never fills this in, bots fill in everything.
  website: z.string().max(200).optional().nullable(),
});
export type LeadInputType = z.infer<typeof LeadInput>;

export async function createLead(input: LeadInputType, submittedIp?: string): Promise<Lead | null> {
  if (input.website) return null; // silently drop the bot

  const id = newId('lead_');
  await query(
    `INSERT INTO leads (id, name, email, phone, brand, role_title, type, category, location,
                        annual_revenue, monthly_gmv, ad_spend, biggest_need, goal, message,
                        source_path, session_id, submitted_ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      id, input.name, input.email.toLowerCase(), input.phone ?? null, input.brand ?? null,
      input.role_title ?? null, input.type ?? 'brand', input.category ?? null, input.location ?? null,
      input.annual_revenue ?? null, input.monthly_gmv ?? null, input.ad_spend ?? null,
      input.biggest_need ?? null, input.goal ?? null, input.message ?? null,
      input.source_path ?? null, input.session_id ?? null, submittedIp ?? null,
    ],
  );
  return getLead(id);
}

export async function getLead(id: string): Promise<Lead | null> {
  return queryOne<Lead>('SELECT * FROM leads WHERE id = $1', [id]);
}

export interface LeadFilter {
  status?: LeadStatus | 'all';
  type?: LeadType | 'all';
  search?: string;
  limit?: number;
}

export async function listLeads(filter: LeadFilter = {}): Promise<Lead[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filter.status && filter.status !== 'all') {
    params.push(filter.status);
    where.push(`status = $${params.length}`);
  }
  if (filter.type && filter.type !== 'all') {
    params.push(filter.type);
    where.push(`type = $${params.length}`);
  }
  if (filter.search) {
    params.push(`%${filter.search.toLowerCase()}%`);
    const p = `$${params.length}`;
    where.push(
      `(LOWER(name) LIKE ${p} OR LOWER(email) LIKE ${p} OR LOWER(COALESCE(brand,'')) LIKE ${p})`,
    );
  }

  const limit = Math.min(filter.limit ?? 200, 500);
  const { rows } = await query<Lead>(
    `SELECT * FROM leads
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY created_at DESC LIMIT ${limit}`,
    params,
  );
  return rows;
}

export async function countByStatus(): Promise<Record<string, number>> {
  const { rows } = await query<{ status: string; n: string }>(
    'SELECT status, COUNT(*) AS n FROM leads GROUP BY status',
  );
  const counts: Record<string, number> = { all: 0 };
  for (const s of STATUSES) counts[s] = 0;
  for (const row of rows) {
    counts[row.status] = Number(row.n);
    counts.all += Number(row.n);
  }
  return counts;
}

export async function setLeadStatus(id: string, status: LeadStatus, userId: string, userName: string) {
  const current = await getLead(id);
  if (!current) return null;
  if (current.status === status) return current;

  await query('UPDATE leads SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);
  // Stage changes are logged so the team can see who moved what, and when.
  await query(
    `INSERT INTO lead_notes (lead_id, user_id, kind, body) VALUES ($1, $2, 'status', $3)`,
    [id, userId, `${userName} moved this from ${current.status} to ${status}`],
  );
  return getLead(id);
}

export async function addLeadNote(id: string, body: string, userId: string) {
  await query(`INSERT INTO lead_notes (lead_id, user_id, kind, body) VALUES ($1,$2,'note',$3)`, [
    id, userId, body,
  ]);
  return listLeadNotes(id);
}

export async function listLeadNotes(id: string): Promise<LeadNote[]> {
  const { rows } = await query<LeadNote>(
    `SELECT n.id, n.lead_id, n.kind, n.body, n.created_at, u.name AS author
       FROM lead_notes n LEFT JOIN users u ON u.id = n.user_id
      WHERE n.lead_id = $1 ORDER BY n.created_at DESC`,
    [id],
  );
  return rows;
}

/**
 * The visit that produced a lead.
 *
 * Every lead stores the analytics session it came from, so the team can see the
 * journey behind the enquiry — where they arrived from, how long they stayed
 * and how far down the page they got — instead of a row of empty fields.
 */
export interface LeadContext {
  referrer: string | null;
  country: string | null;
  device: string | null;
  views: number;
  durationMs: number;
  maxScroll: number;
  deepestSection: string | null;
  ctaClicks: number;
  startedAt: string | null;
}

export async function getLeadContext(sessionId: string | null): Promise<LeadContext | null> {
  if (!sessionId) return null;
  const row = await queryOne<any>(
    `SELECT referrer_host, country, device, views, duration_ms, max_scroll,
            deepest_section, cta_clicks, started_at
       FROM analytics_sessions WHERE id = $1`,
    [sessionId],
  );
  if (!row) return null;
  return {
    referrer: row.referrer_host ?? null,
    country: row.country ?? null,
    device: row.device ?? null,
    views: Number(row.views ?? 0),
    durationMs: Number(row.duration_ms ?? 0),
    maxScroll: Number(row.max_scroll ?? 0),
    deepestSection: row.deepest_section ?? null,
    ctaClicks: Number(row.cta_clicks ?? 0),
    startedAt: row.started_at ?? null,
  };
}

/** Digits only, as wa.me expects. */
export function whatsappHref(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}
