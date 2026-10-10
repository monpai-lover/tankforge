# Freeze the impact pose in projectile replay

Investigation and implementation handoff, 2026-10-11. The user reported that ammunition detonation moves the target model inside the projectile replay. This document concerns TankForge in `C:/Users/24908/.codex/scratch/tankforge-suspension-tracks-v7`, not the unrelated Three.js repository used as the chat's initial directory. Runtime files were not edited during this investigation. The hit-feedback worker remains the sole runtime writer until its reviews finish.

## Verified cause

`HitCam.show` in `client/web/src/game/hitcam.js` stores the live target object. Its camera, projectile, plate outline, and damage traces repeatedly call the live rigid body's `worldPoint`/`worldDir`. Approach/impact/after render `frame.nodes`, which contain the live target nodes. X-ray/hold call the live `model.root.collect` and fetch an interior attached to that same model. No target pose is retained.

`main.onCombatHit` starts `e.toss` for `ammo_detonation` and then calls `hitcam.show(camTarget(e), ...)`. The draw section calls `scene.update(null)`, collects nodes, then advances `e.toss` by changing the first turret node's position, pitch, and roll. Those changes affect the following scene update. Replay then reads those updated target nodes, while its report coordinates remain in the original hull frame. Turret-mounted interior nodes move with the live turret too.

There is a second problem before toss begins: `combatHit` in `game/enemies.js` calls `e.pose()` after setting `e.alive = false`. `Enemy.pose` applies dead-vehicle yaw `+0.35` and gun-node pitch `0.08`. A graph copy taken only inside `HitCam.show` therefore captures an already changed pose.

There is also a stale-world hazard: physics and joint/local updates occur before the frame-wide `scene.update`. Copying `Node.world` from the previous rendered frame can mismatch the rigid-body frame used to construct `rep.shot`. Lazy interior creation during the first X-ray pass happens after that frame-wide update, so newly attached interior nodes do not even have computed world transforms until the following frame.

## CPU witnesses

No local game page or browser was opened. The following probes ran through Node with temporary code on standard input; no probe file or runtime source was written.

The strongest witness used the actual T-54 bundle, `makeLoadout`, `buildTank`, `buildInterior`, bundled `tg_design.wasm`, `Combat`, `combatHit`, and `Enemy.pose`. The renderer only accepted geometry and instance uploads in memory.

- Target: `su_t54`; hull origin `[10, 2, 30]`, heading `0`, turret yaw `0.6`, gun pitch command `0.2`.
- Shot: `aphe_122_br471`, seed `1`, origin in the hull frame `[40, ammo_front.center.y, ammo_front.center.z]`, direction `[-1, 0, 0]`, speed `0.85 * shell.muzzle_velocity_ms`, distance `100`.
- Actual report includes `ammo_detonation`, `fire`, `ammo_rack`, and `destroyed`; its turret yaw is `0.6000000238418579`.
- Before `combatHit`: turret node yaw `0.6`, gun node pitch `-0.2`. After its death pose: turret node yaw `0.95`, gun node pitch `0.08`.

A smaller probe using actual `HitCam`, `Enemy.pose`, `combatHit`, `RigidBody`, and `Renderer.setInstances` showed:

- Toss moved replay turret translation `[10, 4, 30]` to `[12, 9, 31]` in both approach and X-ray. Turret-mounted crew moved too. Report impact remained `[10, 3, 30]`.
- Moving the physics body without updating the visual graph moved replay impact to `[100, 6, 200]` while replay geometry remained at `[12, 9, 31]`.
- A shallow instanced-mesh copy shared `_src.matrices`; a later `setInstances` upload changed the alleged snapshot's link translation to `91`.

The actual T-54 has 45 graph nodes including interior, 26 distinct meshes, and two dynamic instanced meshes: `tracks` (182 instances, 2,912 matrix floats) and `gear_connections` (28 instances, 448 floats). Handle all instanced meshes, not just the track mesh.

Baseline command: `node --test client/web/test/projectile-replay.test.mjs client/web/test/design-replay.test.mjs`. Result: 14 tests passed. They cover projectile paths and original rendering-state restoration but do not assert target-pose isolation or resource lifetime.

## Recommended design

Use a small pre-core impact-pose capture, then a detached replay target built only when `HitCam.show` accepts a report. Retain immutable shared resources and give each replay its own instanced buffers. Do not stop or alter the live death/toss animation.

The alternatives are weaker: copying the graph only at show time preserves the death yaw/pitch; borrowing world matrices preserves a stale frame; temporarily changing the live target while rendering creates restoration and error-path hazards. Copying every GPU mesh and texture would duplicate immutable resources unnecessarily.

