# B2 M56 nominal common chart: independent bounded proof

Read-only diagnostic preparation, 2026-10-11. Only this note was written in the worktree. No runtime/test/data/asset/spec/plan/Git modifications, native build, browser, heavy dynamics, or performance-baseline writes were made. The sole implementer owns all runtime changes. This proof certifies focused kinematic derivatives and source correspondence, **not loaded normal/friction mechanics or B2 completion**.

Scratch capture/probes: `C:/Users/24908/.codex/scratch/b2-m56-common-chart-proof/`. Current-source snapshot was taken at `2026-10-11T11:33:55.9746189+08:00`; HEAD then was `68dcac24b122e1a7ca599edf2a2df65a72baacc7`. The original snapshot remains unchanged. `debugMechanicalChart.js` is a separate scratch copy exposing internal diagnostics and subsequently correcting only parent reconstruction for the experiment. Concurrent implementer changes after capture are not the source of this independent proof.

| Captured source | SHA256 |
|---|---|
| `client/web/src/sim/tank/trackPath.js` | `096018652b2b25c8d1c599af6d239dbe34700ea0267039c1441b3d0310d16b68` |
| `client/web/src/sim/tank/trackMechanicalChart.js` | `0f5fdb278256658ae8c318bde0b06cc82bcea7d91f1ee64c8f679e6a8ea1d37d` |
| `client/web/src/sim/tank/trackLowerGraph.js` | `9976ac3ac505e0effbcd2031205ebf03882512d4ab47fb92fa1af00629b1fe9a` |
| `data/vehicles/us_m56/visual.json` | `b704948da977e73acf113f38e328f7766114f35798ae4883afb2e2da60903dc9` |

The current common-chart source, original route and `track-mechanical-chart.test.mjs` were read before probing. Source consumer tests supplied the exact mixed-frame fixture. The implementer separately reported applying the same generic parent correction and passing JS regressions while this proof was running; no claim about that implementation's native status is made here.

## Conclusion

The M56 `semanticFeatureMismatch` was caused by **incorrect upper parent reconstruction**, not an unsupported lower chart geometry. The original zero-sag route has no global-floor clamp. The common helper reconstructed one endpoint with a floor clamp, changing the actual parent line by approximately 98 mm at that endpoint. Correcting the scratch reconstruction to match the original geometric branches makes the existing whole-side equal-radius road chart handle this M56 corner without a vehicle-ID branch, changed geometry or relaxed guard.

The legacy batch's individually available q columns are still mechanically wrong for the joint direction. Its `valid=true` does not establish a common chart. The coherent `[3,1,0]` lower chart matches the original pin/root march and all actual fixed-source candidate normal/tangent derivatives on both sides.

## Exact mismatch and minimal generic correction

Captured locations:

- `trackPath.js:938–960`, `hangLine`: at `depth<1e−12`, directly call `roofLine` with raw tangent endpoints and return. For positive depth, the initial endpoint is raw; the final loop endpoint uses raw `by`; only interior nodes use `max(floor,curve)`.
- `trackMechanicalChart.js:32–76`, `upperParents`: reconstructs the hang parents and q endpoint derivatives. Its captured `p.ay=Math.max(floor,y0); p.by=Math.max(floor,y1)` incorrectly floors every endpoint even in the zero-depth path.
- `trackMechanicalChart.js:77–88`, `parentAt`, and `:96–123`, `recordFeatures`: fail honestly because the reconstructed parent no longer contains the actual upper-line pins.
- `trackMechanicalChart.js:169–231`: existing geometric common-chain selection, analytic seed/parent derivatives, chord intersection recurrence and actual terminal-tangent implicit root response.
- `trackFeatures.js`, same-material shoe/wheel point derivative functions; `trackSourceMechanics.js`, complete hull/all-q/belt/S source-row projection.

The actual nominal upper parent is road circle 3 → idler circle 5. At the bounded exact root:

`A=(−1.2572131739941286, .7033333906878138)`

`B=(−1.88664447930386, .5829966121489165)`.

