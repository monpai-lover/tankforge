# Per-wheel damage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. One runtime writer. Fresh SPEC then QUALITY per task. B finite contact and X pose/geometry dependencies remain required.

**Goal:** Independently damaged tires/rubber rims/hubs change real support, traction and model geometry, with authoritative safe repair.

**Architecture:** Shared source descriptor and derived modules; server/WASM wheel modes separate from health; JS/B operators consume corresponding survivor geometry. Rendering and exact hit mesh share the variant evaluator.

**Tech Stack:** Existing Rust/JS simulation, authored finite source parts, hash-bound supplemental roles, native/WASM damage and bounded network poses.

## Task W1: source identities, derived modules and wheel modes

**Files:** Create `client/web/src/sim/runningGearDamage.js`, `crates/combat/src/running_gear_damage.rs`, supplemental role/profile descriptors and focused tests. Modify module enum/schema, combat registration/state, server loader/WASM adapters and target generation.

- [ ] RED original8wheeled fleets have only wheels_l/r aliases; a KPVT shot through Puma(x=.975,y=.52,z=1.415)175mm gap damages wheels_r56HP. Assert exact-source candidate query misses actual wheel parts and baseline falsely wounds side.
- [ ] Compile trusted wheel:R/L:axle/source-road identities, station membership and tire/rubber/hub roles from source primitives or reviewed hash-bound imported sidecar. Original files/buffers unchanged; geometry-sharing distinct from role binding. Deterministic ordering and explicit ID migration.
- [ ] Add Tire/RoadWheelRubber/WheelHub kinds, native/browser descriptor registration and canonical health slots. Retire wheeled broadside modules from physical hits/repair work with explicit legacy adapter. No double registration or alias damage.
- [ ] Server/WASM owns epoch/descriptor/mechanicalRevision and per-wheel active variants/repairGeneration/permit/handover. Health transitions create monotone modes without clearing spin; repeated destroyed hits do not reset phase. No caps→mode overwrite.
- [ ] Integrate X exact part contacts/contains/fragment/blast distances, same-wheel enter/exit once-only module charge. Test every source family, two discs/station, imported shared chassis, source immutability, deterministic repeated prepare, old-state migration and actual gap no-damage. Commit, SPEC then QUALITY.

## Task W2: actual damaged-wheel support and meshes

**Files:** `sim/wheeled/wheeled.js`, `game/vehicle.js`, `gfx/tankmodel.js`, `gfx/imported.js`, bounded renderer vertex update owner, B JS/Rust primitive/feature/contact/route owners and tests.

- [ ] RED right-side damage only disables min-z wheel and remote restores all8grounded; flat still originalr. Test actual front/middle/rear individualdamage with geometry/contact/load/force assertions.
- [ ] Apply per-wheel support/rolling radius,width,friction,rollingdrag,drive connection to all contact/force/rim-speed/inverse-mass/brake/terrain/obstacle code. Retain branch torque budget and healthy engine/dynamics; disconnected input loss not reassigned. Preserve state and finite energy dissipation.
- [ ] Split procedural rubber/steel roles with byte-identical healthy output. Bounded damage variant/shared deform evaluator acts after spin in contact frame; steel stays fixed, normals/bounds/hitmesh updated. Imported source cache immutable, private/refcounted variant upload, context restore/disposal tested. Explicit mutable-vertex flag makes R copy current vertex data into snapshot-owned static mesh once per accepted report; immutable variants retain leases. Test later live vertex uploads do not change replay, partial clone failures return resources to baseline, context restores frozen data and hide/replacement/expiry free once. No per-frame unbounded mesh recreation or permanent every-frame geometry cache.
- [ ] Feed each tracked disc survivor into final B wheel-bearing/clearance/route/bare contact and reciprocal normal/friction bundle. Shared q/station and mass remain, one disc loss retains other support. No phantom original wheel or automatic track cut. Revision invalidates old contacts/shape caches.
- [ ] Continuous phase uses original healthy rule or revision travel/theta anchors; damaged hub cannot drive track. Verify static terrain sink/load distribution and healthy control runs for8wheeled/35tracked, actual widths/grooves, flatspin orientation, single/two-disc loss and B native mirror where existing. Commit, SPEC then QUALITY.

## Task W3: safe F restoration and authority handover

**Files:** combat repair lifecycle/server lobby, B jack/support lifecycle, wheeled support adapter, main actions and targeted native/JS tests.

- [ ] RED repairHP crossing0 immediately restores complete wheel/contact even under insufficient ground clearance. Exercise realF3s/core repair, not field-only mocks.
- [ ] Core repair grant records per-part fixed work/60%health and mechanical permission, leaves damaged geometry active. Bbounded axis supports generate true wheel insertion clearance; include survivor/body/spring in shared bundle; no imposed pose/velocity/traction/deformation force. Account any required new wheeled unsprung mass from originalbody.
- [ ] wheelRestoreReady carries accepted freshmotion/epoch/revision/seq/generation; server verifies profile/netclearance/permit/liveness/crew/serial and atomically consumes subset once. Still-broken track unchanged. ACK recheck can leave diagnosed finite pending; no snapback or unlimited jackwork.
- [ ] New damage includingnonfatalhealthloss revokes corresponding permit; death/J/crew and cancellation respect existing rules. Budgets survive compatible swap/reconnect; COM conversion/ID migration followsB.
- [ ] Test same/multiple tire/hub repairs, same-station discs, combinedbrokenchain, insufficientclearance/slope/groundedhull, repeat/lost/late ACK, budget exhaustion and newdamagegeneration. Commit, SPEC then QUALITY.

## Task W4: network, all owners and release proof

**Files:** net state/keyframes/history/interpolation, enemies/staticphysics, workshop exports/source IDs, interior/status/replay adapters and regression tests.

- [ ] Transmit bounded per-wheel modes and preciseL/omega/spin/steerpose; server owns mode/health/generation. Separatebadoptionalhint fromvalidlegacy motion, enforce exactcount/IDs/profile/finitebounds and combinedB packetlimits. Remote interpolation only withinsame mechanicalstate, short extrapolate thenfreeze.
- [ ] Player/staticenemy/rangetarget/wreck use realmode and oneappropriatephysicsstep; remote uses acceptedpose, no localjack/leak. Workshop same-chassis turret swap preserves IDs/state/phase/budgets; export role descriptors and import onlytrustedsemanticsettings.
- [ ] Status/Xray identify truepart/wheelID; R snapshots freeze samevariant/resources. Same-spec actors remain independent; payload empty/healthchanges do not contaminate source caches.
- [ ] Full research matrix, relevanthealthy wheeled/Bnative-derivedlockstep/modular/actions/weapon/workshop/source-byte tests and actualreleaseWASM build. Measure bounded deformation/BVH/GPUresources and finalpacketcost. Do not claim Rustwheeled dynamicsmirror unless separatelyimplemented/tested.
- [ ] Fresh finalreviews and authorizedpublication withB/P/X; preserveoldpages/assetbytes, reportbrowservisual limitation separately. No optionaltaskcancelsuserrequests.
