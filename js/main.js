(() => {
  'use strict';

  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ============ RAF-BATCHED SCROLL DISPATCH ============
     Every scroll-driven feature subscribes here instead of adding its own
     listener, so the whole page does one layout read + write per frame. */
  /* ============ LANDING POSITION ON LOAD / RELOAD ============
     Chrome restores the previous scroll offset on refresh, which dropped the
     page into the middle of a section. Take the landing over instead.

     A #link is corrected toward its target until the position actually holds,
     rather than being set once. Firing once -- on load, after two frames, or
     after document.fonts.ready -- all raced the webfont swap and Chrome's own
     fragment pass, and landed anywhere from 13 to 180px off, or occasionally
     not at all. Converging is immune to whichever finishes last. */
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  const NAV_GAP = 80;  // matches section[id]{scroll-margin-top} in the stylesheet

  function targetTop() {
    const id = location.hash;
    const el = id.length > 1 ? document.querySelector(id) : null;
    if (!el) return 0;
    return Math.max(0, el.getBoundingClientRect().top + window.scrollY - NAV_GAP);
  }

  function land() {
    const want = targetTop();
    // 'instant', not 'auto': per CSSOM, 'auto' defers to the CSS scroll-behavior
    // property, which is smooth on this page. Using it made every correction
    // animate, and each new one interrupted the last, so the landing crept
    // toward the target instead of arriving. 'instant' is the real jump.
    if (Math.abs(window.scrollY - want) > 1) window.scrollTo({ top: want, behavior: 'instant' });
  }

  land();
  if (location.hash.length > 1) {
    // Converge only for a #link. Running this without one would pin the page
    // at the top for as long as it ran, overriding any scroll that is not a
    // wheel, touch or key -- a smooth-scrolling nav click, for instance.
    let released = false;
    const release = () => { released = true; };
    window.addEventListener('wheel', release, { passive: true, once: true });
    window.addEventListener('touchstart', release, { passive: true, once: true });
    window.addEventListener('keydown', release, { once: true });

    let holds = 0;
    const converge = setInterval(() => {
      if (released) { clearInterval(converge); return; }
      holds = Math.abs(window.scrollY - targetTop()) <= 1 ? holds + 1 : 0;
      if (holds >= 6) { clearInterval(converge); return; }  // steady for ~600ms
      land();
    }, 100);
    setTimeout(() => clearInterval(converge), 4000);
  } else {
    window.addEventListener('load', land);
  }

  const scrollTasks = [];
  let scrollTicking = false;
  function onScrollFrame(fn) { scrollTasks.push(fn); fn(); }
  window.addEventListener('scroll', () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      scrollTicking = false;
      for (const task of scrollTasks) task();
    });
  }, { passive: true });

  /* ============ YEAR ============ */
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ============ CUSTOM CURSOR ============ */
  if (!isTouch) {
    const dot = document.getElementById('cursorDot');
    const ring = document.getElementById('cursorRing');
    let mx = window.innerWidth / 2, my = window.innerHeight / 2;
    let rx = mx, ry = my;

    window.addEventListener('mousemove', (e) => {
      mx = e.clientX; my = e.clientY;
      dot.style.left = mx + 'px';
      dot.style.top = my + 'px';
    });

    function loop() {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      ring.style.left = rx + 'px';
      ring.style.top = ry + 'px';
      requestAnimationFrame(loop);
    }
    loop();

    const hoverables = document.querySelectorAll('a, button, .tilt-card, .avatar-card, input, select, textarea, .clients-track span');
    hoverables.forEach(el => {
      el.addEventListener('mouseenter', () => ring.classList.add('is-active'));
      el.addEventListener('mouseleave', () => ring.classList.remove('is-active'));
    });

    document.addEventListener('mousedown', () => ring.style.transform = 'translate(-50%,-50%) scale(0.8)');
    document.addEventListener('mouseup', () => ring.style.transform = 'translate(-50%,-50%) scale(1)');
  }

  /* ============ CURSOR SPOTLIGHT ============ */
  if (!isTouch) {
    const spotlight = document.getElementById('spotlight');
    let sx = 0, sy = 0;
    window.addEventListener('mousemove', (e) => {
      sx = e.clientX; sy = e.clientY;
      spotlight.style.transform = `translate(${sx}px, ${sy}px) translate(-50%,-50%)`;
      spotlight.classList.add('is-visible');
    });
    document.addEventListener('mouseleave', () => spotlight.classList.remove('is-visible'));
  }

  /* ============ MAGNETIC BUTTONS ============ */
  if (!isTouch) {
    document.querySelectorAll('.magnetic').forEach(btn => {
      btn.addEventListener('mousemove', (e) => {
        const r = btn.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2;
        const y = e.clientY - r.top - r.height / 2;
        btn.style.transform = `translate(${x * 0.22}px, ${y * 0.35}px)`;
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'translate(0,0)';
      });
    });
  }

  /* ============ NAV SCROLL STATE + PROGRESS ============ */
  const nav = document.getElementById('nav');
  const progress = document.getElementById('scrollProgress');
  function onScroll() {
    const y = window.scrollY;
    nav.classList.toggle('scrolled', y > 40);
    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    progress.style.width = (max > 0 ? (y / max) * 100 : 0) + '%';
  }
  onScrollFrame(onScroll);

  /* ============ MOBILE MENU ============ */
  const burger = document.getElementById('navBurger');
  const mobileMenu = document.getElementById('mobileMenu');
  if (burger) {
    burger.addEventListener('click', () => {
      mobileMenu.classList.toggle('open');
      burger.classList.toggle('open');
    });
    mobileMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => mobileMenu.classList.remove('open')));
  }

  /* ============ AVATAR CARDS: TAP TO FLIP ON TOUCH ============ */
  const avatarCards = document.querySelectorAll('.avatar-card');
  if (avatarCards.length) {
    avatarCards.forEach(card => {
      // Pointer type is checked per event rather than once at load: hybrids can
      // switch between trackpad and touchscreen mid-session.
      card.addEventListener('pointerup', (e) => {
        if (e.pointerType === 'mouse') return;
        const open = card.classList.contains('is-flipped');
        avatarCards.forEach(c => c.classList.remove('is-flipped'));
        card.classList.toggle('is-flipped', !open);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        card.classList.toggle('is-flipped');
      });
    });
  }

  /* ============ ROTATING HERO WORD ============ */
  const rotatingWord = document.getElementById('rotatingWord');
  if (rotatingWord) {
    const words = ['creator army', 'AI creators', '10K+ creators', 'winning creative'];
    let wi = 0;
    setInterval(() => {
      rotatingWord.classList.add('swap-out');
      setTimeout(() => {
        wi = (wi + 1) % words.length;
        rotatingWord.textContent = words[wi];
        rotatingWord.classList.remove('swap-out');
        rotatingWord.classList.add('swap-in');
        setTimeout(() => rotatingWord.classList.remove('swap-in'), 450);
      }, 320);
    }, 2800);
  }

  /* ============ SPLIT WORD REVEAL ============ */
  function wrapWords(node) {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const words = child.textContent.split(/(\s+)/).filter(w => w.length);
        const frag = document.createDocumentFragment();
        words.forEach((w) => {
          if (/^\s+$/.test(w)) {
            frag.appendChild(document.createTextNode(w));
          } else {
            const span = document.createElement('span');
            span.className = 'sw-word';
            span.textContent = w;
            frag.appendChild(span);
          }
        });
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        wrapWords(child);
      }
    });
  }
  const splitEls = document.querySelectorAll('.split-words');
  splitEls.forEach(el => wrapWords(el));

  const splitObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      el.querySelectorAll('.sw-word').forEach((w, i) => {
        w.style.transitionDelay = (i * 0.045) + 's';
      });
      el.classList.add('sw-in');
      splitObserver.unobserve(el);
    });
  }, { threshold: 0.4 });
  splitEls.forEach(el => splitObserver.observe(el));

  /* ============ SCROLL REVEAL ============ */
  const revealEls = document.querySelectorAll('[data-reveal]');
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });
  revealEls.forEach((el, i) => {
    el.style.transitionDelay = (i % 4) * 0.08 + 's';
    revealObserver.observe(el);
  });

  /* ============ COUNT UP NUMBERS ============ */
  function formatNum(val, decimals) {
    return decimals ? val.toFixed(decimals) : Math.round(val).toLocaleString();
  }
  const countEls = document.querySelectorAll('[data-count]');
  const countObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = parseFloat(el.dataset.count);
      const decimals = parseInt(el.dataset.decimals || '0', 10);
      const prefix = el.dataset.prefix || '';
      const suffix = el.dataset.suffix || '';
      const duration = 1600;
      const start = performance.now();
      function tick(now) {
        const p = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = prefix + formatNum(target * eased, decimals) + suffix;
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
      countObserver.unobserve(el);
    });
  }, { threshold: 0.5 });
  countEls.forEach(el => countObserver.observe(el));

  /* ============ BAR CHART ANIMATIONS ============ */
  const barEls = document.querySelectorAll('.bar-fill, .mg-bar');
  const barObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = el.dataset.target;
      requestAnimationFrame(() => { el.style.height ? (el.style.height = target + '%') : null; el.style.width = target + '%'; });
      if (el.classList.contains('mg-bar')) el.style.height = target + '%';
      barObserver.unobserve(el);
    });
  }, { threshold: 0.4 });
  barEls.forEach(el => barObserver.observe(el));

  /* ============ HERO PARTICLE CANVAS ============ */
  const canvas = document.getElementById('fx');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let w, h, particles = [];
    const mouse = { x: -9999, y: -9999 };
    const heroSection = document.getElementById('hero');

    function resize() {
      w = canvas.width = canvas.offsetWidth;
      h = canvas.height = canvas.offsetHeight;
      const count = Math.min(70, Math.floor((w * h) / 22000));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: Math.random() * 1.6 + 0.6,
      }));
    }
    window.addEventListener('resize', resize);
    resize();

    heroSection.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    });
    heroSection.addEventListener('mouseleave', () => { mouse.x = -9999; mouse.y = -9999; });

    function draw() {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;

        const dx = mouse.x - p.x, dy = mouse.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 140) {
          p.x -= dx * 0.006;
          p.y -= dy * 0.006;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(180,200,255,0.55)';
        ctx.fill();

        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const ddx = p.x - q.x, ddy = p.y - q.y;
          const d = Math.sqrt(ddx * ddx + ddy * ddy);
          if (d < 130) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = `rgba(120,150,255,${(1 - d / 130) * 0.18})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(draw);
    }
    draw();
  }

  /* ============ SCROLL PARALLAX ============ */
  const parallaxEls = Array.from(document.querySelectorAll('[data-parallax]'));
  if (parallaxEls.length) {
    function updateParallax() {
      const y = window.scrollY;
      parallaxEls.forEach(el => {
        const factor = parseFloat(el.dataset.parallax) || 0.1;
        el.style.transform = `translate3d(0, ${y * factor}px, 0)`;
      });
    }
    if (!reduceMotion) onScrollFrame(updateParallax);
  }

  /* ============ GENERIC TILT HOVER (cards) ============ */
  if (!isTouch) {
    const tiltTargets = document.querySelectorAll('.stat-card, .price-card, .problem-card, .dist-step, .tl-card');
    tiltTargets.forEach(card => {
      card.classList.add('tilt-hover');
      card.addEventListener('mousemove', (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = `perspective(700px) rotateX(${(-py * 8).toFixed(2)}deg) rotateY(${(px * 8).toFixed(2)}deg) translateY(-4px)`;
      });
      card.addEventListener('mouseleave', () => { card.style.transform = ''; });
    });
  }

  /* ============ TILT PHONE STACK ============ */
  const heroVisual = document.getElementById('heroVisual');
  if (heroVisual && !isTouch) {
    const cards = heroVisual.querySelectorAll('.tilt-card');
    heroVisual.addEventListener('mousemove', (e) => {
      const r = heroVisual.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      cards.forEach(card => {
        const depth = parseFloat(card.dataset.depth) || 20;
        // Drive only --tilt. Writing style.transform here used to replace the
        // whole transform, discarding the card's --pos, so the three handsets
        // collapsed into a pile on top of each other the moment the pointer
        // entered the hero. The stylesheet composes --pos and --tilt instead.
        card.style.setProperty('--tilt',
          `translate(${px * depth}px, ${py * depth}px) ` +
          `rotateX(${-py * depth * 0.6}deg) rotateY(${px * depth * 0.6}deg)`);
      });
    });
    heroVisual.addEventListener('mouseleave', () => {
      cards.forEach(card => { card.style.removeProperty('--tilt'); });
    });
  }

  /* ============ FRAMEWORK SCROLLYTELLING ============ */
  const fwSteps = document.querySelectorAll('.fw-step');
  const fwProgress = document.getElementById('fwProgress');
  const fwRail = document.querySelector('.fw-rail');
  if (fwSteps.length && fwRail) {
    function updateFramework() {
      const railRect = fwRail.getBoundingClientRect();
      const viewportCenter = window.innerHeight * 0.5;
      let activeIndex = 0;
      fwSteps.forEach((step, i) => {
        const r = step.getBoundingClientRect();
        if (r.top < viewportCenter) activeIndex = i;
        step.classList.toggle('active', r.top < viewportCenter && r.bottom > 0);
      });
      const total = railRect.height;
      const start = railRect.top;
      const scrolled = Math.min(Math.max(viewportCenter - start, 0), total);
      const pct = total > 0 ? (scrolled / total) * 100 : 0;
      fwProgress.style.height = pct + '%';
    }
    onScrollFrame(updateFramework);
    window.addEventListener('resize', updateFramework);
  }

  /* ============ ORBIT: IDLE AUTOROTATE + DRAG + SCROLL SCRUB ============ */
  const orbitRotor = document.getElementById('orbitRotor');
  if (orbitRotor) {
    const orbitSystem = orbitRotor.closest('.orbit-system');
    const nodes = Array.from(orbitRotor.querySelectorAll('.orbit-node')).map(n => ({
      dot: n.querySelector('.node-dot'),
      label: n.querySelector('em')
    }));
    orbitRotor.style.animation = 'none';

    const IDLE_SPEED = 6;      // deg per second when nothing else is happening
    const FRICTION = 3.2;      // how fast a throw decays back to idle (per second)
    const MAX_SPIN = 900;      // deg/s cap so a fast flick never blurs out

    let angle = 0;
    let spin = IDLE_SPEED;     // current angular velocity, deg/s
    let dragging = false;
    let pointerId = null;
    let lastPointerAngle = 0;
    let lastMoveTime = 0;
    let lastScrollY = window.scrollY;
    let inView = true;
    let rendered = null;

    function pointerAngle(e) {
      const r = orbitSystem.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2),
                        e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
    }

    // Shortest signed distance between two angles, so crossing the ±180° seam
    // never produces the full-circle jump that made dragging feel broken.
    function shortestDelta(from, to) {
      return ((to - from + 540) % 360) - 180;
    }

    function render() {
      if (rendered === angle) return;
      rendered = angle;
      orbitRotor.style.transform = `rotate(${angle}deg)`;
      const counter = `rotate(${-angle}deg)`;
      for (const n of nodes) {
        if (n.dot) n.dot.style.transform = counter;
        if (n.label) n.label.style.transform = `translateX(-50%) ${counter}`;
      }
    }

    let lastFrame = 0;
    function frame(now) {
      // Delta-time driven so the speed is identical on 60Hz and 144Hz displays.
      const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
      lastFrame = now;

      if (!dragging && dt) {
        // Ease the current velocity back toward the idle drift instead of
        // stopping dead — that's what made it stall after a drag.
        const decay = 1 - Math.exp(-FRICTION * dt);
        spin += (IDLE_SPEED - spin) * decay;
        angle += spin * dt;
      }
      if (angle > 360 || angle < -360) angle %= 360;
      render();
      requestAnimationFrame(frame);
    }
    if (!reduceMotion) requestAnimationFrame(frame);
    else render();

    orbitSystem.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      dragging = true;
      pointerId = e.pointerId;
      lastPointerAngle = pointerAngle(e);
      lastMoveTime = e.timeStamp;
      spin = 0;
      orbitSystem.classList.add('dragging');
      orbitSystem.setPointerCapture(e.pointerId);
    });

    orbitSystem.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const current = pointerAngle(e);
      const delta = shortestDelta(lastPointerAngle, current);
      const dt = Math.max((e.timeStamp - lastMoveTime) / 1000, 0.001);
      lastPointerAngle = current;
      lastMoveTime = e.timeStamp;

      // 1:1 with the cursor — the node you grab stays under the pointer.
      angle += delta;
      spin = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, delta / dt));
      render();
    });

    function endDrag(e) {
      if (!dragging || (e && e.pointerId !== pointerId)) return;
      dragging = false;
      pointerId = null;
      lastFrame = 0; // don't bill the idle gap since the last frame to the decay
      orbitSystem.classList.remove('dragging');
      // Keep whatever spin the release carried; frame() decays it back to idle.
      if (Math.abs(spin) < 1) spin = IDLE_SPEED;
    }
    orbitSystem.addEventListener('pointerup', endDrag);
    orbitSystem.addEventListener('pointercancel', endDrag);
    orbitSystem.addEventListener('lostpointercapture', endDrag);

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; }, { threshold: 0 })
        .observe(orbitSystem);
    }

    // Scroll scrub: feed scroll into the velocity so it blends with the idle
    // drift instead of teleporting the ring a few degrees per scroll event.
    onScrollFrame(() => {
      const dy = window.scrollY - lastScrollY;
      lastScrollY = window.scrollY;
      if (reduceMotion || dragging || !inView) return;
      spin = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, spin + dy * 1.6));
    });
  }

  /* ============ DRAGGABLE RESULTS COMPARE SLIDER ============ */
  const rcHandle = document.getElementById('rcHandle');
  const rcOld = document.getElementById('rcOld');
  const rcNew = document.getElementById('rcNew');
  const resultsCompare = document.getElementById('resultsCompare');
  if (rcHandle && rcOld && rcNew && resultsCompare) {
    let dragging = false;
    function setPct(pct) {
      pct = Math.min(80, Math.max(20, pct));
      rcOld.style.flexBasis = pct + '%';
      rcNew.style.flexBasis = (100 - pct) + '%';
      rcHandle.setAttribute('aria-valuenow', Math.round(pct));
    }
    function pctFromClientX(clientX) {
      const r = resultsCompare.getBoundingClientRect();
      return ((clientX - r.left) / r.width) * 100;
    }
    rcHandle.addEventListener('pointerdown', (e) => {
      dragging = true;
      rcHandle.setPointerCapture(e.pointerId);
    });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      setPct(pctFromClientX(e.clientX));
    });
    window.addEventListener('pointerup', () => { dragging = false; });
    rcHandle.addEventListener('keydown', (e) => {
      const current = parseFloat(rcHandle.getAttribute('aria-valuenow')) || 50;
      if (e.key === 'ArrowLeft') setPct(current - 5);
      if (e.key === 'ArrowRight') setPct(current + 5);
    });
    // gentle auto demo nudge once in view, then hand control to user
    let demoed = false;
    const rcObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !demoed) {
          demoed = true;
          setTimeout(() => setPct(66), 500);
          setTimeout(() => setPct(50), 1400);
        }
      });
    }, { threshold: 0.5 });
    rcObserver.observe(resultsCompare);
  }

  /* ============ DRAGGABLE AD GALLERY (with momentum) ============ */
  const adTrack = document.getElementById('adGalleryTrack');
  if (adTrack) {
    // Only promise "drag to browse" when the track actually overflows; at wide
    // viewports all four creatives fit and there is nothing to drag.
    const dragHint = adTrack.parentElement.querySelector('.drag-hint');
    const syncHint = () => {
      if (dragHint) dragHint.classList.toggle('is-idle', adTrack.scrollWidth <= adTrack.clientWidth + 4);
    };
    syncHint();
    window.addEventListener('resize', syncHint);
    window.addEventListener('load', syncHint);

    let isDown = false, startX = 0, startScroll = 0, vel = 0, lastX = 0, lastT = 0;
    adTrack.addEventListener('pointerdown', (e) => {
      isDown = true;
      adTrack.classList.add('dragging');
      startX = e.clientX; startScroll = adTrack.scrollLeft;
      lastX = e.clientX; lastT = performance.now();
      vel = 0;
      adTrack.setPointerCapture(e.pointerId);
    });
    adTrack.addEventListener('pointermove', (e) => {
      if (!isDown) return;
      const dx = e.clientX - startX;
      adTrack.scrollLeft = startScroll - dx;
      const now = performance.now();
      const dt = now - lastT || 16;
      vel = (e.clientX - lastX) / dt;
      lastX = e.clientX; lastT = now;
    });
    function momentum() {
      if (Math.abs(vel) > 0.02) {
        adTrack.scrollLeft -= vel * 16;
        vel *= 0.94;
        requestAnimationFrame(momentum);
      }
    }
    function endDragGallery() {
      if (!isDown) return;
      isDown = false;
      adTrack.classList.remove('dragging');
      momentum();
    }
    adTrack.addEventListener('pointerup', endDragGallery);
    adTrack.addEventListener('pointerleave', endDragGallery);
  }

  /* ============ CONFETTI BURST ============ */
  function fireConfetti(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const r = canvas.getBoundingClientRect();
    canvas.width = r.width; canvas.height = r.height;
    const colors = ['#5b9dff', '#2f7df6', '#ff9d4d', '#f5811f', '#f6f8fd'];
    const pieces = Array.from({ length: 90 }, () => ({
      x: canvas.width / 2,
      y: canvas.height * 0.8,
      vx: (Math.random() - 0.5) * 9,
      vy: Math.random() * -8 - 3,
      size: Math.random() * 6 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      life: 1,
    }));
    function step() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      pieces.forEach(p => {
        p.vy += 0.22;
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        p.life -= 0.012;
        if (p.life > 0) {
          alive = true;
          ctx.save();
          ctx.globalAlpha = Math.max(p.life, 0);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          ctx.restore();
        }
      });
      if (alive) requestAnimationFrame(step);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    step();
  }

  /* ============ CONTACT FORM ============ */
  const form = document.getElementById('contactForm');
  const formNote = document.getElementById('formNote');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"] span');
      const original = btn.textContent;
      btn.textContent = 'Sending...';
      setTimeout(() => {
        btn.textContent = "You're in! We'll be in touch soon.";
        formNote.textContent = "Thanks — check your inbox shortly.";
        form.reset();
        fireConfetti(document.getElementById('confetti'));
        setTimeout(() => { btn.textContent = original; }, 3200);
      }, 900);
    });
  }

  /* ============ SMOOTH ANCHOR SCROLL OFFSET FOR FIXED NAV ============ */
  function navOffset() {
    const n = document.getElementById('nav');
    return (n ? n.getBoundingClientRect().height : 72) + 12;
  }
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id.length < 2) return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const y = target.getBoundingClientRect().top + window.scrollY - navOffset();
      window.scrollTo({ top: Math.max(0, y), behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  });

  /* ============ SCROLL SPY: HIGHLIGHT THE SECTION YOU'RE IN ============
     Sections without their own nav entry fold into the nav item they belong
     to, so the highlight never blanks out mid-page. */
  const SPY_GROUPS = [
    { id: 'engine',    covers: ['problem', 'engine'] },
    { id: 'framework', covers: ['framework', 'avatars', 'distribution'] },
    { id: 'results',   covers: ['results'] },
    { id: 'pricing',   covers: ['pricing', 'timeline'] },
    { id: 'contact',   covers: ['contact'] }
  ];
  const spyLinks = Array.from(document.querySelectorAll('.nav-links a[href^="#"], .mobile-menu a[href^="#"], .footer-links a[href^="#"]'));
  if (spyLinks.length) {
    // Flatten to [sectionEl, navId] in document order.
    const watched = [];
    for (const g of SPY_GROUPS) {
      for (const secId of g.covers) {
        const el = document.getElementById(secId);
        if (el) watched.push({ el, navId: g.id });
      }
    }
    watched.sort((a, b) => a.el.offsetTop - b.el.offsetTop);

    let currentId = null;
    function setActive(navId) {
      if (navId === currentId) return;
      currentId = navId;
      for (const link of spyLinks) {
        link.classList.toggle('active', link.getAttribute('href') === '#' + navId);
      }
    }

    function updateSpy() {
      const line = window.scrollY + navOffset() + window.innerHeight * 0.22;
      const doc = document.documentElement;

      // Bottom of the page always resolves to the last entry, since the final
      // section can be shorter than the trigger line.
      if (window.scrollY + doc.clientHeight >= doc.scrollHeight - 4) {
        setActive(watched[watched.length - 1].navId);
        return;
      }
      let active = null;
      for (const w of watched) {
        const top = w.el.getBoundingClientRect().top + window.scrollY;
        if (top <= line) active = w; else break;
      }
      setActive(active ? active.navId : null);
    }
    onScrollFrame(updateSpy);
    window.addEventListener('resize', updateSpy);
  }

})();
