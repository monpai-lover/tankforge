# V3 replay replacement, fatal victim replay and boundary-aware overpressure

Date: 2026-10-11. Implementation target: `C:/Users/24908/.codex/scratch/tankforge-gameplay-modes`.

This is the concrete successor to the approved [victim replay design](2026-10-11-victim-replay-design.md), [impact-pose freeze design](2026-10-11-replay-pose-freeze-design.md), and P3–P5 portions of the [projectile mechanisms design](2026-10-11-projectile-mechanisms-design.md). It preserves those requirements and gives the requested replacement an executable order. It is a design, not an implementation or visual verification receipt.

The user explicitly requests maximum use of their V3 source, fatal-shell playback when the player dies, consecutive and simultaneous impacts in the **same view**, distinct ammunition bodies in flight and replay, and no relocation of the frozen target when ammunition detonates. The user also requests researched, actually implemented overpressure semantics. Approval already covers this direction; execution does not require another design-permission question.

## Source and current evidence

The correct source is `C:/Users/24908/.codex/codex-remote-attachments/01a11c2d-36b3-7330-8e65-85803710ff42/C1100581-A649-47F4-99B3-A5CF438E4E05/1-hit_replay_webgl_wasm_v3_source.zip`, SHA-256 **`5f24750268724a1cb11424f5be1753bf496661a5d47e8113aee3ba80f815d1ce`**. It is unrelated to the TracksV7 archive. The safely extracted reference is `C:/Users/24908/.codex/scratch/tankforge-hit-replay-v3-reference-20261011/hit_replay_webgl_wasm_v3`: 32 files, including a 21,500-byte supplied WASM.

The user's ownership and maximum-reuse authorization apply. Substantial ports preserve the supplied complete MIT license and **Copyright (c) 2026 Replay Lab Contributors**, plus a source/adaptation map. No new licensing gate is needed. The archive's third-party game/video exclusions remain attribution facts, not a reason to restrict the user's own code.

The intake actually inspected `tests/v3_flight.png`, `v3_aphe.png`, and `v3_hit.png`; the original Library URL itself was not viewed. The source supports a shell chase, elevated three-quarter cutaway, pale interiors/crew, fine traces/shards, and a separate corner camera. The audit at `target/audit/v3-replay-overpressure-audit-20261011.md` contains the source findings and prior CPU receipts: V3 core 9/9 and current replay tests 30/30. These certify reference behavior and existing foundations only. They do not certify V3 integration, fatal routing, shared-view playback, blast-path correction, or final game pixels.

No tests, native build, browser, HTTP, CDP, Playwright, or publication ran in preparing this design and its companion plan. Browser visual acceptance remains **NOT RUN** under the existing automatic-approval restriction; its original reason is not retained, and this document does not substitute a bypass.

## Integration order and ownership

The five implementation checkpoints are:

1. Authoritative event identity, cause retention, accepted pose/state receipts, and recipient-scoped evidence.
2. V3 clock/camera/recorded-data sampling and shared catalog-keyed projectile geometry.
3. Bounded same-target/same-life sessions, player adapter, fatal priority and deployment lifecycle.
4. V3 cutaway/trace/shard rendering, depth and inset MSAA in the existing renderer.
5. Semantic blast geometry, real blast routes, and authoritative direct/near-burst consumption.

One runtime writer executes them in order after the current ammunition C2 writer and its reviews finish. Each checkpoint receives fresh SPEC then QUALITY review, followed by Root's independent checks. This work does not change original GLBs, historical weapons/armor/crew values, old named distribution pages, current gameplay rules, the Hetzer swap, or running-gear ownership. Do not stage another writer's documents or generated output wholesale.

C2 supplies the admitted battle/life owner: native `AmmoScope { battle: u64, life: u64 }` through `AmmoLedger.scope`, and client `OnlineAmmo.scope()` returning `{ battle, life }`. Start/Respawned admission creates a life; reconnect retains it. Replay projects that scope into an actor key and never generates another spawn counter. C2's inventory `revision` and `processed_through` describe ammunition; neither is replay damage state, pose revision, geometry revision, or death identity. Exact containing fields are reconciled with C2 at execution without modifying its work concurrently.

