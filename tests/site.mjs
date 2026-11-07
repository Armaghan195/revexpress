/**
 * Deep functional test of the public site: the marketing page, the blog, and
 * the contact form that feeds the portal.
 *
 * Runs against a real Chrome over CDP, and asserts on painted pixels wherever
 * the question is "can a visitor actually see this?".
 */
import { launch, Client, sleep, findChrome, reporter } from './cdp.mjs';
import { shoot, inkRatio, pageBox } from './pixels.mjs';

const BASE = process.env.RX_BASE || 'http://127.0.0.1:3100';
const stamp = Date.now().toString(36);
const r = reporter('PUBLIC SITE');

const { proc, wsUrl } = await launch(findChrome(), 9394);
const c = await Client.connect(wsUrl);
await c.send('Page.enable');
await c.send('Runtime.enable');
await c.send('Network.enable');
await c.send('Console.enable');

const consoleErrors = [];
const failedRequests = [];
c.on('Runtime.exceptionThrown', p =>
  consoleErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'error'));
c.on('Network.loadingFailed', p => {
  // Cancelled prefetches and aborted media are noise, not broken links.
  if (!/net::ERR_ABORTED/.test(p.errorText || '')) failedRequests.push(p.errorText);
});

async function go(url) {
  const done = new Promise(res => c.on('Page.loadEventFired', res));
  await c.send('Page.navigate', { url });
  await done;
  await sleep(900);
}
const $ = expr => c.eval('return ' + expr + ';');
async function viewport(width, height, mobile = false) {
  await c.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile,
  });
}

await viewport(1440, 900);

/* ═══════════════ 1. THE PAGE LOADS ═══════════════ */
r.group('Page load');

await go(BASE + '/');

r.check('the marketing page renders', await $("document.title.length > 0"), await $('document.title'));

const SECTIONS = ['top', 'hero', 'problem', 'engine', 'framework', 'avatars',
  'distribution', 'spotlight', 'results', 'pricing', 'contact'];
const missing = await c.eval(
  `return ${JSON.stringify(SECTIONS)}.filter(id => !document.getElementById(id));`);
r.check('every section is present', missing.length === 0, 'missing: ' + (missing.join(', ') || 'none'), 'high');

const emptySections = await c.eval(`
  const ids = ${JSON.stringify(SECTIONS)};
  return ids.filter(id => {
    const el = document.getElementById(id);
    return el && el.getBoundingClientRect().height < 40;
  });`);
r.check('no section collapsed to nothing', emptySections.length === 0,
  'collapsed: ' + (emptySections.join(', ') || 'none'), 'high');

/* ═══════════════ 2. ASSETS ═══════════════ */
r.group('Assets');

const brokenImages = await c.eval(`
  const imgs = [...document.images];
  imgs.forEach(i => { i.loading = 'eager'; });
  await new Promise(res => setTimeout(res, 1200));
  return imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src'));`);
r.check('every image resolves', brokenImages.length === 0,
  brokenImages.length ? brokenImages.slice(0, 5).join(', ') : `${await $('document.images.length')} images`, 'high');

const logo = await $(`(() => {
  const el = document.querySelector('#nav img, .nav img, header img');
  return el ? { w: el.naturalWidth, h: el.naturalHeight, src: el.getAttribute('src') } : null;
})()`);
r.check('the nav shows the real logo', logo && logo.w > 0, JSON.stringify(logo), 'high');

const favicon = await $(`!!document.querySelector('link[rel*="icon"]')`);
r.check('a favicon is declared', favicon);

/* ═══════════════ 3. THE ROTATING HEADLINE ═══════════════ */
// This is the bug that a computed-style check declared fixed while the word was
// invisible on mobile, so it is asserted on pixels at both sizes.
r.group('Rotating headline');

