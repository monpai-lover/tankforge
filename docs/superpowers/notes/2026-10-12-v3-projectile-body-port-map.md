# V3 shared projectile-body component preparation

2026-10-12. Isolated worktree `C:/Users/24908/.codex/scratch/tankforge-v3-projectile-bodies-20261012`, branch `codex/v3-projectile-bodies`, baseline `283978f636cf406c508e9c07333e178840ec2252`. This prepares the body portion of approved plan Tasks 2.3, 2.4 and 2.6. It does **not** complete Task 2, replace the active replay, integrate live projectile draws, or certify P2/P3 mechanisms. No native/WASM compilation, copying, browser run, page build, commit or publication occurred.

## Source identity and maximum reuse

The supplied V3 archive SHA-256 is `5f24750268724a1cb11424f5be1753bf496661a5d47e8113aee3ba80f815d1ce`. Its extracted reference root is `C:/Users/24908/.codex/scratch/tankforge-hit-replay-v3-reference-20261011/hit_replay_webgl_wasm_v3`. Reuse follows the user's existing maximum-reuse authorization recorded in the [intake](2026-10-11-hit-replay-v3-intake.md). Code and independent source oracle retain `Copyright (c) 2026 Replay Lab Contributors` and MIT attribution. The companion clock/camera preparation supplies the verbatim `docs/third-party/hit-replay-v3-LICENSE.txt`; that file must accompany the integrated component.

| Exact source file | SHA-256 |
|---|---|
| `src/gl.js` | `663da09d113db17dc3c07f5f2ba1a3ee53ef951b3c27bc9a3166345e0872268d` |
| `src/scene.js` | `7a6dceb93c8a5acda42411870b25f3daa5200f0716a0fbe0a04b531ddf3f9786` |

Destination is `client/web/src/game/projectileVisuals.js`; focused regression/oracle checks are in `client/web/test/projectile-visuals.test.mjs`.

| V3 function / exact source lines | Destination / adaptation |
|---|---|
| `gl.js:6`, `V.sub`, `V.cross`, `V.norm` | `V` supplies the same CPU vector operations. |
| `gl.js:22`, `geometry` | `geometry` retains separate positions, normals, indices and edges while assembling source parts. |
| `gl.js:23`, `faceMesh` | `faceMesh` preserves flat face normals, fan indices and physical edges for fins/shoes. |
| `gl.js:31–38`, `latheGeo` | `latheGeo` preserves the source slope, positions, smooth normals, indices and edge construction. Bodies retain 40 segments; source cylinder rings retain 24. |
| `gl.js:17–18`, `M.point`/`M.normal`; `gl.js:49`, `transformed` | `transformed` specializes source scaling/rotation into a proper local projectile rotation and inverse-transpose normal scaling. It preserves source index order. |
| `gl.js:48`, `G.cyl`; `gl.js:56`, `Builder.cylinder`; `scene.js:140`, `ring` | The adapted `ring` uses the same unit four-ring cylinder profile and 24 segments, then applies source axial/radial scale and axial position. Source cap/smooth normals are preserved with both source and catalog inverse-transpose scaling. |
| `scene.js:137–154`, `makeAmmo`; `scene.js:139–141`, lathe/ring/fin closures | `makeAmmo` ports the source procedural construction, material colors, lathe profiles, fin face vertices and four rotations, retaining separate role parts before STRIDE13 merge. |
| `scene.js:142–148`, APFSDS, HEAT-FS, HE, HESH, APCR, APDS, ATGM branches | The original profiles and ring ratios are retained. HEAT omits the source HEAT-FS fins. Rockets retain the source tail-fin set and omit ATGM's additional guidance-fin set. Actual missile span replaces the source outer fin radius. |
| `scene.js:149`, shared AP/APHE branch | The source body is split at the ogive, with explicit catalog-derived AP/APHE/APC/APBC/APCBC cap/fuze roles. APC/APBC/APCBC ogive/cap ratios and base fuze dimensions are estimated display refinements. APHE retains the source extra jacket collar. |
| `scene.js:150–152`, three individual sabot shoes | Exact three-face shoe vertices, source `-.05` axial offset and rotations `0, 2π/3, 4π/3` are retained. The source's unused `latheGeo` sleeve local is intentionally omitted; it never contributes source geometry. |
| `gl.js:58–59`, `Builder.merge` | The source kind/color bucketing is replaced with indexed STRIDE13 merge plus explicit per-part role/vertex/index ranges. Parts retain `core`, `ogive`, `penetration_cap`, `ballistic_cap`, `jacket`, `fuze`, `band`, `fins`, `sabot` and `tracer_base` identity. |

