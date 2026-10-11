# V3 Replay Replacement and Boundary-aware Overpressure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The approved project sequence requires one runtime writer at a time and fresh SPEC, then QUALITY review after each checkpoint. Root selects execution after the current C2 ammunition writer finishes; this document does not launch workers or authorize concurrent edits.

**Goal:** Replace the current replay with the user's V3 camera/material/projectile/trace pipeline driven by real TankForge records, show the actual fatal cause on player death, keep multi-hit animation in one stable view, and implement evidenced blast propagation through actual boundaries.

**Architecture:** Rust/WASM/server combat remains the sole damage owner. A canonical scope/event/cause envelope feeds pure V3 adapters and one bounded detached replay session in the existing renderer. Preserve R's pose snapshots/leases and consume C2's admitted battle/life identity, then connect a pure semantic blast evaluator to real authoritative burst events.

**Tech Stack:** Rust/serde, existing tg-combat/tg-ballistics/tg-missile/tg-design-wasm/tg-server, browser ES modules/WebGL2, Node CPU and fake-GL tests. No parallel demo damage WASM, second canvas, new offline gun AI or continuum/physiological solver.

---

## Scope, sources and execution rules

Worktree: `C:/Users/24908/.codex/scratch/tankforge-gameplay-modes`. Approved design: `docs/superpowers/specs/2026-10-11-v3-replay-replacement-and-overpressure-design.md`. Read before execution: the prior victim/pose specs, V3 intake/preparation notes, `docs/overpressure-research-2026-10-11.md`, projectile P2–P5 plan, and `target/audit/v3-replay-overpressure-audit-20261011.md`. The forensic audit has already inspected source and run reference CPU tests; do not repeat research or call those tests integrated evidence.

V3 reference root: `C:/Users/24908/.codex/scratch/tankforge-hit-replay-v3-reference-20261011/hit_replay_webgl_wasm_v3`. Correct archive SHA-256: **`5f24750268724a1cb11424f5be1753bf496661a5d47e8113aee3ba80f815d1ce`**. Port the user's own reusable source maximally. Preserve the complete MIT notice, **Copyright (c) 2026 Replay Lab Contributors**. No further licensing approval is required.

This is a documentation deliverable. Every command below is a **future implementation command**, not a test/build result from this planning task. Browser visual validation is **NOT RUN**. Do not run browser, HTTP, CDP, Playwright, publication, or a replacement browser mechanism while the existing restriction remains. Native-handler receipt files and Node/fake-GL gates require no network service. Do not rename/overwrite old named pages, rebuild original GLBs or mutate historical catalog/armor/crew data.

Before Task 1, the sole writer records C2's merged commit and reconciles its exact adapters: native `AmmoScope { battle, life }`, `AmmoLedger.scope`; client `OnlineAmmo.scope()`, admission at Start/Respawned and preserved resume. Replay adds combat `state_version`, `pose_revision`, `geometry_revision`, event/death/cause identity. It never repurposes inventory `revision` or `processed_through`, and never allocates another life counter. B/X accepted pose/geometry and P5 flight are completion prerequisites; legacy receipts remain visibly limited until they are supplied.

Record the pre-edit original GLB/catalog/armor/crew hashes and old named-page list in the execution receipt before runtime edits, so final preservation is checked against a real baseline. This worktree's prior authored build/rules/running-gear/Hetzer receipts remain prerequisites.

## File responsibilities and shared contracts

Paths below are relative to the worktree. A file listed as new is created only by the assigned future runtime writer. Keep handlers small and pure owners focused.

| File | Responsibility |
|---|---|
| `crates/combat/src/replay_evidence.rs` | Serializable actor/event/pose/timed-record envelope types and input limits; projection of admitted identity, no life generation. |
| `crates/combat/src/causes.rs` | Typed mechanism transitions/active cause state usable by native and WASM; never a latest-attacker heuristic. |
| `crates/server/src/replay_receipts.rs` | Canonical admitted discharge→contact→state/death evidence, recipient policy and bounded cause/recent-incoming retention. |
| `crates/server/src/shot_flight.rs` | P5 accepted muzzle/ballistic/contact adapter, using tg-ballistics and B/X geometry; no client speed/distance authority. |
| `client/web/src/game/replayEvidence.js` | Strict validation and normalization of production envelopes; legacy availability diagnostics. |
| `client/web/src/game/replayClock.js` | V3 monotone film↔physical mapping with immutable played prefix. |
| `client/web/src/game/replayCamera.js` | V3 camera/portrait/framing port using TankForge axes and frozen hull bounds. |
| `client/web/src/game/projectileVisuals.js` | Shared catalog/stage prototype geometry and bounded ownership for live flight/replay. |
| `client/web/src/game/projectileReplay.js` | Recorded physical-time sampler/report adapter; no synthetic physical rays or damage. |
| `client/web/src/game/replaySession.js` | Single display target, event/revision timeline, pools, priority, retention and frame sampling. |
| `client/web/src/game/victimReplay.js` | Separate once-only death application/presentation eligibility and deployment handoff. |
| `client/web/src/game/replayPose.js` | Existing R snapshot owner plus Player/accepted-pose reconstruction; leases/rollback stay here. |
| `client/web/src/gfx/replayDraw.js` | V3 trace/shard/semantic material prepared draws; per-view sorting scratch. |
| `crates/combat/src/blast_geometry.rs` | Accepted gas-boundary/opening/compartment/breach query and validation. |
| `crates/combat/src/blast_exposure.rs` | Pure source/route/exposure/severity calculation, separate from solid fragment traversal. Reuse this name from existing P3 plan; do not create a competing `blast.rs`. |
| `crates/server/src/blast_events.rs` | Canonical actual burst/charge events and once-per-target consumption; no client-specified explosive parameters. |
| `docs/third-party/hit-replay-v3-LICENSE.txt` | Verbatim supplied license copied when code is ported. |
| `docs/superpowers/notes/2026-10-11-v3-replay-port-map.md` | Source functions/shaders→destination, exact license/hash and unchanged demo exclusions; checkpoint receipts and missing capabilities. |

Existing integration seams: `crates/combat/src/lib.rs` Report/TargetState/start_fire/shoot/advance/burst helpers; `crates/server/src/lobby.rs` Fired/Player/Damage/Status/apply_shot/advance_combat/missile events; `crates/server/src/missiles.rs` accepted pose conversion; `crates/design-wasm/src/lib.rs` combat_* dispatch; `client/web/src/game/combat.js`, `game/net.js`, `game/enemies.js`, `game/hitcam.js`, `gfx/shaders.js`, `gfx/renderer.js`, `gfx/interior.js`, and narrow `main.js` hit/death/missile/flight/render call sites. Cargo adds `tg-ballistics` to server only if P5 has not already done so.

New names used by tasks:

