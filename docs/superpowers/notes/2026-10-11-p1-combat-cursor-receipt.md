# P1 combat cursor repair receipt

2026-10-11. Repair base: `63ccd5ec77a337077dbdaa9afb9e99192d97dbc2`,
branch `codex/suspension-tracks-v7`. This receipt belongs to the scoped repair
commit. Fresh SPEC and same-reviewer QUALITY re-review remain required.

## Repair

After shared plate transit advanced the spatial cursor, combat still consumed
precomputed module/crew entry points. A radio spanning the 50 mm exit was
therefore contacted at z=0.02 after the primary reached z=0.05, producing a
backward segment with positive-Z physical velocity. A wholly passed volume
was also incorrectly charged/damaged instead of being found ineligible.

The kinetic primary now selects its next pending contact from the current
cursor. Module queries reuse the existing posed OBB; crew queries reuse the
existing posed sphere and recognize a cursor already inside it. A containing
volume is contacted immediately at that cursor. A volume wholly behind it
does not intersect the remaining ray. Removing the selected candidate keeps
one primary contact per target while the next selection preserves spatial
and chronological order. Declared plate work/verdicts remain the existing
policy, with a monotonic cursor; this is not a solids-union/X implementation.
The existing nonkinetic event order, secondary contact sets and pending fuse
adapters are retained.

## Observed RED / GREEN

- Native straddling module+crew regression was RED at contact
  `Vec3 { x:0, y:1, z:0.02000001 }` instead of the actual plate exit.
  GREEN verifies both contacts at the exit time/position, real once-only
  health loss, forward primary segments, later module/crew contacts and
  consistent terminal flight time.
- Native wholly-passed module+crew regression was RED with radio health
  `99.45965` instead of 100. GREEN leaves the earlier box/sphere untouched,
  damages the later eligible volumes, and preserves only their penetration
  absorption and two deposition events.
- The added actual-WASM cursor regression was RED on the previous
  `c7a132ae3513ee62127da6be1d1a223df030f28d6135e0117b456a1a27a27547`
  binary at the straddling contact-position assertion. GREEN verifies both
  volume cases, real health loss, no reverse primary segments, ordering and
  energy ledgers on the rebuilt actual WASM.
- Root's external four-case probe, independently observed as three PASS plus
  one straddling-module RED, now passes 4/4 unchanged by this implementation
  agent. It requires real module damage rather than hiding the error by skip.

## Fresh verification

Rust commands used the scratch toolchain, ran serially, and did not set
`CARGO_TARGET_DIR`. No browser/HTTP/CDP/Playwright, heavy B check,
baseline-overwriting script or publication was run.

| Check | Observed result |
| --- | --- |
| native six P1 packages plus `tg-server` | exit 0; 213 passed, 1 existing ignored |
| actual release WASM build | exit 0; 18.51 s |
| actual WASM `kinetic-impact.test.mjs` | exit 0; 10 passed |
| Root-owned external `tankforge-root-p1-quality-probe.mjs` | exit 0; 4 passed |
| combat/modular-damage/empty-design-ammo/design-replay/projectile-replay/kinetic-impact Node group | exit 0; 68 passed |
| replay-pose/rangefinder-equipment/projectile-replay/design-replay/kinetic-impact/hit-feedback Node group | exit 0; 66 passed |
| web build with explicit Windows esbuild and scratch Rust environment | exit 0; no stale-core fallback |
| target binary, copied asset and both HTML `designCore` embeds | byte-identical, one embed per HTML |
| `git diff --check` | exit 0 |
| `git diff --quiet 145e327 -- data client/web/assets/models` | exit 0; original data/models unchanged |

Native counts: combat83, damage19, design35 plus 1 ignored, penetration15,
replay3, sim-slice8, server47 plus 3 doctests. The existing design-test unused
import warning remains. The strict real T-54 seed2 cookoff/fire/pose/resource
assertions are unchanged and pass.

## Artifacts and boundary

- Target/copied WASM: 1,643,573 bytes; SHA-256
  `2bd8feef65e8f00e0da988092ccf8aa5d334719e88f0dc1d45553fef753c8524`.
- `client/web/dist/artifact.html`: 35,107,541 bytes; SHA-256
  `2e0b02a67e25e5eb1464f8824c9a6cbecb8a53f33c8768da1bb5e30bbeda8bcb`.
- `client/web/dist/tankforge-range.html`: 35,107,730 bytes; SHA-256
  `6b619b5586ab81d56e20066d9eaa9610e4ca66724d422cedbe2f41f2f7795275`.

The selected commit paths are only combat `src/lib.rs`, combat `src/tests.rs`,
web `test/kinetic-impact.test.mjs` and this receipt. Generated WASM/bundles
remain verification outputs and still link inherited unfinished B physics.
B source, original data/models and Root-owned notes are outside this repair
and outside the index. Prior P1 work, time, mass/charge, atomic validation,
entry penetration and serde contracts remain covered. B/P2–P5/X/W, final
common authority and visual certification remain open; no broader release
or fuse/chemical-physics completion is claimed.
