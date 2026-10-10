# B Task 2 resumption audit — 2026-10-11

Read-only audit of `C:/Users/24908/.codex/scratch/tankforge-suspension-tracks-v7`. Runtime, tests, B spec/plan, sources, assets and commits were not edited. This note is the only write. The rangefinder equipment implementer remains the sole runtime writer until Root transfers that ownership. The former `fixed_pitch_track_task2` agent is not a live owner.

B remains unfinished and authorized: wheel inertia, fixed-pitch healthy tracks, physical broken tracks, repair/lifecycle, authority/network and final verification. Task 1 was already dual-approved. This audit does not cancel or reduce B. Use the existing [B design](../specs/2026-10-11-suspension-tracks-v7-b-design.md) and [B plan](../plans/2026-10-11-suspension-tracks-v7-b.md); do not restart the mathematical design. Root has additional mechanical-bundle architecture covering soft KKT, hard `D=0`, and friction duals.

## Current implementation versus required path

| Area | Current code | Remaining concrete work |
| --- | --- | --- |
| Lower route | `trackLowerGraph.js:newLowerGraph` and native `LowerGraph::new` initialize `enabled=false`. Production never sets true. `buildLowerGraphRoute`/`LowerGraph::build` splice exact joins, preserve the upper route, and use the trusted internal grid with height/slope controls. `configureLowerGroundIntervals`/`configure_ground_intervals` receive manually supplied intervals only. | Automatic source-feature discovery, connected terrain/bearing interval formation, deterministic minimum-deformation geometry solve with real `g>=0`, `b>=0` and closure, separate near-contact mechanical active set, bounded failure/cache diagnostics. Include the immutable lower arc prefixes in real contact coverage. |
| Sensitivities | `trackPath.js:differentiateTrackPins` and native `TrackState::differentiate_lower_pins` reuse a fixed-root batch with q, belt metres, graph columns and implicit root response. Pin-map rank filtering exists. | Six local body columns and real source gap/tangent rows; faithful branch signature including joins, route/root bounds, material features and candidate topology; same-side bounded rebuild after changes. Pin-map rank is not yet mechanical `S` rank/nullspace certification. |
| Finite wheel contacts | `wheelPrimitives.js:wheelBearingParts` and native `WheelSolidProfile::bearing_parts` expose carved convex survivors of all original parts, with IDs/materials/features. `trackFeatures.js` and `track_feature.rs` map same-material shoe/wheel points and travel-driven wheel derivatives. JS `trackConvexContact.js:convexSourceContact` provides finite SAT gap, normal, source witnesses and face indices. | Port SAT/witness logic and metadata to native, consume actual carved parts for bearing candidates/gaps/derivatives, retain stable side/material shoe/primitive/feature identity. Current SAT and point derivatives have no production callers. |
| Clearance | `trackPath.js:trackResiduals` and native `TrackState::residuals` still validate wheel slabs/sections; this is a declared conservative clearance envelope. Finite shoe terrain residuals query real primitives. | Mechanical bearing cannot use slabs. Terrain visitors must retain the actual witness/face identity rather than reduce to one scalar maximum. Preserve all three lateral terrain columns independently; max-column support may remain a seed only. |
| Healthy normal | JS `prepareTrackGuard`/`solveTrackGuard`, `suspension.js:applySuspension`, `contacts.js:applyRigidContacts`, and native counterparts still apply circle/full-chord station/fixed/predictive normal responses. | Replace healthy-track normal support with the independent massless bundle from the B spec: `xiDot=R u+S aDot`, `M deltaU=R^T lambda`, `S^T lambda=0`, raw `lambda>=0`. Do not use geometry-fit multipliers as loads. Keep bare-wheel broken support and belly independently. |
| Healthy traction | `contacts.js:trackContacts` and native `track_contacts` admit near-source shoe points, then normalize/copy station loads by longitudinal weights. Friction uses old wheel blends, subtracts `belt.v`, and applies `-dl/m_belt`. The guard measures a phase rate but applies only body/q response. | Same-bundle normal/tangent dual recovery, actual `Js`, `Js^2/m_belt` effective mass and reciprocal belt impulse. No duplicated N, no fixed `Js=-1`, no traction on unloaded slack shoes. Preserve spring calibration and total old run stiffness/damping/cap budget. |
| Freeze/acceptance | `acceptPins` stores ground, idler/sag/tightness, phase and existing `travelM`. JS `shapeInputs` and native `TrackShape` lack a lower-route height row. No signed 18-bit packing exists. Reconstruction rebuilds the default old route. | Versioned signed 18-bit three terrain rows plus internal lower-height row; explicit bit/byte order, sign extension, exact trusted counts, zero tail bits, canonical base64, bounds/byte budgets. Decode before final owner acceptance. Freeze exact joins from unchanged upper route; replay frozen ordinates and march without root/projection. Compare same material/active branch continuous mechanical shadow to decoded acceptance before accepting. |

