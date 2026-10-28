# R8.6 water and piloted-flight HUD implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent water, HUD and delivery owners; root integrates the canonical artifact and performs final browser verification.

**Goal:** Remove the escort mission banner that overlaps the control strip, show permitted fleet locations while piloting, use the user's supplied water reference, and deliver a complete Linux amd64 VPS upgrade package.

**Architecture:** Continue the isolated R8.5 checkout at `D:/TankForge-workspaces/r81-push-20261027`, base `64e657b`. Add reversible R8.6 leaf patches with exact R8.5 normalization. Legacy composers preserve installed R8.6 state; the current composer applies it last. Native authority, water collision heights, ship simulation and the 188×188 / nearby 10 km minimap remain authoritative. The shader reference is Frank Hugenroth's March 2013 CC BY-NC-SA 3.0 source, separately attributed rather than represented as MIT.

**Tech Stack:** Rust/WASM server and core, custom WebGL2, source-owned JavaScript patch composition, Node and Python regression tools.

## Task 1: Flight HUD

- [x] Trace the actual piloted and spectator rendering paths and identify which HUD clear/draw boundary removes or skips fleet labels.
- [x] Add a regression covering live controlled aircraft, both third-person and cockpit views, permitted ship snapshots, missing/dead records and bounded label admission.
- [x] Add `patch_r86_airwar_hud.mjs` and any focused helper. Remove the bottom escort status strip from active-flight controls; retain mission information on the minimap and spectator controls when applicable.
- [x] Make fleet positions available in piloted flight with shared label styling, suitable direction cues and explicit range/clutter policy. Never invent hidden native targets.

## Task 2: User water reference

- [x] Preserve the exact pasted source and its hash in `docs/third-party/`; retain attribution and CC BY-NC-SA 3.0 in the adapted source, HTML and packages.
- [x] Add failing stability/composition regressions, then implement `patch_r86_water.mjs` with exact `normalizeR86Water` restoration.
- [x] Adapt its five crossing long waves, noise detail, reflective sky/sun and cloud shading to the existing surface shader. Keep work bounded and pixel filtered, without its standalone camera or fullscreen cloud/water raymarch.
- [x] Compile and render actual HDR/fallback GLSL; compare water and unchanged terrain with the same camera/time/exposure, and inspect the final Taiwan page.

## Task 3: Canonical integration

- [x] Add current `apply_r86_airwar_fixes.mjs`, legacy-preservation tests and a current-version branch in `sync_frontline_client.py`; do not replace the whole installed native client block.
- [x] Compose all patches idempotently, export the aircraft profile from the exact final app, and freeze the new HTML/app hashes. Resource data parts and simulation sources must remain unchanged.
- [x] Run focused frontend and rebuild checks, then the selected complete Node gate. Retain historical NOT_RUN separately. Do not rerun unchanged native behavior suites merely to imply fresh coverage.
- [x] Start a new local service for the exact page and exercise ordinary air-war creation/deployment, active-flight ship markers, camera views, banner visibility and cleanup. Keep the previous R8.5 page/package available for rollback.

## Task 4: Complete VPS handoff

- [x] Cross-build the Linux amd64 server with final source/profile inputs and compare business data/provenance; distinguish static inspection from Linux execution.
- [ ] Build a complete package containing the HTML, server, all data/config, source/attribution files, manifest and Chinese Codex VPS upgrade/rollback guidance. Preserve live custom configuration and avoid any automatic production deployment.
- [ ] Independently stream-verify every package member and external archive hash, inspect executable modes, and include verification evidence and the exact repository/source pointers.
- [ ] Commit only owned R8.6 files, push the existing authorized branch, verify the remote commit, and deliver the full archive plus the local test URL.

## Acceptance

The bottom controls have no escort banner covering them. In a real controlled aircraft, fleet locations appear through the actual flight HUD in both camera modes. Water renders without shader errors or material changes to land/vehicles. The complete package has matching page/server/data and its limitations state clearly that production deployment and Linux runtime testing have not been performed here.
