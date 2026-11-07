/**
 * Session auth for the Command Center.
 *
 * There is no public signup. The super admin creates each account and the
 * system issues a one-time password that must be replaced on first login.
 * Sessions live in the database rather than in a stateless JWT so that
 * deactivating a teammate takes effect immediately, not whenever their token
 * happens to expire.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query, queryOne } from './db';

export const SESSION_COOKIE = 'rx_session';
const SESSION_DAYS = 7;
const BCRYPT_ROUNDS = 12;

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  must_change_password: boolean;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export function newId(prefix = ''): string {
  return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Readable one-time password: no ambiguous characters, so it survives being
 * read aloud or copied out of a chat message.
 */
export function generatePassword(length = 14): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out.slice(0, 4) + '-' + out.slice(4, 9) + '-' + out.slice(9);
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/* --------------------------------------------------------------- sessions -- */

export async function createSession(userId: string, meta: { ip?: string; userAgent?: string } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [hashToken(token), userId, expires.toISOString(), meta.ip ?? null, meta.userAgent ?? null],
  );
  return { token, expires };
}

export async function destroySession(token: string) {
  await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function destroyAllSessionsFor(userId: string) {
  await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export function hashSessionToken(token: string): string {
  return hashToken(token);
}

/* ------------------------------------------------------------ credentials -- */

/**
 * Throttle by email and by IP. Without this, an admin-only portal is still a
 * password-guessing target for anyone who finds the login URL.
 */
export async function isRateLimited(identifier: string, limit = 8, windowMinutes = 15) {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const row = await queryOne<{ n: string }>(
    `SELECT COUNT(*) AS n FROM login_attempts
      WHERE identifier = $1 AND succeeded = FALSE AND at > $2`,
    [identifier, since],
  );
  return Number(row?.n ?? 0) >= limit;
}

export async function recordLoginAttempt(identifier: string, succeeded: boolean) {
  await query('INSERT INTO login_attempts (identifier, succeeded) VALUES ($1, $2)', [
    identifier,
    succeeded,
  ]);
}

export interface LoginResult {
  ok: boolean;
  user?: User;
  reason?: 'invalid' | 'inactive' | 'rate_limited';
}

export async function authenticate(email: string, password: string, ip = 'unknown'): Promise<LoginResult> {
  const normalised = email.trim().toLowerCase();
  // Per-account limiting is strict; per-IP is deliberately looser, because a
  // whole office behind one NAT shares an address and should not be able to
  // lock each other out.
  if (await isRateLimited(normalised) || await isRateLimited(ip, 40)) {
    return { ok: false, reason: 'rate_limited' };
  }

  const row = await queryOne<User & { password_hash: string }>(
    `SELECT id, email, name, role, password_hash, must_change_password, is_active,
            created_at, last_login_at
       FROM users WHERE email = $1`,
    [normalised],
  );

  // Always run a comparison, even when the account does not exist, so response
  // time does not reveal which emails are registered.
  const hash = row?.password_hash ?? '$2a$12$0000000000000000000000000000000000000000000000000000';
  const valid = await verifyPassword(password, hash);

  if (!row || !valid) {
    await recordLoginAttempt(normalised, false);
    await recordLoginAttempt(ip, false);
    return { ok: false, reason: 'invalid' };
  }
  if (!row.is_active) {
    await recordLoginAttempt(normalised, false);
    return { ok: false, reason: 'inactive' };
  }

  // A correct password clears the slate for this account and address, so an
  // earlier run of failures cannot lock out someone who then signs in fine.
  await query(
    'DELETE FROM login_attempts WHERE succeeded = FALSE AND identifier IN ($1, $2)',
    [normalised, ip],
  );
  await recordLoginAttempt(normalised, true);
  await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [row.id]);
  const { password_hash, ...user } = row;
  return { ok: true, user };
}

/* -------------------------------------------------------------- accounts -- */

export async function createUser(opts: {
  email: string;
  name: string;
  role?: 'admin' | 'member';
  password?: string;
  createdBy?: string | null;
  mustChangePassword?: boolean;
}) {
  const email = opts.email.trim().toLowerCase();
  const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) throw new AuthError('That email already has an account', 409);

  const password = opts.password ?? generatePassword();
  const id = newId('usr_');
  await query(
    `INSERT INTO users (id, email, name, role, password_hash, must_change_password, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      email,
      opts.name.trim(),
      opts.role ?? 'member',
      await hashPassword(password),
      opts.mustChangePassword ?? true,
      opts.createdBy ?? null,
    ],
  );
  // Returned once, shown to the admin once, never recoverable afterwards.
  return { id, email, password };
}

export async function setPassword(userId: string, newPassword: string) {
  await query(
    `UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2`,
    [await hashPassword(newPassword), userId],
  );
}

export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters';
  if (!/[a-z]/i.test(password)) return 'Include a letter';
  if (!/[0-9]/.test(password)) return 'Include a number';
  return null;
}
