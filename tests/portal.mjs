/**
 * Deep functional test of the Command Center.
 *
 * Covers the whole loop the portal exists for: a visitor is tracked, submits the
 * form, the lead lands in the pipeline with its journey attached, the team moves
 * it, and the blog gets published — all through the real UI and the real API.
 */
import { launch, Client, sleep, findChrome, reporter } from './cdp.mjs';
import { shoot, inkRatio, pageBox } from './pixels.mjs';

const BASE = process.env.RX_BASE || 'http://127.0.0.1:3100';
const ADMIN = { email: 'admin@revenueexpress.com', password: 'Portal-Test-2026' };
const stamp = Date.now().toString(36);
const r = reporter('COMMAND CENTER');

const { proc, wsUrl } = await launch(findChrome(), 9395);
const c = await Client.connect(wsUrl);
await c.send('Page.enable');
await c.send('Runtime.enable');
await c.send('Emulation.setDeviceMetricsOverride',
  { width: 1440, height: 950, deviceScaleFactor: 1, mobile: false });

const errors = [];
c.on('Runtime.exceptionThrown', p =>
  errors.push(p.exceptionDetails?.exception?.description?.split('\n')[0] || 'error'));

async function go(url) {
  const done = new Promise(res => c.on('Page.loadEventFired', res));
  await c.send('Page.navigate', { url });
  await done;
  await sleep(700);
}
const $ = expr => c.eval('return ' + expr + ';');
const J = a => a.join(String.fromCharCode(10));

async function api(method, path, body) {
  return c.eval(J([
    `const res = await fetch(${JSON.stringify(path)}, {`,
    `  method: ${JSON.stringify(method)},`,
    "  headers: { 'Content-Type': 'application/json' },",
    body === undefined ? '' : `  body: ${JSON.stringify(JSON.stringify(body))},`,
    '});',
    'let parsed = null; try { parsed = await res.json(); } catch (e) {}',
    'return { status: res.status, body: parsed };',
  ]));
}

/* ═══════════════ 1. THE DOOR ═══════════════ */
r.group('Sign in');

await go(BASE + '/admin');
r.check('the portal is closed to strangers', (await $('location.pathname')) === '/login',
  'landed on ' + (await $('location.pathname')), 'high');

const wrongPassword = await api('POST', '/api/auth/login',
  { email: ADMIN.email, password: 'definitely-not-it' });
r.check('a wrong password is refused', wrongPassword.status === 401,
  'status ' + wrongPassword.status, 'high');
r.check('the refusal does not reveal whether the account exists',
  !/no such|not found|unknown account|no account/i.test(wrongPassword.body?.error || ''),
  JSON.stringify(wrongPassword.body));

const unknownUser = await api('POST', '/api/auth/login',
  { email: `nobody.${stamp}@revenueexpress.com`, password: 'whatever' });
r.check('an unknown account is refused the same way',
  unknownUser.status === 401
    && unknownUser.body?.error === wrongPassword.body?.error,
  'status ' + unknownUser.status + ', same message: '
    + (unknownUser.body?.error === wrongPassword.body?.error));

// The sign-in button lost its gradient once, to a `.portal button` rule that
// outranked `.p-btn`, so the login screen is checked in pixels too.
const buttonBox = await pageBox(c, 'form button[type="submit"], form button');
if (buttonBox) {
  const ink = inkRatio(await shoot(c, buttonBox));
  r.check('the sign-in button is styled, not a bare box', ink > 0.05,
    'ink ' + (ink * 100).toFixed(1) + '%');
}

const signedIn = await api('POST', '/api/auth/login', ADMIN);
r.check('the admin can sign in', signedIn.status === 200, JSON.stringify(signedIn.body), 'high');

/* ═══════════════ 2. THE TABS ═══════════════ */
r.group('Dashboard');

const TABS = [
  ['Overview', '/admin'],
  ['Traffic', '/admin/traffic'],
  ['Audience', '/admin/audience'],
  ['Leads', '/admin/leads'],
  ['Blog', '/admin/blog'],
  ['Team', '/admin/team'],
];

