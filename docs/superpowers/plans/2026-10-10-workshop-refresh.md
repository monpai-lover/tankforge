# Workshop refresh implementation plan

> **For agentic workers:** Use superpowers:dispatching-parallel-agents for the weapon/loadout and imported-model helper domains. Primary agent owns UI, input normalization, shared main bindings and final integration.

**Goal:** Bring the workshop up to date with existing weapons, optics, models and reliable settings roundtrips.

**Architecture:** Optional `gun.weapon` catalog keys retain legacy calibre/length design. Optional `turret.sightSource` and `turret.stabilizer` become ordinary weapons fields. Shared imported-model helpers keep live builds light and exports complete. Transactional normalization accepts both raw settings and exported envelopes.

**Tech Stack:** JavaScript, existing WebGL2 renderer, Node regression tests, Edge visual/UI checks.

- [x] Add weapon/sight catalog in client/web/src/game/workshopCatalog.js; extend loadout.js layoutTurret, generatedTurretParts and buildToBundle with real weapon ammo/cycles/tube geometry and optics; test old settings and source profiles before implementation.
- [x] Add standalone workshopImported.js helpers for hull/wheel/material preservation and export assets; test replacement/retention and shared BMP models without editing source assets or loadout.js concurrently.
- [x] Add workshopBuild.js transactional typed normalization, bounds/defaults and envelope acceptance; prove own export roundtrip and invalid import recovery.
- [x] Update workshop.js controls, presets, summaries, labels and export actions; integrate main.js stats offsets, exported model/interior path and persisted compatibility; keep control IDs where existing UI regressions use them.
- [x] Review numeric/runtime changes; test generated and imported bases, ordinary cannon/autocannon/twin missile, optics, retain/replace paths and actual UI narrow-screen behavior.
- [x] Run full web tests and build; update user repair documentation; integrate clean main, push and verify remote SHA, preserve visual receipts and remove the temporary checkout.

Final verification: 168 web tests passed on integrated main; refreshed HTML built successfully; real workshop browser controls, mixed automatic/manual cycles, twin missile fire and fifth-ammo selection passed again against the main output. Hetzer family and retain/replace workshop compatibility passed. Visual receipts are preserved in `client/web/dist/verification/workshop-refresh/`. Implementation commit `1d5085f97f333314080d3c9090df4bee0eb550f8` was pushed and remote SHA verified; temporary worktree removed after preserving receipts.
