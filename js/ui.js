/* NIR-Sim UI: DOM wiring, keyboard, HUD, log, debrief, language. */
(function (NIR) {
  'use strict';
  const $ = id => document.getElementById(id);
  const t = (k, p) => NIR.i18n.t(k, p);
  const sim = new NIR.sim.Sim({});
  const canvas = $('fluoro');
  const R = new NIR.Renderer(canvas, sim);
  const INSET = new NIR.Renderer(document.getElementById('tipInset'), sim); INSET.inset = true; INSET.autoZoom = false;
  let shapeKey = '';
  NIR.app = { sim, renderer: R, inset: INSET };
  let scenario = NIR.scenarios[0];

  function fmtTime(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function segLabel(id) { const s = sim.seg(id); return s ? (s.label[NIR.i18n.lang] || s.label.en) : id; }
  function devName(id) {
    if (id === 'guide' || id === 'diag') {
      const d = sim.devices[id]; let st = '';
      if (id === 'diag' && d.inserted && sim.isReverse(d)) st = ' (' + (d.formed ? t('shape_form') : d.form > 0.02 ? t('shape_forming', { p: Math.round(d.form * 100) }) : t('shape_unformed')) + ')';
      return t('dev_' + id) + ' · ' + t('shape_' + d.shape) + st;
    }
    if (id === 'wire') return t('dev_wire') + ' ' + t('sz_gwire_' + sim.sizes.gwire);
    if (id === 'mwire') return t('dev_mwire') + ' ' + t('sz_mwire_' + sim.sizes.mwire);
    if (id === 'micro') return t('dev_micro') + ' ' + sim.sizes.micro.replace(/^0?/, '0.0') + '"';
    if (id === 'sr') return t('dev_sr') + ' ' + (sim.devices.sr.size || sim.sizes.sr).replace('x', ' × ') + ' mm';
    return t('dev_' + id);
  }
  function fmtParams(p) {
    const o = Object.assign({}, p);
    if (o.dev) o.dev = devName(o.dev);
    if (o.seg) o.seg = segLabel(o.seg);
    if (o.tech) o.tech = t('tech_' + o.tech);
    if (o.vessel) o.vessel = t('v_' + o.vessel);
    return o;
  }

  // ---------- static text ----------
  function applyLang() {
    document.documentElement.lang = NIR.i18n.lang;
    document.documentElement.dir = NIR.i18n.dir();
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
    const sel = $('scenarioSel'); const cur = sel.value;
    sel.innerHTML = '';
    NIR.scenarios.forEach(s => { const o = document.createElement('option'); o.value = s.id; o.textContent = t(s.titleKey); sel.appendChild(o); });
    sel.value = cur || scenario.id;
    const fill = (el, vals, pre) => { const c = el.value; el.innerHTML = ''; vals.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = t(pre + v); el.appendChild(o); }); el.value = c || vals[0]; };
    fill($('archSel'), NIR.anatomy.ARCH_TYPES, 'arch_'); fill($('varSel'), NIR.anatomy.VARIANTS, 'var_'); fill($('siphonSel'), NIR.anatomy.SIPHONS, 'siphon_');
    $('briefTxt').textContent = t(scenario.briefKey);
    if (scenario.anat && scenario.anat.siphon) $('siphonSel').value = scenario.anat.siphon;
    $('siphonSel').disabled = !!(scenario.anat && scenario.anat.siphon);
    renderLog(true); renderDevices(); renderGoals(); renderButtons();
    if (sim.debrief) showDebrief(sim.debrief);
    if (NIR.app.onLang) NIR.app.onLang();
  }

  // ---------- devices ----------
  const KEYS = { guide: 1, diag: 2, inter: 3, micro: 4, wire: 5, mwire: 6, sr: 7 };
  function renderDevices() {
    const box = $('devList'); box.innerHTML = '';
    NIR.sim.DEVICE_ORDER.forEach(id => {
      const d = sim.devices[id];
      const row = document.createElement('div'); row.className = 'dev dev-' + id + (sim.active === id && d.inserted ? ' active' : '');
      const nm = document.createElement('div'); nm.className = 'nm'; nm.innerHTML = `<span class="key">${KEYS[id]}</span>`; nm.appendChild(document.createTextNode(devName(id)));
      const use = document.createElement('button'); use.textContent = t('select'); use.disabled = !d.inserted; use.onclick = () => { sim.setActive(id); canvas.focus(); };
      const io = document.createElement('button'); io.textContent = d.inserted ? t('remove') : t('insert');
      io.id = 'io_' + id;
      io.onclick = () => { d.inserted ? sim.remove(id) : sim.insert(id); renderDevices(); canvas.focus(); };
      const st = document.createElement('div'); st.className = 'st'; st.id = 'st_' + id;
      row.append(nm, use, io);
      if (id === 'guide' || id === 'diag') {
        const ss = document.createElement('select'); ss.id = 'shape_' + id; ss.disabled = d.inserted; ss.title = t('shape');
        (id === 'guide' ? NIR.sim.GUIDE_SHAPES : NIR.sim.DIAG_SHAPES).forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = t('shape') + ': ' + t('shape_' + v); ss.appendChild(o); });
        ss.value = d.shape; ss.onchange = () => { sim.setShape(id, ss.value); renderDevices(); };
        row.appendChild(ss);
      }
      const SZ = { micro: ['micro', NIR.sim.MICRO_SIZES], wire: ['gwire', NIR.sim.GWIRE_TYPES], mwire: ['mwire', NIR.sim.MWIRE_SIZES], sr: ['sr', NIR.sim.SR_SIZES], inter: ['asp', NIR.sim.ASP_SIZES], guide: ['guide', NIR.sim.GUIDE_SIZES] }[id];
      if (SZ) {
        const ss = document.createElement('select'); ss.id = 'size_' + id; ss.title = id === 'inter' ? t('size_asp') : id === 'guide' ? t('size_guide') : t('size');
        ss.disabled = id === 'guide' ? (d.inserted && sim.innerDevices(d).length > 0) : d.inserted;
        Object.keys(SZ[1]).forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = (id === 'wire' ? t('gwire_type') : t('size')) + ': ' + t('sz_' + SZ[0] + '_' + v); ss.appendChild(o); });
        ss.value = sim.sizes[SZ[0]]; ss.onchange = () => { sim.setSize(SZ[0], ss.value); renderDevices(); };
        row.appendChild(ss);
      }
      row.appendChild(st); box.appendChild(row);
    });
    updateDeviceStatus();
  }
  function updateDeviceStatus() {
    NIR.sim.DEVICE_ORDER.forEach(id => {
      const d = sim.devices[id], el = $('st_' + id); if (!el) return;
      if (!d.inserted) { el.textContent = '—'; return; }
      const loc = sim.locate(d.s);
      let s = `${Math.round(d.s)} mm · ${segLabel(loc.seg.id)}`;
      if (id === 'sr') s += ' · ' + srPhaseText();
      if (id === 'diag' && sim.isReverse(d)) s += ' · ' + (d.formed ? t('shape_form') : d.form > 0.02 ? t('shape_forming', { p: Math.round(d.form * 100) }) : t('shape_unformed'));
      if (id === 'inter' && d.hung) s += ' · ' + t('hang_tag');
      if (d.wallImpact > 0) s += ' · ' + t('wall_tag');
      el.textContent = s;
    });
  }

  function srPhaseText() {
    const S = sim.devices.sr; if (!S.inserted) return '';
    const e = sim.srExposed(), L = sim.srLen();
    if (S.deployed) return t('sr_ph_dep', { t: fmtTime(sim.time - S.deployTime) });
    if (e > 0.5) return t('sr_ph_open', { e: Math.round(e), L });
    return sim.devices.micro.s - S.s > 1.5 ? t('sr_ph_sheathed') : t('sr_ph_attip');
  }
  const HINTS = { cross: 'h_cross', need_micro: 'h_need_micro', remove_wire: 'h_remove_wire', insert_sr: 'h_insert_sr', advance_sr: 'h_advance_sr', at_tip: 'h_at_tip', unsheathing: 'h_unsheathing', integrate: 'h_integrate', retrieve: 'h_retrieve' };
  function renderHint() {
    const box = $('hintBox');
    if (['guide', 'inter'].some(id => sim.devices[id].inserted && sim.devices[id].wallImpact > 0)) { box.classList.remove('hidden'); $('hintTxt').textContent = t('h_guide_unsup'); box.dataset.phase = 'wall'; return; }
    if (sim.devices.inter.inserted && sim.devices.inter.hung) { box.classList.remove('hidden'); $('hintTxt').textContent = t('h_hang'); box.dataset.phase = 'hang'; return; }
    const sp = sim.shapePhase(), gs = sim.locate(sim.devices.guide.s).seg;
    if (sp && !(sim.devices.guide.inserted && (gs.head || /ICA/.test(gs.id)))) {
      const d = sim.devices.diag, J = sim.engagedJunction(d), v = J ? sim.seg(sim.track[J.i]) : null;
      box.classList.remove('hidden');
      const inf = sim.shapeInfo() || {}, aim = sim.aimPreview();
      let key = 'hs_' + sp;
      if (sp === 'unformed') key = (inf.lsaW >= 5 || inf.wireAtRoot) ? 'hs2_cath' : 'hs2_up';
      else if (sp === 'pull_wire') key = 'hs2_pull';
      else if (sp === 'lsa_push' || sp === 'valve_push') key = 'hs2_push';
      else if (sp === 'vtk_unformed') key = inf.cathInArch && inf.rel != null && inf.rel <= 2 ? 'hsv_pull' : 'hsv_up';
      $('hintTxt').textContent = t(key, { p: Math.round((d.form || 0) * 100), vessel: v ? t('v_' + (v.archVessel || v.vessel || v.id)) : '',
        b: Math.round(inf.back || 0), need: inf.need, d: Math.max(0, Math.round(inf.lsaC)), aim: aimText(aim) });
      box.dataset.phase = 'shape_' + sp; return;
    }
    const live = sim.clots.some(c => !c.removed && c.main);
    const ph = sim.srPhase();
    const gseg = sim.locate(sim.devices.guide.s).seg, show = live && ((sim.devices.guide.inserted && (gseg.head || /ICA/.test(gseg.id))) || sim.devices.sr.inserted);
    box.classList.toggle('hidden', !show);
    if (!show) return;
    $('hintTxt').textContent = t(HINTS[ph], { e: Math.round(sim.srExposed()), L: sim.srLen() });
    box.dataset.phase = ph;
  }

  function renderGoals() {
    const ul = $('goalList'); ul.innerHTML = '';
    sim.goals.forEach(g => {
      const li = document.createElement('li'); li.textContent = t('v_' + g.id) + (g.done ? ' ✓' : '');
      if (g.done) li.className = 'done';
      const by = document.createElement('div'); by.className = 'by';
      const counts = {};
      (g.by || []).forEach(k => { counts[k] = (counts[k] || 0) + 1; });
      by.textContent = Object.keys(counts).length ? Object.keys(counts).map(k => { const [dev, sh] = k.split(':'); return t('dev_' + dev + '_s') + (sh ? ' ' + t('shape_' + sh) : '') + ' ×' + counts[k]; }).join(', ') : t('sel_none');
      li.appendChild(by); ul.appendChild(li);
    });
  }

  function renderButtons() {
    $('injBtn').textContent = sim.roadmapOn ? t('inject_puff') : t('inject');
    const a = $('aspBtn'); a.textContent = t('asp_toggle') + ': ' + (sim.aspiration ? t('on') : t('off')); a.classList.toggle('on', sim.aspiration);
    $('rmChk').checked = sim.roadmapOn;
    const D = sim.devices;
    $('deployBtn').disabled = !(D.sr.inserted && !D.sr.deployed);
    $('unsheathBtn').disabled = !(D.sr.inserted && D.micro.inserted && !D.sr.deployed);
    $('fluffBtn').disabled = !(D.sr.inserted && !D.sr.deployed);
    $('triaxBtn').disabled = !D.guide.inserted || (D.inter.inserted && D.micro.inserted && D.mwire.inserted);
    const bb = $('biBtn'); bb.textContent = R.biplane ? t('single') : t('biplane'); bb.classList.toggle('on', R.biplane);
    $('retrieveBtn').disabled = !D.sr.deployed;
    $('withdrawBtn').disabled = !D.inter.inserted;
    $('microRunBtn').disabled = !D.micro.inserted;
    ['vAP', 'vLAO', 'vLAT'].forEach(b => $(b).classList.toggle('on', $(b).dataset.view === R.view));
  }

  // ---------- HUD ----------
  function hud() {
    const s = sim, D = s.devices, act = D[s.active];
    const loc = s.locate(act && act.inserted ? act.s : s.maxTip());
    const items = [
      [t('m_time'), fmtTime(s.time)], [t('m_fluoro'), fmtTime(s.fluoroTime)], [t('m_contrast'), Math.round(s.contrast) + ' ' + t('ml')],
    ];
    if (s.clots.length) items.push([t('m_passes'), s.passes], [t('m_tici'), s.lastTici != null ? s.lastTici : t('na'), s.lastTici && /2b|2c|3/.test(s.lastTici) ? 'good' : s.lastTici ? 'bad' : '']);
    items.push([t('m_active'), act && act.inserted ? (s.active === 'wire' || s.active === 'mwire' || s.active === 'diag' ? devName(s.active) : t('dev_' + s.active + '_s')) : t('none')]);
    items.push([t('m_loc'), segLabel(loc.seg.id)]);
    const tq = s.torqueTarget();
    if (tq.inserted) items.push([t('m_torque') + ' (' + t('dev_' + tq.id + '_s') + ')', Math.round(tq.torque) + '°']);
    const aim = s.aimPreview();
    if (aim) items.push([t('m_aim'), aimText(aim), aim.vessel && aim.vessel !== 'aorta' ? (aim.good ? 'good' : '') : '', 'aim']);
    if (D.diag.inserted && D.wire.inserted && s.isReverse(D.diag)) {
      const inf = s.shapeInfo(), rel = Math.round(inf.rel);
      items.push([t('m_wire_rel'), (rel > 0 ? '+' : '') + rel + ' mm ' + (rel > 2 ? t('wr_ahead') : -rel >= inf.need ? t('wr_free') : t('wr_in_curve', { need: inf.need })), -rel >= inf.need ? 'good' : '', 'wirerel']);
    }
    if (D.inter.inserted) {
      const st = s.aspiration ? (s.corked ? t('asp_corked') : s.aspirationState().gap <= 1.5 ? t('asp_engaged') : t('asp_free')) : t('asp_offs');
      items.push([t('m_asp'), st + (s.aspiration && s.engagedTime > 0 ? ` (${Math.round(s.engagedTime)} ${t('sec')})` : ''), s.corked ? 'good' : s.aspiration ? 'bad' : '']);
    }
    if (D.sr.inserted) items.push([t('m_sr'), srPhaseText(), D.sr.deployed ? 'good' : '']);
    if (D.micro.inserted || D.wire.inserted || D.mwire.inserted || D.sr.inserted) items.push([t('m_sizes'), [D.wire.inserted ? '.' + sim.sizes.gwire.slice(0, 3) + '" GW' : null, D.micro.inserted ? sim.sizes.micro.replace(/^0?/, '.0') + '" MC' : null, D.mwire.inserted ? '.' + sim.sizes.mwire + '" MW' : null, D.sr.inserted ? 'SR ' + D.sr.size : null].filter(Boolean).join(' / ')]);
    if (s.bloodLoss > 1) items.push([t('m_blood'), Math.round(s.bloodLoss) + ' ' + t('ml'), s.bloodLoss > 150 ? 'bad' : '']);
    if (s.complications.length) items.push(['⚠', s.complications.map(c => t('comp_' + c.type, fmtParams(c.params)).split(/[!–.(]/)[0]).join(', '), 'bad']);
    $('hud').innerHTML = items.map(i => `<span${i[3] ? ` data-k="${i[3]}"` : ''}><span class="k">${i[0]}:</span> <span class="v ${i[2] || ''}">${escapeHtml(String(i[1]))}</span></span>`).join('');
    drawDial();
  }
  function aimText(a) {
    if (!a) return '—';
    if (!a.vessel) return t('aim_none');
    const vk = 'v_' + a.vessel, nm = a.vessel === 'aorta' ? t('aim_aorta') : (t(vk) !== vk ? t(vk) : segLabel(a.vessel));
    return nm + (a.vessel !== 'aorta' ? (a.good ? ' ✓' : ' ~') : '');
  }
  function escapeHtml(s) { return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  function drawDial() {
    const c = $('dial'), g = c.getContext('2d'), w = sim.torqueTarget();
    g.clearRect(0, 0, 64, 64);
    g.strokeStyle = '#3c4a57'; g.lineWidth = 2; g.beginPath(); g.arc(32, 32, 26, 0, 7); g.stroke();
    if (!w.inserted) return;
    const a = (w.torque - 90) * Math.PI / 180;
    g.strokeStyle = '#8fd0ff'; g.lineWidth = 3; g.beginPath(); g.moveTo(32, 32); g.lineTo(32 + Math.cos(a) * 24, 32 + Math.sin(a) * 24); g.stroke();
    // apparent lateral deflection (projection of the J)
    const defl = Math.cos(w.torque * Math.PI / 180);
    g.fillStyle = '#ffd54a'; g.fillRect(32, 58, defl * 26, 4);
  }

  // ---------- log ----------
  let logCount = 0;
  function renderLog(full) {
    const box = $('log');
    if (full) { box.innerHTML = ''; logCount = 0; }
    for (; logCount < sim.log.length; logCount++) {
      const m = sim.log[logCount];
      const div = document.createElement('div'); div.className = m.level;
      div.innerHTML = `<span class="tm">${fmtTime(m.time)}</span>`;
      div.appendChild(document.createTextNode(t(m.key, fmtParams(m.params))));
      box.appendChild(div);
    }
    box.scrollTop = box.scrollHeight;
  }

  let bannerTimer = null;
  function banner(txt, color) {
    const b = $('banner'); b.textContent = txt; b.style.color = color || '#fff'; b.classList.add('show');
    clearTimeout(bannerTimer); bannerTimer = setTimeout(() => b.classList.remove('show'), 3200);
  }

  // ---------- debrief ----------
  function showDebrief(r) {
    const s = sim, yes = b => (b ? t('yes') : t('no'));
    const rows = [[t('d_time'), fmtTime(s.time)], [t('d_fluoro'), fmtTime(s.fluoroTime)], [t('d_contrast'), Math.round(s.contrast) + ' ' + t('ml')]];
    if (r.type === 'thrombectomy') {
      rows.push([t('d_passes'), s.passes], [t('d_fpe'), yes(r.fpe)], [t('d_tici'), r.tici != null ? r.tici : t('na')],
        [t('d_reperf'), s.reperfTime != null ? fmtTime(s.reperfTime) : t('na')], [t('d_blood'), Math.round(s.bloodLoss) + ' ' + t('ml')]);
    } else rows.push([t('d_goals'), `${r.done} / ${r.tot}`]);
    rows.push([t('d_comps'), s.complications.length ? s.complications.map(c => t('comp_' + c.type, fmtParams(c.params)).split(/[!–(]/)[0].trim()).join('; ') : t('none')]);
    const passes = s.passResults.map((p, i) => `<li>${escapeHtml(t('pass_row', { n: i + 1, tech: t('tech_' + p.technique), res: t('res_' + p.result), g: p.tici, p: p.p }))}</li>`).join('');
    $('modalBox').innerHTML = `<h2>${t('debrief')} – ${escapeHtml(t(scenario.titleKey))}</h2>
      <div><span class="score">${r.score}/100</span><span class="grade">${t('grade')}: ${r.grade} · ${t('grade_' + r.grade)}</span></div>
      <table>${rows.map(x => `<tr><td>${x[0]}</td><td>${escapeHtml(String(x[1]))}</td></tr>`).join('')}</table>
      ${passes ? `<h3>${t('pass_hist')}</h3><ul>${passes}</ul>` : ''}
      <h3>${t('feedback')}</h3><ul>${r.fb.map(k => `<li>${escapeHtml(t(k))}</li>`).join('')}</ul>
      <div class="btnrow"><button id="dbRestart">${t('restart')}</button><button id="dbClose">${t('close')}</button></div>`;
    $('modal').classList.remove('hidden');
    $('dbRestart').onclick = () => { $('modal').classList.add('hidden'); startScenario(scenario.id); };
    $('dbClose').onclick = () => $('modal').classList.add('hidden');
  }

  // ---------- events ----------
  sim.on((ev, data) => {
    if (ev === 'log') renderLog(false);
    if (ev === 'change' || ev === 'reset') { renderDevices(); renderButtons(); renderGoals(); }
    if (ev === 'select') banner('✓ ' + t('v_' + data.vessel), '#7CFC9A');
    if (ev === 'flash') R.flash = 1;
    if (ev === 'stall') { const wl = ['guide', 'inter'].find(id => sim.devices[id].inserted && sim.devices[id].wallImpact > 0); banner('⚠ ' + (wl ? t('wall_banner', { dev: t('dev_' + wl + '_s') }) : t('stall_banner')), wl ? '#ff7b6b' : '#ffcf6b'); }
    if (ev === 'complication') banner('⚠ ' + t('comp_' + data, {}).split(/[!–(]/)[0].replace(/\{\w+\}/, ''), '#ff7b6b');
    if (ev === 'tici') banner('mTICI ' + data, /2b|2c|3/.test(data) ? '#7CFC9A' : '#ffcf6b');
    if (ev === 'debrief') showDebrief(data);
  });

  function startScenario(id) {
    scenario = NIR.scenarios.find(s => s.id === id) || NIR.scenarios[0];
    sim.reset(scenario, { archType: $('archSel').value || 'I', variant: $('varSel').value || 'normal', siphon: $('siphonSel').value || 'normal' }); sim.debrief = null;
    $('briefTxt').textContent = t(scenario.briefKey);
    if (scenario.anat && scenario.anat.siphon) $('siphonSel').value = scenario.anat.siphon;
    $('siphonSel').disabled = !!(scenario.anat && scenario.anat.siphon);
    $('scenarioSel').value = scenario.id;
    renderLog(true); renderDevices(); renderGoals(); renderButtons();
    $('modal').classList.add('hidden');
    canvas.focus();
  }
  NIR.app.startScenario = startScenario;

  $('startBtn').onclick = () => startScenario($('scenarioSel').value);
  $('archSel').onchange = () => startScenario($('scenarioSel').value);
  $('varSel').onchange = () => startScenario($('scenarioSel').value);
  $('siphonSel').onchange = () => startScenario($('scenarioSel').value);
  ['vAP', 'vLAO', 'vLAT'].forEach(b => { $(b).onclick = () => { R.setView($(b).dataset.view); renderButtons(); canvas.focus(); }; });
  $('insetChk').onchange = () => canvas.focus();
  $('scenarioSel').onchange = () => startScenario($('scenarioSel').value);
  $('endBtn').onclick = () => { if (!sim.finished) sim.endCase(); else showDebrief(sim.debrief); };
  $('langBtn').onclick = () => { NIR.i18n.setLang(NIR.i18n.lang === 'en' ? 'ar' : 'en'); applyLang(); };
  $('injBtn').onclick = () => { sim.inject(); canvas.focus(); };
  $('microRunBtn').onclick = () => { sim.inject('micro'); canvas.focus(); };
  $('rmChk').onchange = () => { if ($('rmChk').checked !== sim.roadmapOn) sim.toggleRoadmap(); renderButtons(); };
  $('ghostChk').onchange = () => { R.ghost = $('ghostChk').checked; };
  $('autoZChk').onchange = () => { R.autoZoom = $('autoZChk').checked; };
  $('zinBtn').onclick = () => { R.zoomMul = Math.min(4, R.zoomMul * 1.25); };
  $('zoutBtn').onclick = () => { R.zoomMul = Math.max(0.25, R.zoomMul / 1.25); };
  $('aspBtn').onclick = () => { sim.setAspiration(!sim.aspiration); renderButtons(); canvas.focus(); };
  $('deployBtn').onclick = () => { sim.deploySR(); canvas.focus(); };
  $('triaxBtn').onclick = () => { sim.loadTriaxial(); renderDevices(); canvas.focus(); };
  $('biBtn').onclick = () => { R.setBiplane(!R.biplane); renderButtons(); canvas.focus(); };
  $('retrieveBtn').onclick = () => { sim.retrieveSR(); canvas.focus(); };
  $('withdrawBtn').onclick = () => { sim.withdrawAspiration(); canvas.focus(); };
  $('w30Btn').onclick = () => sim.wait(30);
  $('w60Btn').onclick = () => sim.wait(60);
  $('fastChk').onchange = () => { sim.input.fast = $('fastChk').checked; };
  canvas.addEventListener('wheel', e => { e.preventDefault(); R.zoomMul = Math.max(0.25, Math.min(4, R.zoomMul * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); }, { passive: false });

  // hold-to-act buttons (mouse + touch)
  function hold(id, down, up) {
    const b = $(id);
    const on = e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (_) {} b.classList.add('pressed'); down(); };
    const off = () => { b.classList.remove('pressed'); up(); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off); b.addEventListener('contextmenu', e => e.preventDefault());
  }
  hold('advBtn', () => { sim.input.adv = 1; }, () => { if (sim.input.adv === 1) sim.input.adv = 0; });
  hold('retBtn', () => { sim.input.adv = -1; }, () => { if (sim.input.adv === -1) sim.input.adv = 0; });
  hold('rotLBtn', () => { sim.input.rot = -1; }, () => { if (sim.input.rot === -1) sim.input.rot = 0; });
  hold('rotRBtn', () => { sim.input.rot = 1; }, () => { if (sim.input.rot === 1) sim.input.rot = 0; });
  hold('unsheathBtn', () => { sim.input.unsheath = 1; }, () => { sim.input.unsheath = 0; });
  hold('fluffBtn', () => { sim.input.fluff = 1; }, () => { sim.input.fluff = 0; });
  hold('pedalBtn', () => { sim.pedal = true; }, () => { sim.pedal = false; });

  // keyboard
  const held = {};
  window.addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' && e.target.type !== 'checkbox')) return;
    const k = e.key.toLowerCase(); held[k] = true;
    sim.input.fast = e.shiftKey || $('fastChk').checked;
    if (k === 'arrowup' || k === 'w') { sim.input.adv = 1; e.preventDefault(); }
    else if (k === 'arrowdown' || k === 's') { sim.input.adv = -1; e.preventDefault(); }
    else if (k === 'arrowleft' || k === 'a') { sim.input.rot = -1; e.preventDefault(); }
    else if (k === 'arrowright' || k === 'd') { sim.input.rot = 1; e.preventDefault(); }
    else if (k === ' ') { sim.pedal = true; e.preventDefault(); }
    if (e.repeat) return;
    const devs = ['guide', 'diag', 'inter', 'micro', 'wire', 'mwire', 'sr'];
    if (/^[1-7]$/.test(k)) { const id = devs[+k - 1]; if (sim.devices[id].inserted) sim.setActive(id); }
    else if (k === 'v') { const order = ['ap', 'lao', 'lat']; R.setView(order[(order.indexOf(R.view) + 1) % 3]); renderButtons(); }
    else if (k === 'k') { $('insetChk').checked = !$('insetChk').checked; }
    else if (k === 'c') sim.inject();
    else if (k === 'r') { sim.toggleRoadmap(); renderButtons(); }
    else if (k === 'p') { sim.setAspiration(!sim.aspiration); renderButtons(); }
    else if (k === 'e') { if (e.shiftKey) sim.deploySR(); else sim.input.unsheath = 1; }
    else if (k === 'g') sim.input.fluff = 1;
    else if (k === 'b') { R.setBiplane(!R.biplane); renderButtons(); }
    else if (k === 't') sim.retrieveSR();
    else if (k === 'y') sim.withdrawAspiration();
    else if (k === 'z') R.zoomMul = Math.min(4, R.zoomMul * 1.25);
    else if (k === 'x') R.zoomMul = Math.max(0.25, R.zoomMul / 1.25);
  });
  window.addEventListener('keyup', e => {
    const k = e.key.toLowerCase(); held[k] = false;
    sim.input.fast = e.shiftKey || $('fastChk').checked;
    if ((k === 'arrowup' || k === 'w') && sim.input.adv === 1) sim.input.adv = 0;
    if ((k === 'arrowdown' || k === 's') && sim.input.adv === -1) sim.input.adv = 0;
    if ((k === 'arrowleft' || k === 'a') && sim.input.rot === -1) sim.input.rot = 0;
    if ((k === 'arrowright' || k === 'd') && sim.input.rot === 1) sim.input.rot = 0;
    if (k === ' ') sim.pedal = false;
    if (k === 'e') sim.input.unsheath = 0;
    if (k === 'g') sim.input.fluff = 0;
    if (k === 'shift') sim.input.fast = $('fastChk').checked;
  });
  window.addEventListener('blur', () => { sim.input.adv = 0; sim.input.rot = 0; sim.input.unsheath = 0; sim.input.fluff = 0; sim.pedal = false; });

  // main loop
  let last = performance.now(), hudT = 0;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!NIR.app.paused) sim.update(dt);
    R.draw(dt);
    const showInset = $('insetChk').checked && (sim.devices.diag.inserted || sim.devices.guide.inserted) && sim.maxTip() > 60;
    $('tipInset').classList.toggle('hidden', !showInset);
    if (showInset) { INSET.setView(R.biplane ? 'ap' : R.mainView); INSET.mainScale = R.scale; INSET.draw(dt); }
    hudT += dt;
    { const cur = sim.devices.diag.inserted ? sim.devices.diag.shape : sim.shapes.diag, key = cur + NIR.i18n.lang + $('shapeCanvas').clientWidth; if (key !== shapeKey) { shapeKey = key; NIR.drawShapePreview($('shapeCanvas'), cur); } }
    if (hudT > 0.1) { hudT = 0; hud(); updateDeviceStatus(); renderButtons(); renderHint(); if (NIR.app.onTick) NIR.app.onTick(); }
    // frame-rate meter (EMA) used by the adaptive-quality governor
    NIR.app.fps = NIR.app.fps ? NIR.app.fps * 0.95 + (1 / Math.max(1e-3, dt)) * 0.05 : 60;
    if (NIR.app.onFrame) NIR.app.onFrame(dt);
    requestAnimationFrame(loop);
  }
  Object.assign(NIR.app, { renderDevices, renderButtons, renderHint, aimText, segLabel, devName, hold, KEYS, applyLang, showDebrief });
  applyLang();
  startScenario(scenario.id);
  requestAnimationFrame(loop);
})(window.NIR = window.NIR || {});