The key production integration call chain is `tank.js:stepTank` lines 142–185 / native `tank/mod.rs:step`: guards → suspension normals → rigid run/belly contacts → copied-load track contacts → old friction → guards → position → closed-route acceptance. Replacing only route geometry leaves the old mechanical support and traction in charge.

## Fresh, bounded witnesses

The following read-only Node probe was executed from the worktree, with no file creation:

```js
import { rig } from "./client/web/test/tankrig.mjs";
import * as p from "./client/web/src/sim/tank/trackPath.js";
const r=rig("us_m56"), st=r.t.tracks[1], q=r.t.lifts[1];
const b0=p.differentiateTrackPins(st,q);
const before={enabled:st.lowerGraph.enabled,scratchEnabled:b0.scratch.lowerGraph.enabled,valid:b0.valid};
st.lowerGraph.enabled=true;
p.solveClosedTrack(st,q);
const b1=p.differentiateTrackPins(st,q);
console.log(JSON.stringify({probe:"batch-chart-toggle",before,after:{enabled:st.lowerGraph.enabled,scratchEnabled:b1.scratch.lowerGraph.enabled,valid:b1.valid,sameBatch:b0===b1,feasible:st.feasible}}));
for(const height of [0,-.001,-.002]){
  const a=p.newTrackState(st.descriptor,1);
  a.lowerGraph.enabled=true;
  a.lowerGraph.controls[0]=height;
  p.solveClosedTrack(a,q);
  const replay=p.newTrackState(st.descriptor,1);
  if(a.shapeInputs)p.reconstructTrackShape(replay,q,a.shapeInputs);
  let max=0;
  for(let i=0;i<a.pins.length;i++)max=Math.max(max,Math.abs(a.pins[i]-replay.trialPins[i]));
  console.log(JSON.stringify({probe:"frozen-configured-chart",height,ownerFeasible:a.feasible,ownerFault:a.routeFault,replayFeasible:replay.feasible,replayFault:replay.routeFault,maxPinDifference:max,shapeFields:a.shapeInputs?Object.keys(a.shapeInputs):[]}));
}
```

Exact output:

```json
{"probe":"batch-chart-toggle","before":{"enabled":false,"scratchEnabled":false,"valid":true},"after":{"enabled":true,"scratchEnabled":false,"valid":false,"sameBatch":true,"feasible":true}}
{"probe":"frozen-configured-chart","height":0,"ownerFeasible":true,"ownerFault":null,"replayFeasible":false,"replayFault":"shapeClosure","maxPinDifference":0.006341242738130359,"shapeFields":["descriptor","ground","side","idler","sag","tightness","phaseIndex","phaseFraction","travelM"]}
{"probe":"frozen-configured-chart","height":-0.001,"ownerFeasible":true,"ownerFault":null,"replayFeasible":false,"replayFault":"shapeClosure","maxPinDifference":0.006530716657297639,"shapeFields":["descriptor","ground","side","idler","sag","tightness","phaseIndex","phaseFraction","travelM"]}
{"probe":"frozen-configured-chart","height":-0.002,"ownerFeasible":true,"ownerFault":null,"replayFeasible":false,"replayFault":"shapeClosure","maxPinDifference":0.006720217738811027,"shapeFields":["descriptor","ground","side","idler","sag","tightness","phaseIndex","phaseFraction","travelM"]}
```

