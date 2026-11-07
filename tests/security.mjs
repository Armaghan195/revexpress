/**
 * Adversarial audit of the Command Center.
 *
 * Every check is written as "the system must resist X". A FAIL here is a real
 * finding, not a broken test. Run it, fix what it catches, run it again.
 */
import { launch, Client, sleep, findChrome } from './cdp.mjs';

const BASE = process.env.RX_BASE || 'http://127.0.0.1:3100';
const CHROME = findChrome();
const ADMIN = { email: 'admin@revenueexpress.com', password: 'Portal-Test-2026' };
const stamp = Date.now().toString(36);

const results = [];
const group = g => results.push({ group: g });
const check = (n, cond, d = '', severity = 'med') =>
  results.push({ pass: !!cond, n, d, severity });
const J = a => a.join(String.fromCharCode(10));

const { proc, wsUrl } = await launch(CHROME, 9393);
const c = await Client.connect(wsUrl);
await c.send('Page.enable');
await c.send('Runtime.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

async function go(url) {
  const done = new Promise(r => c.on('Page.loadEventFired', r));
  await c.send('Page.navigate', { url });
  await done;
  await sleep(600);
}
async function api(method, path, body, headers) {
  return c.eval(J([
    `const res = await fetch(${JSON.stringify(path)}, {`,
    `  method: ${JSON.stringify(method)},`,
    `  headers: ${JSON.stringify(headers || { 'Content-Type': 'application/json' })},`,
    body === undefined ? '' : `  body: ${JSON.stringify(JSON.stringify(body))},`,
    '});',
    'let parsed = null; try { parsed = await res.json(); } catch (e) {}',
    'return { status: res.status, body: parsed };',
  ]));
}
const login = (email, password) => api('POST', '/api/auth/login', { email, password });
const logout = () => api('POST', '/api/auth/logout');

await go(BASE + '/login');

/* ═══════════════════ 1. FORCED PASSWORD CHANGE ═══════════════════ */
group('Forced password change');

await login(ADMIN.email, ADMIN.password);
const provisioned = await api('POST', '/api/team', {
  email: `sec.${stamp}@revenueexpress.com`, name: 'Security Probe', role: 'member',
});
const otp = provisioned.body?.oneTimePassword;
check('a teammate can be provisioned for the probe', !!otp, 'status ' + provisioned.status);

await logout();
await login(`sec.${stamp}@revenueexpress.com`, otp);

// The login response asks the client to redirect. A hostile client simply
// would not, so the server has to enforce it as well.
await go(BASE + '/admin');
const landed = await c.eval("return location.pathname;");
check('a user who has not set their own password cannot reach the dashboard',
  landed === '/set-password', 'landed on ' + landed, 'high');

const leadsBeforeChange = await api('GET', '/api/leads');
check('…and cannot read data through the API either',
  leadsBeforeChange.status === 403, 'status ' + leadsBeforeChange.status, 'high');

/* ═══════════════════ 2. LEAD ENDPOINT ABUSE ═══════════════════ */
group('Lead endpoint abuse');

await logout();
await go(BASE + '/');

// Posted before the flood probe, so this gets a real answer rather than the
// rate limiter's 429 — which would make the check below vacuous.
const massEmail = `mass.${stamp}@x.test`;
const massAssign = await api('POST', '/api/leads', {
  name: 'Mass ' + stamp, email: massEmail, status: 'won', type: 'creator',
  id: 'attacker_chosen_id', created_at: '1999-01-01',
});
check('the lead form accepts the mass-assignment probe', massAssign.status === 200,
  'status ' + massAssign.status);

// The flood limit must not be keyed on something the caller controls.
const flood = await c.eval(J([
  "const out = [];",
  "for (let i = 0; i < 6; i++) {",
  "  const res = await fetch('/api/leads', {",
  "    method: 'POST', headers: { 'Content-Type': 'application/json' },",
  "    body: JSON.stringify({",
  `      name: 'Flood ${stamp} ' + i, email: 'flood.${stamp}.' + i + '@spam.test',`,
  "      source_path: '/', session_id: 'rotating_' + i + '_' + Math.random() })",
  "  });",
  "  out.push(res.status);",
  "}",
  "return out;",
]));
const accepted = flood.filter(s => s === 200).length;
check('rotating the session id does not bypass the flood limit',
  accepted <= 3, `${accepted} of 6 accepted (${flood.join(',')})`, 'high');

const huge = await api('POST', '/api/leads', {
  name: 'x'.repeat(5000), email: `huge.${stamp}@x.test`,
});
check('oversized input is rejected', huge.status === 400, 'status ' + huge.status);

const badTypes = await api('POST', '/api/leads', { name: { $ne: null }, email: ['a@b.c'] });
check('non-string types are rejected', badTypes.status === 400, 'status ' + badTypes.status);

// Rate limits key on the caller's IP, so if the caller can choose that value the
// limits are decoration. Sent from Node, because a browser will not let a page
// set X-Forwarded-For.
const spoofed = [];
for (let i = 0; i < 6; i++) {
  const res = await fetch(BASE + '/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.' + i },
    body: JSON.stringify({ name: 'Spoof ' + stamp + ' ' + i, email: `spoof.${stamp}.${i}@x.test` }),
  });
  spoofed.push(res.status);
}
const spoofAccepted = spoofed.filter(s => s === 200).length;
check('spoofing X-Forwarded-For does not buy a fresh rate-limit bucket',
  spoofAccepted <= 3, `${spoofAccepted} of 6 accepted (${spoofed.join(',')})`, 'high');

