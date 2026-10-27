# R8 shader and terrain research

Research date: 2026-10-27. Source-only candidate work; no browser/GPU rendering or FPS result is claimed.

Canonical input: `D:/TankForge-workspaces/r8-20261027/worktree/online-source/handoff/bundle/app.js.html`.
SHA-256 before changes: `ca6bcf3bb738151f4578f347a34f4960bbd3f9d126ed98caaa5c545f178a2e7e`.
The original file is preserved. `client/web/src/gfx/shaders.js` may be stale and is not the integration target.

## Existing contracts

- The client is custom WebGL2, not Three.js/R3F. React Doctor is inapplicable; do not install React tooling for this audit.
- `LIT_VS` and `litFS` live around canonical lines 2325-2780. Kind 2/20 is terrain; kind 7/22 is water; kind 0 is procedural tank paint; kind 9/18 is textured tank/air; kinds 6/10/12-16 and `uReplayCutaway` are analysis/replay contracts.
- Terrain and source-water geometry helpers are separate from shading. Canonical terrain height, registered water triangles/holes and level, visual cutouts, near/far meshes, collision/navigation are outside the shader patch scope.
- Terrain uses world-XZ procedural noise (four-octave fBm at two scales), an optional authored map color, zone colors, road ticks, and deformation/rut normals. Main texture anti-tiling would not solve a present tiled-image contract because there is no repeating ground image sampler.
- Existing band-limited `fbmL` handles grazing-footprint aliasing but close detail uses unfiltered `vnoise`. Ground lacks additional close rough surface normal relief. This is a source inference, not a visually reproduced defect.
- Existing GGX uses Schlick Fresnel, direct sunlight, hemisphere ambient, sky-dome reflection, 2048 shadow map with 3x3 PCF and cloud shadows. No replacement BRDF, sky, shadow cascade, or full-screen pass is proposed.
- Current water computes three noise heights for finite-difference normals: 3 x 4-octave fBm and 3 x value noise. Kind 22 sets optical depth to a constant 6 and alpha to 1, because registered water has no authored seabed. Do not invent shoreline depth from absolute world Y.
- HDR supports float RGBA16F and RGBA8 ENC/DEC fallback. Preserve shader output encoding and alpha semantics.
- Main renderer already owns shader compile/link cleanup and context restoration. Candidate should add no textures, targets, buffers, GL programs, JS frame-loop allocations, draw calls, or network dependencies.
- Quality presets are low/medium/high with dome 640/1024/1280 and cloudSteps 16/24/36; the cloud dome is cached and updated in tiles. A per-frame full-screen terrain/ocean raymarch would violate the current budget approach.

## Shadertoy research and license audit

The user requested real Shadertoy references. The following links were found via indexed references, then direct fetch was attempted. Shadertoy returned HTTP 402 to the search connector for all direct pages and the terms page. That prevents verification of the current author-provided license at the original pages. No Shadertoy code is copied or downloaded into the candidate.

| Reference | Useful idea | License decision |
| --- | --- | --- |
| IQ Texture Repetition, <https://www.shadertoy.com/view/4tsGzf> and article <https://iquilezles.org/articles/texturerepetition/> | Low-frequency variation reduces obvious repetition; preserve pixel gradients when changing projection. | Concept/reference only. Third-party ports present inconsistent MIT/CC terms across related versions. Original page unavailable; do not assume blanket MIT. |
| IQ Triplanar/Boxmap, <https://www.shadertoy.com/view/MtsGWH> | Normal-weighted projections avoid vertical stretching on cliffs. | Concept/reference only; original current license unverified. A three-sample image texture implementation adds unnecessary cost here. |
| TDM Seascape, <https://www.shadertoy.com/view/Ms2SD1> | Distinct broad waves and fine ripples; shallow/deep appearance and grazing Fresnel. | Rejected for copying. Available header records CC BY-NC-SA 3.0: <https://gist.github.com/matthewjberger/868a0c2596cbb2ba1e72bfdc64dfb6f1>. No raymarch, octave transforms, constants, or code used. |

Primary author/library sources independently checked:

