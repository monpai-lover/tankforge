# V3 replay source map — Task 2A pure director component

Date: 2026-10-12. Preparation worktree: `C:/Users/24908/.codex/scratch/tankforge-v3-pure-director-20261012`, branch `codex/v3-pure-director`, baseline `283978f636cf406c508e9c07333e178840ec2252`.

This note covers only approved plan Task 2.1/2.2 and their applicable Task 2.6 source notice. These are dormant reusable clock/camera components awaiting Root's fresh SPEC then QUALITY review. **There is no active V3 cutover, no completed Task 2, and no integrated fatal/session/sampler/renderer/blast claim.** The main/NetClient/combat/renderer/HitCam paths, original data/models and native/WASM sources/assets are unchanged. Causal Task 1 and the remaining Task 2 body/sampler work remain separate dependencies.

## Source and exact notice

The user-owned source archive SHA-256 is `5f24750268724a1cb11424f5be1753bf496661a5d47e8113aee3ba80f815d1ce`. The inspected source root is `C:/Users/24908/.codex/scratch/tankforge-hit-replay-v3-reference-20261011/hit_replay_webgl_wasm_v3`. This is the V3 archive, not TracksV7.

| Source file | SHA-256 |
| --- | --- |
| `src/runtime.js` | `91e27db6012a4b6d9f15222e074932c0ba1706020e4b2ea5151194e31f370c43` |
| `src/gl.js` | `663da09d113db17dc3c07f5f2ba1a3ee53ef951b3c27bc9a3166345e0872268d` |
| `LICENSE` | `abcf324daa606d1797518f51b40d1629728c02184ca5ca4fe0bbd07429da3081` |

`docs/third-party/hit-replay-v3-LICENSE.txt` is the complete byte-for-byte supplied MIT LICENSE, including **Copyright (c) 2026 Replay Lab Contributors** and its final third-party video/game exclusions. Its SHA-256 equals the source LICENSE above. No permission condition was added.

## Whole-function port and adaptation map

| Source lines/functions | Destination | Preserved source and explicit adaptation |
| --- | --- | --- |
| `runtime.js:54–56`, `directorKnots`, `transfer`; `gl.js:4`, `mix` | `client/web/src/game/replayClock.js:6`, `:20` | All eight canonical knots, linear interpolation, inverse axes and unit-slope tail remain. The explicit knot argument removes the captured demo global. Strict finite/monotone validation reads every outer entry and both indexed coordinates, rejecting sparse holes. Absolute physical origin, deep immutable snapshots and append-only future anchors are component additions. Already-played extrapolation retains its original expression/snapshot so a new collinear knot cannot change floating-point rounding in the played prefix. |
| `runtime.js:59`, `fitCamera`; `gl.js:3–6`, `clamp/mix/smooth/V` | `client/web/src/game/replayCamera.js:7–37` | Complete source portrait formula `aspect < 1.05`, multiplier `min(2.55,1.13/aspect)`, unchanged target/FOV. Retained source easing and vector operations take explicit module inputs. R1 guards add finite positive Float32-representable aspect validation; normal source norm math stays exact, with max-component scaling only when a finite vector's norm overflows. Q3 validates every required vector3/rect4 coordinate with indexed reads before fitting or selecting a camera branch. |
| `runtime.js:60–78`, `camera` | `client/web/src/game/replayCamera.js:117–145` | Whole reusable manual branch, heavy/non-heavy chase distance, projectile-leading target, source-side offset, source orbit and side-entry branch, target interpolation, cut interpolation, short contact bump and 48°→43°/43° FOV remain. The demo external gameplay camera (`mode==='hit'`) is excluded: this pure owner only returns a replay camera; ordinary hits continue to use the existing live battle camera at the later integration seam. The captured `state/event` become explicit `context`; `projectilePos(t)` is replaced by an actual recorded frame nose/tangent. Only source offsets use B; measured frozen hull center/scale and TankForge LH matrices replace source fixed vehicle framing/RH matrices. Unknown flight returns one static explanatory orbit without approach. |
| `runtime.js:79–84`, `hitCamera` | `client/web/src/game/replayCamera.js:147–154` | Whole tighter inset target, source side, −4.6 direction, +2.4 side, +2.45 height and 38° FOV remain. Explicit discrepancy: source `hitCamera` does **not** call `fitCamera`; the approved plan adds the same source portrait fit to the inset. Normal-aspect inset has direct source parity; portrait is tested as this documented adaptation. |
| `gl.js:10–12`, source RH view/projection usage | existing `gfx/math.js:84`, `:141`, consumed by `replayCamera.js:57–72`, `:86–114` | Existing TankForge `perspective` and `lookAtLH` are the sole matrix owners. Frozen hull radius/distance supply near/far; static framing fits actual hull corners. R1 adds an alternate +Z up reference for zenith/nadir, without changing eye/target, and checks double/Float32 orthonormal bases and finite nonzero converted perspective scales. No copy of the demo renderer or camera state is made. |
| `scene.js:29–35`, source bare section bounds | `replayCamera.js:39–47` framing calibration | Source hull length 4.34 m and width 1.70 m calibrate source display offsets. Source director target height is 1.05 m; 2.10 m is its vertical framing normalization, not an invented hull dimension written into physics/data. Every actual input hull center/extent comes from the caller's frozen accepted hull bounds, excluding gun/barrel overhang; the component never derives cabin/collision geometry or changes target shape. |
| `runtime.js:58`, `projectilePos`; camera functions above | `client/web/test/replay-camera.test.mjs` SOURCE oracle only | The exact source runtime director block and exact `gl.js` vector/easing helpers are evaluated in a Node VM with canonical source globals. Its fixed 14 m approach exists only in the independent SOURCE oracle/fixture adapter. Production modules contain no generated approach/trajectory. |