/* ═══════════════════ 3. ANALYTICS INGEST ABUSE ═══════════════════ */
group('Analytics ingest abuse');

const noOrigin = await c.eval(J([
  "const out = [];",
  "for (let i = 0; i < 90; i++) {",
  "  const res = await fetch('/api/track', {",
  "    method: 'POST', headers: { 'Content-Type': 'application/json' },",
  `    body: JSON.stringify({ sessionId: 'flood_${stamp}_' + i, visitorId: 'floodv_${stamp}_' + i,`,
  "      type: 'pageview', path: '/' }) });",
  "  out.push(res.status);",
  "}",
  "const body = await (await fetch('/api/track', { method:'POST',",
  "  headers:{'Content-Type':'application/json'},",
  `  body: JSON.stringify({ sessionId:'probe_${stamp}', visitorId:'probev_${stamp}',`,
  "    type:'pageview', path:'/' }) })).json();",
  "return { statuses: out, last: body };",
]));
const ingested = noOrigin.statuses.filter(s => s === 200).length;
check('the tracking endpoint throttles a flood',
  ingested < 90 || noOrigin.last?.ignored === true,
  `${ingested}/90 accepted, last response ${JSON.stringify(noOrigin.last)}`, 'med');

const spoofScroll = await api('POST', '/api/track', {
  sessionId: 'spoof_' + stamp, visitorId: 'spoofv_' + stamp,
  type: 'scroll', path: '/', scroll: 999999, durationMs: 999999999999,
});
check('out-of-range analytics values are rejected',
  spoofScroll.body?.ignored === true || spoofScroll.status === 400,
  JSON.stringify(spoofScroll.body));

/* ═══════════════════ 4. INJECTION ═══════════════════ */
group('Injection');

await login(ADMIN.email, ADMIN.password);

const sqlProbes = [
  "' OR '1'='1",
  "'; DROP TABLE leads; --",
  "\\'; DELETE FROM users; --",
  "' UNION SELECT password_hash FROM users --",
];
let injectionSafe = true;
let injectionDetail = '';
for (const probe of sqlProbes) {
  const res = await api('GET', '/api/leads?q=' + encodeURIComponent(probe));
  if (res.status !== 200 || !Array.isArray(res.body?.leads)) {
    injectionSafe = false;
    injectionDetail = probe + ' -> ' + res.status;
    break;
  }
  // A successful union would leak hashes into a lead row.
  if (JSON.stringify(res.body.leads).includes('$2a$') || JSON.stringify(res.body.leads).includes('$2b$')) {
    injectionSafe = false;
    injectionDetail = 'password hash leaked via ' + probe;
    break;
  }
}
check('SQL injection probes are neutralised', injectionSafe, injectionDetail || 'all 4 probes safe', 'high');