for (const [name, path] of TABS) {
  await go(BASE + path);
  const state = await $(`(() => ({
    path: location.pathname,
    words: document.body.textContent.trim().split(/\\s+/).length,
    error: /application error|something went wrong|unhandled/i.test(document.body.textContent),
    nav: document.querySelectorAll('a[href^="/admin"]').length,
  }))()`);
  r.check(`${name} renders`, state.path === path && state.words > 25 && !state.error,
    JSON.stringify(state), 'high');
  r.check(`${name} keeps the portal navigation`, state.nav >= 5, 'nav links: ' + state.nav);
}

// The dashboard must match the landing page's theme, not the stock template's.
await go(BASE + '/admin');
const theme = await $(`(() => {
  const body = getComputedStyle(document.body);
  const parse = v => (v.match(/\\d+/g) || []).slice(0, 3).map(Number);
  const [r0, g0, b0] = parse(body.backgroundColor);
  return { background: body.backgroundColor, dark: (r0 + g0 + b0) / 3 < 90,
           font: body.fontFamily };
})()`);
r.check('the portal wears the site\'s dark theme', theme.dark, JSON.stringify(theme));

/* ═══════════════ 3. ANALYTICS, END TO END ═══════════════ */
r.group('Analytics');

const before = await api('GET', '/api/track');
const beforeCount = await $(`(async () => {
  const res = await fetch('/admin/traffic?range=24h');
  const html = await res.text();
  return html.length;
})()`);

// A real visit: load the page, scroll it, click a CTA, then leave.
await go(BASE + '/');
const visited = await c.eval(`
  window.scrollTo({ top: document.body.scrollHeight * 0.6, behavior: 'instant' });
  await new Promise(res => setTimeout(res, 1200));
  const cta = document.querySelector('a.btn, button.btn');
  if (cta) cta.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise(res => setTimeout(res, 1200));
  document.dispatchEvent(new Event('visibilitychange'));
  return { tracker: typeof window.rxTrack === 'function',
           visitor: !!localStorage.getItem('rx_visitor') || localStorage.length > 0 };`);
r.check('the tracker is installed on the public page', visited.tracker, JSON.stringify(visited), 'high');
r.check('the visitor id is stored locally, with no cookie banner needed',
  visited.visitor, JSON.stringify(visited));

const noCookies = await c.send('Network.getCookies', { urls: [BASE] })
  .then(res => res.cookies.filter(k => k.name !== 'rx_session').map(k => k.name))
  .catch(() => []);
r.check('tracking sets no cookies at all', noCookies.length === 0,
  noCookies.join(', ') || 'none', 'high');

await sleep(1500);
await go(BASE + '/admin/traffic?range=24h');
// Read the stat elements themselves. Scraping digits out of the whole document
// also picks up CSS width percentages and SVG path coordinates.
const traffic = await $(`(() => {
  const values = [...document.querySelectorAll('.p-stat-value')].map(el => el.textContent.trim());
  const numeric = values.map(v => Number(v.replace(/[^\\d.]/g, ''))).filter(n => !isNaN(n));
  return {
    values,
    populated: numeric.filter(n => n > 0).length,
    // A raw float here would mean an unrounded number reached the UI.
    unrounded: values.filter(v => /\\.\\d{3,}/.test(v)),
    zeroState: /no data yet|nothing to show/i.test(document.body.textContent),
  };
})()`);
r.check('the traffic tab shows real numbers',
  traffic.populated > 0 && !traffic.zeroState, JSON.stringify(traffic), 'high');
r.check('every headline number is rounded for display',
  traffic.unrounded.length === 0, JSON.stringify(traffic.unrounded));

// Section reach is the panel that tells the team how far down the page people
// get, and it must name this site's sections rather than a template's.
const reach = await $(`(() => {
  const text = document.body.textContent.toLowerCase();
  const ours = ['engine', 'framework', 'pricing', 'results', 'contact'];
  return { matched: ours.filter(s => text.includes(s)),
           hasPanel: /section/i.test(document.body.textContent) };
})()`);
r.check('the traffic tab reports reach into the site\'s own sections',
  reach.hasPanel && reach.matched.length >= 3, JSON.stringify(reach), 'high');