No source demo flight path, scenario clock, separation time, RNG, illustrative damage, jet, burst, proxy tank or module registry is ported into this component.

## Public APIs and physical boundary

`projectileProfile(shell, missileDef)` returns immutable `{id,revision,provenance,lengthM,diameterM,roles,family}` plus `spanM`, `weaponClass` and versioned construction metadata. Catalog `length_mm`/`caliber_mm` supply shell dimensions. For missiles, `length_m`/`caliber_mm`/`span_m` describe the whole flying missile; its warhead's shell length is never substituted. Missing dimensions remain `null` with `status: 'unknown'`; unknown body dimensions produce empty, unknown geometry. Fin chord/thickness/position, sabot dimensions, caps, ogives and fuze dimensions are explicitly `v3_display_profile_v1` estimates. No historical JSON or damage model is changed.

The catalog has 85 projectiles across AP, APHE, APCBC, APCR, APDS, APFSDS, HE, HEAT and HEAT-FS, plus four whole missile definitions. HESH has a supported source-derived profile but no current catalog entry. MG entries and generated `bullet_*` shells retain real catalog caliber; the existing `caliber*4` bullet-length convention is explicitly estimated. Autocannon retains its ballistic family and adds a distinct tracer-base role. Cap identities use explicit catalog ID prefixes; explosive/fuze identity uses catalog kind/explosive mass. These facts do not assert measured fine dimensions.

`buildProjectileGeometry(profile, stage)` produces raw source-parity indexed CPU data: `Float32Array vertices` at STRIDE13, `Uint32Array indices`, role ranges, double-sided flags, physical bounds and visibility/known-timing metadata. Intact body prototypes have their nose at local `z=0`, forward `+Z`, tail bound `-lengthM`, and non-fin/non-sabot body envelope at catalog diameter. Shoe-only geometry retains this original projectile-nose origin even though the shoes occupy a shorter region behind it. HEAT-FS normalization includes the original fin's aft extent (`x=-.40` rather than the lathe's `-.38`) to keep total length exact. Fins and sabot may extend beyond body diameter; unsupported fin/sabot dimensions retain estimate provenance.

The local mapping is `R([x,y,z])=[-z,y,x]` with positive determinant, followed by catalog axial/radial scale and a source-nose translation. Normal scaling uses the inverse transpose. The camera reflection `B` is never used. The geometry is display data and never collision geometry.

Structural stage strings `intact`, `launch`, `core`, `sabot` select prototypes without inventing physical transitions or timing. `launch` includes the source three shoes for APDS/APFSDS; `core` excludes them; `sabot` contains only three discarded shoes. An object that selects a transition needs `recorded: true`; unrecorded core/termination requests stay unknown and empty. Recorded `stopped`, `detonated`, `fractured`, `terminated` contain no continuing intact body. `transitionKnown` requires both a recorded stage and an actual finite timestamp. A recorded termination with unknown time is a static termination prototype with `transitionKnown: false`, not a timed animation. Unsupported jet, HESH debris and APHE burst requests remain unknown and empty. The later trusted replay adapter must decide when to select these prototypes from authoritative evidence.

`projectileDisplayTransform(profile, {diameterScale,lengthScale})` returns a separate nose-anchored matrix and physical-dimension diagnostic. It never alters the profile, geometry, collision or report.

## Explicit renderer adapter

Raw source lathe indices `[a,b,a+1]` are geometrically opposite the source outward smooth normals. This inherited mismatch is retained and independently tested in raw CPU geometry; the source is not represented as originally consistent.