```js
// ReplayEvidence (wire revision 1)
// actor/shooter: {battle, entity, life}; all identities are admitted, not guessed.
// event_id, shot_id: strings; commit_seq, pose_revision, geometry_revision,
// state_before_version, state_after_version: nonnegative integers.
// state_before is the actual source-event TargetState baseline; report.state is its after-state.
// launch_time_s, impact_time_s: physical seconds; coordinates:'target_hull_metres'.
// accepted_pose:{trust,hull_origin,ex,ey,ez,joints,running_gear,payload,variants}.
// flight:[{time_s,position,velocity_m_s}] in trusted world metres.
// report:actual tg_combat::Report; deaths carry terminal event/commit/time/mechanism/cause,
// reason,state_before_version,state_after_version,state_after and optional accepted_terminal_pose.
// mechanism_records carry actual timed advance deltas, never synthetic fire damage.
// build_hash, anatomy_hash, weapon_instance, projectile_id, parent_mechanism_id.
// seed is a lossless decimal u64 string; scope/version numbers follow the admitted
// wire representation and are validated/converted without unsafe integer rounding.

validateReplayEvidence(raw, admittedActor); // {ok,evidence,reason,capabilities}
prepareReplayEvent(evidence, catalog, originFrame); // PreparedEvent
createReplaySession(renderer, target, evidence, purpose); // ReplaySession
// ReplaySession.append(evidence), prepareFrame(frameId,filmTimeS),
// camera(frame,rect,purpose), promoteVictim(death), finish(reason).
// prepareFrame returns the identical read-only ReplayFrame object for a repeated frameId.
// ReplayFrame.state is cumulative recorded presentation state at the current cursor;
// it never reapplies damage or replaces a newer accepted state with a late older snapshot.

// Session diagnostics are observable in tests, not new player-facing controls.
// diagnostics(): {events,pinnedEvents,slots,geometryLeases,samples,aggregated,
//                  filmTimeS,physicalTimeS,originFrame,cameraEpoch,targetSnapshots,
//                  retiredThrough,unresolvedGapRanges,sparseRetiredCount,coveragePressure}.
// hasPinnedCause(eventId) is a read-only diagnostic of retained causal source ownership.
```

Timed adapter records are `body_stages`, `traces`, `pieces`, `bursts`, `arrivals`; each has a stable local ID, source, parent event ID and actual start/end/contact time when known. Missing legacy timing is `null`/unknown, not inferred exact time. `arrivals` reference module/crew index and an authoritative before→after delta/version. A frame stores display intensity separately from physical mass/energy and never changes the report.

## Task 1: Authoritative event and cause receipts

**Files:** Create `crates/combat/src/replay_evidence.rs`, `crates/combat/src/causes.rs`, `crates/server/src/replay_receipts.rs`, `crates/server/src/shot_flight.rs`, `crates/server/src/replay_tests.rs`, `client/web/src/game/replayEvidence.js`, `client/web/test/replay-evidence.test.mjs`, `client/web/test/replay-network.test.mjs`. Modify the narrow existing combat/server/WASM/net seams above; adapt C2 fields after its checkpoint. Tests run through actual `Lobby::handle` and `NetClient._receive`, not manually invented Damage callbacks.

- [ ] **1.1 Add the native RED witness in `replay_tests.rs`.** Register it in `lobby.rs` with the established `#[cfg(test)]` module pattern. Reuse the real-data setup pattern from `gameplay_tests.rs::real_lobby` and existing `lobby.rs::tests::combat_lobby`: load `data`, connect compatible players, create/join/start, admit each scope, select Tiger versus Sherman, and fire actual 88 mm rounds into the same side fixture. Write a native fixture writer named `v3_replay_protocol_receipt_from_actual_handlers`; serialize each recipient and source hash to `TG_REPLAY_NETWORK_RECEIPT`. Its record root is `{revision:1, actors, phases, sources}`; every phase contains `{name, recipients:[{to,message}]}`. The following assertions are the exact new contract (IDs are derived from actual receipts):

```rust
let owner = recipients.iter().find(|r| r["to"] == victim).unwrap();
let evidence = &owner["message"]["replay"];
assert_eq!(evidence["actor"]["entity"], victim);
assert_eq!(evidence["shooter"]["entity"], shooter);
assert_eq!(evidence["weapon_instance"], accepted_instance);
assert_eq!(evidence["shot_id"], accepted_shot_id);
assert_eq!(evidence["state_after_version"].as_u64().unwrap(),
           evidence["state_before_version"].as_u64().unwrap() + 1);
assert!(evidence["accepted_pose"]["hull_origin"].is_array());
assert!(recipients.iter().filter(|r| r["to"] != victim && r["to"] != shooter)
    .all(|r| r["message"].get("replay").is_none()
        && r["message"].get("report").is_none()));
```

Run from the worktree: `cargo test -p tg-server v3_replay_protocol_receipt_from_actual_handlers --lib -- --nocapture`. Expected RED: missing owner replay/event/instance/state fields and/or current room report visibility assertion. Record failure before editing the handlers. Add a third observer to make disclosure assertions meaningful.

- [ ] **1.2 Add actual cause/life RED cases.** From a real ignition `tg_combat::shoot` report, advance the server to a death after ordinary hit B. Assert scoring shooter and replay `cause_event_id` remain A; use the real `active_combat_status_preserves_fire_events_and_counts_burnout_once` fixture, preserving fire health/crew transitions. Add source replacement during ongoing fire, extinguish/reignite, immediate ammo death, delayed ammo cause, two same-spec actors, concurrent same-shell weapons, duplicate damage, snap/status before fatal evidence, reconnect, and old-life damage after admitted Respawned. Assert each target has exactly one death commit. A receipt with no valid source must contain `replay_unavailable` with its true reason, not another shell. Run `cargo test -p tg-server replay_ --lib`; expected RED includes A→B wrong attribution/reportNone and missing life/death identity.

- [ ] **1.3 Define native envelope and cause types.** Add serde-default compatible report extensions without moving renderer objects into Rust. Types use admitted values only:

```rust
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct ReplayActor { pub battle: u64, pub entity: u32, pub life: u64 }
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CauseTransition {
    Started { mechanism_id: String, source_event_id: String },
    Replaced { mechanism_id: String, source_event_id: String },
    Ended { mechanism_id: String },
    Death { death_event_id: String, mechanism_id: String, cause_event_id: String },
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ActiveCause {
    pub mechanism_id: String,
    pub source_event_id: String,
    pub source_shot_id: String,
    pub shooter: ReplayActor,
    pub accepted_pose_revision: u64,
    pub accepted_geometry_revision: u64,
}
```

The full envelope fields are the contract above and in the design. `TargetState` stores typed active mechanism identity with serde defaults; `start_fire` emits replacement even if the legacy `fire` toast already exists. Keep legacy `shoot`/`advance` wrappers explicitly unknown for old callers; context-aware entry points bind source before core mutation. `resolve_death` retrieves the mechanism source, and both scoring and evidence use that value. Retain one active delayed cause record outside the ordinary recent ring, release on Ended/life end, and never update it from a plain non-mechanism hit. Source evidence preserves the initiating event/pose/report/state versions; the death record has its separate terminal event/commit/time/state versions and actual after-state. Do not overwrite the old report's state to make it appear lethal. Timed actual advancement deltas populate `mechanism_records`; a terminal pose never moves the source snapshot.

- [ ] **1.4 Preserve accepted discharge/pose data before `apply_shot`.** Move the matched admitted Fired/launch record into a `ReplayDischarge` value before marking it used. `shot_id` is `battle:shooter:life:dischargeSerial`; `event_id` is `battle:eventSerial`, and target `commit_seq`/state versions are monotone. Source shot serial is not the lossy last fire received by a client. Wire counter reuse across a new life produces a different identity. Query B/X accepted complete pose/contact and P5 trusted muzzle/flight at their revisions. Initialize/advance `tg_ballistics::BallisticState::from_muzzle` under accepted fixed-step/swept contact ownership; client speed/dist/yaw can only propose contact for verification. Use bounded authoritative flight samples at launch/contact/turning/termination and the actual missile flight/ended record. If upstream exact geometry is absent, serialize `legacy_receipt_pose`/unknown capability, reject exactness certification, and keep the downstream tests asserting that limitation.

