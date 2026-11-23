/* NIR-Sim touch / phone layer: touch pad (hold-to-push/pull, drag torque dial, device chips, big action buttons),
   pinch-zoom on the fluoro image, adaptive quality, and PWA (service worker) registration. Desktop keeps working:
   the touch pad is only shown by CSS on narrow screens or coarse (touch) pointers. */
(function (NIR) {
  'use strict';
  const $ = id => document.getElementById(id);
  const t = (k, p) => NIR.i18n.t(k, p);
  const A = NIR.app, sim = A.sim, R = A.renderer;
  const mq = window.matchMedia ? window.matchMedia('(pointer: coarse)') : { matches: false };
  NIR.isTouch = !!mq.matches || /[?&]touch=1/.test(location.search);
  document.documentElement.classList.toggle('touch', NIR.isTouch);
  if (NIR.isTouch) { const ic = $('insetChk'); if (ic && window.innerWidth < 500) ic.checked = false; } // small screens: close-up off by default

  const DEVS = ['guide', 'diag', 'inter', 'micro', 'wire', 'mwire', 'sr'];
  let focusDev = null; // chip that was tapped last (target of the Insert/Remove button)

  // ---------- device chips ----------
  function buildChips() {
    const box = $('devChips'); box.innerHTML = '';
    DEVS.forEach((id, i) => {
      const b = document.createElement('button');
      b.className = 'chip chip-' + id; b.id = 'chip_' + id; b.dataset.dev = id;
      b.innerHTML = `<span class="n">${i + 1}</span><span class="l"></span>`;
      b.addEventListener('click', () => {
        focusDev = id;
        if (sim.devices[id].inserted) sim.setActive(id);
        A.renderDevices(); refresh();
      });
      box.appendChild(b);
    });
  }
  function refresh() {
    DEVS.forEach(id => {
      const b = $('chip_' + id); if (!b) return;
      const d = sim.devices[id];
      b.querySelector('.l').textContent = t('chip_' + id);
      b.classList.toggle('in', d.inserted);
      b.classList.toggle('active', d.inserted && sim.active === id);
      b.classList.toggle('focus', focusDev === id);
    });
    const fid = focusDev || sim.active;
    const fd = sim.devices[fid];
    const io = $('tpIO'); io.dataset.dev = fid;
    io.textContent = (fd && fd.inserted ? t('remove') : t('insert')) + ': ' + t('dev_' + fid + '_s');
    io.classList.toggle('warnbtn', !!(fd && fd.inserted));
    $('tpTriax').disabled = $('triaxBtn').disabled;
    $('tpPush').textContent = '▲ ' + t('tp_push'); $('tpPull').textContent = '▼ ' + t('tp_pull');
    $('tpFast').textContent = t('tp_fast') + (fastOn ? ' ●' : ''); $('tpFast').classList.toggle('on', fastOn);
    $('tpAsp').classList.toggle('on', sim.aspiration);
    $('tpAsp').textContent = t('tp_asp') + ': ' + (sim.aspiration ? t('on') : t('off'));
    $('tpRm').classList.toggle('on', sim.roadmapOn);
    $('tpRet').disabled = !sim.devices.sr.deployed;
    $('tpView').textContent = t('view') + ': ' + t('view_' + R.view);
    $('tpBi').textContent = R.biplane ? t('single') : t('tp_biplane'); $('tpBi').classList.toggle('on', R.biplane);
    $('tpPlane').disabled = !R.biToggle; $('tpPlane').textContent = t('tp_plane') + ' ' + (R.biShow === 'lat' ? t('plane_b') : t('plane_a'));
    const aim = sim.aimPreview(); $('tpAim').textContent = A.aimText(aim);
    $('tpAim').className = aim && aim.vessel && aim.vessel !== 'aorta' && aim.good ? 'good' : '';
    const act = sim.devices[sim.active];
    $('tpLoc').textContent = act && act.inserted ? '· ' + t('dev_' + sim.active + '_s') + ' @ ' + A.segLabel(sim.locate(act.s).seg.id) : '';
    drawDial();
  }

  // ---------- buttons ----------
  let fastOn = false;
  const setFast = v => { fastOn = v; sim.input.fast = v; const c = $('fastChk'); if (c) c.checked = v; refresh(); };
  $('tpFast').addEventListener('click', () => setFast(!fastOn));
  $('fastChk').addEventListener('change', () => { fastOn = $('fastChk').checked; refresh(); });
  A.hold('tpPush', () => { sim.input.fast = fastOn; sim.input.adv = 1; }, () => { if (sim.input.adv === 1) sim.input.adv = 0; });
  A.hold('tpPull', () => { sim.input.fast = fastOn; sim.input.adv = -1; }, () => { if (sim.input.adv === -1) sim.input.adv = 0; });
  A.hold('tpRotL', () => { sim.input.rot = -1; }, () => { if (sim.input.rot === -1) sim.input.rot = 0; });
  A.hold('tpRotR', () => { sim.input.rot = 1; }, () => { if (sim.input.rot === 1) sim.input.rot = 0; });
  A.hold('tpPedal', () => { sim.pedal = true; }, () => { sim.pedal = false; });
  A.hold('tpUns', () => { sim.input.unsheath = 1; }, () => { sim.input.unsheath = 0; });
  A.hold('tpFluff', () => { sim.input.fluff = 1; }, () => { sim.input.fluff = 0; });
  $('tpIO').addEventListener('click', () => {
    const id = $('tpIO').dataset.dev; if (!id) return; const d = sim.devices[id];
    if (d.inserted) sim.remove(id); else { if (sim.insert(id)) sim.setActive(id); }
    focusDev = id; A.renderDevices(); refresh();
  });
  $('tpTriax').addEventListener('click', () => { sim.loadTriaxial(); focusDev = sim.active; A.renderDevices(); refresh(); });
  $('tpInj').addEventListener('click', () => sim.inject());
  $('tpRm').addEventListener('click', () => { sim.toggleRoadmap(); A.renderButtons(); refresh(); });
  $('tpAsp').addEventListener('click', () => { sim.setAspiration(!sim.aspiration); A.renderButtons(); refresh(); });
  $('tpRet').addEventListener('click', () => sim.retrieveSR());
  $('tpW30').addEventListener('click', () => sim.wait(30));
  $('tpView').addEventListener('click', () => { const o = ['ap', 'lao', 'lat']; R.setView(o[(o.indexOf(R.view) + 1) % 3]); A.renderButtons(); refresh(); });
  $('tpBi').addEventListener('click', () => { R.setBiplane(!R.biplane); A.renderButtons(); refresh(); });
  $('tpPlane').addEventListener('click', () => { R.biShow = R.biShow === 'lat' ? 'ap' : 'lat'; refresh(); });
  $('tpZoom').addEventListener('click', () => { R.zoomMul = 1; });
  const setMore = v => { document.body.classList.toggle('more', v); if (v) A.renderDevices(); };
  $('tpMore').addEventListener('click', () => setMore(!document.body.classList.contains('more')));
  $('moreClose').addEventListener('click', () => setMore(false));

  // ---------- torque dial: drag around it to rotate the active wire/catheter ----------
  const dial = $('tpDial');
  function drawDial() {
    const g = dial.getContext('2d'), w = sim.torqueTarget(), W = dial.width, c = W / 2, r = W / 2 - 8;
    g.clearRect(0, 0, W, W);
    g.fillStyle = '#0b0e10'; g.beginPath(); g.arc(c, c, r + 4, 0, 7); g.fill();
    g.strokeStyle = '#3c4a57'; g.lineWidth = 3; g.beginPath(); g.arc(c, c, r, 0, 7); g.stroke();
    for (let q = 0; q < 360; q += 30) { const a = (q - 90) * Math.PI / 180; g.beginPath(); g.moveTo(c + Math.cos(a) * (r - 6), c + Math.sin(a) * (r - 6)); g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); g.stroke(); }
    if (!w.inserted) return;
    const a = (w.torque - 90) * Math.PI / 180;
    g.strokeStyle = '#8fd0ff'; g.lineWidth = 5; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * (r - 10), c + Math.sin(a) * (r - 10)); g.stroke();
    g.fillStyle = '#8fd0ff'; g.beginPath(); g.arc(c + Math.cos(a) * (r - 10), c + Math.sin(a) * (r - 10), 7, 0, 7); g.fill();
    g.fillStyle = '#dde3e8'; g.font = 'bold 15px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(Math.round(w.torque) + '°', c, c + r * 0.45);
  }
  let dragA = null;
  const angAt = e => { const b = dial.getBoundingClientRect(); return Math.atan2(e.clientY - (b.top + b.height / 2), e.clientX - (b.left + b.width / 2)) * 180 / Math.PI; };
  dial.addEventListener('pointerdown', e => { e.preventDefault(); try { dial.setPointerCapture(e.pointerId); } catch (_) {} dragA = angAt(e); });
  dial.addEventListener('pointermove', e => {
    if (dragA == null) return; e.preventDefault();
    const a = angAt(e); let d = a - dragA; if (d > 180) d -= 360; if (d < -180) d += 360;
    dragA = a; if (Math.abs(d) > 0.01) sim.rotate(d); drawDial();
  });
  const endDrag = () => { dragA = null; };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => dial.addEventListener(ev, endDrag));

  // ---------- pinch-zoom on the fluoro image (two fingers); page itself never zooms ----------
  const cv = $('fluoro'), pts = new Map(); let pinch0 = null;
  const dist = () => { const p = [...pts.values()]; return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); };
  cv.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { cv.setPointerCapture(e.pointerId); } catch (_) {} if (pts.size === 2) pinch0 = { d: dist(), z: R.zoomMul }; });
  cv.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch0) { e.preventDefault(); R.zoomMul = Math.max(0.25, Math.min(4, pinch0.z * dist() / Math.max(10, pinch0.d))); }
  });
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = null; };
  ['pointerup', 'pointercancel'].forEach(ev => cv.addEventListener(ev, up));
  // iOS Safari: block the page-level pinch / double-tap zoom gestures on the app surface
  ['gesturestart', 'gesturechange'].forEach(ev => document.addEventListener(ev, e => { if (e.target.closest && e.target.closest('.monitor, .touchpad')) e.preventDefault(); }, { passive: false }));
  document.addEventListener('touchmove', e => { if (e.target.closest && e.target.closest('.monitor, .touchpad .hold, #tpDial')) e.preventDefault(); }, { passive: false });

  // ---------- adaptive quality: keep ≥30 fps on mid-range phones ----------
  let lowT = 0, hiT = 0;
  A.onFrame = dt => {
    const fps = A.fps || 60;
    if (!R.lowQuality && fps < 32) { lowT += dt; if (lowT > 2) { R.lowQuality = true; A.inset.lowQuality = true; lowT = 0; } } else lowT = 0;
    if (R.lowQuality && fps > 55) { hiT += dt; if (hiT > 8 && !NIR.isTouch) { R.lowQuality = false; A.inset.lowQuality = false; hiT = 0; } } else hiT = 0;
  };
  if (NIR.isTouch && Math.min(screen.width, screen.height) < 500) { /* phones start lean */ A.inset.lowQuality = true; }

  A.onTick = refresh;
  A.onLang = () => { if ($('devChips')) refresh(); };
  buildChips(); refresh();

  // ---------- PWA: offline after first load ----------
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').then(r => { NIR.app.sw = r; }).catch(() => {}); });
  }
})(window.NIR = window.NIR || {});