- Stefan Gustavson and Ian McEwan's psrdnoise: <https://github.com/stegu/psrdnoise> and source header <https://raw.githubusercontent.com/stegu/psrdnoise/main/src/psrdnoise2.glsl>. Explicit MIT, copyright 2021, analytic derivative flow noise. Valid future code option if full license is retained; not needed for a compact R8 patch.
- Ashima/Stefan Gustavson WebGL noise: <https://github.com/ashima/webgl-noise>. Explicit MIT in repository and README. Self-contained procedural GLSL; not imported because existing TankForge noise is sufficient.
- tuxalin Procedural Water: <https://github.com/tuxalin/water-shader> and <https://raw.githubusercontent.com/tuxalin/water-shader/master/LICENSE>. MIT copyright 2017 tuxalin. Requires reflection/refraction/depth maps in its full design. Not imported; useful architectural reference showing why a wholesale port does not fit existing opaque registered water.
- NVIDIA GPU Gems chapter 1 by Mark Finch: <https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models>. General analytic sum-of-waves normal derivation; concept only, no source code copied.

Source-code audit decision: all new candidate code will be independently authored using the existing project's noise helpers and common derivative/sine-wave math. Attribution records describe idea references precisely and do not mislabel copied third-party code as inspiration. No third-party assets, music, images, textures, licenses or generated model data are added.

## Complementary approaches

1. Recommended bounded surface pass: re-use existing terrain noise for broad hue breakup, blend muted rock/soil on steep slopes without overriding authored zones or roads, add derivative-based near ground relief with pixel-footprint fade; replace expensive water finite differences with four analytic directional components and footprint suppression. Advantages: no GPU resource additions, water work is fixed, terrain uses existing noise; preserves current render architecture.
2. Texture-backed triplanar/stochastic terrain: add licensed material textures, mipmaps and anisotropy, blend projection weights. Better authored material control but creates asset/license/bandwidth/lifecycle scope and at least three samples per layer. Defer until a proper terrain material data contract exists.
3. Full Shadertoy scenic port: raymarch terrain/ocean or atmospheric scene. Strong demo appearance but replaces canonical height/water, duplicates sky, risks gameplay depth/replay, and can be very expensive. Reject for R8.

## Proposed candidate boundaries

- Modify only the `litFS` shader declaration string through an explicit checked patcher; no renderer state, source data, map geometry, shared replay helper, Rust, WASM, build tools, or deployment edits.
- Keep materials limited to terrain kind 2/20 and water 7/22. Optional specular anti-aliasing for painted/textured vehicle surfaces should be considered separately after a rendered moving-camera comparison; do not alter replay status line-art or its color contract.
- Terrain uses existing `big`, `mid`, filtered `fine`; no new fBm evaluation. Slope rock coloring precedes authored map/zone/road overlays so those layers remain authoritative. Close bump affects light only and does not displace geometry. Fade detail by screen footprint and distance.
- Water analytic normals change shading only; never move vertices. Use four normalized nonparallel directions, bounded gradient amplitudes, common water clock, and per-component footprint attenuation. No tide, ocean displacement, procedural shore, seabed, depth guess, refraction target, or fake collision.
- Keep opaque kind 22; preserve kind 7's existing optical-depth/foam alpha path. Clamp water roughness into a mild range as wave detail becomes unresolved to limit distant sparkling.

## Verification plan

Candidate patch tests: baseline hash, exactly-one anchor matches, reject partial or repeated patching, output app JavaScript syntax, only `litFS` body changed, all protected replay/material/geometry strings byte-identical, no new uniforms/resources/samplers/loops; numeric mirror tests for finite normalized wave normals, bounded gradient, invariance at distant footprints, time evolution, terrain detail boundedness.

Compile gate: extract actual evaluated `LIT_VS` and both `litFS(hdrDefines(true/false))` variants from canonical bundle; compile/link with WebGL2 on a real browser/device later. No GLSL compiler was found on PATH in this research environment. A source-level or JS syntax test does not count as GLSL compilation.

Visual gate (root integration): fixed map/vehicle/camera/time, same resolution/quality, close and grazing terrain; slope map color/zones/runway; near/far water and source holes; aircraft overhead; painted and bare metal; full replay/X-ray/analysis with white and dark surroundings; context loss/restore; HDR and fallback. Capture both stills and a slow-pan sequence to assess shimmer. Do not state a rubric pass until observed.

Performance gate: same native device and resolution, disjoint-safe GPU timer if available, CPU frame p50/p95/p99 and draw/resource counts. Analytic operation counts can justify design but cannot establish FPS gain. Desired regression budget: zero added draw calls/targets/textures and no meaningful increase in frame GPU p95; target <0.3 ms surface shader overhead at 1080p must be measured, not asserted.