## Public component contracts and remaining adapter

`transfer(knots, time, reverse=false)` and `createReplayClock(knots=directorKnots)` expose the planned `.knots`, `.markPlayed(filmS)`, `.appendPhysicalAnchors(times)`, `.physicalAt(filmS)` and `.filmAt(physicalS)` API. Appended times are validated atomically, sorted/deduplicated, and admitted only above the latest physical knot and played physical boundary. Equal/late anchors do not create zero spans, change the prefix or rewind the cursor. New published knots are immutable snapshots. There is no second life/event/session identity owner.

`createReplayClockForEvent(preparedEvent)` and `replayDirectorPhase(preparedEvent, physicalS)` use:

```js
{ launch_s, contact_s, mechanism_anchors: [{time_s, phase_s}] }
```

`launch_s`, `contact_s` and each `time_s` are actual recorded physical seconds. `phase_s` is explicitly a **canonical V3 presentation easing coordinate**, never physical truth or damage/charge time. The only later evidence adapter is `evidence.launch_time_s → PreparedEvent.launch_s`, `evidence.impact_time_s → PreparedEvent.contact_s`, plus actual timed mechanism records into ordered mechanism anchors. Task 2.5's owner must bind those real records and their explicit easing phases; it must not infer an event because source APHE phase 2.48 exists. Unknown future mechanisms are not manufactured: phase clamps at the last known anchor. Simultaneous actual anchors collapse to the latest easing stage at that physical instant, preserving strictly positive clock spans. Unknown/unvalidated launch/contact timing cannot create an event clock.

The event clock retains the sorted phase union of **all accepted event anchors and all source knots within the known phase interval**. An intermediate accepted easing phase need not equal a fixed source knot: its recorded physical time remains an explicit clock breakpoint, and `physicalAt`/`filmAt` compose with `replayDirectorPhase` at that record. This preserves record-time slope changes without adding a physical event or changing the canonical source curve. The clock's knot/snapshot retention is currently uncapped; repeated played-tail appends retain immutable full snapshots. This pure component does not certify continuous-session memory budgets. The later session owner must bound its admitted clock/event lifetime and account for retained history before integration.

