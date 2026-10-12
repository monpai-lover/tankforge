# Aufkl Panther sprocket shaft continuity design

2026-10-12. The user requested and reaffirmed a fix for the reconnaissance Panther's sprocket rotation. This is an isolated rendering continuity repair, preserving source geometry and unwrapped material travel. It is not a reimplementation of wheel dynamics or physical track closure.

## Inspected cause and reproducible receipt

The actual owner is `client/web/src/gfx/track.js`, not `sim/tank/track.js`. `placeLinks` maps belt offset into a single link pitch to place the closed set of shoes. `sprocketPhase` selects the link near the middle of the sprocket wrap, derives the tooth angle and returns it modulo `2π / teeth`. `gfx/tankmodel.js:updateRunningGear` currently assigns that wrapped value directly to the complete sprocket node. Consequently, crossing a tooth boundary rotates the hub and its bolts backward by almost a tooth even though belt travel moved forward only slightly.

A read-only Node CPU probe on 2026-10-12 loaded the real `de_aufkl_panther` data, used `buildLoop`, `placeLinks`, `sprocketPhase`, decoded its packed model and queried the actual `buildTank` sprocket node/world matrices. Static-loop receipt: 89 links, effective pitch `0.14928796318139922 m`, computed renderer teeth 19, angle period `0.3306939635357677 rad`. At unwrapped travel `0.945 → 0.946 m`, the assigned shaft angle was `0.3286425391996402 → 0.00022020820451157386 rad`: a `0.32842233099512863 rad` jump for 1 mm of travel. The correct same-tooth-equivalent continuation differs by about `+0.00227163254 rad` instead.

The Aufkl's actual sprocket nodes use procedural meshes even though its turret uses imported source geometry. Read-only model inventory identified `de_vk1602` and `su_att_m46` as concrete imported-sprocket fixtures: both sides contain three `sprocket_model` child nodes. Include their child world-matrix orientation, so an Aufkl-only procedural test cannot conceal an imported-axis regression.

The source descriptor's `sprocket.teeth` is 17, while this existing renderer derives 19 from the unchanged loop/pitch/radius. This separate calibration discrepancy is documented, not changed by this continuity fix. It must not be used to modify asset geometry, mesh topology, teeth count or engineering data during this task.

The simulation owns unwrapped travel (`sim/tank/tank.js` accumulates belt speed into `t.travel[side]`). That value is already available in `updateRunningGear`. There is no need to alter its units, modulo it in the simulation, change the drivetrain or require B1/B2.

## Accepted repair

Keep the existing raw tooth-alignment function and tooth period. Add a small phase-lifting helper which selects the integer tooth-period branch nearest the predicted continuous shaft angle. Maintain independent state for each model, track side and toothed axle. The predictor is the prior continuous angle plus the signed change in unwrapped travel divided by the current effective link pitch, multiplied by the current tooth period.

For raw angle `a`, period `s`, predicted angle `p`, the lifted angle is `a + round((p-a)/s)*s`. This preserves raw tooth alignment exactly modulo one tooth. Using travel prediction, rather than shortest-angle unwrap alone, also preserves the winding through reverse motion, a render skip and a sample spanning multiple tooth periods. The frame's existing shoe pins remain the source of the local tooth alignment.

`buildTank` initializes state through its existing zero-travel running-gear update. State belongs to the model closure/side record, is allocated once and disappears on model disposal; separate actors must not share it. A new model starts a new reference naturally. Do not infer a respawn from a negative travel delta, because reverse travel is valid. The raw alignment function stays available to existing callers/tests.

Assign the lifted angle to the whole sprocket node. Apply the same lifting to the existing procedural toothed-idler path (`idlerTeeth && !sd.idler.node.imported`), with its own state; leave ordinary idler/wheel spin paths unchanged. Preserve current forward/reverse sign, current effective pitch and the link-placement offset `-dyn.travel[side]`. The helper does not write to `dyn.travel`, physics state, shoe buffers, wheel geometry, or imported source buffers.

Changes in suspension, sag and LOD may change the raw local alignment because the current track path changes. Preserve the nearest winding branch under those changes without introducing a tooth-period shaft reset. This task does not promise to remove geometric path discontinuities, certify constant chord pitch, complete broken chains or grant exact collision authority. The B plan continues to own those requirements. When B later supplies its accepted pins/material phase, this same bounded phase-lifting seam can consume that input; do not duplicate B's phase owner.

## Acceptance

The actual Aufkl boundary fixture must have a shaft-angle delta below `0.01 rad` for the recorded 1 mm motion and remain equivalent to the old raw phase modulo a tooth. Forward and reverse multi-pitch sweeps must retain the intended winding and show no modulo reset. Explicit multi-tooth skipped samples must select the travel-predicted branch rather than alias to the nearest prior angle. Left/right states and two models must remain independent; repeated identical input is stable.

CPU model tests cover near/middle/far LOD, finite changing wheel lifts/slack, the existing toothed RSO idler, procedural and imported sprocket assemblies, unchanged track instance count and immutable mesh bytes. Source/model/armor/weapon files must have no diff. Existing gear-support, HVSS, tank and source geometry tests remain green with their original tolerances. No native simulation, protocol, B1 mass operator, B2 closure solver, new mesh, tooth-count correction or browser workaround is in scope.

Root performs fresh specification and quality review and relevant final gates. This document and the read-only probe establish the defect and implementation scope; they do not claim the fix has been implemented or visually verified.
