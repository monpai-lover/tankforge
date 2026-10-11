# B2 hard-coordinate checkpoint: review rejection

The exact hard-QR coordinate/phase-selection checkpoint passed SPEC but is
**NOT APPROVED** by QUALITY. This is a new Important numerical interaction,
independently reproduced by Root and in the native mirror. The sole writer is
repairing it before any helper acceptance or source-owner integration.

## Verified improvement, limited scope

For Pbasis=LQ, the checkpoint forward-solves triangular raw targets, builds
the Q KKT, and restores raw duals through L-transpose in both point and response
paths. Phase polish pivots on the largest prospective original shape QR norm
with existing scratch. Original source rank, mass, targets/caps/compliance,
literal slack handling and production acceptance gates are unchanged.

Root fresh JS helper 33/33 and native default-stack bundle15/traction18 passed.
Root also checked eight binary Hadamard-rotated 4D hard point/response witnesses
at two original force scales and four near-parallel spacings. Current responses
were exact; the prior column-only helper lost three ranks on the smaller
spacings and rejected responses. Cold directional 96/96 passed. SPEC's nineteen
independent rotated/reordered/nonzero-target/dense-mass/mixed responses passed.
These tests did not cover the failure below and cannot override it.

## New binding-face regression

Original problem: np2/ns0, M=I, P=`[2,1; 1,-1]`, targets `[1,-1]`, free velocity
`[-1,2]`, warm raw lambda `[0,1]` and statuses `[1,1]`. Exact/prior point is
y=`[0,1]`, lambda=`[0,1]`, slack=`[0,0]`.

The Q coordinate point returns y1=`1+2.22e-16`, lambda0=`-2.48e-17`, and
slack0=`+2.22e-16`. The unchanged literal-open guard then accepts the impulse
`[-1,-1]` derivative du=`[-1,-1]`, dl=`[0,0]`, violating the binding first face
by P0*du=`-3`. Exact derivatives are du=`[0,0]`, dl=`[2/3,-1/3]`.

Root reran the exact JS witness. Finite original-problem solves for h=`1e-3`,
`1e-5`, `1e-7` independently approach the exact derivatives. QUALITY reproduced
the same result with standalone native current/prior sources. Adding a genuine
massless coordinate and its own balancing reaction also reproduces it.

This is a point-arithmetic regression affecting downstream binding, not a
deliberate edit to the slack guard. Genuine positive slack must continue to
exclude a face; a blanket slack/force snap or relaxed source gate is not an
accepted repair. Both closing and opening directions need RED coverage because
a tiny positive reaction would falsely make a zero-load face interior too.

All thirteen hashes matched before/after both reviews. Freeze manifest and
exact byte snapshot: `tankforge-b2-orthogonal-freeze-hashes.json` and
`tankforge-b2-orthogonal-freeze-source/` under scratch. External witness/report:
`tankforge-b2-qphase-quality-zero-load-repro.mjs/.json/.rs`; Root rotated oracle:
`tankforge-root-rotated-hard-qr-probe.mjs/.json`.

Actual source owner remains RED, native source mirror/decoded/fleet/integration
and performance are pending, and default-stack source-spin overflow is still
open. The graduated-sight point at `771369a` is a separate reviewed fix.