`differentiateTrackPins` copies `scratch.lowerGraph.enabled` only when allocating the first batch (line 1605), while native `LowerPinBatch::compute` refreshes it every call (line 367). A later chart transition therefore makes the reused JS batch invalid despite feasible source geometry. Refresh every compute and test a reused batch across chart changes.

Freeze is not merely missing transport serialization: the in-memory accepted API already cannot replay a lower graph. Even zero controls differ from the old route by 6.341 mm because the lower graph uses its different seed/join construction. The fourth decoded row is required before any production chart activation.

Current reconstruction also accepts arbitrary monotonic `ground.zs` and arrays at least as long as `count`. The new authoritative frozen format must derive coordinates/counts from the trusted descriptor/frozen joins and require exact decoded item counts; these old internal inputs are not the new protocol contract.

Focused verification executed:

```text
node --test --test-name-pattern 'lower graph uses|newly exposed|batched pin|actual pin-map|connected ground|same-material|source wheel spin|finite convex' client/web/test/track-lower-graph.test.mjs client/web/test/track-convex-contact.test.mjs
8 PASS, 0 FAIL, 370.2024 ms
```

These checks cover helper behavior only. They do not certify automatic discovery, mechanics, freeze correspondence or Task 2 completion. No native build, browser, HTTP/CDP/Playwright, heavy physics suite or performance baseline overwrite was run.

## Next bounded implementation handoff

1. After Root transfers sole runtime ownership, fix the JS reused-batch flag and tighten the shared branch signature. Add the focused toggle regression and its native parity case; retain the existing q-epsilon continuity and implicit-root tests.
2. Implement the shared four-row signed 18-bit freeze representation first. Round-trip nonzero graph ordinates plus positive/negative large finite `travelM`; reject wrong item counts, noncanonical base64, nonzero padding, overflow and byte-budget violations without changing accepted pins. Owner acceptance must consume decoded rows. Reconstruct exact interior heights with derived endpoints and no root/projection. This stage must repair the M56 probe above while the production graph remains disabled.
3. Add native SAT/witness parity and automatic true finite terrain/bearing candidate discovery using those same source features. Form connected intervals deterministically, cover retained prefixes, and attach the side-wide implicit-root derivative batch. Add minimum-deformation geometry feasibility independently of mechanical multipliers. Do not replace the real carved bearing with a radial slab, synthesize a full-pitch contact face, or silently max the result to terrain.
4. Implement healthy normal **and** traction as the approved mechanical bundle before enabling the production graph. Verify raw multiplier nonnegativity and massless equilibrium, negative q coefficients, unsupported/slack zero load, real wheel reaction, body yaw/pitch/roll, reciprocal belt power and friction-induced dual changes. Ill-conditioned/unsupported charts must diagnose and use the bounded accepted cache; the old healthy circle path is not certified as a fallback.
5. Run continuous-versus-decoded same-material/active-branch correspondence locally before widening: M56 actual static bearing, short band/cast/rubber features and lateral terrain independence, then ordinary T34/HVSS hump and the x13 explicit `groundGraph` cache/recovery case. Enforce true finite penetration <=0.5 mm and loaded rendered shoe gap <=0.75 mm. Only after the bundle passes should the known all-35 physical RED and lockstep be rerun.

Retain the caller-owned `t.travel` accumulator: `st.travelM` mirrors it; no extra integrator or inference from wrapped material phase. Cache at most three ordinary wheel-radius rotations per side as allowed by the spec. Keep imported GLB wheel contact as the explicitly declared engineering proxy and preserve protected meshes/assets. The sprocket ring/drum engagement exception does not certify the inherited 8.65–16.25 mm tooth/shoe visual overlap or permit ordinary road/idler/roller circle mechanics.

Root-reported baselines and known RED remain the previous receipts, not newly rerun here: 120 physics + 60 geometry per simulated second, Tiger/T34/HVSS/Cromwell 22.8291/22.0933/22.4922/25.2481 ms; old healthy physical fleet failures around 4.55–5.46 mm on Gepard and five VVSS/M10 sides. Coordinate any native build resource with the L agent. Root owns B spec/plan/test orchestration and exact commits.