## Authoritative receipts and causal deaths

Current `Damage` has target/from/result/hp/killed/report; `Status` has id/state/caps/events. `apply_shot` loses accepted fire sequence/weapon information, the room receives internal reports, and delayed fire death uses mutable `last_attacker` with `report: None`. These are causal-data defects. Replacing a camera cannot correct them. `crates/replay::ShotEvent` currently serves a design/simulation slice; it is not evidence that the live lobby emits a trusted replay record.

Define one versioned envelope, shared by native serialization and the WASM/local adapter:

```js
// Numbers are server/local-authority issued. entity is never a vehicle spec ID.
const actor = { battle: 7, entity: 12, life: 3 };
const evidence = {
  revision: 1,
  actor,
  shooter: { battle: 7, entity: 5, life: 8 },
  event_id: '7:41',       // battle + authority event serial
  commit_seq: 41,        // target state order, including equal-time commits
  shot_id: '7:5:8:19',   // battle/entity/life + admitted discharge or launch serial
  parent_mechanism_id: null,
  weapon_instance: 'gun:0:0', projectile_id: 'aphe_122_br471', seed: '2',
  build_hash: 'accepted-build-hash', anatomy_hash: 'accepted-anatomy-hash',
  pose_revision: 18, geometry_revision: 6,
  state_before_version: 9, state_after_version: 10,
  state_before: {},      // actual accepted TargetState baseline for this source event
  launch_time_s: 100.0, impact_time_s: 100.2,
  coordinates: 'target_hull_metres',
  accepted_pose: {
    trust: 'accepted', hull_origin: [10, 2, 30],
    ex: [1, 0, 0], ey: [0, 1, 0], ez: [0, 0, 1],
    joints: [], running_gear: [], payload: [], variants: [],
  },
  flight: [],           // timestamped trusted world position/velocity samples
  report: {},           // the actual tg_combat::Report, not a V3 damage scenario
  deaths: [],           // terminal event/time/mechanism/cause-event/reason/version/state records
};
```

The example values define field shapes, not production fixture truth. Serialize the full u64 seed losslessly as a decimal string; never round it through a browser number. Admitted actor/version counters use the existing scope wire representation, with explicit safe-integer validation or lossless conversion before arithmetic. `accepted_pose` is a serializable B/W/X reconstruction sample containing every independent joint, fold, wheel/shoe, MG, launcher readiness/payload and geometry variant required by the accepted target. It contains no Node, renderer, texture or GPU handle. Its basis is the hull origin and accepted orientation, not the center of mass. Flight world coordinates and report hull coordinates are explicitly different and transformed once.

The accepted discharge owner retains sequence, weapon instance, catalog ID, seed, muzzle frame, launch time, and authoritative flight/contact samples. Cannon/MG validation must stop treating client `WireShot.speed`, distance or target yaw as exact physical truth. Reuse P5's server ballistic owner and B/X accepted contact geometry; if these are not available, label a receipt `legacy_receipt_pose`/unknown flight, and withhold exactness certification. Missile evidence comes from the existing server/local missile owner before ended missiles are discarded. Do not infer identity from the latest Fire, caliber, current gun, nearest visual projectile, or spec ID.

Damage commits have a distinct monotone state version. Capture state-before, accepted pose/shape, then core report, state-after and causal transitions in one transaction. The first source event includes its real state-before baseline; linked deltas prevent old full state from rolling back the display. Extend timed records for body termination, fragment contact and burst arrival where the existing report does not contain them. `ImpactEvent.time_s` and physical fragment data are useful; untimed legacy `path`/`bursts` and provenance `start_s` alone do not establish every arrival. Unknown records remain explanatory/unknown and do not animate fictitious physical travel.

