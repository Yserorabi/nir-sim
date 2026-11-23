/* NIR-Sim renderer: fluoroscopy-style 2D canvas view. */
(function (NIR) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function Renderer(canvas, sim) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.sim = sim;
    this.cams = {}; this.cam = this.camFor('ap');
    this.zoomMul = 1; this.autoZoom = true; this.ghost = false; this.biplane = false; this.mainView = 'ap';
    this.flash = 0; this.frame = 0;
    this.setView('ap');
    this.makeNoise();
    this.resize();
  }

  // Projection: rotate about the patient's long axis. AP: 0°, LAO 30°, lateral 90° (anterior to screen-left).
  const VIEWS = { ap: 0, lao: 30, lat: 90 };
  // user-selected view for single-plane mode
  Renderer.prototype.setView = function (v) { this.mainView = VIEWS[v] != null ? v : 'ap'; this.applyView(this.mainView); };
  Renderer.prototype.applyView = function (v) {
    this.view = VIEWS[v] != null ? v : 'ap';
    const th = VIEWS[this.view] * Math.PI / 180; this.vc = Math.cos(th); this.vs = Math.sin(th);
  };
  Renderer.prototype.setBiplane = function (on) { this.biplane = !!on; };
  Renderer.prototype.camFor = function (v) { return this.cams[v] || (this.cams[v] = { x: 445, y: 900, z: 1.4 }); };
  Renderer.prototype.P = function (p) { return { x: 500 + (p.x - 500) * this.vc - (p.z || 0) * this.vs, y: p.y }; };
  Renderer.prototype.P3 = function (x, y, z) { return this.P({ x, y, z }); };

  Renderer.prototype.makeNoise = function () {
    const n = document.createElement('canvas'); n.width = n.height = 160;
    const g = n.getContext('2d'), im = g.createImageData(160, 160);
    for (let i = 0; i < im.data.length; i += 4) { const v = Math.random() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    g.putImageData(im, 0, 0); this.noise = n;
  };

  Renderer.prototype.resize = function () {
    const cap = this.lowQuality ? 1 : (NIR.isTouch ? 1.25 : 1.5);
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    const r = this.c.getBoundingClientRect();
    const w = Math.max(200, Math.round(r.width * dpr)), h = Math.max(200, Math.round(r.height * dpr));
    if (this.c.width !== w || this.c.height !== h) { this.c.width = w; this.c.height = h; }
    this.dpr = dpr;
  };

  Renderer.prototype.updateCamera = function (dt) {
    if (this.inset) return this.insetCamera(dt);
    const sim = this.sim, d = sim.devices[sim.active];
    const S = d && d.inserted ? d.s : sim.maxTip();
    const loc0 = sim.locate(S), lp = this.P(loc0), loc = { seg: loc0.seg, x: lp.x, y: lp.y };
    let tz = this.cam.z;
    const PW = this.paneW || this.c.width, PH = this.paneH || this.c.height;
    const base = Math.min(PW, PH) / 700; // px per mm at z=1
    let tx = loc.x, ty = loc.y;
    const SK = sim.anat.skull, lead = sim.locate(sim.maxTip()), headMode = !!((loc0.seg.head && (loc0.seg.intracranial || loc0.y < -60)) || lead.seg.intracranial);
    this.headMode = headMode;
    if (this.autoZoom) tz = clamp(9 / Math.pow(loc.seg.r, 0.72), 0.9, 6.5);
    if (headMode && this.autoZoom) {
      // intracranial work: the whole head fills the field of view (like a neuro DSA field)
      const c = Math.abs(this.vc), sn = Math.abs(this.vs), sc = this.P3(SK.cx, SK.cy, SK.cz);
      const sw = 2 * (SK.rx * c + SK.rz * sn) + 30, sh = 2 * SK.ry + 30;
      tz = Math.min(PW / sw, PH / sh) * 0.98 / base;
      const fT = clamp(0.15 + (this.zoomMul - 1) * 0.85, 0.15, 1); tx = sc.x + (loc.x - sc.x) * fT; ty = sc.y + (loc.y - sc.y) * fT;
    }
    tz *= this.zoomMul;
    // during a contrast run, frame the opacified vessels (like choosing a DSA field of view)
    if (sim.run && this.autoZoom) {
      const run = sim.run; run.bboxes = run.bboxes || {}; run.bbox = run.bboxes[this.view];
      if (!run.bbox) {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        const aorticSrc = run.srcSeg && sim.seg(run.srcSeg).aortic;
        const ic = run.fill.filter(e => sim.seg(e.seg).intracranial);
        (aorticSrc || !ic.length ? run.fill : ic).forEach(e => { const sg = sim.seg(e.seg); const lo = Math.min(e.a, e.b), hi = Math.max(e.a, e.b);
          for (let u = lo; u <= hi; u += 4) { const p = this.P(NIR.anatomy.pointAt(sg, u)); if (aorticSrc && (p.y < 120 || p.y > 600)) continue; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); } });
        if (ic.length && !aorticSrc) { const c = Math.abs(this.vc), sn = Math.abs(this.vs), sc = this.P3(SK.cx, SK.cy, SK.cz), hw = SK.rx * c + SK.rz * sn;
          x0 = Math.min(x0, sc.x - hw); x1 = Math.max(x1, sc.x + hw); y0 = Math.min(y0, sc.y - SK.ry); }
        run.bbox = run.bboxes[this.view] = { x0, y0, x1, y1 };
      }
      const b = run.bbox;
      tx = (b.x0 + b.x1) / 2; ty = (b.y0 + b.y1) / 2;
      tz = clamp(Math.min(PW / (b.x1 - b.x0 + 40), PH / (b.y1 - b.y0 + 40)) * 0.9 / base, 0.6, 5) * this.zoomMul;
    }
    const k = 1 - Math.pow(0.02, dt);
    this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k;
    this.cam.zTarget = tz; this.cam.z += (tz - this.cam.z) * k;
    this.scale = this.cam.z * base;
  };

  // magnified close-up of the selective (or guide) catheter tip: frames the distal curve
  Renderer.prototype.insetCamera = function (dt) {
    const sim = this.sim, D = sim.devices, d = D.diag.inserted ? D.diag : D.inter.inserted ? D.inter : D.guide;
    const PW = this.paneW || this.c.width, PH = this.paneH || this.c.height, base = Math.min(PW, PH) / 700;
    let tx = this.cam.x, ty = this.cam.y, span = 40;
    if (d.inserted) {
      const pl = d.id === 'inter' ? { mode: 'track', pts: [-30, -20, -10, 0, 8].map(o => sim.locate(Math.max(0, d.s + o))) } : NIR.shapes.catheterPolyline(sim, d), pts = pl.pts.slice(/engaged|form/.test(pl.mode) ? -70 : -30);
      if (pts.length) {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        pts.forEach(p => { const q = this.P(p); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); });
        const loc = sim.locate(d.s), r = loc.seg.r || 5;
        tx = (x0 + x1) / 2; ty = (y0 + y1) / 2; span = Math.max(x1 - x0, y1 - y0, 4 * r, 30) + 12;
      }
    }
    let tz = clamp(700 / span, 2, 14);
    if (this.mainScale) tz = Math.max(tz, (span > 60 ? 1.15 : 1.6) * this.mainScale / base);
    const k = 1 - Math.pow(0.004, dt || 0.016);
    this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k; this.cam.z += (tz - this.cam.z) * k;
    this.scale = this.cam.z * base; this.headMode = false;
  };
  Renderer.prototype.worldTransform = function () {
    const s = this.scale, ctx = this.ctx;
    const ox = this.paneX || 0, PW = this.paneW || this.c.width, PH = this.paneH || this.c.height;
    ctx.setTransform(s, 0, 0, s, ox + PW / 2 - this.cam.x * s, PH / 2 - this.cam.y * s);
  };
  Renderer.prototype.px = function (p) { return p / this.scale; }; // screen px -> world units

  Renderer.prototype.segPath = function (seg, a, b) {
    const ctx = this.ctx, pts = seg.pts;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const A = this.P(NIR.anatomy.pointAt(seg, lo)), B = this.P(NIR.anatomy.pointAt(seg, hi));
    ctx.moveTo(A.x, A.y);
    for (let i = Math.ceil(lo); i < pts.length && pts[i].s < hi; i++) { const q = this.P(pts[i]); ctx.lineTo(q.x, q.y); }
    ctx.lineTo(B.x, B.y);
  };

  Renderer.prototype.drawBones = function (dsa) {
    const ctx = this.ctx, a = dsa ? 0.25 : 1, c = Math.abs(this.vc), sn = Math.abs(this.vs);
    const P = (x, y, z) => this.P3(x, y, z);
    ctx.save();
    // lungs (radiolucent) & heart
    ctx.fillStyle = `rgba(255,255,255,${0.10 * a})`;
    if (c > 0.3) [[405, 540, -5], [598, 540, -5]].forEach(q => { const p = P(q[0], q[1], q[2]); ctx.beginPath(); ctx.ellipse(p.x, p.y, 88 * c + 40 * sn, 150, 0, 0, Math.PI * 2); ctx.fill(); });
    else { const p = P(500, 540, -5); ctx.beginPath(); ctx.ellipse(p.x, p.y, 110, 160, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = `rgba(0,0,0,${0.10 * a})`;
    { const p = P(522, 570, 25); ctx.beginPath(); ctx.ellipse(p.x, p.y, 100 * c + 70 * sn, 75, -0.3 * c, 0, Math.PI * 2); ctx.fill(); }
    // spine (vertebral bodies lie posterior)
    for (let y = 900; y > -95;) {
      const h = y > 700 ? 27 : y > 300 ? 22 : 15, w = y > 700 ? 48 : y > 300 ? 38 : 30, dpt = y > 700 ? 40 : y > 300 ? 32 : 18;
      const zc = y > 300 ? -62 : -50, p = P(500, y, zc), W = w * c + dpt * sn;
      ctx.fillStyle = `rgba(30,30,30,${0.16 * a})`;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(p.x - W / 2, y - h, W, h - 3, 4) : ctx.rect(p.x - W / 2, y - h, W, h - 3); ctx.fill();
      ctx.fillStyle = `rgba(20,20,20,${0.12 * a})`;
      if (c > 0.5) { ctx.beginPath(); ctx.ellipse(p.x - w * 0.33 * c, y - h / 2, 4, 6, 0, 0, 7); ctx.ellipse(p.x + w * 0.33 * c, y - h / 2, 4, 6, 0, 0, 7); ctx.fill(); }
      else { const q = P(500, y, zc - 28); ctx.beginPath(); ctx.ellipse(q.x, y - h / 2, 9, 5, 0, 0, 7); ctx.fill(); } // spinous/posterior elements
      y -= h;
    }
    ctx.strokeStyle = `rgba(30,30,30,${0.14 * a})`; ctx.lineCap = 'round';
    if (c > 0.4) {
      ctx.save(); ctx.globalAlpha = c;
      ctx.lineWidth = 7;
      for (let i = 0; i < 7; i++) {
        const y0 = 380 + i * 45, L0 = P(482, y0, -60), Lc = P(340, y0 - 40, -20), L1 = P(300, y0 + 70, 20), R0 = P(518, y0, -60), Rc = P(660, y0 - 40, -20), R1 = P(700, y0 + 70, 20);
        ctx.beginPath(); ctx.moveTo(L0.x, L0.y); ctx.quadraticCurveTo(Lc.x, Lc.y, L1.x, L1.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(R0.x, R0.y); ctx.quadraticCurveTo(Rc.x, Rc.y, R1.x, R1.y); ctx.stroke();
      }
      ctx.lineWidth = 11;
      [[475, 320], [525, 320]].forEach((q, i) => { const s0 = P(q[0], 318, 30), cc = P(i ? 600 : 400, 290, 25), e = P(i ? 680 : 320, 300, 0);
        ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.quadraticCurveTo(cc.x, cc.y, e.x, e.y); ctx.stroke(); });
      ctx.lineWidth = 14;
      { const p1 = P(395, 870, -20), p2 = P(605, 870, -20);
        ctx.beginPath(); ctx.ellipse(p1.x, p1.y, 105 * c, 70, -0.4, Math.PI * 0.9, Math.PI * 2.2); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(p2.x, p2.y, 105 * c, 70, 0.4, Math.PI * 0.8, Math.PI * 2.1); ctx.stroke(); }
      ctx.restore();
    }
    if (sn > 0.4) { // sternum + sacrum seen laterally
      ctx.lineWidth = 12; ctx.strokeStyle = `rgba(30,30,30,${0.15 * a * sn})`;
      const s0 = P(500, 330, 78), s1 = P(500, 640, 92); ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
    }
    ctx.fillStyle = `rgba(30,30,30,${0.15 * a})`;
    [[392, 930, 0], [608, 930, 0]].forEach(q => { const p = P(q[0], q[1], q[2]); ctx.beginPath(); ctx.arc(p.x, p.y, 28, 0, 7); ctx.fill(); });
    // right arm (radial access): humerus, radius + ulna, carpal bones
    if (this.sim.anat.access === 'radial') {
      ctx.strokeStyle = `rgba(30,30,30,${0.2 * a})`; ctx.lineCap = 'round';
      const ln = (pts, w) => { ctx.lineWidth = w; ctx.beginPath(); pts.forEach((q, i) => { const p = P(q[0], q[1], q[2]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); };
      ln([[300, 318, -12], [262, 380, -8], [232, 460, -4], [214, 535, 0]], 20);
      ln([[214, 552, 4], [205, 640, 10], [198, 770, 20]], 10);
      ln([[228, 548, -2], [222, 650, 6], [216, 772, 14]], 9);
      ctx.fillStyle = `rgba(30,30,30,${0.18 * a})`;
      [[196, 792], [212, 790], [228, 794], [204, 808], [220, 810]].forEach(q => { const p = P(q[0], q[1], 18); ctx.beginPath(); ctx.arc(p.x, p.y, 6.5, 0, 7); ctx.fill(); });
    }
    // skull, skull base, orbits, mandible
    const SK = this.sim.anat.skull, sk = P(SK.cx, SK.cy, SK.cz);
    ctx.strokeStyle = `rgba(25,25,25,${0.30 * a})`; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.ellipse(sk.x, sk.y, SK.rx * c + SK.rz * sn + 6, SK.ry + 6, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = `rgba(25,25,25,${0.12 * a})`; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(sk.x, sk.y, SK.rx * c + SK.rz * sn - 4, SK.ry - 4, 0, 0, Math.PI * 2); ctx.stroke();
    // skull base / petrous ridges / clivus
    ctx.strokeStyle = `rgba(25,25,25,${0.2 * a})`; ctx.lineWidth = 12;
    ctx.beginPath();
    [[395, -120, -60], [455, -165, -25], [500, -150, 10], [545, -165, -25], [605, -120, -60]].forEach((q, i) => { const p = P(q[0], q[1], q[2]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = `rgba(25,25,25,${0.16 * a})`;
    [[455, -212, 82], [545, -212, 82]].forEach(q => { const p = P(q[0], q[1], q[2]); ctx.beginPath(); ctx.arc(p.x, p.y, 22, 0, 7); ctx.stroke(); });
    ctx.lineWidth = 9;
    { const m0 = P(420, -105, -20), m1 = P(430, -10, 60), m2 = P(500, 0, 95), m3 = P(570, -10, 60), m4 = P(580, -105, -20);
      ctx.beginPath(); ctx.moveTo(m0.x, m0.y); ctx.quadraticCurveTo(m1.x, m1.y, m2.x, m2.y); ctx.quadraticCurveTo(m3.x, m3.y, m4.x, m4.y); ctx.stroke(); }
    ctx.restore();
  };

  // intracranial geometry is displayed magnified (HEAD_K); lumen width is magnified the same way
  Renderer.prototype.vesselWidth = function (seg) { return Math.max(2 * seg.r * (seg.head && seg.intracranial ? NIR.anatomy.HEAD_K : 1), this.px(1.3)); };

  Renderer.prototype.drawGhost = function () {
    const ctx = this.ctx, sim = this.sim;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    sim.anat.list.forEach(seg => { ctx.lineWidth = this.vesselWidth(seg); ctx.beginPath(); this.segPath(seg, 0, seg.len); ctx.stroke(); });
    // clot outline (training aid)
    sim.clots.forEach(c => {
      if (c.removed) return; const seg = sim.seg(c.seg);
      ctx.strokeStyle = 'rgba(190,40,40,0.55)'; ctx.lineWidth = 2 * seg.r * 0.9;
      ctx.beginPath(); this.segPath(seg, c.s0, c.s1); ctx.stroke();
    });
    ctx.restore();
  };

  Renderer.prototype.drawRoadmap = function () {
    const ctx = this.ctx, sim = this.sim;
    if (!sim.roadmapOn || !sim.roadmap) return;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(235,235,235,0.72)';
    sim.roadmap.forEach(e => { const seg = sim.seg(e.seg); ctx.lineWidth = this.vesselWidth(seg); ctx.beginPath(); this.segPath(seg, e.a, e.b); ctx.stroke(); });
    ctx.restore();
  };

  Renderer.prototype.drawRun = function () {
    const sim = this.sim, run = sim.run; if (!run) return;
    const ctx = this.ctx, t = run.t;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const CH = 5;
    run.fill.forEach(e => {
      const seg = sim.seg(e.seg), w = this.vesselWidth(seg);
      const dir = e.b >= e.a ? 1 : -1, L = Math.abs(e.b - e.a);
      for (let u = 0; u < L; u += CH) {
        const s0 = e.a + dir * u, s1 = e.a + dir * Math.min(L, u + CH + 0.6);
        const I = sim.contrastAt(e.d0 + u + CH / 2, t, e.k);
        if (I < 0.02) continue;
        const v = Math.round(185 - 172 * Math.min(1, 0.92 * I)); // opaque grey avoids beading at chunk overlaps
        ctx.strokeStyle = `rgb(${v},${v},${v})`; ctx.lineWidth = w;
        ctx.beginPath(); this.segPath(seg, s0, s1); ctx.stroke();
      }
      // capillary blush of the territory supplied by this segment
      if (seg.territory && (seg.mca || seg.aca) && Math.abs(e.b - e.a) > seg.len * 0.5) {
        const dEnd = e.d0 + L;
        const ph = clamp((t - dEnd / 170 - 0.5) / 0.8, 0, 1) * (1 - clamp((t - dEnd / 170 - 2.6) / 1.4, 0, 1));
        if (ph > 0.01) {
          const end = this.P(NIR.anatomy.pointAt(seg, seg.len)), mid = this.P(NIR.anatomy.pointAt(seg, seg.len * 0.5));
          const R = 6 + seg.territory * (seg.aca ? 22 : 34);
          [end, mid].forEach(p => {
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
            g.addColorStop(0, `rgba(20,20,20,${(0.32 * ph * e.k).toFixed(3)})`); g.addColorStop(1, 'rgba(20,20,20,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, 7); ctx.fill();
          });
        }
      }
    });
    // extravasation at perforation sites
    sim.perforations.forEach(p => {
      if (p.how !== 'aortic' && !run.fill.some(e => sim.seg(p.seg).chain.includes(e.seg))) return;
      const R = p.how === 'aortic' ? Math.min(45, 6 + t * 10) : Math.min(22, 3 + t * 5); p = Object.assign({}, p, this.P(p));
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
      g.addColorStop(0, 'rgba(5,5,5,0.85)'); g.addColorStop(1, 'rgba(5,5,5,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, 7); ctx.fill();
    });
    ctx.restore();
  };

  Renderer.prototype.drawStains = function () {
    const ctx = this.ctx, sim = this.sim;
    sim.perforations.forEach(p0 => {
      const p = this.P(p0);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 9);
      g.addColorStop(0, 'rgba(10,10,10,0.35)'); g.addColorStop(1, 'rgba(10,10,10,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, 7); ctx.fill();
    });
    sim.perforations.forEach(p0 => {
      if (p0.how !== 'aortic') return;
      const p = this.P(p0), R = 26 + 4 * Math.sin(this.frame * 0.05);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
      g.addColorStop(0, 'rgba(5,5,5,0.6)'); g.addColorStop(1, 'rgba(5,5,5,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, 7); ctx.fill();
    });
    sim.dissections.forEach(p0 => {
      if (p0.flap) { // intimal flap: a thin radiolucent/opaque line running parallel to the outer aortic wall
        ctx.strokeStyle = 'rgba(5,5,5,0.7)'; ctx.lineWidth = this.px(1.6); ctx.setLineDash([this.px(4), this.px(2)]);
        ctx.beginPath(); p0.flap.forEach((q, i) => { const r = this.P(q); if (i) ctx.lineTo(r.x, r.y); else ctx.moveTo(r.x, r.y); }); ctx.stroke(); ctx.setLineDash([]);
        return;
      }
      const p = this.P(p0);
      ctx.strokeStyle = 'rgba(10,10,10,0.35)'; ctx.lineWidth = this.px(1.2);
      ctx.beginPath(); ctx.moveTo(p.x - 2, p.y - 4); ctx.lineTo(p.x + 2, p.y + 4); ctx.stroke();
    });
  };

  // polyline along the shared track from S=a to S=b
  Renderer.prototype.trackPath = function (a, b) {
    const sim = this.sim, ctx = this.ctx, pts = sim.trackPts;
    const A = this.P(sim.locate(a)), B = this.P(sim.locate(b));
    ctx.moveTo(A.x, A.y);
    for (let i = 0; i < pts.length; i++) { const p = pts[i]; if (p.S <= a) continue; if (p.S >= b) break; const q = this.P(p); ctx.lineTo(q.x, q.y); }
    ctx.lineTo(B.x, B.y);
  };

  Renderer.prototype.marker = function (S, r, alpha) {
    const p = this.P(this.sim.locate(S)), ctx = this.ctx;
    ctx.fillStyle = `rgba(0,0,0,${alpha || 0.9})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(r, this.px(1.6)), 0, 7); ctx.fill();
  };

  Renderer.prototype.drawDevices = function () {
    const sim = this.sim, ctx = this.ctx, D = sim.devices;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // guide and selective catheter: one continuous tube following the shaft into its true 3D tip shape
    const polys = this.polys = {};
    const tube = (d, minPx, a) => {
      if (!d.inserted || d.s <= 0.2) return;
      const pl = NIR.shapes.catheterPolyline(sim, d); polys[d.id] = pl;
      if (!pl.pts.length) return;
      this.polyStroke(pl.pts, Math.max(d.od, this.px(minPx)), `rgba(20,20,20,${a})`);
      if (d.od > 1.5) this.polyStroke(pl.pts, Math.max(d.od * 0.45, this.px(minPx * 0.4)), 'rgba(150,150,150,0.22)');
      const q = this.P(pl.tip); ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(d.od * 0.62, this.px(1.6)), 0, 7); ctx.fill();
    };
    // an inner device whose tip is at track position S, drawn inside the selective catheter's real shape
    const along = (S) => {
      const pl = polys.diag, d = D.diag;
      ctx.beginPath();
      if (!pl || !pl.pts.length || pl.mode === 'straight') { this.trackPath(0, S); return; }
      const cum = [0]; for (let i = 1; i < pl.pts.length; i++) { const a = pl.pts[i - 1], b = pl.pts[i]; cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)); }
      const Ltot = cum[cum.length - 1], want = S >= d.s ? Ltot : Ltot - (d.s - S);
      let q = this.P(pl.pts[0]); ctx.moveTo(q.x, q.y);
      for (let i = 1; i < pl.pts.length; i++) {
        if (cum[i] >= want) { const f = (want - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]), a = pl.pts[i - 1], b = pl.pts[i]; q = this.P({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f }); ctx.lineTo(q.x, q.y); break; }
        q = this.P(pl.pts[i]); ctx.lineTo(q.x, q.y);
      }
      if (S > d.s) { const pts = sim.trackPts; for (let i = 0; i < pts.length; i++) { const p = pts[i]; if (p.S <= d.s) continue; if (p.S >= S) break; const r = this.P(p); ctx.lineTo(r.x, r.y); } const B = this.P(sim.locate(S)); ctx.lineTo(B.x, B.y); }
    };
    this.along = along;
    tube(D.guide, 3.2, 0.55);
    tube(D.diag, 2.0, 0.6);
    if (D.inter.inserted && D.inter.s > 0.2) {
      const d = D.inter; ctx.strokeStyle = 'rgba(20,20,20,0.5)'; ctx.lineWidth = Math.max(sim.devOD(d), this.px(2.6));
      if (d.hung && d.strain > 0.5) this.drawBuckled(d); else { ctx.beginPath(); this.trackPath(0, d.s); ctx.stroke(); }
      this.marker(d.s, d.od * 0.62, 0.85);
      if (d.hung) { // tip caught on the ophthalmic ledge
        const q = this.P(sim.locate(d.s)), pulse = 0.5 + 0.5 * Math.sin(this.frame * 0.25);
        ctx.strokeStyle = `rgba(255,60,40,${0.5 + 0.4 * pulse})`; ctx.lineWidth = this.px(2.2);
        ctx.beginPath(); ctx.arc(q.x, q.y, this.px(10 + 3 * pulse), 0, 7); ctx.stroke();
        ctx.save(); ctx.fillStyle = '#ff5a3c'; ctx.font = `bold ${this.px(13 * this.dpr)}px system-ui, sans-serif`; ctx.textAlign = 'left';
        ctx.fillText(NIR.i18n.t('hang_tag'), q.x + this.px(14), q.y - this.px(8)); ctx.restore();
      }
    }
    if (D.micro.inserted && D.micro.s > 0.2) {
      ctx.strokeStyle = 'rgba(20,20,20,0.4)'; ctx.lineWidth = Math.max(sim.devOD(D.micro), this.px(1.6));
      along(D.micro.s); ctx.stroke();
      this.marker(D.micro.s, 0.6, 0.95); if (D.micro.s > 30) this.marker(D.micro.s - 30, 0.55, 0.9);
    }
    // stent retriever: push wire, sheathed (collapsed) part inside the micro, and the opened part beyond the micro tip
    const S = D.sr;
    if (S.inserted) {
      const L = sim.srLen(), e = sim.srExposed(), prox = S.s - L, open0 = S.s - e;
      ctx.strokeStyle = 'rgba(10,10,10,0.8)'; ctx.lineWidth = Math.max(0.33, this.px(1.1));
      if (prox > 0) { ctx.beginPath(); this.trackPath(0, prox); ctx.stroke(); }
      if (open0 > prox + 0.3) { ctx.strokeStyle = 'rgba(10,10,10,0.55)'; ctx.lineWidth = Math.max(0.5, this.px(1.4)); ctx.beginPath(); this.trackPath(Math.max(0, prox), open0); ctx.stroke(); }
      if (e > 0.3) this.drawStentMesh(open0, S.s, !S.deployed);
      // distal markers splay apart as the distal end opens; proximal marker stays on the push wire
      const rT = e > 0.3 ? this.stentR(S.s - 1, open0, S.s, !S.deployed) * 0.85 : 0.18;
      this.offMarker(S.s - 0.6, -rT, 0.4); this.offMarker(S.s - 0.6, 0, 0.4); this.offMarker(S.s - 0.6, rT, 0.4);
      if (prox > 0) this.marker(prox, 0.45, 0.95);
    }
    // unsupported stiff guide / aspiration catheter: the straight tip runs on into the outer wall instead of turning
    ['guide', 'inter'].forEach(id => {
      const d = D[id]; if (!d.inserted || !(d.wallImpact > 0)) return;
      const loc = sim.locate(d.s), r = loc.seg.r, L = Math.min(r * 0.95, 2 + d.wallImpact * 0.35);
      const tip = { x: loc.x + loc.tx * L, y: loc.y + loc.ty * L, z: loc.z + loc.tz * L };
      const a = this.P(loc), b = this.P(tip);
      ctx.strokeStyle = 'rgba(20,20,20,0.6)'; ctx.lineWidth = Math.max(d.od || sim.devOD(d), this.px(3));
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      const pulse = 0.5 + 0.5 * Math.sin(this.frame * 0.3), sev = Math.min(1, d.wallImpact / 30);
      ctx.strokeStyle = `rgba(255,${Math.round(150 - 110 * sev)},40,${0.55 + 0.4 * pulse})`; ctx.lineWidth = this.px(2.4);
      ctx.beginPath(); ctx.arc(b.x, b.y, this.px(9 + 4 * pulse + 6 * sev), 0, 7); ctx.stroke();
      ctx.save(); ctx.fillStyle = '#ff5a3c'; ctx.font = `bold ${this.px(13 * this.dpr)}px system-ui, sans-serif`; ctx.textAlign = 'left';
      ctx.fillText(NIR.i18n.t('wall_tag'), b.x + this.px(16), b.y - this.px(6)); ctx.restore();
    });
    // GUIDEWIRE (0.035/0.038": angled Glidewire, J, or stiff exchange) and MICROWIRE (0.014-0.024", radiopaque 3 cm tip)
    const inCath = W => ['guide', 'diag', 'inter', 'micro'].some(id => D[id].inserted && D[id].s >= W.s - 0.5);
    const GW = D.wire;
    if (GW.inserted && GW.s > 0.2) {
      const g = sim.gwireType();
      ctx.strokeStyle = g.stiff ? 'rgba(0,0,0,0.97)' : 'rgba(5,5,5,0.9)'; ctx.lineWidth = Math.max(sim.wireOD('wire'), this.px(g.stiff ? 1.9 : 1.5));
      along(GW.s); ctx.stroke();
      if (!inCath(GW)) this.drawJTip(GW, false, g.tip);
    }
    const MW = D.mwire;
    if (MW.inserted && MW.s > 0.2) {
      ctx.strokeStyle = 'rgba(25,25,25,0.75)'; ctx.lineWidth = Math.max(sim.wireOD('mwire'), this.px(0.9));
      along(MW.s); ctx.stroke();
      // radiopaque distal coil (~30 mm, drawn denser) + shaped tip
      ctx.strokeStyle = 'rgba(0,0,0,0.98)'; ctx.lineWidth = Math.max(sim.wireOD('mwire') * 1.6, this.px(1.6));
      ctx.beginPath(); this.trackPath(Math.max(0, MW.s - 30), MW.s); ctx.stroke();
      if (!inCath(MW)) this.drawJTip(MW, true, 'shaped');
    }
    ctx.restore();
  };

  // a stuck aspiration catheter: the push is stored as a bow/buckle in the cervical ICA (amplitude limited by the lumen)
  Renderer.prototype.drawBuckled = function (d) {
    const sim = this.sim, ctx = this.ctx, pts = sim.trackPts, b = d.s - 8, a = b - 120;
    ctx.beginPath(); let first = true;
    const put = (S, off) => { const p = this.P(sim.locate(S)), p2 = this.P(sim.locate(S + 0.6)), tl = Math.hypot(p2.x - p.x, p2.y - p.y) || 1;
      const x = p.x - (p2.y - p.y) / tl * off, y = p.y + (p2.x - p.x) / tl * off; if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y); };
    for (let i = 0; i < pts.length; i++) { const S = pts[i].S; if (S >= a) break; put(S, 0); }
    for (let S = Math.max(0, a); S <= d.s; S += 1.5) {
      const f = S < b ? Math.sin(Math.PI * (S - a) / (b - a)) : 0, r = sim.locate(S).seg.r;
      const amp = Math.min(r * 0.9, 0.6 + d.strain * 0.22) * Math.sin(Math.PI * (S - a) / ((b - a) / 2.5));
      put(S, amp * Math.max(0, f));
    }
    put(d.s, 0); ctx.stroke();
  };
  Renderer.prototype.polyStroke = function (pts, w, style) {
    const ctx = this.ctx; ctx.strokeStyle = style; ctx.lineWidth = w; ctx.beginPath();
    pts.forEach((p, i) => { const q = this.P(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
    ctx.stroke();
  };
  // draw a curved tip in 3D (bending from the tangent toward the roll direction) and project it
  Renderer.prototype.curl3D = function (loc, A, L, torque, widthMm, minPx, alpha, frame) {
    const ctx = this.ctx, t = { x: loc.tx, y: loc.ty, z: loc.tz };
    const N = Math.max(8, Math.round(Math.abs(A) / 12));
    let x = loc.x, y = loc.y, z = loc.z;
    ctx.strokeStyle = `rgba(0,0,0,${alpha})`; ctx.lineWidth = Math.max(widthMm, this.px(minPx));
    ctx.beginPath(); let q = this.P({ x, y, z }); ctx.moveTo(q.x, q.y);
    for (let k = 1; k <= N; k++) {
      const d = NIR.anatomy.tipDir(t, A * (k - 0.5) / N, torque, frame);
      x += d.x * L / N; y += d.y * L / N; z += d.z * L / N;
      q = this.P({ x, y, z }); ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  };
  Renderer.prototype.drawJTip = function (W, micro, tip) {
    const sim = this.sim, loc = sim.locate(W.s);
    // the curl is confined to the vessel lumen: its size scales with the vessel radius (never drawn outside the vessel)
    // angled Glidewire / shaped microwire = short single bend; J = 180-ish curl
    let A = tip === 'angled' ? 45 : tip === 'shaped' ? 50 : sim.stalled ? 150 : 120;
    let L = Math.min(micro ? 2.6 : tip === 'angled' ? 4 : 6, 1.6 * loc.seg.r);
    if (loc.seg.r < 1.2) A *= 0.6;
    this.curl3D(loc, A, L, W.torque, sim.wireOD(W.id) * 1.2, micro ? 1.6 : 2, 0.98, 'wire');
  };
  Renderer.prototype.drawCathTip = function (d) {
    const sim = this.sim;
    if (!d.inserted || d.s < 30) return;
    // only free (no wire/inner device protruding) catheter tips show their shape
    if (sim.innerDevices(d).some(o => o.s > d.s - 15)) return;
    const loc = sim.locate(d.s);
    if (loc.seg.r < 3) return;
    const sh = sim.shapeOf(d);
    if (!sh.A) return;
    const A = (NIR.sim.SHAPES[d.shape] || {}).loop ? 330 : sh.A * 1.1;
    this.curl3D(loc, A, sh.L || 6, d.torque, d.od, d.id === 'guide' ? 3 : 2, 0.6);
  };

  // opened stent radius (world mm) at track position S; limited by the vessel lumen, tapered at the ends
  Renderer.prototype.stentR = function (S, a, b, opening) {
    const sim = this.sim, loc = sim.locate(S);
    const K = loc.seg.head && loc.seg.intracranial ? NIR.anatomy.HEAD_K : 1, R = Math.min(loc.seg.r * K * 0.92, sim.srDiam() / 2 * K);
    const tp = clamp((S - a) / (opening ? 4 : 3), opening ? 0.2 : 0.35, 1) * clamp((b - S) / 2.5, 0.35, 1);
    return R * tp;
  };
  Renderer.prototype.offMarker = function (S, off, r) {
    const sim = this.sim, ctx = this.ctx;
    const p = this.P(sim.locate(S)), p2 = this.P(sim.locate(S + 0.5)), tl = Math.hypot(p2.x - p.x, p2.y - p.y) || 1;
    const nx = -(p2.y - p.y) / tl, ny = (p2.x - p.x) / tl;
    ctx.fillStyle = 'rgba(0,0,0,0.95)'; ctx.beginPath(); ctx.arc(p.x + nx * off, p.y + ny * off, Math.max(r, this.px(1.4)), 0, 7); ctx.fill();
  };
  Renderer.prototype.drawStentMesh = function (a, b, opening) {
    const sim = this.sim, ctx = this.ctx;
    const nrm = S => { const p = this.P(sim.locate(S)), p2 = this.P(sim.locate(S + 0.5)), tl = Math.hypot(p2.x - p.x, p2.y - p.y) || 1; return { p, nx: -(p2.y - p.y) / tl, ny: (p2.x - p.x) / tl }; };
    ctx.strokeStyle = 'rgba(15,15,15,0.6)'; ctx.lineWidth = Math.max(0.12, this.px(0.8));
    for (let ph = 0; ph < 2; ph++) {
      ctx.beginPath(); let first = true;
      for (let S = a, k = 0; S <= b + 1e-6; S += 1.6, k++) {
        const q = nrm(S), side = ((k + ph) % 2 ? 1 : -1) * this.stentR(S, a, b, opening);
        const x = q.p.x + q.nx * side, y = q.p.y + q.ny * side;
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // faint outline of the expanded struts
    ctx.strokeStyle = 'rgba(15,15,15,0.25)';
    [-1, 1].forEach(sd => { ctx.beginPath(); let first = true;
      for (let S = a; S <= b + 1e-6; S += 1) { const q = nrm(S), r = sd * this.stentR(S, a, b, opening); const x = q.p.x + q.nx * r, y = q.p.y + q.ny * r; if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y); }
      ctx.stroke(); });
  };

  // balloon-guide balloon (contrast/saline-filled ellipse just behind the guide tip) and the drop-in "pop" ring
  Renderer.prototype.drawExtras = function () {
    const sim = this.sim, ctx = this.ctx, G = sim.devices.guide;
    if (sim.bgcInflated && G.inserted && G.s > 12) {
      const S = G.s - 6, a = this.P(sim.locate(S - 3)), b = this.P(sim.locate(S + 3)), seg = sim.locate(S).seg;
      const ang = Math.atan2(b.y - a.y, b.x - a.x), r = Math.min(seg.r * 0.98, 5);
      ctx.save(); ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2); ctx.rotate(ang);
      ctx.fillStyle = 'rgba(25,25,25,0.55)'; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = this.px(1.2);
      ctx.beginPath(); ctx.ellipse(0, 0, 5.5, r, 0, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    const tp = sim.tipPop;
    if (tp !== this._tp) { this._tp = tp; this._tpT = performance.now(); }
    if (tp && tp.seg && sim.seg(tp.seg) && !this.inset) {
      const age = (performance.now() - this._tpT) / 900;
      if (age < 1) {
        const p = this.P(NIR.anatomy.pointAt(sim.seg(tp.seg), 0));
        const col = tp.kind === 'drop_in' ? '124,252,154' : tp.kind === 'drop_flip' ? '255,207,107' : tp.kind === 'drop_slide' ? '255,154,107' : '159,211,255';
        ctx.save(); ctx.strokeStyle = `rgba(${col},${(1 - age).toFixed(3)})`; ctx.lineWidth = this.px(2.5);
        ctx.beginPath(); ctx.arc(p.x, p.y, this.px(10 + 26 * age), 0, 7); ctx.stroke(); ctx.restore();
      }
    }
  };
  Renderer.prototype.draw = function (dt) {
    const ctx = this.ctx;
    this.resize(); this.frame++;
    const W = this.c.width, H = this.c.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (this.sim.fluoroOn || this.frame < 3) { this.nox = Math.random() * 160; this.noy = Math.random() * 160; }
    // biplane: frontal (AP) tube on the left, lateral tube on the right, imaged simultaneously
    // on a tall/narrow (phone portrait) screen the two planes are shown one at a time (toggle A/B)
    this.biToggle = this.biplane && !this.inset && (W / 2 < H * 0.75 ||
      (this.c.clientWidth < 600 && window.matchMedia && matchMedia('(orientation: portrait)').matches));
    const panes = this.biToggle ? [{ v: this.biShow === 'lat' ? 'lat' : 'ap', x: 0, w: W }]
      : this.biplane ? [{ v: 'ap', x: 0, w: Math.floor(W / 2) - 2 }, { v: 'lat', x: Math.floor(W / 2) + 2, w: W - Math.floor(W / 2) - 2 }]
      : [{ v: this.mainView, x: 0, w: W }];
    panes.forEach(pn => this.drawPane(pn.v, pn.x, pn.w, H, dt));
    if (this.flash > 0) this.flash -= (dt || 0.016) * 1.5;
    this.paneX = 0; this.paneW = W; this.paneH = H; this.applyView(this.mainView); this.cam = this.camFor(this.mainView);
  };

  Renderer.prototype.drawPane = function (view, X, W, H, dt) {
    const sim = this.sim, ctx = this.ctx;
    this.applyView(view); this.cam = this.camFor(view);
    this.paneX = X; this.paneW = W; this.paneH = H;
    this.updateCamera(dt || 0.016);
    // collimated field
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const rad = Math.min(W, H) * 0.12;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(X + 4, 4, W - 8, H - 8, rad); else ctx.rect(X + 4, 4, W - 8, H - 8);
    ctx.clip();
    const dsa = !!sim.run && !sim.run.roadmapCapture;
    ctx.fillStyle = dsa ? '#b9b9b9' : '#8f8f8f'; ctx.fillRect(X, 0, W, H);
    this.worldTransform();
    this.drawBones(dsa);
    this.drawRoadmap();
    if (this.ghost) this.drawGhost();
    this.drawStains();
    this.drawRun();
    this.drawDevices();
    this.drawExtras();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // quantum noise
    if (!this._pat || this._patCtx !== ctx) { this._pat = ctx.createPattern(this.noise, 'repeat'); this._patCtx = ctx; }
    const pat = this._pat;
    { ctx.save(); ctx.globalAlpha = dsa ? 0.05 : (this.lowQuality ? 0.08 : 0.11); ctx.translate(-this.nox || 0, -this.noy || 0); ctx.fillStyle = pat; ctx.fillRect(X, 0, W + 160, H + 160); ctx.restore(); }
    // vignette
    const g = ctx.createRadialGradient(X + W / 2, H / 2, Math.min(W, H) * 0.3, X + W / 2, H / 2, Math.max(W, H) * 0.65);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g; ctx.fillRect(X, 0, W, H);
    if (this.flash > 0) { ctx.fillStyle = `rgba(200,0,0,${0.35 * this.flash})`; ctx.fillRect(X, 0, W, H); }
    ctx.restore();
    // overlays
    const t = NIR.i18n.t, f = Math.round(14 * this.dpr), d = this.dpr;
    if (this.inset) {
      ctx.save(); ctx.font = `bold ${Math.round(11 * d)}px system-ui, sans-serif`; ctx.textBaseline = 'top'; ctx.fillStyle = '#ffd54a'; ctx.textAlign = 'left';
      ctx.fillText(t('inset_lbl') + (this.scale / Math.max(1e-6, this.mainScale || this.scale)).toFixed(1) + ' · ' + t('view_' + this.view), X + 10 * d, 8 * d);
      const bar = 10 * this.scale; ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2 * d; ctx.beginPath(); ctx.moveTo(X + W - 12 * d - bar, H - 12 * d); ctx.lineTo(X + W - 12 * d, H - 12 * d); ctx.stroke();
      ctx.fillStyle = '#ddd'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText('10 mm', X + W - 12 * d, H - 15 * d);
      ctx.restore(); return;
    }
    ctx.save();
    ctx.font = `bold ${f}px system-ui, sans-serif`; ctx.textBaseline = 'top';
    const mode = sim.run ? (sim.run.roadmapCapture ? t('rm') : t('dsa')) : sim.fluoroOn ? t('fluoro_live') : t('lih');
    ctx.fillStyle = sim.run ? '#ffd54a' : sim.fluoroOn ? '#7CFC9A' : '#bbb';
    ctx.textAlign = 'left'; ctx.fillText('● ' + mode, X + 18 * d, 16 * d);
    if (sim.roadmapOn) { ctx.fillStyle = '#9fd3ff'; ctx.fillText(t('rm') + (sim.roadmap ? ' ✓' : ' …'), X + 18 * d, 36 * d); }
    ctx.fillStyle = '#ddd';
    const lat = this.view === 'lat';
    ctx.fillText(lat ? t('orient_A') : t('orient_R'), X + 18 * d, H / 2);
    ctx.textAlign = 'right'; ctx.fillText(lat ? t('orient_P') : t('orient_L'), X + W - 18 * d, H / 2);
    ctx.fillText((this.biplane ? (lat ? t('plane_b') : t('plane_a')) + (this.biToggle ? ' (' + t('bi_toggle_lbl') + ')' : '') + ' · ' : '') + t('view_' + this.view), X + W - 18 * d, 16 * d);
    ctx.fillText(t('arch_' + sim.anat.archType) + ' · ' + t('var_' + sim.anat.variant), X + W - 18 * d, 36 * d);
    // scale bar (intracranial anatomy is displayed magnified; the bar shows true mm)
    const mm = this.headMode ? 10 * NIR.anatomy.HEAD_K : 10;
    const bar = mm * this.scale; ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2 * d;
    ctx.beginPath(); ctx.moveTo(X + W - 20 * d - bar, H - 22 * d); ctx.lineTo(X + W - 20 * d, H - 22 * d); ctx.stroke();
    ctx.font = `${Math.round(11 * d)}px system-ui, sans-serif`; ctx.textBaseline = 'bottom';
    ctx.fillText('10 mm', X + W - 20 * d, H - 26 * d);
    ctx.restore();
  };


  // Out-of-body "true shape" preview of the selective catheter tips (1:1 mm scale bar)
  function drawShapePreview(cv, current) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), r = cv.getBoundingClientRect();
    const Wc = Math.max(200, Math.round(r.width * dpr)), Hc = Math.max(160, Math.round(r.height * dpr));
    if (cv.width !== Wc || cv.height !== Hc) { cv.width = Wc; cv.height = Hc; }
    const g = cv.getContext('2d'), t = NIR.i18n.t, S = NIR.shapes;
    g.setTransform(1, 0, 0, 1, 0, 0); g.direction = 'ltr'; g.fillStyle = '#0d141b'; g.fillRect(0, 0, Wc, Hc);
    const ids = ['bern', 'vert', 'h1', 'vtk', 'sim2'], shaft = 25;
    const shapes = ids.map(id => { const f = S.freeShape(id, { bend: 1, knee: 1 }); const pts = [{ a: -shaft, l: 0 }].concat(f.pts); return { id, f, pts }; });
    // common scale so relative sizes are true
    let maxA = 0, maxL = 0;
    shapes.forEach(sh => { const as = sh.pts.map(p => p.a), ls = sh.pts.map(p => p.l); maxA = Math.max(maxA, Math.max(...as) - Math.min(...as)); maxL = Math.max(maxL, Math.max(...ls) - Math.min(...ls, 0)); });
    const cols = ids.length, cw = Wc / cols, top = 24 * dpr, bot = 40 * dpr;
    const sc = Math.min((Hc - top - bot) / (maxA + 6), (cw - 16 * dpr) / (maxL + 12));
    shapes.forEach((sh, i) => {
      const as = sh.pts.map(p => p.a), ls = sh.pts.map(p => p.l), aMin = Math.min(...as), aMax = Math.max(...as), lMin = Math.min(...ls, 0), lMax = Math.max(...ls);
      const ox = i * cw + (cw - (lMax - lMin) * sc) / 2 - lMin * sc, oy = top + ((Hc - top - bot) - (aMax - aMin) * sc) / 2 + aMax * sc;
      const X = p => ox + p.l * sc, Y = p => oy - p.a * sc;
      if (current === sh.id) { g.fillStyle = 'rgba(255,213,74,0.08)'; g.fillRect(i * cw + 2, 2, cw - 4, Hc - 4); }
      if (S.DEFS[sh.id].reverse && sh.f.kneeIdx != null) { // knee width vs a 25 mm aorta (the formed Simmons loop is wider than the aorta)
        const k = sh.pts[sh.f.kneeIdx + 1], yk = Y(k) - 6 * dpr;
        g.strokeStyle = 'rgba(120,170,220,0.8)'; g.lineWidth = 1.5 * dpr;
        g.beginPath(); g.moveTo(X({ l: 0 }), yk); g.lineTo(X({ l: 25 }), yk); g.stroke();
        g.fillStyle = 'rgba(120,170,220,0.9)'; g.font = `${Math.round(9 * dpr)}px system-ui, sans-serif`; g.textAlign = 'left'; g.textBaseline = 'bottom';
        g.fillText('Ao 25', X({ l: 0 }), yk - 1);
      }
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = '#e6e6e6'; g.lineWidth = Math.max(2, 1.67 * sc);
      g.beginPath(); sh.pts.forEach((p, j) => j ? g.lineTo(X(p), Y(p)) : g.moveTo(X(p), Y(p))); g.stroke();
      const tp = sh.pts[sh.pts.length - 1]; g.fillStyle = '#ffd54a'; g.beginPath(); g.arc(X(tp), Y(tp), Math.max(2.5, 1.2 * sc), 0, 7); g.fill();
      g.fillStyle = '#cfe8ff'; g.font = `bold ${Math.round(12 * dpr)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillText({ bern: 'Bern', vert: 'Vert', h1: 'H1', vtk: 'VTK', sim2: 'Sim 2' }[sh.id], i * cw + cw / 2, 6 * dpr);
      const dsc = S.describe(sh.id); g.font = `${Math.round(10 * dpr)}px system-ui, sans-serif`; g.fillStyle = '#9fb3c8'; g.textBaseline = 'bottom';
      const l1 = dsc.hookAngle ? (dsc.hookAngle + '° hook') : dsc.kneeTurn ? (dsc.kneeTurn + '° knee') : (Math.round(dsc.tipAngle) + '° tip');
      const l2 = dsc.hookAngle ? (Math.round(dsc.limb) + ' mm limb') : dsc.kneeTurn ? (Math.round(dsc.limb) + ' mm · ⌀' + Math.round(dsc.loopWidth)) : (sh.id === 'h1' ? dsc.tipStraight + ' mm tip' : Math.round(dsc.angledSegment) + ' mm');
      g.fillText(l1, i * cw + cw / 2, Hc - 17 * dpr); g.fillText(l2, i * cw + cw / 2, Hc - 5 * dpr);
    });
    // 1 cm scale bar
    g.strokeStyle = '#ddd'; g.lineWidth = 2 * dpr; g.beginPath(); g.moveTo(8 * dpr, top + 4 * dpr); g.lineTo(8 * dpr + 10 * sc, top + 4 * dpr); g.stroke();
    g.fillStyle = '#ddd'; g.textAlign = 'left'; g.textBaseline = 'top'; g.font = `${Math.round(9 * dpr)}px system-ui, sans-serif`; g.fillText('1 cm', 8 * dpr, top + 7 * dpr);
  }
  NIR.drawShapePreview = drawShapePreview;
  NIR.Renderer = Renderer;
})(window.NIR = window.NIR || {});
