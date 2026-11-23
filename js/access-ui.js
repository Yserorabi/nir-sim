/* NIR-Sim access phase UI: an overlay with a landmark fluoro / ultrasound / angiogram view and big controls.
   Keys: ←/→ aim, ↑/↓ move the marker or advance/withdraw the needle and wire, Enter/Space = confirm/next,
   I = femoral angiogram, R = re-puncture, B = Barbeau test, C = spasmolytic cocktail, H = heparin,
   + / − = sheath size, L = long/short sheath, Backspace = back to the needle, Esc = skip the access phase.
   Touch: the same actions are buttons in the overlay (arrows are hold-to-move). */
(function (NIR) {
  'use strict';
  const $ = id => document.getElementById(id);
  const t = (k, p) => NIR.i18n.t(k, p);
  let acc = null, onDone = null, raf = 0, last = 0;
  const inp = { x: 0, y: 0 };

  function build() {
    if ($('accessOv')) return;
    const ov = document.createElement('div'); ov.id = 'accessOv'; ov.className = 'access-ov hidden';
    ov.innerHTML = `<div class="acc-box">
      <div class="acc-head"><b id="accTitle"></b> <span id="accStepNo" class="acc-stepno"></span><button id="accSkip" class="acc-skip"></button></div>
      <p id="accInstr" class="acc-instr"></p>
      <div class="acc-view"><canvas id="accCanvas"></canvas></div>
      <div id="accStatus" class="acc-status"></div>
      <div class="acc-ctl">
        <div class="acc-pad"><button class="hold" id="accL">◀</button><button class="hold" id="accU">▲</button><button class="hold" id="accD">▼</button><button class="hold" id="accR">▶</button></div>
        <div class="acc-acts">
          <button id="accOk" class="acc-ok"></button>
          <button id="accBarbeau"></button><button id="accInject"></button><button id="accRepunct"></button>
          <button id="accBack"></button>
          <span id="accSheathBox" class="acc-sheath"><button id="accSm">−</button><b id="accSheathLbl"></b><button id="accSp">+</button><button id="accLong"></button></span>
          <button id="accCocktail"></button><button id="accHeparin"></button>
        </div>
      </div>
      <div id="accLog" class="acc-log"></div>
    </div>`;
    document.body.appendChild(ov);
    const hold = (id, on, off) => { const b = $(id);
      b.addEventListener('pointerdown', e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (_) {} b.classList.add('pressed'); on(); });
      ['pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave'].forEach(ev => b.addEventListener(ev, () => { b.classList.remove('pressed'); off(); }));
      b.addEventListener('contextmenu', e => e.preventDefault()); };
    const vert = () => (acc && acc.step === 'site' ? -1 : 1);
    hold('accU', () => { inp.y = vert(); }, () => { inp.y = 0; });
    hold('accD', () => { inp.y = -vert(); }, () => { inp.y = 0; });
    hold('accL', () => { inp.x = -1; }, () => { inp.x = 0; });
    hold('accR', () => { inp.x = 1; }, () => { inp.x = 0; });
    const A = (id, a) => { $(id).onclick = () => { act(a); }; };
    A('accOk', 'confirm'); A('accBarbeau', 'barbeau'); A('accInject', 'inject'); A('accRepunct', 'repuncture'); A('accBack', 'back');
    A('accSm', 'sheath-'); A('accSp', 'sheath+'); A('accLong', 'long'); A('accCocktail', 'cocktail'); A('accHeparin', 'heparin');
    $('accSkip').onclick = () => finish(null);
    ov.addEventListener('touchmove', e => { if (e.target.closest('.acc-view, .acc-pad')) e.preventDefault(); }, { passive: false });
    // keyboard (capture phase: the case keys are not triggered while the access overlay is open)
    window.addEventListener('keydown', e => {
      if (!acc) return;
      const k = e.key.toLowerCase();
      const map = { arrowup: ['y', vert()], w: ['y', vert()], arrowdown: ['y', -vert()], s: ['y', -vert()], arrowleft: ['x', -1], a: ['x', -1], arrowright: ['x', 1], d: ['x', 1] };
      if (map[k]) inp[map[k][0]] = map[k][1];
      else if (!e.repeat) {
        if (k === 'enter' || k === ' ') act('confirm');
        else if (k === 'i') act('inject'); else if (k === 'r') act('repuncture'); else if (k === 'b') act('barbeau');
        else if (k === 'c') act('cocktail'); else if (k === 'h') act('heparin'); else if (k === 'l') act('long');
        else if (k === '+' || k === '=' || k === ']') act('sheath+'); else if (k === '-' || k === '[') act('sheath-');
        else if (k === 'backspace') act('back'); else if (k === 'escape') finish(null);
      }
      e.preventDefault(); e.stopImmediatePropagation();
    }, true);
    window.addEventListener('keyup', e => {
      if (!acc) return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'w', 'arrowdown', 's'].includes(k)) inp.y = 0;
      if (['arrowleft', 'a', 'arrowright', 'd'].includes(k)) inp.x = 0;
      e.stopImmediatePropagation();
    }, true);
  }
  function act(a) {
    if (!acc) return;
    acc.act(a);
    if (acc.done) { finish(acc.result); return; }
    if (a === 'barbeau' && acc.barbeau === 'D') { /* the trainee should switch to femoral (Skip -> choose femoral) */ }
    refresh(true);
  }
  function open(site, cb, opts) {
    build();
    acc = new NIR.access.Access(site, opts || {});
    onDone = cb; inp.x = inp.y = 0;
    $('accessOv').classList.remove('hidden'); document.body.classList.add('access-open');
    last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    refresh(true);
  }
  function finish(res) {
    const cb = onDone; acc = null; onDone = null; cancelAnimationFrame(raf);
    $('accessOv').classList.add('hidden'); document.body.classList.remove('access-open');
    if (cb) cb(res);
  }
  let logN = -1, stepShown = '';
  function refresh(force) {
    if (!acc) return;
    const st = acc.step, fem = acc.site === 'femoral';
    $('accTitle').textContent = t(fem ? 'acc_title_fem' : 'acc_title_rad');
    $('accStepNo').textContent = `${acc.steps.indexOf(st) + 1}/${acc.steps.length - 1}`;
    $('accSkip').textContent = t('acc_skip');
    if (force || stepShown !== st) { $('accInstr').textContent = t('acc_i_' + (fem ? 'f_' : 'r_') + st); stepShown = st; }
    const show = (id, on) => { $(id).classList.toggle('hidden', !on); };
    show('accBarbeau', st === 'barbeau'); show('accInject', st === 'angio'); show('accRepunct', st === 'angio' && !!acc.angio);
    show('accBack', st === 'wire'); show('accSheathBox', st === 'sheath'); show('accLong', fem);
    show('accCocktail', !fem && (st === 'sheath' || st === 'cocktail')); show('accHeparin', !fem && (st === 'sheath' || st === 'cocktail'));
    show('accL', st === 'site' || st === 'needle'); show('accR', st === 'site' || st === 'needle');
    show('accU', ['site', 'needle', 'wire'].includes(st)); show('accD', ['site', 'needle', 'wire'].includes(st));
    $('accU').textContent = st === 'site' ? '▲' : '▲ ' + t('acc_adv'); $('accD').textContent = st === 'site' ? '▼' : '▼ ' + t('acc_back');
    $('accOk').textContent = t('acc_ok_' + st);
    $('accBarbeau').textContent = t('acc_btn_barbeau'); $('accInject').textContent = t('acc_btn_inject'); $('accRepunct').textContent = t('acc_btn_repunct');
    $('accBack').textContent = t('acc_btn_back'); $('accLong').textContent = acc.sheathLong ? t('acc_long') : t('acc_short');
    $('accSheathLbl').textContent = fem ? `${acc.sheathF}F` : `${acc.sheathF}F Slender (${NIR.access.SLENDER_OD[acc.sheathF].toFixed(2)} mm)`;
    $('accCocktail').textContent = t('acc_btn_cocktail') + (acc.cocktail ? ' ✓' : ''); $('accHeparin').textContent = t('acc_btn_heparin') + (acc.heparin ? ' ✓' : '');
    $('accCocktail').classList.toggle('on', acc.cocktail); $('accHeparin').classList.toggle('on', acc.heparin);
    // status line
    let s = '';
    if (st === 'site') s = t('acc_s_mark', { y: Math.round(acc.mark.y) });
    else if (st === 'needle') s = t('acc_s_needle', { d: acc.needle.d.toFixed(1), w: t('acc_w_' + acc.needle.where), p: acc.passes });
    else if (st === 'wire') s = t('acc_s_wire', { p: Math.floor(acc.wire * 100) }) + (acc.wireRes ? ' · ' + t('acc_resist') : '');
    else if (st === 'barbeau') s = acc.barbeauDone ? t('acc_s_barbeau', { b: acc.barbeau }) : '';
    else if (st === 'sheath' && !fem) s = t('acc_s_radial', { d: acc.radialD.toFixed(1) });
    else if (st === 'angio' && acc.angio) s = t('acc_angio_' + (['ideal', 'ok'].includes(acc.angio.cls) ? 'good' : acc.angio.cls));
    $('accStatus').textContent = s;
    if (force || logN !== acc.log.length) {
      logN = acc.log.length;
      $('accLog').innerHTML = acc.log.slice(-3).map(m => `<div class="${m.level}">${t(m.key, m.params)}</div>`).join('');
    }
  }
  function loop(now) {
    if (!acc) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    acc.update(dt, inp);
    draw();
    refresh(false);
    raf = requestAnimationFrame(loop);
  }

  // ---------- drawing ----------
  function draw() {
    const cv = $('accCanvas'), r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const W = Math.max(200, Math.round(r.width * dpr)), H = Math.max(150, Math.round(r.height * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.direction = 'ltr';
    const st = acc.step;
    if (st === 'site' || st === 'micro' || (st === 'wire' && acc.site === 'femoral') || st === 'angio' || (st === 'sheath' && acc.site === 'femoral')) drawHip(g, W, H, dpr);
    else if (st === 'needle') drawUS(g, W, H, dpr);
    else if (st === 'barbeau') drawPleth(g, W, H, dpr);
    else drawWrist(g, W, H, dpr);
  }
  function label(g, txt, x, y, dpr, col, align) { g.font = `${Math.round(12 * dpr)}px system-ui, sans-serif`; g.fillStyle = col || '#ddd'; g.textAlign = align || 'left'; g.textBaseline = 'middle'; g.fillText(txt, x, y); }
  // AP fluoro of the RIGHT hip: viewer's left = patient's right = lateral. Drawing frame u = medial (+, to the viewer's
  // right), v = caudal (+), mm from the femoral-head centre; the CFA runs over the medial third of the head (u = FEM.cfaX).
  function drawHip(g, W, H, dpr) {
    const F = NIR.access.FEM, k = Math.min(W / 200, H / 150), cx = W * 0.5, cy = H * 0.43;
    const X = u => cx + u * k, Y = v => cy + v * k;
    g.fillStyle = '#8c8c8c'; g.fillRect(0, 0, W, H);
    const path = (pts, close) => { g.beginPath(); pts.forEach((q, i) => i ? g.lineTo(X(q[0]), Y(q[1])) : g.moveTo(X(q[0]), Y(q[1]))); if (close) g.closePath(); };
    const bone = (pts, a) => { path(pts, true); g.fillStyle = `rgba(38,38,38,${a || 0.45})`; g.fill(); g.strokeStyle = 'rgba(25,25,25,0.7)'; g.lineWidth = 1.5 * dpr; g.stroke(); };
    bone([[-78, -130], [-74, -70], [-62, -48], [-40, -36], [-22, -30], [0, -29], [22, -27], [34, -22], [44, -34], [60, -70], [66, -130]]); // ilium + acetabular roof
    bone([[20, -26], [92, -14], [96, 4], [24, 0]]);                                                                // superior pubic ramus
    bone([[12, 16], [26, 52], [70, 60], [98, 14], [96, 4], [86, 8], [64, 42], [36, 42], [26, 12]]);                // ischium + inferior ramus (obturator foramen inside)
    bone([[-6, -21], [-44, -26], [-60, -12], [-58, 26], [-50, 58], [-46, 150], [-20, 150], [-20, 74], [-14, 46], [-4, 44], [-10, 32], [6, 18]], 0.5); // neck, trochanters, shaft
    g.beginPath(); g.arc(X(0), Y(0), F.headR * k, 0, 7); g.fillStyle = 'rgba(38,38,38,0.5)'; g.fill(); g.strokeStyle = 'rgba(25,25,25,0.85)'; g.lineWidth = 1.5 * dpr; g.stroke();
    g.strokeStyle = 'rgba(15,15,15,0.75)'; g.lineWidth = 3 * dpr; g.beginPath(); g.arc(X(0), Y(0), (F.headR + 3) * k, Math.PI * 1.12, Math.PI * 1.92); g.stroke(); // sourcil
    const ang = acc.step === 'angio' && acc.angio;
    if (ang) {
      // contrast-filled external iliac -> CFA -> SFA / PFA; the inferior epigastric marks the inguinal ligament level
      g.strokeStyle = 'rgba(8,8,8,0.72)'; g.lineCap = 'round'; g.lineJoin = 'round';
      const v = (pts, w) => { g.lineWidth = w * k; path(pts); g.stroke(); };
      const c = F.cfaX, bf = acc.bifY;
      v([[c + 14, -130], [c + 6, -60], [c, 0], [c - 1, bf]], 8);
      v([[c - 1, bf], [c + 2, bf + 40], [c + 6, 150]], 6.5);
      v([[c - 1, bf], [c - 14, bf + 14], [c - 28, bf + 50], [c - 34, 150]], 5.5);
      v([[c + 1, F.ligY - 2], [c + 14, F.ligY - 10], [c + 22, F.ligY - 40], [c + 30, -120]], 2.2);
      label(g, t('acc_l_iea'), X(c + 26), Y(F.ligY - 44), dpr, '#111');
      label(g, 'SFA', X(c + 8), Y(bf + 60), dpr, '#111'); label(g, 'PFA', X(c - 34), Y(bf + 60), dpr, '#111', 'right');
      // contrast extravasation / jet for a bad level
      const cls = acc.angio.cls;
      if (cls === 'high') { g.fillStyle = 'rgba(10,10,10,0.35)'; g.beginPath(); g.ellipse(X(c + 6), Y(acc.punctureY), 12 * k, 8 * k, 0, 0, 7); g.fill(); }
    }
    // inguinal ligament (ASIS -> pubic tubercle), a faint dashed landmark (not visible on real fluoro)
    g.setLineDash([6 * dpr, 5 * dpr]); g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.5 * dpr;
    path([[-70, -40], [75, -10]]); g.stroke(); g.setLineDash([]);
    label(g, t('acc_l_lig'), X(-68), Y(-46), dpr, 'rgba(255,255,255,0.75)');
    label(g, t('acc_l_head'), X(-F.headR - 4), Y(F.headR + 4), dpr, 'rgba(255,255,255,0.8)', 'right');
    // hemostat tip (marker) / puncture point
    const my = acc.step === 'site' ? acc.mark.y : acc.punctureY != null ? acc.punctureY : acc.siteY, mx = acc.mark.x;
    g.strokeStyle = '#0d0d0d'; g.lineWidth = 2.4 * dpr;
    g.beginPath(); g.moveTo(X(mx) + 4 * dpr, Y(my) + 2 * dpr); g.lineTo(X(mx) + 60 * dpr, Y(my) + 46 * dpr); g.moveTo(X(mx) + 2 * dpr, Y(my) + 4 * dpr); g.lineTo(X(mx) + 52 * dpr, Y(my) + 54 * dpr); g.stroke();
    g.fillStyle = '#0d0d0d'; g.beginPath(); g.arc(X(mx), Y(my), 3 * dpr, 0, 7); g.fill();
    g.strokeStyle = '#ffd54a'; g.lineWidth = 1.5 * dpr; g.beginPath(); g.arc(X(mx), Y(my), 8 * dpr, 0, 7); g.stroke();
    if (acc.step !== 'site') {
      // needle -> micropuncture sheath -> 0.018" wire running up the external iliac
      g.strokeStyle = '#0b0b0b'; g.lineWidth = (acc.step === 'sheath' ? 3.2 : acc.step === 'wire' ? 1.4 : 2.2) * dpr;
      g.beginPath(); g.moveTo(X(mx) - 6 * dpr, Y(my) + 44 * dpr); g.lineTo(X(mx), Y(my)); g.stroke();
      const wl = acc.step === 'wire' ? acc.wire : 1;
      g.lineWidth = 1.2 * dpr; g.beginPath(); g.moveTo(X(mx), Y(my));
      if (acc.wireRes && acc.step === 'wire') g.bezierCurveTo(X(mx + 4), Y(my - 10), X(mx + 12), Y(my - 4), X(mx + 6), Y(my + 2));
      else g.lineTo(X(mx + 10 * wl), Y(my - 120 * wl));
      g.stroke();
      if (ang) { const c = acc.siteClass(acc.punctureY); label(g, t('acc_cls_' + c), 10 * dpr, H - 14 * dpr, dpr, ['ideal', 'ok'].includes(c) ? '#7CFC9A' : '#ffcf6b'); }
    }
    label(g, t('acc_l_rhip'), 10 * dpr, 14 * dpr, dpr, '#7CFC9A');
    label(g, 'R', 10 * dpr, H / 2, dpr, '#ddd'); label(g, 'L', W - 10 * dpr, H / 2, dpr, '#ddd', 'right');
  }
  // transverse ultrasound with an out-of-plane needle (bright dot)
  function drawUS(g, W, H, dpr) {
    const rad = acc.site === 'radial', depthMax = rad ? 12 : 40, k = (H - 20 * dpr) / depthMax, cx = W / 2;
    const X = x => cx + x * k, Y = d => 10 * dpr + d * k;
    g.fillStyle = '#262626'; g.fillRect(0, 0, W, H);
    // speckle
    let sd = 7; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let i = 0; i < 2200; i++) { const x = rnd() * W, y = 10 * dpr + rnd() * (H - 10 * dpr); g.fillStyle = `rgba(210,210,210,${0.1 + rnd() * 0.3})`; g.fillRect(x, y, 2.5 * dpr, 1.4 * dpr); }
    g.fillStyle = 'rgba(230,230,230,0.25)'; g.fillRect(0, Y(rad ? 1.2 : 5), W, 2 * dpr); // fascia
    g.fillStyle = 'rgba(220,220,220,0.5)'; g.fillRect(0, 0, W, 8 * dpr); // skin / probe
    const pulse = 1 + 0.07 * Math.sin(performance.now() / 1000 * 2 * Math.PI * 1.15);
    acc.veins.forEach(v => { g.fillStyle = '#000'; g.beginPath(); g.ellipse(X(v.x), Y(v.d), v.r * k * 1.15, v.r * k * 0.85, 0, 0, 7); g.fill(); });
    const a = acc.art; g.fillStyle = '#000'; g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 2 * dpr;
    g.beginPath(); g.arc(X(a.x), Y(a.d), a.r * k * pulse, 0, 7); g.fill(); g.stroke();
    label(g, rad ? t('acc_l_ra') : 'CFA', X(a.x) + a.r * k + 6 * dpr, Y(a.d), dpr, '#e88');
    label(g, rad ? t('acc_l_vc') : 'CFV', X(acc.veins[0].x) - acc.veins[0].r * k - 6 * dpr, Y(acc.veins[0].d), dpr, '#88e', 'right');
    // needle: planned line at the skin + tip echo + acoustic shadow
    const n = acc.needle;
    g.strokeStyle = 'rgba(255,213,74,0.6)'; g.setLineDash([4 * dpr, 4 * dpr]); g.beginPath(); g.moveTo(X(n.x), Y(0)); g.lineTo(X(n.x), Y(depthMax)); g.stroke(); g.setLineDash([]);
    if (n.d > 0.3) {
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(X(n.x) - 2 * dpr, Y(n.d), 4 * dpr, H);
      g.fillStyle = '#fff'; g.beginPath(); g.arc(X(n.x), Y(n.d), 3 * dpr, 0, 7); g.fill();
    }
    // depth scale
    g.strokeStyle = '#aaa'; g.lineWidth = 1; for (let d = 0; d <= depthMax; d += rad ? 2 : 10) { g.beginPath(); g.moveTo(W - 14 * dpr, Y(d)); g.lineTo(W - 6 * dpr, Y(d)); g.stroke(); label(g, d + '', W - 16 * dpr, Y(d), dpr, '#aaa', 'right'); }
    // flashback in the needle hub
    const w = n.where, col = w === 'artery' ? '#ff2a2a' : w === 'vein' ? '#5a0d14' : null;
    g.strokeStyle = '#ccc'; g.lineWidth = 2 * dpr; g.strokeRect(12 * dpr, 16 * dpr, 26 * dpr, 40 * dpr);
    if (col) { const f = w === 'artery' ? 0.6 + 0.4 * Math.abs(Math.sin(performance.now() / 1000 * Math.PI * 1.15)) : 0.7; g.fillStyle = col; g.fillRect(14 * dpr, 16 * dpr + 38 * dpr * (1 - f), 22 * dpr, 38 * dpr * f); }
    label(g, t('acc_l_hub'), 44 * dpr, 36 * dpr, dpr, '#ccc');
  }
  // Barbeau test: pulse-oximetry trace on the thumb with the radial artery compressed
  function drawPleth(g, W, H, dpr) {
    g.fillStyle = '#071018'; g.fillRect(0, 0, W, H);
    label(g, t('acc_l_pleth'), 10 * dpr, 14 * dpr, dpr, '#7CFC9A');
    if (!acc.barbeauDone) { label(g, t('acc_l_press_barbeau'), W / 2, H / 2, dpr, '#9fb3c8', 'center'); return; }
    const type = acc.barbeau, y0 = H * 0.55, amp = H * 0.18;
    g.strokeStyle = '#7CFC9A'; g.lineWidth = 2 * dpr; g.beginPath();
    for (let x = 0; x < W; x += 2) {
      const tt = x / W * 120, ph = Math.sin(x / (9 * dpr) * 2 * Math.PI);
      let a = 1; // amplitude factor after compression at t=20 s
      if (tt > 20) a = type === 'A' ? 1 : type === 'B' ? 0.5 : type === 'C' ? (tt < 80 ? 0 : 0.6) : 0;
      const y = y0 - ph * amp * a;
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    label(g, t('acc_l_compress'), W * 20 / 120, H * 0.18, dpr, '#ffd54a');
    label(g, 'Barbeau ' + type, W - 10 * dpr, 14 * dpr, dpr, type === 'D' ? '#ff7b6b' : '#7CFC9A', 'right');
  }
  // right wrist: needle / wire / slender sheath / cocktail
  function drawWrist(g, W, H, dpr) {
    g.fillStyle = '#8c8c8c'; g.fillRect(0, 0, W, H);
    const k = Math.min(W, H) / 120, cx = W * 0.5, cy = H * 0.5;
    g.fillStyle = 'rgba(40,40,40,0.5)'; g.fillRect(cx - 30 * k, 0, 16 * k, H); g.fillRect(cx + 6 * k, 0, 14 * k, H); // radius / ulna
    g.strokeStyle = '#111'; g.lineWidth = (acc.step === 'wire' ? 1.3 : 3) * dpr;
    const p = acc.step === 'wire' ? acc.wire : 1;
    g.beginPath(); g.moveTo(cx - 24 * k, H); g.lineTo(cx - 24 * k, H - (H * 0.9) * p); g.stroke();
    if (acc.wireRes && acc.step === 'wire') { g.beginPath(); g.arc(cx - 24 * k, H - 30 * dpr, 8 * dpr, 0, 5); g.stroke(); }
    label(g, t('acc_l_rwrist'), 10 * dpr, 14 * dpr, dpr, '#7CFC9A');
    if (acc.step === 'cocktail' || acc.step === 'sheath') {
      label(g, (acc.cocktail ? '✓ ' : '○ ') + t('acc_btn_cocktail'), 10 * dpr, H - 36 * dpr, dpr, acc.cocktail ? '#7CFC9A' : '#fff');
      label(g, (acc.heparin ? '✓ ' : '○ ') + t('acc_btn_heparin'), 10 * dpr, H - 16 * dpr, dpr, acc.heparin ? '#7CFC9A' : '#fff');
    }
  }
  NIR.accessUI = { open, finish, isOpen: () => !!acc, get acc() { return acc; } };
})(window.NIR = window.NIR || {});