Typed mechanism transitions distinguish started, source replaced, ended and terminal death. An active fire/ammunition cause holds its initiating event, accepted source pose/report and source shooter. Ordinary hit B cannot overwrite fire A. Genuine source replacement/reignition changes that cause explicitly; extinction, mechanism end and life end release it. The score source and replay cause resolve from the same terminal mechanism record. Direct lethal damage pins its actual report. For a deferred death, the retained source evidence keeps its original event ID, accepted pose, report and source-state versions. A separate death record carries terminal `event_id`, `commit_seq`, `time_s`, mechanism/cause IDs, state-before/after versions and actual terminal state; an optional accepted terminal pose is diagnostic and never replaces the source pose. Ongoing fire/cookoff deltas are timed mechanism records from actual authority advancement. No old initiating report is relabeled as the terminal state. Unknown death, scuttle/J, or abandonment follows normal death flow without a fabricated enemy shell. Actual supported self/reflection/team damage uses its real source.

Detailed victim evidence is sent only to the target owner. The existing authorized shooter hit feedback uses its own scoped receipt; public result/death messages contain public IDs/results and no victim internal crew/module geometry or historical pose. Replace the current whole-room detailed-report broadcast. Owner-specific reconnect state retains the canonical active cause and death ID; reconnect does not replay a death already presented. Rejected, unfired, duplicated and old-life reports create no replay eligibility.

## Maximum-reuse port boundary

| Source | Production destination and adaptation |
|---|---|
| V3 `src/runtime.js` `directorKnots`, `transfer`, `fitCamera`, `camera`, `hitCamera` | Pure `game/replayClock.js` and `game/replayCamera.js`; retain reference easing, portrait fit, chase/orbit/contact bump and 43°/38° normal FOV. Actual records replace fixed demo launch/contact/fuse times. Ordinary hits keep the live main battle camera. |
| V3 `src/scene.js` `makeAmmo`; `src/gl.js` lathe/face/fins helpers | Shared `game/projectileVisuals.js` prototypes used by battlefield and replay. Retain core/cap/jacket/band/fins/sabot roles before color-based merge. Scale dimensions from the trusted catalog; version fine-shape estimates explicitly. |
| V3 `src/replay_core.c` `sample`; `TRACEVS`, `TRACEFS`, `SHARDVS`, `FIELDVS` | Pure timed-record sampler and pooled replay draws. Reuse trace width/tail, shard orientation and deterministic display thinning. Remove canned random rays, proxy AABB collisions, normalized damage and fixed scenarios. |
| V3 mesh/rim/cutaway shader and draw order | Replay-only material branch in `gfx/shaders.js`; semantic role masks and per-view transparent sorting in existing `gfx/renderer.js`. Source HE ripple/heat remains illustrative and is not production deformation/temperature. |
| V3 multisampled scene color/depth and resolve | Extend TankForge's existing inset target/cache and context restoration. Keep one renderer/canvas and its mesh leases; do not instantiate the V3 demo renderer/page/UI/audio. |

V3 vehicle axes are +X forward/+Y up/+Z right; TankForge uses +Z forward/+Y up/+X right. The reference camera offset permutation `B([x,y,z])=[z,y,x]` has determinant −1 and changes cross-product order. Compute source camera offsets in canonical V3 space, transform once, then use TankForge `lookAtLH`; production report vectors are never permuted. Projectile meshes use the proper rotation `R([x,y,z])=[-z,y,x]` (determinant +1) to put their +X axis onto +Z, followed by nose-at-origin normalization. Preserve winding/normals. Framing uses frozen hull bounds, excluding gun overhang, rather than the ray broadphase.

AP/APCBC/APHE/HE/HEAT/HESH/APCR/APDS/APFSDS, MG/autocannon and missile prototypes differ by topology/silhouette and physical dimensions, not only color. V3's AP and APHE share a branch: catalog-keyed profiles must retain distinct fuzes/caps/ogives or explicitly estimated family profiles instead of declaring nine recolors complete. Known caliber/length/missile dimensions remain physical; missing fine profiles carry `v3_display_profile_v1` estimate provenance. Display enlargement is a separate transform about the true nose/contact, with a physical-size toggle/diagnostic, and never changes collision size.

Recorded stages decide what survives: intact body before contact, residual core/deformation after actual transitions, separate fracture/casing/armor pieces, APDS/APFSDS discarded sabot versus flying core, jet formation/termination, and HESH armor spall. A stopped/fractured/detonated charge does not continue as a whole shell through the cabin. APHE bursts occur at the recorded fuse time and position. Existing P1 `kinetic_work_v1` with `PendingP3` does not certify P2 fracture, P3 fuzes/chemical energy, or physical jet formation. Missing mechanisms remain a separately tracked physics requirement, not demo animation substituted as truth.