The captured common reconstruction replaced B's y with `.681`, the sprocket-center floor, and tagged `floor1=4`. At pin 32, actual `(z,y)=(−1.295612304147181,.6959921167754202)`, original material branch `4099`, `parentAt` returns `−1`. Pins 32–37 on this same actual line fail. This is a real parent-coordinate mismatch; removing the semantic guard would hide it.

The smallest required generalization is the original route's **clamp domain**, not a new M56 path:

1. Zero-depth/raw-roof mode: both endpoints remain raw; no floor owner, floor tie, or floor switch applies to either endpoint.
2. Positive-depth/polyline mode: only nodes with `0<u<1` can be floor-clamped. Initial and final tangent endpoints remain raw, and their Jacobians follow their actual moving tangent endpoints.
3. Floor ownership/ties/switch rejection applies only at those interior nodes where the original route evaluates the max. A genuinely tied moving floor or interior floor switch still requires its own directional node chart or explicit rejection.
4. Preserve the actual depth-bound branch, subdivision count, roof clipping/circle domain, joins and first-forward material intersection guards. A source-count/edge-index shift remains separate from a physical branch change.

This generic correction covers both the zero-depth case found here and the positive-depth endpoint case already present in the original algorithm. It should be mirrored from the original branch semantics in JS/native, ideally through shared parent metadata rather than independently drifting reconstructions. No radius, width, original pitch, N, station position, source primitive, root bound or acceptance tolerance changes are involved.

## Nominal geometry and coherent direction

Fixture: all four original q=`0`, phase `.125`, control0 `−.001 m`, other controls zero, travel `.073 m`, source side initially `−1`. N=`82`, pitch=`.10962079210979182 m`; original road radii `.333 m`, unchanged seed radii `.3526060151439487 m`. The latter are the existing route descriptor's radii, not a proposed source-radius modification.

Bounded original-route bisection to `|E|<1e−13` gives composite root `.0760112424363615`, idler `.003988757563638506 m`, sag `0`, free idler branch. This precision is used only to independently measure derivatives; the production closure tolerances are untouched. Base hull is `[4,3,5,3,0]`, source count 10, joins `[4,0]`. The road-3 source appears on both upper/lower envelope intervals, so ownership must include the actual interval/domain, not assume a circle occurs only once.

The legacy batch is valid and reports q sides `[-1,+1,+1,-1]`. For joint q velocity `[+.13,−.13,+.13,−.13]`, the coherent lower chain is `[3,1,0]`; road2 is skipped above its enclosing tangent. Its cone margin is `.26`. The upper parents remain the robust source pairs `[4,3]` and `[3,5]`. Those upper parents have real q3 endpoint motion, which the existing analytic parent derivative already handles after the coordinate reconstruction correction.

The equal-height/equal-radius road criterion already geometrically covers M56 and Flak despite their different original radii, layout, upper supports, link primitives and root branches. Outer idler/sprocket radii are allowed to differ, as they do here. No vehicle-specific branch is needed. Nonhorizontal/unequal-road-radius ties, moving join-owner corners, floor-node ties and source primitive endpoints exactly occupied by a pin remain separate unsupported corner cases unless explicitly certified.

All q columns come from this **one** chain. The original phase/root/S columns are reused only where their complete feature certificate remains valid. Both the solved velocity cone and the nonlinear transition still must pass before consuming the chart. A source consumer must continue rejecting a legacy batch containing per-column one-sided q maps unless a complete common directional chart is certified.

## Independent numerical results

`joint.mjs` uses the frozen original route for its exact-root references. The scratch common helper uses the generic raw-endpoint reconstruction only; it does not bias q, select separate q sides, change a source radius or accept/freeze pins.

For the complete joint direction `qv=[.13,−.13,.13,−.13]`, belt direction `.17`, control0 direction `.08`:

- Analytic composite-root direction `.05418268763764414`; original root derivative `E_u=−1.9626612441925317`.
- At h=`2e−7`, max error over all 166 pin-coordinate derivatives `3.0321e−7`; root-response error `8.6385e−8`.
- The legacy combined pin derivative instead differs by `.16404845823`.
- Minimum normalized chord/feature intersection determinant `.96591141887`; control rank 6.
- Actual nonlinear hull becomes `[4,3,5,3,1,0]`; semantic transition guard passes.

