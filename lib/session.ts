/**
 * Cookie-bound session helpers. Kept apart from lib/auth.ts because that file
 * is also imported by the CLI scripts, and next/headers only exists inside the
 * Next server runtime.
 */
import { cookies } from 'next/headers';
import { query, queryOne } from './db';
import { AuthError, SESSION_COOKIE, hashSessionToken, type User } from './auth';

/** Resolve the signed-in user, or null. Expired and deactivated users fail closed. */
export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = await queryOne<User & { expires_at: string }>(
    `SELECT u.id, u.email, u.name, u.role, u.must_change_password, u.is_active,
            u.created_at, u.last_login_at, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [hashSessionToken(token)],
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await query('DELETE FROM sessions WHERE token_hash = $1', [hashSessionToken(token)]);
    return null;
  }
  if (!row.is_active) return null;
  const { expires_at, ...user } = row;
  return user;
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError('Not signed in', 401);
  // A provisioned account holds a one-time password until its owner replaces
  // it. Until then it can do exactly one thing: set a new password.
  if (user.must_change_password) {
    throw new AuthError('Set your own password before continuing', 403);
  }
  return user;
}

/** For the password screen itself, which must work before the change is made. */
export async function requireUserPendingPassword(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError('Not signed in', 401);
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== 'admin') throw new AuthError('Admins only', 403);
  return user;
}
