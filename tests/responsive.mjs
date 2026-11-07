/**
 * The site across the screens people actually use.
 *
 * Chrome is the only engine available here, so this cannot prove WebKit
 * behaviour. What it can do — and what caught the real bugs — is check the
 * things that break per size rather than per engine: overflow, tap target size,
 * text that paints, and layout that does not collide. The iOS rows additionally
 * run with Safari's user agent and its viewport dimensions, which is what the
 * feature-detection branches in the page respond to.
 */
import { launch, Client, sleep, findChrome, reporter } from './cdp.mjs';
import { shoot, inkRatio, pageBox } from './pixels.mjs';

const BASE = process.env.RX_BASE || 'http://127.0.0.1:3100';
const r = reporter('RESPONSIVE');

const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/120.0.0.0 Mobile Safari/537.36';

const DEVICES = [
  { name: 'iPhone SE  (Safari)', width: 375, height: 667, dpr: 2, mobile: true, ua: SAFARI_IOS },
  { name: 'iPhone 14  (Safari)', width: 390, height: 844, dpr: 3, mobile: true, ua: SAFARI_IOS },
  { name: 'iPhone 14 Pro Max', width: 430, height: 932, dpr: 3, mobile: true, ua: SAFARI_IOS },
  { name: 'Pixel 8   (Chrome)', width: 412, height: 915, dpr: 2.6, mobile: true, ua: CHROME_ANDROID },
  { name: 'Galaxy S8  (narrow)', width: 360, height: 740, dpr: 3, mobile: true, ua: CHROME_ANDROID },
  { name: 'iPad', width: 820, height: 1180, dpr: 2, mobile: true, ua: SAFARI_IOS },
  { name: 'Laptop', width: 1280, height: 800, dpr: 1, mobile: false, ua: null },
  { name: 'Desktop', width: 1920, height: 1080, dpr: 1, mobile: false, ua: null },
];

const { proc, wsUrl } = await launch(findChrome(), 9396);
const c = await Client.connect(wsUrl);
await c.send('Page.enable');
await c.send('Runtime.enable');

const $ = expr => c.eval('return ' + expr + ';');

