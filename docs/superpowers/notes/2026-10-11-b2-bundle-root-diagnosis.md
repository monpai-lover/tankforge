# B2 massless bundle algebra — independent Root diagnostics

2026-10-11,moving unfinished B2 source. No source contact consumer,applied
vehicle impulses or production activation is certified here. The runtime owner
received all external fixtures and owns every runtime change.

## First force compatibility and mass findings

The external `tankforge-root-bundle-probe.mjs` constructs4000 seeded feasible
KKT witnesses:1 physical/1 shape coordinate,4 original rows,positive original
duals,and soft or exact-zero compliance. Targets are derived from a chosen
primal/dual pair and actual equilibrium;the construction is independently
checkable rather than an assumed numerical solution.

Initial helper rejected183 feasible cases(3 soft/180 hard) at pivotLimit,and
accepted symmetric positive-diagonal indefinite mass `[1,2;2,1]`. Exact rational
counterexamples supplied to the implementer:

-Soft:M1.25,uFree−.65,fixedShape.4375,P rows(.75,−.75),(−.5,0),(−.75,0),
  (−1,.5),D(.25,1,.75,.25),targets(−.75,1.25,1.125,1.1875).
  Exact y(−1,.25),lambda(.75,.75,.5,.25) satisfies all original KKT conditions.
-Hard:M4,uFree−.5625,fixedShape−.5,P rows(0,−.25),(−.75,.5),(.5,.75),(.5,−.5),
  D0,targets(.1875,0,−.8125,.125).Exact y(−.5,−.75),lambda all1 is feasible.

After the original implementer added positive force-compatible phase I,
first-bound Newton steps and a Cholesky mass certificate,Root freshly reran
the unchanged external construction:4000 solved/0 failures,max physical
velocity error3.88578e−15,and indefinite mass rejected. Local bundle5 and
geometry4 tests:9 PASS/0 FAIL/exit0. This is algebra/helper evidence only.

## Multiple shape coordinates and finite original caps

Next external `tankforge-root-bundle-multishape-probe.mjs` builds1500 known
feasible witnesses:3 physical/2 shape coordinates,8 original rows,SPD
`A Aᵀ+.5I`,soft/hard/mixed compliance. One original inactive row haslambda0 /
positive slack;one finite-cap row haslambda=cap /negative slack;all other
original duals are positive withzero slack. Free physical velocity and fixed
shape force are derived from that exact witness.

At the diagnostic checkpoint267 cases were rejected:
hardCapacity256,hardCompatibility6,softShapePhaseI1,mixedShapePhaseI4.
Successful physical velocities agreed to2.72005e−15. First8 full numeric
witnesses are in external `tankforge-root-bundle-multishape-probe.json`.
These REDs were sent to the implementer;the count is not a claim about a later
fixed revision or about actual source/fleet dynamics.

The hard rows can be linearly dependent while their original nonnegative
reactions and bounds remain important. Storage/solve basis must depend on
actual rank rather than count,and dependent raw rows must still be checked.
Massless-force phase I must handle jointly coupled shape coordinates and caps;
its bounded nonconvergence is not proof of infeasibility. Neither filling a
missing inverse,nor dropping original reactions,nor assigning optimizer duals
to physics is allowed. Full source/chart normal and reciprocal friction
integration,loaded correspondence,fleet gates and fresh SPEC→QUALITY remain.
