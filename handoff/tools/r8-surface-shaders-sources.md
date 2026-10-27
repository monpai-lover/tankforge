# R8 surface shader provenance

The R8 surface candidate is independently authored. No external shader code or assets are copied, and no new third-party runtime dependency is introduced.

The original renderer is custom WebGL2. The patch reuses its `vnoise`, filtered `fbmL`, derivative `bump`, GGX lighting and HDR conventions. It changes only terrain kind 2/20 surface coloring/normal detail and water kind 7/22 lighting normals/roughness. Registered heights, water polygons/holes/levels, physics, renderer resources, and replay/status materials stay outside the patch.

Research sources (2026-10-27):

- [IQ Texture Repetition](https://www.shadertoy.com/view/4tsGzf) and [author article](https://iquilezles.org/articles/texturerepetition/): low-frequency material variation and gradient preservation as ideas. Direct original-page license could not be verified because the search connector returned HTTP 402/restriction. No code used. Related versions and third-party ports have differing license headers; Shadertoy publication is not treated as a blanket MIT grant.
- [IQ Triplanar/Boxmap](https://www.shadertoy.com/view/MtsGWH): projection blending as a terrain reference. No code used. Existing terrain is procedural rather than a repeating image texture, so three texture projections are not added.
- [TDM Seascape](https://www.shadertoy.com/view/Ms2SD1): visually useful broad/fine wave separation. Available [source header](https://gist.github.com/matthewjberger/868a0c2596cbb2ba1e72bfdc64dfb6f1) records CC BY-NC-SA 3.0. Rejected for copying/porting. No raymarch, octave transforms, constants, or source code from it are used.
- [Mark Finch / Cyan Worlds, GPU Gems chapter 1](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models): common mathematical derivation of the gradient of a sum of directional sine heights. The candidate independently implements a fixed four-component gradient and phase-footprint filtering; it does not copy chapter source code or add vertex displacement/normal-map render targets.
- [Stefan Gustavson and Ian McEwan, psrdnoise](https://github.com/stegu/psrdnoise), [explicit MIT GLSL header](https://raw.githubusercontent.com/stegu/psrdnoise/main/src/psrdnoise2.glsl): verified permissive alternative with analytic derivatives, not imported because existing project noise suffices.
- [Ashima/Stefan Gustavson WebGL noise](https://github.com/ashima/webgl-noise): verified MIT alternative, not imported.
- [tuxalin Procedural Water](https://github.com/tuxalin/water-shader), [MIT license](https://raw.githubusercontent.com/tuxalin/water-shader/master/LICENSE): verified permissive reference architecture. Its full reflection/refraction/depth-map implementation is not imported.
- [Jens Neitzel TerrainHeightBlend Shader license](https://github.com/jensnt/TerrainHeightBlend-Shader/blob/main/LICENSE.txt): verified MIT texture-no-tile port; not imported because the current ground material has no repeating image sampler.

The patch adds no image texture, sampler, uniform, render target, draw call, GLSL loop or JavaScript frame-loop work. Water changes remove three finite-difference fBm height evaluations; arithmetic counts are not a measured GPU/FPS result. Phase filtering and bounded relief are source-level stability measures whose appearance still requires a real moving-camera comparison.

`patch_r8_surface_shaders.mjs` refuses ambiguous anchors, repeated patching, and canonical in-place CLI output. It exports the actual evaluated GLSL variants for `build_r8_shader_webgl_gate.mjs`, which generates a standalone compile/link/nonblack-readback fixture. That fixture explicitly leaves visual acceptance and hardware performance unclaimed.