`camera(physicalS, rect, context)` and `hitCamera(physicalS, rect, context)` accept `[x,y,width,height]` and:

```js
{
  event: {launch_s, contact_s, mechanism_anchors, entry, direction},
  frame: {projectile: {nose, tangent, timing: 'recorded'}}, // optional; otherwise unknown
  hullBounds: {min, max}, // frozen accepted hull only, gun overhang excluded
  heavy, sideEntry, manual: {yaw, pitch, zoom} // optional presentation choices
}
```

All production `entry`, `direction`, `nose`, `tangent` and hull-bound coordinates are **already TankForge session coordinates**. They bypass B and R. The returned pose includes source FOV in degrees, eye/target, existing LH `view`, `proj`/`viewProj`, basis, measured `hullScale`, near/far, `flightTiming` and the unchanged copied `projectileNose`. Recorded tangent determines chase orientation; accepted contact/direction determines inset framing. Missing/unknown projectile timing never uses the source demo approach or old HitCam. Bounds-only SOURCE calibration fixtures create no proxy tank and perform no rendering.

`v3CameraOffsetToTank([x,y,z])=[z,y,x]` is B (det −1), used once for source camera offsets. Source side in TankForge space is `-cross(direction,up)` because reflection reverses cross order. `v3ProjectileToTank([x,y,z])=[-z,y,x]` is R (det +1), exposed for the later shared geometry owner only. Production report points are never fed through either conversion. Tests cover positive R winding/cross products, reversed B cross order, opposite/cross-axis actual tangents, translated world anchors and existing LH projection. Recorded positions/tangents are not moved to a generated source path.

The R1 camera validity contract applies before a pose is published: input viewport dimensions must be finite and positive, and their ratio must remain finite, positive and nonzero after Float32 conversion. Actual Float32 perspective coefficients must remain finite with positive horizontal/vertical scale and nonzero depth coefficient. Inputs that cannot satisfy those bounds throw `RangeError`; huge/tiny dimensions with a normal representable ratio are valid for this pure aspect calculation. The future renderer keeps ownership of physical viewport allocation limits. Recorded tangents must be finite and have magnitude above the existing `1e-10` guard. If `Math.hypot` overflows on their finite components, max-component normalization preserves direction instead of turning the tangent into zero; the input/report vectors are never mutated. For a valid zenith/nadir view whose forward is parallel to +Y within `1e-8`, `lookAtLH` receives +Z as its alternate up reference, preserving the original eye/target/FOV. Published double and converted Float32 view bases must have unit axes, orthogonal pairs and positive determinant within `1e-6`. Nonrepresentable matrices/clip ranges reject. These pure calls acquire no replay/GPU resources; the later owner must perform its camera validation before resource acquisition.

Required vector3, rectangle4 and appended-time arrays use indexed validation throughout: sparse holes and explicit undefined reject identically. The shared recorded nose/tangent check runs before full/manual/inset branch selection; hull min/max checks are shared as well. Every rectangle origin/dimension is checked before source portrait fitting can mutate its local pose. Every appended time is validated before the no-future shortcut, protected-tail capture or snapshot publication. Invalid mixed batches preserve published snapshot identity, immutable contents, exact played forward/inverse expressions and the cursor. Empty dense append arrays remain valid no-ops. Optional event entry/direction retain their documented finite-vector fallback behavior; this guard repair adds no new trajectory or physical evidence.

## Evidence and limits

All logs are retained in ignored `target/v3-director-evidence/` in this worktree. Actual commands:

