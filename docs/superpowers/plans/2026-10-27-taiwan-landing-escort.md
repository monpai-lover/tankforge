# Taiwan Landing Escort Implementation Plan

> **For agentic workers:** Use subagent-driven development with file ownership boundaries and focused RED/GREEN checks.

**Goal:** Deliver the user's compressed Taiwan naval escort air-war scenario while fixing attached aircraft FX and multiplayer tracers.

**Architecture:** Author a source-bound compressed theatre and explicit local airport layouts; add a native naval owner and one scenario outcome dispatcher. Keep the established flight, weapon and server authority paths. Client map, visuals and spectating consume admitted state.

**Tech Stack:** Rust server/combat, JS WebGL canonical bundle with guarded patches, JSON scene/weapon data, Node/native/browser tests.

## Tasks

- [x] Finish attached FX phase fix and native gun-tracer transport/visual tests; integrate narrow canonical patches.
- [x] Create deterministic compressed-map generator and fixtures; preserve original geography and source identity, build two operational airports/runways and air spawn choices.
- [x] Add native NavalWorld data/poses/AI/finite triangle contacts/damage/landing states; expose filtered snapshots with valid identities and route outcome through scenario rules.
- [x] Add client accepted ship geometry/presentation/target support, airport markings/lights, 10 km local minimap, and friendly death spectating.
- [x] Audit Su-27UBK/SKM and MiG-29/SMT compatibility against public source documentation; add 20 verified conventional presets with source-compatible release behavior. New guided weapon families remain explicitly outside this verified increment; see the loadout audit.
- [x] Run focused native/Node RED→GREEN, real socket and browser scenarios, update exact bundle/profile hashes, and verify matching Linux complete/incremental packages.

Publication is recorded by the Git commit containing this plan and its release evidence. No production deployment is performed.

## Ownership

Root owns attached FX, map generation, client map/airport/spectator wiring and final bundle integration. Tracer agent owns native tracer fields and accepted tracer visual owner. Naval agent owns new native naval/scenario modules and focused integration; coordinate overlapping `frontline.rs`/`frontline_sim.rs` edits before changes. Source data/canonical app are frozen between final checks and packaging.
