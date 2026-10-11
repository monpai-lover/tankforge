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

## Fresh independent follow-up after the implementer's multi-shape fix

Root reran the original external scalar and multi-shape fixtures directly
against the changed JS helper:4000/4000 scalar and1500/1500 multi-shape/cap
cases solved,no faults. Multi-shape maximum physical velocity error9.34322e−14;
maximum basis pivots15. The indefinite mass counterexample remained rejected.
Local `track-bundle`6 and `track-geometry`4 tests gave10 PASS/0 FAIL/exit0.

A numerical-units check additionally scales physical mass,all raw duals/forces
and finite caps by10000,and compliance by1/10000. This leaves the independently
chosen velocity and all contact slacks invariant,while representing realistic
vehicle mass/impulse magnitudes. The same1500 cases all solved,max physical
velocity error4.91565e−13,max pivots15. The default seed/fixture is unchanged;
the scaled fixture writes a separate external receipt.

These results certify those algebra witnesses and the now passing source
preparation tests only. Native bundle mirror,actual source R/S/corner-domain
guards,whole-side impulse application/shared-hull integration,reciprocal
traction and final B2 acceptance remain open. No old heavy healthy-fleet run,
new release build or browser operation occurred.

## Stable JS/native mirror — fresh independent Root checkpoint

At documentation HEAD2d88b89,with the implementer holding the named helpers
and focused tests unchanged for Root verification,Root ran `track-shape`,
`track-lower-graph`,`track-convex-contact`,`track-finite-discovery`,
`track-geometry`,`track-bundle`:37 PASS/0 FAIL/exit0.

Fresh serial native groups were `source_inventory_`5,
`minimum_deformation_`4,`fixed_track_compact_`3,
`fixed_track_lower_graph_`8,`fixed_track_bundle_`6:
**26 PASS/0 FAIL/exit0**. The actual compiled native bundle includes1500
independently prescribed multi-shape/cap KKT cases;wide sigma.2/.3 source
preparation also passes its native mirror. `git diff --check` exited0.
No release/WASM build or vehicle dynamics was run. Root returned native build
ownership to the sole implementer after completion.

The bundle's fixed tangent impulse input is not a sliding-friction or traction
implementation. Source chart/corner certification,real mass/velocity adapter,
whole-side/shared-hull normal and reciprocal traction integration,final freeze
correspondence,fleet and release gates remain unfinished. The checkpoint does
not approve B2,any other pending feature,or publication.

Stable helper SHA256 identities captured immediately after verification:

| File | SHA256 |
|---|---|
| `client/web/src/sim/tank/trackBundle.js` | `2DF603A3DBA29FE71BF1619CBD1CD404802EB85ED99135C75A7DB6829191C4BC` |
| `client/web/src/sim/tank/trackGeometry.js` | `E542DF60432CB2E9A5CF3E48EFFBF5BD31655E9848D3E8DC2033AB62CEA120CE` |
| `crates/physics/src/tank/track_bundle.rs` | `3D224F33FC211F51858894420C24824303A4534292170D2220228CCE52D71AFF` |
| `crates/physics/src/tank/track_geometry.rs` | `7B915D36C0271810E17E77C4E5D7D00FB847188FB6EFD76E3372E9411DF6A6FC` |

Separate no-dynamics chart-column inventory across35 descriptors at side+1,
q0,phase.25,control0−1mm and complete below-vehicle terrain rows found34
ordinary mechanical derivative batches valid;Flak q1/q2 remained unavailable.
This single static/air fixture is not a loaded/source/whole-fleet mechanical
certificate. It focuses the next common-directional-chart work on the proven
counterexample;other poses/phases still require their existing gates.