// Now that we are signed in, read back what the anonymous probe actually stored.
// A form that trusted the payload would have created a won lead, dated 1999,
// under an id the attacker chose.
const massStored = await api('GET', '/api/leads?q=' + encodeURIComponent(massEmail));
const massRow = (massStored.body?.leads || []).find(l => l.email === massEmail);
const massSafe = !!massRow
  && massRow.id !== 'attacker_chosen_id'
  && massRow.id.startsWith('lead_')
  && massRow.status === 'new'
  && new Date(massRow.created_at).getFullYear() >= 2026;
check('client cannot set fields it has no business setting', massSafe,
  massRow ? `id=${massRow.id} status=${massRow.status} created=${massRow.created_at}` : 'lead not found',
  'high');

const usersStillThere = await api('GET', '/api/team');
check('users table survived the probes', usersStillThere.status === 200, 'status ' + usersStillThere.status);

/* XSS through a lead field, rendered in the portal */
const xssLead = await api('POST', '/api/leads', {
  name: `<img src=x onerror="window.__leadXss=1">${stamp}`,
  email: `xss.${stamp}@x.test`,
  brand: '<script>window.__leadXss2=1</script>',
  message: '"><svg onload="window.__leadXss3=1">',
});
await go(BASE + '/admin/leads');
const leadXss = await c.eval(J([
  `const search = document.querySelector('.p-search');`,
  "return { executed: !!(window.__leadXss || window.__leadXss2 || window.__leadXss3),",
  "  injected: document.querySelectorAll('.p-leadtable img[onerror], .p-leadtable script').length };",
]));
check('lead fields cannot inject script into the portal',
  !leadXss.executed && leadXss.injected === 0,
  `executed:${leadXss.executed} injected nodes:${leadXss.injected}`, 'high');

/* XSS through a tracked CTA label, rendered on the dashboard */
await api('POST', '/api/track', {
  sessionId: 'xss_' + stamp, visitorId: 'xssv_' + stamp,
  type: 'cta_click', path: '/', label: '<img src=x onerror="window.__ctaXss=1">',
});
await go(BASE + '/admin/traffic?range=24h');
const ctaXss = await c.eval(
  "return { executed: !!window.__ctaXss, nodes: document.querySelectorAll('.p-barlist img').length };");
check('tracked labels cannot inject script into the dashboard',
  !ctaXss.executed && ctaXss.nodes === 0, JSON.stringify(ctaXss), 'high');

/* ═══════════════════ 5. SESSION HANDLING ═══════════════════ */
group('Session handling');

const cookieFlags = await c.send('Network.getCookies', { urls: [BASE] })
  .then(r => r.cookies.find(k => k.name === 'rx_session'))
  .catch(() => null);
check('session cookie is HttpOnly', cookieFlags?.httpOnly === true, JSON.stringify(cookieFlags?.httpOnly));
check('session cookie is SameSite=Lax or stricter',
  ['Lax', 'Strict'].includes(cookieFlags?.sameSite || ''), String(cookieFlags?.sameSite));
check('session cookie is scoped to the whole site', cookieFlags?.path === '/', String(cookieFlags?.path));

const forgedRes = await fetch(BASE + '/api/leads', {
  headers: { cookie: 'rx_session=forged-token-' + Math.random().toString(36).slice(2) },
});
check('a forged session token is rejected', forgedRes.status === 401,
  'status ' + forgedRes.status, 'high');