```text
node --test client/web/test/projectile-replay.test.mjs client/web/test/design-replay.test.mjs client/web/test/replay-pose.test.mjs
node --test client/web/test/replay-clock.test.mjs client/web/test/replay-camera.test.mjs
node --test client/web/test/replay-camera.test.mjs
node --test client/web/test/replay-clock.test.mjs client/web/test/replay-camera.test.mjs client/web/test/projectile-replay.test.mjs client/web/test/design-replay.test.mjs
node --test --test-name-pattern 'translated zenith|overflowing finite recorded|unrepresentable finite viewport' client/web/test/replay-camera.test.mjs
node target/v3-director-evidence/spec-r1-probes.mjs
node --test --test-name-pattern 'intermediate mechanism|sparse knot' client/web/test/replay-clock.test.mjs
node target/v3-director-evidence/quality-probes.mjs
git diff --check
```

Baseline: 30/30 existing tests passed before edits (`baseline.txt`). Existing pose tests evaluated the committed baseline `tg_design.wasm` in Node CPU; no Cargo/WASM build, copy or source change ran, and this baseline is not evidence of new V3 integration. Missing-module RED: two expected `ERR_MODULE_NOT_FOUND` failures (`red-missing-module.txt`). A later unsafe finite-pose RED showed the missing rejection (`red-invalid-pose.txt`). Initial focused GREEN was 15/15 and initial combined pure suite 31/31 (`green-focused.txt`, `green-combined.txt`), both with zero skips. Fresh SPEC then found R1: finite inputs could still publish a zero view basis, erased tangent or collapsed projection. That rejected candidate's complete six files, hashes, review, probes and existing receipts are preserved under `failed-candidate-spec-r1-20261012/`; passing initial tests did not prove those guards.

R1 repair RED (`red-spec-r1-guards.txt`) reproduced all three failures through production APIs, with 0 PASS/3 FAIL. Each fix then passed its own production regression (`green-spec-r1-zenith.txt`, `green-spec-r1-tangent.txt`, `green-spec-r1-aspect.txt`). Repaired focused suite: **18/18, zero skips**, `green-spec-r1-focused.txt`. Repeated appropriate existing replay suite: **30/30, zero skips**, `green-spec-r1-impacted.txt`; its committed baseline WASM CPU use is preservation evidence only. Exact source parity remains unchanged and its VM oracle ran without skips. `spec-r1-production-probes.txt` records actual published unit bases/determinants at translations 100 and 1e6, preserved MAX_VALUE tangent direction/nose, rejected overflow/underflow aspects and valid huge/tiny dimension ratios. This is a writer repair receipt awaiting fresh independent SPEC re-review; it does not turn the prior blocked verdict into a PASS or advance to QUALITY.

The subsequent independent QUALITY review accepted the R1 camera repair but requested changes for Q1 (omitted noncanonical intermediate mechanism breakpoints) and Q2 (sparse knot coordinates escaping `Array.some` validation). That reviewed candidate's six files and complete top-level evidence were preserved before edits under `failed-candidate-quality-q1-q2-20261012/`. The formal reviewer reports were not edited during this repair. True production RED (`red-quality-q1-q2-clock.txt`): **0 PASS/2 FAIL**; the mechanism example returned14.34989010989011 instead of15 and the sparse pair was accepted. Targeted GREEN (`green-quality-q1-q2-clock.txt`): **2/2**. Repaired focused suite (`green-quality-q1-q2-focused.txt`): **20/20, zero skips**, including the unchanged actual V3 camera/transfer oracle and R1 guards. Existing impacted suite (`green-quality-q1-q2-impacted.txt`): **30/30, zero skips**, using only committed baseline WASM CPU evaluation. The unchanged reviewer production-probe script was rerun to the separate writer receipt `writer-quality-q1-q2-production-probes.txt`: **45 PASS/0 defects**, exit0. Its independent phase2 witness now yields physical15, inverse film2.6769230769230767 and phase2, with the recorded point present in `.knots`; sparse pairs/outer entries reject. Additional focused records cover phases2.2,3 and4.1, preserved append prefixes and forward/inverse composition. These writer receipts do not replace the formal CHANGES REQUESTED verdict; the frozen repaired candidate awaits fresh SPEC then QUALITY.

