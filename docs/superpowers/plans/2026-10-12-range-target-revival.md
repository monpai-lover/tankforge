# Single-player range target revival implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Root is the sole runtime writer; each implemented task receives fresh specification and quality review. Steps remain unchecked until executed and verified.

**Goal:** Revive destroyed offline authored range targets after 15 simulation seconds, at most one every 2 seconds, without resetting living targets or rebuilding models.

**Architecture:** A focused scheduler observes the final per-update enemy states. A reset adapter obtains fresh shared-core state and restores captured rest articulation on the existing actor. `main.js` gates the world and clears scheduling on enemy-list teardown.

**Tech Stack:** Existing JavaScript, Node test runner, CPU model builders, current actual WASM combat tests. No native change is required for the timing feature.

**Specification:** `docs/superpowers/specs/2026-10-12-range-target-revival-design.md`.

## Task 1: deterministic scheduler

**Files:** Create `client/web/src/game/rangeTargetRevival.js`; create `client/web/test/range-target-revival.test.mjs`.

- [ ] Write the scheduler RED cases before implementation. Use `step(0, targets, revive)` to observe death, then check just-before and exact eligibility and spacing:

```js
const r = new RangeTargetRevival();
const a = {rangeTarget: true, remote: false, alive: false};
const b = {rangeTarget: true, remote: false, alive: false};
const seen = [];
const revive = e => {seen.push(e); e.alive = true; return true;};
r.step(0, [a, b], revive);
r.step(14.999, [a, b], revive);
assert.deepEqual(seen, []);
r.step(.001, [a, b], revive);
assert.deepEqual(seen, [a]);
r.step(1.999, [a, b], revive);
assert.deepEqual(seen, [a]);
r.step(.001, [a, b], revive);
assert.deepEqual(seen, [a, b]);
```

- [ ] Add cases for staggered deaths, oldest-first selection, a living damaged target retaining the same state object/bytes, remote and non-range exclusions, removed targets, `reset()`, repeated death after revival, `step(60)` producing one callback, failed callbacks consuming no slot, and negative/nonfinite `dt` producing no time advancement.
- [ ] Run `node --test client/web/test/range-target-revival.test.mjs`. Record missing-module/export failure as RED; do not weaken boundary assertions.
- [ ] Implement this scheduler in the new module. It is the only owner of these two feature constants and the simulation clock:

```js
export class RangeTargetRevival {
  constructor() { this.reset(); }
  reset() { this.time = 0; this.nextAllowed = 0; this.dead = new Map(); }
  step(dt, targets, revive) {
    if (!Number.isFinite(dt) || dt < 0) return null;
    this.time += dt;
    for (const e of this.dead.keys()) {
      if (!targets.includes(e) || !e.rangeTarget || e.remote || e.alive) this.dead.delete(e);
    }
    let selected = null, oldest = Infinity;
    for (const e of targets) {
      if (!e.rangeTarget || e.remote || e.alive) continue;
      if (!this.dead.has(e)) this.dead.set(e, this.time);
      const at = this.dead.get(e);
      if (this.time - at >= 15 && at < oldest) { selected = e; oldest = at; }
    }
    if (!selected || this.time < this.nextAllowed || !revive(selected)) return null;
    this.dead.delete(selected);
    this.nextAllowed = this.time + 2;
    return selected;
  }
}
```

- [ ] Run the same command and record all scheduler cases GREEN. The authored range has eight targets; the bounded membership scan avoids a new collection per frame. Retain semantics and do not add wall-clock scheduling.

## Task 2: restore one real target

**Files:** Modify `client/web/src/game/rangeTargetRevival.js`; modify `client/web/test/range-target-revival.test.mjs`; reuse fixtures from `client/web/test/range-vehicles.test.mjs` and `client/web/test/replay-pose.test.mjs` without editing unrelated tests.

- [ ] Add an actual `buildTank`/`Enemy`/`Combat` fixture. Register independent actor keys for two copies of a stock tank. Damage the chosen actor using the actual WASM report, empty its rack fill, mark it destroyed and displace/tilt its turret as `onCombatHit` does. Record its model, loadout, body, key, hull origin and mesh allocation count; record the other actor's state bytes. Capture a hit-camera snapshot before reset. The RED assertions require fresh state/caps and restored poses while all recorded identities, lane, other-state bytes and frozen replay remain unchanged.
- [ ] Include a fallback actor with no core and bind it after revival using `useCombat`; assert fresh modules/crew/racks and the same model. Also exercise a supplied core returning no fresh state: actor and scheduling deadline must remain unchanged.
- [ ] Run `node --test client/web/test/range-target-revival.test.mjs`; record the new adapter tests RED.
- [ ] Add the following snapshot/reset adapter to the same module, importing `useCombat` from `./enemies.js`. The `rest` field is assigned once at spawn and contains only existing node poses:

