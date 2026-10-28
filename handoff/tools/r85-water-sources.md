# R8.5 water adaptation and verification

The runtime is custom WebGL2, not React or Three.js. The visual/frame-loop checks
are applicable; installing React Doctor is not useful for this renderer.

## Source and license (2026-10-28)

- Original: afl_ext, [Very fast procedural ocean](https://www.shadertoy.com/view/MdXyzX).
- The original page returned HTTP 402 through the web connector. The public source
  was retrieved through GitHub from the [XScreenSaver source distribution](https://github.com/xscreensaver/xscreensaver/blob/8ddbc080a77d6236939a6cde59c559f21c6e187a/hacks/glx/glsl/prococean.glsl).
  Its header explicitly identifies afl_ext 2017-2024 and MIT License.
- Preserved exact source: `docs/third-party/afl_ext-prococean-reference.glsl`.
  Git blob `e0bdd94587bc6951de9a9444d782fa5cee5ef15d`, SHA-256
  `9f54b46d0c3b6d2297fb87734c05c5093144cac1e5763c994f94de303420779d`.
- License/attribution: `docs/third-party/afl_ext-prococean-LICENSE.txt`.
  The author notice also remains in the injected shader helper.

## Integration

The adaptation uses the exponential sine waveform and derivative drag from that
shader. It evaluates eight directional components, propagates an analytic
Jacobian for the dragged coordinates, and filters unresolved components using
the screen-space phase footprint. Initial pixel derivatives are evaluated once
before the feedback loop; each octave's footprint uses the analytic Jacobian.
This avoids undefined higher-order derivatives from differentiating a prior
octave's filtered feedback. The final lighting gradient is bounded.
Unresolved detail broadens roughness rather than creating a mirror-like stripe.

The water-only optical branch uses water Fresnel reflectance, the existing sky
texture, existing sun, and depth-dependent body color. It preserves registered
water polygons/levels, terrain, collision, alpha conventions, atmosphere,
exposure, replay/status materials and postprocessing. No source-demo raymarch,
camera, atmosphere or tone mapping is imported. No texture, render target,
draw call, sampler or uniform is added. Arithmetic work increases relative to
the R8.4 four-wave helper; hardware performance requires the final-game check.

## Evidence and limitations

- Numerical/patch tests cover finite normalized bounded normals, evolving waves,
  distant filtering, protected material branches and strict idempotent patches.
- Actual exported HDR/fallback shaders compile, link and render real geometry.
- During this work the old fixture was found to omit the renderer's newer
  `uModelViewProj`/`uModelLightVP` bindings. Its old clear color could pass the
  nonblack check even when no geometry was drawn. The fixture now binds both
  precise and legacy transforms and clears black; an explicit regression first
  reproduced the false-positive readback.
- The synchronized comparison renders actual geometry at t=0 and t=3. Water
  changes visibly; terrain matches within the existing framebuffer dither's
  one-channel quantization step. This controlled fixture does not establish
  final-game performance, ship interactions or all-camera visual acceptance.
