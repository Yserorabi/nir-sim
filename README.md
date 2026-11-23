# NIR-Sim — Neurointerventional Training Simulator (prototype)

A browser-based, fully offline trainer for neuro-IR fellows: catheter/wire navigation from the groin to the
intracranial circulation and mechanical thrombectomy of a left M1 occlusion. English / Arabic (RTL).

## Run
Double-click `index.html` (Chrome, Edge or Firefox). No install, no internet, no server, no special hardware.
Everything (code, styles) is local plain HTML/JS/Canvas — no external libraries or CDNs.

## Anatomy & views (choose before each case — header "Arch" and "Variant")
* **Arch type:** Type I, Type II, Type III (great-vessel origins progressively lower relative to the arch apex,
  so take-off angles steepen and reverse-curve catheters become necessary).
* **Variant:** standard branching · bovine (common BCA + LCCA ostium) · LCCA arising from the BCA (true bovine) ·
  aberrant right subclavian (last arch branch, retro-esophageal course; no BCA) · left vertebral directly from the arch.
* **Intracranial tree** (displayed magnified ×1.6 so the head fills the field during intracranial work):
  petrous/cavernous/supraclinoid ICA, ophthalmic, PComm, ICA terminus; left MCA M1 (proximal → lenticulostriate
  segment → anterior temporal artery → genu), superior/inferior M2 divisions, four M3/M4 cortical branches
  (frontal, parietal, temporal, angular); ACA A1, AComm, A2 with pericallosal + callosomarginal; right MCA/ACA;
  posterior circulation: vertebral V4, PICA, basilar, AICA, SCA, P1, P2 (both vertebrals reach the basilar).
* The body (femoral → arch) is deliberately short — groin to neck takes only a few seconds.
* Every intracranial vessel lies inside the skull; devices are always on a vessel centerline (they can perforate
  per the rules, but are never drawn outside a vessel or the skull; wire curls are scaled to the lumen).
* Centerlines are 3D, so **AP, LAO 30° and lateral** views (buttons or **V**) all render the same anatomy and devices.
* **Biplane** (button or **B**): AP (plane A) and lateral (plane B) side by side, imaged simultaneously; toggle back
  to a single plane.

## Catheters and shapes
Guide / long sheath / balloon guide (product catalogue with real ID/OD/length — see *Guide catheters* below), **5F selective
catheter** (ID .040" — takes a 0.038" wire; Vert, Berenstein, Headhunter H1, Vitek/VTK, Simmons 2, Pigtail), aspiration catheter (bore
selectable, see below), 0.035"/0.038" guidewire (angled, J, or 300 cm stiff exchange; see below).
* **Aspiration catheter bore** (real ID / distal OD): 0.043" RED 43 (.060") · 0.054" JET D / Sofia 5F (.068") ·
  0.060" ACE 60 (.080") · 0.062" RED 62 (.076") · 0.064" ACE 64 (.080") · 0.068" RED 68 / React 68 (.084") ·
  0.070" Sofia Plus (.0825") · 0.071" React 71 / Zoom 71 / Vecta 71 (.083") · 0.072" RED 72 / JET 7 (.085") ·
  0.074" Vecta 74 (.085") · **0.088" Zoom 88 LDP (.110")**, which needs the 0.115" sheath (Zoom 88 IFU) and is refused
  through an 0.088" guide. Microcatheter fit is checked (e.g. a 0.027" micro, OD 0.041", does not fit a 0.043" catheter).
  Larger bore = better clot ingestion / first-pass aspiration odds (≈ lumen area), but more siphon hang-ups.
