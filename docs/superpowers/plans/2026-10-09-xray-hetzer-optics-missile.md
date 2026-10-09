# Combat presentation and fidelity implementation plan

> **For agentic workers:** Use superpowers:dispatching-parallel-agents for the independent hit-camera, procedural Hetzer and missile domains. Primary agent owns shared main/HUD/optics integration and the final build.

**Goal:** Show the projectile in hit replays, refine the original Hetzer while preserving swaps, enforce missile G limits and make optics/HUD behavior consistent with vehicle data.

**Architecture:** Read-only authoritative hit reports feed replay presentation. Original procedural geometry remains authored in the generator. Shared Rust owns missile physics. Vehicle sight data determines projection and visible aperture.

**Tech Stack:** JavaScript/WebGL2, Rust/WASM, Python vehicle authoring, Node tests, Edge WebGL regression.

## Work

- [x] Hit camera: reproduce disappearing projectile in client/web/src/game/hitcam.js and testrange.js; add motion/persistence tests for penetrated, stopped, ricochet and HEAT results; implement a reusable visible projectile mesh and growing path; verify combat, range and analysis renders.
- [x] Hetzer: measure both supplied diagrams against existing generated vehicle, refine only confirmed original-shape defects in tools/gen_vehicles.py, regenerate only relevant files, verify turret/gun/module alignment and all family head swaps in a rendered regression.
- [x] Missile: inspect crates/missile/src/def.rs and world.rs, write high-speed/command-jump limit regressions, implement compatible G envelope and validation, rebuild WASM if simulation changes, verify server and browser twin launch/guidance behavior.
- [x] Optics: inspect sightLevels and shared SCOPE_RADIUS projection, derive per-sight aperture consistently from optical data, preserve mil/range projection, check WWII and modern scopes at all zoom levels and UI/DPR sizes.
- [x] HUD: keep the slip/sink row visible at zero and during acceleration, braking and threshold crossings; verify DOM and visual stability.
- [ ] Integration: review independent diffs, run web/Rust suites and strict validation, build and inspect all changed visuals, update user-facing repair records, fast-forward clean main, push and verify remote SHA.

Verification on 2026-10-10: 137 web tests and 203 Rust tests passed (4 original diagnostic ignores); strict validation returned 0 errors/0 warnings. The rebuilt WASM, 22 hit-camera captures, 24 scope views, real workshop swaps and player/AI/network launch regressions passed. Four targeted builders reproduce all 81 checked vehicle JSON files. Integration/push remains the final step.
