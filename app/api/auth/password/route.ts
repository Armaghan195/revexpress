import { verifyPassword, setPassword, passwordProblem, destroyAllSessionsFor, createSession, SESSION_COOKIE } from '@/lib/auth';
import { requireUserPendingPassword } from '@/lib/session';
import { queryOne } from '@/lib/db';
import { clientIp, fail, json, route } from '@/lib/http';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

/** Change your own password. Used by the forced first-login change too. */
export const POST = route(async (req: Request) => {
  // Reachable while must_change_password is still set — that is its purpose.
  const user = await requireUserPendingPassword();
  const body = await req.json().catch(() => ({}));
  const current = typeof body.current === 'string' ? body.current : '';
  const next = typeof body.next === 'string' ? body.next : '';

  const problem = passwordProblem(next);
  if (problem) return fail(problem);

  const row = await queryOne<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE id = $1',
    [user.id],
  );
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    return fail('Current password is incorrect', 401);
  }
  if (current === next) return fail('Choose a password you have not used here before');

  await setPassword(user.id, next);
  // Changing a password signs out every other device, then re-issues a session
  // for this one so the user is not bounced back to the login screen.
  await destroyAllSessionsFor(user.id);
  const { token, expires } = await createSession(user.id, { ip: clientIp(req) });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  });
  return json({ ok: true });
});