for (const [label, w, h, mobile] of [['desktop', 1440, 900, false], ['mobile', 390, 844, true]]) {
  await viewport(w, h, mobile);
  await go(BASE + '/');
  await sleep(1200);

  const box = await pageBox(c, '.rotating-word');
  const wordInfo = await $(`(() => {
    const el = document.querySelector('.rotating-word');
    return el ? { text: el.textContent.trim(), opacity: getComputedStyle(el).opacity } : null;
  })()`);

  r.check(`[${label}] the rotating word occupies space`,
    box && box.width > 10 && box.height > 6,
    JSON.stringify({ ...box, ...wordInfo }), 'high');

  if (box && box.width > 10 && box.height > 6) {
    const ink = inkRatio(await shoot(c, box));
    r.check(`[${label}] the rotating word is actually painted`, ink > 0.02,
      'ink ' + (ink * 100).toFixed(2) + '% of the word box', 'high');
  }

  const changed = await c.eval(`
    const el = document.querySelector('.rotating-word');
    const first = el.textContent.trim();
    for (let i = 0; i < 60; i++) {
      await new Promise(res => setTimeout(res, 200));
      if (el.textContent.trim() !== first) return { first, then: el.textContent.trim() };
    }
    return { first, then: first };`);
  r.check(`[${label}] the word rotates through the list`, changed.first !== changed.then,
    changed.first + ' -> ' + changed.then, 'high');
}

await viewport(1440, 900);
await go(BASE + '/');

/* ═══════════════ 4. LAYOUT INTEGRITY ═══════════════ */
r.group('Layout');

const overflow = await $(`(() => {
  const doc = document.documentElement;
  return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
})()`);
r.check('the page does not scroll sideways',
  overflow.scrollWidth <= overflow.clientWidth + 1,
  `${overflow.scrollWidth}px of content in a ${overflow.clientWidth}px viewport`, 'high');

// The clients marquee once widened the document to 3678px because it was masked
// but never clipped.
const marqueeClipped = await $(`(() => {
  const el = document.querySelector('.clients-marquee');
  if (!el) return null;
  return { overflow: getComputedStyle(el).overflowX, width: el.getBoundingClientRect().width,
           viewport: window.innerWidth };
})()`);
r.check('the clients marquee is clipped to the viewport',
  marqueeClipped && marqueeClipped.overflow === 'hidden'
    && marqueeClipped.width <= marqueeClipped.viewport + 1,
  JSON.stringify(marqueeClipped), 'high');

// The flip cards' back faces used to sit offset because a later position:relative
// rule beat the flip block's position:absolute.
const flip = await c.eval(`
  const cards = [...document.querySelectorAll('.avatar-card.flip')];
  return cards.map(card => {
    const front = card.querySelector('.avatar-face');
    const back = card.querySelector('.avatar-back');
    if (!front || !back) return { ok: false, why: 'faces not found' };
    const f = front.getBoundingClientRect();
    const b = back.getBoundingClientRect();
    return { ok: Math.abs(f.x - b.x) <= 2 && Math.abs(f.y - b.y) <= 2
                 && Math.abs(f.width - b.width) <= 2,
             dx: Math.round(f.x - b.x), dy: Math.round(f.y - b.y),
             dw: Math.round(f.width - b.width) };
  });`);
r.check('flip cards stack their two faces exactly',
  flip.length > 0 && flip.every(f => f.ok), JSON.stringify(flip), 'high');

/* ═══════════════ 5. NAVIGATION ═══════════════ */
r.group('Navigation');

const navTargets = await c.eval(`
  return [...document.querySelectorAll('a[href^="#"]')]
    .map(a => a.getAttribute('href').slice(1))
    .filter(Boolean)
    .filter(id => !document.getElementById(id));`);
r.check('every in-page link points at a real section', navTargets.length === 0,
  'dangling: ' + (navTargets.join(', ') || 'none'), 'high');

// Active highlighting: scroll to a section and the matching link must light up.
const highlight = await c.eval(`
  const out = [];
  for (const id of ['engine', 'framework', 'results', 'pricing']) {
    const section = document.getElementById(id);
    if (!section) { out.push({ id, ok: false, why: 'no section' }); continue; }
    section.scrollIntoView({ behavior: 'instant', block: 'center' });
    await new Promise(res => setTimeout(res, 700));
    const link = document.querySelector('a[href="#' + id + '"]');
    const active = link && (link.classList.contains('active')
      || link.getAttribute('aria-current') === 'true'
      || link.closest('.active') !== null);
    out.push({ id, ok: !!active });
  }
  return out;`);
r.check('the nav highlights the section in view',
  highlight.every(h => h.ok), JSON.stringify(highlight), 'high');

// Reloading used to drop the visitor into the middle of the page.
await c.eval("window.scrollTo({ top: 4000, behavior: 'instant' });");
await sleep(400);
await go(BASE + '/');
const afterReload = await $('window.scrollY');
r.check('a reload starts at the top of the page', afterReload < 40,
  'scrollY ' + afterReload, 'high');

