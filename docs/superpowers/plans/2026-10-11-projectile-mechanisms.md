# Projectile mechanisms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. One runtime implementer at a time. Every task requires a fresh SPEC review, then a fresh QUALITY review; Root independently verifies behavior before integration.

**Goal:** Make every ammunition family produce distinct, bounded, physically motivated damage and replay effects with shared geometry, state and energy accounting.

**Architecture:** Put pure collision state/energy in tg-penetration, posed exact geometry and damage ownership in tg-combat, authoritative world flight in server, and read-only effect playback in JS. Both combat and protection analysis use the same collision mechanism. Existing original data stays byte-identical.

**Tech Stack:** Rust/serde, existing native/WASM modules, JS/WebGL2/Node; no new per-shell continuum solver.

## Dependencies and ordering

R freezes target presentation and L adds equipment classification. P1 is independent of running-gear completion. Finish B2–B5 and per-wheel damage, then exact-hitbox tasks before final P2–P5 certification. P2 may use the existing geometry owner during development but cannot be called final/exact until exact mesh mode replaces its final intersections. No old AABB/OBB/sphere fallback can satisfy the user's final requirement.

## Task P1: common collision state and report provenance

**Files:** Create `crates/penetration/src/impact.rs`; modify `crates/penetration/src/lib.rs`, `crates/penetration/src/stack.rs`, `crates/penetration/Cargo.toml`, `crates/combat/Cargo.toml`, `crates/combat/src/lib.rs`, `crates/replay/src/lib.rs`, `crates/sim-slice/src/lib.rs`, `crates/sim-slice/Cargo.toml` and focused constructors/adapter tests. Create `crates/combat/src/impact_report.rs` if event/report contracts would otherwise grow the main owner. JS adapters in `game/projectileReplay.js` must retain source values.

- [ ] Write RED parity for 150mm potential crossing two50mm synthetic plates: single/stack/combat must use the same per-layer residual law, not combat2/3 vs stack5/9 original KE. Add no-extra-energy tests for spall, two module/crew encounters and zero-energy input. Record true old behavior failure.
- [ ] Add public enum `FragmentSource` with Core, ProjectilePiece, ArmourSpall, CasingFragment, JetFragment and UnknownLegacy; serde snake_case. Add `EnergyBudget` with input/core/pieces/armour/deposition/deformation/unresolved terms. Add `ImpactState` holding current mass/velocity/pen/length/diameter/integrity/deformation/cap/time/fuse plus finite core/casing/cap/liner/filler reservoirs, charge ID/owner/disposition and a layer/traversal work cursor, initialized from trusted shell plus versioned authored profile.
- [ ] Implement validated finite nonnegative collision budget. For kinetic compatible plate work use `q=(required/available).clamp(0,1)`, `work=energy_in*q*q`; all consumers call the same helper and carry the resulting state. Assign finite spall energy from work, with source-labelled mass from local target data; splitting residual main body debits core explicitly. Every mass/energy transition returns a ledger. Unknown material parameters stay estimated/unknown.
- [ ] Use the same helper for resolve/stack/combat/design/sim-slice plate residuals, replacing duplicated formulae. Charge once per declared physical-layer traversal; hold entry state and work cursor across partial substeps/triangle boundaries/declared primitive unions. Incremental consumption is the difference between cumulative work at new and prior cursor, never a fresh q² calculation per fragment of the same traversal. Keep genuine separate-layer behavior distinct and add split/unsplit same-plate parity. Keep authored penetration curves, ricochet/shatter thresholds and material factors intact for this task. Do not modify original projectile JSON or replace it with invented universal constants.
- [ ] Extend compatible report events with revision, stable event/source IDs, timing and input/output state/budgets. Legacy replay records accept missing provenance but expose UnknownLegacy rather than pretending every nonpenetrator is armour spall. Addserde defaults and explicit adapter tests; no renderer objects in serialized reports.
- [ ] Test conservation, finite boundaries, mass split/reservoir ownership, monotone cumulative state, deterministic seeds, full old-report compatibility and raw-input parity across all five owners including tg-sim-slice. Compare one declared layer split/unsplit across triangles/substeps, separately compare genuine two-layer inputs. Run focused tg-penetration/tg-combat/tg-replay/tg-design/tg-sim-slice tests and JS projectile/design replay tests. Commit exact task only; independent reviewers verify active combat integration, not just a dormant helper.

The conservation assertion used by tests is:

