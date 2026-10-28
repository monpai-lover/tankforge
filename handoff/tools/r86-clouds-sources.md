# R8.6 original cloud refinement: sources and limits

## Reference boundary

The user asked to combine stronger volumetric cloud appearance with the pending
R8.6 water/HUD work, citing <https://www.shadertoy.com/view/4sXGRM> and describing
multi-scale density, height falloff, front-to-back opacity and sunlit edges.
Those are general rendering principles. No code, author attribution, or license
grant is inferred from the link alone; no code from that submitted demo is
imported by this change.

A second supplied attachment had an author header prohibiting product use and
distribution, as checked by the root agent. That file is not copied into the
repository or package, and its scene, density functions, camera, SDF objects,
marching loops and lighting implementation are not adapted. This cloud work is
written against the game's existing `CLOUDS`, `domeFS`, and `skyFS` owners. The
general Beer–Lambert emission/absorption and ray/sphere equations used here are
not a transfer of either demo implementation.

The separate Frank Hugenroth water reference has its own retained CC BY-NC-SA
notice. It is not the source of this cloud patch and does not authorize use of
the excluded second attachment.

## Implementation

`patch_r86_clouds.mjs` modifies only the existing shared cloud-density block and
small portions of the dome/sky shaders. It is guarded, idempotent and exactly
reversible for LF and uniform CRLF source. Root integrates it after older
composers and normalizes it before those composers run again.

- The existing production noise texture already contains a four-octave billowy
  shape, cellular detail, weather and cells. The new body contour reads R and A
  from the same existing fetch. A softer base shelf and rounded weather-shaped
  cap make the silhouette and thickness easier to read. Erosion remains bounded
  and the cheap shadow path uses the same body contour.
- Existing five-sample sun optical depth drives dense-core ambient occlusion
  and restrained forward-lit, low-density rims. Three existing scattering
  approximations remain in place. This is cloud optical-depth lighting, not a
  surface-SDF ambient-occlusion or collision system.
- The existing 1500–3400 m cloud layer is retained. Upward ray bounds now use the
  actual camera height rather than implicitly starting at sea level. The radius
  difference is factored as `(height-cameraHeight)*(2*radius+height+cameraHeight)`
  to avoid subtracting planet-sized squares. A camera inside the layer starts
  its upward integration at zero; one above its top adds no overhead cloud.
- Beer–Lambert step opacity is integrated front to back. `cloudOpacity = 1-T`
  is explicit, while the dome's stored alpha remains **transmittance T**. Its
  temporal history also stores T. The final sky output stays opaque, and its sun
  visibility still consumes T. Replacing alpha directly with a Cineshader-style
  accumulated opacity would invert that contract, so that replacement is not made.
- Density is zero outside the layer or at zero extinction, and the shared shadow
  calculation has a nonzero denominator guard. Existing wind, evolution, linear
  HDR, atmosphere, temporal history and tile scheduling are preserved.

No production texture, sampler, uniform, target, pass or draw call is added.
The same three possible density texture fetches remain; existing 48 view,
five light and three scattering loop bounds are unchanged. Arithmetic lighting
work increases at occupied samples. The real game's GPU performance remains a
separate validation step.

## What this does not implement

This remains the game's sky-dome cloud representation. It does not add scene-
depth volumetric occlusion around aircraft, all-direction clouds seen from
inside/above, physical cloud meshes, cloud collisions, a 0–10 km replacement
layer or Cineshader extrusion. The upward camera-height correction does not
turn the dome into a fully penetrable scene volume. Ground and water cloud
shadows can change with the improved shared density; that environmental-light
change is intentional, rather than a material or geometry rewrite.

## Evidence

- Focused tests first failed on missing behavior, then **7/7 passed**. They cover
  exact reversal/idempotence/EOL behavior, three-lookup and loop budgets,
  unchanged non-cloud owners/uniforms, finite bounded density, layer boundaries,
  actual-camera ray bounds below/inside/above, explicit alpha semantics, and
  homogeneous-segment compositing invariance.
- `build_r86_cloud_gate.mjs` exports actual production noise, dome and sky shader
  strings into a standalone controlled fixture. `r86-clouds-browser.py` executes
  that fixture. The fixture uses a smaller 24³ volume rendered by the unchanged
  production noise generator; its diagnostic display uses Reinhard exposure,
  not the production composite. Its extra targets belong only to this test page.
- Final child fixture: **12/12 actual WebGL checks passed**, including exported
  HDR and RGBA8 fallback dome/sky compilation, finite RGBA16F readback, opaque
  final-sky alpha, zero-extinction T=1, temporal T≈0.55, and camera heights
  650/2100/5000 m. At 5000 m overhead T remains one. No GL or page errors occurred.
- The before/after cloud and transmittance-mask screenshot was inspected: body
  silhouettes and undersides are clearer; cloud opacity remains distinct from
  sky transparency. Evidence is in
  `D:/TankForge-validation/r86-clouds/browser-r2/receipt.json` and
  `cloud-comparison.png`; initial fixtures and red/green logs remain separate.
- These are controlled SwiftShader checks. They do not establish final packaged
  page identity, complete-map flight acceptance or hardware FPS; root owns those
  final integration checks.

Reproduce against the current canonical app without changing it:

```text
node --test handoff/tests/r86-clouds.test.mjs
node handoff/tools/build_r86_cloud_gate.mjs handoff/bundle/app.js.html <new-cloud-gate.html>
python handoff/tests/r86-clouds-browser.py --input <new-cloud-gate.html> --out <new-evidence-directory>
```
