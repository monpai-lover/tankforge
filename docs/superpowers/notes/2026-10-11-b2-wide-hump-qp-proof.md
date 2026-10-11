# M56 wider hump: independent convex subproblem witness

Root read-only diagnosis,2026-10-11. No runtime modification or nonlinear
geometry/force certificate. Current helper still rejects this wider hump.

## Reproduction

External `C:/Users/24908/.codex/scratch/tankforge-root-wide-hump-qp-probe.mjs`
uses the real M56 side+1,phase.125,unchanged source q/wheels/shoes,and the
existing full-width Gaussian fixture `low-.02+.021*exp(-((z+.0545)/.2)^2)`.
Accepted owner pins/shape remain untouched. First SQP iteration has8 retained
controls,114 actual finite rows,minimum source gap−.9904452584mm,and rejects
`geometryKKT` with residual1.2931903602e−7m after160 dual sweeps.

The initial convex subproblem was exported to the external
`tankforge-root-wide-hump-qp.json`. Independent reference
`tankforge-root-wide-hump-qp-reference.mjs` uses row-pivoted Gaussian elimination
rather than production Cholesky to obtain metric responses. Reference dual
coordinate iteration reaches9.69993e−11m residual at383 sweeps;all raw primal
gaps are nonnegative and stationarity solution error8.67e−18.
This longer reference iteration is diagnostic,not a runtime budget proposal.

## Bounded working-set witness

The original160-sweep positive support is rows22,28,110. Solve their3×3 dual
Gram equalities once using independent row-pivoted elimination. Result:

- Multipliers:3.4549853412e−6,8.1052708467e−6,3.1729230400e−4,all positive.
- All114 original inequalities:minimum gap−2.16840e−19m.
- Three active equalities:maximum residual2.16840e−19m.
- Primal distance from383-sweep reference:max2.25950e−9m.
- Active rows are ground shoe61/primitive2/feature0,ground shoe61/primitive2/
  feature85,and carved bearing shoe42/wheel4/primitive1.

These are a numerical KKT witness of the unique strictly convex **initial
linearized** subproblem within the existing rank. Merely pruning114 rows to13
positive directions still gives8.97e−8 normalized residual at160 sweeps and
the same primal,so duplicate filtering alone does not resolve convergence.

Suggested implementer direction is a deterministic rank-filtered working-set
polish:solve active equalities,check positive original duals,all original
primal rows and stationarity,then remove/add a basis row when necessary under
an explicit finite budget. Do not fill a singular inverse,relax1e−8m,accept
feasibility without the declared objective certificate,or introduce optimizer
forces. The current working-set proof is not a universal active-set algorithm.

## Limits

This disproves initial-subproblem infeasibility as the explanation for this
fixture's first rejection. It does not prove full nonlinear feasibility,
global minimum deformation,source correspondence after a trial,root bounds,
quantized acceptance,mechanical corner validity,normal/friction equilibrium or
loaded fleet performance. Every accepted nonlinear trial still needs actual
source rediscovery and all existing geometry/closure gates. Implementer received
the external probes;only the runtime owner may make the fix and add regressions.