for (const device of DEVICES) {
  r.group(`${device.name}  ${device.width}x${device.height}`);

  await c.send('Emulation.setDeviceMetricsOverride', {
    width: device.width, height: device.height,
    deviceScaleFactor: device.dpr, mobile: device.mobile,
  });
  if (device.ua) await c.send('Emulation.setUserAgentOverride', { userAgent: device.ua });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: device.mobile });

  const loaded = new Promise(res => c.on('Page.loadEventFired', res));
  await c.send('Page.navigate', { url: BASE + '/' });
  await loaded;
  await sleep(1400);

  // 1. Nothing may push the page sideways.
  const overflow = await $(`(() => {
    const doc = document.documentElement;
    const guilty = [...document.querySelectorAll('body *')]
      .filter(el => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && (b.right > doc.clientWidth + 2 || b.left < -2)
          && getComputedStyle(el).position !== 'fixed';
      })
      .slice(0, 3)
      .map(el => (el.tagName + '.' + (el.className || '').toString().split(' ')[0]).slice(0, 50));
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, guilty };
  })()`);
  r.check('no sideways scroll', overflow.scrollWidth <= overflow.clientWidth + 1,
    `${overflow.scrollWidth} vs ${overflow.clientWidth}` +
    (overflow.guilty.length ? ' — ' + overflow.guilty.join(', ') : ''), 'high');

  // 2. The headline must be readable, and the rotating word must paint.
  const word = await pageBox(c, '.rotating-word');
  if (word && word.width > 4 && word.height > 4) {
    const ink = inkRatio(await shoot(c, word));
    r.check('the rotating word paints', ink > 0.02, 'ink ' + (ink * 100).toFixed(1) + '%', 'high');
  } else {
    r.check('the rotating word paints', false, 'no box: ' + JSON.stringify(word), 'high');
  }

  const heroText = await $(`(() => {
    const h1 = document.querySelector('#hero h1, .hero h1, h1');
    if (!h1) return null;
    const s = getComputedStyle(h1);
    const b = h1.getBoundingClientRect();
    return { fontSize: parseFloat(s.fontSize), width: b.width, viewport: window.innerWidth };
  })()`);
  r.check('the headline fits its viewport',
    heroText && heroText.width <= heroText.viewport + 1 && heroText.fontSize >= 20,
    JSON.stringify(heroText));

  // 3. Touch targets. Anything tappable under ~40px is a miss on a phone.
  if (device.mobile) {
    const small = await $(`(() => {
      const targets = [...document.querySelectorAll('a, button, [role="button"], input, select, textarea')];
      return targets
        .filter(el => {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) return false;
          const s = getComputedStyle(el);
          if (s.visibility === 'hidden' || s.opacity === '0' || s.pointerEvents === 'none') return false;
          if (b.right < 0 || b.left > innerWidth) return false;  // the honeypot lives off-screen
          return b.height < 44 || b.width < 44;
        })
        .slice(0, 5)
        .map(el => ({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 24),
          size: Math.round(el.getBoundingClientRect().width) + 'x'
              + Math.round(el.getBoundingClientRect().height),
        }));
    })()`);
    r.check('tap targets meet the 44px guideline', small.length === 0,
      small.length ? JSON.stringify(small) : 'all >= 44px');
  }

  // 4. The contact form has to be usable, not just present.
  const form = await $(`(() => {
    const el = document.getElementById('contactForm');
    if (!el) return null;
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    const visible = [...el.elements].filter(f => {
      const b = f.getBoundingClientRect();
      return f.name && b.width > 0 && b.height > 0;
    });
    return {
      fields: visible.length,
      names: visible.map(f => f.name),
      widest: Math.max(...visible.map(f => f.getBoundingClientRect().width)),
      viewport: window.innerWidth,
    };
  })()`);
  r.check('the contact form is usable at this size',
    form && form.fields >= 4 && form.widest <= form.viewport + 1,
    JSON.stringify(form), 'high');
  r.check('the phone field is offered at this size',
    form && form.names.includes('phone'), JSON.stringify(form && form.names));

  // 5. Navigation. On a phone the header links are hidden, so the burger menu is
  // the only way to reach Pricing or Contact — it has to actually work.
  const nav = await c.eval(`
    const burger = document.getElementById('navBurger');
    const menu = document.getElementById('mobileMenu');
    const inlineLinks = [...document.querySelectorAll('.nav-links a')]
      .filter(a => a.getBoundingClientRect().width > 0).length;
    const burgerShown = burger && getComputedStyle(burger).display !== 'none';

    if (!burgerShown) return { mode: 'inline', inlineLinks };

    // Wait for the slide to finish, rather than guessing a delay. Polling for a
    // stable position is not enough on its own: the transition does not always
    // start on the frame after the click, so two equal early samples look
    // "settled" while the sheet is still parked off-screen. Listening for
    // transitionend removes the guess; the timeout only covers the case where
    // the transition is disabled entirely.
    const settle = () => new Promise(res => {
      const done = () => { menu.removeEventListener('transitionend', done); clearTimeout(timer); res(); };
      const timer = setTimeout(done, 2500);
      menu.addEventListener('transitionend', done);
    });

    burger.click();
    await settle();
    const openState = {
      open: menu.classList.contains('open'),
      onScreen: menu.getBoundingClientRect().left < window.innerWidth - 10,
      links: [...menu.querySelectorAll('a')].filter(a => a.getBoundingClientRect().width > 0).length,
      announced: burger.getAttribute('aria-expanded'),
    };

    // Escape must get the visitor back out.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    return { mode: 'burger', inlineLinks, ...openState,
             closed: !menu.classList.contains('open'),
             announcedClosed: burger.getAttribute('aria-expanded') };`);

  if (nav.mode === 'inline') {
    r.check('the header links are reachable', nav.inlineLinks >= 4, JSON.stringify(nav), 'high');
  } else {
    r.check('the burger opens a menu with the section links',
      nav.open && nav.onScreen && nav.links >= 4, JSON.stringify(nav), 'high');
    r.check('the menu closes again on Escape', nav.closed, JSON.stringify(nav));
    r.check('the burger tells assistive tech whether the menu is open',
      nav.announced === 'true' && nav.announcedClosed === 'false',
      `open: ${nav.announced}, closed: ${nav.announcedClosed}`);
  }

  // 6. Sections must not collapse or overlap once the layout reflows.
  const sections = await $(`(() => {
    const ids = ['hero', 'engine', 'framework', 'avatars', 'distribution',
                 'results', 'pricing', 'contact'];
    const boxes = ids.map(id => {
      const el = document.getElementById(id);
      if (!el) return { id, missing: true };
      const b = el.getBoundingClientRect();
      return { id, top: b.top + scrollY, bottom: b.bottom + scrollY, height: b.height };
    });
    const collapsed = boxes.filter(b => !b.missing && b.height < 60).map(b => b.id);
    const overlapping = [];
    for (let i = 1; i < boxes.length; i++) {
      const prev = boxes[i - 1];
      const next = boxes[i];
      if (prev.missing || next.missing) continue;
      if (next.top < prev.bottom - 4) overlapping.push(prev.id + '/' + next.id);
    }
    return { collapsed, overlapping, missing: boxes.filter(b => b.missing).map(b => b.id) };
  })()`);
  r.check('no section collapses at this width', sections.collapsed.length === 0,
    sections.collapsed.join(', ') || 'none', 'high');
  r.check('sections stack without overlapping', sections.overlapping.length === 0,
    sections.overlapping.join(', ') || 'none', 'high');

  // 7. Images must be told not to outgrow their column.
  const images = await $(`(() => {
    const wide = [...document.images].filter(img => {
      const b = img.getBoundingClientRect();
      return b.width > window.innerWidth + 2;
    });
    return { total: document.images.length, overflowing: wide.length };
  })()`);
  r.check('no image overflows the screen', images.overflowing === 0, JSON.stringify(images), 'high');

  // 8. The portal has to work on a phone too — that is where leads get chased.
  const portalLoad = new Promise(res => c.on('Page.loadEventFired', res));
  await c.send('Page.navigate', { url: BASE + '/login' });
  await portalLoad;
  await sleep(600);
  const login = await $(`(() => {
    const doc = document.documentElement;
    const button = document.querySelector('form button');
    const b = button ? button.getBoundingClientRect() : null;
    return { fits: doc.scrollWidth <= doc.clientWidth + 1,
             button: b ? Math.round(b.width) + 'x' + Math.round(b.height) : null,
             tappable: !!b && b.height >= 32 };
  })()`);
  r.check('the sign-in screen fits and is tappable',
    login.fits && login.tappable, JSON.stringify(login), 'high');
}

const failures = r.report();
proc.kill();
process.exit(failures ? 1 : 0);