- [ ] **1.5 Commit report/state/cause atomically and scope recipients.** Add one `commit_damage` owner in `replay_receipts.rs` called by direct cannon/MG/missile and `advance_combat`. Its transaction captures before-state/pose/shape, applies the existing core once, increments target combat version, resolves deaths/score once, retains the source record with real `state_before`, and creates public/shooter/owner messages. For deferred death, append a separate terminal death/advance record to the unchanged source evidence. Assert native and Node source-state versions remain original while terminal versions/state are current. Send `Damage.replay`/fatal cause only to victim; send authorized hit feedback separately to shooter; public messages omit report/pose/internal coordinates. Owner reconnect receives current cause/death IDs and replay availability. Admission/life cleanup consumes C2 scope without resetting it. No room broadcast of private evidence remains.

- [ ] **1.6 Add strict browser evidence validation before acquiring resources.** Implement the following complete boundary helper, plus finite basis/joint/array checks using the specified bounds; reject mismatch before calling the snapshot owner:

```js
export function replayActorKey(a) {
  return `${a.battle}:${a.entity}:${a.life}`;
}
export function replayActorEqual(a, b) {
  return !!a && !!b && a.battle === b.battle && a.entity === b.entity && a.life === b.life;
}
const uint = n => Number.isSafeInteger(n) && n >= 0;
const vec3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
export function validateReplayEvidence(raw, admittedActor) {
  const fail = reason => ({ok:false,evidence:null,reason,capabilities:[]});
  if (!raw || raw.revision !== 1) return fail('unsupported_revision');
  if (!replayActorEqual(raw.actor, admittedActor)) return fail('wrong_actor_or_life');
  if (![raw.actor.battle,raw.actor.entity,raw.actor.life,raw.commit_seq,
        raw.state_before_version,raw.state_after_version,raw.pose_revision,
        raw.geometry_revision].every(uint)) return fail('invalid_identity_or_version');
  if (raw.state_after_version < raw.state_before_version) return fail('state_regression');
  if (raw.coordinates !== 'target_hull_metres') return fail('unknown_coordinates');
  if (![raw.launch_time_s,raw.impact_time_s].every(Number.isFinite)
      || raw.impact_time_s < raw.launch_time_s) return fail('invalid_times');
  const p = raw.accepted_pose;
  if (!p || ![p.hull_origin,p.ex,p.ey,p.ez].every(vec3)) return fail('invalid_pose');
  if (!Array.isArray(raw.flight) || raw.flight.length > 256) return fail('flight_limit');
  let last = -Infinity;
  for (const q of raw.flight) {
    if (!Number.isFinite(q.time_s) || q.time_s < last
        || !vec3(q.position) || !vec3(q.velocity_m_s)) return fail('invalid_flight');
    last = q.time_s;
  }
  if (!raw.report || typeof raw.report !== 'object') return fail('missing_report');
  const capabilities = p.trust === 'accepted' ? ['accepted_pose'] : ['legacy_receipt_pose'];
  return {ok:true,evidence:raw,reason:null,capabilities};
}
```

Extend limits to 64 impacts, 256 flight samples, 256 segments/arrivals per event, 64 joints, 1,024 running-gear entries, 128 payload/variant entries, finite scalar/transform values, nonempty bounded IDs/hash strings, and a validated right-handed orthonormal basis. These are protocol/resource guards, not physical constants. Use the core's bounded limits when smaller. Reject over-limit evidence; do not allocate then discover it is malformed. Legacy reports remain explicit legacy analysis data and cannot authorize a fictional fatal shell.

- [ ] **1.7 Generate and consume a native receipt in Node.** The fixture phases are `direct`, `same_shell_two_weapons`, `fire_a_hit_b_death`, `reignition`, `extinguish`, `duplicate`, `snapshot_before_fatal`, `resume`, `respawn_stale`, `rejected`, `observer`, `gap_1_3_late_2_fatal_older_cause`, `coverage_checkpoint`. For the gap phase, begin a fresh admitted actor/life at baseline commit 0; the native handler generates canonical commits 1, 2, 3 and fatal 4 in order, with 1 the actual active causal source. The client test deliberately delivers 1, 3, late 2, duplicate 3, then fatal 4. Preserve source/event/version identities and actual states from the native receipts. The optional owner `replay_checkpoint` is `{actor,baseline_commit,covered_through,state_version,state,canonical_identity_binding,active_causes}`; it explicitly asserts the represented compacted range and retained causes. A normal newer state snapshot is not this proof. Store native source SHA-256 entries for the writer's changed lobby/receipt/combat files. The Node test fails if the file is missing or source hashes differ. Feed each serialized message to production `NetClient._receive`; compare emitted evidence/health/death values to native IDs and recipient lists. Do not construct a substitute “equivalent” message in JS. Test the production validator on malformed/old-life records and assert snapshot acquisition count stays zero.

```powershell
$taskRepo = (Get-Location).Path
$env:TG_REPLAY_NETWORK_RECEIPT = Join-Path $taskRepo 'target/replay-network.json'
cargo test -p tg-server v3_replay_protocol_receipt_from_actual_handlers --lib -- --nocapture
node --test client/web/test/replay-evidence.test.mjs client/web/test/replay-network.test.mjs
```

Expected GREEN: native fixture contains actual handler receipts, Node consumes them with correct cause/life/recipient semantics, and all new tests pass. Old rejected-hit and status/repair tests still pass. No native fixture means no network-integration PASS.

- [ ] **1.8 Record and commit the checkpoint.** Save true RED/GREEN commands, source hashes and scope adapter mapping in the port-map note. Stage only the explicit Task 1 files/hunks; commit message `feat: add scoped causal replay evidence`. Request fresh SPEC then QUALITY review under the project sequence, repair findings, and have Root independently run the exact native→Node receipt chain. An honest legacy capability is not completion of accepted P5/B/X inputs.

## Task 2: V3 pure clock/camera/sampler and shared projectile bodies

**Files:** Create `client/web/src/game/replayClock.js`, `client/web/src/game/replayCamera.js`, `client/web/src/game/projectileVisuals.js`, `client/web/test/replay-clock.test.mjs`, `client/web/test/replay-camera.test.mjs`, `client/web/test/projectile-visuals.test.mjs`; modify `client/web/src/game/projectileReplay.js`, `client/web/test/projectile-replay.test.mjs`, `client/web/test/design-replay.test.mjs`, `client/web/src/main.js` flight body call sites and `client/web/src/gfx/renderer.js` prototype ownership. Create `docs/third-party/hit-replay-v3-LICENSE.txt` and `docs/superpowers/notes/2026-10-11-v3-replay-port-map.md`.