// The flip side: HttpOnly must actually hold, or a lifted token is a session.
const cookieVisible = await c.eval("return document.cookie.includes('rx_session');");
check('script cannot read the session cookie', cookieVisible === false,
  'document.cookie exposes rx_session: ' + cookieVisible, 'high');

/* ═══════════════════ 6. RESPONSE HYGIENE ═══════════════════ */
group('Response hygiene');

await go(BASE + '/login');
await login(ADMIN.email, ADMIN.password);

const notFound = await api('GET', '/api/leads/does-not-exist-' + stamp);
check('unknown ids return a clean 404, not a stack trace',
  notFound.status === 404 && !JSON.stringify(notFound.body).includes('at '),
  JSON.stringify(notFound.body));

const brokenJson = await c.eval(J([
  "const res = await fetch('/api/leads', { method:'POST',",
  "  headers:{'Content-Type':'application/json'}, body:'{not json' });",
  "const text = await res.text();",
  "return { status: res.status, leaks: /at \\\\w+|node_modules|\\\\.ts:\\\\d+/.test(text) };",
]));
check('malformed JSON does not leak internals',
  !brokenJson.leaks, 'status ' + brokenJson.status + ', leaked: ' + brokenJson.leaks);

const headers = await c.eval(J([
  "const res = await fetch('/');",
  "return { csp: res.headers.get('content-security-policy'),",
  "  nosniff: res.headers.get('x-content-type-options'),",
  "  frame: res.headers.get('x-frame-options'),",
  "  referrer: res.headers.get('referrer-policy'),",
  "  perms: res.headers.get('permissions-policy'),",
  "  powered: res.headers.get('x-powered-by') };",
]));
check('X-Content-Type-Options set', headers.nosniff === 'nosniff', String(headers.nosniff));
check('X-Frame-Options set', !!headers.frame, String(headers.frame));
check('Referrer-Policy set', !!headers.referrer, String(headers.referrer));
check('framework version not advertised', !headers.powered, String(headers.powered));
check('a Content-Security-Policy is sent', !!headers.csp, String(headers.csp), 'med');
check('Permissions-Policy limits powerful features', !!headers.perms, String(headers.perms), 'low');

/* ═══════════════════ 7. DATA EXPOSURE ═══════════════════ */
group('Data exposure');

const teamDump = await api('GET', '/api/team');
check('the team API never returns password hashes',
  !JSON.stringify(teamDump.body ?? {}).includes('password_hash'),
  'keys: ' + Object.keys(teamDump.body?.members?.[0] ?? {}).join(', '), 'high');

await logout();
const draftLeak = await api('GET', '/api/posts');
check('drafts are not readable while signed out', draftLeak.status === 401, 'status ' + draftLeak.status);

const sitemapLeak = await c.eval(J([
  "const res = await fetch('/sitemap.xml');",
  "const text = await res.text();",
  "return { hasAdmin: /\\/admin/.test(text), hasLogin: /\\/login/.test(text) };",
]));
check('sitemap does not advertise the portal',
  !sitemapLeak.hasAdmin && !sitemapLeak.hasLogin, JSON.stringify(sitemapLeak));

const portalIndexable = await c.eval(J([
  "const res = await fetch('/login');",
  "const html = await res.text();",
  "return /noindex/i.test(html);",
]));
check('the login page tells crawlers not to index it', portalIndexable, '');

/* ═══════════════════ REPORT ═══════════════════ */
console.log('\n================ SECURITY AUDIT ================');
let pass = 0;
const failures = [];
for (const r of results) {
  if (r.group) { console.log('\n-- ' + r.group + ' --'); continue; }
  console.log((r.pass ? '  PASS  ' : `  FAIL[${r.severity}]  `) + r.n + (r.d ? '  -- ' + r.d : ''));
  r.pass ? pass++ : failures.push(r);
}
console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) {
  console.log('\nFindings:');
  for (const f of failures) console.log(`  [${f.severity.toUpperCase()}] ${f.n} — ${f.d}`);
}
proc.kill();
process.exit(failures.length ? 1 : 0);
