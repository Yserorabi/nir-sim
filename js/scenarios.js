/* NIR-Sim scenarios. To add a case: push an object into NIR.scenarios with
   { id, titleKey, briefKey, type, setup(sim), tick?(sim), score?(sim) }.
   Title/brief keys live in js/i18n.js (add EN + AR text there). */
(function (NIR) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const goodTici = g => g === '2b' || g === '2c' || g === '3';

  function common(sim, fb) {
    let pen = 0;
    const has = t => sim.complications.some(c => c.type === t);
    if (has('perforation')) { pen += 40; fb.push('fb_perf'); }
    if (has('dissection')) { pen += 20; fb.push('fb_diss'); }
    // stiff guide / aspiration catheter pushed around the arch without a rail
    if (has('aortic_perforation')) { pen += 80; fb.push('fb_aortic_perf'); }
    if (has('aortic_dissection')) { pen += 30; fb.push('fb_aortic_diss'); }
    if (sim.log.some(m => m.key === 'guide_unsup_arch' || m.key === 'guide_unsup_curve' || m.key === 'asp_unsup_arch')) {
      const danger = sim.log.some(m => m.key === 'aortic_wall_danger' || m.key === 'branch_wall_danger');
      pen += danger ? 10 : 4; fb.push('fb_unsup_guide');
    }
    if (has('ent')) { pen += 15; fb.push('fb_ent'); }
    if (has('vasospasm')) { pen += 5; fb.push('fb_spasm'); }
    if (sim.bloodLoss > 150) { pen += 5; fb.push('fb_blood'); }
    // wrong wire for the job: microwire used as a rail for big catheters / guidewire taken intracranially
    if ((sim.selStats.mwireMisuse || 0) > 0) { pen += Math.min(10, 4 * sim.selStats.mwireMisuse); fb.push('fb_mwire_misuse'); }
    if (sim.log.some(m => m.key === 'std_wire_ic')) { pen += 5; fb.push('fb_gwire_ic'); }
    return pen;
  }
  function gradeOf(score) { return score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D'; }

  const scoring = {
    thrombectomy(sim) {
      const fb = []; let score = 100;
      const g = sim.computeTici();
      if (!sim.passes) { score -= 60; fb.push('fb_no_pass'); }
      const tPenMap = { '3': 0, '2c': 5, '2b': 15, '2a': 40, '1': 55, '0': 60 }; const tPen = g in tPenMap ? tPenMap[g] : 60;
      score -= tPen;
      if (goodTici(g)) fb.push('fb_tici_good'); else fb.push('fb_tici_poor');
      const fpe = sim.passes >= 1 && (sim.firstPassTici === '2c' || sim.firstPassTici === '3');
      if (fpe) { score += 10; fb.unshift('fb_fpe'); }
      if (sim.passes > 3) { score -= 5 * (sim.passes - 3); fb.push('fb_many_passes'); }
      const fluoroMin = sim.fluoroTime / 60, procMin = sim.time / 60;
      const limF = sim.scenario && sim.scenario.id === 'm1-guide' ? 12 : 25;
      const limT = sim.scenario && sim.scenario.id === 'm1-guide' ? 35 : 60;
      if (fluoroMin > limF) { score -= Math.min(10, Math.round(fluoroMin - limF)); fb.push('fb_fluoro_high'); }
      if (sim.contrast > 150) { score -= Math.min(10, Math.round((sim.contrast - 150) / 10)); fb.push('fb_contrast_high'); }
      if (procMin > limT) { score -= Math.min(10, Math.round(procMin - limT)); fb.push('fb_time_long'); }
      if (fluoroMin <= limF && sim.contrast <= 100) fb.push('fb_efficient');
      score -= common(sim, fb);
      score = clamp(Math.round(score), 0, 100);
      return { type: 'thrombectomy', score, grade: gradeOf(score), fb, tici: g, fpe };
    },
    navigation(sim) {
      const fb = []; let score = 100;
      const done = sim.goals.filter(x => x.done).length, tot = sim.goals.length;
      score -= Math.round(60 * (tot - done) / Math.max(1, tot));
      fb.push(done === tot ? 'fb_nav_all' : 'fb_nav_missing');
      const fluoroMin = sim.fluoroTime / 60;
      if (fluoroMin > 20) { score -= Math.min(15, Math.round((fluoroMin - 20) * 1.5)); fb.push('fb_fluoro_high'); }
      if (sim.contrast > 120) { score -= Math.min(10, Math.round((sim.contrast - 120) / 10)); fb.push('fb_contrast_high'); }
      if (fluoroMin <= 20 && sim.contrast <= 120) fb.push('fb_efficient');
      if (sim.selStats.prolapse + sim.selStats.shapeStall >= 3) { score -= 5; fb.push('fb_shape'); }
      score -= common(sim, fb);
      score = clamp(Math.round(score), 0, 100);
      return { type: 'navigation', score, grade: gradeOf(score), fb, done, tot };
    }
  };
  scoring.generic = sim => (sim.clots.length ? scoring.thrombectomy(sim) : scoring.navigation(sim));

  function addM1Clot(sim) {
    sim.addClot('LM1a', 2, 11, { main: true });
  }

  // Navigation goals = every arch vessel present in the chosen anatomy. A vessel counts when a catheter tip is
  // >=15 mm inside it; disengaging and re-selecting is recorded each time (sim.selections).
  function navTick(sim) {
    let changed = false;
    sim.goals.forEach(g => {
      const sel = sim.selections.filter(x => x.vessel === g.id);
      const by = sel.map(x => x.dev + ':' + (x.dev === 'inter' ? '' : x.shape));
      if (sel.length !== g.count) { g.count = sel.length; g.by = by; changed = true; }
      if (!g.done && sel.length) {
        g.done = true;
        sim.msg('good', 'goal_done', { goal: NIR.i18n.t('v_' + g.id) });
        if (sim.goals.every(x => x.done)) sim.msg('good', 'all_goals');
      }
    });
    if (changed) sim.emit('change');
  }
  NIR.scoring = scoring;
  NIR.scenarios = [
    {
      id: 'm1', titleKey: 'sc_m1', briefKey: 'br_m1', type: 'thrombectomy',
      setup(sim) { addM1Clot(sim); sim.active = 'guide'; },
      score: scoring.thrombectomy
    },
    {
      id: 'm1-guide', titleKey: 'sc_m1_guide', briefKey: 'br_m1_guide', type: 'thrombectomy',
      setup(sim) { addM1Clot(sim); sim.placeDevice('guide', 'LICAc', 45); sim.active = 'guide'; },
      score: scoring.thrombectomy
    },
    {
      // Tortuous carotid siphon: the aspiration catheter tends to hang up at the ophthalmic origin (ledge effect)
      id: 'm1-siphon', titleKey: 'sc_m1_siphon', briefKey: 'br_m1_siphon', type: 'thrombectomy', anat: { siphon: 'tortuous' },
      setup(sim) { addM1Clot(sim); sim.placeDevice('guide', 'LICAc', 45); sim.active = 'guide'; },
      score: scoring.thrombectomy
    },
    {
      id: 'nav-arch', titleKey: 'sc_nav', briefKey: 'br_nav', type: 'navigation',
      setup(sim) { sim.goals = sim.anat.vessels.map(v => ({ id: v, done: false, count: 0, by: [] })); },
      tick: navTick, score: scoring.navigation
    }
  ];
})(window.NIR = window.NIR || {});
