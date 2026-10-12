# Aufkl Panther sprocket shaft continuity implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Root assigns one runtime writer; implementation receives fresh specification then quality review. Steps remain unchecked until verified.

**Goal:** Remove tooth-boundary resets in the reconnaissance Panther's complete sprocket shaft while preserving current mesh, tooth alignment and unwrapped track travel.

**Architecture:** Lift the existing wrapped `sprocketPhase` result onto a per-model/per-side continuous angle using travel-delta prediction. Use the same seam for the existing procedural toothed-idler path. Geometry and simulation owners remain unchanged.

**Tech Stack:** Existing JavaScript CPU model builders and Node tests. No native/WASM implementation change is required for this rendering branch repair.

**Specification:** `docs/superpowers/specs/2026-10-12-aufkl-sprocket-continuity-design.md`.

## Task 1: reproduce the actual shaft snap

**Files:** Create `client/web/test/sprocket-phase-continuity.test.mjs`. Read `client/web/src/gfx/track.js` and `client/web/src/gfx/tankmodel.js`; do not edit source until RED is recorded.

- [ ] Build the actual `de_aufkl_panther` model using `loadData`, `decodeImported` and an in-memory renderer patterned on `running-gear-closure.test.mjs`. Keep the original model data intact. Use empty turret builders only when isolating running gear; include its real imported bundle.
- [ ] Add the recorded CPU fixture against the real owner:

```js
const sprocket = M.wheels.find(w => w.role === 'sprocket' && w.side === 1);
const level = M.stations.map(() => 0);
const update = travel => {
  const dyn = {lifts: {1: level, [-1]: level},
    travel: {1: travel, [-1]: travel}, lod: 2};
  M.updateRunningGear(dyn); M.root.update();
  assert.equal(dyn.travel[1], travel);
  return sprocket.node.pitch;
};
const before = update(.945), after = update(.946);
assert.ok(Math.abs(after - before) < .01,
  `shaft must continue across the tooth boundary: ${before} -> ${after}`);
```

- [ ] Add a world-matrix witness using a nonsymmetric point on the hub, proving the same transition is a small rotation, not just a renamed scalar. Read position bytes with `STRIDE`; never change the mesh to make it symmetric.
- [ ] Run `node --test client/web/test/sprocket-phase-continuity.test.mjs`. Expected RED: the actual angle delta is approximately `0.32842233099512863 rad`, exceeding `.01`. Save the assertion and receipt in the task log, without creating generated artifacts in protected data.

## Task 2: travel-predicted phase lifting

**Files:** Modify `client/web/src/gfx/track.js`; extend `client/web/test/sprocket-phase-continuity.test.mjs`.

- [ ] Add helper RED tests for same-phase repeat, forward and reverse branch crossing, ten-tooth skipped samples, negative travel, large positive/negative cumulative travel, and separate state objects. Each case must assert both the intended winding and modulo tooth equivalence; a modulo-only test would pass the broken raw implementation.
- [ ] Use explicit skipped-sample expectations, including this forward case:

```js
const teeth = 19, step = 2 * Math.PI / teeth, pitch = .15;
const state = {initialized: false, angle: 0, travel: 0};
liftSprocketPhase(.02, teeth, 0, pitch, state);
const result = liftSprocketPhase(.02, teeth, 10 * pitch, pitch, state);
assert.ok(Math.abs(result - (.02 + 10 * step)) < 1e-10);
```

- [ ] Run the focused command and record missing-helper RED. Add this helper next to `sprocketPhase`; retain the existing raw function and return range:

```js
export function liftSprocketPhase(phase, teeth, travel, pitch, state) {
  const step = TAU / teeth;
  if (!state.initialized) {
    state.initialized = true; state.angle = phase; state.travel = travel;
    return phase;
  }
  const predicted = state.angle + (travel - state.travel) * step / pitch;
  state.angle = phase + Math.round((predicted - phase) / step) * step;
  state.travel = travel;
  return state.angle;
}
```

- [ ] Do not allocate arrays/objects inside this helper, normalize the returned angle modulo a tooth, or mutate `travel`. Inputs come from already-valid running-gear geometry; do not hide a broken pitch/pose by returning a plausible zero angle. Retain any existing upstream finite-state validation.
- [ ] Run the helper cases GREEN. The actual model fixture stays RED until the owner is wired in Task 3.

## Task 3: integrate the existing rendered axles

**Files:** Modify `client/web/src/gfx/tankmodel.js` import, side construction and `updateRunningGear`; extend `client/web/test/sprocket-phase-continuity.test.mjs`.