## Stable same-view replay sessions

Session identity is `(actor.battle, actor.entity, actor.life, compatible build_hash, anatomy_hash)`. Purposes are `offensive`, `victim`, and `analysis`; victim owns the view ahead of offensive, including lethal MG. Analysis deliberately starts a new session. Same compatible target/life reports append without disposing the target, setting time to zero, replaying approach, or redoing already played clock knots.

The public presentation boundary is:

```js
prepareReplayEvent(evidence, catalog, originFrame); // immutable PreparedEvent
createReplaySession(renderer, target, evidence, purpose); // ReplaySession
session.append(evidence); // { accepted, duplicate, late, aggregated, reason }
session.prepareFrame(frameId, filmTimeS); // ReplayFrame, once for both views
session.camera(frame, rect, purpose); // viewport-specific matrix only
session.promoteVictim(death); // same-key promotion, once
session.finish(reason); // idempotent release
```

`PreparedEvent` retains event/shot/source IDs, state versions, accepted frame/shape, physical launch/contact/termination, typed body-stage/trace/piece/burst/arrival records, and the original report. `ReplayFrame` contains all concurrently visible body/piece/jet transforms, trace/shard slots, cumulative arrived state, role masks and camera director phase. Sampling/drawing performs no damage, authority RNG or health mutation. Full and corner cameras use the same prepared frame.

A session has one detached display target, one fixed world-to-session origin frame, and a recorded accepted pose/geometry timeline. Every event's hull-local points are transformed through **that event's** accepted frame into session space. The display target samples the linked accepted timeline; later events are not all transformed through the first hit's frame. A state/geometry transition occurs at its authoritative physical time. Earlier events retain immutable revision references, so a second shot hitting an already broken part uses its new revision without altering the first shot's geometry or pose. Still-referenced derivative geometry is leased or copied exactly once according to R/W ownership.

Detonation never reads live dead yaw/pitch, turret toss, respawn pose or current graph worlds and cannot relocate the replay target. Death/toss effects continue in the battle scene. Accepted pre-damage locomotion/joint samples for genuinely later impacts may advance the recorded timeline; destructive toss/death-pose offsets are excluded from the target reconstruction. Separately recorded fragments can move as fragments, without moving the frozen source target.

The piecewise film↔physical map is monotone. Once a segment has played, it is immutable. New future anchors append to the tail; simultaneous physical events share an anchor, and `commit_seq` orders state ties. Late records behind the playback cursor merge their arrived deltas into present cumulative presentation by version/event identity. They do not replay approach, move the camera backwards, or replace newer health with an older report snapshot. A gap waits for the matching version or marks the incomplete chain; it cannot silently claim exact state continuity. Seek in analysis reconstructs arrivals from records.

Authored display bounds are 64 active event metadata records, 4,096 visible trace/piece slots, at most four deferred other-target metadata sessions, and a 1.5-film-second completion tail. These are display budgets, not medical or physics constants. Ordinary finished events retire only after their last visible arrival and their referenced revision is no longer needed. At capacity, retire completed ordinary records, then aggregate excess decorative instances deterministically by event/source/time bin; record counters. Never alter the core report or silently drop a body/cause/death record. If all slots are active, retain bounded summary metadata and continue the same camera/clock; no “capacity reached” refresh loop. The fatal event and its causal ancestors are pinned independently of the ordinary ring; one active delayed cause is retained outside it. Causal pinning retains one original source report, the terminal record and at most 16 compact mechanism nodes; longer intermediate chains are compacted with preserved root/terminal IDs and an explicit count, not substituted by the latest hit. Dedupe uses the active ring plus a retired commit watermark and at most 64 unresolved version gaps, not an ever-growing event-ID set. Other-target queues contain no GPU snapshots until selected.