- [ ] **2.1 Add clock/camera RED assertions before the port.** Import the new pure modules from the Node tests. Use the exact supplied canonical knot profile and source fixture; no game browser is required:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { transfer, createReplayClock } from '../src/game/replayClock.js';
test('V3 knots are monotone, invertible and immutable once played', () => {
  const knots = [[0,0],[1,1.15],[1.8,1.65],[2.35,1.83],[3.6,2.48],
                 [5.2,3.4],[7,4.8],[9.6,7.4]];
  assert.equal(transfer(knots,1.8),1.65);
  assert.ok(Math.abs(transfer(knots,2.74,true)-4.052173913043478) < 1e-10);
  const c = createReplayClock(knots);
  c.markPlayed(2.35);
  const prefix = c.knots.filter(k => k[0] <= 2.35).map(k => k.slice());
  c.appendPhysicalAnchors([8,9]);
  assert.deepEqual(c.knots.filter(k => k[0] <= 2.35),prefix);
  assert.equal(c.physicalAt(1.8),1.65);
});
```

`createReplayClock(knots)` exposes `.knots`, `.markPlayed(filmS)`, `.appendPhysicalAnchors(times)`, `.physicalAt(filmS)`, `.filmAt(physicalS)`. Run `node --test client/web/test/replay-clock.test.mjs client/web/test/replay-camera.test.mjs`; expected RED is missing modules or the current synthetic-stage mapping. Camera test uses V3 HE entry `[-.42,1.18,.87]`, normalized `[-.035,-.055,-1]`, event .65: canonical eye `[-.764825,2.026050,10.458331]`, look `[-.190018,1.541400,7.440900]`, FOV 48°, tolerance 1e-5. APHE event 2.74 eye `[3.910538,3.95,4.746598]`, look `[-.104164,1.119841,.215768]`, FOV 43°. Corner normal FOV is 38°; portrait below aspect 1.05 applies source fit without changing FOV.

- [ ] **2.2 Port whole V3 clock/camera functions with exact adaptation points.** Copy `directorKnots`/`transfer` and `fitCamera`/`camera`/`hitCamera` from reference `src/runtime.js:54–84`, retaining source names where practical. Replace the fixed demo approach/impact time with `PreparedEvent` launch/contact/mechanism anchors. Retain an internal canonical reference phase for source easing only; event sampling always receives real physical seconds. Map camera offsets once using B, correct cross sign, then use TankForge `lookAtLH`. Fit target center/length from frozen hull bounds, exclude gun overhang, derive near/far bounds, preserve true projectile nose/tangent. Ordinary mode does not copy the demo external battle camera. Implement `appendPhysicalAnchors` by filtering anchors greater than the latest retained physical knot and appending positive film spans; never edit knots at/before the played film cursor.

The exact proper projectile rotation and camera offset conversion are:

```js
export function v3ProjectileToTank([x,y,z]) { return [-z,y,x]; }
export function v3CameraOffsetToTank([x,y,z]) { return [z,y,x]; }
```

Tests assert `cross(R(ex),R(ey)) === R(ez)` and positive determinant, while the camera test accounts for B's reversed cross order. Production hull report coordinates bypass both functions.

- [ ] **2.3 Add geometry and stage RED tests.** Load the existing catalog with `client/web/tools/load-data.mjs`. `projectileProfile(shell, missileDef)` returns `{id,revision,provenance,lengthM,diameterM,roles,family}`; `buildProjectileGeometry(profile,stage)` returns CPU vertex/index/role data in +Z nose-origin coordinates; `ProjectileVisualPool.acquire(profile,stage)`/`.release(handle)` share renderer prototypes. Assert every projectile family represented by the actual catalog has a body, APDS/APFSDS has separate sabot/core, HEAT/ATGM fins differ from HE/HESH/AP bodies, MG/autocannon use catalog caliber, and APHE `aphe_122_br471` has 0.451 m body length and 0.12192 m diameter before display enlargement. Compare silhouettes/topology/role signatures, not hashes of colors alone. Assert source rotation preserves normals/winding and all noses are at z=0.

Use actual timed report records to assert stop, deformation, fracture, remaining rod and fuse/jet transitions where P2/P3 supplies them; fixtures without those capabilities assert unknown status and no invented transition. Run `node --test client/web/test/projectile-visuals.test.mjs client/web/test/projectile-replay.test.mjs`; expected RED includes the existing generic shell and synthetic replay legs.

- [ ] **2.4 Port source projectile construction maximally.** Copy V3 `makeAmmo`, lathe/fins/sector shoes, and its construction helpers into the shared prototype owner, translating output to `GeoBuilder`/existing renderer layouts. Keep core/cap/jacket/fuze/band/fins/sabot part roles before merge. Use catalog `length_mm`, `caliber_mm`, missile body/fin dimensions and existing engineering profiles. For absent fine shape, source family ratios are versioned `v3_display_profile_v1` estimates; do not write inferred numbers back to historical JSON. Since source AP/APHE share a branch, use per-entry profile/fuze/cap roles to provide an explicit distinguishable body signature, and label estimated details. Scale about normalized nose. Rendering quality may change tessellation but not physical signature/anchor. Integrate the same prototype owner into live shell/MG/autocannon/missile body drawing; tracer remains additional. Use bounded instancing/prototype leases rather than allocating a body every shot.

- [ ] **2.5 Replace synthetic replay paths with recorded-data sampling.** `prepareReplayEvent` uses evidence flight and the actual core path/impact/source records. Remove the 9 m fabricated approach and 6 m ricochet leg for trusted evidence. A legacy report may show a static explanatory path with unknown timing, never label it trusted flight. Port V3 C `sample` trace tail/interpolation/visibility algorithms onto typed records, excluding its RNG/canned rays, AABB trace, damage_at/destroyed_at and reset scenarios. Populate `body_stages`, `traces`, `pieces`, `bursts`, `arrivals` from actual timed fields. Stop an intact body at recorded termination; only actual surviving core records continue. HEAT jet is separate, HESH debris is armor, and APHE burst location/time is exact recorded data. `display_intensity` is normalized only for alpha/color, never energy or health.

The complete linear physical sample rule is:

```js
export function sampleTimedSegment(segment, physicalS, out) {
  const {start_s,end_s,from,to} = segment;
  if (!(Number.isFinite(start_s) && Number.isFinite(end_s) && end_s >= start_s)) {
    out.visible = false; out.timing = 'unknown'; return out;
  }
  out.visible = physicalS >= start_s && physicalS <= end_s;
  out.timing = 'recorded';
  const k = end_s === start_s ? 1 : Math.max(0,Math.min(1,(physicalS-start_s)/(end_s-start_s)));
  for (let i=0;i<3;i++) out.position[i] = from[i]+(to[i]-from[i])*k;
  const n = Math.hypot(to[0]-from[0],to[1]-from[1],to[2]-from[2]);
  for (let i=0;i<3;i++) out.tangent[i] = n > 0 ? (to[i]-from[i])/n : 0;
  return out;
}
```

Curved flight interpolation consumes recorded piecewise segments/velocities; this straight segment helper does not generate ballistics or change contact times. Reuse output arrays.

- [ ] **2.6 Preserve source notice and prove the new owner.** Copy V3 LICENSE verbatim to the named license file and record exact functions/shaders/source line ranges/adaptations/hash in the port map. Run `node --test client/web/test/replay-clock.test.mjs client/web/test/replay-camera.test.mjs client/web/test/projectile-visuals.test.mjs client/web/test/projectile-replay.test.mjs client/web/test/design-replay.test.mjs`. Expected GREEN: source camera math, clock invariance, body signatures/anchors and timed termination pass; old design/report provenance remains intact. Test repeated acquire/release and renderer loss/restore returns prototype counts to baseline. Commit exact files/hunks as `feat: port V3 replay director and projectile bodies`; obtain fresh SPEC then QUALITY and Root verification. Do not mark P2/P3 physics complete from these display tests.

## Task 3: One stable session, independent impacts and fatal victim lifecycle

**Files:** Create `client/web/src/game/replaySession.js`, `client/web/src/game/victimReplay.js`, `client/web/test/replay-session.test.mjs`, `client/web/test/victim-replay.test.mjs`; modify `client/web/src/game/replayPose.js`, `client/web/src/game/hitcam.js`, `client/web/src/game/enemies.js`, `client/web/src/main.js` narrow actual incoming/outgoing/death/deploy/render seams, `client/web/test/replay-pose.test.mjs`, `client/web/test/replay-network.test.mjs`. Reuse Task 1 native receipt for production route tests.

- [ ] **3.1 Add the stable-view RED witness.** With the actual renderer sink/HitCam fixture pattern in `replay-pose.test.mjs`, create three same-life evidence records from the native receipt, with separate shot/event IDs and linked state versions. Present first, advance film, append two (one same physical contact time, one future). Assert the following before editing `HitCam.show`:

```js
const firstFrame = session.prepareFrame(10,1.25);
const before = session.diagnostics();
session.append(secondEvidence);
session.append(thirdEvidence);
const after = session.diagnostics();
assert.equal(after.targetSnapshots,1);
assert.equal(after.cameraEpoch,before.cameraEpoch);
assert.equal(after.originFrame,before.originFrame);
assert.equal(after.filmTimeS,before.filmTimeS);
assert.equal(session.prepareFrame(10,1.25),firstFrame);
assert.equal(session.diagnostics().samples,1);
assert.equal(session.events.size,3);
```

`session.events` is a read-only diagnostic Map keyed by event ID. Tests call `createReplaySession` with renderer/target/evidence/purpose. The test helper accepts native evidence and clones only physical time/version fields for pure-session boundary fixtures; the production native→client route remains unmodified in the integration test. Run `node --test client/web/test/replay-session.test.mjs`; expected RED: missing session or current `cur.t=0` replacement/snapshot disposal.

- [ ] **3.2 Implement the event/revision owner and transaction.** Validate evidence and compatible key before resource acquisition. Acquire one R snapshot; retain event metadata, own pose frames and immutable geometry revision leases. Store the accepted pose/shape timeline by physical time and `commit_seq`. `append` deduplicates each logical source/terminal record by its own identity only after assessing new fatal/cause components; a known source with a new death is accepted, while an entirely repeated receipt returns duplicate without work. Wrong actor/life/build returns a reason; same key appends. Do not call `snapshotReplayTarget` for every event. Apply later revisions to the one display target only at their recorded arrival; retain earlier source revision references until all dependent processes retire. Never mutate the live target or remap earlier event points through a later pose. A failed new revision acquisition rolls back only that append and preserves the running session.

Transform from each event hull frame into fixed session coordinates using this complete function; `sessionFrame` is the first accepted hull basis and never changes:

```js
export function eventPointInSession(p, eventFrame, sessionFrame, out) {
  const w = [0,0,0];
  for (let i=0;i<3;i++) w[i] = eventFrame.hull_origin[i]
    + eventFrame.ex[i]*p[0] + eventFrame.ey[i]*p[1] + eventFrame.ez[i]*p[2]
    - sessionFrame.hull_origin[i];
  out[0] = w[0]*sessionFrame.ex[0]+w[1]*sessionFrame.ex[1]+w[2]*sessionFrame.ex[2];
  out[1] = w[0]*sessionFrame.ey[0]+w[1]*sessionFrame.ey[1]+w[2]*sessionFrame.ey[2];
  out[2] = w[0]*sessionFrame.ez[0]+w[1]*sessionFrame.ez[1]+w[2]*sessionFrame.ez[2];
  return out;
}
```

Use session-owned scratch instead of the temporary `w` array in render hot loops. Verify rotated/moving second-hit frames and the hull-origin-versus-COM fixture independently.

- [ ] **3.3 Add timeline/late/overload RED cases, then implement them.** Assert accepted geometry revision 6 for event A is unchanged after event B binds revision 7 to an already broken barrel; event B's own report uses 7. A post-cursor late report merges only missing historical arrival evidence by event/version; if a newer full state already includes that commit, do not apply its delta a second time or replace the newer state with its older snapshot. It cannot replay approach or clock prefix. Equal-time damage commits follow `commit_seq`; an unresolved version gap exposes `incomplete_state_chain`.

Define `retiredThrough` as **contiguous** coverage of processed records whose ordinary presentation work is retirement-eligible from the admitted session baseline, or an explicit authority-confirmed compacted prefix. Pinned causal resources outlive this ordinary retirement and do not prevent coverage from advancing. It is never the maximum delivered/seen/retired commit. Include canonical nonvisual status/mechanism commits in coverage. Retired records above a hole keep compact `(actor,commit_seq,event_id)` proofs until the hole closes; an unseen valid record in a hole is accepted as late. A duplicate requires an exact retained identity or canonical authority-bound identity within the real covered prefix. Conflicting IDs at one commit are protocol errors. Ordinary Snap/Status versions cannot prove compaction. `covered_prefix` distinguishes state represented by an explicit checkpoint from an animation actually played.

Use the native `gap_1_3_late_2_fatal_older_cause` phase from 1.7 for this concrete vector in `replay-session.test.mjs` and the native→NetClient test. Deliver 1, let its ordinary work retire while retaining its active cause; deliver 3, let its visible work retire with the completion tail still active. Assert `retiredThrough === 1`, gap `[2,2]`, one sparse retired proof for 3, and current displayed state equal to the actual commit-3 state. Deliver unseen 2 behind the cursor: accept/mark late, close the gap, and advance coverage to 3 only after its processing/retirement. Deliver duplicate 3, then the actual fatal 4 whose cause is 1. The exact new assertions are:

```js
// one/two/three/fatal are the canonical native fixture's four records.
// The fixture has already delivered and visually retired 1 and 3 while the tail is active.
const beforeGap = session.diagnostics();
assert.equal(beforeGap.retiredThrough,1);
assert.deepEqual(beforeGap.unresolvedGapRanges,[[2,2]]);
assert.equal(beforeGap.sparseRetiredCount,1);
assert.equal(session.hasPinnedCause(one.event_id),true);
const late = session.append(two);
assert.equal(late.accepted,true);
assert.equal(late.late,true);
assert.equal(late.duplicate,false);
// prepareFrame processes the late record at the same current cursor, with a fresh frame ID.
const afterGapFrame = session.prepareFrame(102,beforeGap.filmTimeS);
assert.deepEqual(afterGapFrame.state,three.report.state);
assert.equal(session.diagnostics().retiredThrough,3);
assert.deepEqual(session.diagnostics().unresolvedGapRanges,[]);
assert.equal(session.diagnostics().cameraEpoch,beforeGap.cameraEpoch);
assert.equal(session.diagnostics().targetSnapshots,1);
assert.equal(session.diagnostics().filmTimeS,beforeGap.filmTimeS);
const repeated = session.append(three);
assert.equal(repeated.duplicate,true);
const acceptedFatal = session.append(fatal);
assert.equal(acceptedFatal.accepted,true);
assert.equal(session.hasPinnedCause(one.event_id),true);
assert.equal(fatal.deaths[0].cause_event_id,one.event_id);
assert.equal(session.diagnostics().cameraEpoch,beforeGap.cameraEpoch);
assert.equal(session.diagnostics().targetSnapshots,1);
```

Assert separately that the pinned source retains event 1's original report/pose and the new death retains event 4's terminal state/versions; ordinary retirement or covered-prefix dedupe cannot release that source. The deferred fatal receipt may have source `event_id` 1 plus the new `deaths[0]` terminal event 4: treat those as separate logical records, not one source-ID duplicate. `append(fatal)` accepts the new terminal record; a repeated fatal receipt is duplicate only when all source/terminal components are already covered. Validate/pin newly required fatal cause evidence before ordinary visual dedupe, including a source supplied after its ordinary report was compacted. Same-view promotion happens once; it does not replay event 1's approach, reapply damage, rewind played knots or import foreign fragments. Add a duplicate fatal-4 receipt and confirm neither death presentation nor causal pin acquisition repeats.

Continuous 1,000-hit MG/autocannon stream holds ≤64 ordinary event records, ≤4,096 trace/piece slots, one display snapshot, ≤four other-target queued metadata sessions and one active delayed cause, while fatal/cause records remain pinned. Pinned history is one source report plus terminal record and ≤16 compact mechanism nodes; compact longer intermediate chains while retaining actual root/terminal IDs/count. Gap storage is ≤64 compact ranges and sparse retired identity proofs ≤64 entries; no permanent event-ID Set. If either coverage bound would be exceeded, keep the existing proofs/gaps, report `coverage_pressure` and request the trusted owner checkpoint defined in 1.7. Suspend ordinary history admission at that boundary while accepting gap-closing and reserved fatal/cause records; refused history is not marked processed/duplicate. The current camera/processes and authoritative health/death flow continue. Only the validated checkpoint can compact the missing prefix; a larger maximum sequence cannot. Exercise repeated sparse arrivals with a persistent low gap and later checkpoint/fatal cause, proving boundedness without losing that gap or the pinned root.

Retire completed records before aggregating decorative source/time bins; active-capacity overflow becomes bounded summary metadata, never a new view. Last arrival extends completion tail by 1.5 film seconds; finite event/slot counts do not change core state. Add two-target, queue-after-end/skip, incompatible build, append acquisition failure, full/corner repeated frame ID and seek-arrival tests. Run the session test RED first, implement, then GREEN. These are presentation/causal gates, not completion evidence for exact geometry, trusted flight, charge physics or cabin calibration.

- [ ] **3.4 Implement Player accepted-pose reconstruction inside R.** Add `capturePlayerImpactPose(player, acceptedPose)` and use it before the actual incoming core/state commit. `acceptedPose` from native B/X is preferred; receipt-time fallback remains `legacy_receipt_pose`. Save independent gun elevation/recoil/roll, each turret parent-relative transforms, all MGs, fold, launchers/readiness/payload and accepted running gear/geometry. Extend the actual T-54/WASM lethal fixture into a Player-shaped control fixture; preserve pre-core hull/joints through live death yaw, gun pitch, turret toss, reset/respawn and lazy interior creation. Keep mesh lease/private instance/rollback tests and launcher payload freeze. Test that earlier target snapshots do not move at detonation even while the live death model moves.

- [ ] **3.5 Add fatal priority/lifecycle RED before hooking main.** Consume real native fatal receipt through `NetClient._receive` and real offline `selfMissileHit` via a narrow extracted callable owner. Fatal MG preempts an offensive shell for another target once; same-key victim promotion does not reset an existing view. Outgoing own shells that land later cannot replace victim ownership and do not bring foreign fragments. Snap/Status death first, correlated fatal evidence second still shows once; duplicate/reconnect shows no second view; new life rejects old fatal. Unknown/scuttle deaths show no shell. Automatic deploy remains waiting while replay owns victim view and cooldown is active, then opens on finish/skip; manual deploy/reset/Tab/leave completes/clears safely. Renderer acquisition failure still yields deploy. Run `node --test client/web/test/victim-replay.test.mjs client/web/test/replay-network.test.mjs`; expected RED: current missing victim routing/3-second truncation.

- [ ] **3.6 Implement separate death marks and incoming source routing.** `createVictimReplayGate(scopeProvider)` exposes `applyDeath(actor,deathId,applyFn)`, `present(actor,death,evidence,presentFn)`, `mayAutoDeploy(actor,cooldownReady,sessionActive)`, `endLife(actor)`, `presented(actor,deathId)`. Its two actor/death-ID sets distinguish state application and shown evidence; admission clears through C2 scope. `present` checks current actor, canonical fatal/cause identity and available report before priority acquisition. A supported lethal near-blast/fragment source remains eligible without a direct plate-hit flag; offensive `rep.hit`/MG guards do not suppress real victim cause evidence. `markDead` updates real state once but does not itself consume presentation eligibility. Pass the actual missile source/flight/seed/warhead/contact into offline evidence before discarding it; remove the misleading fixed 500 m exact-flight claim. Wire online owner replay at the damage/status/reconnect seam, retain causal source, and attach only same-victim/same-life authorized incoming records (last six physical seconds/64 records plus pinned cause). Keep combat alive-to-dead, player sight exclusion, world simulation and live effects intact. Route existing HitCam `show` through session append/selection; move sampling from per-viewport render into the outer once-per-frame call.

- [ ] **3.7 Run checkpoint GREEN and leak/error gates.** Run `node --test client/web/test/replay-session.test.mjs client/web/test/victim-replay.test.mjs client/web/test/replay-network.test.mjs client/web/test/replay-pose.test.mjs client/web/test/projectile-replay.test.mjs client/web/test/design-replay.test.mjs client/web/test/launcher-interior.test.mjs client/web/test/launcher-damage-control.test.mjs`. Expected GREEN: all new invariants pass, original R semantics retained. Repeated replacement/hide/expiry/skip/navigation/model removal/context restoration/failing interior upload releases back to actual renderer baseline. Commit exact files/hunks as `feat: add stable multi-hit and fatal victim replay`; fresh SPEC then QUALITY and Root verifies native-fed plus offline actual-WASM routes. No fabricated caps-only object can certify the incoming kill path.

## Task 4: V3 cutaway, traces/shards, depth and inset MSAA

**Files:** Create `client/web/src/gfx/replayDraw.js`, `client/web/test/replay-renderer.test.mjs`; modify `client/web/src/gfx/shaders.js`, `client/web/src/gfx/renderer.js`, `client/web/src/gfx/interior.js`, `client/web/src/game/hitcam.js`, `client/web/src/main.js` once-prepared-frame seam, `client/web/test/replay-pose.test.mjs`, and `client/web/test/third-person-aa.test.mjs`. Preserve renderer main MSAA ownership and R leases.

- [ ] **4.1 Add draw/state/resource RED tests with actual renderer methods.** Extend the existing renderer sink with fake WebGL2 framebuffer/renderbuffer/state logs. Assert opaque body/projectile draws with depth write on precede transparent armor/trace/FX; transparent items sort separately for each camera with depth writes off; shared frame `samples` increments once for main+corner. Crew casualty material does not color seats/furnishing, breech damage does not tint/fracture barrel, and actual barrel module has its own role. Assert inset uses supported MSAA samples, resolves color before composition, falls back on incomplete framebuffer, restores framebuffer/viewport/blend/depth/scissor/state when a pass throws, and returns resources to baseline after resize/context loss/restore. Run `node --test client/web/test/replay-renderer.test.mjs`; expected RED: current kind10 all-exterior ghosting, unsorted replay alpha and single-sample inset.

- [ ] **4.2 Port the V3 shader/sampler draw source into replay-only branches.** Preserve complete source GLSL `TRACEVS/TRACEFS/SHARDVS/FIELDVS` and cutaway/rim formulae from `src/gl.js:85,99–117,140–157`, adapting uniform/attribute layouts to TankForge. Role binding is `armor|retained|crew|furnishing|mechanical|barrel|breech`; register roles through actual component/module/crew maps, clone them in R, and never map by demo numeric IDs/display names. Preserve pale interior/crew rims, selective retained opacity, fine weak-glow trails and local damage arrival color; retain furnishing independently. No demo HE vertex displacement/heat acts as real deformation/temperature. Damage alpha/tint consumes frame arrivals, not report receipt time or per-draw RNG. Bodies/pieces stop at recorded times; trace alpha/width/tail are display styling and cannot alter collisions.

- [ ] **4.3 Implement the shared frame and per-view render contract.** `prepareReplayDraw(frame, pools)` writes pooled instance data once; `drawReplayView(renderer, prepared, camera, rect)` chooses opaque/transparent scratch order for that view, renders body before overlay, and restores state in a `finally`. Source standard alpha blend is `SRC_ALPHA, ONE_MINUS_SRC_ALPHA`; depth test stays on, transparent depth writes off. Use per-camera transformed center sorting for bounded replay objects; it does not claim perfect intersecting-surface order. Full victim renders over the main picture; ordinary mode keeps existing live battle view with replay corner. 2D summaries/plate outlines use the same prepared arrivals; delete the generic independent radial/geometric-arrival effect pass for trusted evidence. Do not create a second canvas/renderer, proxy tank, module registry, demo UI or audio.

- [ ] **4.4 Extend inset target lifecycle with the existing MSAA pattern.** Allocate color/depth multisample renderbuffers with `min(4, supported-format/MAX_SAMPLES)`; validate framebuffer completeness, fallback to the existing single-sample path when unsupported/incomplete, resolve color into existing sampleable texture via `blitFramebuffer`, then composite. Keep a bounded target cache with at most the current/previous size, free abandoned target resources on resize, clear/rebuild on context generation, and restore previous framebuffer/scissor/viewport bindings. Avoid `preserveDrawingBuffer`. Do not confuse default canvas antialiasing with offscreen MSAA. Add errors at each allocation step and assert transactional cleanup.

- [ ] **4.5 Run CPU GREEN and preserve pending visual acceptance.** Run `node --test client/web/test/replay-renderer.test.mjs client/web/test/replay-session.test.mjs client/web/test/replay-pose.test.mjs client/web/test/projectile-visuals.test.mjs client/web/test/design-replay.test.mjs client/web/test/third-person-aa.test.mjs`.

Expected GREEN is CPU draw ordering, role masks, transforms, MSAA fallback/resolve and resource/state restoration, not actual pixels. Commit `feat: integrate V3 replay cutaway and trace renderer`; fresh SPEC then QUALITY and Root verification. Record final game V3 visual match **NOT RUN** until separately allowed visual verification; do not use HTTP/CDP/Playwright or another browser tool as a workaround.

## Task 5: Semantic blast routes and live authoritative near bursts

**Files:** Create `crates/combat/src/blast_geometry.rs`, `crates/combat/src/blast_exposure.rs`, `crates/combat/src/blast_tests.rs`, `crates/server/src/blast_events.rs`, `crates/server/src/blast_tests.rs`, `client/web/test/blast-evidence.test.mjs`. Modify actual `lib.rs` HE/HESH/APHE/burst/splash/Report/TargetDef/finish paths, design-WASM adapter, lobby direct/world missile/APS dispatch, `game/combat.js`, `game/replayEvidence.js`, `game/projectileReplay.js`, `main.js` local blast consumers and targeted existing tests. Preserve original assets/data/rules. Gas topology is owned by X; accept optional compatible engineering metadata or verified structural derivation, never mass-edit historical files.

- [ ] **5.1 Write synthetic-geometry RED tests against current live damage.** Register `blast_tests` and use small declared plates, compartments, openings, materials and crew positions. Every test calls the production shoot/blast entry point and asserts the specific crew/module/routes, not “crew or tracks damaged.” Cases: sealed thick armor external HE; open gun compartment with enclosed driver; shielded/exposed crew; reachable top opening below wall edge; irrelevant high plate; posed fold/yaw; thin auxiliary plate with intact main armor; true multi-layer aperture into one of two partitioned compartments; HESH backface spall without hole; HEAT jet without universal pressure; APHE unarmed/internal/left-cabin-but-inside-barrel-bounds; zero/negative/NaN/infinite filler; same burst direct+splash. Run `cargo test -p tg-combat blast_ -- --nocapture`. Expected RED witnesses the old radial/global-height/first-layer/internal-HESH branches. Preserve solid fragment damage assertions so fixing pressure cannot hide an independent spall regression.

- [ ] **5.2 Implement accepted semantic geometry, capability checks and deterministic paths.** The concrete query contracts are:

```rust
pub enum BlastRoute { ExternalExposure, BreachIngress, InternalDetonation }
pub enum BoundaryAvailability { Verified, Unknown }
pub struct BreachRef { pub id: String, pub surface_ids: Vec<String>,
    pub opening_id: String, pub compartment_id: String, pub geometry_revision: u64 }