await go(BASE + '/admin/audience');
const audience = await $(`(() => {
  const panels = [...document.querySelectorAll('.p-panel-title')].map(el => el.textContent.trim());
  const rows = document.querySelectorAll('.p-barrow-label').length;
  return { panels, rows };
})()`);
r.check('the audience tab breaks visitors down by device, country and recency',
  audience.panels.length >= 3 && audience.rows > 0, JSON.stringify(audience), 'high');

/* ═══════════════ 4. THE LEAD PIPELINE ═══════════════ */
r.group('Leads');

// Arrive as a visitor, then send the form exactly as the site does.
await go(BASE + '/');
const leadEmail = `pipeline.${stamp}@brand.test`;
const created = await c.eval(J([
  // Exactly what the real form reads: track.js publishes the id it is using.
  "const sessionId = window.__rxSession || null;",
  "const res = await fetch('/api/leads', {",
  "  method: 'POST', headers: { 'Content-Type': 'application/json' },",
  "  body: JSON.stringify({",
  `    name: 'Pipeline ${stamp}', email: ${JSON.stringify(leadEmail)},`,
  "    phone: '+92 326 5025286', brand: 'Pipeline Brand',",
  "    ad_spend: '$50k-100k', biggest_need: 'Creator volume',",
  "    source_path: '/', session_id: sessionId }),",
  "});",
  "return { status: res.status, body: await res.json().catch(() => null) };",
]));
r.check('the form creates a lead', created.status === 200 && !!created.body?.id,
  JSON.stringify(created).slice(0, 200), 'high');

const leadId = created.body?.id;

await go(BASE + '/admin/leads');
const listed = await $(`(() => {
  const text = document.body.textContent;
  return { showsLead: text.includes('Pipeline ${stamp}'),
           showsPhone: /326\\s?5025286/.test(text.replace(/\\s+/g, ' ')) };
})()`);
r.check('the lead appears in the pipeline', listed.showsLead, JSON.stringify(listed), 'high');

if (leadId) {
  const detail = await api('GET', '/api/leads/' + leadId);
  const lead = detail.body?.lead;
  r.check('the lead keeps the phone number the form collected',
    (lead?.phone || '').includes('5025286'), 'phone: ' + lead?.phone, 'high');
  r.check('the lead starts in the New stage', lead?.status === 'new', 'status: ' + lead?.status);

  const wa = await $(`(() => {
    const a = [...document.querySelectorAll('a[href*="wa.me"]')];
    return a.length;
  })()`);
  r.check('the pipeline offers a WhatsApp link for phone leads', wa > 0, 'wa.me links: ' + wa);

  // Stage changes, and the audit trail behind them.
  const moved = await api('PATCH', '/api/leads/' + leadId, { status: 'contacted' });
  r.check('a lead can be moved along the pipeline',
    moved.status === 200 && moved.body?.lead?.status === 'contacted',
    JSON.stringify(moved.body?.lead?.status), 'high');
  r.check('the move is written to the activity log',
    (moved.body?.notes || []).some(n => n.kind === 'status'),
    JSON.stringify((moved.body?.notes || []).map(n => n.kind)));

  const badStage = await api('PATCH', '/api/leads/' + leadId, { status: 'president' });
  r.check('an invented stage is refused', badStage.status === 400, 'status ' + badStage.status);

  const noted = await api('PATCH', '/api/leads/' + leadId, { note: 'Called, left a voicemail.' });
  r.check('the team can add a note',
    noted.status === 200 && (noted.body?.notes || []).some(n => n.body.includes('voicemail')),
    'notes: ' + (noted.body?.notes || []).length);

  const withContext = await api('GET', '/api/leads/' + leadId);
  const context = withContext.body?.context;
  r.check('the lead carries the visit that produced it', !!context,
    JSON.stringify(context), 'high');
  r.check('that visit records how far the visitor got',
    !!context && (context.maxScroll > 0 || context.deepestSection !== null),
    JSON.stringify(context && { maxScroll: context.maxScroll, deepest: context.deepestSection }));
}

