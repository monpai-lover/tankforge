# Exact hitbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. One runtime writer. Every task needs fresh SPEC then fresh QUALITY review.

**Goal:** Final contact follows actual rendered vehicle and internal mesh surfaces in local/WASM and native authority.

**Architecture:** Trusted CPU export of exact buffers/roles; shared Rust BLAS/TLAS plus semantic pose; damage consumes sorted stable crossings. A broad box never grants a hit. Original assets and calibrated data stay untouched.

**Tech Stack:** JS CPU model builders, float32 binary derivatives, Rust geometry/serde/SHA-256, actual release WASM, existing Node/native tests.

## Task X1: exporter and bounded static exact query

**Files:** Create `client/web/tools/export-hit-mesh.mjs`, `schemas/hit-mesh.schema.json`, `crates/combat/src/geometry/{mod,manifest,bvh,ray,surface}.rs`, targeted tests and opt-in diagnostic adapters in design-wasm. Derivatives under `data/hit-meshes/`, source-binding sidecars under `data/hit-bindings/`. No wholesale generated staging.

- [ ] RED: actual Hetzer empty segment `[-3,.15,-1.9]→[3,.15,-1.9]` is falsely hit by Enemy.intersect; actual hollow barrel axial segment `[.38,1.44,3.83]→[.38,1.44,3.63]` has no hit, side `[.534,1.44,3.015]→[.38,1.44,3.015]` hits fraction .672078008556. Capture original behavior with renderer-buffer brute-force oracle.
- [ ] CPU exporter builds actual models/interiors with in-memory renderer; enumerate physical nodes independently of Node.visible, extract exact `_src.data` position bits and `_src.matrices` instances. Hash source/packed/emitted/anatomy records, mint identities before donor filtering, preserve unavailable raw-source status. No browser or GPU allocations.
- [ ] Implement structurally bounded manifest loading/hash validation, deterministic16-bin SAH BLAS leaves≤8, exact double-sided watertight query and all-crossing ordering. Share immutable meshes by position/hash while allowing different binding tables per variant. TLAS refits affected instances; singular/nonfinite inputs return explicit error, never proxy hit.
- [ ] Compare BVH with brute-force oracle over hollow fixtures, edge/vertex/coplanar/nearparallel/inside/reversed/affine-mirrored segments. Verify real render-buffer hashes and recorded Hetzer/barrel fixtures native and actual WASM. Validate BVH indices/cycles/bounds and explicit buffer-growth/overflow paths.
- [ ] Export audit-pending inventories for all42 and representative workshop keep/replace/donor builds; classify unknown roles as pending, not guessed armor. This task produces working geometry diagnostics, not final damage mode. Commit only focused kernel/export/tests and declared derivative files, fresh SPEC then QUALITY.

## Task X2: complete stable physical/protection bindings

**Files:** annotation hooks `gfx/geo.js`, `gfx/tankmodel.js`, `gfx/interior.js`, `gfx/imported.js`, `game/workshopImported.js`, exporter, `geometry/bindings.rs` and hash-pinned sidecars.

- [ ] RED provenance/filter/reorder fixtures: different borrowed sources collide under mutable ordinal keys; merged hull decoration inherits armor; crew role is not unique. Verify actual triangle identities before annotation.
- [ ] Annotate procedural emitted ranges/solid faces without changing geometry. Reuse interior.byModule/byCrew and WeaponBinding mounted keys; mint crew slot keys pinned to anatomy hash. Mark barrel outer/bore/rings, finite shoes/wheel parts, every existing internal solid and declared decoration.
- [ ] User-added fracture prerequisites: certify barrel-only regions even when packed with an elevating gun/mount/breech, and per-tube identity for multi-barrel assemblies. Link actual registration's stable selected modules/weapon key rather than requiring only GunBarrel kind: secondary MG and Oplot APS assemblies also contain physical barrels. Root source inventory identifies three imported mixed-gun cases and the multi-tube metadata gap; treat its bounds as authoring evidence only.
- [ ] Produce reviewed imported triangle/patch partitions against original engineering descriptors. Candidate spatial/normal mapping is an authoring aid only; unresolved/ambiguous contact blocks audit. Support barycentric region boundaries within a triangle, distinct variant bindings for shared mesh. No runtime nearest-plane heuristic.
- [ ] Cover all42 vehicles,15 packed-model entries and all supported generated workshop variants/source transplants. Audit zero unclassified physical triangles, zero missing/ambiguous anatomy references, identical emitted position/winding bytes and certified topology per declared role. Missing internal model geometry is explicit and must bind actual existing exterior mesh where appropriate, not invent an exact box.
- [ ] Test nested/overlapping unions, separate coincident layers, open sheets and boundary shells, genuine holes, no invented thickness/exit, all known reference IDs and donor/export identities. Commit focused metadata+hooks, SPEC then QUALITY.

## Task X3: full shared pose and active-contact integration