### 1. Capture the frame and articulation before resolving damage

Add a focused browser-independent `game/replayPose.js` helper. `combatHit` captures a compact pose immediately before `e.combat.shoot`, using the same `e.veh.body` and command state as the shot's hull-space origin and direction. Associate that pose with the returned report before the existing `alive=false` / `e.pose()` block. A module-private WeakMap keyed by the report avoids inserting renderer objects into the core's report or wire format.

The compact capture contains:

- A fresh hull-to-world basis and hull origin, sampled through `worldDir([1,0,0])`, `worldDir([0,1,0])`, `worldDir([0,0,1])`, and `worldPoint([0,0,0])`. The rigid body's `pos` is its center of mass, not the hull origin.
- Copies of the moving turret and gun/barrel local transform fields needed to reproduce the impact pose. Resolve enemy turret/gun commands before the core call; parented turret commands are converted to parent-relative yaw exactly as `Enemy.pose` does. Preserve each turret's translation/pitch/roll/custom local matrix and each gun/barrel's translation, elevation, recoil, and roll. Do not add the dead-vehicle offsets.
- The fold value and small launcher eligibility values (`loaded`, selected ammunition count, `nextTube`, `ready`) for each applicable gun, without copying geometry or constructing an interior.

No full hierarchy traversal, GPU allocation, instance-buffer duplication, or lazy interior creation belongs in this pre-core path. Core calls are synchronous and do not advance rigid-body/running-gear physics. The existing `Enemy.pose` after a lethal report only changes the death articulation while deriving running gear from unchanged accepted physics state. Full running-gear matrix capture can therefore occur when the accepted report is presented.

Protection analysis and design test shots do not pass through `combatHit`; their `HitCam.show` fallback captures the current body and current articulated locals directly, then computes fresh clone world transforms. It must not assume cached `Node.world` is current.

### 2. Create the detached target only after the show guard

Keep the existing invalid-report and MG-priority guards before snapshot creation. A suppressed MG report must not invoke the interior getter or allocate target resources.

For an accepted report, resolve its target's lazy interior exactly once, clone the entire target hierarchy including invisible nodes, and build a source-node-to-clone map. Copy all mutable node arrays and renderer fields: local transforms, world storage, visibility, kind/baseKind, scroll, highlight, castShadow, texture, and normalTex. Snapshot geometry data is immutable and may remain shared.

Use the saved body frame to place the detached model's body subtree. In the actual model hierarchy `model.root` contains `model.body`, which contains the hull, running gear, turrets, guns, and interior. A detached identity root and a body local matrix equal to the captured hull-to-world matrix avoid stale root position/heading/body-local combinations. Apply saved joint transforms on the clones, then update only the detached hierarchy once. Never invoke `scene.update` or `Enemy.pose` for capture, and never temporarily write pose fields onto live nodes.

Remap `interior.nodes`, every `byModule` array, and every `byCrew` entry to cloned nodes. The highlight code must only receive clones. Retain the original node membership set solely to exclude the live target from approach rendering. Copy the small target metadata used by overlays: pivot, folded armor definitions and vector arrays, crew roles, labels, length, and display name.

Launcher-round eligibility must be frozen too. The current `inner.updateLaunchers` closes over live gun/ammunition state and uses apparatus visibility. Do not retain or call that live closure during replay. Precompute per-round readiness from captured values, remap each round's apparatus to its clone, and update only clone visibility when the X-ray pass reveals the clone apparatus. Firing/reloading after impact cannot empty or refill replay rounds.

Copy currently available texture handles. A later image-load callback may update a live source node, but it must not mutate the snapshot's node properties. Shared immutable texture caches remain renderer-owned.

### 3. Use the snapshot in every stage

The frozen body handles the camera, projectile, plate outlines, path lines, bursts, and fragments. Approach/impact/after combine current background `frame.nodes` excluding all nodes from the original target subtree with the snapshot's visible target nodes. This also includes the target when the primary view excluded the player's body for an optical sight.

X-ray/hold collect the detached snapshot root and reveal/highlight only its remapped interior. The current kind/visibility restoration logic can continue on detached nodes if convenient; no live node is touched, including when a renderer throws. Preserve the existing projectile/jet mesh cache and replay timing.

### 4. Resource ownership and cleanup

`buildTank.dispose` and `buildInterior.dispose` call `renderer.freeMesh` for owned procedural meshes. A copied Node that merely references those meshes becomes invalid when the live target is switched, removed, or respawned. `removeRemote` does not currently hide an active replay. Imported `partMesh` and image/crew texture caches have renderer lifetime and are not target-owned.

