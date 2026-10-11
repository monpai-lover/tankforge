# V3 direct source reuse and multi-hit entry points

Root-owned external CPU preparation,2026-10-11. The user confirmed V3 is
their original source and authorized maximum reuse, then required
consecutive/simultaneous hits to continue in one view without resetting
the replay. P4/P5 plan/design amendments are committed at68dcac2 and274cf25.
The sole runtime implementer continues B2; this preparation changes no
production code, original data, shaders, GLB, WASM or game page.

## Direct procedural-model conversion feasibility

Source root:
`C:/Users/24908/.codex/scratch/tankforge-hit-replay-v3-reference-20261011/hit_replay_webgl_wasm_v3`.
The source geometry declarations in `src/gl.js` and `makeAmmo` in
`src/scene.js` were read before evaluating only those inspected functions
in a bounded Node VM. Renderer, DOM, network, build/start and browser code
were not executed.

External probe and receipt:

- `C:/Users/24908/.codex/scratch/tankforge-v3-geometry-adapter-probe.mjs`
- `C:/Users/24908/.codex/scratch/tankforge-v3-geometry-adapter-probe.json`

Fresh execution exit0: all9 source bodies convert to the actual TankForge
`GeoBuilder` layout,13 floats per vertex. All finite, normals unit within
1e−6, transformed nose at local zero and forward+Z, repeated output hashes
identical, original source arrays unchanged. All9 geometry hashes remain
distinct even after excluding colours/materials. APDS/APFSDS retain their
three separate source sabot parts. Total4168 nondegenerate body triangles.

| Source type | Base family | Body triangles | Separate sabot parts |
|---|---|---:|---:|
|0|APHE/APCBC|512|0|
|1|APFSDS|272|3|
|2|HEAT-FS|608|0|
|3|HE|592|0|
|4|HESH|512|0|
|5|AP|416|0|
|6|APCR|456|0|
|7|APDS|256|3|
|8|ATGM|544|0|

Source SHA256: `gl.js`
`663da09d113db17dc3c07f5f2ba1a3ee53ef951b3c27bc9a3166345e0872268d`;
`scene.js`
`7a6dceb93c8a5acda42411870b25f3daa5200f0716a0fbe0a04b531ddf3f9786`.

Adaptation must explicitly handle the reflection B[x,y,z]=[z,y,x], move
the source maximum axial nose to zero, scale axial/transverse dimensions
and transform normals by the inverse transpose. Original lathe triangle
winding is opposite its supplied smooth normal, while planar fin faces
agree:4104 inward versus64 outward nondegenerate body triangles. A blanket
index reversal for reflection cannot reconcile both. The external adapter
chooses orientation against the source normal per face and rejects zero
area triangles; converted float32 faces have zero normal/winding conflicts.
Production adaptation may instead repair the reusable lathe generator
once and then consistently reflect winding. Preserve linear source colours
without converting them to linear twice.

The test uses an authored .45m axial/.12m overall-envelope fixture for
all9 bodies solely to prove format, nose and normal conversion. These are
**not** historical dimensions, original catalog changes or final physical
projectile scales. Source demo proportions are not measurement metadata:
APDS/APFSDS core diameter and gun bore are different; fin span, collar,
cap/jacket and sabot envelope need separate stage profiles. For example,
TankForge PMC287 declares14mm core diameter for its35mm weapon, not a35mm
core. Do not normalize all fins to a core diameter or treat the source
ATGM whole-body length as a shell warhead length. Spin HEAT must omit the
HEAT-FS fin arrangement via an explicit profile/role, not colour guessing.
P2/P3 residual/termination and P5 accepted launch-stage records remain the
physical owner. This probe proves9 direct reusable geometry bases only;
all83 catalog profiles, MG/missile variants, stage transitions, rendering,
resource pools and actual battlefield/replay integration are still pending.

## Current multi-hit failure and production seams

External bounded diagnosis:
`C:/Users/24908/.codex/scratch/tankforge-root-multihit-replay-probe.mjs`
and its `.json` receipt. It sends two synthetic reports for the same
fixture actor/life through the actual current `HitCam`. This does not
fabricate an actual combat or victim result. Fresh execution exit0 confirms
the current **RED** behavior:

- At playback t=2s, the second ordinary shell replaces the target snapshot,
  resets clock to0, drops the first record and discards the saved camera.
- A following MG report during the ordinary-shell replay is ignored rather
  than appended. `meetsRequestedMultiHitBehavior=false`.

The source of replacement is `HitCam.show`: one `cur`, one track/motion,
new snapshot every accepted shell, `previous.target.dispose()`. The MG
early return prevents append. `_withProjectile` owns only one ordinary
shell and one jet. V3 also has one event, so its reusable rendering/clock
functions need a session-level event list, not repeated standalone restarts.
Existing replay-pose regression explicitly expects replacement; retain
that behavior for deliberate new analysis/different-target sessions and
add separate same-target append/resource tests rather than deleting lease
coverage. Small-window/full-screen share one prepared frame containing all
eligible events and a stable camera/clock, with event-specific physical
timestamps/body termination and cumulative accepted target changes.

Actual call sites: `main.js` protection analysis at489, design range1074,
ordinary battle `onCombatHit`2120–2129 via `camTarget`493. They currently
provide no explicit replay purpose, authoritative actor/life identity,
shot identity or event timestamp. `Enemy.id` is a vehicle pick; online
entity is `netId`, so never group on `e.id` or display name. B/X/P5 must
carry the existing trusted life/build/pose/shot envelope; offline targets
also need actual per-instance/life identity. New `camTarget` calls create
new plain objects, so target object equality is not a grouping contract.

Retain one display target reconstruction and bounded CPU event/accepted
pose/variant metadata. Rendering cannot read current live transforms to
rewrite earlier hits, allocate a full GPU snapshot per hit, repeat damage,
or reset camera/phase when another actual report arrives. Retire completed
instances and bound tail/pending-other-target sessions; overload may
truthfully aggregate visual detail without mutating physical receipts.
Duplicate/late/old-life handling, simultaneous events, continuous MG /
autocannon, mixed outcomes, APHE-overlap, moving/damaged targets, two-target
separation, victim lethal cause/priority, manual skip and context/resource
return remain required implementation tests. This note is preparation,
not P4/P5 completion or final game visual acceptance.

Reuse the archive's supplied full MIT notice,
Copyright(c)2026 Replay Lab Contributors, when porting substantial source.
The user's ownership authorization is already recorded; no renewed
permission question is needed.
