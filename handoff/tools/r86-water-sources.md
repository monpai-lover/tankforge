# R8.6 user-supplied water reference

## Source and license

The user supplied a complete GLSL text attachment on 2026-10-28 and asked for its
water effect. The exact bytes are retained at
`docs/third-party/frank-hugenroth-water-reference.glsl`:

- 9794 bytes; SHA-256 `14804fe126af4f1e5ce3881611d5bca15c847bfcdf3cc6ed7db81e9f37c42261`.
- Author/date in its header: Frank Hugenroth, 03/2013.
- Its header explicitly declares **Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported** and credits noise/raymarching concepts/code from shaders by Inigo Quilez.
- No online shader URL or definitive title was supplied or independently established. The local attachment is the source evidence; this record does not invent a Shadertoy identifier.
- Attribution and license link are in `docs/third-party/frank-hugenroth-water-LICENSE.txt` and embedded directly in the injected GLSL helper. This is **not MIT**; derivative water code carries the stated CC BY-NC-SA conditions.

The official legal-text fetch returned HTTP 403 in this environment. The notice
therefore identifies itself as an attribution/license notice and links the
official legal text; it does not claim to contain the complete legal code.

## Adaptation

`patch_r86_water.mjs` reuses the supplied `water()` composition: five directional
crossing waves with the source's coefficients and phase velocities, its four
fBm weights/rotation, and seven progressively smaller choppy-noise scales. The
source uses different row/column matrix multiplication in the fBm and choppy
paths; the adaptation retains that distinction. The source's missing
`iChannel0` image is replaced with the game's deterministic hash lattice, so
this is not a bit-identical reproduction of an unavailable noise texture.

Analytic noise/sine/chop gradients replace four repeated full height samples.
Pixel derivatives are captured once at the beginning. Each scale uses its
known coordinate transform to compute a screen footprint; unresolved scales
fade out before aliasing. The source's absolute-value cusp is smoothed, and
the final slope is bounded at 0.45. A double-precision CPU reference checks
the calculus and stability; it is not installed in the frame loop and does
not claim GPU bit equality.

Water optics retain the supplied reflected-ray weighting and three sun lobes.
The game's existing sky texture and cloud/shadow field provide reflection and
cloud shading. Reflections below the horizon use the source's blue palette,
rather than the generic material system's brown ground hemisphere. Filtered
detail broadens the narrow sun lobe. Terrain/vehicle/replay materials, exposure,
registered water levels, physical geometry/collision and shoreline alpha stay
unchanged. No demo camera, raymarch, 100-layer cloud volume, extra sampler,
texture, render target, draw call or uniform is imported.

The R8.5 ocean helper remains as an unused declaration for reversible legacy
composition. The shader compiler removes unused functions; the active water
branch calls only `tfR86Ocean`. `normalizeR86Water` removes the new helper and
restores the exact reviewed R8.5 normal/optics blocks before older composers
run. Anchor editing normalizes uniform CRLF internally and restores its original
line endings afterward, including when a legacy wrapper invokes the normalizer
before its own newline normalization. Missing/partial/ambiguous protected anchors
fail explicitly.

## Checks and their limits

- Focused tests first failed on the unmodified R8.5 behavior, then passed. They
  cover author/license/source integrity, reversible patching, preserved
  non-water blocks/uniforms, finite bounded/evolving normals, analytic gradients
  versus central height differences, and complete filtering at huge footprints.
- Actual exported HDR and RGBA8 fallback GLSL variants compiled, linked and
  rendered in the existing committed browser fixture with zero GL/page errors.
- Synchronized actual-geometry comparison at t=0 and t=3 changed the water;
  terrain stayed identical beyond the existing one-channel framebuffer dither.
  The t=3 image was inspected, including the below-horizon blue-reflection fix.
- Evidence is under `D:/TankForge-validation/r86-water/`: red/green test logs,
  `browser-final/receipt.json`, and paired screenshots. The initial comparison
  is preserved separately rather than overwritten.
- These SwiftShader fixtures do not establish hardware FPS, complete-map visual
  acceptance, final packaged-page identity or multiplayer behavior. Root owns
  those integration checks against the complete R8.6 page.
