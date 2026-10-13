# V3, full audio and T-72A v2 integration acceptance

Base: audio `c6486a293194f385678df704fe9b3ded1d56932c`; accepted V3 parent `48fd52c80637026414df7282fd219c69c5cebf04`. This integration also accepts the independently reviewed T-72A v2 model/API patch and AI/player open-belt presentation repair. No production deployment occurred.

## Result

- HitCam, battle analysis and design TestRange use recorded V3 sessions, clock, cameras, shared projectile prototypes and GPU drawing. Same actor/life impacts append in the same view; fatal victim replay uses the actual retained causal source. Old 2D outline/synthetic replay entry points are removed. Frozen source pose and projectile leases survive later detonation and owner disposal.
- Full audio retains 224 generated clips, 12 accepted loading clips and 125 profiles. Resolved-contact callbacks remain before damage presentation changes; missile audio and V3 terminal-source ownership coexist.
- T-72A v2 and its Float32 render-triangle API are integrated. See [the model acceptance](t72a-v2-integration-2026-10-13.md) and [future hitbox conventions](hitbox-conventions.md). Authoritative live combat is still on legacy plates/boxes; diagnostic triangle queries do not count as the completed combat switch.
- Accepted track/wheel damage reaches existing mechanical state. Broken belts expose two rigid terminal shoes on the damaged side, close only when capabilities recover, and reset on fresh placement/revival. Wheel support loss remains intact. The belt is attached to the vehicle; detached chain physics is still outstanding.

## Integration defects corrected

The merge exposed a missing TestRange report-adapter import, audio cleanup dereferencing an absent service, and strict native workshop loading rejecting newly retained audio-donor fields. Fixed the actual production interfaces, preserved strict unknown-field rejection and added a real exporter/native-loader regression. Audio/replay harnesses now provide their actual new dependencies rather than removing assertions.

Geometry receipts include every executed T-72A input and the immutable historical oracle. Both native source tables and JS expectations contain the same 39 unique paths, with 21 executed generator sources. The export contains exactly the current 44 ordered garage specifications plus three workshop recipes and 16 packed models. Catalog count and complete ordered-ID assertions remain explicit.

The old compatibility core and independent pre-kernel oracle are retained verbatim in [test fixtures](../client/web/test/fixtures/README.md); they were not regenerated or repinned as new evidence. Tests accept explicit freshly generated native receipt paths. The initial integration failures and RED/GREEN records remain in ignored local `target/` files.

## Fresh root verification

- `cargo test --workspace`: 483 passed, zero failed; four pre-existing tests ignored by their original configuration. Log: `target/joined-native-workspace-r3-20261013.log`.
- All 121 frontend test files, without a name filter: 1,203 passed, zero failed/skipped/cancelled/todo. Log SHA-256: `7501e469ce6b78573030bf27efb011a0e6fa7e8b251583082f3a268781746493`; result: `target/joined-full-node-r3-20261013.json`.
- Explicit release WASM built from the joined production sources and adopted as the default: SHA-256 `0462cac0bd3cfcd64a6c66341a40403d92023f7721426e4af4fbea80c50a912b`. The frontend suite uses these same bytes; native geometry/WASM parity and costs use fresh joined receipts.
- Combined model/track/physics/sprocket focused run: 57/57 passed. Independent track review additionally sampled 36 tracked rigs in 1,080 poses. Source checks and diff whitespace checks passed.
- Independent T-72A API/model, track state/geometry, native audio provenance and final geometry pin reviews found no remaining blocking issue within these declared scopes. Root verified the combined files and fresh whole-suite results rather than relying only on author reports.

## Remaining limits

Browser/GPU visual and full audio listening acceptance are not run. Cannon/MG replay has no recorded external approach trajectory; only supported timed core travel and terminal contacts animate. Complete chemical/fuze/burst timing, route-aware overpressure, authoritative model-surface hitboxes, complete startup-only pitch, eight suspension laws, detached track/tire physics and whole-fleet visual/historical acceptance remain separate unfinished requirements.

The retained legacy ground-loop anchors on settled T-10M/prototype samples can lie 27.4/12.5 mm below the requested terminal clearance. The repair retains those anchors and tests free-end clearance and rigid shoe dimensions; it does not certify whole-terminal or neighboring-loop terrain contact.

The parallel rocket-burst B0 candidate is not part of this acceptance. It retains legacy blast response and cannot be described as completed researched overpressure until its separate authority, geometry and replay gates pass.