```rust
let output = b.core_out_j + b.projectile_pieces_j + b.armour_debris_j
    + b.target_deposition_j + b.deformation_fracture_j + b.unresolved_loss_j;
assert!(output.is_finite());
assert!((output - b.input_j).abs() <= 1e-5 * b.input_j.max(1.0));
```

## Task P2: kinetic deformation, fracture and finite propagation

**Files:** `impact.rs`, focused `crates/combat/src/projectile_effects.rs`, combat event traversal/owner, `crates/design/src/trace.rs`, `crates/damage/src/lib.rs` and tests.

- [ ] RED cases: shattered projectile vanishes without residual pieces; subsequent layer resets integrity/cap; crew serial hits use unchanged full energy; old fragments stop at every plate regardless of remaining capability.
- [ ] Apply family-specific state transitions to AP/APCBC/APCR/APDS/APFSDS using authored profile estimates with explicit provenance. Separate deform/fracture/erosion, consume cap once, exclude muzzle-discarded sabot from hit mass, and preserve APFSDS residual length/mass. No unsupported dynamic-strength numbers masquerade as measured.
- [ ] Generate finite pieces from surviving component reservoirs with source mass/energy budgets; one charge-bearing owner inherits fuse, others cannot duplicate filler/charge ID. Keep unpenetrated pieces outside; recompute geometry intersections after direction change. Propagate through exact posed bindings with shared collision helper; pass only local deposition to module/crew damage. Record each outgoing state/segment.
- [ ] Separate each physical fragment's mass/energy/area from representative multiplicity/weight. Nonlinear penetration/damage uses individual fragment inputs, budgets/deposition use weights. Coalesce congruent weighted records by stable source/crossing before health clamps and secondary RNG; duplicating a ray into two halfweights must leave complete target state/events unchanged. Test bounded convergence for resampled directions and independence from rendering quality.
- [ ] Enforce global64 representative rays/256segments/16collisions-per-continuation limits with diagnosed unresolved energy. Protect same-boundary loops through stable crossing IDs plus minimum progress. FX RNG is separate from physics seed. Raise profile budget only with a measured bound, not hidden in a caller.
- [ ] Route protection/design and active combat through common kernel; eliminate duplicate state/filler logic. Test all kinetic families, zero energy, high/low mass, same-seed parity and source distinction, changed source order stable IDs, segment budget and multi-target residual propagation.
- [ ] Run relevant native/WASM/JS tests, commit, new SPEC then QUALITY reviews. Do not broaden performance tests until new core cases pass.

## Task P3: fuses, shaped charge, HESH and blast paths

**Files:** kinetic owner plus `crates/combat/src/blast_exposure.rs`, `crates/combat/src/tests.rs`, shared design adapters and typed burst/event contracts; `crates/weapon` only optional supported engineering metadata, never original data mutation.

- [ ] RED tests for APHE delay after slowing, unarmed shell, overpenetration outward burst, zero filling, external-module false inside, HE auxiliary plate with intact main armor, HESH spall causing false inside blast, protected driver in open turret vehicle.
- [ ] Fuse advances by actual segment time and updated speed; armed/dead/detonated states follow the sole surviving charge owner and explicit failure disposition; no clamp to cabin, charge emits once. Detonation consumes only surviving casing/filler reservoirs, with separate chemical release/coupling/unresolved ledger and inherited translational kinetic budget. Partial fragmentation followed by delayed detonation must not regenerate casing, duplicate fuse or release chemical energy twice. Classify true compartment positions using exact boundary roles/known cabin connectivity, not overall broadphase.
- [ ] Split explosion casing fragments from blast exposures. Chemical energy/source status and kinetic sources stay separate; no fake TNT identity or minimum invented charge. HEAT jet gets its own formation/finite state/air-gap depletion and does not borrow shell impact kinetic energy; HESH uses armor shock/spall without fake gas entry.
- [ ] Determine each crew's direct/opening/compartment path under accepted fold/joints. Derive bounded samples only from known structural openings. HE breach tests all blocking layers; independent solid and gas paths. Internal unknown enclosure uses diagnosed authored approximation, not fictional kPa.
- [ ] Use path-labelled versioned dimensionless game response. Optional free-field pressure/impulse module only for verified TNT equivalence and KB validity range; outside-domain result returns unavailable. If MIT KB implementation is substantively copied, retain pinned copyright/license in third-party notices.
- [ ] Verify per-family mechanism distinctions, invalid charges, no false pressure through intact armour, explicit exposed crew, same accepted state native/WASM/design, deterministic repeated event handling. Commit, new SPEC then QUALITY.