`projectileTriangleData(geometry)` adapts to current TankForge `Renderer.mesh`'s unindexed STRIDE13 data. Target CCW/exterior normal agreement is independently checked against `GeoBuilder.cyl` (`geo.js:146–194`). For each source triangle the adapter tests face/normal agreement and swaps the second/third indices when needed. It preserves source normals. Fins and shoes are explicitly flagged `doubleSided`; the adapter emits an additional reversed triangle with reversed normals so they remain visible even if back-face culling is enabled. TankForge's current renderer disables culling (`renderer.js:849`); this component does not change global culling. Source caps/jackets/rings remain single-sided, with corrected target winding. `{sourceWinding: true}` emits unmodified indexed order as unindexed data for source diagnostics only, without double-sided duplication; it is not the rendering path.

## Prototype ownership and restore seam

`new ProjectileVisualPool(renderer, {maxPrototypes:64,maxLeases:256})` requires the existing transactional `renderer.mesh(data)` and `renderer.freeMesh(mesh)` methods. `acquire(profile,stage)` shares a prototype across equivalent immutable profiles and stage content. It returns a bounded lease handle with `geometry`, per-request stage metadata and a live `mesh` getter. Prototype metadata contains no event timestamps; event-specific stage times never leak between users of the same prototype. Released/disposed handles return `mesh: null`.

`release(handle)` returns an active lease to the idle cache and is idempotent for duplicate/malformed handles. Idle cached prototypes are an intentional warm baseline, not active leases or a leak. `clearIdle()` frees idle owners; LRU replacement frees only idle owners. An all-active budget rejects new acquisitions. A replacement permits one temporary reserve upload (`maxPrototypes+1` owners) so upload failure preserves the previous cache. Repeated warm acquire/release does not rebuild or re-upload geometry. `dispose()` frees every owned active/idle mesh and invalidates leases; it is idempotent.

The explicit context seam is `contextLost()` before renderer restoration, then `restoreContext(renderer?)` when available. Loss frees this pool's owners from the renderer registry while retaining bounded CPU prototypes/leases. Restore uploads from cached triangle data; if any upload fails it frees all newly uploaded owners, keeps every lease unavailable and remains lost. Successful restore updates each existing handle without rebuilding geometry. These hooks must be wired by the later renderer owner; this preparation registers no context listeners or live call sites.

## Evidence and outstanding gate

Ignored evidence resides under `target/v3-body-evidence/`:

- `baseline-replay.log`: existing pure projectile/design replay baseline, 16/16 passing.
- `red-missing-module.log`: expected missing module.
- `red-profile-and-geometry.log`, `red-geometry.log`, `red-renderer-adapter.log`, `red-pool.log`: feature/stub RED receipts before the corresponding implementation.
- `red-released-handle.log`: a released handle initially exposed an idle mesh; its regression failed before the lease getter correction.
- `red-source-ring-normals.log`: baking ring dimensions before source lathe construction changed cap smoothing; the independent source-normal oracle failed before restoring the original unit-cylinder → source-scale sequence.
- `green-focused.log`: 17/17 focused tests.
- `green-impacted-node.log`: 73/73 focused and existing projectile/design/hit-feedback/missile-launcher/weapon-selection tests.

Focused checks load the complete real catalog through `tools/load-data.mjs`. They test physical APHE `.451 m`/`.12192 m`, all represented families, physical nose/bounds, normalized silhouettes/topology/roles, immutable provenance, V3 source lathe positions/normals/index parity, ring tessellation/source normals, source fin face vertices/normals, all three shoe rotations, target renderer winding, two-sided open parts, recorded termination/unknown stages, separate enlargement, bounded sharing/capacity/duplicate/malformed requests, released-handle invalidation, per-event stage isolation, transactional upload/restore and all-owner disposal. No in-flight X1 core is loaded or borrowed.

This component is ready only for Root's fresh SPEC → QUALITY review. Active causal replay, recorded-path sampling and live shared body draws remain separate tasks; no Task 2 completion or active V3 replacement is claimed.
