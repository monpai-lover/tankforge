# B Task 2 freeze boundary preparation — 2026-10-11

Read-only preparation for the existing, approved B Task 2. This note is the only write. Runtime, tests, B spec/plan, assets and build outputs were not edited; no Cargo build, browser, HTTP/CDP/Playwright, expensive fleet physics RED or performance-baseline overwrite was run. P1 remains the sole runtime writer until Root transfers ownership after fresh SPEC then QUALITY review. No further agents were spawned.

Read together with [B design](../specs/2026-10-11-suspension-tracks-v7-b-design.md), [B plan](../plans/2026-10-11-suspension-tracks-v7-b.md), [resumption audit](2026-10-11-b2-resumption-audit.md) and [architecture handoff](2026-10-11-b-architecture-handoff.md). This is a concrete preparation handoff, not a new mathematical design or a Task 2 PASS receipt. All remaining B work stays authorized: healthy normal and traction bundle, source contacts/discovery, wheel inertia, physical broken tracks, repair/lifecycle, authority/network, performance and final verification.

## First bounded implementation boundary

1. Refresh the reused JS derivative scratch's chart flag on **every** compute, with a focused transition regression. Native already refreshes the flag. Both implementations still need a faithful structural branch signature.
2. Implement the complete versioned four-row freeze/accept representation and its JS/native parity. Derive terrain counts/coordinates from the trusted descriptor, lower interior count/coordinates from that descriptor plus the exact frozen upper-route joins, and freeze absolute lower heights. Decode the encoded candidate before final owner acceptance.
3. Reconstruct frozen ordinates at the frozen q/idler/sag/tightness/phase/travel frame, then perform the fixed-chord march and independent residual checks. Frozen reconstruction must never root idler/sag, fit controls, project heights, max the graph to terrain, or overwrite the last pin to hide an open seam.

Keep production `lowerGraph.enabled` / `lower_graph.enabled` false until **both** healthy normal support and reciprocal traction have been replaced with the approved mechanical bundle. A freeze/helper PASS is not permission to activate the graph. Existing circle/full-chord normals and copied station-load traction remain production owners at present.

## Exact dependent call sites

Line numbers are from the inspected worktree and may move when P1 lands.

| Boundary | JS | Native | Dependency |
| --- | --- | --- | --- |
| Trusted terrain descriptor | `trackPath.js:155–191,256–269` | `track_path.rs:323–329` | Original outer front/rear wheels define the fixed terrain grid; effective shoe width defines three lateral columns. No packet-supplied z/x grid. |
| Continuous terrain sampling / existing rounding | `trackPath.js:440–588` | `track_path.rs:612–759` | Current profile-derived sampling matches the M56 descriptor, but the new decoder must use descriptor expectations directly, not arbitrary profile or packet counts. Preserve raw individual terrain columns for mechanics. |
| Exact lower joins, selected grid, splice | `trackLowerGraph.js:75–103,130–239` | `track_lower_graph.rs:65–86,101–223` | Build the unchanged source upper route first. Exact endpoint y/z come from source arcs; only interior node heights are transmitted. |
| Route construction / retained phase anchor | `trackPath.js:1109–1205` | `track_path.rs:1271–1376` | Frozen replay needs an ordinate mode in the lower splice, rather than calling the control-based seed and losing the fourth row. The original sprocket anchor remains in the retained upper route. |
| Fixed-chord march / residuals | `trackPath.js:1226–1322,1334–1421` | `track_path.rs:1397–1596` | March once from the frozen metadata; check raw closure and the final real shoe before terminal duplication. Existing closure root threshold is 20 µm, independently of 0.5 mm pitch / 1 mm seam limits. |
| Final solve acceptance | `trackPath.js:1543–1567,1727–1757` | `track_path.rs:1760–1787,1798–1835` | The current acceptance copies trial pins first, then saves only terrain/metadata. Insert codec decode and decoded-route/correspondence validation before any accepted-pin/cache commit. |
| Frozen replay | `trackPath.js:1760–1871` | `track_path.rs:1837–1901`; `TrackShape:410–424` | Currently no lower row; JS permits arrays longer than n and arbitrary monotonic grids. Native fixed-capacity arrays have no strict transport count/encoding contract. Decode into scratch and commit atomically. |
| Reused derivative batch | `trackPath.js:1575–1724`, especially `1605` | `track_lower_graph.rs:307–475`, especially `367` | Move JS flag refresh outside allocation. Native refreshes each call; both compare only hull order and lower node count today. |
| Owner travel and acceptance frame | `tank.js:181–185` | `tank/mod.rs:296–298` | Existing caller updates `t.travel += belt.v*h`, mirrors into the track, advances wrapped material phase, samples ground and solves. This is the only travel integrator. |
| Current remote rebuild | `tank.js:298–324`; `game/vehicle.js:140–146` | `tank/mod.rs:433–456` | These currently re-sample terrain, integrate travel at sent speed and solve a fresh route. Task 5 must route a valid frozen frame into frozen reconstruction and assign/interpolate its unwrapped travel, rather than run this old path on top. |
| Current network hint | `tank.js:253–292`; `main.js:1784–1802` | `tank/mod.rs:355–428` | Hint currently contains only q/qv. Main still omits `ns.rg`. Shape/network wiring remains Task 5; a helper round trip does not certify transport. |
| Source spin / rendering | `trackFeatures.js:43–85,93–123`; `gfx/tankmodel.js:390–413` | `track_feature.rs:70` | Ordinary wheel spin uses original r and unwrapped travel. Rendering reads accepted pins; preserve pin-driven sprocket / procedural toothed-idler rules. |

