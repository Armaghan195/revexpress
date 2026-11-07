import { z } from 'zod';
import { createUser } from '@/lib/auth';
import { requireAdmin } from '@/lib/session';
import { query } from '@/lib/db';
import { fail, json, route } from '@/lib/http';

export const runtime = 'nodejs';

export const GET = route(async () => {
  await requireAdmin();
  const { rows } = await query(
    `SELECT u.id, u.email, u.name, u.role, u.is_active, u.must_change_password,
            u.created_at, u.last_login_at, c.name AS created_by_name
       FROM users u LEFT JOIN users c ON c.id = u.created_by
      ORDER BY u.created_at ASC`,
  );
  return json({ members: rows });
});

const NewMember = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().min(1).max(120),
  role: z.enum(['admin', 'member']).default('member'),
});

/** Creates the account and returns the one-time password exactly once. */
export const POST = route(async (req: Request) => {
  const admin = await requireAdmin();
  const parsed = NewMember.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('Enter a name and a valid email address');

  const created = await createUser({
    email: parsed.data.email,
    name: parsed.data.name,
    role: parsed.data.role,
    createdBy: admin.id,
    mustChangePassword: true,
  });

  return json({
    ok: true,
    member: { id: created.id, email: created.email },
    // Shown to the admin once; only its hash is stored.
    oneTimePassword: created.password,
  }, 201);
});
