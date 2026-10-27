# Projectile exact-surface batch review

Independent review of the synchronous `updateShots` / `updateBullets` broadphase candidate, 2026-10-26. This review did not mutate the delivered app, profile or WASM and did not run Cargo.

## Result

The fixed callback barrier passed three real-model tests. The preserved unsafe helper failed both callback tests on the same source, renderer fixture and combat WASM; its stale closed AABB incorrectly culled a real unfolded Flak panel. The nested/throw cleanup test passed for both helpers.

- Test: `handoff/tests/projectile-surface-batch-reentrancy-20261026.mjs`.
- Full receipt: `D:/TankForge-validation/projectile-batch-reentrancy/receipt-v2.json`.
- Receipt SHA-256: `683ad26c2259ef1fe15b75aaa1c679f58ffd81419a0ae26e457705a61e3a6653`.
- Unsafe RED: 3 tests, 1 pass, 2 failures, exit 1; `unsafe-red-v2.tap.log`.
- Fixed GREEN: 3 tests, 3 passes, 0 failures, exit 0; `fixed-green-v2.tap.log`.
- App: `1c5607d177bbc3213e2aba442abcf23f2d13798f0e5023e26dba9b3eee7defb3`.
- Combat WASM: `f4d81323f742f51cbb025d240cd02e62f9423de585db613b106d54f1e32e5d18`.
- Fixed helper: `9d54ae02d38101111ead5bf4fd08448dd07c1dfac988088e05ff8e889efed551`.

## What was exercised

The tests reuse the real existing Flak/RSO fixture before its test-registration boundary, including the actual builders, stock vehicle definitions, reviewed surface packets, upload sink, DesignCore and current combat WASM. The tests do not substitute hit geometry or owners.

The closed exact world AABB is fully initialized and verified before measuring it. A nondegenerate triangle from the actual open `hinged_flap` mesh must lie more than 4 cm outside that closed AABB; the ray spans 2 cm on either side of its real surface normal. An unbatched open query must hit that mesh and the closed query must be empty before the callback cases start.

Actor A is cached closed. Actor B then invokes either its actual unavailable diagnostic callback or actual bounds-only recovery callback. That callback unfolds A through public model/combat fold operations and reenters the exact query. The fixed helper clears all cached actors and suspends the batch before invoking the callback. The unsafe helper retains A's stale bounds and loses its real triangle contact.

The reentrant query uses tick 78 after a tick 77 seed. The existing LocalSurfaceCombat owner has a same-tick + unchanged `poseSerial` shortcut; a direct `model.setFold` does not itself increment that serial. Reusing tick 77 would test that pre-existing owner shortcut rather than isolate the new batch barrier. The tests assert that no Enemy pose owner or exact pose revision has run before reentry.

The initial trial incorrectly sampled an uninitialized bounds union, and consequently did not distinguish unsafe from fixed. Its original logs and `receipt.json` remain alongside the corrected `receipt-v2.json`. The corrected test explicitly requires initialized verified bounds before selecting the triangle.

## Mutation-path review

Both patched loops are synchronous. Actual near/contact/unavailable queries are barriers before narrow phase and its callbacks; actual diagnostic/recovery callbacks are suspended barriers as tested. Ground direct-hit damage follows a near query. Surface shape commits change geometry revision, shape hash, buffer identity and pose revision, which invalidate saved snapshots. Ground destruction in `splashNear` calls the Enemy pose owner and changes its serial; surviving splash damage updates combat state without directly replacing render geometry. Body origin and all three basis vectors are checked on every saved-bounds use. The local player pose hook and Enemy pose/poseGuns hooks cover their ordinary pose paths. Nested phases clear the parent snapshots and `finally` ends the scope on exceptions.

This review certifies callback ordering and the reviewed synchronous scope, not browser FPS. The parent still needs foreground RANGE measurements and the final post-integration Node/native/browser cohort. The earlier 613-case baseline predates this candidate and fuel/HUD integration.
