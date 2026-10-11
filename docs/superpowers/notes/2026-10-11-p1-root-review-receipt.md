# P1 Root independent verification

2026-10-11. Source commit:
`63ccd5ec77a337077dbdaa9afb9e99192d97dbc2`.
Task source base: `27de20f`; prior reviewed boundary: `c965d97`.
This is independent execution by Root after the original implementer repaired
the two QUALITY findings. It certifies only the stated P1 checks.

## Observed failures before repair

Root's actual-WASM fixture independently failed all three timing cases against
the old `8f6fb70e...cf5874` binary: design50, design150 Passed/E0 and combat50.
Positive plate travel had unchanged entry/output elapsed time; the design path
used a different arbitrary exit time. The external fixture later added an
explicit nonempty outgoing-carrier check and handles the reported flattened
provenance without changing runtime source.

The independent QUALITY reviewer also reproduced a radio being charged twice
in sim-slice across two50mm plates. The committed native regression retains
that real-flight geometry and requires exactly one primary deposition,
unchanged second-plate outgoing energy after no further target, and one damaged
module record. Root reran the whole relevant native suite including this case.

## Fresh results

| Root execution | Result |
| --- | --- |
| Six web groups: kinetic-impact, replay-pose, projectile-replay, design-replay, rangefinder-equipment and hit-feedback, plus external three-case fixture | 68 PASS, 0 FAIL, exit0 |
| `cargo test -q -p tg-penetration -p tg-damage -p tg-combat -p tg-replay -p tg-design -p tg-sim-slice -p tg-server` | 211 PASS, 0 FAIL, 1 existing ignored, exit0 |
| `cargo build -q -p tg-design-wasm --release --target wasm32-unknown-unknown` after source commit | exit0, unchanged actual binary |
| target WASM versus copied asset | byte-identical |
| each of two HTML files versus actual WASM | exactly one designCore embed, byte-identical |
| original `data` and `client/web/assets/models` diff against145e327 | empty; exit0 |
| `git diff --check` | exit0 |

Rust used the scratch RUSTUP/CARGO environment, without CARGO_TARGET_DIR and
without concurrent native builds. Existing unused `crate::model::*` warning
and one previously ignored design test remain unchanged.

Current binary: 1,642,342 bytes, SHA-256
`c7a132ae3513ee62127da6be1d1a223df030f28d6135e0117b456a1a27a27547`.
Artifact HTML: 35,105,901 bytes,
`00145980f8eabf9c05e2b38f2aaec5103ba3a94a80b5392557fa3e5c1202c139`.
Range HTML: 35,106,090 bytes,
`ecfc2c32c70a293e4917f5472bea2f0c44b90b9e18401ba71d2170b541ab8102`.

## Acceptance boundary

Timing is the explicit P1 incoming-speed compatibility estimate. P3 still owns
slowing and fuse integration. Secondary piece propagation, HEAT/HESH/APHE/HE
chemistry and FX remain P2–P5. B/W/X and final authority are also unfinished;
the generated binary still links inherited unreviewed B physics and is not a
publication or B certificate. No browser/HTTP/CDP/Playwright, heavy B RED or
performance-baseline overwrite was run.

Fresh SPEC recheck by `impact_p1_spec_review` passed at63ccd5e, with its own
28/28 focused actual-WASM/JS checks. The original QUALITY reviewer then found a
new blocker: combat consumes a precomputed module entry behind the completed
plate exit and reports a backward outgoing primary segment. The original two
findings are repaired, but **P1 is not approved**.

Root independently reproduced this against the samec7a132ae binary: front50mm
at z0, radio centre[0,1,.05], half-extents[.1,.1,.03], syntheticAP10mm/.1kg/
100m/s/150mm. The plate exit is z.050000000745 at elapsed.003999999046,
but radio contact is z.020000010728 at that same time. The segment runs from
.05 to.02 with reported velocity+Z94.2809m/s. The extended external fixture
now has4 cases:3 PASS,1 FAIL, exit1. It requires a current-cursor contact and
retained real damage to a straddling volume, rather than skipping the module.
Original implementer has resumed the scoped repair; new SPEC then QUALITY
rechecks remain required. The passing table above is historical evidence of
those checks at63ccd5e, not evidence that this new counterexample passes.
The separate implementation receipts preserve all earlier RED/GREEN evidence.

## Cursor repair independent verification at001d23a

Original implementer committed `001d23a516e2ef6482136bad8ee818c799126915`.
Root independently reran six web groups plus the four-case external fixture:
**70 PASS,0 FAIL,exit0**. The actual straddling-volume failure now passes while
retaining real once-only module damage. Native seven-package suite:
**213 PASS,0 FAIL,1 existing ignored,exit0**. Fresh actual release build:
**exit0**. Original-data/model diff and whitespace check: **exit0**.

Target, copied asset and both one-per-page designCore embeds are identical:
1,643,573 bytes, SHA-256
`2bd8feef65e8f00e0da988092ccf8aa5d334719e88f0dc1d45553fef753c8524`.
Artifact HTML is35,107,541 bytes,
`2e0b02a67e25e5eb1464f8824c9a6cbecb8a53f33c8768da1bb5e30bbeda8bcb`;
range HTML is35,107,730 bytes,
`6b619b5586ab81d56e20066d9eaa9610e4ca66724d422cedbe2f41f2f7795275`.
The strict real T-54 detonation/fire/pose/resource fixture still passes atseed2.

Fresh SPEC passed at001d23a with its own30/30 focused actual-WASM/JS checks.
Original QUALITY reviewer approved001d23a, independently passing2 focused
native cases and14 actual-WASM/external checks. All three blocking findings
are repaired. **P1 SPEC PASS / QUALITY APPROVE**, with Root70 JS/WASM and213
native PASS as recorded above. Runtime ownership can transfer to the next
authorized task. B/W/X/P2–P5 and the user's newly requested
victim replay/reference camera are separate open tasks. No final publication
or visual-acceptance claim follows from these tests.