Formal independent R2 QUALITY then verified Q1/Q2 and R1 but requested Q3 for the adjacent sparse vector/rectangle/append validators. R3 writer evidence is confined to new `r3-writer-20261012/`; its failed-candidate source copy preserves the reviewed six files. Prior frozen manifests, sources, reports and reviewer evidence remain intact. New production RED (`red-q3-sparse-guards.txt`): **0 PASS/3 FAIL**, reproducing accepted sparse recorded tangent, rectangle origin and append batch. Targeted GREEN: **3/3** (`green-q3-sparse-guards.txt`). R3 focused GREEN: **23/23, zero skips** (`focused-green.txt`); unchanged source numeric/original-runtime oracle and all R1/Q1/Q2 regressions pass. Impacted existing replay suite: **30/30, zero skips** (`impacted-green.txt`), committed baseline WASM CPU preservation only. The required matrices cover every omitted vector3/rect4/append index, explicit undefined and dense controls, every camera branch, malformed portrait fit atomicity and rejected append snapshot/prefix/cursor/input preservation.

The R2 independent probe scripts have fixed historical manifest/output paths. R3 uses explicitly logged **adapted fixture execution** of their unchanged script bytes: only the old manifest read is redirected to the new exact six-file R3 manifest, and their two artifact writes are redirected to new writer paths. Their assertions, original-source VM/oracles and expected behavior are unchanged; this is not a byte-identical historical run or a new reviewer verdict. Adapter/source digests, fixture mappings and current results are saved under `r3-writer-20261012/`. Fresh SPEC then QUALITY must review the newly frozen candidate before any commit/integration.

Canonical source HE physical event time .65 returns eye `[-.7648247941,2.0260499956,10.4583308110]`, target `[-.1900184956,1.5413995070,7.4409001265]`, FOV48. APHE physical event time 2.74 returns eye `[3.9105382686,3.95,4.7465977763]`, target `[-.1041638567,1.1198407346,.2157679889]`, FOV43. Tests compare planned rounded points within 1e-5 and exact source main-camera poses within 1e-9 across nine phases, both heavy modes and normal/portrait aspects. They also evaluate complete manual/side-entry branches, source forward/inverse transfer, 38° normal inset parity, documented portrait fit, immutable played prefixes/tails, future/equal/late/invalid anchors, measured hull framing/clipping and finite valid LH poses.

The optional independent source VM oracle resolves `V3_REPLAY_REFERENCE_ROOT` or the exact inspected source root above. When that external archive is unavailable on another machine, those two external-source tests explicitly skip; the canonical numeric/matrix/clock/bounds tests still run. This preparation receipt had **zero source skips**. A future parity receipt must record source availability/skips instead of treating a skip as archive parity.

No native compilation, WASM build/copy, browser, HTTP/CDP/Playwright, web build, publication, deployment or Git commit ran. Visual verification is **NOT RUN**. This does not prove active cutover, sampled flight termination, projectile bodies, simultaneous sessions, fatal routing, rendering quality, P2/P3/P5 physics or pressure semantics. Root's fresh SPEC then QUALITY and independent checks are pending before any integration/commit.

| Prepared file | SHA-256 at this component receipt |
| --- | --- |
| `client/web/src/game/replayClock.js` | `5d6e96d341768172e563f5604298d436e4fb0cc56ed8887297ecf22269eaf1db` |
| `client/web/src/game/replayCamera.js` | `2c9c196d2c3568b0fb6f8199a5b98554790203e7b0ca63cc68e9ca82624c0e8f` |
| `client/web/test/replay-clock.test.mjs` | `b96b708b8422c6d27e873295bd07d378d4bc642428e3e50dbc36b166043b167f` |
| `client/web/test/replay-camera.test.mjs` | `eadd9de468fc48143cfa6747a2d1afa4b5a6b0de3f3d466456bfdc3937e070f2` |
| `docs/third-party/hit-replay-v3-LICENSE.txt` | `abcf324daa606d1797518f51b40d1629728c02184ca5ca4fe0bbd07429da3081` |