* **Selectable sizes** (in the device panel, changeable while the device is out):
  microcatheter **0.017" / 0.021" / 0.027"** ID; microwire **0.014" / 0.018" / 0.024"**;
  stent retriever **3×20 mm** (≥0.017"), **4×30 mm** (≥0.021"), **6×30 mm** (≥0.027").
* **Coaxial fit is enforced** (inner OD + 0.002" ≤ outer ID): e.g. a 0.024" wire will not enter a 0.017" micro,
  a 0.018" wire will not enter a 0.017" micro, a 0.035" wire will not enter any microcatheter, a 4 mm SR is refused
  through a 0.017" micro. Triaxial order is guide > aspiration catheter > microcatheter > microwire; every
  microcatheter size passes through the aspiration catheter. **Load triaxial** inserts all three in order.
* Rotate the **active** shaped catheter (or the wire) with ←/→; the dial shows its roll.
* A wire leaving a shaped catheter tip (within 25 mm) goes where the catheter is aimed; how far off a take-off
  angle the shape can reach decides success. Near the limit the wire **prolapses** back into the aorta (the "Vert
  struggles" case). A bare J-wire cannot select arch branches from the aorta.
* **True tip shapes** (js/shapes.js; mm): Vert = one 40° bend, 26 mm angled segment · H1 = −20° primary curve then a
  65° secondary tip with a 15 mm straight end · VTK = small 172° reverse curve, 25 mm limb, short 45° tip · Simmons 2 =
  shepherd's crook, 176° knee, **70 mm limb**, knee width ≈30 mm (wider than the ≈25 mm aorta). Each catheter is drawn
  as one continuous tube in 3D (correct in AP / LAO / lateral); the curve is compressed against the aortic wall in the
  lumen, straightens over a wire and reconstitutes when the wire is withdrawn. The **Catheter shapes** panel shows the
  four shapes out of the body at true scale (1 cm bar), and the **Tip close-up** inset (K) magnifies the tip in the arch.
* **Simmons 2 forming** (unformed Sim2 is straight-ish; form it yourself):
  * *LSA technique*: wire + catheter into the left subclavian (≥15 mm) → pull the wire back ≥60 mm (behind the
    primary curve) → **advance** the catheter: the loop forms progressively and prolapses into the ascending aorta
    (tip is still in the LSA) → push (no wire ahead) to pop the tip out.
  * *Aortic-valve technique*: catheter + wire to the aortic root → pull the wire back ≥60 mm → keep **advancing**: the
    tip deflects off the valve and folds back.
  * Wrong position = feedback: wire still in the curve, or trying to form in the descending aorta.
  * Formed: **rotate** (←/→) to choose the target and **pull back gently** (↓ without Shift): the tip hooks into that
    origin; more pull seats it deeper; **push** (no wire) disengages; advancing the wire then the catheter tracks it
    into the vessel (the loop straightens). Over-pushing at the valve or pulling the loop through the origin
    **unforms** it — re-form.
* **Vitek** re-forms by itself in the arch once the wire is pulled ≥30 mm back; rotate + gentle pull to engage, gentle
  push pops it out, a wire straightens it. **Vert / Berenstein / H1** pop into an origin on rotation + gentle pull-back.
* Pigtail in the ascending aorta + **C** = arch aortogram (30 ml) to classify the arch (best in LAO 30°).
* Typical matches (from the test matrix): Type I → Vert/H1; Type II → H1/VTK; Type III and bovine → VTK/Sim2.

## Guidewire and microwire (two separate devices)
| Key | Device | Options | Goes through | Colour |
|---|---|---|---|---|
| 5 | **Guidewire** | 0.035" angled hydrophilic (Glidewire) 150 cm · 0.035" J 150 cm · 0.038" angled · 0.038" J · 0.035" **stiff exchange 300 cm** (Amplatz/Rosen) | guide, 5F selective catheter, aspiration catheter — arch and neck | blue |
| 6 | **Microwire** | 0.014" (Synchro / Traxcess) · 0.018" (Aristotle 18) · 0.024" (Aristotle 24); shapeable tip, own torque, 30 mm radiopaque tip | **microcatheter only** | orange |

* The guidewire never fits a microcatheter (`gwire_not_micro`); the microcatheter cannot go in while the guidewire is in
  (`remove_gwire_first`); guidewire and microwire are never in at the same time on the shared track.
* A microwire inserted **without** a microcatheter is warned (`mwire_no_micro`); if a selective/guide/aspiration
  catheter is pushed over it in the arch or neck it does not track and the microwire prolapses (`mwire_no_support`) —
  scored as *microwire misuse* (−4 per event, max −10).
* The guidewire in small/intracranial vessels is still warned and penalised (`std_wire_ic`, −5).
* Angled tips steer better than J tips; the stiff exchange wire steers poorly but lets you **exchange**: remove a
  catheter while the 300 cm wire stays in place (`exchange_done`), then load the next catheter over it. With a
  150 cm wire, pulling a catheter off it is refused (`need_exchange_wire`).
* Simmons / Vitek forming uses the **guidewire** (5). The SR is loaded only after the **microwire** (6) is removed.

## Guide / aspiration catheter need a rail around curves
* The guide is **straight and stiff**. It only follows the arch (or turns into any branch / next curved segment) when a
  **0.035"/0.038" guidewire or the 5F selective catheter extends ≥3 cm beyond its tip**. A bare microwire does not count
  (it prolapses). Straight segments (iliac, abdominal and descending aorta) are fine without a rail.
* Unsupported, the tip stops at the descending-aorta/arch junction and runs straight into the **outer aortic wall**
  (fluoro: tip pressed on the wall, pulsing **WALL** ring; HUD/device tag "WALL"; banner + hint). Pushing on escalates:
  warning → DANGER → **aortic dissection** (~15 mm of forced push; dashed intimal flap on fluoro) → **aortic
  perforation** (~30 mm; contrast blush/extravasation) which **ends the case** (score ≈ 0). Pulling back frees the tip.
* With a rail that is too short (< 3 cm beyond the tip) the guide just stops (info: lead further) — no injury.
* Milder rule for the **aspiration catheter** outside the guide in the arch: needs a guidewire or microcatheter ≥2 cm
  ahead; otherwise it stalls against the wall (dissection only, never perforation). Inside the guide it is supported.
* Scoring: unsupported push −4 (−10 if it reached DANGER), aortic dissection −30, aortic perforation −80 + case stop.

## Guide catheters, balloon guides, access, pull-back selection (v8)
**Guide menu** (device panel, guide row): each entry shows the product, ID, OD and working length; the shape list
changes with the product.

| Product | ID / OD (inch) | Length | Shapes | Notes |
|---|---|---|---|---|
| Neuron MAX 088 | .088 / .109 | 90 cm | straight, MPD | long sheath (exchanged for the short sheath) |
| AXS Infinity LS | .088 / .105 | 80 cm | straight | long sheath |
| Ballast 088 | .088 / .106 | 90 cm | straight | long sheath |
| Cook Shuttle 6F / 5F | .087 / .105 · .074 / .092 | 90 cm | straight, MPD (6F also H1) | the real IDs are .087"/.074" (often called "088/071") |
| BENCHMARK 071 | .071 / .083 | 95 cm | straight, MPD | 6F guide |
| Envoy 6F | .070 / .083 | 100 cm | MPC, MPD, straight, H1 | 6F guide |
| Cello 8F / 9F | .075 / .102 · .085 / .118 | 95 / 92 cm | straight | balloon guide |
| FlowGate2 | .084 / .106 | 95 cm | straight | balloon guide |
| Walrus | .087 / .110 | 95 cm | straight | balloon guide |
| Rist 071 / 079 | .071 / .087 · .079 / .093 | 105 cm | straight | radial guides (6F / 7F) |
| Large-bore sheath | .115 / .131 | 90 cm | straight | for 0.088" aspiration |

Coaxial fit uses the real IDs (inner OD + 0.002" ≤ outer ID). For example, a BENCHMARK 071 or Envoy 6F will not take a 0.071" aspiration
catheter, a Cello 8F (.075") takes only ≤0.054" aspiration, and 088 / Walrus guides take a 071.
The guide must also fit the **access sheath**: guides need an introducer ≥ their French size, and balloon guides need 8–9F.
Radial access with a slender sheath refuses long sheaths, balloon guides and anything over 7F.

**Balloon guide (Cello, FlowGate2, Walrus):** key **O**, the *Balloon* button in the guide row, or **Balloon** on the touch pad.
* It inflates only in the cervical ICA/CCA (refused in the aorta) and gives proximal flow arrest.
* A pass made while it is inflated has better success odds, fewer fragments and half the emboli to new territory.
* Moving the guide while inflated warns you (dissection risk) and deflates it.
* Injecting while inflated shows contrast stasis.
* You get a warning after 5 minutes inflated.
* The debrief notes flow-arrest use, or a balloon guide left deflated.

**Access phase** (header **Access**: Femoral / Radial / Skip; saved; `?access=skip` in the URL skips it). It runs before the case:

*Femoral (right CFA):*
1. **AP fluoro of the hip.** Move the hemostat marker with **↑/↓ ←/→** (touch: ◀ ▲ ▼ ▶ hold buttons) onto the middle of the femoral head, below the inguinal ligament.
   Press **Enter/Space** (or *Mark here*).
2. **Ultrasound (transverse), 21G needle.** Aim with **←/→** (only possible at the skin), then advance with **↑** and withdraw with **↓**.
   * Bright pulsatile flash = artery. Dark blood = vein (re-aim laterally).
   * Going through the back wall = hematoma risk.
   * Confirm with the tip in the centre of the lumen. A tip at the lumen edge makes the wire meet resistance.
3. **0.018" wire.** Hold **↑**. If it meets resistance, do not force it (forcing for over 1.2 s causes a dissection); press **Backspace**/*Back to needle* to re-needle.
4. **4F micropuncture sheath** (Enter).
5. **Optional femoral angiogram** (**I**). It shows the CFA bifurcation and the inferior epigastric artery.
   * Too high (external iliac) = retroperitoneal bleed risk. Too low (at/below the bifurcation) = pseudoaneurysm/AV fistula risk.
   * **R** / *Re-puncture* starts again (5 min compression).
6. **Exchange over the 0.035" wire for the sheath.** Choose **5–9F** with **+/−** and short/long with **L**.

*Radial (right wrist):*
1. **Barbeau test** (**B**), shown as a pulse-oximetry trace, types A–D. For type D, use femoral.
2. **Ultrasound puncture** of the ~2 mm radial artery, then the wire, as above.
3. **Glidesheath Slender 5–7F** (its OD is compared with the artery).
4. **Spasmolytic cocktail** (**C**) and **heparin** (**H**).

*In the case:* the anatomy then starts at the wrist (radial → brachial → subclavian → arch). Fluoro shows the arm bones.
Arm spasm is lower if the cocktail was given.

*Scoring:* the access score, complications (high/low puncture, hematoma risk, dissection, hand-ischemia risk, radial spasm),
time and feedback carry into the case and the debrief. **Esc** / *Skip access* goes straight to the case.

**Great-vessel selection by pull-back (Vert / Berenstein / H1):**
1. Wire to the aortic root, catheter over it.
2. Pull the wire ≥10 mm back into the catheter.
3. Select the catheter (**2**) and torque the tip up to the arch roof. Torque 0° = cranial; the Aim HUD shows "↓ Brachiocephalic ✓".
4. Hold **↓ without Shift**. The tip **drops into each origin it passes**, with a visible jump and a ring flash at the ostium:
   brachiocephalic first, then left CCA, then left subclavian (pulling back from the ascending aorta).
5. Pull a little more and it pops out and continues. A small push (≈3 mm) also pops it out.

The Aim HUD previews the next origin: "↓ vessel ✓" (will catch), "· flips out" (torque is off), "· slides past", or "rotate tip up".
* Type I: easy.
* Bovine arch: a Vert cannot catch the LCCA (it arises from the BCA).
* Type III: the Vert slides past or flips out of the BCA/LCCA; the H1 still catches.
* A tip pointing away from the roof slides past everything.

There are no hidden selection windows: the catch depends on the tip direction against the origin angle, the arch type and the pull speed.

**Shapes (corrected):**
* **VTK:** long primary curve forming a reverse hook (≈28 mm limb), with a short distal tip bent ≈95° away from the shaft (Vitek 1973: "acute tip slightly over 90°").
* **H1:** all bends on the same side (no S-shape), in 3D and in the shape preview.
* Vert, Bern, Sim2 and MPD were checked to be single-sided too (engine test).

## Forming the Simmons 2 / using the Vitek — exact key steps
The HUD shows **Aim** (which branch the active wire/catheter will take with the current torque — rotate until it shows
your target with ✓) and **Guidewire vs catheter tip** (mm; "behind the curve ✓" when the curve is free). The hint panel
shows the current step and progress ("12/60 mm"). Rotation is 45°/s (Shift = 150°/s).

*Simmons 2 — LSA technique:* **5** (guidewire) → hold **Shift+↑** until Aim appears near the arch → hold **←** (or →)
until Aim = *Left subclavian ✓* → hold **↑** into the LSA (+2–3 s deeper) → **2** (catheter) → **Shift+↑** until it stops at
the wire tip (step 3/4) → **5** → hold **↓** until 60/60 mm (step 4/4) → **2** → hold **↑**: the loop forms (it stops by
itself when formed; release ↑) → keep **↑** to pop the tip out of the LSA (loop free) → rotate **←/→** until Aim =
*Left CCA ✓* (or the target) → hold **↓ without Shift**: the tip hooks the origin ("Engaged in …").

*Simmons 2 — aortic-valve technique:* **5** → **Shift+↑** to the aortic root (stops at the valve) → **2** → **Shift+↑**
to the wire tip → **5** → **↓** until 60/60 mm → **2** → **↑** until FORMED (auto-stop; extra pushing is tolerated
~35 mm before it unforms) → rotate to Aim ✓ → **↓** gently to engage.

*Vitek:* **5** → **Shift+↑** to the aortic root → **2** → **Shift+↑** to the wire tip → **5** → **↓** ~30 mm: the curve
re-forms by itself (FORMED) → **2** (rotate the CATHETER, not the wire) → **←/→** until Aim = *Left CCA ✓* (type I /
bovine ≈ 270–300°) → **↓ without Shift** until "Engaged in Left CCA". A Shift pull slides past the origins (tip shown).

## Phone / tablet (touch) and installing as an app

The same `index.html` adapts to the screen. On a touch device (or any window ≤ 900 px wide, or `index.html?touch=1`) a touch pad replaces the keyboard:

- **Device chips 1–7** (Guide, Select, Asp, Micro, GW, µWire, SR): tap one to select it. The button below inserts or removes it. **Load triaxial** is next to it.
- **PUSH / PULL**: hold to advance or withdraw. **Fast** toggles fast mode (Shift on a keyboard).
- **Torque dial**: drag around it to rotate, or hold ⟲ / ⟳. The **Aim** line above the chips shows which branch the tip points at.
- **Big buttons**: Fluoro (hold), Contrast, Roadmap, Aspiration on/off, Unsheathe (hold), Fluff (hold), Retrieve, Wait 30 s, View AP/LAT, Biplane, Plane A/B, Zoom 1×. **☰ More** opens a sheet with the device sizes, case brief and log.
- **Pinch** the fluoro image to zoom; Zoom 1× resets it. Holding a control never scrolls or zooms the page, and nothing depends on hover.
- **Layout**: in portrait the image is on top and the controls are below, all on one screen. In landscape the image is on the left and the controls on the right. Biplane shows one plane at a time in portrait (Plane A/B switches), and side by side in landscape. Arabic (RTL) works the same way.
- **Speed**: pixel density is capped on phones, and quality drops automatically if the frame rate stays under about 32 fps.

**Install / offline.** The app includes a web manifest and a service worker (`manifest.webmanifest`, `sw.js`, `icons/`). The service worker only runs when the folder is served over **https** (or http on localhost); it does not run from `file://`.
1. Put the `nir-sim` folder on any static host, for example GitHub Pages, Netlify or Cloudflare Pages (all free, all need an account).
   - For a local network test only: `python3 -m http.server 8080` in the folder, then open `http://<laptop-ip>:8080` on the phone. Over plain http on a LAN, install/offline will not work; it needs https.
2. **iPhone (Safari)**: Share → *Add to Home Screen*. **Android (Chrome)**: ⋮ → *Install app* / *Add to Home screen*.
3. Open it once while online. After that it works offline. When files change, bump `VERSION` in `sw.js`.

Mobile test (Playwright, iPhone 14 portrait and Pixel 7 landscape, touch only, full stent-retriever case): `node tests/mobile.test.js`.

## Cases
* **Left M1 occlusion – from the groin**: full case (femoral access → arch → left ICA → M1 thrombectomy).
* **Left M1 occlusion – guide already in left ICA**: intracranial part only.
* **Left M1 occlusion – tortuous siphon**: guide in the left ICA, tortuous carotid siphon (ophthalmic hang-up case).
  The header **Siphon** selector also makes any case's siphon tortuous.
* **Navigation practice**: select every arch vessel present (BCA, R CCA, R subclavian, R vertebral, L CCA,
  L subclavian, L vertebral) in any order, disengaging and re-selecting as often as you like. Each selection
  (≥15 mm inside) is logged with the catheter + shape used and shown in the goal list.

## Controls
| Action | Keyboard | On screen |
|---|---|---|
| Advance / retract active device | ↑ / ↓ (or W / S), hold **Shift** for fast | Advance ▲ / Retract ▼ (hold) |
| Torque wire J-tip | ← / → (or A / D) | ⟲ / ⟳ (hold); dial shows torque and projected deflection |
| Select device | 1 guide · 2 selective · 3 aspiration · 4 microcatheter · 5 guidewire · 6 microwire · 7 stent retriever | "Use" |
| View AP / LAO / lateral | V | view buttons |
| Gentle pull-back (shaped tips pop into origins) | ↓ without Shift | Retract ▼ |
| Tip close-up inset | K | Tip close-up checkbox |
| Insert / remove device | — | Insert / Remove |
| Contrast injection (DSA run; roadmap puff when roadmap mode is on) | C | Inject contrast |
| Roadmap mode | R | checkbox |
| Fluoro pedal | Space (hold) | Fluoro pedal (fluoro also turns on automatically while you move devices) |
| Aspiration pump (aspiration catheter, or the guide if no aspiration catheter = proximal aspiration) | P | Aspiration pump |
| **Unsheathe** stent (push wire held, microcatheter pulled back) | **E (hold)** | Hold: unsheathe |
| **Push-and-fluff** while unsheathing | **G (hold)** | Hold: push & fluff |
| Auto-unsheathe (controlled) | Shift+E | Unsheathe (auto) |
| Retrieve stent retriever | T | Retrieve stent retriever |
| Biplane / single plane | B | Biplane button |
| Withdraw aspiration catheter | Y | button |
| Zoom | Z / X, mouse wheel | Zoom + / − , Auto zoom |

## Typical workflows
**Navigation:** insert the 5F selective catheter (alone or through the guide) → 0.035" wire → bring the catheter tip
to the ostium, torque it toward the branch, advance the wire out of it, then follow with the catheter (it stops at the
wire tip). Beyond the arch the J-wire itself steers by torque; a tip pointing at a wall stalls — pushing a stalled
tip causes dissection/perforation. For the M1 case, telescope the guide over the selective catheter into the left
ICA, then remove the wire and selective catheter.

**Direct aspiration (ADAPT):** guide in ICA → remove 0.035" wire → insert aspiration catheter, microcatheter,
0.014" microwire → navigate to M1 → bring aspiration catheter up → remove microwire + microcatheter → advance the
aspiration catheter to the clot face (it stops there) → pump ON → wait until "NO FLOW – corked" (~60–90 s) →
withdraw. An automatic control run grades mTICI.

**Stent retriever with unsheathing (+ aspiration, "Solumbra")** — a "Next step" hint under the image guides each step:
1. Choose sizes (e.g. 0.021" micro, 0.014" microwire, 4×30 SR) → **Load triaxial** (guide > aspiration > microcatheter > microwire; the guidewire must be out).
2. Wire leads, micro follows (keys 5 / 4, ↑) through the proximal-M1 clot into the **M2** (≥6 mm beyond the clot).
   Bring the aspiration catheter (3) up to the clot face (it stops there).
3. **Remove the microwire** (6 Microwire → Remove).
4. **Insert the stent retriever**, select it (7) and **advance the push wire** until the distal marker reaches the
   microcatheter tip — it stops there ("ready to unsheathe").
5. **Unsheathe:** hold **E** / "Hold: unsheathe" — the push wire stays fixed and the microcatheter is pulled back;
   the stent opens distal → proximal and the distal markers splay apart. Optionally hold **G** (push-and-fluff)
   while unsheathing across the clot (3–10 mm is ideal; more = over-fluff warning). Keep going until the
   proximal marker is free ("deployed"). Advancing the micro again re-sheathes a partly open stent.
   *Pushing the stent out with the wire instead (a new push past the tip) is penalised: warning, dissection/spasm
   risk, lower success, more fragmentation.*
6. **Wait** 3–5 min for integration (Wait buttons).
7. Aspiration ON (aspiration catheter at the clot face = Solumbra, or through the guide with no aspiration
   catheter = proximal aspiration) → **Retrieve** (T). An automatic control run grades mTICI.

## Ophthalmic / siphon hang-up
The aspiration catheter can catch on the ophthalmic origin (ledge effect) at the end of the cavernous ICA. Risk ≈
0.3 × bore × siphon (tortuous ×1.8) × support × guide position (rotation ×0.5), where support is: nothing ahead 1.6 ·
wire only 1.1 · micro beyond the siphon 0.75 · micro in M2 0.4 · deployed SR anchor 0.12, and micro 0.027" ×0.7 /
0.017" ×1.15. When hung, the tip stalls (red ring + "HANG-UP"), the catheter **buckles** in the cervical ICA and the
**guide backs out**; forcing it (Shift) risks **dissection** and **guide prolapse** into the CCA (access lost). Remedies:
(a) advance the microcatheter/microwire into M2 and track over it, (b) deploy the SR and use it as an anchor, (c) rotate the
aspiration catheter (select 3, ←/→) while advancing gently, (d) a 0.027" microcatheter, or a smaller bore. Backing off
frees the tip; the next pass is re-rolled with the new support.

## Model (simplified)
* 3D centerline vessel tree (≈mm scale) projected for AP/LAO/lateral; radiological convention in AP.
* Devices share one centerline "track"; coaxial rules (catheter cannot pass its wire, sizes must fit vessels,
  large-bore catheters stop at the clot face).
* Pass outcome is probabilistic: clot coverage, distal stent overhang, integration time, catheter-tip/clot contact,
  aspiration, engagement time and pass number change success / fragmentation / emboli-to-new-territory odds.
* Clot in the proximal left M1 just beyond the ICA terminus: the ACA fills, the lenticulostriates and the MCA tree do not.
* mTICI from perfused fraction of the MCA territory (lenticulostriate, anterior temporal and M3/M4 branch weights).
* SR outcome also depends on deployment technique (unsheath vs push-out), push-and-fluff, and Solumbra vs
  proximal vs no aspiration.
* Complications: perforation (pushing into small branches/dead ends/stalled tip, 0.035" wire intracranially),
  dissection (unsupported catheter advancement, pushing against walls), vasospasm (large catheter dwell),
  emboli to new territory, blood loss from free-flow aspiration.

## Adding a case
Add an object to `NIR.scenarios` in `js/scenarios.js` (`setup(sim)` can add clots with
`sim.addClot(segmentId, s0, s1)` and pre-place devices with `sim.placeDevice(dev, segmentId, mm)`), and its
title/brief strings (EN + AR) in `js/i18n.js`. Vessels are defined in `js/anatomy.js` (arch types in
`ARCH_CURVES`/`ORIGINS`, variants in `archDefs`).

## Tests
`node tests/engine.test.js` (no dependencies: anatomy for all 15 arch/variant combinations, shape-selection matrix,
7-vessel sequence with re-selection, Simmons pull-back, proximal-M1 clot and non-filling lenticulostriates,
full intracranial tree, skull containment of vessels and devices, short body, device-size compatibility matrix,
triaxial passage, SR unsheathing / push-and-fluff / push-out penalty / partial-pull block / re-sheath /
proximal aspiration, aspiration passes, complications, Arabic completeness).
`npm i playwright-core && CHROME=/path/to/chrome node tests/browser.test.js` (UI, views, arch selectors, size
selectors, triaxial loading, biplane, a complete SR deployment + retrieval driven through the UI buttons/keys, RTL).
Screenshots: `shot-biplane.png`, `shot-sr-deployed.png`.
`node tests/mobile.test.js` (phone emulation, touch only). `node tests/v8.test.js` (real keys on desktop and touch on an
iPhone: femoral and radial access, guide menu, balloon guide, Vert pull-back dropping into BCA → LCCA → LSA).
v8 screenshots: `shot-access-*.png`, `shot-guide-menu.png`, `shot-shapes.png`, `shot-vert-drop.png`, `shot-mobile-access.png`, `shot-mobile-drop.png`.

**Training prototype — not a validated medical simulator.**
