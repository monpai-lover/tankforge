# R8 bounded terrain and water candidate plan

Approved by integration owner 2026-10-27: independently authored bounded terrain slope tint/fine bump and analytic filtered water gradients; no global vehicle material changes or new resource/sampler costs. Keep replay branches and everything outside litFS byte-identical.

1. Write candidate tests that run against the canonical baseline when the patcher is absent. Verify they fail because the terrain filter/bump and analytic wave implementation are absent.
2. Add `handoff/tools/patch_r8_surface_shaders.mjs`, a checked pure transform plus explicit candidate-output CLI. The CLI refuses the canonical input as output. No in-place mutation.
3. Re-use terrain big/mid/fine noise, preserve authored overlays and rut shape, and add bounded derivative relief that vanishes with pixel footprint/distance.
4. Add four analytic directional water gradients, per-component phase-footprint filtering, and mild roughness broadening; preserve optical depth and alpha, all water geometry, and every replay/material branch.
5. Test pure transform scope and rejection, full output JavaScript syntax, unchanged uniforms/samplers/loops/protected code, and numeric finite bounded filtered normals across extreme valid positions/time/footprints. Generate a candidate only after PASS.
6. Export actual evaluated vertex shader and HDR/fallback fragment variants with a small automatic WebGL2 compile/render harness. Integration owner will select available browser tools and execute the real graphical gate. Do not report it run until evidence exists.
7. Record candidate hashes, test results, code provenance, limitations, and root integration instructions under this validation directory.