The server/local owner supplies recent **incoming records for the same victim actor/life**, bounded to the last six physical seconds and 64 records, plus an older active causal ancestor when needed. On fatal preemption, an offensive session for another target finishes once and creates the victim session. It cannot carry foreign target fragments into the victim view. Later outgoing hits keep their gameplay feedback but do not replace or queue an automatic new view over active victim playback. Same-key victim promotion preserves the existing view and clock. Death priority is once per death ID, not a repeated refresh on every Status/Snap.

## Player, navigation and resource lifecycle

Extend `replayPose.js` with a Player accepted-pose adapter rather than treating `G` as Enemy. Read independent turret/gun elevation/recoil/roll, MG, fold, launcher readiness, payload, running gear and geometry revision before applying damage/death effects. Preserve the detached graph/map remapping, fresh hull origin, static mesh leases, private instanced buffers, atomic acquisition-before-release, rollback and idempotent disposal already implemented by R.

Death-state application and death-replay presentation have independent dedupe sets under the admitted actor/life. A death snapshot may be applied first; the later valid fatal report still presents once. Duplicate reports and reconnect must not restart it. New life, chosen vehicle, leave/end/disconnect and cause end clear old eligibility through the existing owner. Resource acquisition/render failure yields truthful death state and safe deployment, not a fictional fallback shell or a locked screen.

`selfMissileHit` uses the real offline missile source/flight/warhead/contact and actual current WASM report; the online `NetClient` route consumes the serialized native owner receipt. A supported lethal near-blast/fragment event is eligible even without a direct plate-hit flag: the validated fatal cause and actual burst/flight are the evidence. The generic offensive `rep.hit`/MG guard cannot suppress it. Do not add offline cannon/MG AI for this task. Automatic deploy waits for victim completion/skip and server cooldown; manual deploy/reset/Tab/leave remain available. A replay cannot freeze live physics, hide indefinite state, or block navigation. Model disposal or context restoration cannot invalidate leased replay geometry.

## Real-boundary overpressure

The complete [overpressure research](../../overpressure-research-2026-10-11.md) remains the scientific source record. It distinguishes primary air-pressure injury from fragments, structural acceleration and burns. Its TNT scaling and free-field pressure/impulse discussion does not calibrate tank cabin casualty. No new medical threshold is introduced here.

Current `blast_inside` applies radial damage to all crew/internal modules; `blast_outside` uses global open-top/highest-plate heuristics. HE/HESH can create inside blast after only the first non-skirt plate; `burst_fragments` always includes inside blast. APHE broadphase containment is not a cabin boundary. The server does not currently call `tg_combat::splash`. These branches must be replaced in the live path, rather than adding a result label around the same behavior.

Use a typed `BlastEvent` with stable event/charge/source identity, actual physical time/location, initiated filler/type, accepted geometry revision and route evidence. Separate solid fragment generation from pressure evaluation. Zero/no initiated charge emits no blast; negative/nonfinite filler is rejected. No minimum clamp invents explosive mass.

| Route/mechanism | Required evidence and behavior |
|---|---|
| `ExternalExposure` | A posed direct unobstructed path to that crew exposure, or a bounded path through an explicitly known opening into a known connected compartment. Intact armor and gas-blocking structure block direct ingress; unrelated high plates do not protect the whole vehicle. |
| `BreachIngress` | Actual outside burst remains outside. A validated aperture crosses **all** intervening blocking layers and connects to the named crew compartment. A passed auxiliary plate or a penetration number alone is insufficient. No `kg*0.8` teleportation of the whole charge into the cabin. |
| `InternalDetonation` | Actual initiated charge detonation point/time lies within a verified connected compartment. Intact partitions prevent pressure exposure of unconnected crew. The vehicle-wide AABB, barrel overhang, or “inside after first plate” flag is insufficient. |
| `ArmourShockSpall` | HESH solid stress-wave/back-face debris records remain separate. Spall without an aperture creates no gas ingress/internal charge. Exterior blast exposure can still be evaluated independently. |
| Jet/kinetic sources | HEAT jet/spall and AP/APDS/APFSDS physical pieces retain their actual reports. Penetration/filler does not automatically grant whole-cabin pressure. Secondary ammunition explosion is its own causal event. |

