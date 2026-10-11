# P1 kinetic state implementation receipt

2026-10-11. Source base: `27de20f`, branch `codex/suspension-tracks-v7`.
The P1 source commit is the commit containing this receipt. No publication.

## Observed regressions before their fixes

- Original `resolve_stack`: two physical 50 mm plates at 150 mm potential
  returned `KE/E0=0.5555555`, failing the expected serial single-contact
  `2/3` assertion. The supplied original-WASM witness independently measured
  combat `.6666662597` against design `.5555555305`.
- Original combat: a zero-speed kinetic shot reduced crew health from 100 to
  40 through the old 60 damage floor. The native regression failed before
  implementation; the old shipped WASM also passed closed armor at zero speed.
- Intermediate active kinetic fragments: the second segment retained the
  initial 20,000 J physical record. A serial-report regression failed before
  correcting each segment's energy, velocity and time.
- Intermediate active kinetic fragments: the old 2 cm armor skip let a
  fragment pass a distinct main plate only 5 mm away, reducing protected crew
  health to `18.08268`. The regression failed before the kinetic-only blocker
  changed to numerical progress and source-crossing exclusion.
- Fixed-geometry progress with a NaN material factor could be accepted by the
  stack adapter. The explicit progress regression failed before validating
  the full layer data, then passed with atomic rejection.
- The existing strict T-54/BR471 replay fixture's seed 1 no longer produced
  ammunition detonation after P1 changed secondary RNG consumption. Its actual
  rebuilt-WASM test failed with fire and crew destruction but no cookoff. Only
  that fixture's seed changed to 2; real detonation, fire, destruction, frozen
  articulation and resource assertions remain intact.

## Delivered P1 contracts

- Shared pure kinetic state, finite energy ledger, disjoint remaining mass
  reservoirs, one charge owner, estimated/unknown profile provenance, and
  physical per-fragment values independent of representative weight.
- Per-declared-layer compatibility work. Single, stack, combat, design and
  sim-slice actively carry the outgoing state. Two real 50 mm layers retain
  `2/3` KE; one 100 mm layer retains `5/9`. Fixed 100 mm geometry advanced at
  cumulative 25/50/50/100 resistance matches the unsplit layer, including total
  armor mass. Duplicate boundary work is zero; true re-entry has a new ID.
- Estimated legacy family spall shares debit plate work. Finite target mass
  follows one traversal-local estimated cylinder bound and work cursor.
  Unknown subcaliber core dimensions stay unknown; launch caliber is a
  separately named estimated footprint, and .35/.60 admitted mass remains
  explicitly estimated compatibility data.
- Serial module/crew damage uses local deposition. Absorption reads pre-hit
  health. Zero kinetic energy does not manufacture solid damage or penetrate
  a fresh positive-resistance armor layer.
- Report-local layer/traversal/fragment IDs, physical segment records,
  collision positions/times, snapshots and budgets. Old actual JSON defaults
  to `UnknownLegacy`; new combat/replay JSON roundtrips. The JS design adapter
  preserves explicit sources and mechanism data without mutating its input.
- Sim-slice uses the integrated velocity vector and subsequent plates. Its
  existing sample now reaches and stops at the far 80 mm wall. The entry
  penetration outcome stays compatible; the last transition records the stop.

The old machine-gun test's `damage > 50` depended on the removed floor. Its
new observed damage is `47.783604`; the test now independently computes local
deposition from .046 kg, 820 m/s, rolled potential and 5 mm crew absorption,
while retaining closed-armor stop, open-crew contact and no-spall assertions.

## Fresh verification

All commands below ran in this worktree with the existing scratch Rust toolchain.

| Command | Result |
| --- | --- |
| `cargo test -q -p tg-penetration -p tg-damage -p tg-combat -p tg-replay -p tg-design -p tg-sim-slice` | exit 0; 156 passed, 1 existing ignored |
| `cargo test -q -p tg-vehicle -p tg-server -p tg-design-wasm -p tg-tools` | exit 0; 84 passed |
| `cargo build -p tg-design-wasm --release --target wasm32-unknown-unknown` | exit 0; actual final release build, 34.32 s |
| `node --test test/combat.test.mjs test/modular-damage.test.mjs test/empty-design-ammo.test.mjs test/design-replay.test.mjs test/projectile-replay.test.mjs test/kinetic-impact.test.mjs` | exit 0; 63 passed against the rebuilt WASM |
| `node --test test/replay-pose.test.mjs` | exit 0; 14 passed, including strict actual T-54 ammunition detonation |
| `node build.mjs` with the explicit installed Windows esbuild binary | exit 0; no old-core fallback |
| `git diff --check` | exit 0 |
| `git diff --quiet 145e327 -- data client/web/assets/models` | exit 0; original stock data/models unchanged |

Focused native counts: combat 79, damage 19, design 34 plus 1 existing ignored,
penetration 15, replay 3, sim-slice 6. The existing design-test unused-import
warning remains. Native raw-contact parity covers all five active owners;
actual-flight slice coverage checks the gravity-integrated incoming vector.
Actual WASM fixtures cover combat/design parity, work-allocated spall,
module→crew→crew deposition, zero-energy AP/APHE, and nearby main-plate blocking.
Root independently verified the final six-file integration group
(`replay-pose`, `rangefinder-equipment`, `projectile-replay`, `design-replay`,
`kinetic-impact`, `hit-feedback`): 61/61 passed. Root's independent six-owner
native suite plus server also exited 0: 206 passed including 3 doctests,
with the same 1 existing ignored test.

## Binary and bundle identity

The actual target binary, copied asset and both HTML embeds match byte for byte.

- WASM: 1,610,655 bytes; SHA-256
  `2df3c2e2f122707d12112509a3588e95c737e077ea813e8af67ddbc30405f320`.
- `dist/artifact.html`: 35,063,649 bytes; SHA-256
  `0813daa3be0495efce3e0629416607258fe03c0e309d5e07524d33039e37b0b5`.
- `dist/tankforge-range.html`: 35,063,838 bytes; SHA-256
  `06eb982daa006d9d03f550f490cd786eac1f1ce42f23573dd6cb1287ea11724f`.

The build necessarily links the inherited, unfinished B physics changes.
The WASM asset remains unstaged verification output; the P1 commit contains
only P1 source, tests, local dependency edges and this receipt. Existing B
source/test changes and Root-owned handoff notes remain unstaged. These checks
prove P1 bridging and do not certify B or the whole release. Heavy B physics
checks and previous baseline-overwriting scripts were not run.

## Remaining scope and limits

P2–P5, B, exact geometry X, per-wheel W, final common authority and visual
certification remain required. Existing HE/HEAT/HESH and APHE burst helpers are
explicit legacy/P3 paths with unknown physical provenance; their chemical
budgets, fuse survival, distributions and blast connectivity are not claimed
conserved here. P1 new kinetic samples use weight 1; P2 weighted grouping,
redirected fragmentation and richer subsequent-armor continuation are pending.
Existing LOS cosine floors and fresh-impact gates remain different, so this
receipt does not claim grazing-angle verdict parity. Browser access remained
under the existing approval limitation; there is no new visual-verification claim.
Fresh independent SPEC, then QUALITY review are still required.
