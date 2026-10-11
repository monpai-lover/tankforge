# Oplot 23 mm 六管改装 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. One writer, then fresh SPEC and fresh QUALITY. User already approved retaining six barrels and replacing 14.5 mm with 23 mm.

**Goal:** Add a usable, separately selectable six-barrel 23 mm Oplot variant while preserving the original vehicle and assets.

**Architecture:** A focused data-authoring tool creates new variant files, new ammunition and a source-sharing model manifest. Existing loadout, tube geometry, damage and APS owners consume the new definitions. Only fleet ordering/family presentation need narrow source edits.

**Tech Stack:** Existing Python authoring, JSON, JS/WebGL2, Node tests, Rust combat/missile/server. Execute after gameplay room Task3 and mode acceptance in the isolated gameplay worktree; do not copy dirty B2.

Accepted design: `docs/superpowers/specs/2026-10-11-oplot23-variant-design.md`.

## Task 1 — authored variant, live model and actual firing

**Create:** `tools/oplot23-variant.py`; `data/vehicles/su_t10m_oplot23/{vehicle,engine,weapons,visual,armor,modules,crew,model}.json`; `data/projectiles/api_23_bza.json`, `hei_23_ofz.json`; `client/web/test/oplot23-variant.test.mjs`.

**Modify:** `client/web/tools/load-data.mjs` ORDER; `client/web/src/game/mods.js` family. A focused compatibility fix to an existing owner is permitted only if an actual RED proves it necessary. Preserve prior assertions if the expanded fleet requires fixture metadata/counts.

- [ ] Write RED with actual `loadData`, source hash snapshots, `makeLoadout`, decoded imports, `buildTank` fake renderer, actual main firing/aiming functions and actual WASM missile/APS world. New ID must be absent before implementation. Check family selection and source export values.

```js
assert(data.vehicles.su_t10m);
assert(data.vehicles.su_t10m_oplot23);
const gun = data.vehicles.su_t10m_oplot23.weapons.extra_turrets[0].guns[0].gun;
assert.equal(gun.caliber_mm, 23);
assert.equal(gun.autocannon.rate_rpm, 8000);
assert.deepEqual(gun.ammo, ['api_23_bza', 'hei_23_ofz']);
assert.equal(data.projectiles.api_23_bza.mass_kg, .174);
assert.equal(data.projectiles.hei_23_ofz.explosive_mass_kg, .0178);
```

- [ ] Run `node --test client/web/test/oplot23-variant.test.mjs`; record real missing/incorrect behavior.
- [ ] Author only new files from original JSON, using deep copies. Set `vehicle.id` and hypothetical name/meta; retain base file contracts. Reference barrels 1 m/23 mm, gun 76 kg, 8000 rpm, belt500, reload30 s, spin-up.35 s; preserve platform controls/limits/radar. APS uses 23 mm/.174 kg/715 m/s/1 m and range6000–8000, rounds500. Manual ammo300 API+200 HEI. Source-informed versus project-estimated fields are documented.
- [ ] Generate API curve using existing De Marre formula with a declared steel coefficient derived from current B-32 authored curve, new mass/speed/caliber/drag. HEI uses existing HE curve authoring and mass.0178, metadata `a_ix_2`; do not implement P3 as part of this variant. Record projectile dimensions as reference estimates.

```python
cal, mass, velocity = 23.0, .174, 715.0
# Match the project's authoring formula, then recompute every distance with the new inputs.
area = math.pi * (cal * .0005) ** 2
drag_per_m = .5 * 1.225 * .30 * area / mass
velocity_at_distance = velocity * math.exp(-drag_per_m * distance)
```

- [ ] New model manifest has empty owned packed geometry and `shared:{from:'su_t10m',mounts:['turret','gun']}`; retain source housing and exclude original barrel meshes. Add six new `visual.parts` gun/recoil cylinders on turret1/gun0, centered around [.502,2.715,.557] with 1 m muzzle offset. Use outer radius.0225 m, center-circle radius.055 m, 32 segments; interval chord.055 m exceeds outer diameter.045 m. A representative tube:

```json
{"type":"cyl","mount":"gun","turret":1,"gun":0,"axis":"z",
 "pos":[0.557,2.715,1.057],"r":0.0225,"r2":0.0225,"len":1,
 "segs":32,"mat":"steel","recoil":true}
```

Use the existing caliber-derived bore in `addPart`; verify no front disk closes the23mm bore. Reconstruct all six centers by angle2πi/6. Preserve all original model buffers and source0 barrel geometry. Existing visual rotation remains intentionally readable, not a claim of high-RPM motion sampling.
- [ ] Add new ID adjacent to original in ORDER and an `su_t10m` Mods family with 14.5 mm original and 23 mm custom options. Ensure server data loading sees the new directory; source family selections preserve original variant.
- [ ] GREEN tests must measure six open tubes, inner diameter23 mm, non-overlap, matching muzzle plane and correct posed yaw/pitch/recoil; actual API and HEI shot mass/caliber/velocity/filler, consumed ammo, body impulse and readiness. Compare original and new, both modes, primary versus Oplot damage, manual/auto shared ammo, common repair gate. Use actual native core inputs, not a copied descriptor assertion alone. Probe server native data registration and healthy/damaged manual/automatic ownership when Cargo lane is granted.
- [ ] Run focused new test plus mods/workshop/source export, weapon-control, gameplay, launcher, range and modular-damage regressions; run affected native combat/missile/server groups. Hash every original tracked data/model/asset path before/after; newly authored files are additions, not original mutations. Keep original assertions and report any count/title-only fixture changes.
- [ ] Self-review, precise commit/freeze, fresh SPEC PASS then fresh QUALITY APPROVE. No matching page/push before acceptance.

## Task 2 — matching delivery and result documentation

- [ ] Full Node and native verification after new data addition; first regenerate the mandatory source-tagged Rust-to-Node room receipt. Missing/stale bridge data must fail. No old B2 tests/code or threshold changes. Build source-matching release WASM/web page, verify target/asset/single HTML designCore bytes and source guards. If Rust unchanged, verify the newly built exact source artifact rather than claiming an unrelated cached binary.
- [ ] Deliver a distinct named combined modes+Oplot23 page and result MD. Preserve prior pages. Clearly document source/estimated ammo and installation parameters, mode ratios and enemy-marker scope, networking compatibility, tests, and unfinished B2/X/P/replay boundary.
- [ ] Final fresh SPEC then QUALITY, precise integration/push under existing authorization, preserving dirty B2 and original source assets.

Native lane is exclusive. No browser opening/HTTP/CDP/Playwright bypass; visual acceptance remains restricted independently from CPU geometry and build verification.
