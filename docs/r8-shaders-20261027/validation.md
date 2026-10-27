# R8 surface shader validation and rerun commands

Scope: source-only bounded terrain normal/color detail and analytic water normals/roughness. The integration owner applies the checked transform to the current app; do not replace the current app with an earlier full candidate that could omit simultaneous replay/loadout work.

## Source files

- `handoff/tools/patch_r8_surface_shaders.mjs`: checked pure shader transform, numeric wave oracle, actual GLSL export, candidate-only CLI.
- `handoff/tools/build_r8_shader_webgl_gate.mjs`: exact actual GLSL compile/link/nonblack readback fixture.
- `handoff/tools/build_r8_shader_comparison.mjs`: paired before/after, deterministic moving-camera fixture using the unchanged full main composite shader (ACES/gamma/tint).
- `handoff/tools/r8-surface-shaders-sources.md`: code provenance and source/license decisions.
- `handoff/tools/test/r8-surface-shaders.test.mjs` and `r8-shader-gates.test.mjs`: portable source-owned regression checks.
- `handoff/tools/test/fixtures/r8-original-shader-app.js.html`: compact original first-party shader declaration snapshot. It contains no embedded WASM, vehicle assets, game boot, or network path. Its default test input remains valid after canonical shader integration.

## Automated source tests

Run from the source root:

```powershell
node --test handoff/tools/test/r8-surface-shaders.test.mjs handoff/tools/test/r8-shader-gates.test.mjs
```

Observed 2026-10-27: 13 tests passed, zero failed. Log: `D:/TankForge-validation/r8-shaders-20261027/source-owned-tests-green.log`.

Coverage: exact transform scope and anchor rejection, unchanged replay/status/vehicle/optical water contracts, unchanged uniforms/samplers/loop count, no added noise evaluation sites, JavaScript syntax, finite normalized/bounded animated waves, smooth footprint suppression and roughness broadening, sub-two-centimetre bounded shading relief, evaluated actual HDR/fallback GLSL export, automatic gate generation, paired fixture generation and main composite reuse.

The initial feature RED run failed because the baseline had no fine terrain filter/bump or analytic wave helper; source/fixture RED logs are retained in the validation directory. These are meaningful source/numeric checks but cannot substitute for a driver compiling GLSL or for visual inspection.

## Candidate generation and graphical gates

Before integrating the surface shader, generate a fresh candidate from the current canonical input:

```powershell
node handoff/tools/patch_r8_surface_shaders.mjs --output D:/TankForge-validation/r8-shaders-20261027/new-candidate.html --shader-dir D:/TankForge-validation/r8-shaders-20261027/new-candidate
node handoff/tools/build_r8_shader_webgl_gate.mjs D:/TankForge-validation/r8-shaders-20261027/new-candidate/actual-shaders.json D:/TankForge-validation/r8-shaders-20261027/new-candidate/webgl-gate.html
node handoff/tools/build_r8_shader_comparison.mjs --before handoff/bundle/app.js.html --after D:/TankForge-validation/r8-shaders-20261027/new-candidate.html --output D:/TankForge-validation/r8-shaders-20261027/new-comparison.html
```

The patcher refuses canonical or input in-place output, existing candidate files, ambiguous anchors, and repeated patching. Initial ca6bcf3b input produced candidate SHA-256 `2a46455d76149ccdf2f51776509d354a8036ab0cf08da8f30a5f349880c181e0`; a current merged app has a different whole-file hash. The original litFS SHA-256 was `3cc4e85f5de5e7ae281038a124ef0d85eabf1433dd47853885ed975481a3f326`; candidate litFS is `fd4bdbafe17693431377c0b6d4c1e7a4793164449f4dab854509ee7eec4222b0`.

The integration owner reported an actual CUA IAB run at `http://127.0.0.1:18791/r8-shaders-20261027/merged/webgl-shader-gate.html`: both HDR and fallback programs linked, all 12 readback fixtures passed with GL error 0, and DOM title was PASS. This is actual WebGL compilation/readback evidence, not a visual-quality or hardware-FPS result. The shader agent did not run a browser itself.

The paired visual fixture is `D:/TankForge-validation/r8-shaders-20261027/paired-shader-comparison.html`. It has synchronized old/new columns for close terrain, steep terrain and water; the exact main tone mapping; controlled brighter lighting and exposure; and automatic gentle camera motion. It uses an RGBA8 ENC/DEC intermediate so it works without a float render-target extension. Actual HDR and fallback are separately compiled by the shader gate.

Comparison automation API:

```javascript
window.__TF_R8_SHADER_COMPARE__.setTime(0); // fixed, paused comparison
window.__TF_R8_SHADER_COMPARE__.setTime(4);
window.__TF_R8_SHADER_COMPARE__.setExposure(1);
window.__TF_R8_SHADER_COMPARE__.play();
window.__TF_R8_SHADER_COMPARE__.pause();
window.__TF_R8_SHADER_COMPARE__.readback();
window.__TF_R8_SHADER_COMPARE__.status;
window.__TF_R8_SHADER_COMPARE__.dispose();
```

The fixture owns and cleans its textures/programs/buffers/targets on pagehide. Its resources are standalone validation resources and are not inserted into the game renderer.

## Remaining acceptance boundaries

The paired fixture is synthetic shader-only geometry, not a rendered registered map. Root integration must inspect the real map at close/far/grazing views, water source holes, aircraft overhead, and all replay/X-ray/status views. A slow pan is needed to judge shimmer. Screen captures can show appearance but cannot establish hardware FPS.

No new runtime texture, sampler, uniform, target, draw call, GLSL loop, JS frame-loop work, or geometry displacement is introduced. The water implementation removes repeated noise height resampling. These are source facts, not measured speed claims. Hardware performance still requires same-device timing with disjoint-safe GPU queries where available, same viewport/quality, and CPU/GPU p95/p99 evidence.
