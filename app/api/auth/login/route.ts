import { cookies } from 'next/headers';
import { authenticate, createSession, SESSION_COOKIE } from '@/lib/auth';
import { clientIp, fail, json, route } from '@/lib/http';

export const runtime = 'nodejs';

export const POST = route(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) return fail('Email and password are required');

  const ip = clientIp(req);
  const result = await authenticate(email, password, ip);

  if (!result.ok) {
    if (result.reason === 'rate_limited') {
      return fail('Too many attempts. Try again in a few minutes.', 429);
    }
    if (result.reason === 'inactive') {
      return fail('That account has been deactivated.', 403);
    }
    // Deliberately vague: never reveal whether the email exists.
    return fail('Email or password is incorrect', 401);
  }

  const { token, expires } = await createSession(result.user!.id, {
    ip,
    userAgent: req.headers.get('user-agent') ?? undefined,
  });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  });

  return json({
    ok: true,
    mustChangePassword: result.user!.must_change_password,
    user: { name: result.user!.name, email: result.user!.email, role: result.user!.role },
  });
});