/* ═══════════════ 6. THE ORBIT ═══════════════ */
r.group('Distribution orbit');

const orbit = await c.eval(`
  const wrap = document.querySelector('.orbit-wrap');
  if (!wrap) return { found: false };
  const nodes = [...wrap.querySelectorAll('.orbit-node')];
  return {
    found: true,
    nodes: nodes.length,
    // Every node must carry a drawn mark, not the letter placeholders it started as.
    withLogo: nodes.filter(n => {
      const svg = n.querySelector('.node-logo');
      return svg && svg.querySelector('path, circle, rect');
    }).length,
    labelled: nodes.filter(n => n.querySelector('[aria-label]')).length,
  };`);
r.check('every orbit node carries a platform logo, not a letter',
  orbit.found && orbit.nodes >= 4 && orbit.withLogo === orbit.nodes,
  JSON.stringify(orbit), 'high');
r.check('each orbit node names its platform for screen readers',
  orbit.found && orbit.labelled === orbit.nodes, JSON.stringify(orbit));

// The logos must be painted, not merely present: an SVG with a broken path
// occupies its box and draws nothing.
await c.eval(`
  document.querySelector('.orbit-wrap').scrollIntoView({ behavior: 'instant', block: 'center' });
  await new Promise(res => setTimeout(res, 1200));`);
const nodeBoxes = [];
for (let i = 0; i < 3; i++) {
  const box = await pageBox(c, '.orbit-wrap .node-logo', i);
  if (box) nodeBoxes.push(box);
}
let painted = 0;
for (const box of nodeBoxes) {
  if (box.width < 4 || box.height < 4) continue;
  if (inkRatio(await shoot(c, box)) > 0.02) painted++;
}
r.check('the orbit logos are actually painted', nodeBoxes.length > 0 && painted === nodeBoxes.length,
  painted + '/' + nodeBoxes.length + ' sampled nodes show ink', 'high');

const spins = await c.eval(`
  const el = document.getElementById('orbitRotor');
  if (!el) return { ok: false, why: 'no rotor' };
  const before = getComputedStyle(el).transform;
  await new Promise(res => setTimeout(res, 1600));
  const after = getComputedStyle(el).transform;
  return { ok: before !== after, before, after };`);
r.check('the orbit rotates on its own', spins.ok, JSON.stringify(spins));

/* ═══════════════ 7. THE ORCANE CREDIT ═══════════════ */
r.group('Footer credit');

const credit = await $(`(() => {
  const link = [...document.querySelectorAll('a')]
    .find(a => /orcane/i.test(a.textContent) || /wa\\.me/.test(a.href));
  if (!link) return null;
  return { href: link.href, target: link.target, rel: link.rel, text: link.textContent.trim() };
})()`);
r.check('the Orcane credit links to the right WhatsApp number',
  credit && credit.href.includes('923265025286'), JSON.stringify(credit), 'high');
r.check('the credit opens safely in a new tab',
  credit && credit.target === '_blank' && /noopener/.test(credit.rel || ''),
  JSON.stringify(credit && { target: credit.target, rel: credit.rel }));

/* ═══════════════ 8. THE CONTACT FORM ═══════════════ */
r.group('Contact form');

const fields = await c.eval(`
  const form = document.getElementById('contactForm');
  if (!form) return null;
  return [...form.elements].filter(e => e.name).map(e => e.name);`);
r.check('the form asks for a phone number', fields && fields.includes('phone'),
  JSON.stringify(fields), 'high');
r.check('the form keeps its honeypot', fields && fields.includes('website'),
  'honeypot present: ' + (fields || []).includes('website'));

const honeypotHidden = await $(`(() => {
  const el = document.querySelector('#contactForm [name="website"]');
  if (!el) return null;
  const b = el.getBoundingClientRect();
  // Walk up: the field is hidden by its wrapping label, so the input's own
  // computed style says nothing about whether a person can see it.
  let offscreen = b.right < 0 || b.bottom < 0 || b.left > innerWidth;
  let faded = false;
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    const s = getComputedStyle(node);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) faded = true;
    const nb = node.getBoundingClientRect();
    if (nb.right < 0 || nb.bottom < 0 || nb.left > innerWidth) offscreen = true;
  }
  return { offscreen, faded, focusable: el.tabIndex >= 0 };
})()`);
r.check('the honeypot is invisible to people',
  honeypotHidden && (honeypotHidden.offscreen || honeypotHidden.faded),
  JSON.stringify(honeypotHidden));
