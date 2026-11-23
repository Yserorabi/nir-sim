/* NIR-Sim catheter shapes: true distal-curve geometry (mm) and placement of a shaped catheter in the vessel lumen.
   A shape is a "recipe" from the shaft forward: [length mm, turn deg] pieces (turn 0 = straight, >0 bends toward
   the curve side). Reverse-curve catheters (Simmons 2, Vitek) have a knee (secondary curve) that folds ~170° back.
   Proportions follow manufacturer curve charts / published measurements (see README); all values are editable here. */
(function (NIR) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const DEG = Math.PI / 180;

  const DEFS = {
    // guide catheters
    mpd: { recipe: [[6, 25], [8, 0]] },
    h1g: { recipe: [[10, -15], [12, 0], [8, 70], [10, 0]] },
    // Vertebral: straight shaft, single gentle ~40° angle, ~2.5 cm angled segment
    vert: { recipe: [[8, 40], [18, 0]], name: 'Vertebral (Vert)' },
    // Berenstein: short ~35° angle
    bern: { recipe: [[6, 35], [14, 0]] },
    // Headhunter H1: small reverse primary bend, straight segment, then a ~1.5 cm hockey-stick tip (net ~65°)
    h1: { recipe: [[12, -20], [20, 0], [8, 85], [15, 0]], name: 'Headhunter (H1)' },
    // Vitek: reverse curve with a large-radius secondary curve (~18 mm loop), short limb and short angled tip
    vtk: { recipe: [[27, 172], [25, 0], [6, 45], [6, 0]], reverse: true, knee: 0, limb: 1, name: 'Vitek (VTK)' },
    // Simmons 2 / Sidewinder 2: shepherd's crook knee (~30 mm wide, wider than the aorta), long limb folding back
    // alongside the shaft (~7 cm), small tip angled in the same direction as the reverse curve
    sim2: { recipe: [[46, 176], [70, 0], [6, 20], [8, 0]], reverse: true, knee: 0, limb: 1, name: 'Simmons 2 (Sidewinder 2)' },
    // Pigtail
    pig: { recipe: [[4, 0], [30, 340]] }
  };

  // 2D free shape (a = along the shaft axis, l = lateral). opts.bend scales every turn (wire straightening),
  // opts.knee scales the reverse knee (forming 0..1).
  function freeShape(id, opts) {
    const def = DEFS[id] || DEFS.mpd; opts = opts || {};
    const bend = opts.bend == null ? 1 : opts.bend, kneeF = opts.knee == null ? 1 : opts.knee;
    let a = 0, l = 0, h = 0; const pts = [{ a, l, h: 0 }]; let kneeIdx = -1, kneeA = 0;
    def.recipe.forEach((pc, i) => {
      let [len, turn] = pc;
      if (def.reverse && i === def.knee) turn *= kneeF; else turn *= bend;
      const n = Math.max(2, Math.ceil(len / 1));
      for (let k = 0; k < n; k++) {
        const hm = h + turn * DEG * (k + 0.5) / n;
        a += Math.cos(hm) * len / n; l += Math.sin(hm) * len / n;
        pts.push({ a, l, h: hm });
      }
      h += turn * DEG;
      if (def.reverse && i === def.knee) { kneeIdx = pts.length - 1; }
    });
    pts.forEach((p, i) => { if (i <= (kneeIdx < 0 ? pts.length : kneeIdx) && p.a > kneeA) kneeA = p.a; });
    return { pts, kneeIdx, kneeA, endHeading: h / DEG, length: def.recipe.reduce((s, p) => s + p[0], 0) };
  }
  // Measured descriptors of the free shape (used by tests and the preview panel)
  function describe(id) {
    const f = freeShape(id), def = DEFS[id];
    const ls = f.pts.map(p => p.l);
    const out = { length: f.length, tipAngle: f.endHeading, width: Math.max(...ls) - Math.min(...ls) };
    if (def.reverse) { out.loopWidth = f.pts[f.kneeIdx].l; out.limb = def.recipe[def.limb][0]; out.kneeTurn = def.recipe[def.knee][1]; }
    const R = def.recipe, last = R[R.length - 1];
    out.tipStraight = last[1] === 0 ? last[0] : 0;
    let j = R.length - 1; while (j > 0 && R[j][1] === 0) j--; // last bend
    out.angledSegment = R.slice(j).reduce((a, p) => a + p[0], 0);
    out.reverseBend = R.some(p => p[1] < 0);
    return out;
  }

  // ---------- placement in the vessel ----------
  const V = {
    sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }), add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
    mul: (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k }), dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
    norm: a => { const L = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / L, y: a.y / L, z: a.z / L }; }
  };
  const perp = (n, t) => V.norm(V.sub(n, V.mul(t, V.dot(n, t))));

  // A path: list of samples {S, x,y,z, tx,ty,tz, r}. Interpolate.
  function samplePath(path, u) {
    const n = path.length; if (!n) return null;
    if (u <= path[0].S) return Object.assign({}, path[0], extra(path, 0, u - path[0].S));
    if (u >= path[n - 1].S) return Object.assign({}, path[n - 1], extra(path, n - 1, u - path[n - 1].S));
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (path[m].S <= u) lo = m; else hi = m; }
    const A = path[lo], B = path[hi], f = (u - A.S) / ((B.S - A.S) || 1);
    return { S: u, x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f, z: A.z + (B.z - A.z) * f, tx: A.tx, ty: A.ty, tz: A.tz, r: A.r + (B.r - A.r) * f };
  }
  function extra(path, i, du) { const p = path[i]; return { S: p.S + du, x: p.x + p.tx * du, y: p.y + p.ty * du, z: p.z + p.tz * du }; }

  function trackPath(sim, from, to) {
    const out = [], step = 2;
    for (let u = Math.max(0, from); u < to; u += step) out.push(sampleTrack(sim, u));
    out.push(sampleTrack(sim, Math.max(0, to)));
    return out;
  }
  function sampleTrack(sim, u) { const L = sim.locate(u); return { S: u, x: L.x, y: L.y, z: L.z, tx: L.tx, ty: L.ty, tz: L.tz, r: L.seg.r, seg: L.seg.id }; }

  // aortic continuation beyond junction index i (the path the loop of a reverse curve occupies)
  function aorticContinuation(sim, i, maxLen) {
    const parent = sim.seg(sim.track[i - 1]), P = sim.trackOff[i];
    const out = []; let acc = 0; let seg = parent.children.map(k => sim.seg(k)).find(s => s.aortic && s.id !== sim.track[i]);
    while (seg && acc < maxLen) {
      for (let k = 1; k < seg.pts.length; k++) {
        const a = seg.pts[k - 1], b = seg.pts[k], d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1e-6;
        acc += d; out.push({ S: P + acc, x: b.x, y: b.y, z: b.z, tx: (b.x - a.x) / d, ty: (b.y - a.y) / d, tz: (b.z - a.z) / d, r: seg.r, seg: seg.id });
        if (acc >= maxLen) break;
      }
      seg = seg.children.map(k => sim.seg(k)).find(s => s.aortic);
    }
    return out;
  }
  function contLength(sim, i) { const c = aorticContinuation(sim, i, 400); return c.length ? c[c.length - 1].S - sim.trackOff[i] : 0; }

  // lateral reference for the curve plane: perpendicular to t, rolled by the catheter torque
  function rollNormal(t, torque) { return NIR.anatomy.tipDir(t, 90, torque).d; }

  // Place a 2D shape on a path so that the point with along-coordinate `anchorA` sits at path position uAnchor.
  // Lateral offsets are fitted into the lumen (compressed and shifted against the wall), the shaft ramps over.
  function placeShape(path, shape, uAnchor, anchorA, n0, od) {
    const sStart = uAnchor - anchorA;
    let lmin = 0, lmax = 0, Rm = 1e9;
    shape.pts.forEach(p => { lmin = Math.min(lmin, p.l); lmax = Math.max(lmax, p.l); const s = samplePath(path, sStart + p.a); Rm = Math.min(Rm, Math.max(0.2, s.r - od / 2)); });
    const k = Math.min(1, (2 * Rm) / Math.max(1e-6, lmax - lmin));
    const lo = lmin * k, hi = lmax * k;
    const shift = hi > Rm ? Rm - hi : lo < -Rm ? -Rm - lo : 0;
    const pts = [];
    // shaft along the centerline, ramping onto the wall over 30 mm
    const sh0 = samplePath(path, 0).S;
    for (let u = Math.max(sh0, 0); u < sStart; u += 2) {
      const s = samplePath(path, u), t = { x: s.tx, y: s.ty, z: s.tz }, n = perp(n0, t);
      const ramp = clamp((u - (sStart - 30)) / 30, 0, 1);
      pts.push(V.add(s, V.mul(n, shift * ramp)));
    }
    shape.pts.forEach(p => {
      const s = samplePath(path, sStart + p.a), t = { x: s.tx, y: s.ty, z: s.tz }, n = perp(n0, t);
      pts.push(V.add(s, V.mul(n, p.l * k + shift)));
    });
    return { pts, k, shift, Rm };
  }

  // Full catheter polyline (world 3D) for a shaped catheter device in the current sim state.
  function catheterPolyline(sim, d) {
    const id = d.shape || 'mpd', def = DEFS[id] || DEFS.mpd;
    const od = d.od || 1.67, W = sim.devices.mwire && sim.devices.mwire.inserted && !sim.devices.wire.inserted ? sim.devices.mwire : sim.devices.wire;
    if (!d.inserted || d.s < 1) return { pts: [], tip: null, mode: 'none' };
    // engaged reverse curve (tip in a branch, loop in the arch) or LSA-technique forming
    const J = sim.engagedJunction ? sim.engagedJunction(d) : null;
    const rev = def.reverse;
    if (rev && J && (d.formed || (d.formTech === 'lsa' && d.form > 0))) {
      const knee = d.formed ? d.knee : d.form * (d.kneeMax || 60);
      return loopIntoBranch(sim, d, J, Math.max(0, knee), od, id);
    }
    const path = trackPath(sim, 0, d.s + 2);
    const tail = samplePath(path, d.s), t0 = { x: tail.tx, y: tail.ty, z: tail.tz };
    let n0 = rollNormal(t0, d.torque || 0);
    if (rev) {
      let kneeF = d.formed ? 1 : (d.form || 0);
      const unformedKnee = 0.12;
      kneeF = Math.max(unformedKnee, kneeF);
      const shp = freeShape(id, { knee: kneeF, bend: 1 });
      const anchor = kneeF > 0.55 ? shp.kneeA : shp.pts[shp.pts.length - 1].a;
      const pl = placeShape(path, shp, d.s, anchor, n0, od);
      return { pts: pl.pts, tip: pl.pts[pl.pts.length - 1], mode: kneeF >= 0.99 ? 'formed' : kneeF > unformedKnee ? 'forming' : 'unformed', fit: pl };
    }
    // non-reverse: straightened by a wire inside the curve
    const curveLen = def.recipe.reduce((s, p) => s + p[0], 0);
    let st = 0;
    if (W.inserted && W.s > d.s - curveLen) st = W.s > d.s + 25 ? 1 : clamp((W.s - (d.s - curveLen)) / curveLen, 0, 1) * 0.85;
    const inner = ['inter', 'micro', 'diag'].some(k => k !== d.id && sim.devices[k].inserted && sim.devices[k].rank > d.rank && sim.devices[k].s > d.s - 5);
    if (inner) st = 1;
    const shp = freeShape(id, { bend: 1 - st });
    const pl = placeShape(path, shp, d.s, shp.pts[shp.pts.length - 1].a, n0, od);
    return { pts: pl.pts, tip: pl.pts[pl.pts.length - 1], mode: st > 0.95 ? 'straight' : 'shaped', fit: pl, straighten: st };
  }

  // shaft up the aorta, knee advanced `knee` mm beyond the branch origin along the aorta, limb back to the origin
  // hugging the wall on the branch side, tip hooking up into the branch to the device tip position.
  function loopIntoBranch(sim, d, J, knee, od, id) {
    const P = J.P, i = J.i;
    const cont = aorticContinuation(sim, i, Math.max(knee + 5, 10));
    const base = trackPath(sim, 0, P);
    const path = base.concat(cont);
    const branch = sim.seg(sim.track[i]);
    const s0 = samplePath(path, P), tA = { x: s0.tx, y: s0.ty, z: s0.tz };
    const bdir = NIR.anatomy.startDir(branch);
    let n0 = perp(bdir, tA);
    const maxKnee = cont.length ? cont[cont.length - 1].S - P : 0;
    knee = Math.min(knee, maxKnee);
    const hFree = id === 'sim2' ? 15 : 9;
    const pts = [];
    const Rat = u => Math.max(0.3, samplePath(path, u).r - od / 2);
    const h = Math.min(hFree, Rat(P + knee * 0.5), Rat(P));
    const at = (u, l) => { const s = samplePath(path, u), t = { x: s.tx, y: s.ty, z: s.tz }, n = perp(n0, t); return V.add(s, V.mul(n, l)); };
    for (let u = 0; u < P; u += 2) pts.push(at(u, -h * clamp((u - (P - 30)) / 30, 0, 1)));
    const hk = Math.min(h, Math.max(2, knee / 1.3));
    const uc = P + Math.max(0, knee - hk);
    for (let u = P; u < uc; u += 2) pts.push(at(u, -hk * (hk < h ? 1 : 1)));
    for (let th = 0; th <= Math.PI + 1e-6; th += Math.PI / 16) pts.push(at(uc + hk * Math.sin(th), -hk * Math.cos(th)));
    for (let u = uc; u > P + 2; u -= 2) pts.push(at(u, hk));
    // tip: Bezier from the limb end into the branch
    const S = at(P + 2, hk), C = at(P, hk + 4), L = sim.locate(d.s), B = { x: L.x, y: L.y, z: L.z };
    for (let k = 1; k <= 10; k++) { const t = k / 10, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t; pts.push({ x: a * S.x + b * C.x + c * B.x, y: a * S.y + b * C.y + c * B.y, z: a * S.z + b * C.z + c * B.z }); }
    return { pts, tip: B, mode: d.formed ? 'engaged' : 'forming', knee, h: hk };
  }

  NIR.shapes = { DEFS, freeShape, describe, catheterPolyline, aorticContinuation, contLength };
})(window.NIR = window.NIR || {});