- [ ] Import `liftSprocketPhase`. Add two independent once-allocated state objects to each existing `sides.push` record: `sprocketPhaseState` and `idlerPhaseState`, each `{initialized:false, angle:0, travel:0}`. Keep the existing `idlerPhaseLoop` object, teeth derivation, wheel nodes and mesh builders.
- [ ] Replace the raw sprocket assignment with:

```js
const phasePitch = loop.length / linkCount;
const rawSprocketPhase = sprocketPhase(loop, pins, linkCount, rg.sprocket, teeth);
sd.sprocket.node.pitch = liftSprocketPhase(rawSprocketPhase, teeth,
  dyn.travel[side], phasePitch, sd.sprocketPhaseState);
```

- [ ] Inside the existing `idlerTeeth && !sd.idler.node.imported` condition, after updating `idlerPhaseLoop`, replace its raw assignment with:

```js
const rawIdlerPhase = sprocketPhase(sd.idlerPhaseLoop, pins,
  linkCount, rg.idler, idlerTeeth);
sd.idler.node.pitch = liftSprocketPhase(rawIdlerPhase, idlerTeeth,
  dyn.travel[side], phasePitch, sd.idlerPhaseState);
```

- [ ] Keep `placeLinks(..., -dyn.travel[side], ...)`, source `rg.sprocket.teeth`, derived teeth count, ordinary wheel/idler rotation, meshes, materials and physics travel accumulation unchanged. No lookup by vehicle ID and no special Aufkl speed/radius fudge is permitted.
- [ ] Run the actual boundary fixture GREEN. Sweep the actual Aufkl from `0 → 2 m` in 1 mm steps, then reverse to `-2 m`; verify finite small adjacent shaft increments, direction away from wrap-selector ties, and raw phase equivalence modulo `2π/teeth` at every sample. Also test skipped render samples spanning ten teeth using the actual current effective pitch. Do not clamp the angle to make the continuity assertion pass.
- [ ] Add left/right opposite-travel and two-model independence tests. Repeated same pose must preserve angles; new model construction must begin with independent initialized zero-travel reference.

## Task 4: geometry preservation and existing paths

**Files:** Extend `client/web/test/sprocket-phase-continuity.test.mjs`; run existing targeted tests without modifying their acceptance thresholds.

- [ ] Cover `lod:0/1/2`, bounded positive/negative lift, nonneutral slack and ordinary ground samples. On a LOD/shape change with fixed travel, compare the lifted angle's nearest branch with the previous value and preserve raw modulo equivalence. This case verifies winding ownership; it must not pretend B2 has certified path continuity.
- [ ] Add the existing procedural toothed idler from `de_rso_pak40` and `de_rso_flak`. Add decoded `de_vk1602` and `su_att_m46` imported-sprocket fixtures; both sides have three `sprocket_model` children. For each imported fixture, use its unchanged loop/pitch/teeth and the raw function to scan `0 → 2 m` in 1 mm increments; select an adjacent raw drop exceeding half that fixture's tooth period and preserve those exact travel values as its boundary witness. Do not assume the Aufkl's `.945/.946 m` values are a boundary for another chassis. Assert `wheel.node.imported === true`, call `M.root.update()`, and compare actual child world-matrix orientation at that boundary, reverse and skipped samples. Use original asymmetric imported vertices as witnesses and remove translation before comparing the transformed directions; do not replace them with an invented cylinder. Check unchanged instance count, mesh position/winding bytes, source bundle bytes, and no additional mesh allocation per update. Preserve mirror/side behavior.
- [ ] Run `node --test client/web/test/sprocket-phase-continuity.test.mjs client/web/test/running-gear-closure.test.mjs client/web/test/running-gear-dynamics.test.mjs client/web/test/hvss-running-gear.test.mjs client/web/test/rso-pak40-firing-config.test.mjs client/web/test/tank.test.mjs`. Expected: all PASS with original tolerances.
- [ ] Root runs the full web suite after concurrent protocol work is coherent, then `git diff --check` and protected-data/asset diff inspection. The diff may include this focused JS helper/owner/test and its docs, never a modified source model or native track solver.
- [ ] Root obtains fresh specification and quality reviews. Review must reject shortest-angle-only unwrap, input travel modulo, a full-node tooth-period reset, shared model state, or a tooth-count/geometry correction hidden in this patch. Root owns focused staging and integration.
- [ ] Report the original CPU RED fixture and fresh GREEN evidence. Do not claim browser appearance, fixed-pitch physical closure, B completion or exact collision certification from this rendering continuity repair.
