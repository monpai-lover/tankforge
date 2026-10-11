# B2 first freeze checkpoint — independent Root receipt

2026-10-11, `codex/suspension-tracks-v7`, documentation HEAD `05070de`.
Runtime changes remain uncommitted. This certifies focused helper checks only;
full B2 source contact, mechanics, correspondence, fleet and dual review remain
required. Production lower graphs remain disabled.

## Fresh checks

- `node --test client/web/test/track-shape.test.mjs client/web/test/track-lower-graph.test.mjs`: 15 PASS, 0 FAIL, exit 0.
- Serial native `tg-physics` groups `fixed_track_lower_graph_`, `fixed_track_compact_`, `signed18_`, `fixed_track_frozen_`, and `fixed_track_owner_ground_is_quantized_before_acceptance`: 5 + 2 + 2 + 2 + 1 = 12 PASS, 0 FAIL, exit 0. Root then released native build ownership to the sole implementer.
- An independent arithmetic bit-stream reference, using powers and division rather than the production bit shifts, matched 300 deterministically seeded four-row cases / 152571 heights. Exact round trips, nonzero terminal bits, raw signed18 extrema outside the narrower application range, and application-bound overflows were checked. Exit 0.
- `git diff --check`: exit 0. No native release/WASM build, browser, old heavy fleet physics, or baseline-overwriting performance run occurred.

## Multiphase finding retained as RED

External fixture: `C:/Users/24908/.codex/scratch/tankforge-root-b2-freeze-probe.mjs`.
Actual M56, initial lower control 0 or -1mm, 16 material phases each, three
distinct complete terrain rows below the vehicle, and unwrapped travel
`-(2^30+123.456)` metres. Of 32 cases, 31 accepted and reconstructed exactly
from decoded owner pins with one march / zero root evaluations. Their real
chords passed the unchanged 0.5mm bound; maximum continuous closure was
19.71684565µm, decoded closure 19.83645658µm, and bounded search 24 of 32.

One continuous candidate, control0 / phase0.125, was rejected before encoding:
4.13778nm raw closure, zero terrain residual, old radial/slab wheel clearance
0.5020746696mm. The retained `rootError=5.9215µm` is the previous cached root,
not that rejected candidate's actual continuous error. The fixture keeps a
hard FAIL / exit 1 until final geometry acceptance addresses this case.

A separate actual-source SAT diagnostic of that candidate used nearby wheel
parts (radius + 0.12m screening), original finite shoes, and carved bearing
parts. Across 3495 screened pairs, the minimum gap was **positive**
0.36245695mm: idler / steel_dish part0 component0 / shoe42 / band.crossbar,
with a valid common surface witness. No pair with gap <=0.5mm lacked a witness.
This indicates a possible old circular-proxy false rejection, not permission
to change wheel dimensions or tolerance. The screening is not a final
exhaustive or loaded-contact certificate. Stage2b1 must use actual finite
source residuals; Stage2b2/2c must still prove loads and decoded correspondence.

## Checkpoint source identities

SHA-256 captured after focused verification; later B2 edits require fresh checks.

| File | SHA-256 |
|---|---|
| JS `trackShape.js` | `CBFBBDAE3D06701107D29141A9E9DC9D7AE99A052B13A272F6B58C06D5B4041F` |
| JS `trackPath.js` | `CF54B870809C842EEF2ED6FA9065C0C67646422258C0C23A8614844EBA441DFE` |
| JS `trackLowerGraph.js` | `9976AC3AC505E0EFFBCD2031205EBF03882512D4AB47FB92FA1AF00629B1FE9A` |
| Rust `track_shape.rs` | `154BB3D3D8E489300D99BDB8660FB641FC34E6238BC56F1F9F2071273D535800` |
| Rust `track_path.rs` | `4FC07DE21C3489B1DEB79595383070CD1C92F1A82F5AD9CB65B2EBCC96AAFCBD` |
| Rust `track_lower_graph.rs` | `AAF63FBF250A8E7AE78D89F86AACA068CEC492E5B73F416CDBDA409C8610D419` |

Physical support/traction, broken chains, W/X, P2–P5, lethal incoming replay,
reference camera, final review and publication are not certified here.