Source paths in the table are under `client/web/src/sim/tank/` or `crates/physics/src/tank/`, except the explicit JS game/gfx/main paths.

No production caller of `differentiateTrackPins` or `differentiate_lower_pins` currently exists beyond the new tests/helpers. Likewise `reconstructTrackShape` / `reconstruct_shape` are not yet the real networking reconstruction path. Do not confuse these helper surfaces with completed production mechanics or networking.

## Concrete compact encoding contract

The B specification fixes the representation constraints but does not name every wire field. The following is a precise minimal layout recommendation for the implementer; it should be mirrored literally across JS/Rust and covered by byte vectors. Keep the existing optional `rg.version=1` separate from the frozen shape's own format version.

- One versioned lower-graph shape has bounded metadata (`version`, `idler`, `sag`, `tightness`, `phaseIndex`, `phaseFraction`, `travelM`) and a canonical base64 `rows` byte stream. Side and trusted vehicle descriptor come from the enclosing `[left,right]` position/entity model, not a packet descriptor or a free side switch. q/qv keep the different existing station order: all right stations, then all left stations. Frozen shape, q, pose, phase and travel must come from one accepted frame. If diagnostic counts are carried, they must exactly equal the independently derived expectations and cannot control allocation.
- Stream order within each side: **terrain centre**, **terrain negative-x edge**, **terrain positive-x edge**, **absolute lower interior y**. Samples increase in trusted local z. This preserves current column order `[0,-groundHalfWidth,+groundHalfWidth]`; never reduce the first three rows to their maximum for finite source contact. The max row, if retained as a seed, is derived internally and is not a fifth encoded row.
- Let `nG = descriptor.groundRow.count`, and `nH` be the number of that descriptor's grid coordinates strictly inside the exact lower joins. Require exactly `3*nG+nH` signed integers and exactly `ceil(18*(3*nG+nH)/8)` decoded bytes. Rows are concatenated without byte alignment or row padding; the only padding is the unused high bits of the final byte, all zero. No omitted fourth row, no extra items/bytes, and no data after the expected payload.
- Quantize with the already shared rule `Q(y)=floor(y/0.00025+0.5)` (half ties toward positive infinity), then decode as `Q*0.00025`. Do not substitute JS `Math.round` / Rust `round` without proving the negative-half tie behavior. Validate finite input and the signed integer range **before** any bit conversion or unsigned cast.
- Signed 18-bit two's complement has the raw integer range `[-131072,131071]`, corresponding to `[-32.768,32.76775]` m at this step. The application's existing height bound is narrower: encode/decode must require q in `[-128000,127999]`, yielding `[-32,31.99975]` m. Positive +32 m is representable in signed18 but outside this application bound and must be rejected, not clamped/wrapped. Also reject an input below +32 m if rounding reaches q=128000. No saturation.
- Integer bit 0 is first. Stream bit j is stored in byte `floor(j/8)`, bit `j%8` (least significant bit first; increasing byte order). Encode `u = q<0 ? q+262144 : q`, append its 18 low bits. Decode 18 bits to u, then sign-extend with `q = u>=131072 ? u-262144 : u`. Use bounded accumulators, not a JS bitwise shift whose width grows beyond 31 bits.
- Useful raw bit-packing vectors: `[1] → 01 00 00`; `[-1] → ff ff 03`; `[-131072] → 00 00 02`; `[131071] → ff ff 01`; `[1,-1] → 01 00 fc ff 0f`. The two raw integer extrema are outside the application's height bound and must be rejected by its codec; they only explain signed18 sign extension. The trailing unused bits must remain zero. A vector crossing row boundaries is required because there is no per-row byte padding.
- Require standard RFC 4648 base64 alphabet and the exact required `=` padding; disallow whitespace, URL-safe variants, omitted/extra padding and nonzero base64 pad bits. Check bounded input length before decoding; re-encode the resulting expected bytes and require an exact string match. Browser and Rust decoders may otherwise accept noncanonical strings.
- Two sides, four rows, at most 256 integers per row produce at most 4608 packed bytes / 6144 base64 characters. Enforce the **serialized UTF-8 shape-pair budget including metadata** ≤8192 bytes, not merely the decoded binary size. Preserve the later `rg≤32768` and frame≤65536 raw-byte gates. A 3-byte-per-height format produces 8192 base64 characters before metadata and is unsuitable.
- Metadata validation remains exact: trusted q count and finite/bounded q; idler within original travel, sag `[0,0.3]`, tightness integer `-1/0/+1`, phase index integer in `[0,N)`, phase fraction finite in `[0,1)`, travel finite f64 with `|travelM|≤2^32`. Do not modulo malformed phase indices into validity. Preserve travel as f64/JSON number rather than f32 or wrapped angle.

