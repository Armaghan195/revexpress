/** Small helpers shared by the API routes. */
import { NextResponse } from 'next/server';
import { AuthError } from './auth';

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * Wrap a route handler so thrown AuthErrors become clean 401/403s instead of
 * leaking a stack trace, and anything unexpected becomes a plain 500.
 */
export function route<T extends any[]>(
  handler: (...args: T) => Promise<Response>,
): (...args: T) => Promise<Response> {
  return async (...args: T) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof AuthError) return fail(err.message, err.status);
      console.error('[api]', err);
      return fail('Something went wrong', 500);
    }
  };
}

/** Best-effort client IP behind Vercel's proxy. Used for rate limiting only. */
/**
 * The caller's IP, as far as it can be trusted.
 *
 * This value keys every rate limit in the app, so a caller who can choose it can
 * lift every limit. `X-Forwarded-For` is a *client-supplied* header: anyone can
 * send one, and reading its first entry — the usual mistake — hands an attacker
 * a fresh bucket per request.
 *
 * So: prefer the header the platform's own edge sets, which it overwrites rather
 * than accepts from the client. Failing that, honour `X-Forwarded-For` only when
 * the operator has declared a proxy sits in front (TRUST_PROXY), and even then
 * read the *last* entry — the one that proxy appended, describing the connection
 * it actually received — not the first, which the client wrote.
 *
 * With no proxy the socket is the truth, and Next does not expose it here; every
 * caller then shares the 'unknown' bucket, which fails closed (limits are
 * stricter than intended) rather than open.
 */
export function clientIp(req: Request): string {
  const edge =
    req.headers.get('x-vercel-forwarded-for') ?? // Vercel
    req.headers.get('cf-connecting-ip') ?? // Cloudflare
    req.headers.get('true-client-ip'); // Akamai, Cloudflare Enterprise
  if (edge) return edge.split(',')[0].trim();

  if (process.env.TRUST_PROXY === '1') {
    const fwd = req.headers.get('x-forwarded-for');
    if (fwd) {
      const hops = fwd.split(',').map(h => h.trim()).filter(Boolean);
      if (hops.length) return hops[hops.length - 1];
    }
    const real = req.headers.get('x-real-ip');
    if (real) return real.trim();
  }

  return 'unknown';
}

export function clientCountry(req: Request): string | null {
  // Vercel and Cloudflare both attach this at the edge.
  return (
    req.headers.get('x-vercel-ip-country') ??
    req.headers.get('cf-ipcountry') ??
    null
  );
}
