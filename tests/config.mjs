/**
 * Checks the response headers the app is configured to send, in BOTH modes.
 *
 * This suite exists because of a real regression: a strict Content-Security-Policy
 * was added and verified against a production build, where it is correct. The dev
 * server compiles modules with eval and talks to Fast Refresh over a websocket,
 * so the same policy left `next dev` serving markup with no working JavaScript —
 * a blank page, since every section starts at opacity 0 until the reveal script
 * runs. Every other suite runs against a production build and could not see it.
 *
 * The config is read in a child process per mode, because NODE_ENV is captured
 * when the module is first imported and cannot be changed afterwards.
 */
import { execFileSync } from 'node:child_process';
import { reporter } from './cdp.mjs';

const r = reporter('CONFIG');

function headersFor(mode) {
  const script = `
    import('./next.config.mjs')
      .then(m => m.default.headers())
      .then(groups => {
        const headers = {};
        for (const group of groups) {
          for (const h of group.headers) headers[h.key.toLowerCase()] = h.value;
        }
        console.log(JSON.stringify(headers));
      });
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, NODE_ENV: mode },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split(String.fromCharCode(10)).pop());
}

const dev = headersFor('development');
const prod = headersFor('production');

r.group('Production policy');

const p = prod['content-security-policy'] || '';
r.check('a Content-Security-Policy is configured', p.length > 0, p.slice(0, 60), 'high');
r.check('production does not allow eval', !p.includes('unsafe-eval'),
  p.match(/script-src[^;]*/)?.[0] || '', 'high');
r.check('production locks connections to this origin',
  /connect-src 'self'\s*(;|$)/.test(p), p.match(/connect-src[^;]*/)?.[0] || '', 'high');
r.check('production forbids plugins and framing by others',
  p.includes("object-src 'none'") && p.includes("frame-ancestors 'self'"), '', 'high');

for (const [name, expected] of [
  ['x-content-type-options', 'nosniff'],
  ['x-frame-options', 'SAMEORIGIN'],
  ['referrer-policy', 'strict-origin-when-cross-origin'],
]) {
  r.check(`${name} is set`, prod[name] === expected, String(prod[name]));
}
r.check('permissions-policy denies powerful features',
  /camera=\(\)/.test(prod['permissions-policy'] || ''), prod['permissions-policy'] || '');

r.group('Development policy');

const d = dev['content-security-policy'] || '';
// Without these two, `npm run dev` serves a page whose scripts never run.
r.check('development allows the eval the dev bundle needs',
  d.includes("'unsafe-eval'"), d.match(/script-src[^;]*/)?.[0] || '', 'high');
r.check('development allows the Fast Refresh websocket',
  /connect-src[^;]*ws:/.test(d), d.match(/connect-src[^;]*/)?.[0] || '', 'high');
r.check('development is otherwise the same policy',
  d.includes("object-src 'none'") && d.includes("default-src 'self'"), '', 'high');

r.group('The relaxations are dev-only');

r.check('eval never reaches production',
  d.includes("'unsafe-eval'") && !p.includes("'unsafe-eval'"),
  'dev allows it, production does not', 'high');
r.check('the websocket allowance never reaches production',
  /connect-src[^;]*ws:/.test(d) && !/connect-src[^;]*ws:/.test(p),
  'dev allows it, production does not', 'high');

process.exit(r.report() ? 1 : 0);