Other coherent chains were independently tested at the same nominal state and phase (h=`2e−7`, no belt/control motion for these three):

| q direction | Coherent chain | Max pin derivative error | Root-response error | Semantic transition |
|---|---|---:|---:|---|
| `[0,+1,+1,0]` | `[3,0]` | 0 | 0 | pass |
| `[0,−1,−.8,0]` | `[3,2,1,0]` | `3.242e−7` | `6.102e−8` | pass |
| `[0,−.1,−1,0]` | `[3,2,0]` | `3.159e−7` | `6.415e−8` | pass |

Legacy pin derivatives for the last two joint directions differ by approximately `.97949` and `.96991` respectively. At h=`2e−8`, exact-root subtraction begins to amplify the `1e−13` reference tolerance; this is a numerical floor, not evidence that a larger epsilon may hide the cusp.

`source.mjs` reconstructs the requested actual source inventory using original vehicle COM/mass/inertia, the existing kinematic body basis, and the original primitives. Body placement is `[.2,.1,−.3]`, yaw `.43`; set w=`[.2,−.1,.17]`, integrate position `.2`, then zero w. Terrain is `.03x−.02z+low`, where low is the actual transformed source-vertex minimum. Near=`.004` yields **125 candidates per side: 115 ground, 10 bearing**. These are candidate features, not a declaration that they carry load.

Use hull direction `[.11,−.07,.13,.09,−.03,.12]`, the q/belt/control direction above, exact-root source reconstruction and independent rigid rotation. The exact reported counterexample is first ground row 0:

- Material shoe 68, primitive index 2, ID `band.tread`, source feature kind 0/index 0, vertex witness.
- Frozen shoe-local point `[-.2345999926328659,−.01679999940097332,−.01973174326121807]`.
- Hull-local source point `[-.2345999926328659,−.013226406421184882,.8589581104655959]`.
- Hull-local normal `[.011602798835487295,.9998081269611984,−.015782405441604624]`.
- Legacy normal derivative `−.1158837923607157`.
- Coherent common normal derivative `−.18426018137116695`.
- Independent fixed-source derivative `−.18426019126714516`.

At h=`2e−7`, max derivative error across every same-source candidate, with both actual ground tangents and original-radius wheel/phase/root motion:

| Side | Normal | Ground longitudinal | Ground lateral |
|---|---:|---:|---:|
| `−1` | `3.779e−8` | `1.778e−7` | `3.119e−9` |
| `+1` | `3.972e−8` | `1.738e−7` | `3.536e−9` |

Both side cone and nonlinear semantic transition guards pass. The legacy source normal error is about `.0683764` on either side; the coherent source row removes that mismatch without lowering any comparison tolerance. Individual bounded probes completed in under one second. No runtime force/impulse was applied.

## Required implementation/acceptance follow-up

Keep the source consumer's rejection of uncertified per-column one-sided q maps. Certify the common chart's baseline, full joint direction, geometry domains and next nonlinear transition together. Preserve original `ξdot=R u+S adot`, `MΔu=Rᵀλ`, `Sᵀλ=0`, raw λ≥0, original reciprocal belt mass/Js, whole-side rebuilding and old-impulse reconciliation. Parent reconstruction repair is not permission to retain old chart λ, station loads or friction caps after a pivot.

Focused regressions should explicitly exercise zero-depth parents below the global floor, positive-depth raw endpoints with interior floor nodes, the nominal M56 witness above, all four neighboring coherent chains, semantic crossings/stale grids, and the unchanged regular two-sided M56 fixture. Native mirror/lockstep and real normal+friction load certification remain the implementer's work. This diagnostic note does not prove loaded complementarity, raw dual feasibility, friction limits, both-side force exchange, all-fleet corner coverage or final accepted/rendered correspondence. Production lower-graph mechanics must remain disabled until normal **and** traction are certified.