/* ═══════════════ 5. THE BLOG CMS ═══════════════ */
r.group('Blog CMS');

const slug = 'suite-post-' + stamp;
const draft = await api('POST', '/api/posts', {
  title: 'Suite Post ' + stamp,
  slug,
  excerpt: 'Written by the automated suite.',
  body_md: '## Heading\n\nA paragraph with **bold** text and a [link](https://example.com).',
  status: 'draft',
});
r.check('an editor can create a draft', draft.status === 201 || draft.status === 200,
  JSON.stringify(draft.body).slice(0, 160), 'high');

const postId = draft.body?.post?.id;

const draftPublic = await c.eval(
  `const res = await fetch('/blog/${slug}'); return res.status;`);
r.check('a draft is not readable by the public', draftPublic === 404, 'status ' + draftPublic, 'high');

if (postId) {
  const full = draft.body.post;
  const publish = fields => api('PUT', '/api/posts/' + postId, {
    title: full.title, slug: full.slug, excerpt: full.excerpt,
    body_md: full.body_md, status: 'published', ...fields,
  });
  const published = await publish();
  r.check('a draft can be published',
    published.status === 200 && published.body?.post?.status === 'published',
    JSON.stringify(published.body?.post?.status), 'high');

  const publishedAt = published.body?.post?.published_at;
  const edited = await publish({ excerpt: 'Edited after publishing.' });
  r.check('editing a published post does not restamp its date',
    edited.body?.post?.published_at === publishedAt,
    `${publishedAt} -> ${edited.body?.post?.published_at}`);

  await go(BASE + '/blog/' + slug);
  const rendered = await $(`(() => ({
    heading: !!document.querySelector('h2'),
    bold: !!document.querySelector('strong'),
    link: !!document.querySelector('a[href="https://example.com"]'),
    raw: document.body.textContent.includes('**bold**'),
  }))()`);
  r.check('markdown is rendered, not printed',
    rendered.heading && rendered.bold && rendered.link && !rendered.raw,
    JSON.stringify(rendered), 'high');

  // An editor account is not a reason to let script onto a public page.
  await publish({
    body_md: 'Before <script>window.__cmsXss = 1;</script> after '
      + '<img src=x onerror="window.__cmsXss = 2"> end.',
  });
  await go(BASE + '/blog/' + slug);
  const sanitised = await $(`(() => ({
    executed: window.__cmsXss !== undefined,
    scripts: document.querySelectorAll('article script, main script').length,
    handlers: document.querySelectorAll('[onerror], [onload]').length,
    text: document.body.textContent.includes('Before') && document.body.textContent.includes('end.'),
  }))()`);
  r.check('post markup is sanitised server-side',
    !sanitised.executed && sanitised.scripts === 0 && sanitised.handlers === 0,
    JSON.stringify(sanitised), 'high');
  r.check('sanitising keeps the surrounding prose', sanitised.text, JSON.stringify(sanitised));

  const duplicate = await api('POST', '/api/posts', {
    title: 'Clash', slug, excerpt: 'x', body_md: 'x', status: 'draft',
  });
  r.check('a clashing slug is made unique rather than colliding',
    duplicate.body?.post?.slug && duplicate.body.post.slug !== slug,
    slug + ' -> ' + duplicate.body?.post?.slug, 'high');

  await go(BASE + '/sitemap.xml');
  const inSitemap = await $(`document.body.textContent.includes('${slug}')`);
  r.check('publishing adds the post to the sitemap', inSitemap, 'slug present: ' + inSitemap);
}

/* ═══════════════ 6. THE TEAM ═══════════════ */
r.group('Team');

const member = await api('POST', '/api/team', {
  email: `member.${stamp}@revenueexpress.com`, name: 'Suite Member', role: 'member',
});
r.check('the admin can provision a teammate', member.status === 201 || member.status === 200,
  JSON.stringify(member.body).slice(0, 140), 'high');
