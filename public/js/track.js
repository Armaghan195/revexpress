/**
 * First-party analytics for Revenue Express.
 *
 * Anonymous by design: the visitor id is a random value in localStorage, there
 * is no cross-site identifier and nothing personal is collected, which is why
 * no cookie banner is needed. Roughly 2 KB, no dependencies.
 */
(function () {
  'use strict';

  var ENDPOINT = '/api/track';
  var SESSION_KEY = 'rx_sid';
  var VISITOR_KEY = 'rx_vid';
  var SESSION_MINUTES = 30;

  function rand() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function store(kind, key) {
    try {
      return kind === 'local' ? window.localStorage : window.sessionStorage;
    } catch (e) {
      return null; // private mode, or storage blocked
    }
  }

  // A visitor persists across visits; a session expires after 30 idle minutes,
  // which is the convention every analytics tool uses.
  function visitorId() {
    var ls = store('local');
    if (!ls) return 'anon_' + rand();
    var id = ls.getItem(VISITOR_KEY);
    if (!id) { id = 'v_' + rand(); try { ls.setItem(VISITOR_KEY, id); } catch (e) {} }
    return id;
  }

  function sessionId() {
    var ss = store('session');
    var now = Date.now();
    if (!ss) return 's_' + rand();
    try {
      var raw = ss.getItem(SESSION_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (now - parsed.t < SESSION_MINUTES * 60000) {
          parsed.t = now;
          ss.setItem(SESSION_KEY, JSON.stringify(parsed));
          return parsed.id;
        }
      }
      var fresh = { id: 's_' + rand(), t: now };
      ss.setItem(SESSION_KEY, JSON.stringify(fresh));
      return fresh.id;
    } catch (e) {
      return 's_' + rand();
    }
  }

  function deviceKind() {
    var w = window.innerWidth;
    var touch = matchMedia('(pointer: coarse)').matches;
    if (touch && w < 768) return 'mobile';
    if (touch && w < 1200) return 'tablet';
    return 'desktop';
  }

  var SID = sessionId();
  var VID = visitorId();
  window.__rxSession = SID;

  var started = Date.now();
  var maxScroll = 0;
  var engagedSent = false;

  function send(type, extra) {
    var payload = {
      sessionId: SID,
      visitorId: VID,
      type: type,
      path: location.pathname || '/',
      referrer: document.referrer || null,
      device: deviceKind(),
      scroll: maxScroll,
      durationMs: Date.now() - started
    };
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k];
    var body = JSON.stringify(payload);

    // sendBeacon survives the page being closed, which is exactly when the
    // final duration and scroll numbers are worth having.
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
        return;
      }
    } catch (e) {}
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  window.rxTrack = function (type, extra) { send(type, extra || {}); };

  send('pageview', {});

  // Scroll depth, sampled on a rAF so it costs nothing while scrolling.
  var ticking = false;
  addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var doc = document.documentElement;
      var scrollable = doc.scrollHeight - innerHeight;
      var pct = scrollable > 0 ? Math.round((scrollY / scrollable) * 100) : 100;
      if (pct > maxScroll) maxScroll = Math.min(100, pct);
      if (!engagedSent && maxScroll >= 50) { engagedSent = true; send('engaged', {}); }
    });
  }, { passive: true });

  // The dashboard's other engagement threshold: fifteen seconds on the page.
  setTimeout(function () {
    if (!engagedSent) { engagedSent = true; send('engaged', {}); }
  }, 15000);

  // Any call-to-action click. data-cta wins; otherwise buttons and anchors
  // that look like CTAs on this site.
  addEventListener('click', function (ev) {
    var el = ev.target && ev.target.closest
      ? ev.target.closest('[data-cta], .btn, .nav-cta, .built-by')
      : null;
    if (!el) return;
    var label = el.getAttribute('data-cta') || (el.textContent || '').trim().slice(0, 60);
    send('cta_click', { label: label });
  }, { passive: true, capture: true });

  /*
   * Section tracking.
   *
   * The marketing site is a single page with anchor sections, so "which page
   * did they view" says almost nothing. What matters is how far down the story
   * they actually got: did they reach Pricing, or bounce at the Problem?
   * Reported once per section, the first time it is properly on screen.
   */
  var seenSections = {};
  if (window.IntersectionObserver) {
    var sections = document.querySelectorAll('section[id]');
    if (sections.length) {
      var observer = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          var id = entry.target.id;
          if (!entry.isIntersecting || seenSections[id]) continue;
          seenSections[id] = true;
          send('section_view', { label: id });
        }
      }, { threshold: 0.4 });
      for (var s = 0; s < sections.length; s++) observer.observe(sections[s]);
    }
  }

  // Final numbers when the visit ends.
  addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') send('heartbeat', {});
  });
  addEventListener('pagehide', function () { send('heartbeat', {}); });
})();