**Files:** `geometry/pose.rs`, JS accepted-pose adapter, `game/enemies.js`, `game/combat.js`, active projectile/self-hit/missile owners, `crates/combat/src/lib.rs`, design/WASM query adapters and deterministic crew activity owner.

- [ ] RED stale-world mixed-frame, extra turret/gun pitch, fold, launcher/empty rack activity, wheel instance and animated loader discrepancy with same render snapshot. Assert proxy broadphase hit alone never decides contact.
- [ ] Define and reconstruct AcceptedHitPoseV1: stable actor/spawn/build/tick/revision, current hull/joints/recoil/fold/MG/APS, running gear, payload occupancy and shared crew phase. Convert hull-relative parent turret commands once. Build atomic instance transforms/bounds; physical activity independent of UI visibility.
- [ ] Wire finite segment/all-crossing query into every final vehicle/fragment/blast line owner. P impact state consumes stable binding contact without repeating old planes/OBBs/spheres, backshift or missingexit fallback. Roles control inside/outside transitions and original engineering thickness at actual contact; preserve real outgoing wall contacts.
- [ ] Verify renderer-captured matrices and native/WASM geometry for same pose: all articulated endpoints, all5fold fractions, recoil, wheels/idler, crew, spent/loaded apparatus, hidden optics/Xray/fade. Independent entities with same spec retain separate damage/activity. Cache invalidation on disposal/respawn/swap/deformation revision.
- [ ] Pass recorded empty/muzzle/openings, module gaps, internal round/crew limb gaps and multilayer continuation regressions. Commit, SPEC then QUALITY.

## Task X4: native catalog and accepted-authority poses

**Files:** `crates/server/src/server.rs`, `crates/server/src/lobby.rs`, accepted motion/keyframe/pose history owner, WASM registration/network adapters and catalog receipts.

- [ ] RED actual lobby accepts forged target yaw/payload/readiness or self-reported mesh hash and produces changed damage. Hashing attacker bytes is not catalog trust.
- [ ] Load build-generated stock manifests/anatomy from pinned server artifact; validate all hashes/limits/reference IDs. Network names trusted catalog/build receipt only; reject arbitrary client role/triangle/matrix substitution.
- [ ] Server reconstructs collision-critical pose from validated motion/joint rates/limits/fire/reload/timestamp history and assigns revision. Reject stale spawn/build/topology/context; reconnect supplies complete canonical keyframe. Integrate P5 trusted launch/flight proof rather than trusting shot speed/yaw.
- [ ] Keep current online stock-only boundary. Local normalized workshop exact mode works from trusted local catalog; if online custom publication is later implemented, require separate server-normalized semantic build and signed/pinned receipt, not a mesh upload. Do not claim unavailable online workshop parity.
- [ ] Real native/WASM/server contact-report parity, forged input rejection, entity-vs-spec identity, stale/legacy extension handling and packet bounds. Legacy missing required pose cannot claim exact certification. Commit, SPEC then QUALITY.

## Task X5: B/per-wheel dynamic certification and release

**Files:** accepted running-gear/hit-pose adapters, exporter source shoe/wheel feature IDs, native same-shape reconstruction and geometry regression receipts.

- [ ] Consume B server-held epoch/revision/cut/broken and accepted frozen closed shapes or physical world-chain nodes; consume per-wheel tire/hub changed geometry. Exact imported hit surfaces stay source triangles even where wheel-ground contact uses engineering proxies.
- [ ] Map all35 tracked fleet rigid shoes with originalN/pitch to stable material link IDs. Fallen chain world instances do not follow moving hull; sleeping/wake/contact/repair grant and actual closure use corresponding pose/topology sample. Never swap broken chain for closed belt or circles.
- [ ] Validate source renderer/native/WASM instance hashes, topology transitions, damaged wheel holes/deformation, repair/reconnect/despawn and malformed shape/pose rejection. Declared vertex changes update affected BLAS; rigid joints refit TLAS only.
- [ ] Barrel derivatives share the accepted survivor/bore/fracture triangles with rendering and R: omit removed segments, preserve unrelated mount/receiver/breech regions, update affected BLAS/bounds/revision atomically, and verify clear removed-space/bore versus retained-wall/lip contacts in native/WASM. Actual repair restores declared geometry only on the authority's matching completion generation. Check frozen replay before/after live repair, multi-barrel and independent MG instances, head swap/life reset and bounded mesh leases.
- [ ] Measure actual representative query cost/memory including BMP high-detail internals, many identical actors, MG+spall and dual broken chains. Reuse BLAS/pools; no geometry simplification to evade exactness. Run complete original-protected-data/native/WASM/B parity checks and final focused+workspace tests.
- [ ] Final fresh reviews and actual build/hash/catalog publication alongside P/B; document same-pose numerical tolerance and fixed-substep time approximation. Browser visual verification remains separate; do not bypass previous approval rejection. Deliver combined MD and authorized pushed version only after all required plans are done.

Each task records RED/GREEN evidence, exact commit and reviewers. X1 audit-pending derivatives cannot be confused with final damage certification.