## Task P4: physical-time replay and ordinary impact FX

**Files:** `client/web/src/game/projectileReplay.js`, `game/hitcam.js`, `game/fx.js`, supported pooled render owners and focused projectile/effect tests.

- [ ] RED: current replay draws a generic intact projectile for shattered/stopped paths and labels all legacy nonpenetrator records spall. Add reports with real mechanism events from each family and assert actual rendered mesh poses/source labels/timing.
- [ ] Interpret reports only. Sample physical timestamps through a stable slow-motion mapping; drive moving residual core, deform state, fracture pieces, APFSDS remaining rod length, HEAT jet formation and HESH inner-face debris. Respect stopped paths, actual fuse location, no fictitious full body after fracture.
- [ ] Use bounded shared prototype/instance pools for pieces and readable display geometry. Preserve impact nose/piece source locations; explanation enlargement cannot move contact. Distinct armour/projectile/casing/jet source visuals and labels; flash crew/module highlight only at physical arrival.
- [ ] Ordinary FX consumes trusted events for metal impact debris, cap/sabot at their true event origins, dust/smoke and legal bursts. Changing display quality/visual particle count cannot change damage seed/state. No GPU/resource leak across replacement/hide/expiry/context restoration; integrate R snapshot.
- [ ] Test geometry/instance transforms and all-family source timing in CPU fake-GL fixtures, actual native report adapters, restored state/resources and quality independence. Build release WASM+web. Browser visual check remains separately blocked unless approval conditions change; do not bypass prior rejection.
- [ ] Commit task, new SPEC then QUALITY; Root independently runs new behavior tests.

## Task P5: trusted flight, continuation and multiplayer explosions

**Files:** `crates/server/src/lobby.rs`, `crates/server/src/missiles.rs`, world collision/accepted-pose owner, `crates/ballistics`, JS network shot/event consumers and focused integration tests.

- [ ] RED: changing only client WireShot.speed within0..2000 changes actual damage; client yaw changes target collision; duplicated explosion/shell continuation affects multiple entities incorrectly. Tests exercise actual lobby handlers, not only sanitation helpers.
- [ ] Fired record stores accepted launch origin/direction/at/catalog/weapon/seed. Initialize shared BallisticState from trusted muzzle state and catalog. Server either advances bounded fixed-step swept flight or replays accepted trajectory to verified contact; client speed/dist/pose claims cannot substitute for physical state. Time/latency bounds follow existing histories and have explicit finite step ceilings. Historical target pose uses accepted tick/revision.
- [ ] Narrow world contacts use trusted manifest+pose and material bindings. Shell/bullet/jet/residual piece/ricochet continue from outgoing state; each collision can interact with another entity under one shot event budget. Maintain entity IDs independently of spec IDs. Authoritative terrain/obstacles terminate or redirect before later vehicles.
- [ ] Server explosion events for shells and existing authoritative missiles call shared splash/exposure for each candidate exactly once. Catalog controls charge/type/fuse; clients never upload explosivekg or lists of hurt crew. Keep shooter-only no-damage Hit receipt and normal health/caps/death/scoring publication.
- [ ] Adapt local/WASM world shots to same kernels; clients consume authority, optionally predict presentation only. Reconnect/sequence replay cannot duplicate fragments/bursts/cross-target damage.
- [ ] Verify actual lobby rejected forged speed/pose, approved normal trajectory, latency history, real launch miss/terrain burst/open crew, external shields, two same-spec entities, late/removal/respawn context and receipt dedupe. Run full native workspace, JS/WASM parity, all original-data hashes and performance gates with B.
- [ ] Final whole-change SPEC/QUALITY reviews; build actual release WASM and final page, verify embedded hash and exact commit, check remote overlap, integrate/push authorized repository. Document visual verification limitations and completed evidence in final combined MD. Preserve all old distribution pages and original assets.

## Status bookkeeping

Each task records true RED, GREEN commands/results, exact commit, independent Root check and fresh reviewers in this document. P1 alone is not ammo/geometry/FX completion. Exact-hitbox and B plans remain required; none of these tasks cancel user requests.

Design/plan review: fresh `projectile_mechanisms_design_review` identified four contract gaps, all adopted: physical fragment properties versus sample weight and congruent-group invariance; surviving component reservoirs/single charge owner/chemical ledger; declared-layer traversal work cursor across subdivisions; explicit sim-slice shared-owner adapters/tests. Re-review PASS. This is document review; P1–P5 implementation remains outstanding.
