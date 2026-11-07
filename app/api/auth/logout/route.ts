import { cookies } from 'next/headers';
import { destroySession, SESSION_COOKIE } from '@/lib/auth';
import { json, route } from '@/lib/http';

export const runtime = 'nodejs';

export const POST = route(async () => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  store.delete(SESSION_COOKIE);
  return json({ ok: true });
});
