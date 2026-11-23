/* NIR-Sim anatomy: simplified 3D vessel centerlines (units ~ mm).
   Axes: x = patient's LEFT (+), y = caudal (+, i.e. screen down), z = ANTERIOR (+).
   AP view shows (x, y) with patient's left on the viewer's right; lateral shows (z, y) with anterior on the left.
   The tree is rooted at the right common femoral access; every branch point is a segment end.
   The aortic arch is generated per arch TYPE (I/II/III) and VARIANT (normal, bovine, LCCA-from-BCA,
   aberrant right subclavian, direct left vertebral origin). */
(function (NIR) {
  'use strict';

  const ARCH_TYPES = ['I', 'II', 'III'];
  const VARIANTS = ['normal', 'bovine', 'lccaFromBca', 'aberrantRSA', 'directLVA'];

  // Arch centerline control points (from top of descending aorta, over the arch, to the aortic valve)
  const ARCH_CURVES = {
    I: [[520, 470, -34], [519, 425, -30], [512, 390, -22], [494, 368, -10], [468, 360, 3], [443, 366, 16], [424, 385, 26], [412, 420, 32], [412, 470, 35], [420, 510, 36], [428, 535, 36]],
    II: [[520, 470, -34], [519, 420, -30], [513, 375, -22], [496, 349, -10], [470, 340, 3], [444, 348, 16], [425, 370, 26], [413, 410, 32], [412, 465, 35], [420, 510, 36], [428, 535, 36]],
    III: [[520, 470, -34], [519, 410, -30], [514, 358, -22], [498, 328, -10], [471, 318, 3], [445, 327, 16], [425, 352, 26], [413, 395, 32], [411, 455, 35], [420, 505, 36], [428, 535, 36]]
  };
  // Origin positions along the arch, in mm of arc length relative to the arch apex (+ = toward the ascending aorta)
  const ORIGINS = {
    I: { LSA: -30, LCCA: -10, BCA: 8 },
    II: { LSA: -15, LCCA: 12, BCA: 32 },
    III: { LSA: -2, LCCA: 38, BCA: 62 }
  };

  const L = (en, ar) => ({ en, ar });
  const LBL = {
    rIliac: L('R femoral / iliac', 'الفخذي / الحرقفي الأيمن'), abdAorta: L('Abdominal aorta', 'الأبهر البطني'), descAorta: L('Descending aorta', 'الأبهر النازل'),
    arch: L('Aortic arch', 'قوس الأبهر'), ascAorta: L('Ascending aorta', 'الأبهر الصاعد'),
    BCA: L('Brachiocephalic trunk', 'الجذع العضدي الرأسي'), RSA: L('Right subclavian a.', 'الشريان تحت الترقوة الأيمن'), aRSA: L('Aberrant right subclavian a.', 'الشريان تحت الترقوة الأيمن الشاذ'),
    RCCA: L('Right CCA', 'السباتي المشترك الأيمن'), RVA: L('Right vertebral a.', 'الفقري الأيمن'), LCCA: L('Left CCA', 'السباتي المشترك الأيسر'),
    LSA: L('Left subclavian a.', 'الشريان تحت الترقوة الأيسر'), LVA: L('Left vertebral a.', 'الفقري الأيسر')
  };
  // side-specific names: [en, ar]
  const SIDED = {
    ECA: ['ECA', 'السباتي الظاهر'], ICAc: ['ICA (cervical)', 'السباتي الباطن (العنقي)'], ICAp: ['ICA (petrous/cavernous)', 'السباتي الباطن (الصخري/الكهفي)'],
    Oph: ['ophthalmic a.', 'الشريان العيني'], ICAs: ['ICA (supraclinoid)', 'السباتي الباطن (فوق السريري)'], ICAt: ['ICA terminus', 'نهاية السباتي الباطن'],
    PCom: ['PComm', 'الشريان الموصل الخلفي'], M1: ['M1', 'M1'], M1a: ['M1 (proximal)', 'M1 (القريب)'], M1b: ['M1 (lenticulostriate segment)', 'M1 (قطعة العدسية المخططة)'],
    M1c: ['M1 (distal)', 'M1 (البعيد)'], M1d: ['M1 (genu)', 'M1 (الركبة)'], LS: ['lenticulostriate a.', 'شريان عدسي مخطط'], ATA: ['anterior temporal a.', 'الشريان الصدغي الأمامي'],
    M2s: ['M2 superior division', 'M2 القسم العلوي'], M2i: ['M2 inferior division', 'M2 القسم السفلي'],
    M3f: ['M3/M4 frontal', 'M3/M4 الجبهي'], M3p: ['M3/M4 parietal', 'M3/M4 الجداري'], M3t: ['M3/M4 temporal', 'M3/M4 الصدغي'], M3a: ['M3/M4 angular', 'M3/M4 الزاوي'],
    A1: ['ACA A1', 'الدماغي الأمامي A1'], A2: ['ACA A2', 'الدماغي الأمامي A2'], ACom: ['AComm', 'الشريان الموصل الأمامي'],
    Peri: ['pericallosal a.', 'الشريان حول الثفني'], CM: ['callosomarginal a.', 'الشريان الثفني الهامشي'], P1: ['PCA P1', 'الدماغي الخلفي P1'], P2: ['PCA P2', 'الدماغي الخلفي P2'],
    SCA: ['SCA', 'المخيخي العلوي'], AICA: ['AICA', 'المخيخي الأمامي السفلي'], PICA: ['PICA', 'المخيخي الخلفي السفلي']
  };
  const MIDLINE = { BA: L('Basilar a.', 'الشريان القاعدي'), VA4: L('Vertebral a. (V4)', 'الفقري (V4)') };
  function label(d) {
    if (LBL[d.lbl]) return LBL[d.lbl];
    if (MIDLINE[d.lbl]) return MIDLINE[d.lbl];
    const n = SIDED[d.lbl]; if (!n) return L(d.id, d.id);
    let side = d.side;
    if (d.posterior) side = /^[LR]/.test(d.id) ? d.id[0] : d.id.slice(-1);
    return side === 'R' ? L('Right ' + n[0], n[1] + ' الأيمن') : L('Left ' + n[0], n[1] + ' الأيسر');
  }


  // Fixed (non-arch) segments. parent may be a placeholder resolved by the arch builder.
  // The body (femoral -> arch) is deliberately SHORT so groin-to-neck navigation takes only a few seconds.
  function fixedDefs() {
    return [
      { id: 'rIliac', parent: null, r: 4.5, aortic: true, lbl: 'rIliac', pts: [[440, 930, 22], [447, 890, 12], [468, 850, -5], [496, 815, -15]] },
      { id: 'abdAorta', parent: 'rIliac', r: 9, aortic: true, lbl: 'abdAorta', pts: [[496, 815, -15], [503, 760, -22], [510, 700, -28]] },
      { id: 'descAorta', parent: 'abdAorta', r: 11, aortic: true, lbl: 'descAorta', pts: [[510, 700, -28], [516, 600, -34], [520, 470, -34]] }
    ];
  }

  // ---- Intracranial anatomy ----
  // Designed in anatomic mm relative to the left/right carotid termini level (x lateral +left, y caudal, z anterior),
  // then magnified by HEAD_K so the head occupies most of the view. W() converts to world coordinates.
  const HEAD = { x: 500, y: -215, z: 0 }, HEAD_K = 1.6;
  const SKULL = { cx: 500, cy: -226, cz: -15, rx: 132, ry: 132, rz: 136 };
  const W = (p, g) => [HEAD.x + HEAD_K * p[0] * (g || 1), HEAD.y + HEAD_K * p[1], HEAD.z + HEAD_K * p[2]];
  const Wl = (arr, g) => arr.map(p => W(p, g));

  function headDefs(opts) {
    const tort = opts && opts.siphon === 'tortuous';
    const d = [];
    const S = (side, id, parent, r, lbl, pts, extra) => d.push(Object.assign({ id: side + id, parent: parent, r, lbl, side, pts: Wl(pts, side === 'R' ? -1 : 1), head: true }, extra || {}));
    // cervical carotids + ECA (world coords)
    d.push({ id: 'LECA', parent: 'LCCA', r: 2.0, lbl: 'ECA', side: 'L', pts: [[494, 110, 0], [484, 80, 15], [476, 40, 25], [470, 0, 30], [466, -30, 32]] });
    d.push({ id: 'LICAc', parent: 'LCCA', r: 2.6, lbl: 'ICAc', side: 'L', pts: [[494, 110, 0], [500, 40, -8], [515, -40, -14], [533, -110, -20], W([24, 34, -14])] });
    d.push({ id: 'RECA', parent: 'RCCA', r: 2.0, lbl: 'ECA', side: 'R', pts: [[406, 110, 2], [420, 70, 15], [428, 20, 25], [430, -20, 30]] });
    d.push({ id: 'RICAc', parent: 'RCCA', r: 2.6, lbl: 'ICAc', side: 'R', pts: [[406, 110, 2], [404, 40, -8], [440, -40, -14], [467, -110, -20], W([-24, 34, -14])] });
    ['L', 'R'].forEach(s => {
      // carotid siphon (petrous/cavernous ICA up to the ophthalmic origin); 'tortuous' = tight, redundant loops
      S(s, 'ICAp', s + 'ICAc', 2.4, 'ICAp', tort
        ? [[24, 34, -14], [28, 29, -12], [25, 24, -4], [17, 23, 3], [12, 19, 10], [13, 13, 16], [19, 10, 15], [21, 8, 11], [18, 6, 8]]
        : [[24, 34, -14], [22, 26, -6], [17, 20, 4], [16, 16, 12], [18, 10, 12], [18, 6, 8]]);
      S(s, 'Oph', s + 'ICAp', 0.7, 'Oph', [[18, 6, 8], [16, 4, 18], [20, 2, 30], [26, 0, 38]], { small: true });
      S(s, 'ICAs', s + 'ICAp', 2.2, 'ICAs', [[18, 6, 8], [18, 4.5, 6.5], [18, 3, 5]]);
      S(s, 'PCom', s + 'ICAs', 0.75, 'PCom', [[18, 3, 5], [14, 4, -4], [10, 5, -12]]);
      S(s, 'P2c', s + 'PCom', 1.0, 'P2', [[10, 5, -12], [18, 4, -24], [24, 0, -40], [26, -8, -56], [22, -14, -64]], { pcaTerr: true });
      S(s, 'ICAt', s + 'ICAs', 2.1, 'ICAt', [[18, 3, 5], [18, 1.5, 3.5], [18, 0, 2]]);
      S(s, 'A1', s + 'ICAt', 1.1, 'A1', [[18, 0, 2], [12, -2, 6], [4, -3, 10]]);
    });
    // Left MCA — detailed (clot side). M1 is short: ICA-T -> M1a (clot) -> M1b (lenticulostriates) -> M1c (ant. temporal) -> M1d -> genu
    S('L', 'M1a', 'LICAt', 1.5, 'M1a', [[18, 0, 2], [22, -0.5, 2], [26, -1, 1]]);
    S('L', 'M1b', 'LM1a', 1.45, 'M1b', [[26, -1, 1], [28, -1, 0.5], [30, -1, 0]]);
    S('L', 'LS1', 'LM1b', 0.4, 'LS', [[30, -1, 0], [31, -7, 5], [30, -15, 8]], { small: true, territory: 0.03 });
    S('L', 'LS2', 'LM1b', 0.4, 'LS', [[30, -1, 0], [32, -9, -1], [33, -17, -2]], { small: true, territory: 0.03 });
    S('L', 'M1c', 'LM1b', 1.4, 'M1c', [[30, -1, 0], [33, -0.5, -1], [35, 0, -1]]);
    S('L', 'ATA', 'LM1c', 0.7, 'ATA', [[35, 0, -1], [40, 5, 6], [47, 9, 10], [54, 10, 12]], { territory: 0.06 });
    S('L', 'M1d', 'LM1c', 1.35, 'M1d', [[35, 0, -1], [38, 0.5, -2], [40, 1, -3]]);
    S('L', 'M2s', 'LM1d', 1.1, 'M2s', [[40, 1, -3], [44, -6, 0], [48, -14, 2], [52, -22, 4]]);
    S('L', 'M3s1', 'LM2s', 0.8, 'M3f', [[52, -22, 4], [52, -34, 14], [48, -48, 22], [42, -62, 26]], { territory: 0.2 });
    S('L', 'M3s2', 'LM2s', 0.8, 'M3p', [[52, -22, 4], [57, -36, -2], [57, -50, -8], [50, -62, -14]], { territory: 0.2 });
    S('L', 'M2i', 'LM1d', 1.0, 'M2i', [[40, 1, -3], [46, 2, -8], [52, 1, -14], [56, -2, -20]]);
    S('L', 'M3i1', 'LM2i', 0.8, 'M3t', [[56, -2, -20], [62, 4, -28], [66, 10, -38], [66, 16, -48]], { territory: 0.24 });
    S('L', 'M3i2', 'LM2i', 0.8, 'M3a', [[56, -2, -20], [60, -12, -30], [60, -26, -40], [56, -40, -50]], { territory: 0.24 });
    // Right MCA — simplified
    S('R', 'M1', 'RICAt', 1.4, 'M1', [[18, 0, 2], [26, -1, 1], [35, 0, -1], [40, 1, -3]]);
    S('R', 'M2s', 'RM1', 1.0, 'M2s', [[40, 1, -3], [48, -14, 2], [52, -34, 10], [48, -55, 16]]);
    S('R', 'M2i', 'RM1', 0.95, 'M2i', [[40, 1, -3], [52, 1, -14], [62, 6, -30], [64, 12, -44]]);
    // ACA: A2 with pericallosal / callosomarginal, AComm (left -> right A2)
    S('L', 'ACom', 'LA1', 0.6, 'ACom', [[4, -3, 10], [0, -3, 11], [-4, -3, 10]]);
    d.push({ id: 'RA2c', parent: 'LACom', r: 0.9, lbl: 'A2', side: 'R', head: true, pts: Wl([[-4, -3, 10], [-3, -14, 16], [-3, -26, 18], [-3, -40, 12], [-3, -52, 0]]) });
    S('L', 'A2', 'LA1', 1.0, 'A2', [[4, -3, 10], [3, -14, 16], [3, -26, 18]], { aca: true });
    S('L', 'Peri', 'LA2', 0.8, 'Peri', [[3, -26, 18], [3, -40, 12], [3, -52, 0], [3, -60, -14]], { aca: true, territory: 0.5 });
    S('L', 'CM', 'LA2', 0.8, 'CM', [[3, -26, 18], [4, -40, 24], [5, -56, 18], [5, -68, 4]], { aca: true, territory: 0.5 });
    S('R', 'A2', 'RA1', 0.9, 'A2', [[4, -3, 10], [3, -14, 16], [3, -26, 18], [3, -40, 12], [3, -52, 0]]);
    return d;
  }

  // Posterior circulation reached from one vertebral: V4 -> PICA, vertebrobasilar junction, basilar (AICA, SCA), P1, P2.
  // Each vertebral carries its own copy (suffix) because the centerline tree cannot merge.
  function posteriorTree(side) {
    const g = side === 'R' ? -1 : 1, x = side, d = [];
    const P = (id, parent, r, lbl, pts, extra) => d.push(Object.assign({ id: id + '_' + x, parent: parent ? parent + '_' + x : side + 'VA', r, lbl, pts: Wl(pts), posterior: true, head: true }, extra || {}));
    P('PICA', null, 0.6, 'PICA', [[8 * g, 50, -24], [13 * g, 56, -32], [16 * g, 57, -40], [14 * g, 56, -46]], { small: true });
    P('VA4', null, 1.6, 'VA4', [[8 * g, 50, -24], [4 * g, 46, -22], [0, 42, -20]]);
    P('BA1', 'VA4', 1.6, 'BA', [[0, 42, -20], [0, 36, -19], [0, 30, -18]]);
    P('LAICA', 'BA1', 0.55, 'AICA', [[0, 30, -18], [10, 32, -22], [20, 36, -30]], { small: true });
    P('RAICA', 'BA1', 0.55, 'AICA', [[0, 30, -18], [-10, 32, -22], [-20, 36, -30]], { small: true });
    P('BA2', 'BA1', 1.55, 'BA', [[0, 30, -18], [0, 18, -16], [0, 12, -15]]);
    P('LSCA', 'BA2', 0.7, 'SCA', [[0, 12, -15], [10, 12, -20], [18, 10, -30], [24, 4, -42]]);
    P('RSCA', 'BA2', 0.7, 'SCA', [[0, 12, -15], [-10, 12, -20], [-18, 10, -30], [-24, 4, -42]]);
    P('BA3', 'BA2', 1.5, 'BA', [[0, 12, -15], [0, 10, -14.5], [0, 8, -14]]);
    P('LP1', 'BA3', 1.1, 'P1', [[0, 8, -14], [6, 7, -13], [10, 5, -12]]);
    P('RP1', 'BA3', 1.1, 'P1', [[0, 8, -14], [-6, 7, -13], [-10, 5, -12]]);
    P('LP2', 'LP1', 1.0, 'P2', [[10, 5, -12], [18, 4, -24], [24, 0, -40], [26, -8, -56], [22, -14, -64]]);
    P('RP2', 'RP1', 1.0, 'P2', [[-10, 5, -12], [-18, 4, -24], [-24, 0, -40], [-26, -8, -56], [-22, -14, -64]]);
    return d;
  }

  // vertebral (neck) + its posterior tree
  function posterior(parent, side, start) {
    const g = side === 'R' ? -1 : 1;
    const V = [start];
    const neck = side === 'R'
      ? [[400, 262, -15], [440, 215, -35], [462, 150, -42], [468, 60, -45], [470, -20, -45], [462, -60, -50], [472, -85, -60], [486, -122, -45]]
      : [[548, 300, -22], [540, 230, -36], [536, 150, -42], [532, 60, -45], [530, -20, -45], [538, -60, -50], [528, -85, -60], [514, -122, -45]];
    neck.forEach(p => V.push(p));
    V.push(W([8 * g, 50, -24]));
    return [{ id: side + 'VA', parent, r: 1.8, vessel: side + 'VA', lbl: side + 'VA', pts: V }].concat(posteriorTree(side));
  }

  const add = (p, d) => [p[0] + d[0], p[1] + d[1], p[2] + d[2]];

  function catmull(P3, step) {
    const P = P3.map(p => ({ x: p[0], y: p[1], z: p[2] || 0 }));
    const n = P.length, dense = [];
    for (let i = 0; i < n - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n - 1, i + 2)];
      const N = n > 40 ? 2 : 24;
      for (let k = 0; k < N; k++) {
        const t = k / N, t2 = t * t, t3 = t2 * t;
        const f = c => 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
        dense.push({ x: f('x'), y: f('y'), z: f('z') });
      }
    }
    dense.push(Object.assign({}, P[n - 1]));
    const out = [{ x: dense[0].x, y: dense[0].y, z: dense[0].z, s: 0 }];
    let acc = 0, next = step;
    for (let i = 1; i < dense.length; i++) {
      const a = dense[i - 1], b = dense[i];
      const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      while (d > 0 && acc + d >= next) {
        const f = (next - acc) / d;
        out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f, s: next });
        next += step;
      }
      acc += d;
    }
    const last = dense[dense.length - 1];
    if (acc - out[out.length - 1].s > 0.05) out.push({ x: last.x, y: last.y, z: last.z, s: acc });
    return { pts: out, len: acc };
  }

  // Build arch-dependent definitions
  function archDefs(type, variant) {
    const curve = catmull(ARCH_CURVES[type], 1.0);
    let apex = 0; curve.pts.forEach((p, i) => { if (p.y < curve.pts[apex].y) apex = i; });
    const sApex = curve.pts[apex].s;
    const O = ORIGINS[type];
    // list of branch origins along the arch: {key, s}
    const org = [];
    if (variant === 'aberrantRSA') {
      org.push({ key: 'aRSA', s: sApex + O.LSA - 18 });
      org.push({ key: 'LSA', s: sApex + O.LSA }, { key: 'LCCA', s: sApex + O.LCCA }, { key: 'RCCAdirect', s: sApex + O.BCA });
    } else {
      org.push({ key: 'LSA', s: sApex + O.LSA });
      if (variant === 'directLVA') org.push({ key: 'LVAdirect', s: sApex + (O.LSA + O.LCCA) / 2 });
      if (variant === 'normal' || variant === 'directLVA') org.push({ key: 'LCCA', s: sApex + O.LCCA });
      org.push({ key: 'BCA', s: sApex + O.BCA });
    }
    org.sort((a, b) => a.s - b.s);
    const P = s => { const p = pointAtPts(curve.pts, s); return [p.x, p.y, p.z]; };
    const slice = (a, b) => { const r = [P(a)]; curve.pts.forEach(p => { if (p.s > a + 0.5 && p.s < b - 0.5) r.push([p.x, p.y, p.z]); }); r.push(P(b)); return r; };
    const defs = [];
    let prev = 'descAorta', s0 = 0;
    org.forEach((o, i) => {
      const id = 'arch' + (i + 1);
      defs.push({ id, parent: prev, r: 12 + i * 0.5, aortic: true, lbl: 'arch', pts: slice(s0, o.s) });
      o.parent = id; o.pt = P(o.s); prev = id; s0 = o.s;
    });
    defs.push({ id: 'ascAorta', parent: prev, r: 14, aortic: true, deadEnd: 'valve', lbl: 'ascAorta', pts: slice(s0, curve.len) });

    const LCCAneck = [[480, 300, 4], [482, 250, 4], [490, 150, 2], [494, 110, 0]];
    const BCAend = [[425, 312, 8], [420, 290, 6]];
    const RSAfrom = (parent, start, id, lbl) => ([
      { id: id + '1', parent, r: 4.5, vessel: 'RSA', lbl, pts: start },
      { id: id + '2', parent: id + '1', r: 4.2, vessel: 'RSA', lbl, pts: [[392, 285, 0], [370, 289, -2], [330, 300, -4], [280, 320, -4]] }
    ]);
    const LSAstd = (o, withLVA) => withLVA ? [
      { id: 'LSA1', parent: o.parent, r: 4.5, vessel: 'LSA', lbl: 'LSA', pts: [o.pt, add(o.pt, [6, -14, -4]), [528, 333, -10], [545, 325, -11]] },
      { id: 'LSA2', parent: 'LSA1', r: 4.3, vessel: 'LSA', lbl: 'LSA', pts: [[545, 325, -11], [570, 320, -12], [620, 321, -10], [680, 336, -8], [720, 352, -6]] }
    ].concat(posterior('LSA1', 'L', [545, 325, -11])) : [
      { id: 'LSA1', parent: o.parent, r: 4.5, vessel: 'LSA', lbl: 'LSA', pts: [o.pt, add(o.pt, [6, -14, -4]), [528, 333, -10], [570, 320, -12], [620, 321, -10], [680, 336, -8], [720, 352, -6]] }
    ];
    org.forEach(o => {
      if (o.key === 'LSA') LSAstd(o, variant !== 'directLVA').forEach(d => defs.push(d));
      if (o.key === 'LVAdirect') posterior(o.parent, 'L', o.pt).forEach((d, i) => { if (i === 0) d.pts.splice(1, 0, add(o.pt, [4, -14, -6])); defs.push(d); });
      if (o.key === 'LCCA') defs.push({ id: 'LCCA', parent: o.parent, r: 3.8, vessel: 'LCCA', lbl: 'LCCA', pts: [o.pt, add(o.pt, [2, -14, -2])].concat(LCCAneck) });
      if (o.key === 'BCA') {
        if (variant === 'bovine') {
          // common origin: BCA and LCCA share one ostium on the arch (3-way junction)
          defs.push({ id: 'BCA1', parent: o.parent, r: 6, vessel: 'BCA', lbl: 'BCA', pts: [o.pt, add(o.pt, [-3, -14, -2])].concat(BCAend) });
          defs.push({ id: 'LCCA', parent: o.parent, r: 3.8, vessel: 'LCCA', lbl: 'LCCA', pts: [o.pt, add(o.pt, [5, -11, -1]), add(o.pt, [18, -24, -1])].concat(LCCAneck) });
        } else if (variant === 'lccaFromBca') {
          const j = add(o.pt, [-2, -16, 0]);
          defs.push({ id: 'BCA1', parent: o.parent, r: 6.5, vessel: 'BCA', lbl: 'BCA', pts: [o.pt, add(o.pt, [-1, -8, 0]), j] });
          defs.push({ id: 'BCA2', parent: 'BCA1', r: 6, vessel: 'BCA', lbl: 'BCA', pts: [j].concat(BCAend) });
          defs.push({ id: 'LCCA', parent: 'BCA1', r: 3.6, vessel: 'LCCA', lbl: 'LCCA', pts: [j, add(j, [10, 3, -1]), add(j, [24, -6, -1]), [482, 250, 4], [490, 150, 2], [494, 110, 0]] });
        } else {
          defs.push({ id: 'BCA1', parent: o.parent, r: 6, vessel: 'BCA', lbl: 'BCA', pts: [o.pt, add(o.pt, [-3, -14, -2])].concat(BCAend) });
        }
        const bif = variant === 'lccaFromBca' ? 'BCA2' : 'BCA1';
        RSAfrom(bif, [[420, 290, 6], [405, 285, 3], [392, 285, 0]], 'RSA', 'RSA').forEach(d => defs.push(d));
        posterior('RSA1', 'R', [392, 285, 0]).forEach(d => defs.push(d));
        defs.push({ id: 'RCCA', parent: bif, r: 3.8, vessel: 'RCCA', lbl: 'RCCA', pts: [[420, 290, 6], [418, 220, 6], [411, 150, 4], [406, 110, 2]] });
      }
      if (o.key === 'RCCAdirect') defs.push({ id: 'RCCA', parent: o.parent, r: 3.8, vessel: 'RCCA', lbl: 'RCCA', pts: [o.pt, add(o.pt, [-3, -14, 0]), [425, 300, 6], [418, 220, 6], [411, 150, 4], [406, 110, 2]] });
      if (o.key === 'aRSA') {
        RSAfrom(o.parent, [o.pt, add(o.pt, [-2, -12, -10]), [490, 345, -40], [450, 315, -36], [412, 294, -18], [392, 285, 0]], 'RSA', 'aRSA').forEach(d => defs.push(d));
        posterior('RSA1', 'R', [392, 285, 0]).forEach(d => defs.push(d));
      }
    });
    return { defs, sApex, curve };
  }

  function pointAtPts(pts, s) {
    const n = pts.length;
    s = Math.max(0, Math.min(pts[n - 1].s, s));
    let i = Math.min(n - 2, Math.max(0, Math.floor(s)));
    while (i > 0 && pts[i].s > s) i--;
    while (i < n - 2 && pts[i + 1].s < s) i++;
    const a = pts[i], b = pts[i + 1];
    const f = (b.s - a.s) > 0 ? (s - a.s) / (b.s - a.s) : 0;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, Ln = Math.hypot(dx, dy, dz) || 1;
    return { x: a.x + dx * f, y: a.y + dy * f, z: a.z + dz * f, tx: dx / Ln, ty: dy / Ln, tz: dz / Ln };
  }

  function build(opts) {
    opts = opts || {};
    const type = ARCH_TYPES.includes(opts.archType) ? opts.archType : 'I';
    const variant = VARIANTS.includes(opts.variant) ? opts.variant : 'normal';
    const arch = archDefs(type, variant);
    const all = fixedDefs().concat(arch.defs).concat(headDefs(opts));
    const segs = {}, list = [];
    all.forEach((d, idx) => {
      const c = catmull(d.pts, 1.0);
      const seg = Object.assign({}, d, { idx, pts: c.pts, len: c.len, children: [], label: label(d) });
      segs[d.id] = seg; list.push(seg);
    });
    list.forEach(s => { if (s.parent) { if (!segs[s.parent]) throw new Error('missing parent ' + s.parent + ' for ' + s.id); segs[s.parent].children.push(s.id); } });
    list.forEach(s => {
      let p = s; const chain = [];
      while (p) { chain.unshift(p.id); p = p.parent ? segs[p.parent] : null; }
      s.chain = chain;
      s.intracranial = !!s.head && !/ICAc$|ECA$/.test(s.id);
      s.mca = chain.includes('LM1a');
      s.arch = s.vessel || null; // the arch-vessel this segment belongs to (BCA, RCCA, RSA, RVA, LCCA, LSA, LVA)
      s.archVessel = chain.map(id => segs[id].vessel).filter(Boolean).pop() || null;
    });
    const vessels = ['BCA', 'RCCA', 'RSA', 'RVA', 'LCCA', 'LSA', 'LVA'].filter(v => list.some(s => s.vessel === v));
    return { segs, list, root: 'rIliac', archType: type, variant, vessels, sApex: arch.sApex, skull: SKULL, siphon: opts.siphon === 'tortuous' ? 'tortuous' : 'normal' };
  }

  function pointAt(seg, s) { return pointAtPts(seg.pts, s); }
  function dirAt(seg, s, span) {
    const a = pointAt(seg, Math.max(0, s - span / 2)), b = pointAt(seg, Math.min(seg.len, s + span / 2));
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, Ln = Math.hypot(dx, dy, dz) || 1;
    return { x: dx / Ln, y: dy / Ln, z: dz / Ln };
  }
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180 / Math.PI;
  // Unsigned 3D angle (deg) between parent's end tangent and child's initial direction
  function branchAngle(parent, child) { return angleBetween(endDir(parent), startDir(child)); }
  function endDir(seg) { return dirAt(seg, seg.len - 4, 8); }
  function startDir(seg) { return dirAt(seg, Math.min(seg.len, 5), 10); }
  // Direction a curved tip points: tangent t bent by A degrees toward the roll direction `torque`
  function tipDir(t, A, torque) {
    let ref = Math.abs(t.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
    const k = dot(ref, t);
    let n1 = { x: ref.x - k * t.x, y: ref.y - k * t.y, z: ref.z - k * t.z };
    const nl = Math.hypot(n1.x, n1.y, n1.z) || 1; n1 = { x: n1.x / nl, y: n1.y / nl, z: n1.z / nl };
    const n2 = { x: t.y * n1.z - t.z * n1.y, y: t.z * n1.x - t.x * n1.z, z: t.x * n1.y - t.y * n1.x };
    const r = torque * Math.PI / 180, a = A * Math.PI / 180;
    const d = { x: Math.cos(r) * n1.x + Math.sin(r) * n2.x, y: Math.cos(r) * n1.y + Math.sin(r) * n2.y, z: Math.cos(r) * n1.z + Math.sin(r) * n2.z };
    return { x: Math.cos(a) * t.x + Math.sin(a) * d.x, y: Math.cos(a) * t.y + Math.sin(a) * d.y, z: Math.cos(a) * t.z + Math.sin(a) * d.z, d };
  }

  NIR.anatomy = { build, SKULL, HEAD, HEAD_K, pointAt, dirAt, branchAngle, endDir, startDir, tipDir, angleBetween, ARCH_TYPES, VARIANTS, SIPHONS: ['normal', 'tortuous'] };
})(window.NIR = window.NIR || {});