A present new frozen lower-graph shape must have all three terrain rows and the fourth height row. Legacy/no-hint/canonical-static fallback is a separately diagnosed path; it must not turn an incomplete new shape into a supposedly accepted lower graph. Existing internal CPU tests that use `ground.count=0` need a declared no-terrain/canonical setup or a complete synthetic trusted terrain row for new-format tests, not a zero-count protocol exception.

## Bind row four to trusted endpoints

Use the same deterministic join operation on both ends:

1. Validate the enclosing model, q and frozen metadata. Construct the original source circles/upper roof/hang/sprocket route using q, frozen idler/sag/tightness and the graph seed's unified `c.r` rule. Derivation must be independent of a previous accepted chart's warmed topology cache. Do not root or apply terrain projection. Rebuilding the deterministic retained upper geometry from frozen inputs is allowed; refitting its inputs is not.
2. Derive left/right source arc identity and angles with the existing join rule: the π/0 exterior normal shifted downward by `1.25 * 2*asin(pitch/(2*r))`, lifted into the source arc's angle interval, deterministic extreme-z choice. Retain the source arc centres/radii and phase anchor. Endpoints are analytic arc points, not quantized wire nodes.
3. Define `G[k]=start+(end-start)*k/(nG-1)` from the trusted descriptor. Select the ordered indices K satisfying `lo+1e-10 < G[k] < hi-1e-10`, exactly matching the splice. `nH=|K|`; new graph coordinates are `[lo, G[K...], hi]`. Row four contains y for **only K**, not deltas from the seed, controls, endpoint samples, arbitrary coordinates or material pin IDs. Endpoint heights are copied directly from the source joins.
4. Require the exact stream length derived from nG/nH. Populate `[leftJoinY, decodedLowerHeights..., rightJoinY]`; append those segments to the unchanged retained upper route; find the retained original phase anchor; march at the frozen phase. Verify independent raw closure/pitch/wheel/terrain residuals before accepting. Do not fall back to newly inferred controls.

For the inspected M56 fixture, `nG=162` over `[-2.012,1.9944000000000002]`, graph node count is 164, and `nH=162`. This is a useful full-row/count fixture: graph node count and height payload count differ by two.

The existing graph scratch allows 256 total nodes and errors when trying to add a 255th interior slot. A descriptor with all 256 grid points inside the joins would need 258 total nodes. Do not silently truncate/downsample wire rows, change their trusted count, or omit endpoints to fit scratch. Explicitly preserve/diagnose the capacity contract and resolve it under the existing B limits before claiming full-fleet acceptance; M56 does not exercise that pressure case.

## Acceptance ordering and cache rules

