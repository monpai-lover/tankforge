# R8.5 air-war, water and combat fixes implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Keep the existing authority and use isolated source patches; root owns final bundle integration.

**Goal:** Deliver actual 1:10 Taiwan geography, larger varied native fleets with labels, realistic water, working multiplayer loadout/custom selection, clean single-player return, armor queries and immediate replay target switching.

**Architecture:** Continue the existing isolated TankForge checkout at `D:/TankForge-workspaces/r81-push-20261027`, based on `dc106c1`. Changes remain in existing simulation/presentation owners and strict idempotent patch functions. Rendering consumes native state; hits, ammunition, damage, services and results remain server-owned. The minimap retains its 188×188 frame and 10 km radius.

**Tech Stack:** Rust/WASM, JavaScript, custom WebGL2, Python map/package tooling, Node tests and committed browser regressions.

## Task 1: Theatre and fleet

- [x] Update `tools/generate_taiwan_escort.py` and `tools/test_taiwan_escort_map.py` for geography/source heights divided by 10. Preserve original `taiwan.json`, physical runway size, nearby local spawn offsets and 650 m / 180 m/s airspawn values.
- [x] Expand the native scenario to 14 vessels, seven per side, using six reusable authored generic ship models. Update `crates/server/src/frontline_naval.rs`, its focused tests and the generated scenario. Native snapshots remain the only source of ship health, weapon fire and victory.
- [x] Scale the bounded deadline to 2700 s so the longer transport route remains achievable at physical vessel speeds; retain 15 s unloading. Verify the whole hull stays in water along every route and both victory paths still work.
- [x] Add bounded terrain extent/step and overhead ship labels through existing rendering/label owners. Verify permitted snapshots only, dead/offscreen handling and original minimap frame/radius.

## Task 2: Multiplayer loadout and custom selection

- [x] Reproduce preset/custom selection in the actual R8.4 normal deployment UI and trace `frontline_shared_lobby.js` to shared API and server acceptance.
- [x] Add failing regression coverage, then fix the source-owned selection/synchronization path in `handoff/tools/frontline_shared_lobby.js` and `patch_r85_loadout.mjs`.
- [x] Verify selection persists across redraws and valid custom choices reach native validation. Keep same-aircraft retention and airport service restrictions; no free in-flight inventory replacement.

## Task 3: Session, protection query and replay lifecycle

- [x] Reproduce leaving air-war and entering single-player; fix stale spectator/camera/input state in the existing lifecycle owners through a scoped patch.
- [x] Read `docs/hitbox-conventions.md`, trace protection analysis cursor ray to rendered triangle/armor binding, and restore real plate thickness queries with focused regression cases.
- [x] Add replay cases for unfinished and completed old-target sessions: the next target must replace the displayed session immediately. Same-target shots still accumulate in one view with independent projectile paths/explosions.
- [x] Preserve accepted battle/life identities, V3 projectile-follow/cutaway cameras, materials and no-outline behavior.

## Task 4: Water

- [x] Verify source and license of afl_ext's Shadertoy `MdXyzX` from the original page or its public source distribution. Save attribution and exact source hash; do not import unrelated noncommercial shaders.
- [x] Add `handoff/tools/patch_r85_water.mjs` and focused tests before implementation. Adapt the exponential wave kernel to bounded analytic, pixel-filtered water normals and water-only optical shading.
- [x] Preserve geometry, registered heights, physics, atmosphere/exposure, terrain and vehicle/replay materials. Add no fullscreen raymarch, extra textures or render targets.
- [x] Compile/read back actual HDR and fallback shader variants; inspect synchronized before/after moving-camera water and real map screenshots.

## Task 5: Integration and delivery

- [x] Root composes all scoped patches in `handoff/tools/apply_r85_airwar_fixes.mjs`, updates source composition lists and synchronizes canonical `handoff/bundle/app.js.html`. Export `data/aircraft/frontline.json` from that exact bundle.
- [x] Run focused tests and source/canonical checks, then freeze inputs. Run the full selected Node gate and optimized native library gate; preserve any failures and historical NOT_RUN explicitly.
- [x] Rebuild exact R8.5 HTML, start a new local port, and test normal multiplayer deployment/custom selection, fleet markers, leave-to-single-player, protection query and replay target switching against that final page.
- [ ] Build Linux amd64 once from frozen inputs; create verified complete and R8.4-based incremental archives, document scope and hashes, independently review, commit and push the existing feature branch. Do not deploy production.

## Acceptance examples

- Selecting a different aircraft preset or valid custom pylon option survives a server snapshot refresh and is present in the accepted deployment/service request.
- Leaving an air-war room and starting a single-player flight yields player camera/control, with no stale spectator follow target.
- Hovering an actual armor plate in protection analysis reports that surface's nominal/effective thickness; empty space reports no plate.
- If replay target A is playing or finished, a new accepted hit on target B displays B in the same update; a second hit on B adds its own path/explosion without resetting B's camera.
- Water remains finite and visually stable at 1:10 map coordinates, at grazing angles and as the camera moves; terrain, tanks and replay materials remain unchanged by the water patch.
