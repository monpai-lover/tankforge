# Rangefinder equipment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Execute after Task R passes new specification and quality review; only one runtime writer.

**Goal:** Instant explicit laser ranging and faster optical ranging with preserved F repair behavior and exported equipment identity.

**Architecture:** One validated equipment resolver feeds runtime timers and workshop serialization. Extend the existing optional Rust/schema rangefinder contract; cancel an in-flight measure on weapon/context changes. Original vehicle files stay unchanged.

**Tech Stack:** Existing JS/Node, Rust serde/vehicle validation, JSON schema.

## Task L: classification, measurement and round trips

**Files:** Create `client/web/src/game/rangefinderEquipment.js` and `client/web/test/rangefinder-equipment.test.mjs`; modify `game/loadout.js`, `game/workshop.js`, `game/workshopBuild.js`, `src/main.js`, `crates/vehicle/src/files.rs`, `crates/vehicle/src/validate.rs`, existing Rust constructors/fixtures that instantiate RangefinderDef, and `schemas/weapons.schema.json`. Add focused Rust/JS tests.

- [ ] Add RED tests extracting actual main ranging functions and invoking the actual F controller: laser short-release completes synchronously without ranging state; optical 1s finite delay; manual original delay; long F never measures. Confirm existing behavior fails.
- [ ] Define validated kinds `manual`, `coincidence`, `stereoscopic`, `laser` with optional Rust field (None omitted), strict enum and schema. Keep positive legacy time requirements; add `kind: None` only to authored constructors. Test old JSON, new enum, rejected unknown kinds and exact export loading.
- [ ] Resolver accepts validated explicit identity, then exact Panther F/source-sight registry, then manual; invalid enum is never laser. Normalize finite positive timing/range and finite error. Optical time is `Math.min(legacyTime, 1)`; laser completion is a separate branch, never total=0.
- [ ] Integrate source context into stock and donor loadouts without mutating sources. Keep old field values intact. Independent MG uses manual unless the loadout identifies a shared coaxial sight.
- [ ] Add per-turret workshop `rangefinderKind` selector with default inherit; normalize enum and preserve settings, imports and exports. Export generated weapons with supported kind and default/legacy numeric values; sight donor identity survives transplantation. Verify keepStock and extra towers.
- [ ] Update start/finish/step/draw owners: validated context, synchronous laser completion, finite clamped optical progress, cancel on gun/turret/model/mode changes and invalid control. Same finish math/RNG/LOS/autoZero/sound/error path for all kinds. Preserve action key routing.
- [ ] Verify full42 vehicle identities, actual controller behavior, fixed-LOS result equality, sky/overrange, source immutability and workshop export/load round trip. Run related actions/loadout/weapon tests plus `cargo test -p tg-vehicle -p tg-design`; coordinate native resource use.
- [ ] Build, commit only L hunks (main has unstaged B pose hunk), then fresh SPEC PASS followed by fresh QUALITY APPROVE. Record exact checks. No browser/HTTP/CDP/Playwright access or early publication.

## Accepted timing contract

```js
const total = kind === 'laser' ? null :
  kind === 'coincidence' || kind === 'stereoscopic' ? Math.min(time_s, 1) : time_s;
// laser invokes completion directly. Only finite total > 0 enters G.ranging.
```

Completion requires actual runtime and exported-data evidence, not enum tests alone. Existing 29 actions/workshop baseline passes do not prove the new behavior.