r.check('provisioning returns a one-time password, once',
  typeof member.body?.oneTimePassword === 'string' && member.body.oneTimePassword.length >= 8,
  'length ' + (member.body?.oneTimePassword || '').length, 'high');

const memberId = member.body?.member?.id;
const listedAgain = await api('GET', '/api/team');
const stored = (listedAgain.body?.members || []).find(u => u.id === memberId);
r.check('the one-time password is never readable again',
  stored && !('oneTimePassword' in stored) && !('password_hash' in stored),
  JSON.stringify(Object.keys(stored || {})), 'high');
r.check('the new teammate is flagged to change their password',
  stored?.must_change_password === true, JSON.stringify(stored?.must_change_password));

const duplicateUser = await api('POST', '/api/team', {
  email: `member.${stamp}@revenueexpress.com`, name: 'Clash', role: 'member',
});
r.check('the same email cannot be provisioned twice', duplicateUser.status >= 400,
  'status ' + duplicateUser.status);

// A member must not be able to do admin things.
const otp = member.body?.oneTimePassword;
await api('POST', '/api/auth/logout');
await api('POST', '/api/auth/login',
  { email: `member.${stamp}@revenueexpress.com`, password: otp });
const changed = await api('POST', '/api/auth/password',
  { current: otp, next: 'Member-Chosen-2026!' });
r.check('a provisioned teammate can set their own password', changed.status === 200,
  JSON.stringify(changed.body), 'high');

const memberProvisioning = await api('POST', '/api/team', {
  email: `sneaky.${stamp}@revenueexpress.com`, name: 'Sneaky', role: 'admin',
});
r.check('a member cannot provision accounts', memberProvisioning.status === 403,
  'status ' + memberProvisioning.status, 'high');

const memberPromotion = await api('PATCH', '/api/team/' + memberId, { role: 'admin' });
r.check('a member cannot promote themselves', memberPromotion.status === 403,
  'status ' + memberPromotion.status, 'high');

const memberLeads = await api('GET', '/api/leads');
r.check('a member can still do their job (read leads)', memberLeads.status === 200,
  'status ' + memberLeads.status);

/* ═══════════════ 7. DEACTIVATION ═══════════════ */
r.group('Deactivation');

await api('POST', '/api/auth/logout');
await api('POST', '/api/auth/login', ADMIN);
const deactivated = await api('PATCH', '/api/team/' + memberId, { action: 'deactivate' });
r.check('the admin can deactivate a teammate', deactivated.status === 200,
  'status ' + deactivated.status);

await api('POST', '/api/auth/logout');
const deactivatedLogin = await api('POST', '/api/auth/login',
  { email: `member.${stamp}@revenueexpress.com`, password: 'Member-Chosen-2026!' });
// 403 rather than 401 is deliberate: the password is verified first, so this is
// only ever shown to the account's real owner, who deserves to know why they
// are locked out instead of assuming they mistyped.
r.check('a deactivated teammate cannot sign in',
  deactivatedLogin.status === 403 || deactivatedLogin.status === 401,
  'status ' + deactivatedLogin.status, 'high');
const noSession = await api('GET', '/api/leads');
r.check('and no session is granted on the way out', noSession.status === 401,
  'status ' + noSession.status, 'high');

/* ═══════════════ 8. SIGNING OUT ═══════════════ */
r.group('Sign out');

await api('POST', '/api/auth/login', ADMIN);
await api('POST', '/api/auth/logout');
const afterLogout = await api('GET', '/api/leads');
r.check('signing out ends the session immediately', afterLogout.status === 401,
  'status ' + afterLogout.status, 'high');

await go(BASE + '/admin');
r.check('and the dashboard is closed again', (await $('location.pathname')) === '/login',
  'landed on ' + (await $('location.pathname')), 'high');

r.check('no uncaught exceptions across the portal', errors.length === 0,
  errors.slice(0, 3).join(' | ') || 'clean', 'high');

const failures = r.report();
proc.kill();
process.exit(failures ? 1 : 0);