r.check('the honeypot is skipped by keyboard tabbing',
  honeypotHidden && honeypotHidden.focusable === false, JSON.stringify(honeypotHidden));

const submitted = await c.eval(`
  const form = document.getElementById('contactForm');
  const set = (name, value) => {
    const el = form.elements[name];
    if (!el) return false;
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  set('name', 'Test Visitor ${stamp}');
  set('email', 'visitor.${stamp}@brand.test');
  set('phone', '+92 326 5025286');
  set('company', 'Test Brand ${stamp}');
  set('spend', '$25k-50k');
  set('message', 'Sent by the automated suite.');
  set('description', 'Sent by the automated suite.');

  let captured = null;
  const realFetch = window.fetch;
  window.fetch = async (url, init) => {
    const res = await realFetch(url, init);
    if (String(url).includes('/api/leads')) {
      const clone = res.clone();
      captured = { status: res.status, body: await clone.json().catch(() => null) };
    }
    return res;
  };

  form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 50 && !captured; i++) await new Promise(res => setTimeout(res, 200));
  window.fetch = realFetch;

  const note = document.getElementById('formNote');
  return { captured, note: note ? note.textContent.trim() : null };`);

r.check('submitting the form reaches the API',
  submitted.captured && submitted.captured.status === 200,
  JSON.stringify(submitted.captured), 'high');
r.check('the visitor is told it worked',
  !!submitted.note && submitted.note.length > 0, submitted.note);

// Hand the lead id to the portal suite so it can verify the other end.
if (submitted.captured?.body?.lead?.id) {
  console.log('LEAD_ID=' + submitted.captured.body.lead.id);
}
console.log('LEAD_EMAIL=visitor.' + stamp + '@brand.test');

/* ═══════════════ 9. THE BLOG ═══════════════ */
r.group('Blog');

await go(BASE + '/blog');
const blogIndex = await $(`(() => ({
  status: document.title,
  cards: document.querySelectorAll('article, .post-card, a[href^="/blog/"]').length,
  hasDraft: /draft/i.test(document.body.textContent),
}))()`);
r.check('the blog index lists posts', blogIndex.cards > 0, JSON.stringify(blogIndex), 'high');
r.check('drafts are not shown publicly', !blogIndex.hasDraft, 'draft text present: ' + blogIndex.hasDraft, 'high');

const firstPost = await $(`(() => {
  const a = document.querySelector('a[href^="/blog/"]');
  return a ? a.getAttribute('href') : null;
})()`);

if (firstPost) {
  await go(BASE + firstPost);
  const article = await $(`(() => {
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map(s => { try { return JSON.parse(s.textContent); } catch (e) { return null; } })
      .filter(Boolean);
    return {
      words: document.body.textContent.trim().split(/\\s+/).length,
      heading: !!document.querySelector('h1'),
      canonical: !!document.querySelector('link[rel="canonical"]'),
      og: !!document.querySelector('meta[property="og:title"]'),
      blogPosting: ld.some(o => o['@type'] === 'BlogPosting'),
    };
  })()`);
  r.check('an article renders its body', article.words > 80 && article.heading, JSON.stringify(article), 'high');
  r.check('an article carries its SEO metadata',
    article.canonical && article.og && article.blogPosting, JSON.stringify(article));
}

const seo = await c.eval(`
  const sitemap = await (await fetch('/sitemap.xml')).text();
  const robots = await (await fetch('/robots.txt')).text();
  return { sitemapHasBlog: sitemap.includes('/blog/'), sitemapUrls: (sitemap.match(/<loc>/g) || []).length,
           robotsHasSitemap: /sitemap/i.test(robots) };`);
r.check('the sitemap lists the blog', seo.sitemapHasBlog && seo.sitemapUrls > 1, JSON.stringify(seo));
r.check('robots.txt points at the sitemap', seo.robotsHasSitemap, JSON.stringify(seo));

/* ═══════════════ 10. QUIET CONSOLE ═══════════════ */
r.group('Runtime health');

r.check('no uncaught exceptions on any page', consoleErrors.length === 0,
  consoleErrors.slice(0, 3).join(' | ') || 'clean', 'high');
r.check('no failed network requests', failedRequests.length === 0,
  failedRequests.slice(0, 3).join(' | ') || 'clean', 'high');

const failures = r.report();
proc.kill();
process.exit(failures ? 1 : 0);
