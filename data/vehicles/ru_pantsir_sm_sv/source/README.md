# TankForge diagnostic asset handoff

This folder targets the inspected **custom WebGL2 + Rust/WASM TankForge** checkout (`local3fd8a58`). It was built without changing that checkout. It is a visual/import package plus a separated combat-data candidate. It does not register a garage vehicle or switch authoritative damage.

## Files and build

- `data/vehicles/ru_pantsir_sm_sv/model.json`, `import.json`, `visual.json`: stock imported-model format, with additional stable `source_node`, `part_id` and `hitbox_batch_id` metadata retained per batch.
- `combat-candidate/vehicles/ru_pantsir_sm_sv/`: schema-shaped tuning examples for the vehicle, four cannon bores, twelve missile tubes, engine, modules and crew. These are **not an installable live combat vehicle**.
- `data/projectiles/<id>.json`: per-projectile candidate files in the target loader's directory format. `data/projectiles.json` is an index array for inspection. `data/missiles.json` contains append-only candidate records; never overwrite a game's global missile catalog with this short array.
- `../data/armor.json`: per-surface provisional resistance values. Only named armor has armor thickness; fittings, tracks, radars, cannon surfaces and internals keep explicit null thickness.
- `../data/hitbox.catalog.json` and `../data/hitbox.geometry.bin`: exact GLB-local Float32 triangle catalogs, indices, transforms, hashes and stable identities for the standalone GLB view.
- `imported-hitbox-bindings.json`: a separate catalog for TankForge's millimetre-quantized `model.json`. It hashes the **actual Float32 position stream** the target's `partVertices` uploads, after subtracting the declared mount origin. Do not mix the GLB and imported geometry hashes.

Rebuild from the package root with Python 3, NumPy and Pillow:

```text
python tools/build_integration.py --repo <path-to-tankforge>
python integration/tools/run-validation.py --repo <path-to-tankforge>
```

For an explicitly promoted model, append `--expected-glb-sha256 <promoted-sha256>` to both commands. A mismatch stops before generated files change. The validation runner derives counts and hashes from current files and writes `validation-report.json`; it also checks stale model rejection and a real 66,049-vertex uint32 fixture through the original converter/browser decoder. Geometry revision increments when the source GLB hash changes, and captured contacts retain that revision.

`build_integration.py` reads the original converter in memory, adds source-node batching, and writes only inside this package. Its source SHA-256 is saved in the adapter manifest. The original converter remains the owner's code; no source ownership or new license is asserted. Target JSON schemas are copied verbatim into `schemas/` for reproducible validation.

The import configuration preserves source texture dimensions and includes source normal maps when present. The stock `model.json` format still stores positions in millimetres, vertex normals in int8 and encoded texture images; the source GLB is the primary fidelity asset. The catalog for that derivative verifies its actual uploaded Float32 positions independently.

The included `tools/python_dependencies` supports local offline schema checks with Windows CPython 3.14. On another Python/platform, use an environment with `jsonschema>=4.26` instead. Build scripts also require NumPy and Pillow. Runtime JavaScript has no third-party dependency.

## Exact imported geometry hook

The current target only enables `captureHitboxGeometry` for a procedural T-72A. An imported Pantsir needs an explicit opt-in in `client/web/src/gfx/tankmodel.js`; none was applied here. The concrete helper is `runtime/pantsir-hitbox.mjs`:

1. Load `imported-hitbox-bindings.json` into `loadout.pantsirHitboxCatalog` for a local diagnostic scene. Before **any** `partMesh` call, wrap the renderer with the target's existing `captureHitboxGeometry`. Use a fresh renderer/cache or capture on first upload; an already-cached mesh cannot be reconstructed by guessing.
2. In the existing `impNode(parent, name, part, i, origin)` function, after `n.mesh = partMesh(...)`, call:

```js
pendingTags.push(tagPantsirImportedNode({
  capture: hitCapture, node: n, part, origin,
  catalog: loadout.pantsirHitboxCatalog,
}));
```

3. After building the whole scene, await `Promise.all(pendingTags)`. A missing binding, origin mismatch or uploaded-buffer hash mismatch rejects registration. Then call:

```js
// The source model already contains both belts. Remove the builder's generated duplicate.
suppressDuplicatePantsirBelts(root);
const diagnostic = createPantsirDiagnosticHitbox({
  root, capture: hitCapture, ModelHitbox,
});
const sample = diagnostic.sample(acceptedSimulationPoseRevision);
const result = diagnostic.querySegment(start, end, sample, { all: true });
```