The owner must consume the same codec bytes as replay: continuous candidate → encode all rows → strict decode into candidate scratch → reconstruct exact frozen route → march/residuals → compare continuous mechanical shadow with decoded accepted route at the same material features/branch → atomic accepted-pin/shape/cache commit. Validate encoded/decode sizes and metadata before mutating accepted state. Failures keep the last accepted pins, shape, material mapping, travel frame and cache receipt consistent; speculative trial/sampler/phase fields must not partially poison the accepted cache.

Quantizing row four changes route length. The continuous root's frozen idler/sag may therefore fail the existing 20 µm root gate after decoding. This is a real acceptance constraint, not license to re-root frozen replay or widen tolerances. The owner may generate a new bounded quantization-aware candidate **before final freeze/acceptance**, freeze its final metadata, and re-check continuous correspondence; replay is march-only. Add an explicit quantization-closure fixture so a post-accept encode cannot disguise this issue.

Mechanics uses continuous terrain/geometry and its continuous derivative baseline. `shoeSourceDerivative` currently reads `st.trialPins` while using a batch matrix made from that baseline. Overwriting trial pins with the decoded acceptance route and then reusing the continuous batch would mix baselines. Keep continuous mechanical shadow and decoded acceptance scratch distinct, or rebuild a deliberately compatible continuous batch; never differentiate quantized accepted pins/history to obtain velocity.

The final Stage2c correspondence gate must compare stable side/material shoe/solid/feature and source wheel-part identity plus active branch, not just two independent residual PASSes or pin-array closeness. Check true finite penetration ≤0.5 mm and every loaded rendered shoe's actual world gap ≤0.75 mm. Before Stage2b2 provides real load duals, the first freeze boundary can prove exact round trips and finite residuals but cannot claim the loaded-contact correspondence gate complete.

## Minimal RED fixtures for the first boundary

Add focused tests after ownership transfer; do not run the old full-35 physics RED to establish this boundary.

1. **Reused flag transition:** actual M56 track; compute once with graph false; set true and solve; compute again; require same batch object, refreshed scratch flag and valid finite derivatives matching a fresh graph batch. Also exercise true→false. Native parity test should preserve reused batch allocation and validate both transitions even though its flag code already refreshes.
2. **Full nonzero-height freeze:** actual M56 with nonzero control (e.g. `controls[0]=-0.001`), complete three descriptor terrain rows and both signs of `2^30+123.456` travel; round-trip four rows, exact analytic endpoints and material phase, with no root/projection. Independently verify all chords/raw seam and accepted finite residuals. Compare replay with the **decoded accepted owner**, not the pre-quantized candidate.
3. **Counts/identity:** exact nG/nH accepted; nG±1, nH±1, extra byte/item, forged descriptor/side/grid coordinates, out-of-range phase index, omitted height row and wrong version rejected before accepted state changes. In-memory capacity arrays are not permission for extra wire items. A trusted nG=162 case carrying three samples plus a trailing NaN currently exposes the weakness.
4. **Codec:** signed extrema, ±0.125 mm half ties, all three distinguishable lateral rows, cross-row bit boundary, negative sign extension, nonzero terminal bits, canonical/noncanonical base64 variants, pre-decode byte/JSON budget, positive +32 m and rounding overflow; JS/Rust identical golden bytes. Decode failure must preserve accepted pins and shape/travel receipt.
5. **Freeze semantics:** deliberately perturb replay scratch controls to large finite values; valid frozen heights must win exactly. Replay counters show no solver/root evaluations. Endpoint samples cannot be supplied or quantized. Alter a frozen height enough to break closure and require rejection/cache preservation rather than root/project repair.
6. **Continuous/decoded split:** a candidate near a 0.25 mm transition must use decoded owner pins for replay while retaining continuous point velocity. No quantization-step energy or mixed-baseline derivative. Full loaded-dual tests remain Stage2b2/2c.

Native tests belong beside existing focused lower-graph/frozen cases in `crates/physics/src/tank/tests.rs` (lower derivatives around 18–130, frozen travel 421, malformed columns 466, quantized owner 492, frozen replay/history 595). Coordinate a later native build with Root/L; none was run here.

## Fresh bounded evidence

An in-memory read-only Node probe imported the real M56 rig and existing path APIs. It did not create a test/runtime file or step fleet physics. Exact outputs:

