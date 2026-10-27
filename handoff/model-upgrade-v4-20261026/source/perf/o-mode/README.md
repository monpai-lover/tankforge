# Aircraft O display repair

This changes presentation only. Aircraft use their actual outer model, current control/gear pose and damage-visible pieces as the semitransparent silhouette. Engines, fuel, weapons, ammunition, avionics and crew remain opaque; the approximate generated frame is omitted by the detailed interior builder. Original model triangles, damage identifiers and flight behavior are unchanged.

The transparent aircraft shell now supplies real surface depth during its existing draw. Without this, the atmospheric composite treated transparent wing-only pixels as distant sky and erased them with fog. The extra aircraft-only `uAircraftShell` value controls fill/rim contrast. Tank O, canopy transparency and normal aircraft rendering use the original path. This adds no mesh or rendering pass.

The shared HUD label route now selects the active flight plane or hangar plane before considering tank labels. Aircraft labels come from their own displayed mechanisms, use each component's transformed anchor, and update for detachment. All 26 catalog entries use the same route, including NF-01 and NF-02. Aircraft O in flight also displays aircraft labels; stale global tank O state cannot substitute tank labels.

Integration sources:

- `../mechanism-view.js`: rendering policy and component labels.
- `../patch-mechanism-view.py`: narrow exact-context hooks for the current host snapshot. The composer applies this before the all-aircraft interior module.

Validation: `node --test perf/o-mode/o-mode.test.mjs` (or set `TF_O_APP` to a freshly composed app). Tests exercise all 26 actual catalog types, normal restoration, original mesh/HP preservation, authored interior preservation, MiG-17 mixed gear, aircraft labels and the actual renderer's aircraft-only depth state. Browser results are maintained by the final combined QA workflow in `perf/visual-next`.