All functions are exported by the supplied module; `captureHitboxGeometry` and `ModelHitbox` come from the target's `collision/meshHitbox.js`. Every contact uses the captured uploaded triangles. Bounds only reject candidates. The helper returns stable triangle identities and geometry/pose revisions while preserving measured points, normals and barycentrics. Frozen samples retain copied poses. `diagnostic.detach(partId)` removes physical membership; `diagnostic.repair(partId)` explicitly restores it. Camera visibility and X-ray do not call either method. `../data/armor.json` also contains per-material `regions`: material names `optic_*`, glass and track/rubber regions explicitly override the surrounding named armor zone to null resistance.

This is a local geometry query. It is not a trusted native registration, a damage packet or a complete penetration solver. Entry/exit wall pairing, subsequent penetration, scattering and replay identities need the same registered posed scene in the actual authority before live use.

## Joints, payload and fire effects

`runtime/pantsir-adapter.mjs` exports `createPantsirAdapter({getNode, setAngle, emitEffect, setPhysicalEnabled})`. `getNode` resolves the original GLB node names; default `setAngle` supports Three-style `.rotation` values in radians. A custom TankForge scene graph can supply its own setter.

`../data/weapons.json` socket records read their actual parent from the GLB. `position_m` and `position_world_m` are the same neutral world point (`position_frame: neutral_world`). `position_local_m` is relative to the named `local_frame`/`parent_node`. The cannon socket parent is the corresponding `CANNON_RECOIL_L/R`, so muzzle flashes follow recoil as well as elevation and yaw.

- `setWeaponPose` drives turret yaw, left/right launcher elevation and left/right cannon elevation independently.
- `setRadarPose` drives search yaw, search fold and tracking-radar elevation independently.
- `acceptLaunch({accepted:true,eventId,tube,...})` hides the corresponding internal missile body/fin/nose, removes those payload parts through `setPhysicalEnabled(partId,false)`, and emits a `missile_launch` effect once per accepted event. Tubes remain physically present. `restorePayload` requires an accepted reload/respawn event and restores those parts' physical membership. Stock exterior imports omit payload meshes; their node resolver returns no matching parts and the owner may ignore unknown payload IDs.
- `acceptCannonFire({accepted:true,eventId,socket,...})` emits the chosen bore's flash/smoke/tracer request once per accepted event.
- `detach`/`repair` call the owner's collision-membership setter; `setXray` preserves membership.

Connect `emitEffect` to existing `client/web/src/fx/missiles.js` launch/backblast and flight flame/smoke routines, or to the owner's renderer. The module does not consume ammunition, guide missiles, spawn authoritative projectiles or apply damage. The candidate `launcher.muzzle_vectors_m` lists all twelve tubes in alternating left/right order relative to the shared launcher hinge. The stock multi-tube mechanism fires all twelve before a reload.

Stock `model.json` supports hull, turret, gun, barrel and running-gear mounts. It has no independent radar joints and uses one shared launcher hinge in the supplied candidate. For independent radar/launcher behavior, retain or reconstruct the named GLB hierarchy and use the adapter above. Source belts are retained as geometry; a custom scene hookup must suppress duplicate procedural tracks. The standalone viewer demonstrates the named hierarchy separately.

## Validation boundary

Actual target JSON schemas validate the shapes and field types. The legacy `armor.json` is deliberately `[]` in `combat-candidate/`: full planes/boxes would fill source apertures. The inspected native validator source defines `P009` (no legacy plates) for that condition, and combat installation stays blocked until trusted render-triangle armor registration is connected. Do not work around this by enabling proxy plates as a second hit path.

The optional existing-binary probe is preserved in `native-candidate-report.json`. In this checkout the existing `validate.exe` rejected `launcher` modules even though the current source/schema support them, so binary/source parity is not established and it did not reach the expected `P009` check. This failed diagnostic is preserved; no native semantic pass is claimed.

All resistance, health, ballistic, ammunition, rate, crew, internal layout and engine values are provisional game estimates. No armor wall measurement, historical armor specification, authentic radar behavior, authentic guidance/fuze behavior, native/WASM parity, player/AI/network combat integration or garage registration is claimed.
