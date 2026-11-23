/* NIR-Sim engine: device chain on vessel centerlines, contrast, clots, thrombectomy, complications, metrics. */
(function (NIR) {
  'use strict';
  const A = NIR.anatomy;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = () => NIR.sim.rng();

  // Coaxial rank: lower = outer
  const DEVICE_DEFS = {
    guide: { kind: 'catheter', rank: 0, od: 2.7, len: 1000, key: 'dev_guide', short: 'dev_guide_s', shape: 'mpd' },   // 8F guide
    diag: { kind: 'catheter', rank: 1, od: 1.67, len: 1250, key: 'dev_diag', short: 'dev_diag_s', shape: 'vert' },    // 5F shaped selective catheter
    inter: { kind: 'catheter', rank: 1, od: 2.1, len: 1150, key: 'dev_inter', short: 'dev_inter_s' },   // 6F 0.071" aspiration
    micro: { kind: 'catheter', rank: 2, od: 0.9, len: 1600, key: 'dev_micro', short: 'dev_micro_s' },   // 0.021" microcatheter
    wire: { kind: 'wire', rank: 3, od: 0.89, len: 1500, key: 'dev_wire', short: 'dev_wire_s' },          // GUIDEWIRE 0.035"/0.038" (arch/neck)
    mwire: { kind: 'wire', rank: 3, od: 0.36, len: 2000, key: 'dev_mwire', short: 'dev_mwire_s', micro: true }, // MICROWIRE 0.014-0.024" (through the microcatheter)
    sr: { kind: 'sr', rank: 3, od: 0.6, len: 1800, key: 'dev_sr', short: 'dev_sr_s', stentLen: 30, stentD: 4 }
  };
  const DEVICE_ORDER = ['guide', 'diag', 'inter', 'micro', 'wire', 'mwire', 'sr'];
  // Lumen (ID) and outer diameter (OD) in inches for coaxial compatibility. Rule: inner OD + 0.002" <= outer ID.
  const LUMEN_IN = { guide: 0.088, diag: 0.040, inter: 0.071 }; // 5F selective: 0.038"-wire compatible (~0.040" lumen)
  const OD_IN = { guide: 0.105, diag: 0.065, inter: 0.083 };
  const MICRO_SIZES = { '017': { id: 0.017, od: 0.72 }, '021': { id: 0.021, od: 0.85 }, '027': { id: 0.027, od: 1.05 } }; // od in mm
  const MWIRE_SIZES = { '014': 0.014, '018': 0.018, '024': 0.024 };          // microwire OD (inch)
  // Guidewires (arch / neck): angled hydrophilic (Glidewire), J-tip, and a stiff exchange-length wire for exchanges.
  // A guidewire never fits a microcatheter (0.035" > 0.027" lumen).
  const GWIRE_TYPES = {
    '035a': { od: 0.035, tip: 'angled', len: 150, steer: 1, stiff: false },
    '035j': { od: 0.035, tip: 'j', len: 150, steer: 0.85, stiff: false },
    '038a': { od: 0.038, tip: 'angled', len: 150, steer: 0.95, stiff: false },
    '038j': { od: 0.038, tip: 'j', len: 150, steer: 0.8, stiff: false },
    '035x': { od: 0.035, tip: 'j', len: 300, steer: 0.45, stiff: true, exchange: true }  // Amplatz / Rosen 260-300 cm
  };
  // Stent retrievers: d = nominal diameter (mm), len = stent length in world units (intracranial geometry is magnified),
  // minMicro = minimum microcatheter ID (inch) it can be delivered through.
  const SR_SIZES = { '3x20': { d: 3, len: 32, minMicro: 0.017 }, '4x30': { d: 4, len: 48, minMicro: 0.021 }, '6x30': { d: 6, len: 48, minMicro: 0.027 } };
  const FIT_MARGIN = 0.002;
  // Catheter tip shapes. A = effective tip angle (deg, incl. wire assist) that the wire exits at; tol = how far off a
  // branch take-off may be and still be engaged; beyond 0.8*tol the wire tends to prolapse back ("struggles").
  const SHAPES = {
    mpd: { A: 25, tol: 35, L: 6, guide: true },     // multipurpose / straight-ish guide
    h1g: { A: 75, tol: 42, L: 10, guide: true },    // H1-shaped guide
    vert: { A: 62, tol: 45, L: 8 },                 // vertebral (angled)
    bern: { A: 45, tol: 40, L: 8 },                 // Berenstein
    h1: { A: 85, tol: 45, L: 12 },                  // Headhunter H1
    vtk: { A: 120, tol: 45, L: 15 },                // Vitek (VTK) – reverse curve, self-forming
    sim2: { A: 150, tol: 40, L: 26, needsForm: true }, // Simmons 2 – reverse curve, must be formed
    pig: { A: 0, tol: 30, L: 10, loop: true }       // pigtail (arch aortogram)
  };
  const GUIDE_SHAPES = ['mpd', 'h1g'], DIAG_SHAPES = ['vert', 'bern', 'h1', 'vtk', 'sim2', 'pig'];
  const SPEED = 14;        // mm/s normal
  const FAST = 3.2;        // multiplier with Shift
  const FLOW_V = 170;      // contrast front mm/s
  const MAX_DEFLECT = 62;  // deg, J-tip lateral deflection at full torque
  const STALL_ERR = 50;    // deg, bifurcation selection tolerance

  function Sim(opts) {
    this.archOpts = { archType: 'I', variant: 'normal' };
    this.anat = A.build(this.archOpts);
    this.shapes = { guide: 'mpd', diag: 'vert' };
    this.sizes = { micro: '021', mwire: '014', gwire: '035a', sr: '4x30', asp: '071', guide: '088' };
    this.settings = { hangups: true };
    this.listeners = [];
    this.reset(opts && opts.scenario);
  }

  Sim.prototype.reset = function (scenario, archOpts) {
    this.scenario = scenario || null;
    if (archOpts) this.archOpts = Object.assign({}, this.archOpts, archOpts);
    // a scenario may impose anatomy (e.g. the tortuous-siphon case) without changing the user's selection
    this.anatOpts = Object.assign({}, this.archOpts, (scenario && scenario.anat) || {});
    this.anat = A.build(this.anatOpts);
    this.selections = []; this.engagedSets = {}; this.selStats = { prolapse: 0, shapeStall: 0 };
    this.time = 0; this.fluoroTime = 0; this.contrast = 0; this.bloodLoss = 0;
    this.passes = 0; this.passResults = []; this.firstPassTici = null; this.reperfTime = null;
    this.complications = []; this.warnFlags = {}; this.log = [];
    this.track = [this.anat.root]; this.rebuildTrack();
    this.devices = {};
    DEVICE_ORDER.forEach(id => {
      const d = DEVICE_DEFS[id];
      this.devices[id] = { id, kind: d.kind, rank: d.rank, od: d.od, inserted: false, s: 0, torque: 0,
        deployed: false, dS0: 0, dS1: 0, deployTime: 0, subtype: null, wallImpact: 0, shape: this.shapes[id] || null, formed: false };
    });
    this.active = 'guide';
    this.clots = [];
    this.aspiration = false; this.engagedTime = 0; this.corked = false;
    this.perforations = []; this.dissections = []; this.caseEndAt = null; this.advLatch = null;
    this.dissRisk = 0; this.spasm = 0; this.endPush = 0; this.wallPush = 0; this.stalled = false;
    this.hangStats = { attempts: 0, hangs: 0, freed: [] }; this.prolapsed = false; this.guideBack = 0;
    this.run = null; this.roadmapOn = false; this.roadmap = null; this.lastRun = null;
    this.fluoroHold = 0; this.pedal = false; this.input = { adv: 0, rot: 0, fast: false, unsheath: 0, fluff: 0 };
    this.anim = null; this.finished = false; this.goals = [];
    this.lastTici = null;
    if (scenario && scenario.setup) scenario.setup(this);
    this.emit('reset');
  };

  Sim.prototype.on = function (fn) { this.listeners.push(fn); };
  Sim.prototype.emit = function (ev, data) { this.listeners.forEach(f => f(ev, data)); };
  Sim.prototype.msg = function (level, key, params) {
    const m = { level, key, params: params || {}, time: this.time };
    this.log.push(m); this.emit('log', m);
  };
  Sim.prototype.warnOnce = function (flag, level, key, params) {
    if (this.warnFlags[flag]) return; this.warnFlags[flag] = true; this.msg(level, key, params);
  };
  Sim.prototype.addComplication = function (type, params) {
    if (type !== 'perforation' && this.complications.some(c => c.type === type)) return;
    this.complications.push({ type, time: this.time, params: params || {} });
    this.msg('danger', 'comp_' + type, params);
    this.emit('complication', type);
  };

  // ---------- Track ----------
  Sim.prototype.seg = function (id) { return this.anat.segs[id]; };
  Sim.prototype.rebuildTrack = function () {
    this.trackOff = []; let o = 0;
    this.track.forEach(id => { this.trackOff.push(o); o += this.seg(id).len; });
    this.trackLen = o;
    // flattened points for rendering devices
    const pts = [];
    this.track.forEach((id, i) => {
      const sg = this.seg(id), off = this.trackOff[i];
      sg.pts.forEach((p, k) => { if (i > 0 && k === 0) return; pts.push({ x: p.x, y: p.y, z: p.z, S: off + p.s }); });
    });
    this.trackPts = pts;
  };
  Sim.prototype.locate = function (S) {
    S = clamp(S, 0, this.trackLen);
    let i = this.track.length - 1;
    while (i > 0 && this.trackOff[i] > S) i--;
    // a point exactly on a junction belongs to the parent segment
    if (i > 0 && Math.abs(this.trackOff[i] - S) < 1e-9) i--;
    const seg = this.seg(this.track[i]);
    const local = S - this.trackOff[i];
    const p = A.pointAt(seg, local);
    return { i, seg, local, x: p.x, y: p.y, z: p.z, tx: p.tx, ty: p.ty, tz: p.tz };
  };
  Sim.prototype.offsetOf = function (segId) {
    const i = this.track.indexOf(segId); return i < 0 ? null : this.trackOff[i];
  };
  Sim.prototype.maxTip = function () {
    let m = 0; DEVICE_ORDER.forEach(id => { const d = this.devices[id]; if (d.inserted) m = Math.max(m, d.s); }); return m;
  };
  Sim.prototype.trimTrack = function () {
    const m = this.maxTip(); let changed = false;
    while (this.track.length > 1 && this.trackOff[this.track.length - 1] >= m - 1e-6) { this.track.pop(); this.trackOff.pop(); changed = true; }
    if (changed) this.rebuildTrack();
  };
  Sim.prototype.setTrackTo = function (segId) {
    this.track = this.seg(segId).chain.slice(); this.rebuildTrack();
  };
  Sim.prototype.placeDevice = function (devId, segId, local, extra) {
    if (this.track.indexOf(segId) < 0) this.setTrackTo(segId);
    const d = this.devices[devId]; d.inserted = true; d.s = this.offsetOf(segId) + local;
    if (devId === 'guide' || devId === 'inter') d.od = this.devOD(d);
  };

  // ---------- Devices ----------
  Sim.prototype.gwireType = function () { return GWIRE_TYPES[this.sizes.gwire] || GWIRE_TYPES['035a']; };
  Sim.prototype.wireOD = function (id) { return id === 'mwire' ? MWIRE_SIZES[this.sizes.mwire] * 25.4 : this.gwireType().od * 25.4; };
  Sim.prototype.devOD = function (d) {
    if (d.id === 'wire' || d.id === 'mwire') return this.wireOD(d.id);
    if (d.id === 'micro') return MICRO_SIZES[this.sizes.micro].od;
    if (d.id === 'inter') return ASP_SIZES[this.sizes.asp].od * 25.4;
    if (d.id === 'guide') return GUIDE_SIZES[this.sizes.guide].od * 25.4;
    return d.od;
  };
  Sim.prototype.lumenIn = function (id) {
    if (id === 'micro') return MICRO_SIZES[this.sizes.micro].id;
    if (id === 'inter') return ASP_SIZES[this.sizes.asp].id;
    if (id === 'guide') return GUIDE_SIZES[this.sizes.guide].id;
    return LUMEN_IN[id] || 0;
  };
  Sim.prototype.odIn = function (id, subtype) {
    if (id === 'micro') return MICRO_SIZES[this.sizes.micro].od / 25.4;
    if (id === 'wire') return this.gwireType().od;
    if (id === 'mwire') return MWIRE_SIZES[this.sizes.mwire];
    if (id === 'inter') return ASP_SIZES[this.sizes.asp].od;
    if (id === 'guide') return GUIDE_SIZES[this.sizes.guide].od;
    return OD_IN[id] || 0;
  };
  // Returns null if device `id` fits coaxially with what is already inserted, else a denial {key, params}
  Sim.prototype.fitCheck = function (id, subtype) {
    const d = this.devices[id];
    const outers = this.outerDevices(d).filter(o => o.kind === 'catheter');
    if (outers.length) {
      const o = outers.reduce((a, b) => (b.rank > a.rank ? b : a));
      if (id === 'sr') {
        const need = SR_SIZES[this.sizes.sr].minMicro;
        if (o.id !== 'micro' || this.lumenIn('micro') + 1e-9 < need) return { key: 'sr_needs_micro', params: { sr: this.sizes.sr, need: need.toFixed(3).slice(1), have: this.lumenIn(o.id).toFixed(3).slice(1) } };
      } else if (this.odIn(id, subtype) + FIT_MARGIN > this.lumenIn(o.id) + 1e-9) {
        return { key: 'no_fit', params: { dev: id, outer: o.id, od: this.odIn(id, subtype).toFixed(3).slice(1), id: this.lumenIn(o.id).toFixed(3).slice(1) } };
      }
    }
    if (d.kind === 'catheter') {
      for (const inner of this.innerDevices(d)) {
        if (inner.kind === 'sr') continue;
        if (this.odIn(inner.id) + FIT_MARGIN > this.lumenIn(id) + 1e-9) return { key: 'no_fit', params: { dev: inner.id, outer: id, od: this.odIn(inner.id).toFixed(3).slice(1), id: this.lumenIn(id).toFixed(3).slice(1) } };
      }
    }
    return null;
  };
  Sim.prototype.setSize = function (kind, val) {
    const tab = kind === 'micro' ? MICRO_SIZES : kind === 'mwire' ? MWIRE_SIZES : kind === 'gwire' ? GWIRE_TYPES : kind === 'sr' ? SR_SIZES : kind === 'asp' ? ASP_SIZES : kind === 'guide' ? GUIDE_SIZES : null;
    if (!tab || !(val in tab)) return false;
    const dev = kind === 'gwire' ? this.devices.wire : kind === 'asp' ? this.devices.inter : this.devices[kind];
    // the (pre-placed) guide can be exchanged while it is empty
    const emptyGuide = kind === 'guide' && dev && dev.inserted && !this.innerDevices(dev).length;
    if (dev && dev.inserted && !emptyGuide) { this.msg('warn', 'size_locked'); return false; }
    this.sizes[kind] = val; if (emptyGuide) dev.od = this.devOD(dev); this.emit('change'); return true;
  };
  // ---- stent retriever geometry ----
  Sim.prototype.srLen = function () { const S = this.devices.sr; return SR_SIZES[S.size || this.sizes.sr].len; };
  Sim.prototype.srDiam = function () { const S = this.devices.sr; return SR_SIZES[S.size || this.sizes.sr].d; };
  // mm of stent outside the microcatheter (open)
  Sim.prototype.srExposed = function () {
    const S = this.devices.sr, M = this.devices.micro;
    if (!S.inserted) return 0;
    if (!M.inserted) return this.srLen();
    return clamp(S.s - M.s, 0, this.srLen());
  };
  // Workflow phase for hints / HUD
  Sim.prototype.srPhase = function () {
    const S = this.devices.sr, M = this.devices.micro, W = this.devices.mwire;
    if (S.inserted) {
      if (S.deployed) return this.time - S.deployTime < 180 ? 'integrate' : 'retrieve';
      const e = this.srExposed();
      if (e > 0.5) return 'unsheathing';
      return M.s - S.s > 1.5 ? 'advance_sr' : 'at_tip';
    }
    if (!M.inserted) return 'need_micro';
    const across = this.clotsOnTrack().some(o => M.s > o.S1 + 6);
    if (!across) return 'cross';
    if (W.inserted) return 'remove_wire';
    return 'insert_sr';
  };
  Sim.prototype.innerDevices = function (d) {
    return DEVICE_ORDER.map(id => this.devices[id]).filter(o => o.inserted && o.rank > d.rank);
  };
  Sim.prototype.outerDevices = function (d) {
    return DEVICE_ORDER.map(id => this.devices[id]).filter(o => o.inserted && o.rank < d.rank);
  };
  Sim.prototype.isLeading = function (d) {
    return DEVICE_ORDER.every(id => { const o = this.devices[id]; return !o.inserted || o === d || o.s <= d.s + 1e-6; });
  };

  Sim.prototype.insert = function (id) {
    if (this.anim || this.finished) return false;
    const d = this.devices[id], D = this.devices;
    if (d.inserted) return false;
    const deny = k => { this.msg('warn', k); return false; };
    if (id === 'diag') {
      if (D.inter.inserted || D.micro.inserted || D.sr.inserted) return deny('remove_inner_first');
    }
    if (id === 'inter') {
      if (!D.guide.inserted) return deny('need_guide');
      if (D.diag.inserted) return deny('remove_diag_first');
      if (D.micro.inserted || D.sr.inserted) return deny('triaxial_order');
    }
    if (id === 'micro') {
      if (!D.guide.inserted) return deny('need_guide');
      if (D.sr.inserted) return deny('remove_inner_first');
      if (D.wire.inserted) return deny('remove_gwire_first'); // triaxial work: the guidewire comes out first
    }
    if (id === 'wire') {
      if (D.micro.inserted || D.sr.inserted) return deny('gwire_not_micro'); // a 0.035/0.038" wire never fits a microcatheter
      if (D.mwire.inserted) return deny('remove_mwire_first');
    }
    if (id === 'mwire') {
      if (D.sr.inserted) return deny('sr_in_micro');
      if (D.wire.inserted) return deny('remove_gwire_first');
    }
    if (id === 'sr') {
      if (!D.micro.inserted) return deny('need_micro');
      if (D.mwire.inserted) return deny('remove_mwire_first');
    }
    const fit = this.fitCheck(id, null);
    if (fit) { this.msg('warn', fit.key, fit.params); return false; }
    if (id === 'mwire' && !D.micro.inserted) { this.warnOnce('mwnomicro', 'warn', 'mwire_no_micro'); this.selStats.mwireMisuse = (this.selStats.mwireMisuse || 0) + 1; }
    if (id === 'sr') { d.size = this.sizes.sr; d.tipLatch = false; d.unsheath = 0; d.pushOut = 0; d.fluff = 0; d.exposedAt = null; d.target = null; }
    // start just inside the innermost outer catheter tip (fast-loaded)
    const outers = this.outerDevices(d).filter(o => o.kind === 'catheter');
    let start = 0;
    if (outers.length) {
      const inner = outers.reduce((a, b) => (b.rank > a.rank ? b : a));
      start = Math.max(0, inner.s - (id === 'sr' ? 25 : 8));
    }
    d.inserted = true; d.s = start; d.torque = 0; d.deployed = false; d.formed = false; d.hung = false; d.strain = 0; d.passedZone = false; d.rotT = -9;
    if (id === 'inter' || id === 'guide') d.od = this.devOD(d); d.form = 0; d.formTech = null; d.knee = 0; d.kneeMax = 0; d.over = 0;
    if (this.shapes[id]) d.shape = this.shapes[id];
    if (id !== 'sr' || !this.active) this.active = id;
    this.active = id;
    this.time += start > 50 ? 15 : 5;
    this.msg('info', 'inserted', { dev: id });
    this.bumpFluoro();
    this.emit('change');
    return true;
  };

  Sim.prototype.remove = function (id) {
    if (this.anim || this.finished) return false;
    const d = this.devices[id];
    if (!d.inserted) return false;
    if (d.kind === 'catheter') {
      const inner = this.innerDevices(d);
      // exchange: an exchange-length (260-300 cm) guidewire stays in place while the catheter is pulled off it
      const exch = inner.length === 1 && inner[0].id === 'wire' && this.gwireType().exchange && !this.outerDevices(d).length;
      if (inner.length && !exch) { this.msg('warn', inner.length === 1 && inner[0].id === 'wire' ? 'need_exchange_wire' : 'remove_inner_first'); return false; }
      if (exch) this.msg('good', 'exchange_done', { dev: id });
    }
    if (d.id === 'sr' && (d.deployed || this.srExposed() > 0.5)) { this.msg('warn', 'sr_deployed_retrieve'); return false; }
    if (d.id === 'inter' && this.aspiration) this.setAspiration(false);
    d.inserted = false; d.s = 0; d.deployed = false;
    this.time += 8;
    this.trimTrack();
    this.msg('info', 'removed', { dev: id });
    const next = DEVICE_ORDER.slice().reverse().find(k => this.devices[k].inserted);
    if (this.active === id) this.active = next || 'guide';
    this.emit('change');
    return true;
  };

  // Load the triaxial system through the guide in the correct order: aspiration catheter > microcatheter > microwire
  Sim.prototype.loadTriaxial = function () {
    const D = this.devices;
    if (!D.guide.inserted) { this.msg('warn', 'need_guide'); return false; }
    if (D.diag.inserted) { this.msg('warn', 'remove_diag_first'); return false; }
    if (D.wire.inserted) { this.msg('warn', 'remove_035_first'); return false; }
    for (const id of ['inter', 'micro', 'mwire']) {
      if (D[id].inserted) continue;
      const fit = this.fitCheck(id, null);
      if (fit) { this.msg('warn', fit.key, fit.params); return false; }
      if (!this.insert(id)) return false;
    }
    this.active = 'mwire'; this.msg('good', 'triaxial_loaded'); this.emit('change');
    return true;
  };

  Sim.prototype.setActive = function (id) { this.active = id; this.emit('change'); };

  Sim.prototype.bumpFluoro = function () { this.fluoroHold = 0.45; };

  Sim.prototype.setShape = function (id, shape) {
    const list = id === 'guide' ? GUIDE_SHAPES : DIAG_SHAPES;
    if (!list.includes(shape) || this.devices[id].inserted) return false;
    this.shapes[id] = shape; this.devices[id].shape = shape; this.emit('change'); return true;
  };
  Sim.prototype.shapeOf = function (c) {
    if (c.id === 'guide' || c.id === 'diag') {
      const sh = SHAPES[c.shape] || SHAPES.mpd;
      if (sh.needsForm && !c.formed) return { A: 20, tol: 35, L: 6, unformed: true };
      return sh;
    }
    if (c.id === 'inter') return { A: 10, tol: 30, L: 4 };
    if (c.id === 'micro') return { A: 30, tol: 40, L: 3 };
    return { A: 0, tol: 30, L: 0 };
  };
  // What steers at a bifurcation: a wire exiting a shaped catheter tip (within 25 mm) is aimed by that catheter
  Sim.prototype.selectorFor = function (d) {
    if (d.kind === 'wire') {
      let best = null;
      DEVICE_ORDER.forEach(id => { const c = this.devices[id];
        if (c.inserted && c.kind === 'catheter' && c.s <= d.s + 1e-6 && d.s - c.s <= 25 && (!best || c.s > best.s)) best = c; });
      if (best) { const sh = this.shapeOf(best); if (sh.A >= 40) return { dev: best, A: sh.A, tol: sh.tol * (d.id === 'wire' && this.gwireType().stiff ? 0.8 : 1), cath: true }; }
      if (d.id === 'wire') { const g = this.gwireType(); return { dev: d, A: g.tip === 'angled' ? 62 : 55, tol: 50 * g.steer, wire: true }; }
      return { dev: d, A: 62, tol: 50, wire: true, micro: true };
    }
    const sh = this.shapeOf(d);
    return { dev: d, A: sh.A, tol: sh.tol, cath: true };
  };
  // Pick a child segment at a bifurcation for the leading device (torqueOverride for previews/tests)
  Sim.prototype.chooseChild = function (d, seg, torqueOverride) {
    const kids = seg.children;
    if (!kids.length) return { child: null, reason: 'dead' };
    if (kids.length === 1) return { child: kids[0] };
    const sel = this.selectorFor(d);
    const torque = torqueOverride != null ? torqueOverride : sel.dev.torque;
    const t = A.endDir(seg), tip = A.tipDir(t, sel.A, torque);
    let tol = sel.tol;
    if (sel.wire && seg.r > 8) tol = 22; // a bare wire cannot reliably select an arch branch by itself
    let best = null, straight = null;
    const info = kids.map(k => { const c = A.startDir(this.seg(k)); return { k, ang: A.angleBetween(t, c), err: A.angleBetween(tip, c) }; });
    // the straightest child (if near-coaxial) is the default path; every other child must be aimed at
    info.forEach(o => { if (o.ang < 40 && (!straight || o.ang < straight.ang)) straight = o; });
    info.forEach(o => { if (o !== straight && o.err <= tol && (!best || o.err < best.err)) best = o; });
    if (best && (!straight || best.err < straight.ang + 35)) {
      return { child: best.k, err: best.err, tol, struggle: !!sel.cath && best.err > 0.8 * tol, straight: straight ? straight.k : null, sel };
    }
    if (straight) return { child: straight.k, sel };
    return { child: null, reason: 'stall', sel, aortic: !!sel.wire && seg.r > 8 };
  };
  // For tests/instructor: which torque values (0..355) select `target` beyond the current track end
  Sim.prototype.torquesSelecting = function (d, seg, target) {
    const out = [];
    for (let q = 0; q < 360; q += 5) { const r = this.chooseChild(d, seg, q); if (r.child === target) out.push({ q, struggle: !!r.struggle }); }
    return out;
  };

  Sim.prototype.clotsOnTrack = function () {
    return this.clots.filter(c => !c.removed && this.track.indexOf(c.seg) >= 0).map(c => {
      const off = this.offsetOf(c.seg); return { c, S0: off + c.s0, S1: off + c.s1 };
    });
  };

  // Advance/retract device by ds (mm). Returns actual moved distance.
  Sim.prototype.move = function (id, ds, fast) {
    const d = this.devices[id];
    if (!d.inserted || this.anim || this.finished || ds === 0) return 0;
    this.bumpFluoro();
    // a wire parked INSIDE the selective catheter is withdrawn with it (it keeps its position relative to the tip)
    const Wd = this.devices.wire, wireIn = id === 'diag' && ds < 0 && Wd.inserted && Wd.s < d.s - 0.5;
    if (wireIn) { const s0 = d.s, r = this._move(d, ds, fast); Wd.s = Math.max(0, Math.min(Wd.s + (d.s - s0), d.s - 0.5)); return r; }
    return this._move(d, ds, fast);
  };
  Sim.prototype._move = function (d, ds, fast) {
    const id = d.id;
    // a straight, stiff guide (and, milder, an aspiration catheter) cannot follow a curve without a rail inside it
    if (id === 'guide' || id === 'inter') {
      if (ds > 0) { const r = this.curveGate(d, ds, fast); if (r !== null) return r; }
      else if (d.wallImpact) { d.wallImpact = Math.max(0, d.wallImpact + ds * 2); if (!d.wallImpact) this.stalled = false; }
    }
    if (id === 'inter') {
      if (ds > 0) { const r = this.interAdvance(d, ds, fast); if (r !== null) return r; }
      else if (d.hung) { d.hung = false; d.strain = 0; d.passedZone = false; } // backing off frees the tip; next pass re-rolls
    }
    // a microwire is too floppy to act as a rail for a selective catheter / guide / aspiration catheter on its own
    const MW = this.devices.mwire;
    if (ds > 0 && d.kind === 'catheter' && d.id !== 'micro' && MW.inserted && !this.devices.micro.inserted && MW.s > d.s + 1) {
      const seg = this.locate(d.s).seg;
      if (!seg.head || seg.aortic || /ICAc|CCA/.test(seg.id)) {
        MW.s = Math.max(d.s + 0.5, MW.s - ds * 1.5);
        this.warnOnce('mwsup' + seg.id, 'warn', 'mwire_no_support', { dev: d.id });
        if (!this._mwPen || this.time - this._mwPen > 10) { this._mwPen = this.time; this.selStats.mwireMisuse = (this.selStats.mwireMisuse || 0) + 1; }
        ds *= 0.25;
      }
    }
    if (!d._skipRev && this.isReverse(d)) { const r = this.reverseMove(d, ds, fast); if (r !== null) { this.trimTrack(); return r; } }
    const D = this.devices, before = d.s;
    if (ds < 0) {
      if (d.id === 'sr' && d.deployed) { this.retrieveSR(); return 0; }
      if (d.id === 'sr' && this.srExposed() > 0.5) { this.warnOnce('srpartpull' + Math.round(this.time / 20), 'warn', 'sr_partial_pull'); return 0; }
      const exp0 = d.id === 'micro' ? this.srExposed() : 0;
      if (!fast && this.pullEngage(d, ds)) { this.afterMove(d, 0, fast); return ds; }
      if (fast && d.id === 'diag' && d.shape && (!this.isReverse(d) || d.formed) && !this.engagedJunction(d)) this.warnOnce('pullgently' + Math.round(this.time / 30), 'tip', 'pull_gently');
      d.s = Math.max(0, d.s + ds);
      this.stalled = false; this.endPush = Math.max(0, this.endPush - 1); this.wallPush = 0;
      this.trimTrack();
      // UNSHEATHING: the SR push wire is held fixed while the microcatheter is pulled back -> stent opens distal to proximal
      if (d.id === 'micro' && D.sr.inserted) { const gain = this.srExposed() - exp0; if (gain > 0) D.sr.unsheath += gain; this.updateSR(); }
      this.afterMove(d, d.s - before, fast);
      return d.s - before;
    }
    if (d.id === 'sr' && d.deployed) { this.warnOnce('srnoadv', 'warn', 'sr_cannot_advance'); return 0; }
    let target = d.s + ds;
    let limitKey = null;
    // Over-the-wire: a catheter cannot pass an inner device that is ahead of it
    if (d.kind === 'catheter') {
      // inner devices at (or within 2 mm of) the catheter tip: catheter tracks over them but cannot pass them
      const ahead = this.innerDevices(d).filter(o => o.s > d.s - 2);
      if (ahead.length) {
        const lim = Math.max.apply(null, ahead.map(o => o.s));
        if (target > lim) { target = Math.max(d.s, lim); limitKey = 'cath_at_wire_tip'; }
      }
      // micro cannot re-sheath a deployed stent here
      if (d.id === 'micro' && D.sr.deployed && target > D.sr.s - this.srLen()) {
        target = Math.max(d.s, D.sr.s - this.srLen()); limitKey = 'micro_at_stent';
      }
    }
    let srPush = false;
    if (d.id === 'sr' && !d.deployed && D.micro.inserted) {
      if (d.s < D.micro.s - 0.01) {
        // loading: advance the push wire until the distal marker reaches the microcatheter tip
        if (target >= D.micro.s) { target = D.micro.s; limitKey = 'sr_at_micro_tip'; d.tipLatch = true; }
      } else if (d.tipLatch && d.unsheath <= 2) {
        // the SR stops at the micro tip; pushing beyond needs a new, deliberate push (release the advance control first)
        this.warnOnce('srtip' + Math.round(this.time), 'info', 'sr_at_micro_tip');
        return 0;
      } else if (d.unsheath > 2) {
        // PUSH-AND-FLUFF: gentle forward pressure on the push wire while unsheathing; the open stent is anchored,
        // so the tip does not move but the cells "fluff" open across the clot (better apposition / metal density)
        d.fluff += ds; this.bumpFluoro();
        if (d.fluff > 10) { this.warnOnce('overfluff', 'danger', 'sr_overfluff'); this.dissRisk += ds / 30; }
        else this.warnOnce('fluff', 'good', 'sr_fluff');
        this.updateSR();
        return 0;
      } else {
        // pushing the stent OUT of the microcatheter instead of unsheathing: poor apposition and vessel injury
        srPush = true;
      }
    }
    // Large-bore catheters stop at the clot face
    if (this.devOD(d) >= 1.2) {
      this.clotsOnTrack().forEach(o => {
        if (d.s <= o.S0 + 1e-6 && target > o.S0) { target = o.S0; limitKey = 'at_clot_face'; }
      });
    }
    // Extend the track if this device leads
    if (target > this.trackLen) {
      if (!this.isLeading(d)) target = Math.min(target, this.trackLen);
      let guard = 0;
      while (target > this.trackLen && guard++ < 10) {
        const last = this.seg(this.track[this.track.length - 1]);
        let ch = this.chooseChild(d, last);
        if (ch.child && ch.struggle && rnd() < 0.5) {
          this.selStats.prolapse++;
          this.msg('warn', 'prolapse', { dev: ch.sel.dev.id, seg: ch.child });
          if (ch.straight) ch = { child: ch.straight };
          else { target = this.trackLen; if (d.kind === 'wire') d.s = Math.max(0, Math.min(d.s, this.trackLen) - 8); limitKey = null; break; }
        }
        if (!ch.child) {
          const over = target - this.trackLen;
          target = this.trackLen;
          this.handleBlocked(d, last, ch.reason, over, fast);
          limitKey = null;
          break;
        }
        const cs = this.seg(ch.child);
        if (this.devOD(d) > 0.95 * 2 * cs.r) {
          target = this.trackLen; limitKey = 'too_big'; this.limitParams = { dev: d.id, seg: cs.id };
          this.dissRisk += (ds) / 25; break;
        }
        this.track.push(ch.child); this.rebuildTrack();
        this.stalled = false; this.wallPush = 0;
        if (cs.small && d.kind === 'wire') this.msg('warn', 'wire_small_branch', { seg: cs.id });
      }
    }
    // Clamp to vessels too small for the device along the existing track
    const loc = this.locate(target);
    if (this.devOD(d) > 0.95 * 2 * loc.seg.r && d.kind !== 'wire') {
      const segStart = this.trackOff[loc.i];
      target = Math.max(d.s, segStart); limitKey = 'too_big'; this.limitParams = { dev: d.id, seg: loc.seg.id };
    }
    if (limitKey) {
      if (limitKey === 'too_big') this.warnOnce('big' + d.id + this.limitParams.seg, 'warn', 'too_big', this.limitParams);
      else this.warnOnce(limitKey + d.id + Math.round(target / 10), 'info', limitKey, { dev: d.id });
    }
    d.s = Math.max(d.s, target);
    const moved = d.s - before;
    if (srPush && moved > 0) {
      d.pushOut += moved; this.dissRisk += moved / 22; this.spasm += moved * 0.012;
      this.warnOnce('srpush', 'danger', 'sr_push_out');
    }
    if ((d.id === 'micro' || d.id === 'sr') && D.sr.inserted) this.updateSR();
    this.afterMove(d, moved, fast);
    this.trimTrack();
    return moved;
  };

  // ---------- Aspiration catheter bore + ophthalmic / siphon hang-up (ledge effect) ----------
  // Real product ID / distal OD (inch). Sources: Penumbra RED/JET/ACE spec tables, Stryker Vecta compatibility chart,
  // Imperative Care Zoom IFU (Zoom 88 LDP: 0.088" ID / 0.110" OD, needs >= 0.115" sheath), Terumo Sofia, Medtronic React.
  const ASP_SIZES = {
    '043': { id: 0.043, od: 0.060, prod: 'RED 43' },
    '054': { id: 0.054, od: 0.068, prod: 'JET D · Sofia 5F (0.055")' },
    '060': { id: 0.060, od: 0.080, prod: '5MAX ACE 60' },
    '062': { id: 0.062, od: 0.076, prod: 'RED 62' },
    '064': { id: 0.064, od: 0.080, prod: 'ACE 64' },
    '068': { id: 0.068, od: 0.084, prod: 'RED 68 · ACE 68 · React 68' },
    '070': { id: 0.070, od: 0.0825, prod: 'Sofia Plus 6F' },
    '071': { id: 0.071, od: 0.083, prod: 'React 71 · Zoom 71 · Vecta 71' },
    '072': { id: 0.072, od: 0.085, prod: 'RED 72 · JET 7' },
    '074': { id: 0.074, od: 0.085, prod: 'Vecta 74' },
    '088': { id: 0.088, od: 0.110, prod: 'Zoom 88 LDP · TracStar' }
  };
  // Guide / long sheath. 0.088" ID (Neuron MAX 088, Infinity) takes up to ~0.085" OD; a 0.088" aspiration catheter
  // needs a large-bore sheath (>= 0.115" ID per the Zoom 88 IFU).
  const GUIDE_SIZES = {
    '088': { id: 0.088, od: 0.113, prod: '8F guide / 088 long sheath' },
    '115': { id: 0.115, od: 0.131, prod: 'Large-bore long sheath 0.115"' }
  };
  Sim.prototype.boreFactor = function () { return Math.pow(ASP_SIZES[this.sizes.asp].id / 0.071, 2); };
  // the ophthalmic origin on the current track (end of the cavernous/petrous ICA segment, start of the supraclinoid ICA)
  Sim.prototype.siphonZone = function () {
    for (let i = 0; i < this.track.length - 1; i++) {
      const s = this.seg(this.track[i]);
      if (/ICAp$/.test(s.id) && /ICAs$/.test(this.track[i + 1])) return { S: this.trackOff[i] + s.len, side: s.side, i };
    }
    return null;
  };
  // probability that the aspiration catheter tip catches on the ophthalmic ledge, and its components (for feedback)
  Sim.prototype.hangRisk = function () {
    const D = this.devices, I = D.inter, M = D.micro, W = D.mwire.inserted ? D.mwire : D.wire, S = D.sr, G = D.guide, Z = this.siphonZone();
    if (!Z) return { p: 0 };
    const id = ASP_SIZES[this.sizes.asp].id;
    const bore = clamp((id - 0.040) / 0.032, 0.15, 1.7);
    const tort = this.anat.siphon === 'tortuous' ? 1.8 : 1;
    const mf = { '017': 1.15, '021': 1, '027': 0.7 }[this.sizes.micro] || 1;
    let sup = 1.6, supKey = 'none';
    const beyond = o => o.inserted ? o.s - Z.S : -1e9;
    if (beyond(W) > 3 || beyond(M) > 3) { sup = 1.1; supKey = 'wire'; }
    if (beyond(M) > 10) { sup = 0.75 * mf; supKey = 'micro'; }
    if (beyond(M) > 30 || (beyond(M) > 10 && this.locate(M.s).seg.mca && /M2/.test(this.locate(M.s).seg.lbl))) { sup = 0.4 * mf; supKey = 'micro_m2'; }
    if (S.inserted && S.deployed && beyond(S) > 10) { sup = 0.12; supKey = 'anchor'; }
    const gseg = G.inserted ? this.locate(G.s).seg : null;
    const gf = gseg && /ICA/.test(gseg.id) ? 0.85 : 1.25;
    const rot = this.time - (I.rotT || -9) < 0.8 ? 0.5 : 1;
    const p = clamp(0.3 * bore * tort * sup * gf * rot, 0.01, 0.97);
    return { p, bore, tort, sup, supKey, gf, rot, Z };
  };
  // returns null to continue with the generic advance; otherwise the mm actually moved
  Sim.prototype.interAdvance = function (I, ds, fast) {
    const Z = this.siphonZone(), D = this.devices;
    // too large for the vessel (e.g. a 0.088" catheter beyond the ICA terminus)
    const nloc = this.locate(I.s + ds);
    const odmm = ASP_SIZES[this.sizes.asp].od * 25.4, vd = 2 * nloc.seg.r;
    if (!nloc.seg.aortic && odmm > vd * 0.98 && nloc.seg.head) { this.warnOnce('aspbig' + nloc.seg.id, 'warn', 'asp_vessel_small', { od: odmm.toFixed(1), v: vd.toFixed(1) }); return 0; }
    if (!Z || !this.settings.hangups) { I.hung = false; return null; }
    const ledge = Z.S - 1;
    if (I.s < ledge - 6) I.passedZone = false;
    if (I.hung) {
      const R = this.hangRisk();
      I.strain += ds;
      I.hangPush = (I.hangPush || 0) + ds;
      // every 2 mm of push: a chance the tip slips past the ledge (better with support / rotation)
      while (I.hangPush >= 2) {
        I.hangPush -= 2;
        if (rnd() < (1 - R.p) * 0.45 * (fast ? 0.4 : 1)) {
          I.hung = false; I.passedZone = true; I.strain = 0; I.hangPush = 0;
          this.hangStats.freed.push(R.supKey + (R.rot < 1 ? '+rot' : ''));
          this.msg('good', R.supKey === 'anchor' ? 'hang_freed_anchor' : R.rot < 1 ? 'hang_freed_rot' : R.supKey === 'micro_m2' ? 'hang_freed_micro' : 'hang_freed');
          this.stalled = false; this.emit('change');
          return null;
        }
      }
      // the stuck catheter buckles in the cervical ICA and the push is transmitted to the guide, which backs out
      if (I.strain > 6) {
        const G = D.guide;
        if (G.inserted) {
          const back = ds * (fast ? 0.9 : 0.55);
          G.s = Math.max(0, G.s - back);
          this.guideBack = (this.guideBack || 0) + back;
          this.warnOnce('hangstrain', 'danger', 'hang_strain');
          const gs = this.locate(G.s).seg;
          if (!this.prolapsed && (this.guideBack > 30 || (!/ICA/.test(gs.id) && !gs.head))) {
            // the guide loses its purchase and prolapses back into the CCA, pulling the aspiration catheter back with it
            this.prolapsed = true;
            const ci = this.track.findIndex(id => /ICAc$/.test(id));
            if (ci > 0) G.s = Math.max(0, this.trackOff[ci] - 6);
            I.s = Math.min(I.s, G.s + 45); I.hung = false; I.strain = 0; I.passedZone = false;
            ['micro', 'wire', 'mwire'].forEach(k => { const o = D[k]; if (o.inserted && o.s < I.s) o.s = I.s; });
            this.msg('danger', 'guide_prolapse', { vessel: (Z.side || 'L') + 'CCA' }); this.selStats.prolapse++;
            this.emit('change');
            return 0;
          }
        }
        // forcing it: risk of dissection at the siphon / cervical ICA
        this.dissRisk += ds * (fast ? 0.06 : 0.02) * (I.strain > 14 ? 2 : 1);
        if (this.dissRisk > 0.5) this.warnOnce('dissw', 'warn', 'dissection_risk');
        if (this.dissRisk >= 1) { this.addComplication('dissection', { seg: this.seg(this.track[Z.i]).id }); this.dissRisk = 0; }
      }
      this.stalled = true;
      return 0;
    }
    if (!I.passedZone && I.s < ledge && I.s + ds >= ledge) {
      const R = this.hangRisk();
      I.passedZone = true;
      this.hangStats.attempts++;
      if (rnd() < R.p) {
        I.s = ledge; I.hung = true; I.strain = 0; I.hangPush = 0; this.hangStats.hangs++;
        this.msg('warn', 'hang_up', { p: Math.round(R.p * 100) });
        this.emit('change');
        return 0;
      }
    }
    return null;
  };

  // ---------- Shaped selective catheters: reverse-curve forming, engagement on pull-back ----------
  // reach: how far the tip of a formed loop trails behind the knee along the aorta; wireBack: how far the wire must be
  // withdrawn from the tip (behind the primary curve) for the curve to be free; formLen: mm of push to form the loop.
  const REV = { sim2: { reach: 45, wireBack: 60, formLen: 50, maxKnee: 80 }, vtk: { reach: 20, wireBack: 30, formLen: 30, maxKnee: 40 } };
  Sim.prototype.isReverse = function (d) { return d.id === 'diag' && !!REV[d.shape]; };
  Sim.prototype.wireBehind = function (d, mm) { const W = this.devices.wire; return !W.inserted || W.s <= d.s - mm; };
  // last aortic -> branch junction the device tip lies beyond
  Sim.prototype.engagedJunction = function (d) {
    for (let i = this.track.length - 1; i >= 1; i--) {
      const P = this.trackOff[i]; if (P >= d.s) continue;
      if (this.seg(this.track[i - 1]).aortic && !this.seg(this.track[i]).aortic) return { i, P };
    }
    return null;
  };
  Sim.prototype.unform = function (d, key, level) {
    d.formed = false; d.form = 0; d.formTech = null; d.knee = 0; d.kneeMax = 0; d.over = 0;
    if (key) this.msg(level || 'warn', key, { dev: d.id });
    this.emit('change');
  };
  Sim.prototype.completeForm = function (d) {
    d.formed = true; d.form = 1; d.over = 0;
    this.advLatch = d.id; // stop advancing on completion: the trainee must release ↑ (no accidental over-push)
    if (d.formTech === 'lsa') d.knee = d.kneeMax || 60;
    this.msg('good', 'sim2_formed_' + d.formTech, { dev: d.id });
    this.emit('change');
  };
  // tip popped out of the branch: the loop sits free in the arch with its knee `knee` mm beyond the origin
  Sim.prototype.freeLoop = function (d, J) {
    const kneePos = J.P + Math.max(4, Math.min(d.knee, NIR.shapes.contLength(this, J.i) - 4));
    this.track = this.track.slice(0, J.i); this.rebuildTrack();
    let g = 0;
    while (this.trackLen < kneePos && g++ < 10) { const last = this.seg(this.track[this.track.length - 1]); const ch = last.children.find(k => this.seg(k).aortic); if (!ch) break; this.track.push(ch); this.rebuildTrack(); }
    d.s = Math.min(kneePos, this.trackLen);
    DEVICE_ORDER.forEach(id => { const o = this.devices[id]; if (o.inserted && o !== d && o.rank > d.rank && o.s > J.P) o.s = J.P; });
    this.trimTrack();
    this.msg('info', 'rev_disengaged', { dev: d.id });
    this.emit('change');
  };
  // movement rules for Simmons 2 / Vitek; returns null to fall through to the generic coaxial rules
  Sim.prototype.reverseMove = function (d, ds, fast) {
    const R = REV[d.shape], W = this.devices.wire, loc = this.locate(d.s);
    const wireAhead = W.inserted && W.s > d.s + 2;
    if (!d.formed) {
      if (d.shape !== 'sim2' || ds <= 0 || wireAhead) return null;
      const back = this.wireBehind(d, R.wireBack);
      const inLSA = loc.seg.archVessel === 'LSA' && this.vesselDepth('LSA', d.s) >= 15;
      const atValve = loc.seg.id === 'ascAorta' && loc.local >= loc.seg.len - 14;
      if (inLSA || atValve) {
        if (!back) { this.warnOnce('s2wic' + loc.seg.id, 'warn', 'sim2_wire_in_curve'); return null; }
        const tech = inLSA ? 'lsa' : 'valve';
        if (d.formTech !== tech) {
          d.form = 0; d.formTech = tech; d.kneeMax = 0;
          if (tech === 'lsa') { const J = this.engagedJunction(d); d.kneeMax = J ? Math.max(20, Math.min(R.maxKnee, NIR.shapes.contLength(this, J.i) - 8)) : 60; }
          this.msg('info', 'sim2_forming_' + tech);
        }
        // LSA: the tip is anchored in the subclavian; pushing bows the catheter into the arch and the knee prolapses
        // toward the ascending aorta. Valve: the tip deflects off the valve and folds back.
        d.form = Math.min(1, d.form + ds / R.formLen);
        // LSA: as the knee prolapses the tip is drawn back out of the subclavian toward its origin
        if (tech === 'lsa' && d.form > 0.3) { const J = this.engagedJunction(d); if (J) d.s = Math.max(J.P + 12, d.s - ds * 0.6); }
        if (d.form >= 1) this.completeForm(d);
        return ds;
      }
      if (back && loc.seg.aortic) this.warnOnce('s2where' + loc.seg.id, 'tip', 'sim2_form_where');
      return null;
    }
    if (ds < 0) d.over = 0;
    const J = this.engagedJunction(d);
    if (J) {
      if (d.knee <= 1.5) return null; // drawn straight into the vessel over a wire: behaves like a straight catheter
      if (ds < 0) {
        // pulling back seats the tip deeper (the loop shortens) ... until the loop is pulled through the origin
        if (d.knee <= 6) {
          this.track = this.track.slice(0, J.i); this.rebuildTrack();
          d.s = Math.max(0, J.P - 4);
          DEVICE_ORDER.forEach(id => { const o = this.devices[id]; if (o.inserted && o !== d && o.rank > d.rank && o.s > d.s) o.s = d.s; });
          this.unform(d, 'rev_pulled_out'); this.trimTrack();
          return ds;
        }
        const adv = Math.max(0, Math.min(-ds * 0.8, this.trackLen - d.s));
        d.s += adv; d.knee += ds;
        return ds;
      }
      if (wireAhead) {
        d._skipRev = true; const m = this.move(d.id, ds, fast); d._skipRev = false; d.knee = Math.max(0, d.knee - m);
        if (d.knee <= 1.5) this.unform(d, d.shape === 'vtk' ? 'vtk_straightened' : 'sim2_straightened', 'info'); // drawn over the wire into the vessel
        return m;
      }
      // pushing without a wire disengages the tip and advances the loop toward the root
      d.s -= ds * 0.8; d.knee += ds;
      const cap = Math.max(20, NIR.shapes.contLength(this, J.i) - 4);
      if (d.knee > cap) {
        d.over = (d.over || 0) + (d.knee - cap); d.knee = cap;
        this.warnOnce('revvalve', 'warn', 'rev_at_valve', { dev: d.id });
        if (d.over > 35) { this.unform(d, 'rev_unformed_push'); return ds; }
      }
      if (d.s <= J.P + 0.5) this.freeLoop(d, J);
      return ds;
    }
    // free formed loop: the knee leads along the aorta (it never enters a branch)
    if (ds < 0 || wireAhead) return null;
    for (let i = 1; i < this.track.length; i++) {
      if (this.trackOff[i] >= d.s && !this.seg(this.track[i]).aortic && !DEVICE_ORDER.some(k => this.devices[k].inserted && this.devices[k].s > this.trackOff[i])) { this.track = this.track.slice(0, i); this.rebuildTrack(); break; }
    }
    let target = d.s + ds, g = 0;
    while (target > this.trackLen && g++ < 10) { const last = this.seg(this.track[this.track.length - 1]); const ch = last.children.find(k => this.seg(k).aortic); if (!ch) break; this.track.push(ch); this.rebuildTrack(); }
    if (target > this.trackLen) {
      d.over = (d.over || 0) + (target - this.trackLen); target = this.trackLen;
      this.warnOnce('revvalve', 'warn', 'rev_at_valve', { dev: d.id });
      if (d.over > 35) { this.unform(d, 'rev_unformed_push'); return 0; }
    }
    const moved = Math.max(0, target - d.s); d.s = Math.max(d.s, target);
    return moved;
  };

  // Gentle pull-back with the tip aimed at an origin: the tip "pops" into it. Shaped (Vert/Bern/H1) tips catch the
  // ostium they are rotated toward; a formed Simmons/Vitek tip trails `reach` mm behind the knee.
  Sim.prototype.pullEngage = function (d, ds) {
    if (d.id !== 'diag' || !d.shape) return false;
    const rev = this.isReverse(d);
    if (rev ? !d.formed : !['vert', 'bern', 'h1'].includes(d.shape)) return false;
    const W = this.devices.wire; if (W.inserted && W.s > d.s - 3) return false;
    if (rev && this.engagedJunction(d)) return false;
    const reach = rev ? REV[d.shape].reach : 0, sh = SHAPES[d.shape], tgt = rev ? this.revTarget(d) : null;
    if (rev && !tgt) return false;
    const tOld = d.s - reach, tNew = d.s + ds - reach;
    for (let i = this.track.length - 1; i >= 1; i--) {
      const P = this.trackOff[i];
      if (!(P < tOld && P >= tNew)) continue;
      const parent = this.seg(this.track[i - 1]); if (!parent.aortic) continue;
      const t = A.endDir(parent), tip = A.tipDir(t, sh.A, d.torque);
      let best = null;
      if (rev) { if (parent.children.includes(tgt.k) && tgt.k !== this.track[i]) best = { k: tgt.k, err: tgt.err }; }
      else parent.children.forEach(k => { if (k === this.track[i] || this.seg(k).aortic) return; const err = A.angleBetween(tip, A.startDir(this.seg(k))); if (err <= sh.tol && (!best || err < best.err)) best = { k, err }; });
      if (!best) continue;
      if (DEVICE_ORDER.some(id => { const o = this.devices[id]; return o.inserted && o.rank < d.rank && o.s > P; })) continue;
      DEVICE_ORDER.forEach(id => { const o = this.devices[id]; if (o.inserted && o !== d && o.s > P) o.s = P; });
      const kneeNew = d.s + ds - P;
      this.track = this.track.slice(0, i).concat([best.k]); this.rebuildTrack();
      if (rev) { d.knee = Math.max(8, kneeNew); d.kneeMax = Math.max(d.knee, d.kneeMax || 0); d.s = P + 4; } else d.s = P + 3;
      const v = this.seg(best.k).archVessel || best.k;
      this.msg('good', rev && d.shape === 'sim2' ? 'sim2_engaged' : 'cath_engaged', { vessel: v, dev: d.id });
      this.bumpFluoro(); this.emit('change');
      return true;
    }
    return false;
  };
  // A reverse loop's tip hooks upward/backward; pulling the loop changes the hook angle (90-140 deg to the aortic axis),
  // so rotation chooses WHICH arch branch it will catch: the branch best aligned with the hooked tip.
  const HOOK_AS = [90, 100, 110, 120, 130, 140];
  Sim.prototype.hookErr = function (parent, child, torque) {
    const t = A.endDir(parent); let m = 999;
    HOOK_AS.forEach(a => { m = Math.min(m, A.angleBetween(A.tipDir(t, a, torque), A.startDir(child))); });
    return m;
  };
  Sim.prototype.revTarget = function (d) {
    let best = null;
    this.anat.list.forEach(p => { if (!p.aortic || p.id === 'abdAorta' || p.id === 'rIliac') return; p.children.forEach(k => { const c = this.seg(k); if (c.aortic) return; const e = this.hookErr(p, c, d.torque); if (!best || e < best.err) best = { k, p: p.id, err: e }; }); });
    return best && best.err <= 45 ? best : null;
  };
  Sim.prototype.shapePhase = function () {
    const d = this.devices.diag; if (!d.inserted || !this.isReverse(d)) return null;
    const J = this.engagedJunction(d);
    if (d.shape === 'vtk') return d.formed ? (J && d.knee > 1.5 ? 'engaged' : 'formed') : 'vtk_unformed';
    if (d.formed) return J && d.knee > 1.5 ? 'engaged' : 'formed';
    if (d.form > 0 && d.formTech) return 'forming';
    const loc = this.locate(d.s), back = this.wireBehind(d, REV.sim2.wireBack);
    const inLSA = loc.seg.archVessel === 'LSA' && this.vesselDepth('LSA', d.s) >= 15, atValve = loc.seg.id === 'ascAorta' && loc.local >= loc.seg.len - 14;
    if (inLSA || atValve) return back ? (inLSA ? 'lsa_push' : 'valve_push') : 'pull_wire';
    return 'unformed';
  };
  Sim.prototype.updateShapes = function (dt) {
    const d = this.devices.diag; if (!d.inserted || !this.isReverse(d)) return;
    dt = dt || 0;
    const loc = this.locate(d.s);
    if (d.formed && (loc.seg.id === 'abdAorta' || loc.seg.id === 'rIliac')) { this.unform(d, 'rev_lost', 'info'); return; }
    if (d.shape === 'vtk') {
      const J = this.engagedJunction(d), W = this.devices.wire;
      const back = this.wireBehind(d, REV.vtk.wireBack);
      const big = loc.seg.aortic && loc.seg.id !== 'abdAorta' && loc.seg.id !== 'rIliac';
      if (!d.formed) {
        // the Vitek reconstitutes its reverse curve by itself in the thoracic aorta / arch once the wire is out of the curve
        if (back && big && !J) { d.form = Math.min(1, (d.form || 0) + dt * 0.8); if (d.form >= 1) { d.formed = true; d.formTech = 'spont'; this.msg('good', 'vtk_formed', { dev: 'diag' }); this.emit('change'); } }
        else if (!back) d.form = Math.max(0, (d.form || 0) - dt * 2);
      } else if (W.inserted && W.s > d.s + 40 && J) this.unform(d, 'vtk_straightened', 'info');
    }
  };
  // depth (mm) of position S into arch vessel v along the current track (-1 if not in it)
  Sim.prototype.vesselDepth = function (v, S) {
    let start = null, end = null;
    this.track.forEach((id, i) => { if (this.seg(id).vessel === v) { if (start == null) start = this.trackOff[i]; end = this.trackOff[i] + this.seg(id).len; } });
    if (start == null || S < start) return -1;
    return Math.min(S, end) - start;
  };
  Sim.prototype.trackSelections = function () {
    ['guide', 'diag', 'inter'].forEach(id => {
      const d = this.devices[id], prev = this.engagedSets[id] || [];
      const now = [];
      if (d.inserted) this.anat.vessels.forEach(v => { if (this.vesselDepth(v, d.s) >= 15) now.push(v); });
      now.forEach(v => { if (!prev.includes(v)) {
        this.selections.push({ vessel: v, dev: id, shape: d.shape, time: this.time });
        this.msg('good', 'sel_vessel', { vessel: v, dev: id }); this.emit('select', { vessel: v, dev: id });
      } });
      prev.forEach(v => { if (!now.includes(v)) this.msg('info', 'disengaged', { vessel: v, dev: id }); });
      this.engagedSets[id] = now;
    });
  };



  // What the active device would select next with its current torque (shown to the trainee as "Aim").
  Sim.prototype.aimPreview = function () {
    const d = this.devices[this.active]; if (!d || !d.inserted) return null;
    const name = k => { const c = this.seg(k), par = this.seg(c.parent); return c.aortic ? 'aorta' : (par && par.aortic ? (c.archVessel || c.vessel || k) : k); };
    if (d.id === 'diag' && this.isReverse(d)) {
      if (!d.formed || this.engagedJunction(d)) return null;
      const tg = this.revTarget(d); return { mode: 'hook', vessel: tg ? name(tg.k) : null, good: !!tg && tg.err <= 30 };
    }
    if (d.kind !== 'wire' && d.id !== 'diag') return null;
    if (this.innerDevices(d).some(o => o.s > d.s + 1)) return null; // something else leads
    const loc = this.locate(d.s); if (loc.i !== this.track.length - 1) return null;
    const seg = loc.seg; if (seg.len - loc.local > 70 || seg.children.length < 2) return null;
    const ch = this.chooseChild(d, seg); if (!ch.child) return { mode: 'next', vessel: null };
    return { mode: 'next', vessel: name(ch.child), good: !ch.struggle, struggle: !!ch.struggle };
  };
  // forming progress for the hint panel: guidewire position relative to the catheter tip / curve
  Sim.prototype.shapeInfo = function () {
    const d = this.devices.diag, W = this.devices.wire; if (!d.inserted || !this.isReverse(d)) return null;
    const R = REV[d.shape], rel = W.inserted ? W.s - d.s : null;
    const lsaW = W.inserted ? this.vesselDepth('LSA', W.s) : -1, lsaC = this.vesselDepth('LSA', d.s);
    const wl = W.inserted ? this.locate(W.s) : null;
    return { need: R.wireBack, rel, back: rel == null ? R.wireBack : Math.max(0, -rel), lsaW, lsaC,
      wireAtRoot: !!wl && wl.seg.id === 'ascAorta' && wl.local >= wl.seg.len - 14, cathInArch: this.locate(d.s).seg.aortic && !/^(rIliac|abdAorta)$/.test(this.locate(d.s).seg.id) };
  };

  // ---------- Unsupported guide / aspiration catheter around curves ----------
  const STRAIGHT_SEG = /^(rIliac|lIliac|abdAorta|descAorta)$/;
  const CURVE_SUPPORT = { guide: 30, inter: 20 };   // mm of rail that must extend beyond the catheter tip
  // how far (mm) the best rail extends beyond the tip of d. Guide: 0.035/0.038 guidewire or 5F selective catheter.
  // Aspiration catheter: guidewire or microcatheter (a bare microwire does not count – it prolapses).
  Sim.prototype.curveSupport = function (d) {
    const D = this.devices, sup = [];
    if (D.wire.inserted) sup.push(D.wire.s);
    if (d.id === 'guide' && D.diag.inserted) sup.push(D.diag.s);
    if (d.id === 'inter' && D.micro.inserted) sup.push(D.micro.s);
    return sup.length ? Math.max.apply(null, sup) - d.s : -Infinity;
  };
  // furthest track position an UNSUPPORTED device may reach: the end of the straight iliac/aortic run; in the arch it
  // cannot advance at all; a guide in a branch may move within its current segment only.
  Sim.prototype.curveLimit = function (d) {
    const loc = this.locate(d.s), seg = loc.seg;
    if (STRAIGHT_SEG.test(seg.id)) {
      let i = loc.i; while (i + 1 < this.track.length && STRAIGHT_SEG.test(this.track[i + 1])) i++;
      let L = this.trackOff[i] + this.seg(this.track[i]).len;
      if (i === this.track.length - 1) { // the straight aorta continues beyond the current track end
        let id = this.track[i], guard = 0;
        for (;;) {
          const nx = Object.values(this.anat.segs).find(z => z.parent === id && z.aortic && STRAIGHT_SEG.test(z.id));
          if (!nx || guard++ > 5) break; L += nx.len; id = nx.id;
        }
      }
      return L;
    }
    if (seg.aortic) return d.s;
    if (d.id === 'inter') return Infinity; // aspiration catheter: arch rule only (siphon handled by the hang-up model)
    return this.trackOff[loc.i] + seg.len;
  };
  Sim.prototype.curveGate = function (d, ds, fast) {
    const sup = this.curveSupport(d), REQ = CURVE_SUPPORT[d.id];
    let lim = this.curveLimit(d);
    const G = this.devices.guide;
    if (d.id === 'inter' && G.inserted) lim = Math.max(lim, G.s); // inside the guide it is supported by the guide
    if (sup > 2 && d.wallImpact) { d.wallImpact = 0; this.stalled = false; }
    if (sup > 2) { // a rail is there but too short beyond the tip: the catheter just stops (no wall injury) – lead further
      lim = Math.max(lim, d.s + sup - REQ);
      if (d.s + ds > lim + 1e-9) {
        const before = d.s; if (lim > d.s + 1e-6) this._move(d, lim - d.s, fast);
        this.warnOnce('morerail' + d.id + Math.round(d.s / 20), 'info', 'need_more_rail', { dev: d.id, mm: REQ / 10 });
        return d.s - before;
      }
      return null;
    }
    if (d.s + ds <= lim + 1e-9) return null;
    const before = d.s, over = d.s + ds - Math.max(d.s, lim);
    if (lim > d.s + 1e-6) this._move(d, lim - d.s, fast);
    this.wallImpact(d, over, fast);
    return d.s - before;
  };
  Sim.prototype.wallImpact = function (d, over, fast) {
    const f = fast ? FAST : 1, loc = this.locate(d.s), seg = loc.seg, k = d.id === 'guide' ? 1 : 0.5;
    const aortic = STRAIGHT_SEG.test(seg.id) || seg.aortic;
    d.wallImpact = (d.wallImpact || 0) + over * f * k;
    this.stalled = true; this.emit('stall'); this.bumpFluoro();
    this.selStats.unsupPush = (this.selStats.unsupPush || 0) + over * f * k;
    const dev = d.id;
    this.warnOnce('unsc' + dev + seg.id, 'warn', dev === 'guide' ? (aortic ? 'guide_unsup_arch' : 'guide_unsup_curve') : 'asp_unsup_arch', { dev, seg: seg.id });
    if (d.wallImpact > 6) this.warnOnce('unsd' + dev + seg.id, 'danger', aortic ? 'aortic_wall_danger' : 'branch_wall_danger', { dev, seg: seg.id });
    if (!aortic) { // guide tip ramming the wall of a branch: classic dissection risk
      this.dissRisk += over * f * k / 10;
      if (this.dissRisk > 0.5) this.warnOnce('dissw', 'warn', 'dissection_risk');
      if (this.dissRisk >= 1) { this.dissections.push({ seg: seg.id, local: loc.local, x: loc.x, y: loc.y, z: loc.z }); this.addComplication('dissection', { seg: seg.id }); this.dissRisk = 0; }
      return;
    }
    const hasC = t => this.complications.some(c => c.type === t);
    const dissAt = dev === 'guide' ? 15 : 22;
    if (d.wallImpact >= dissAt && !hasC('aortic_dissection')) {
      // intimal flap along the outer wall just beyond the impact point
      const flap = [];
      const n = { x: -loc.ty, y: loc.tx, z: 0 }, nl = Math.hypot(n.x, n.y) || 1;
      for (let j = -6; j <= 26; j += 2) {
        const S = d.s + j, q = S <= this.trackLen ? this.locate(S) : { x: loc.x + loc.tx * j, y: loc.y + loc.ty * j, z: loc.z + loc.tz * j };
        const off = seg.r * (0.25 + 0.5 * Math.min(1, Math.max(0, (j + 6) / 20)));
        flap.push({ x: q.x + n.x / nl * off, y: q.y + n.y / nl * off, z: q.z });
      }
      this.dissections.push({ seg: seg.id, local: loc.local, x: loc.x, y: loc.y, z: loc.z, aortic: true, flap });
      this.addComplication('aortic_dissection', { seg: seg.id, dev });
    }
    if (dev === 'guide' && d.wallImpact >= 30 && !hasC('aortic_perforation')) {
      const r = seg.r, p = { seg: seg.id, local: loc.local, x: loc.x + loc.tx * r, y: loc.y + loc.ty * r, z: loc.z + loc.tz * r, time: this.time, how: 'aortic' };
      this.perforations.push(p);
      this.addComplication('aortic_perforation', { seg: seg.id });
      this.emit('flash', 'perf');
      this.caseEndAt = this.time + 4; // severe: the case ends (debrief) a few seconds later
    }
  };

  Sim.prototype.handleBlocked = function (d, seg, reason, over, fast) {
    const f = fast ? FAST : 1;
    if (reason === 'stall') {
      this.stalled = true;
      this.wallPush += over * f * 0.35;
      this.emit('stall');
      const sel = this.selectorFor(d);
      if (reason === 'stall' && seg.r > 8 && sel.wire) this.warnOnce('aw' + seg.id, 'warn', 'aortic_wire_alone');
      else if (sel.cath && sel.A >= 40) { if (!this.warnFlags['ss' + seg.id + sel.dev.shape]) this.selStats.shapeStall++; this.warnOnce('ss' + seg.id + sel.dev.shape, 'warn', 'shape_stall', { dev: sel.dev.id, seg: seg.id }); }
      else if (d.kind === 'wire') this.warnOnce('stall' + seg.id, 'warn', 'tip_stall', { seg: seg.id });
      else this.warnOnce('cstall' + seg.id, 'warn', 'cath_stall', { seg: seg.id });
      const tipLoc = this.locate(d.s);
      if (this.wallPush > 10) {
        if (seg.intracranial || seg.r < 1.6) this.perforate(tipLoc, 'wall');
        else this.dissRisk += over * f / 12;
        this.wallPush = 4;
      }
      return;
    }
    // dead end of a vessel
    this.endPush += over * f * 0.35;
    const loc = this.locate(d.s);
    if (seg.deadEnd === 'valve') { this.warnOnce('valve', 'warn', 'at_valve'); return; }
    if (seg.r >= 1.8) { this.warnOnce('end' + seg.id, 'info', 'end_of_vessel', { seg: seg.id }); return; }
    if (this.endPush > 2) this.warnOnce('endp' + seg.id, 'danger', 'push_small_end', { seg: seg.id });
    if (this.endPush > 6) { this.perforate(loc, 'end'); this.endPush = 0; }
  };

  Sim.prototype.perforate = function (loc, how) {
    if (this.perforations.some(p => p.seg === loc.seg.id)) return;
    this.perforations.push({ seg: loc.seg.id, local: loc.local, x: loc.x, y: loc.y, z: loc.z, time: this.time, how });
    this.addComplication('perforation', { seg: loc.seg.id });
    this.emit('flash', 'perf');
  };

  Sim.prototype.afterMove = function (d, moved, fast) {
    if (moved <= 0) return;
    const f = fast ? FAST : 1;
    const loc = this.locate(d.s);
    const seg = loc.seg;
    if (d.kind === 'wire') {
      // depth into small branches
      if (seg.small && loc.local > 3) {
        const p = 0.035 * moved * f * (d.id === 'wire' ? 3 : 1);
        if (rnd() < p) this.perforate(loc, 'small');
      }
      if (d.id === 'wire' && (seg.intracranial || seg.r < 2.0)) {
        this.warnOnce('std_ic', 'warn', 'std_wire_ic');
        if (rnd() < 0.012 * moved * f) this.perforate(loc, 'stdwire');
      }
      if (fast && seg.intracranial) this.warnOnce('fast_ic', 'warn', 'fast_ic');
    }
    if (d.kind === 'catheter' && !seg.aortic) {
      const inner = this.innerDevices(d).filter(o => o.s >= d.s - 0.5);
      const ratio = this.devOD(d) / (2 * seg.r);
      if (!inner.length) {
        this.dissRisk += moved * f * ratio / 45;
        this.warnOnce('unsup' + d.id, 'warn', 'unsupported', { dev: d.id });
      }
      this.spasm += moved * Math.max(0, ratio - 0.5) * 0.015;
    }
    if (this.dissRisk > 0.5) this.warnOnce('dissw', 'warn', 'dissection_risk');
    if (this.dissRisk >= 1) {
      this.dissections.push({ seg: seg.id, local: loc.local, x: loc.x, y: loc.y, z: loc.z });
      this.addComplication('dissection', { seg: seg.id }); this.dissRisk = 0;
    }
  };

  Sim.prototype.torqueTarget = function () {
    const a = this.devices[this.active];
    if (a && a.inserted && (a.id === 'diag' || a.id === 'guide' || a.kind === 'wire')) return a;
    const M = this.devices.mwire; return M.inserted ? M : this.devices.wire;
  };
  Sim.prototype.rotate = function (deg) {
    const I = this.devices.inter;
    if (this.active === 'inter' && I.inserted && !this.anim) { I.torque = ((I.torque + deg) % 360 + 360) % 360; I.rotT = this.time; this.bumpFluoro(); return; }
    const w = this.torqueTarget();
    if (!w.inserted || this.anim) return;
    w.torque = ((w.torque + deg) % 360 + 360) % 360;
    this.bumpFluoro();
    if (this.stalled) this.wallPush = Math.max(0, this.wallPush - Math.abs(deg) * 0.05);
  };

  // ---------- Aspiration, stent retriever ----------
  Sim.prototype.setAspiration = function (on) {
    const D = this.devices;
    if (on && !D.inter.inserted && !D.guide.inserted) { this.msg('warn', 'need_inter'); return; }
    if (this.anim) return;
    this.aspiration = !!on; this.engagedTime = 0; this.corked = false;
    this.aspSource = D.inter.inserted ? 'inter' : 'guide';
    this.msg('info', on ? (this.aspSource === 'guide' ? 'asp_on_guide' : 'asp_on') : 'asp_off');
    this.emit('change');
  };

  Sim.prototype.aspirationState = function () {
    const I = this.devices.inter;
    if (!I.inserted) return { gap: Infinity };
    let best = null;
    this.clotsOnTrack().forEach(o => { const g = o.S0 - I.s; if (g >= -0.5 && (!best || g < best.gap)) best = { gap: g, o }; });
    const microAcross = ['micro', 'mwire', 'wire', 'sr'].some(k => this.devices[k].inserted && this.devices[k].s > I.s + 2);
    return best ? { gap: best.gap, clot: best.o.c, microAcross } : { gap: Infinity, microAcross };
  };

  // Automatic, controlled unsheathing (same technique as holding "Unsheathe"): push wire fixed, micro pulled back
  Sim.prototype.deploySR = function () {
    const S = this.devices.sr, M = this.devices.micro;
    if (this.anim) return;
    if (!S.inserted) { this.msg('warn', 'need_sr'); return; }
    if (S.deployed) return;
    if (this.srExposed() < 0.5 && M.s - S.s > 3) { this.msg('warn', 'sr_not_at_tip'); return; }
    const L = this.srLen(), to = S.s - L - 3;
    this.anim = { type: 'unsheath', t: 0, dur: Math.max(0.8, (M.s - to) / 16), from: M.s, to };
    this.msg('info', 'deploying');
  };

  // keep SR state consistent (opening / fully deployed / re-sheathed)
  Sim.prototype.updateSR = function () {
    const S = this.devices.sr; if (!S.inserted) return;
    const L = this.srLen(), e = this.srExposed();
    if (e > 0.5 && S.exposedAt == null) { S.exposedAt = this.time; this.msg('info', 'sr_opening'); }
    if (e <= 0.5) S.exposedAt = null;
    if (!S.deployed && e >= L - 0.5) this.finishDeploy();
    else if (S.deployed && e < L - 0.5) {
      S.deployed = false; S.target = null; this.clots.forEach(c => { c.bypass = false; });
      this.msg('info', 'sr_resheathed'); this.emit('change');
    }
  };

  Sim.prototype.finishDeploy = function () {
    const S = this.devices.sr, L = this.srLen();
    S.deployed = true; S.dS1 = S.s; S.dS0 = S.s - L; S.deployTime = this.time;
    S.technique = S.pushOut > Math.max(4, S.unsheath) ? 'push' : 'unsheath';
    let best = null;
    this.clotsOnTrack().forEach(o => {
      const ov = Math.max(0, Math.min(S.dS1, o.S1) - Math.max(S.dS0, o.S0));
      const cov = ov / (o.S1 - o.S0);
      if (!best || cov > best.cov) best = { cov, o, overhang: S.dS1 - o.S1 };
    });
    S.target = best;
    if (best && best.cov > 0.01) {
      if (best.cov > 0.5) best.o.c.bypass = true;
      this.msg('info', 'deployed_cov', { cov: Math.round(best.cov * 100), over: Math.round(best.overhang) });
      if (best.overhang < 3) this.msg('warn', 'sr_short_distal');
    } else this.msg('warn', 'deployed_nocov');
    this.emit('change');
  };

  Sim.prototype.retrieveSR = function () {
    const S = this.devices.sr, M = this.devices.micro, I = this.devices.inter, G = this.devices.guide;
    if (this.anim) return;
    if (!S.deployed) { this.msg('warn', this.srExposed() > 0.5 ? 'sr_partial_pull' : 'sr_not_deployed'); return; }
    const dest = I.inserted ? I.s : (G.inserted ? G.s : 0);
    const wait = this.time - S.deployTime;
    const asp = !!this.aspiration;
    const interGap = (S.target && I.inserted) ? S.target.o.S0 - I.s : Infinity;
    const solumbra = asp && I.inserted && this.aspSource === 'inter' && interGap < 15;
    const prox = asp && !I.inserted;
    this.anim = { type: 'retrieve', t: 0, dur: 3.0, fromS: S.s, fromM: M.s, dest: Math.min(dest, M.s),
      q: { cov: S.target ? S.target.cov : 0, over: S.target ? S.target.overhang : -99, wait, asp, interGap, solumbra, prox,
        pushOut: S.pushOut || 0, fluff: S.fluff || 0, unsheath: S.unsheath || 0, clot: S.target ? S.target.o.c : null } };
    this.msg('info', 'retrieving');
  };

  Sim.prototype.withdrawAspiration = function () {
    const I = this.devices.inter, G = this.devices.guide;
    if (this.anim) return;
    if (!I.inserted) { this.msg('warn', 'need_inter'); return; }
    if (this.devices.sr.deployed || this.srExposed() > 0.5) { this.msg('warn', 'sr_deployed_retrieve'); return; }
    const st = this.aspirationState();
    const q = { asp: this.aspiration, gap: st.gap, engaged: this.engagedTime, corked: this.corked, microAcross: st.microAcross, clot: st.clot || null };
    this.anim = { type: 'aspirate', t: 0, dur: 3.0, from: I.s, to: G.inserted ? Math.max(0, G.s - 2) : 0, q };
    this.msg('info', 'withdrawing');
  };

  // ---------- Thrombectomy outcome ----------
  // wantSmall=false: a major downstream branch (M2 division if available); true: a distal leaf branch (M3/M4, ATA)
  Sim.prototype.pickDescendant = function (segId, wantSmall) {
    const out = [], major = [];
    const walk = id => { this.seg(id).children.forEach(k => { const s = this.seg(k);
      if (wantSmall ? (s.territory && !s.children.length && !/LS/.test(s.lbl)) : (!s.small && s.territory)) out.push(k);
      if (!wantSmall && !s.small && /^M2/.test(s.lbl)) major.push(k);
      walk(k); }); };
    walk(segId);
    if (major.length) return major[Math.floor(rnd() * major.length)];
    return out.length ? out[Math.floor(rnd() * out.length)] : null;
  };

  Sim.prototype.resolvePass = function (technique, q) {
    this.passes++;
    const clot = q.clot && !q.clot.removed ? q.clot : null;
    let p = 0, frag = 0, ent = 0;
    const notes = [];
    const pen = 0.03 * (this.passes - 1);
    if (technique === 'asp') {
      if (!q.asp) { p = 0.02; notes.push('fb_no_suction'); }
      else {
        const eq = q.gap <= 1.5 ? 1 : q.gap <= 4 ? 0.4 : 0;
        if (eq < 1) notes.push('fb_not_engaged');
        if (q.engaged < 60) notes.push('fb_short_wait_asp');
        if (q.microAcross) notes.push('fb_micro_across');
        // larger bore: better clot ingestion (force ~ lumen area)
        const bf = this.boreFactor();
        if (bf < 0.75) notes.push('fb_small_bore');
        p = 0.15 + 0.42 * eq + 0.15 * clamp(q.engaged / 90, 0, 1) + (q.corked ? 0.05 : 0) - (q.microAcross ? 0.15 : 0) - pen + 0.2 * (bf - 1);
      }
      p = clamp(p, 0.02, 0.72 + 0.12 * Math.max(0, this.boreFactor() - 1));
      frag = (1 - p) * 0.5 + (q.engaged < 20 ? 0.12 : 0);
      ent = q.asp && q.corked ? 0.02 : 0.08;
    } else {
      const cov = q.cov;
      if (cov < 0.3) { p = 0.03; notes.push('fb_sr_poor_cov'); }
      else {
        const wb = q.wait < 60 ? 0 : clamp((q.wait - 60) / 240, 0, 1) * 0.15;
        if (q.wait < 180) notes.push('fb_short_wait_sr');
        if (q.over < 3) notes.push('fb_sr_short_distal');
        if (!q.asp) notes.push('fb_no_asp_sr');
        else if (q.prox) notes.push('fb_prox_asp');
        else if (!q.solumbra) notes.push('fb_inter_far');
        const pushPen = Math.min(0.25, (q.pushOut || 0) / 40);
        if ((q.pushOut || 0) > 4) notes.push('fb_sr_pushed');
        const fl = q.fluff || 0, fluffT = fl >= 3 && fl <= 10 ? 0.06 : fl > 10 ? -0.05 : 0;
        if (fl >= 3 && fl <= 10) notes.push('fb_fluff_good'); else if (fl > 10) notes.push('fb_fluff_over');
        p = 0.2 + 0.35 * cov + (q.over >= 5 ? 0.08 : q.over >= 0 ? 0 : -0.15) + wb + (q.asp ? 0.08 : 0) + (q.solumbra ? 0.07 + 0.06 * (this.boreFactor() - 1) : q.prox ? 0.03 : 0) + fluffT - pushPen - pen;
      }
      p = clamp(p, 0.02, 0.8);
      frag = (1 - p) * 0.45 * (q.asp ? 0.7 : 1.2) + Math.min(0.1, (q.pushOut || 0) / 100);
      ent = q.solumbra ? 0.02 : q.asp ? 0.04 : 0.1;
    }
    let result = 'fail';
    if (clot) {
      const r = rnd();
      if (r < p) {
        result = 'success'; clot.removed = true;
        if (rnd() < (technique === 'asp' || q.asp ? 0.15 : 0.25)) {
          const t = this.pickDescendant(clot.seg, true);
          if (t) { this.addClot(t, 4, 8, { minor: true }); result = 'success_minor'; }
        }
      } else if (r < p + frag) {
        result = 'fragment'; clot.removed = true;
        let t = this.pickDescendant(clot.seg, false) || this.pickDescendant(clot.seg, true);
        if (t) { const sg = this.seg(t); this.addClot(t, Math.min(4, sg.len * 0.2), Math.min(14, sg.len * 0.5), {}); }
      }
      if (rnd() < ent) {
        this.addClot('LA2', 10, 20, { ent: true });
        this.addComplication('ent');
      }
    } else notes.push('fb_no_target');
    this.clots.forEach(c => { c.bypass = false; });
    const tici = this.computeTici();
    this.passResults.push({ technique, result, tici, p: Math.round(p * 100), time: this.time });
    if (this.passes === 1) this.firstPassTici = tici;
    this.msg(result.startsWith('success') ? 'good' : 'warn', 'pass_result_' + result, { n: this.passes, tech: technique });
    notes.forEach(k => this.msg('tip', k));
    this.pendingRun = 1.0; // auto control run
    this.emit('pass', { technique, result, tici });
  };

  Sim.prototype.addClot = function (seg, s0, s1, opts) {
    const c = Object.assign({ seg, s0, s1, removed: false, bypass: false }, opts || {});
    this.clots.push(c); return c;
  };

  // Perfusion of the target (left MCA) territory and mTICI grade
  Sim.prototype.segFlow = function (segId) {
    // flow multiplier reaching the END of segment (1 = normal)
    let f = 1; const chain = this.seg(segId).chain;
    for (const id of chain) {
      this.clots.forEach(c => { if (!c.removed && c.seg === id) f *= c.minor ? 0.65 : c.bypass ? 0.4 : 0; });
    }
    return f;
  };
  Sim.prototype.mcaPerfusion = function () {
    let tot = 0, perf = 0;
    this.anat.list.forEach(s => { if (s.mca && s.territory) { tot += s.territory; perf += s.territory * this.segFlow(s.id); } });
    return tot ? perf / tot : 1;
  };
  Sim.prototype.computeTici = function () {
    if (!this.clots.length) return null;
    const p = this.mcaPerfusion();
    let g = p < 0.08 ? '0' : p < 0.2 ? '1' : p < 0.5 ? '2a' : p < 0.9 ? '2b' : p < 0.999 ? '2c' : '3';
    return g;
  };

  // ---------- Contrast ----------
  Sim.prototype.injectSource = function () {
    const D = this.devices;
    if (D.diag.inserted) return D.diag;
    if (D.guide.inserted) return D.guide;
    if (D.inter.inserted) return D.inter;
    return null;
  };
  Sim.prototype.inject = function (via) {
    if (this.run || this.anim) return false;
    let dev = via ? this.devices[via] : this.injectSource();
    if (!dev || !dev.inserted || dev.kind !== 'catheter') { this.msg('warn', 'need_catheter_inject'); return false; }
    const loc = this.locate(dev.s);
    const roadmapCapture = this.roadmapOn;
    const vol = dev.id === 'micro' ? 2 : roadmapCapture ? 4 : (loc.seg.aortic ? (dev.shape === 'pig' ? 30 : 20) : 7);
    this.contrast += vol;
    const fill = this.computeFill(loc.seg.id, loc.local);
    let maxD = 0; fill.forEach(e => { maxD = Math.max(maxD, e.d0 + Math.abs(e.b - e.a)); });
    this.run = { t: 0, fill, dur: Math.min(8, maxD / FLOW_V + 3.4), roadmapCapture, via: dev.id, vol, srcSeg: loc.seg.id };
    this.lastRun = this.run;
    this.msg('info', roadmapCapture ? 'roadmap_puff' : 'dsa_run', { vol, dev: dev.id });
    this.emit('run');
    return true;
  };

  Sim.prototype.computeFill = function (segId, local) {
    const out = [];
    const push = (seg, a, b, d0, k) => { if (Math.abs(b - a) > 0.01 && k > 0.02) out.push({ seg, a, b, d0, k }); };
    const fwd = (id, s0, d, k, depth) => {
      if (depth > 30) return;
      const sg = this.seg(id);
      let end = sg.len, kk = k, blocked = false, dd = d;
      const cl = this.clots.filter(c => !c.removed && c.seg === id && c.s1 > s0).sort((a, b) => a.s0 - b.s0)[0];
      if (cl) {
        if (cl.bypass || cl.minor) { push(id, s0, cl.s0, d, k); dd = d + (cl.s0 - s0) + 25; kk = k * 0.45; push(id, cl.s0, end, dd, kk); dd += end - cl.s0; }
        else { push(id, s0, Math.max(s0, cl.s0), d, k); blocked = true; }
      } else { push(id, s0, end, d, k); dd = d + end - s0; }
      if (blocked) return;
      sg.children.forEach(ch => fwd(ch, 0, dd, kk * (sg.children.length > 1 ? 0.92 : 1), depth + 1));
    };
    const rev = (id, s, d, k, depth) => {
      if (depth > 30) return;
      const sg = this.seg(id);
      push(id, s, 0, d, k);
      const dJ = d + s;
      if (!sg.parent) return;
      const par = this.seg(sg.parent);
      par.children.forEach(sib => { if (sib !== id) fwd(sib, 0, dJ, k * 0.85, depth + 1); });
      if (par.aortic) rev(par.id, par.len, dJ, k * 0.9, depth + 1);
    };
    const sg = this.seg(segId);
    if (sg.aortic) {
      rev(segId, local, 0, 1, 0);
      push(segId, local, Math.min(sg.len, local + 25), 0, 0.6);
      if (sg.len - local < 6) sg.children.forEach(ch => { if (!this.seg(ch).aortic) fwd(ch, 0, sg.len - local, 0.8, 1); });
    } else {
      fwd(segId, local, 0, 1, 0);
      push(segId, local, Math.max(0, local - 10), 0, 0.5);
    }
    return out;
  };

  // intensity of contrast at distance d during run time t
  Sim.prototype.contrastAt = function (d, t, k) {
    const front = clamp((FLOW_V * t - d) / 25, 0, 1);
    const fade = 1 - clamp((t - d / FLOW_V - 1.9) / 1.3, 0, 1);
    return k * front * fade;
  };

  Sim.prototype.toggleRoadmap = function () {
    this.roadmapOn = !this.roadmapOn;
    if (!this.roadmapOn) this.roadmap = null;
    this.msg('info', this.roadmapOn ? 'roadmap_on' : 'roadmap_off');
    this.emit('change');
  };

  Sim.prototype.wait = function (sec) {
    if (this.anim || this.finished) return;
    this.time += sec; this.tickPhysiology(sec);
    this.msg('info', 'waited', { s: sec });
  };

  // ---------- Update loop ----------
  Sim.prototype.tickPhysiology = function (dt) {
    // aspiration engagement
    if (this.aspiration && this.devices.inter.inserted && this.aspSource !== 'guide') {
      const st = this.aspirationState();
      if (st.gap <= 1.5) {
        this.engagedTime += dt;
        if (this.engagedTime > 8 && !this.corked) { this.corked = true; this.msg('good', 'corked'); }
      } else {
        if (this.engagedTime > 0) this.engagedTime = 0;
        this.corked = false;
        this.bloodLoss += 6 * dt;
        if (this.bloodLoss > 150) this.warnOnce('blood', 'warn', 'blood_loss');
      }
    }
    // catheter-induced vasospasm (dwell of large catheters in small vessels)
    ['guide', 'inter'].forEach(id => {
      const d = this.devices[id]; if (!d.inserted) return;
      const seg = this.locate(d.s).seg; if (seg.aortic) return;
      const ratio = d.od / (2 * seg.r);
      if (ratio > 0.6) this.spasm += dt * (ratio - 0.6) * 0.012;
    });
    if (this.spasm > 0.5) this.warnOnce('spw', 'warn', 'spasm_warn');
    if (this.spasm >= 1 && !this.complications.some(c => c.type === 'vasospasm')) this.addComplication('vasospasm');
  };

  Sim.prototype.update = function (dt) {
    if (this.caseEndAt != null && this.time >= this.caseEndAt && !this.finished) { this.caseEndAt = null; this.endCase(); return; }
    if (this.finished) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    // input
    if (!this.anim) {
      const inp = this.input, dev = this.devices[this.active];
      if (!inp.adv && this.devices.sr.tipLatch) this.devices.sr.tipLatch = false;
      if (this.advLatch && (inp.adv <= 0 || this.active !== this.advLatch)) this.advLatch = null;
      if (inp.adv && dev && dev.inserted && !(this.advLatch && inp.adv > 0)) this.move(this.active, inp.adv * SPEED * (inp.fast ? FAST : 1) * dt, inp.fast);
      if (inp.rot) this.rotate(inp.rot * (inp.fast ? 150 : 45) * dt);
      const D0 = this.devices;
      if (inp.unsheath && D0.sr.inserted && D0.micro.inserted && !this.anim) this.move('micro', -SPEED * 0.6 * dt);
      if (inp.fluff && D0.sr.inserted && !this.anim) this.move('sr', SPEED * 0.25 * dt);
    }
    // scripted animations
    if (this.anim) {
      const a = this.anim; a.t += dt; const f = clamp(a.t / a.dur, 0, 1); this.bumpFluoro();
      const D = this.devices;
      if (a.type === 'unsheath') {
        const e0 = this.srExposed();
        D.micro.s = Math.max(0, a.from + (a.to - a.from) * f);
        const gain = this.srExposed() - e0; if (gain > 0) D.sr.unsheath += gain;
        if (f >= 1) { this.anim = null; this.trimTrack(); }
        const keep = this.anim; this.anim = null; this.updateSR(); this.anim = keep;
      }
      else if (a.type === 'retrieve') {
        D.sr.s = a.fromS + (a.dest - a.fromS) * f; D.micro.s = Math.min(D.micro.s, a.fromM + (a.dest - a.fromM) * f);
        if (f >= 1) {
          this.anim = null; D.sr.inserted = false; D.sr.deployed = false; D.micro.inserted = false; this.aspiration = false; this.engagedTime = 0; this.corked = false;
          if (D.mwire.inserted) D.mwire.inserted = false;
          this.trimTrack(); this.active = D.inter.inserted ? 'inter' : 'guide';
          this.resolvePass('sr', a.q); this.emit('change');
        }
      } else if (a.type === 'aspirate') {
        D.inter.s = a.from + (a.to - a.from) * f;
        ['micro', 'wire', 'mwire', 'sr'].forEach(k => { if (D[k].inserted && D[k].s > D.inter.s) D[k].s = D.inter.s; });
        if (f >= 1) {
          this.anim = null; this.aspiration = false; this.engagedTime = 0; this.corked = false;
          this.trimTrack(); this.resolvePass('asp', a.q); this.emit('change');
        }
      }
    }
    this.tickPhysiology(dt);
    this.updateShapes(dt);
    this.trackSelections();
    // fluoroscopy
    if (this.fluoroHold > 0) this.fluoroHold -= dt;
    const fluoroOn = this.pedal || this.fluoroHold > 0 || !!this.run;
    if (fluoroOn) this.fluoroTime += dt;
    this.fluoroOn = fluoroOn;
    // contrast run
    if (this.run) {
      this.run.t += dt;
      if (this.run.roadmapCapture && this.run.t > 1.2 && !this.run.captured) {
        this.roadmap = this.run.fill.filter(e => e.k > 0.3).map(e => Object.assign({}, e)); this.run.captured = true;
      }
      if (this.run.t >= this.run.dur) { this.onRunEnd(this.run); this.run = null; }
    }
    if (this.pendingRun != null) {
      this.pendingRun -= dt;
      if (this.pendingRun <= 0) { this.pendingRun = null; const was = this.roadmapOn; this.roadmapOn = false; this.inject(); this.roadmapOn = was; }
    }
    // scenario goals
    if (this.scenario && this.scenario.tick) this.scenario.tick(this);
  };

  Sim.prototype.onRunEnd = function (run) {
    if (!this.clots.length) return;
    // Did the run show the target MCA territory?
    const showsMca = run.fill.some(e => this.seg(e.seg).id === 'LM1a' || this.seg(e.seg).id === 'LICAt');
    if (!showsMca) return;
    const g = this.computeTici();
    this.lastTici = g;
    if ((g === '2b' || g === '2c' || g === '3') && this.reperfTime == null && this.passes > 0) this.reperfTime = this.time;
    this.msg(g === '3' || g === '2c' ? 'good' : g === '2b' ? 'info' : 'warn', 'tici_result', { g });
    this.emit('tici', g);
  };

  // ---------- Debrief ----------
  Sim.prototype.endCase = function () {
    this.finished = true; this.aspiration = false;
    const r = this.scenario && this.scenario.score ? this.scenario.score(this) : NIR.scoring.generic(this);
    this.debrief = r; this.emit('debrief', r);
    return r;
  };

  Sim.prototype.snapshot = function () {
    const D = this.devices, tipDev = D[this.active];
    const loc = this.locate(tipDev && tipDev.inserted ? tipDev.s : this.maxTip());
    return {
      time: this.time, fluoro: this.fluoroTime, contrast: this.contrast, passes: this.passes,
      tici: this.lastTici, seg: loc.seg.id, active: this.active, torque: (D.mwire.inserted ? D.mwire : D.wire).torque, srPhase: this.srPhase(), srExposed: this.srExposed(),
      asp: this.aspiration, corked: this.corked, engaged: this.engagedTime
    };
  };

  // Seedable RNG (for reproducible tests)
  let seed = (Date.now() & 0xffffffff) >>> 0;
  function mulberry() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }

  NIR.sim = { Sim, REV, GWIRE_TYPES, ASP_SIZES, GUIDE_SIZES, DEVICE_DEFS, DEVICE_ORDER, SHAPES, MICRO_SIZES, MWIRE_SIZES, SR_SIZES, GUIDE_SHAPES, DIAG_SHAPES, rng: mulberry, setSeed: s => { seed = s >>> 0; }, clamp };
})(window.NIR = window.NIR || {});