## Subsequent moving-worktree fleet diagnostic

After the first checkpoint, the implementer began connecting finite bearing
residuals. Root ran a separate static-route probe at
`C:/Users/24908/.codex/scratch/tankforge-root-b2-fleet-freeze-probe.mjs`:
35 real tracked descriptors × both sides × phases 0/.25/.5/.75 = 280 cases,
initial control0=-1mm, complete underground terrain rows, and positive/negative
large unwrapped travel. No vehicle dynamics were stepped. This diagnosis is
not covered by the earlier checkpoint hashes.

250 accepted routes reconstructed exactly. 30 remained RED / exit1:
22 closure/chart failures across Panther, Gepard, Pzjg1, TigerE and VVSS families,
and 8 M56 continuous finite-clearance failures (approximately 3.0–4.1mm) for
the deliberately lowered control. Flakpz38t phase.25 rejected its derivative
chart before search; other closure failures exhausted 32 attempts. Successful
routes had maximum continuous closure 19.877331µm / decoded 19.996764µm.
The sole implementer received the full reproducible fixture. Geometry
preparation and quantization search must address these within the original
source, chart and tolerance constraints before full B2 acceptance.

## Stage2b1 trial-frame and finite-source helper follow-up

Root independently reproduced a stale frame before the fix: M56 side-1,
accepted idler=0.0041296328m, a newly built route at idler0.02m. The route's
idler circle z was -1.828m while its finite wheel frame returned
-1.8438703672m (15.870367mm error). External fixture:
`C:/Users/24908/.codex/scratch/tankforge-root-trial-wheel-frame-probe.mjs`.
After the original implementer's JS/native fix, both sides have exact zero
frame error without prematurely committing the scalar.

Fresh Node suite (`track-shape`, `track-lower-graph`, `track-convex-contact`,
`track-finite-discovery`): 19 PASS / 0 FAIL / exit0. Serial native trial-frame1,
finite-SAT1, terrain-source-visitor1, lower-graph6, compact2:
11 PASS / 0 FAIL / exit0. Native build resources were then returned to the
sole implementer. The independent M56 32-case probe now fully passes:
max continuous19.71684565µm / decoded19.83645658µm, search <=24, exact replay.

The same 280-case fleet probe improved to258 accepted /22 rejected /exit1:
all8 M56 finite-clearance errors disappeared; closure/chart failures remain.
Source part AABBs are only a conservative screening step, and source SAT and
source terrain coordinates are now connected helper surfaces. Automatic
candidate/interval discovery, minimum-deformation preparation, shared normal
and reciprocal traction bundles, full loaded correspondence, activation and
the final B2 SPEC/QUALITY reviews are still pending.

## Geometry preparation and coarse freeze — fresh independent Root follow-up

Root reran the unchanged external 35-descriptor / two-side / four-phase static
fixture after the bounded coarse candidate search. Result: **280 accepted / 0
failures / exit0**, maximum search36, continuous closure19.8773310718µm and
decoded closure19.9967644701µm. Every accepted shape replayed byte-identical
pins and exact unwrapped travel with one march and zero root evaluations.
The previous22 closure failures are therefore resolved in this static fixture.

Fresh Node `track-shape`, `track-lower-graph`, `track-convex-contact`,
`track-finite-discovery` and `track-geometry`: **30 PASS /0 FAIL /exit0**.
Fresh serial native `source_inventory_`, `minimum_deformation_`,
`fixed_track_compact_` and `fixed_track_lower_graph_`: **5+3+3+8=19 PASS /0
FAIL /exit0**. Native build ownership was returned to the sole implementer
after completion. No release/WASM build, browser or vehicle dynamics fleet
run occurred.

These checks cover isolated continuous preparation, finite-source inventory,
rank/geometry certificate separation, malformed inputs, narrow-hump success,
explicit wider-hump KKT rejection, owner preservation and bounded freeze.
They do **not** certify the rejected wider hump as infeasible. The minimum
deformation helper remains isolated scratch with candidate legacy feasible
false. Owner integration, final-chart derivatives, coherent directional
mechanics, shared-hull normal/reciprocal traction, loaded correspondence and
production activation remain required; B2 is unfinished.
