# High-rate impact work

The complete pre-change browser profile found a separate first-hit stall: the replay's dedicated WebGL context and programs were first acquired inside `HitCam.show`, costing 4305.7 ms on this software-rendered cloud instance. Context creation alone left deferred driver work for the first upload, so loading now also exercises the actual shadow, mesh, sky, ghost/wire, trace, shard, field, MSAA and post-processing paths with a hidden 4×4 graphics calibration, then drains and verifies those commands. Temporary uploads are released and sample counts cleared. This runs during the existing scene-loading phase, before the boot splash is removed. It immediately hides the replay canvas and creates no replay session, damage/audio event or target snapshot. Normal hit acquisition reuses the prepared resources. Prewarming failure is nonfatal and normal acquisition can retry; an active replay is left alone.

The M61 and other rapid-fire guns were repeatedly rebuilding the hit vehicle's running gear even when an accepted damage result had not changed its shape. `Enemy.caps` applied each result and called `pose()` unconditionally. Besides the gear work, this changed `model.poseSerial` and invalidated the surface-combat pose cache between rounds in the same simulation step.

Every accepted capability result still reaches `VehicleSim.setDamageCaps`. A track break, side change or repair reposes the model immediately. Ordinary engine/crew/weapon capability updates reuse the existing geometry. The lethal `combatHit` transaction still marks the actor dead and poses its wreck immediately.

Replay admission also created an owned, deeply frozen evidence record which was then validated and cloned again by the hit camera and replay session. `validateReplayEvidence` now recognizes only its own canonical frozen outputs through a weak cache. It checks actor/life membership on every handoff. Mutable inputs, arbitrary externally frozen objects, changed geometry records and deserialized wire messages always receive full validation and a new owned copy. The cache retains no independently owned replay history.

The replay frame freezer likewise tracks only trees it has recursively frozen (including validator-owned outputs). Subsequent frames still own and freeze their new arrays and samples, while skipping unchanged immutable event subtrees. `Object.isFrozen` alone is never treated as sufficient: an externally frozen parent with mutable descendants is traversed and its descendants become immutable before reuse.

Run the bundled-module regression checks:

```sh
node --test handoff/tests/impact_hotpath.test.mjs
```

The thirteen checks cover a 250-hit burst with all mechanical results applied, track break/repair on both sides, immediate death pose, immutable replay ownership, stale-life rejection, mutated/raw/wire and non-JSON mutable-object rejection, externally frozen containers with mutable children, repeated-frame history traversal, prewarmed resource reuse, graphics calibration cleanup and failure/retry without disturbing active playback. They do not run against the older `client/web/src` versions.

For a repeatable component benchmark, preserve the pristine `d85044a` bundle and run:

```sh
TF_IMPACT_BASELINE=/path/to/baseline-app.js.html node --test handoff/tests/impact_hotpath.test.mjs
```

One run in this cloud instance, with 128 registered geometry instances and 128 fragment records, handed an already admitted record to three consumers for 100 hits. The pristine bundle made 300 additional full evidence copies in 1330.93 ms; the current bundle made zero additional copies in 2.40 ms. This measures replay handoff work only, not total frame rate. The first admission still performs all checks and owns a detached immutable copy.

For history sizes of 1, 32 and 128 records, the second frame's recursive object visits were 667, 21,282 and 85,122 in the pristine freezer, versus 2, 2 and 2 in the current freezer. These are visits during recursive ownership/freezing, not the whole replay renderer's work or rendered frames per second. Samples and visible events are still processed normally.

Use `tests/perf_vulcan.js` for the complete browser scenario. Native surface tracing, penetration, HE burst/fragment resolution, ammunition, damage and replay event acceptance remain active for every round; none is sampled or skipped by these changes.


## Impact-fix browser verification

Single Chromium/SwiftShader browser, 960×540 touch input, low quality, same five original vehicle definitions and original surface catalogs. The original d85044a bundle and the impact fixes with the first model refinement ran sequentially. These are one-run cloud measurements, not a frame-rate guarantee. The subsequent control-surface, cockpit, gear and attachment refinement received separate regression and browser checks; this performance comparison was not repeated for that later visual pass.

| Measurement | Original | Refined |
| --- | ---: | ---: |
| Mean simulation update during firing (ms) | 124.09 | 63.69 |
| P95 update (ms) | 390.6 | 313.3 |
| Max update (ms) | 999.6 | 576.1 |
| First HitCam.show (ms) | 294.6 | 38.3 |
| Target pose rebuilds | 77 | 3 |

Both runs fired 132 rounds and performed 37 surface-shot and 37 near-burst authority calls; impacts were not sampled or dropped. Native HE/fragment processing remains a material cost and spikes remain. The first run under concurrent screenshot load had a much larger cold-start stall; it is not used as the sequential comparison above.

Four successive impacts were admitted and displayed in replay; all three follow-up impacts displayed with zero additional delay. P-51D, F-104G and Mirage IIIE each took off, fired their fitted guns and completed the flight check without crashing. F-104G and Mirage also exercised the supersonic-boom path. Browser runtime error count was zero.
