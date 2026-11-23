/* NIR-Sim access phase (engine, no DOM): femoral (landmark fluoro -> ultrasound-guided 21G micropuncture -> 0.018"
   wire -> 4F micropuncture sheath -> optional femoral angiogram -> 0.035" wire exchange for the sheath) or right
   radial (Barbeau test -> ultrasound puncture -> wire -> slender sheath -> spasmolytic cocktail + heparin).
   Geometry is in mm. Femoral fluoro frame: origin = centre of the right femoral head, y caudal (+), x toward the viewer's right on the AP image (medial).
   Ultrasound frame (transverse): x = lateral offset of the needle from the probe centre, depth = mm below the skin.
   Input (keys or touch): sim-style { x: -1|0|1, y: -1|0|1 } held, plus discrete actions via act(name). */
(function (NIR) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const FEM_STEPS = ['site', 'needle', 'wire', 'micro', 'angio', 'sheath', 'done'];
  const RAD_STEPS = ['barbeau', 'needle', 'wire', 'sheath', 'cocktail', 'done'];
  // femoral landmarks (mm, relative to the femoral-head centre)
  const FEM = { headR: 24, ligY: -27, idealY: [-6, 16], okY: [-14, 22], cfaX: 8 };
  const FEM_SHEATHS = [5, 6, 7, 8, 9], RAD_SHEATHS = [5, 6, 7];
  // Glidesheath Slender outer diameters (mm) vs. a typical 2.0-2.8 mm radial artery
  const SLENDER_OD = { 5: 2.13, 6: 2.46, 7: 2.79 };

  function Access(site, opts) {
    opts = opts || {};
    const r = opts.rng || Math.random;
    this.site = site === 'radial' ? 'radial' : 'femoral';
    this.steps = this.site === 'radial' ? RAD_STEPS : FEM_STEPS;
    this.step = this.steps[0];
    this.t = 0; this.log = []; this.flags = {}; this.passes = 0; this.veinHits = 0; this.backWall = 0;
    // patient-specific anatomy
    this.bifY = opts.bifY != null ? opts.bifY : 22 + r() * 16;           // CFA bifurcation, 22-38 mm below the head centre
    this.barbeau = opts.barbeau || (() => { const q = r(); return q < 0.4 ? 'A' : q < 0.75 ? 'B' : q < 0.95 ? 'C' : 'D'; })();
    this.radialD = opts.radialD != null ? opts.radialD : 2.1 + r() * 0.7;  // radial artery lumen (mm)
    // site marker (femoral) starts on the skin crease, which lies BELOW the ideal puncture level
    this.mark = { x: FEM.cfaX, y: 30 };
    // ultrasound target: the artery at the chosen level; vein medial (femoral) or venae comitantes (radial)
    if (this.site === 'radial') {
      this.art = { x: 0, d: 4 + r() * 1.5, r: this.radialD / 2 };
      this.veins = [{ x: -2.6, d: this.art.d + 0.4, r: 0.7 }, { x: 2.6, d: this.art.d + 0.3, r: 0.6 }];
      this.needleMax = 14;
    } else {
      this.art = { x: 0, d: 18 + r() * 8, r: 4 };
      this.veins = [{ x: -11, d: this.art.d + 2, r: 5.5 }];
      this.needleMax = 45;
    }
    this.needle = { x: 6 + (this.site === 'radial' ? -4 : 0), d: 0, inLumen: false, where: 'tissue', moved: false };
    this.wire = 0; this.wireRes = false;
    this.sheathF = this.site === 'radial' ? 6 : 6; this.sheathLong = false;
    this.angio = null; this.cocktail = false; this.heparin = false; this.barbeauDone = false;
    this.done = false; this.result = null;
  }
  Access.prototype.note = function (key, params, level) { this.log.push({ key, params: params || {}, level: level || 'info', t: this.t }); };
  Access.prototype.next = function () { const i = this.steps.indexOf(this.step); this.step = this.steps[Math.min(this.steps.length - 1, i + 1)]; this.note('acc_step_' + this.step); };
  // classification of the arteriotomy level (femoral)
  Access.prototype.siteClass = function (y) {
    y = y == null ? this.mark.y : y;
    if (y < FEM.ligY + 4) return 'high';       // at/above the inguinal ligament: external iliac -> retroperitoneal bleed
    if (y >= this.bifY - 1) return 'low';       // at/below the bifurcation: SFA/PFA -> pseudoaneurysm / AV fistula
    if (y >= FEM.idealY[0] && y <= FEM.idealY[1]) return 'ideal';
    if (y >= FEM.okY[0] && y <= FEM.okY[1]) return 'ok';
    return y < 0 ? 'highish' : 'lowish';
  };
  // where the needle tip is in the ultrasound cross-section
  Access.prototype.tipWhere = function () {
    const n = this.needle, a = this.art;
    const inC = (c, k) => Math.hypot(n.x - c.x, n.d - c.d) <= c.r * (k || 1);
    if (inC(a, 0.85)) return 'artery';
    if (inC(a, 1.15) && n.d > a.d) return 'backwall';
    if (n.d > a.d + a.r && Math.abs(n.x - a.x) < a.r * 0.9) return 'beyond';
    for (const v of this.veins) if (inC(v)) return 'vein';
    return 'tissue';
  };
  // continuous input: x/y in {-1,0,1}; dt seconds
  Access.prototype.update = function (dt, inp) {
    if (this.done) return;
    dt = Math.min(dt, 0.1); this.t += dt; inp = inp || {};
    const st = this.step;
    if (st === 'site') {
      this.mark.y = clamp(this.mark.y + (inp.y || 0) * 18 * dt, -60, 60);
      this.mark.x = clamp(this.mark.x + (inp.x || 0) * 18 * dt, -40, 40);
    } else if (st === 'needle') {
      const n = this.needle, sp = this.site === 'radial' ? 3 : 8;
      if (n.d < 1.5) n.x = clamp(n.x + (inp.x || 0) * (this.site === 'radial' ? 3 : 8) * dt, -20, 20); // re-aim only at the skin
      else if (inp.x) this.flagOnce('aim_skin', 'acc_aim_at_skin');
      if (inp.y) {
        if (inp.y > 0 && n.d < 0.5 && !n.moved) { this.passes++; n.moved = true; }
        n.d = clamp(n.d + inp.y * sp * dt, 0, this.needleMax);
        if (n.d <= 0.2 && inp.y < 0) n.moved = false;
        const w = this.tipWhere();
        if (w !== n.where) {
          if (w === 'artery') this.note('acc_flash_art', {}, 'good');
          else if (w === 'vein') { this.veinHits++; this.note('acc_flash_vein', {}, 'warn'); }
          else if (w === 'backwall' || w === 'beyond') { if (n.where === 'artery') { this.backWall++; this.note('acc_backwall', {}, 'warn'); } }
          n.where = w;
        }
        n.inLumen = w === 'artery';
      }
    } else if (st === 'wire') {
      if (inp.y > 0) {
        if (!this.needle.inLumen || (this.edge && this.wire >= 0.12)) { this.wireRes = true; this.flagOnce('wire_res' + Math.round(this.t), 'acc_wire_resist', 'warn'); this.wireForce = (this.wireForce || 0) + dt; if (this.wireForce > 1.2 && !this.flags.diss) { this.flags.diss = true; this.note('acc_wire_dissection', {}, 'danger'); } }
        else this.wire = clamp(this.wire + dt / 3, 0, 1);
      } else if (inp.y < 0) { this.wire = clamp(this.wire - dt / 2, 0, 1); this.wireForce = 0; }
      if (this.wire >= 1 && !this.flags.wireUp) { this.flags.wireUp = true; this.note('acc_wire_up', {}, 'good'); }
    }
  };
  Access.prototype.flagOnce = function (f, key, level) { if (this.flags[f]) return; this.flags[f] = true; this.note(key, {}, level || 'tip'); };
  // discrete actions: 'confirm' (next / accept), 'inject', 'repuncture', 'sheath+' / 'sheath-', 'long', 'barbeau',
  // 'cocktail', 'heparin', 'back' (withdraw wire to re-needle)
  Access.prototype.act = function (a) {
    if (this.done) return false;
    const st = this.step;
    if (a === 'barbeau' && st === 'barbeau') { this.barbeauDone = true; this.t += 20; this.note('acc_barbeau_' + this.barbeau, {}, this.barbeau === 'D' ? 'danger' : 'good'); return true; }
    if (a === 'sheath+' || a === 'sheath-') {
      const L = this.site === 'radial' ? RAD_SHEATHS : FEM_SHEATHS, i = L.indexOf(this.sheathF);
      this.sheathF = L[clamp(i + (a === 'sheath+' ? 1 : -1), 0, L.length - 1)]; return true;
    }
    if (a === 'long' && this.site === 'femoral') { this.sheathLong = !this.sheathLong; return true; }
    if (a === 'cocktail' && (st === 'cocktail' || st === 'sheath')) { this.cocktail = true; this.t += 30; this.note('acc_cocktail_given', {}, 'good'); return true; }
    if (a === 'heparin' && (st === 'cocktail' || st === 'sheath')) { this.heparin = true; this.t += 10; this.note('acc_heparin_given', {}, 'good'); return true; }
    if (a === 'inject' && st === 'angio') {
      this.angio = { cls: this.siteClass(this.punctureY), y: this.punctureY, bifY: this.bifY }; this.t += 25;
      this.note('acc_angio_' + (['ideal', 'ok'].includes(this.angio.cls) ? 'good' : this.angio.cls), {}, ['ideal', 'ok'].includes(this.angio.cls) ? 'good' : 'warn');
      return true;
    }
    if (a === 'repuncture' && st === 'angio') {
      // remove the micropuncture sheath, hold pressure 5 minutes, start again with the landmark
      this.t += 300; this.flags.repunctured = (this.flags.repunctured || 0) + 1; this.note('acc_repuncture', {}, 'warn');
      this.step = 'site'; this.needle = { x: 6, d: 0, inLumen: false, where: 'tissue', moved: false }; this.wire = 0; this.angio = null;
      return true;
    }
    if (a === 'back' && st === 'wire') { this.step = 'needle'; this.wire = 0; this.wireRes = false; this.wireForce = 0; return true; }
    if (a !== 'confirm') return false;
    if (st === 'barbeau') {
      if (!this.barbeauDone) { this.note('acc_do_barbeau', {}, 'tip'); return false; }
      if (this.barbeau === 'D') this.flags.ignoredD = true;
      this.next(); return true;
    }
    if (st === 'site') { this.siteY = this.mark.y; this.t += 15; this.note('acc_site_' + this.siteClass(), {}, ['ideal', 'ok'].includes(this.siteClass()) ? 'good' : 'warn'); this.next(); return true; }
    if (st === 'needle') {
      if (!this.needle.inLumen) { this.note('acc_need_flash', {}, 'tip'); return false; }
      // bevel near the wall (tip off-centre in the lumen): the wire will catch the wall / go subintimal
      this.edge = Math.hypot(this.needle.x - this.art.x, this.needle.d - this.art.d) / this.art.r > 0.6;
      this.punctureY = this.site === 'femoral' ? this.siteY : 0; this.t += 10; this.next(); return true;
    }
    if (st === 'wire') { if (this.wire < 1) { this.note('acc_wire_more', {}, 'tip'); return false; } this.t += 10; this.next(); return true; }
    if (st === 'micro') { this.t += 30; this.note('acc_micro_in', {}, 'good'); this.next(); return true; }
    if (st === 'angio') { if (!this.angio) this.flags.noAngio = true; this.next(); return true; }
    if (st === 'sheath') { this.t += 40; this.note('acc_sheath_in', { f: this.sheathF }, 'good'); this.next(); if (this.site === 'femoral') this.finish(); return true; }
    if (st === 'cocktail') { this.next(); this.finish(); return true; }
    return false;
  };
  // scoring + complications
  Access.prototype.finish = function () {
    let score = 100; const fb = [], comps = [];
    if (this.site === 'femoral') {
      const c = this.siteClass(this.punctureY);
      if (c === 'high') { score -= 30; comps.push('access_high'); fb.push('fb_acc_high'); }
      else if (c === 'low') { score -= 20; comps.push('access_low'); fb.push('fb_acc_low'); }
      else if (c === 'highish' || c === 'lowish') { score -= 8; fb.push('fb_acc_edge'); }
      else fb.push(c === 'ideal' ? 'fb_acc_ideal' : 'fb_acc_ok');
      if (this.flags.noAngio) fb.push('fb_acc_no_angio');
      if (this.flags.repunctured) { score -= 5 * this.flags.repunctured; fb.push('fb_acc_repunct'); }
      if (this.sheathF >= 8) fb.push('fb_acc_big_sheath');
    } else {
      if (this.flags.ignoredD) { score -= 30; comps.push('access_hand_ischemia_risk'); fb.push('fb_acc_barbeau_d'); }
      if (!this.cocktail) { score -= 10; comps.push('radial_spasm'); fb.push('fb_acc_no_cocktail'); }
      if (!this.heparin) { score -= 10; fb.push('fb_acc_no_heparin'); this.flags.rao = true; }
      if (SLENDER_OD[this.sheathF] > this.radialD + 0.25) { score -= 8; fb.push('fb_acc_sheath_big_radial'); }
      if (this.cocktail && this.heparin && !this.flags.ignoredD) fb.push('fb_acc_radial_good');
    }
    if (this.veinHits) { score -= 4 * this.veinHits; fb.push('fb_acc_vein'); }
    if (this.passes > 1) { score -= 3 * (this.passes - 1); fb.push('fb_acc_passes'); }
    if (this.backWall) { score -= 5; fb.push('fb_acc_backwall'); comps.push('access_hematoma_risk'); }
    if (this.flags.diss) { score -= 15; comps.push('access_dissection'); fb.push('fb_acc_wire_diss'); }
    score = clamp(Math.round(score), 0, 100);
    this.done = true;
    this.result = { site: this.site, sheathF: this.sheathF, sheathLong: this.sheathLong, score, fb, comps, passes: this.passes,
      veinHits: this.veinHits, backWall: this.backWall, siteClass: this.site === 'femoral' ? this.siteClass(this.punctureY) : null,
      barbeau: this.site === 'radial' ? this.barbeau : null, cocktail: this.cocktail, heparin: this.heparin, time: Math.round(this.t + 60),
      angio: !!this.angio };
    this.note('acc_done', { s: score }, 'good');
    return this.result;
  };
  NIR.access = { Access, FEM, FEM_SHEATHS, RAD_SHEATHS, SLENDER_OD };
})(window.NIR = window.NIR || {});
