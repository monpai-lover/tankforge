# P1 QUALITY repair receipt

2026-10-11. Repair base: `c965d977a13648a11129f329f661d8d4eb9def52`,
branch `codex/suspension-tracks-v7`. This receipt belongs to the scoped repair
commit. Previous P1 receipts are historical; fresh SPEC and same-reviewer
QUALITY re-review remain required. No publication or new runtime task.

## Corrected mechanisms

Plate transit now belongs to the shared declared traversal. The cursor carries
defaulted `cumulative_path_m`; a passed update charges only its new distance
at the traversal's incoming speed. This is explicitly a P1 compatibility
transit estimate. P3 retains ownership of slowing/fuse integration, and P4
flight physics is not implemented here. Existing progress adapters retain
complete layer geometry and map the cumulative resistance fraction onto its
fixed complete path. Zero-resistance complete layers use their complete path.

Single, stack, combat, design and sim-slice use the shared output time. Whole
and subdivided progress agree; duplicate progress charges neither transit nor
a supplied `gap_before_mm` again. A Passed/E0 traversal has a finite exit time,
then stops spatial continuation. Known kinetic design paths use the shared
output instead of the legacy arbitrary 0.0005 s filler. Owner-local repeated
plate advances were removed. Generating-layer spall starts at the exit time.
Old cursor JSON defaults the new path field while preserving its snapshot.

Combat reports outgoing primary segments from the actual plate exit with its
output snapshot/time. Subsequent segment records retain the physical carrier
values at their start, and deposition events occur at the later contact time.
Armor path distance is excluded from the following free-flight distance debit.
Existing work, energy, mass, charge, damage and entry-penetration contracts are
retained. Debris allocation tests select debris separately from primary
segments belonging to the same generating event.

Sim-slice retains primary target exclusions across all plate segments using
the existing shared exclusion adapter. A module volume spanning the second
plate is contacted once by that primary. Secondary fragments keep their
independent contact sets and their existing armor bounds.

Touched adapter and continuation logic uses ordinary Rust formatting. No B
source, dependency graph, original data/model or Root-owned handoff edits.

## Observed RED / GREEN

- Single/stack progress regression was RED because a passed 100 mm layer had
  zero transit instead of 0.001 s at 100 m/s. GREEN also verifies whole versus
  25/50/50/100 progress, the duplicate's nonzero supplied gap, and exact
  150 mm Passed/E0 with finite 0.0015 s transit and zero duplicate time debit.
- Native sim-slice exit-time regression was RED for its unchanged output time.
  GREEN verifies the transition, same-position path and primary start for
  50 mm, plus finite Passed/E0 exit and no positive-distance carrier for 150 mm.
- Native real-flight radio fixture was RED with two primary deposition events:
  `13.333432830030006` and `20.206283033557668` J. GREEN has one event and final
  core energy within 0.001 J of the legal `316.563969` J second-plate output.
- Native combat exit-segment regression was RED because no outgoing primary
  segment started at the plate exit. GREEN preserves output energy/time in
  that segment and puts the later deposited event after the exit.
- Added actual-WASM timing regression was RED against the previous
  `8f6fb70ea10c91e184643849207a219fc4967153ad15282ccf033c7078cf5874`
  binary. GREEN checks design50/design150 and combat50/combat150, exact exit
  path/output/start agreement, Passed/E0, and no invented post-exit zero-energy
  movement. Existing actual debris checks now also verify exit start time.
- Root's external three-case probe, independently observed RED by
  Root, is GREEN against the rebuilt binary: design50, design150 Passed/E0,
  and combat50 outgoing core provenance. Root's later tightened non-vacuous
  carrier checks also pass 3/3. This implementation agent did not modify the
  external probe; the repo regression reads the actual flattened start field.

## Fresh verification

Rust commands use the scratch `RUSTUP_HOME`/`CARGO_HOME` toolchain and no
`CARGO_TARGET_DIR`. Cargo commands were serial. No browser/HTTP/CDP/Playwright,
heavy B checks, baseline-overwriting script or deployment was run.

| Check | Observed result |
| --- | --- |
| `cargo test -q -p tg-penetration -p tg-damage -p tg-combat -p tg-replay -p tg-design -p tg-sim-slice -p tg-server` | exit 0; 211 passed, 1 existing ignored |
| `cargo build -p tg-design-wasm --release --target wasm32-unknown-unknown` | exit 0; actual release build, 34.11 s |
| `node --test test/kinetic-impact.test.mjs` | exit 0; 9 passed on actual new WASM |
| Root-owned `tankforge-root-p1-quality-probe.mjs`, including final tightened carrier checks | exit 0; 3 passed on actual new WASM |
| six-file combat/modular-damage/empty-design-ammo/design-replay/projectile-replay/kinetic-impact integration group | exit 0; 67 passed |
| six-file replay-pose/rangefinder-equipment/projectile-replay/design-replay/kinetic-impact/hit-feedback integration group | exit 0; 65 passed |
| `node build.mjs` with explicit installed Windows esbuild and scratch Rust environment | exit 0; no stale-core fallback |
| target binary, copied asset, both HTML `designCore` embeds | byte-identical, one embed per HTML |
| `git diff --check` | exit 0 |
| `git diff --quiet 145e327 -- data client/web/assets/models` | exit 0; original data/models unchanged |

Native counts: combat81, damage19, design35 plus 1 ignored, penetration15,
replay3, sim-slice8, server47 plus 3 doctests. The existing design-test unused
`crate::model::*` warning remains. Strict real T-54 seed2 detonation, fire,
pose and resource assertions all remain and pass.

## Binary and boundary

- Target/copied WASM: 1,642,342 bytes; SHA-256
  `c7a132ae3513ee62127da6be1d1a223df030f28d6135e0117b456a1a27a27547`.
- `client/web/dist/artifact.html`: 35,105,901 bytes; SHA-256
  `00145980f8eabf9c05e2b38f2aaec5103ba3a94a80b5392557fa3e5c1202c139`.
- `client/web/dist/tankforge-range.html`: 35,106,090 bytes; SHA-256
  `ecfc2c32c70a293e4917f5472bea2f0c44b90b9e18401ba71d2170b541ab8102`.

The generated WASM/bundles still link inherited unfinished B physics and are
unstaged verification outputs. The repair selects only eleven P1 source/test
paths and this receipt: penetration `impact.rs`, `impact_tests.rs`, `lib.rs`,
`stack.rs`; combat `impact_report.rs`, `lib.rs`, `tests.rs`; design `trace.rs`;
sim-slice `lib.rs`, `impact_tests.rs`; and web `kinetic-impact.test.mjs`.
Inherited B changes and Root notes remain outside the index. B, P2–P5, X, W,
final common authority and visual certification remain open. Existing legacy
HE/HEAT/HESH/APHE chemistry/fuses and owner grazing/LOS policies remain their
previously declared pending scope; this receipt makes no broader release claim.
