# B2 original-equation exact predicate diagnosis

This is external diagnosis, not a production certificate or a new acceptance
gate. Current contact code remains frozen and unapproved after the integer
closed-face SPEC counterexample. The graduated sight point at `771369a` is a
separately accepted source change; the existing game HTML has not been updated.

## Why status alone cannot establish an equality

For original `P=[3,2;3,0]`, targets `[23,9]`, `M=I` and free `[0,7]`, the exact
point is velocity `[3,7]`, reactions `[0,1]`. Rounded positive slacks can lose
the correct closing response `[0,0]`, reactions `[1,0]` for impulse `[-3,-2]`.
Conversely, a warm equality with `P=[1,1;1,0]`, targets `[-gap,0]` and free
`[-1,0]` needs a negative first reaction when `gap>0`. It must not become a
closed face merely because a numerical bound gate accepts that small error.
Opposite dependent zero-reaction rows also retain separate one-sided
constraints even when the equality rank is unchanged.

The sole writer built an external exact binary64-dyadic original KKT
prototype using integer Bareiss elimination and exact interval/sign checks.
It verifies selected affine equations, every original reaction box, all
original primal inequalities and generalized equilibrium. It refuses a
singular or non-KKT candidate rather than treating old statuses as proof.
It presently supports hard rows only and is not imported by production code.

Root freshly ran the writer's 11 analytic cases plus three independent probes:
**14 PASS, 0 FAIL**. Additional probes cover heterogeneous physical mass,
nonzero fixed shape force, signed interior responses, the reversed upper-cap
cone and a retained dependent negative raw reaction. These checks validate
the diagnostic's limited hard-only scope, not a runtime repair.

## Preserved actual-source point

The unchanged original-road M56 packet contains 832 normals, 812 ground
contacts and 28 generalized coordinates. Its SHA-256 is
`1d71447c6e30001aa4495f505b9280808aeea7223f5cd93c3e8cc32e32399fbe`.
All original nonzero mass/map/target/free/compliance/cap entries were matched
on reconstruction; JSON serialization had discarded 184 signed-zero signs.
Null caps in this external JSON mean Infinity.

Root independently reproduced the exact selected-candidate rejection without
the exhaustive dependency audit: numerical equilibrium `2.120525977034049e-14`
and contact `1.5246620430255682e-16` pass unchanged runtime gates, but **75**
unloaded original ground inequalities have strictly negative exact slack.
All original raw bounds pass, and exact generalized equilibrium is zero.
Selected original rank is exactly 24; the full inventory rank is 27, with
the sole null vector in hull local X. This is an active-subset/inventory
distinction, not evidence that selected QR dropped three ranks.

The writer's role/magnitude audit identifies 43 right and 32 left
`band.tread` ground rows; no internal bearing row fails. Thirty-three targets
are positive and 42 are zero. Exact slack ranges from
`-5.822268482063271e-20` to `-5.113661842769198e-37`; its maximum per-substep
distance is `2.4259452008596964e-22 m` at `h=1/240`. These are far inside the
existing numerical gate, but a whole exact KKT claim would still be false.
Maximum exact-versus-numerical velocity difference is `1.609823385706477e-15`.
This does not establish physical infeasibility or justify changing targets.

## Cost and next investigation

Root's reduced audit took about 221 ms: input/selected exact rank 94 ms,
52-by-52 Bareiss solve 105 ms, all original signs/equilibrium 19 ms. The
writer replaced a 33-second rowwise dependency audit with exact nullspace
annihilation and affine-target checks, retaining the same rank/sign result;
the complete diagnostic still takes roughly 491 ms. Neither cost fits a
120 Hz simulation tick. No exact-prototype or certificate runtime adoption
is approved.

A separate external exact active-set experiment is authorized to exchange
genuinely violated rows and negative raw reactions with original inputs,
deterministic ties and explicit cycling/bit/iteration limits. Its first run
is bounded to 64 pivots and two minutes. Failure will be reported as solver
failure, not proof of infeasibility. Original residual gates, rank criteria,
caps, physics law and vehicle definitions remain unchanged.

Root's restricted `y=0` strict-inner-friction-cone LP is likewise only a
diagnostic. Exact `y=0` violates 246 positive original targets. Against the
existing numerical contact gate, a conditioned LP reported its restricted
0.65-per-axis inner cone infeasible; that cannot exclude the original
ellipses or a nonzero sticking velocity. No coupled certificate was obtained.

External evidence under scratch: `tankforge-b2-exact-kkt.mjs/.test.mjs`,
`tankforge-root-exact-kkt-probe.test.mjs`,
`tankforge-root-exact-road-current-kkt.mjs/.json`,
`tankforge-b2-exact-road-row-audit.json`, and
`tankforge-root-original-sticking-numeric-gate-whitened-lp.py/.json`.
The contact freeze still matches all 13 hashes. Source-owner, native mirror,
decoded/fleet, vehicle integration and performance acceptance remain open;
B3–B6, wheels, exact hitboxes and projectile/replay stages remain pending.

## Bounded exact active-set result

The external search completed 64 pivot transitions / 65 candidate checks in
21.378 s and refused with `pivotLimit`. Every candidate has exactly zero
original generalized-force residual; the largest pivot integer has 4,063 bits.
Admitting the first strictly negative ground row 3 changes selected rank 24
to 25 and creates eight wrong-side duals, including approximately
`-4.730654806570818e18` and `-4.729586071173282e18` at rows 1 and 525.
Releasing them leads to further exchanges of near-identical original rows.
The best count of exact primal failures was 61; the final count was 302.
No feasible certificate was obtained. This is bounded solver failure only,
not physical infeasibility and not permission to alter the original law.

Root freshly ran the completed external active-set regression suite:
**8 PASS, 0 FAIL**, including the analytic closed/open/true-gap cases,
dependent target exchange, finite caps, deterministic bound ties, and pivot
and time exhaustion. Production contact and constructor hashes are unchanged.
Further runtime arithmetic variants or exact certificate adoption are not
approved. The history is `tankforge-b2-exact-active-road.json`; external
implementation and tests are `tankforge-b2-exact-active-set.mjs/.test.mjs`.