Add small explicit mesh leases to the renderer:

- A snapshot retains each distinct non-instanced mesh once. `freeMesh` defers deletion while a replay retains it, keeping it in `_live` for context restoration. The final release completes a pending owner deletion.
- If no owner requested deletion, final replay release only removes the lease; it does not delete an immutable cache-owned mesh.
- Each distinct instanced source mesh gets one replay-owned `instancedMesh` with independent VAO, instance buffer, count, and a copy of `_src.matrices`. Immutable `_src.data` may be shared. This covers both tracks and suspension connection rods. Do not share `ibuf`, `_src.matrices`, or the source mesh's `instances` property.
- Clone meshes participate in the existing `_live` restore loop and carry frozen matrices in their own `_src` record. Context restoration must not re-upload live instance positions into the snapshot.
- Current imported and crew textures are never freed by target disposal. Borrowing these renderer-lifetime cache handles is safe. A snapshot must never call `freeTexture` on such handles. If texture owner deletion is generalized during this fix, use the same retain/deferred-free pattern for `texture` and `normalTex`; do not make live target disposal delete shared cache textures.

Snapshot disposal releases retained meshes and frees only snapshot-owned instanced meshes, exactly once. Call it on replay replacement, explicit hide, and automatic expiry. Build a new snapshot before releasing the old replay; if creation fails, release everything acquired by the incomplete new snapshot and preserve the old replay. Do not dispose the persistent explanatory projectile meshes on target replacement.

A removed/respawned live target can then finish its replay safely. A later report replaces the snapshot with a fresh body and joints. Only one target snapshot is retained at a time, so repeated hits cannot accumulate snapshots or clone instance buffers.

## Minimal implementation and verification sequence

Wait for the hit-feedback worker's specification and quality reviews before editing runtime files. Then implement this as one focused change set:

1. Extend `test/projectile-replay.test.mjs` (or a focused `replay-pose.test.mjs`) with a real `combatHit`/`Enemy.pose` ammo-death fixture that fails on the current .35 yaw / .08 pitch alias. Add the deterministic actual T-54/WASM shot above as an integration regression, using the in-memory renderer sink.
2. Add the compact capture helper and its `combatHit` hook. Verify that the captured body/frame and pre-core command values survive death posing without modifying shot fields, state, capabilities, or events. Count lazy-interior/GPU calls to prove stopped or priority-suppressed MG reports do not perform full capture.
3. Add renderer mesh leases and private instanced clones with focused fake-GL ownership tests. Cover pending `freeMesh`, two retained snapshots sharing a static mesh, cached resources without pending deletion, instance count/matrix isolation, context-loss restoration data, and idempotent dispose. Resource counts must return to their baseline after hide/replacement/expiry.
4. Make `HitCam.show`, `_camera`, `render3d`, and its overlay target use the detached snapshot. Add mutation regressions at a fixed replay time: live body translation/rotation, toss position/roll/pitch, all turret/gun joints, running-gear uploads, interior animation/highlights, launcher firing/reload, and visibility changes. The snapshot's target matrices and shell/trace endpoints must remain unchanged in both approach and X-ray/hold.
5. Add stale-world tests: change the actual rigid body and command locals without calling scene update, then show the report. Detached hull geometry and `W(impact)` must agree with the new physics basis/origin. Add a lazy interior whose nodes are created after the old frame update; its remapped world matrices must be correct on the first X-ray frame.
6. Assert that `byModule` and `byCrew` contain only clone nodes. During X-ray, highlighted clones must still align with the report. A throwing renderer/interior snapshot creation must leave every live pose/kind/visibility/highlight and instance buffer unchanged; partial resource acquisition must be released.
7. Cover target removal/model + interior disposal while active, selection of a different model, remote respawn, accepted shell replacement, suppressed MG, explicit hide, and expiry. The original target animation continues and the old replay does not reference freed procedural buffers.
8. Run `node --test client/web/test/projectile-replay.test.mjs client/web/test/design-replay.test.mjs` plus any new targeted pose/resource tests, then the relevant enemy/weapon/interior/model CPU tests and `npm --prefix client/web run build`. Expand tests only for discovered failures. Do not open the local game, use CDP/HTTP/Playwright bypasses, or claim screenshot verification under the existing approval restriction.

The completion claim requires recorded test results for the new pose/resource regressions. Existing 14/14 baseline results alone do not verify the fix. No combat rule, death/toss behavior, weapon damage, or suspension physics change belongs in this work.
