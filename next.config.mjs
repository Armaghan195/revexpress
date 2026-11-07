const isDev = process.env.NODE_ENV === 'development';

/**
 * The production policy is the strict one. `next dev` cannot run under it: the
 * dev bundle compiles modules with eval, and Fast Refresh talks to the server
 * over a websocket, so a policy without 'unsafe-eval' and ws: leaves the page
 * with its markup but none of its JavaScript — which reads as a blank page,
 * because every section starts at opacity 0 until the reveal script runs.
 *
 * These two relaxations apply to the dev server only and never ship.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // PGlite ships WASM and is only used by the local dev database. Keeping it
  // external stops the bundler from trying to inline it.
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // Defence in depth behind the server-side sanitising of blog content:
          // even if markup slipped through, injected script has nowhere to run
          // and nowhere to send data. 'unsafe-inline' is required for Next's
          // hydration bootstrap and the JSON-LD blocks; everything else is
          // locked to this origin plus the Google Fonts the design uses.
          { key: 'Content-Security-Policy', value: csp },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },
        ],
      },
    ];
  },
};
export default nextConfig;
