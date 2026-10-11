# P1 fresh SPEC fix receipt

2026-10-11. Fix base: `79a13e50b479cf8dedf2e9e482caeb54792bfd45`,
branch `codex/suspension-tracks-v7`. This receipt belongs to the scoped fix
commit; the initial P1 implementation receipt remains a historical record.
No publication and no B/P2 work.

## Two SPEC failures repaired

- Design's entry-only trace previously bounded the primary line at the far
  surface without resolving its armor. The kinetic primary now interleaves
  serial interior deposition with all later declared hull/turret, addon and
  mantlet contacts through the existing shared stack collision mechanism.
  Exit-face stacks occupy the inward side of the surface and are crossed
  main-to-outer. Layer IDs, traversal IDs, positions, times, outgoing state
  and work-allocated debris remain explicit. The original entry-only trace
  remains the protection-map and legacy adapter contract.
- Combat previously invoked the kinetic work transition without validating
  material hardness. Single, stack and combat now share contact validation
  for finite/nonnegative thickness, kinetic factor, density and hardness,
  plus the existing context/threshold constraints. Rejected combat contact
  keeps the carrier energy and target health, emits the rejection diagnostic,
  and produces no fragments or impact transitions.

Entry penetration remains `Penetrated` when the later far wall stops the
carrier. Its terminal verdict is the last shared transition, with zero
outgoing kinetic energy in the final state. Interior target exclusions keep
a primary target volume from being charged again when a later segment begins
inside it. Scene-local terminal ranges end at the design envelope after the
final declared solid; an exterior addon is still reached and resolved.

## Observed RED / GREEN

- Native invalid-material combat regression first failed with protected crew
  health `96.18189`. It now covers NaN and negative hardness, kinetic factor,
  density and thickness, preserves 500 J, and passes.
- Native design regression failed against the committed entry-only trace at
  its missing far contact, then passed after restoring the fix. It checks
  50/200 mm far walls after crew, inward armor entry position, shared stop
  to zero, reverse main30/outer20 with a 10 mm gap, a subsequent 10 mm addon,
  35 mm remaining penetration, and exactly one primary crew deposition.
- The final three added actual-WASM regressions all failed against the previous
  `2df3c2e2f122707d12112509a3588e95c737e077ea813e8af67ddbc30405f320`
  binary: no far-wall contact; only the near wall instead of reverse far stack
  and exterior addon; and no invalid-hardness rejection. All pass against the
  new actual release binary. The invalid-contact WASM test also covers all
  four negative fields and retained 500 J.
- The first full native run exposed an exterior terminal tail in the existing
  `penetrating_shot_damages_the_interior_and_is_reproducible` assertion.
  Bounding the final scene-local range made that test pass unchanged while
  the explicit exterior-addon regression also remains green.

## Fresh verification

All commands ran in this worktree with the scratch Rust toolchain, without
`CARGO_TARGET_DIR`. No browser, HTTP, CDP or Playwright activity.

| Check | Observed result |
| --- | --- |
| `cargo test -q -p tg-penetration -p tg-damage -p tg-combat -p tg-replay -p tg-design -p tg-sim-slice -p tg-server` | exit 0; 208 passed, 1 existing ignored |
| `cargo build -p tg-design-wasm --release --target wasm32-unknown-unknown` | exit 0; actual release build, 34.26 s |
| `node --test test/kinetic-impact.test.mjs` | exit 0; 8 passed against new WASM |
| `node --test test/combat.test.mjs test/modular-damage.test.mjs test/empty-design-ammo.test.mjs test/design-replay.test.mjs test/projectile-replay.test.mjs test/kinetic-impact.test.mjs` | exit 0; 66 passed |
| `node --test test/replay-pose.test.mjs test/rangefinder-equipment.test.mjs test/projectile-replay.test.mjs test/design-replay.test.mjs test/kinetic-impact.test.mjs test/hit-feedback.test.mjs` | exit 0; 64 passed, including strict real T-54 detonation/fire/pose/resource fixture |
| `node build.mjs` with the explicit installed Windows esbuild binary and Rust toolchain environment | exit 0; no stale-core fallback |
| target binary, copied asset, both HTML `designCore` embeds | byte-identical, one embed per HTML |
| `git diff --check` | exit 0 |
| `git diff --quiet 145e327 -- data client/web/assets/models` | exit 0; original data/models unchanged |

Native counts: combat 80, damage 19, design 35 plus 1 existing ignored,
penetration 15, replay 3, sim-slice 6, server 47 plus 3 doctests.
The existing design-test unused `crate::model::*` warning remains.
Changed source/tests retain LF, matching their HEAD blobs and neighboring
working files (`core.autocrlf=false`).

## Binary and bundle identity

- Actual target WASM and copied asset: 1,637,046 bytes; SHA-256
  `8f6fb70ea10c91e184643849207a219fc4967153ad15282ccf033c7078cf5874`.
- `client/web/dist/artifact.html`: 35,098,837 bytes; SHA-256
  `1012f5e6e4a162af771b79bdc3dabb460f8cb66fd8c30336a95fa7acbb457674`.
- `client/web/dist/tankforge-range.html`: 35,099,026 bytes; SHA-256
  `68efc28d641f51b94b1734f9e63eb45b42b10d59610d15c89b5d3cd61115c258`.

The build still links inherited unfinished B physics. The generated WASM and
bundles are verification outputs; only the eight fix source/test paths and
this receipt are selected for the fix commit. Inherited dirty B files and
Root-owned handoff notes remain outside the index. Heavy B tests and
baseline-overwriting scripts were not run. These checks do not certify B.

P2–P5/B/X/W, the final common authority and visual certification remain open.
Fragment redirection/subsequent penetration, HE/HEAT/HESH and APHE burst/fuse
physics remain their previously declared pending owners. Grazing gates and
LOS floors remain the existing owner policies. The strict real T-54 fixture
retains seed 2 and all detonation/fire/pose/resource assertions. Fresh review
by the same SPEC reviewer, followed by fresh QUALITY review, is still required.