pub struct GasOpening { pub id: String, pub polygon: Vec<tg_shared::Vec3>,
    pub from_compartment: Option<String>, pub to_compartment: String,
    pub open: bool, pub geometry_revision: u64 }
pub struct AcceptedCrew { pub index: usize, pub position: tg_shared::Vec3,
    pub compartment_id: Option<String>, pub exposure_samples: Vec<tg_shared::Vec3> }
pub trait BlastGeometry {
    fn availability(&self) -> BoundaryAvailability;
    fn point_compartment(&self, at: tg_shared::Vec3) -> Option<&str>;
    fn clear_gas_segment(&self, from: tg_shared::Vec3, to: tg_shared::Vec3,
        allowed_opening: Option<&str>) -> bool;
    fn openings(&self) -> &[GasOpening];
    fn connected(&self, from: &str, to: &str) -> bool;
    fn valid_breach(&self, breach: &BreachRef) -> bool;
}
```

The implementation uses X's posed finite physical surfaces/gas-blocking roles/materials, verified compartment cells and explicit opening adjacency. Validate finite polygons and revision/membership/closed boundary before use. `clear_gas_segment` intersects actual gas-blocking surfaces, permitting only the validated aperture crossing; it does not use GLB art gaps or broadphase boxes as cabin walls. Enumerate deterministic opening center plus edge samples (≤16 per opening, ≤32 openings, ≤64 adjacency cells, ≤4 opening hops, ≤8,192 gas-segment queries per event); shortest admissible path wins with stable opening-ID ties. Budget exhaustion reports `exposure_query_budget` and cannot invent an untested route. Intersections use accepted fold/joints. Unknown topology reports `unknown_boundary`, yields no fabricated pressure path, and retains independent fragments. Do not infer enclosed driver solely by the role name or call all crew open because `open_top` is true. Source-proofed representative sealed/open production topology is an X dependency, separately hashed and reviewed; unverified fleet members stay capability-limited.

- [ ] **5.3 Split blast/solid sources and implement route-only exposure.** Define `BlastEvent` as `{event_id,parent_mechanism_id,charge_id,time_s,at,filler_kg,explosive_type,initiated,geometry_revision,breach,compartment}`. `CrewExposure` stores crew index/route/opening/path/path length/estimate revision/severity; optional peak pressure/positive impulse/duration remain unavailable without a valid model/domain. `crew_exposures` returns no entries for no initiated charge/zero filler/unknown unsupported boundary and rejects negative/nonfinite input. For external bursts, direct clear path exposes only that crew; opening paths use evidenced connectivity. A valid external breach remains an external source and routes only to connected crew. A true internal point routes only within connected cells. Split `burst_fragments` into casing/solid generation plus explicit blast evaluator; remove unconditional `blast_inside`, filler clamps, global-highest-plate/open_top tests and HESH→internal blast. Existing fragment occlusion/deposition remains the solid owner. Replace the broad `Outcome::Overpressure` default title with actual evidenced mechanism labels; no pressure title when no crew exposure exists.

- [ ] **5.4 Preserve P3 fuse and chemical identity.** Integrate with the single charge owner and actual elapsed-time fuse: update remaining delay from segment elapsed time at current velocity; record detonation point/time once, do not derive fixed travel distance then leave it unchanged after slowing. A shell exiting the known compartment before delay expires becomes an exterior burst regardless of external module/AABB bounds. HESH generates `ArmourShockSpall`; a breach requires independent verified physical aperture. HE requires all blocking layers and their material/shape evidence, not first passed plate; HEAT jet/spall remains separate from gas ingress. Filler/type originates in trusted projectile definition, with unknown equivalence explicitly uncalibrated. Keep old penetration/fuse data unchanged and do not turn a source demo normalized energy/ray cloud into damage evidence.

- [ ] **5.5 Isolate the versioned gameplay response from physical pressure.** Implement response configuration `blast_route_gameplay_v1` using path eligibility/length/opening visibility/connectivity and the existing authored blast health scale as an explicitly uncalibrated gameplay curve; never add a hard human kPa threshold. Pass a normalized severity only to each evidenced crew's existing health update; internal module response is separate `blast_module_gameplay_v1`. Keep source units in reports (filler kg, metres, seconds). Optional external free-field P/I/duration lookup is a separate model returning `None` for unknown explosive equivalence, contact/cabin, zero/out-of-domain scaled distance and unsuitable burst geometry. If the previously reviewed MIT KB code is adapted, preserve pinned copyright/license and independent source test points. Its curves never calibrate cabin ingress/casualty. Do not claim medical or real-tank casualty validation.

- [ ] **5.6 Add native authority near-burst RED and consume actual world events.** Extend native fixture `v3_replay_protocol_receipt_from_actual_handlers` with `ground_burst`, `missile_ground`, `aps_airburst`, `aps_breakup`, `direct_plus_splash`, `same_spec_two_targets`. Through the real admitted cannon flight/terrain contact and existing `tg_missile::World::step` handler, assert route/crew damage reaches the correct target actor, same blast ID cannot apply twice, distinct events do, and kills/scoring are once. Run `cargo test -p tg-server blast_ --lib`; expected RED is current missing ground/missile/APS splash authority. `blast_events.rs` creates events only on actual initiated shell/warhead detonation; `Intercept {kind:'airburst'}` must carry confirmed charge disposition/catalog source, while breakup/spent/interception without initiation emits none. Cache `(blast ID,target actor/life)` consumption with the shot/cause retention lifetime, not spec ID. Direct hit and candidate splash share that blast ID; each target damage commit has its own event/state versions and references the blast ID. Query accepted geometry/state, call the same core evaluator once, then `commit_damage` from Task 1. Clients cannot submit mass/type/crew lists or repeat explosion damage. Register authority cleanup at battle/life/shot end.

- [ ] **5.7 Add local/WASM parity and native→client GREEN.** Add `combat_blast` context-aware dispatch in `design-wasm` using the same typed event and semantic topology; preserve old `combat_splash` compatibility as explicitly legacy, not an authority network command. `Combat` consumes route/source reports without calculating online injury. `splashNear` is only offline/presentation when online authority owns the burst. Compare native and actual release-WASM reports/state on the same deterministic geometry/event/seed, including specified exposed crew, partitions/materials/yaw/fold and zero filler. Generate source-matched native receipt and feed it through production NetClient/validator/sampler, asserting actual module/crew changes, death source and displayed route. Add this precise Node assertion for every serialized native blast entry:

```js
assert.equal(clientEvidence.actor.entity,nativeEvidence.actor.entity);
assert.equal(clientEvidence.actor.life,nativeEvidence.actor.life);
assert.equal(clientEvidence.event_id,nativeEvidence.event_id);
assert.deepEqual(clientEvidence.report.blast_exposures,nativeEvidence.report.blast_exposures);
assert.deepEqual(clientEvidence.report.state,nativeEvidence.report.state);
assert.equal(replayDamageApplications,0); // only the authority health route applies state
```

Run `cargo test -p tg-combat blast_`, `cargo test -p tg-server blast_ --lib`, the native receipt writer, and `node --test client/web/test/blast-evidence.test.mjs client/web/test/replay-network.test.mjs client/web/test/victim-replay.test.mjs`. Expected GREEN: live native handlers apply path-aware results once and client replays the exact receipt. A passing standalone blast helper without live authority dispatch fails this task.

- [ ] **5.8 Commit and review the blast checkpoint.** Save exact route/capability/uncalibrated data notes and RED/GREEN receipts. Stage only explicit Task 5 files/hunks; commit `feat: apply boundary-aware authoritative blast exposure`. Fresh SPEC then QUALITY review checks live route removal and native near burst, not only enum labels. Root independently verifies native/WASM parity, actual recipient-scope/death attribution, duplicate/reconnect/life behavior and source-model/data hashes. Unverified topology or P3 charge timing cannot be declared exact completion.

## Final verification and handoff

- [ ] Run focused groups above first. After they pass, build actual source-matched release WASM explicitly: `cargo build -p tg-design-wasm --release --target wasm32-unknown-unknown`; copy the resulting `target/wasm32-unknown-unknown/release/tg_design_wasm.wasm` to the existing bundled WASM through the reviewed build owner. Reject a web-build fallback to an older committed WASM as final native-change evidence.
- [ ] Generate fresh native replay/gameplay receipt files from actual handlers with source hashes; run `cargo test --workspace`, then `npm --prefix client/web test` and `npm --prefix client/web run build` using the configured esbuild runtime. Expected: all required source-matched groups exit 0. Keep generated receipts/build output out of unrelated staging and old named pages intact.
- [ ] Compare original GLB, catalog/armor/crew source hashes to the pre-work receipt; check R resources and current rules/Hetzer/running-gear regressions. New tests must exercise the actual player adapter and direct/deferred/fatal/near-blast routes. A stale native JSON, dormant adapter, demo-core PASS, or fabricated destroyed flag cannot certify integration.
- [ ] Record every checkpoint commit, new reviewer result, Root commands/output summary, source/WASM hash, remaining accepted-pose/topology/P2/P3/P5/calibration capabilities, and **visual verification NOT RUN** separately. Root may later perform visual comparison when explicitly allowed, using the supplied screenshots and real game, without treating CPU gates as image evidence.
- [ ] Finish with a combined implementation receipt and fresh whole-change SPEC then QUALITY review. Do not publish/deploy in this task. User GLBs and all old named distribution pages remain preserved. This plan does not cancel any outstanding projectile/exact-geometry request and does not claim a tested implementation before it exists.

## Plan self-review

Coverage mapping: authoritative identity/source/private evidence and delayed scoring → Task 1; maximum V3 reuse/source notice/axis/clock/body signatures → Task 2; same-view simultaneous/continuous/late/geometry timeline/fatal/deploy/resources, contiguous retirement and the 1→3→late 2→duplicate 3→fatal older-cause vector → Task 3; source cutaway/traces/shards/depth/MSAA/shared frame → Task 4; actual compartments/openings/material/breach/HESH/APHE/near burst/APS/native receipt → Task 5. Original-assets/rules/pages/sole writer and source-matched validation → execution rules and final gate.

All implementation boxes remain unchecked. Existing reference/core/pose test receipts are context, not GREEN receipts for this plan. The chosen interfaces use the same actor fields, version fields, physical seconds, revision ownership and function names throughout. No new life owner or parallel damage simulation is introduced.