```js
const copyPose = node => ({node, pos: node.pos.slice(), yaw: node.yaw,
  pitch: node.pitch, roll: node.roll, local: node.local && node.local.slice()});

export function captureRangeTargetRestPose(e) {
  return {fold: e.fold || 0, turretYaw: e.turretYaw,
    turretYaws: e.turretYaws && e.turretYaws.slice(), gunPitch: e.gunPitch.slice(),
    joints: e.model.turrets.flatMap(t => [t.node,
      ...t.guns.flatMap(g => [g.node, g.barrel].filter(Boolean))]).map(copyPose)};
}

export function reviveRangeTarget(e, combat = e.combat) {
  if (!e.rangeTarget || e.remote || e.alive || !e.rangeRestPose) return false;
  const rest = e.rangeRestPose;
  if (combat) combat.setFold(e.combatKey, rest.fold);
  const fresh = combat ? combat.fresh(e.combatKey, e.sourceBundle || e.bundle) : null;
  if (combat && !fresh) return false;
  e.cstate = fresh ? fresh.state : null;
  e.caps = fresh ? fresh.caps : null;
  if (combat) useCombat(e, combat, e.combatKey);
  e.hp = 100; e.alive = true; e.toss = null; e.seen = null; e.hits.length = 0;
  e.fold = rest.fold; e.turretYaw = rest.turretYaw;
  e.turretYaws = rest.turretYaws && rest.turretYaws.slice();
  e.gunPitch = rest.gunPitch.slice();
  for (const saved of rest.joints) {
    const {node, pos, local, ...angles} = saved;
    Object.assign(node, angles, {pos: pos.slice(), local: local && local.slice()});
  }
  e.pose();
  return true;
}
```

- [ ] Check the current B/X lifecycle adapters at implementation time. If those have already been integrated, call their existing actor-life reset operation once at the reset boundary and add the corresponding accepted-generation/chain/deformation test. Do not implement another B mechanism in this feature or block the current timer on unrelated B2 completion.
- [ ] Run the focused command and `node --test client/web/test/range-vehicles.test.mjs client/web/test/replay-pose.test.mjs client/web/test/modular-damage.test.mjs`; require fresh reset assertions and unchanged existing replay/late-readiness behavior.

## Task 3: wire the authored offline range only

**Files:** Modify `client/web/src/main.js` imports, setup, `spawnEnemies`, `clearEnemies` and update after `updateShots`/`updateBullets`; extend `client/web/test/range-target-revival.test.mjs` with live-owner extraction matching existing range tests.

- [ ] Add live-owner RED coverage proving `spawnEnemies` captures rest poses, `clearEnemies` resets the scheduler, and the actual range gate ticks only offline battle range. Test garage, design `test` mode, ordinary map, online range, list teardown/re-entry and living targets. Extract named functions as existing `range-vehicles.test.mjs` does; do not verify wiring only by string occurrence.
- [ ] Run the focused command to record missing live wiring RED.
- [ ] Import `RangeTargetRevival`, `captureRangeTargetRestPose`, and `reviveRangeTarget`; create one `const rangeTargetRevival = new RangeTargetRevival()` near enemy setup. At the start of `clearEnemies`, call `rangeTargetRevival.reset()`. In `spawnEnemies`, after `useCombat` and before pushing the target, assign `e.rangeRestPose = captureRangeTargetRestPose(e)` only for `e.rangeTarget`.
- [ ] Add this named adapter next to enemy setup and call it once immediately after both `updateShots(dt)` and `updateBullets(dt)`, before scene collection:

```js
function updateRangeTargetRevival(dt) {
  if (G.mode !== 'battle' || G.mapId !== 'range' || G.map || G.online) return;
  rangeTargetRevival.step(dt, G.enemies, reviveRangeEnemy);
}
function reviveRangeEnemy(e) {
  return reviveRangeTarget(e, G.combat);
}
```

- [ ] Keep missile, splash, fire and projectile death owners unchanged; tests must show that observing their final `alive/caps` state reaches the same timer. Do not call `spawnEnemies`, hide the hit camera, reset the player, send network messages or refill player ammunition.
- [ ] Run `node --test client/web/test/range-target-revival.test.mjs client/web/test/range-vehicles.test.mjs client/web/test/range-ammo-reset.test.mjs client/web/test/replay-pose.test.mjs client/web/test/modular-damage.test.mjs client/web/test/ammo-resupply-runtime.test.mjs`. Expected: all PASS, no old health/state leak or mesh allocation on revival.

## Task 4: root verification and integration

- [ ] Root runs the full web suite with `npm test` from `client/web` after its concurrent protocol work is coherent. Do not mask missing native receipts or rebuild WASM with a stale core fallback merely to run this feature.
- [ ] Verify `git diff --check` and inspect the protected-data diff; this feature must not change source vehicle/weapon/armor/model bytes. Root performs current required combined build/review gates; the docs-only planner performs no builds.
- [ ] Obtain fresh specification then quality review against this spec, including simulation-time boundaries, complete fresh state, stable model/key and frozen replay. Mark tasks only after evidence exists. Root owns any focused staging/commit/integration.
- [ ] Document CPU acceptance and the absence of browser appearance verification separately. This feature does not complete exact-hitbox X or physical-track B.
