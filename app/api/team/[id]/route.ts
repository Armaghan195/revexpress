import { destroyAllSessionsFor, generatePassword, hashPassword } from '@/lib/auth';
import { requireAdmin } from '@/lib/session';
import { query, queryOne } from '@/lib/db';
import { fail, json, route } from '@/lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const admin = await requireAdmin();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const target = await queryOne<{ id: string; role: string; is_active: boolean }>(
    'SELECT id, role, is_active FROM users WHERE id = $1',
    [id],
  );
  if (!target) return fail('No such account', 404);

  // Guard rails: an admin cannot lock themselves out, and the last remaining
  // admin cannot be demoted or deactivated, which would leave nobody able to
  // provision accounts.
  if (target.id === admin.id && (body.action === 'deactivate' || body.role === 'member')) {
    return fail('You cannot remove your own admin access', 400);
  }
  if (target.role === 'admin' && (body.action === 'deactivate' || body.role === 'member')) {
    const others = await queryOne<{ n: string }>(
      `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = TRUE AND id <> $1`,
      [id],
    );
    if (Number(others?.n ?? 0) === 0) return fail('This is the last active admin', 400);
  }

  if (body.action === 'deactivate' || body.action === 'activate') {
    const active = body.action === 'activate';
    await query('UPDATE users SET is_active = $1 WHERE id = $2', [active, id]);
    // Deactivating takes effect at once because sessions live in the database.
    if (!active) await destroyAllSessionsFor(id);
    return json({ ok: true });
  }

  if (body.role === 'admin' || body.role === 'member') {
    await query('UPDATE users SET role = $1 WHERE id = $2', [body.role, id]);
    return json({ ok: true });
  }

  if (body.action === 'reset_password') {
    const password = generatePassword();
    await query(
      'UPDATE users SET password_hash = $1, must_change_password = TRUE WHERE id = $2',
      [await hashPassword(password), id],
    );
    await destroyAllSessionsFor(id);
    return json({ ok: true, oneTimePassword: password });
  }

  return fail('Nothing to do');
});