`BlastGeometry` is an accepted semantic query: stable gas-blocking surface IDs, posed material/thickness, finite opening polygons and states, verified closed compartment boundaries, adjacency, crew membership/exposure samples, and validated dynamic breach references. It comes from X's actual physical surface/boundary bindings. Do not infer gas paths from decorative GLB seams, global `open_top`, crew role names, or target bounds. Fold/joint changes alter actual path intersections while indices stay stable.

Known open compartments support a bounded explosion→opening→crew path using deterministic center/edge samples and intact-surface occlusion on both legs. This is an explicitly versioned diffraction/ingress gameplay approximation, not fluid simulation. Closed compartments require a validated closed boundary or explicit trusted metadata; missing volume, hatch state, aperture or connectivity returns `unknown_boundary` and no fabricated primary-blast damage. Solid fragment and other already supported damage still apply. A production fleet cannot be certified boundary-exact until X supplies each supported compartment/opening; existing vehicle values/assets remain untouched. Optional compatible engineering metadata or a code-derived topology with documented structural proof may supply that data, under X ownership.

APHE advances its armed fuse by actual segment elapsed time at updated velocity. Test the detonation location against the real compartment at that time: an unarmed charge emits none; a delayed internal burst uses its connected cell; a projectile that leaves before fuse expiry bursts outside even if the broadphase still contains it. The single surviving charge owner prevents direct/splash/casing duplication. This integrates with P3 rather than creating a second fuse simulation in JS.

First-version interior/breach response is a named, versioned **dimensionless gameplay severity**, including path length, effective opening visibility and compartment connectivity. It is not kPa or a physiological fatality prediction. Existing game-health conversion is isolated/configurable and only applied to crew with an evidenced route; internal module response is separately versioned, never a human injury formula reused on an engine. External pressure, positive impulse and duration are optional only with source-validated explosive equivalence/model/domain. Unknown explosive type and contact/cabin/out-of-domain queries leave physical pressure values unavailable. No `pressure > constant => kill all crew` rule, and no V3 normalized display energy relabeled as pressure.

Server-owned cannon ground bursts, missile impacts/ground bursts, and APS **confirmed initiated warhead airbursts** create canonical events from trusted catalogs/charge state. APS breakup or a spent missile creates no automatic warhead explosion. For each candidate actor, accepted geometry/state feeds the same combat blast evaluator once under `(blast event ID, target actor/life)`. Direct-hit and adjacent-splash consumption of the same explosion share that key. The blast ID names one physical explosion; each target's damage commit retains its own event/state identity and references that source blast ID. Different real events remain independent. Preserve authoritative module/crew commits, scoring and owner-only replay evidence; clients never provide filler mass, TNT equivalence or a hurt-crew list.

## Completion evidence and remaining data

The companion [implementation plan](../plans/2026-10-11-v3-replay-replacement-and-overpressure.md) specifies RED/GREEN tests and native-handler→client receipt generation. Essential gates include exact fatal shot/source attribution; fire A versus ordinary hit B; source replacement/extinction; duplicate/reorder/reconnect/old life; same-spec actors; all projectile body signatures and physical termination; simultaneous impacts with stable clock/camera; timeline geometry immutability; one sample for both views; player pose isolation; bounded resources; renderer state/context restore; sealed/open/partition/breach/material/fold path fixtures; HESH and APHE routes; server near-burst/APS dedupe; and native/WASM parity.

Fresh source-matched release WASM, native and Node groups, web build, source-model/data hashes, and independent SPEC/QUALITY receipts establish implementation integrity. CPU geometry/matrix/fake-GL checks are necessary but cannot certify image quality. Final V3 visual matching is separately recorded as actual visual verification or **NOT RUN**; no browser workaround is authorized by this document. Nothing is published by this plan.

Necessary unresolved inputs are explicit: B/X accepted full pose and gas-boundary topology for all supported production vehicles; P5 authoritative muzzle/flight/contact authority; P2 timed deformation/fracture/termination and P3 initiated charge/fuse/jet records where absent; reliable cabin volume/opening/aperture and calibrated internal injury response. The implementation must expose capability/unknown diagnostics for missing records and cannot certify these physics from source demo tests. It can complete the replacement, causal/session/resource contracts and evidenced path correction while honestly retaining separate unfinished physics/calibration work.