```json
{"probe":"batch-reuse-toggle","before":{"source":false,"scratch":false,"valid":true},"after":{"source":true,"scratch":false,"valid":false,"sameBatch":true,"sourceFeasible":true}}
{"probe":"missing-height-row","height":-0.001,"ownerFeasible":true,"replayFeasible":false,"replayFault":"shapeClosure","maxPinDifference":0.006530716657297639,"travelExact":true,"lowerCount":164,"groundCount":0,"shapeFields":["descriptor","ground","side","idler","sag","tightness","phaseIndex","phaseFraction","travelM"]}
{"probe":"missing-height-row","height":-0.002,"ownerFeasible":true,"replayFeasible":false,"replayFault":"shapeClosure","maxPinDifference":0.006720217738811027,"travelExact":true,"lowerCount":164,"groundCount":0,"shapeFields":["descriptor","ground","side","idler","sag","tightness","phaseIndex","phaseFraction","travelM"]}
{"probe":"wrong-trusted-count-plus-trailing-NaN","trustedCount":162,"packetCount":3,"packetLength":4,"feasible":true,"fault":null}
{"probe":"ground-grid-descriptor-parity","descriptor":{"start":-2.012,"end":1.9944000000000002,"count":162,"spacing":0.025},"inputCount":162,"inputStart":-2.012,"inputEnd":1.9944000000000002}
```

Probe procedure: compute `differentiateTrackPins` before/after toggling the same track's flag; separately solve two new graph-enabled states at controls −1/−2 mm with large positive/negative travel and call existing frozen replay; separately give a canonical old-route shape a forged ground row (`count:3`, `zs:[-1,0,1]`, all first three heights −2 m, three column arrays each ending in NaN). The forged row was accepted despite the trusted 162-item expectation. Its permissive legacy acceptance is not a valid new-format contract.

Existing focused checks were also run:

```text
node --test --test-name-pattern 'lower graph uses|batched pin|actual pin-map|connected ground|source wheel spin|accepted geometry reconstructs|owner consumes uniformly|frozen replay rejects malformed' client/web/test/track-lower-graph.test.mjs client/web/test/fixed-pitch-track.test.mjs
8 PASS / 0 FAIL, 3207.9784 ms
```

Those tests cover current helpers and old default-route freeze; they omit the transition and configured-chart failure above. No new Task 2 completion or native parity claim follows.

## Architectural risks to preserve in the handoff

- **Branch/cache:** current JS/native derivative branch comparison checks hull owner ordering and graph count only. Same count can select different trusted grid indices or join arcs. Structural identity needs source join owners, selected grid indices, retained anchor/march intersection branch, root branch and active bounds, connected source intervals/control identity, and actual material primitive/feature candidate topology. Compare identities/branch choices rather than exact floating coordinates that should vary within a chart. Rebuild the entire side with bounded same-branch one-sided differences on changes; do not reuse stale root slopes, load duals or generalized impulses against a new chart/J.
- **Native parity:** native already refreshes the graph flag but still lacks row four, codec and production source SAT/witness consumers. Share integer rounding, LSB stream packing, sign extension, canonical base64, exact counts, endpoint selection/tie rules and residual diagnostics. Rust `round` differs from the existing floor-plus-half rule at negative ties. Raw optional-field isolation in `tank/mod.rs:377–382` must survive Task 5 so bad hints retain legal legacy motion.
- **Travel ownership:** retain `t.travel`; `st.travelM` is its same-frame mirror. Do not add a second integrator, reconstruct travel from wrapped material phase, or quantize it into a float32 wheel angle. Remote interpolation later consumes unwrapped travel first and computes original-radius modulo rotations. At most three ordinary radius rotation caches per side; keep the existing reciprocal +δs/r wheel and −δs/p shoe derivatives.
- **Finite lateral/source geometry:** the three packed terrain columns are independent inputs, not proof of arbitrary lateral terrain or bearing geometry. Keep actual continuous finite solid witnesses and the carved wheel parts in independent residual/correspondence checks. SAT gap/source metadata native parity and automatic candidate discovery remain outstanding B work.
- **Production gating:** old station/circle normals and copied-load friction cannot serve as the certified healthy graph fallback. Preserve bare-wheel broken support and belly independently, fixed old stiffness/damping/cap budgets, raw λ≥0 and massless equilibrium. Complete both normal and traction before graph activation; retain explicit `groundGraph` x13 failure/cache recovery. No source/GLB/dimension/vehicle calibration edits or additional deployment are authorized by this note.
