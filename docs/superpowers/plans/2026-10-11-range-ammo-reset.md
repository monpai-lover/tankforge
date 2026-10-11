# Range ammunition reset implementation plan

> **For agentic workers:** Execute the existing root writer's focused bug repair inline;
> use superpowers:requesting-code-review for fresh SPEC then QUALITY review before integration.

**Goal:** Offline range R starts a fresh selected vehicle with its chosen ammunition.

**Architecture:** Reuse actual select and missileBattleStart initialization instead of adding
a second refill owner. Retain other maps' resetPose and online authoritative respawn.

**Tech Stack:** Dependency-free JavaScript/WebGL2, Node test runner; unchanged Rust/WASM.

## Task 1: Reproduce, repair, verify

Files: client/web/src/main.js; client/web/test/range-ammo-reset.test.mjs.

- [x] Execute the live lifecycle reproduction, using the test file added
  with this plan: `node --test test/range-ammo-reset.test.mjs` in client/web.
  Confirm depleted rockets remain [0,0] on R, while actual Tab/new-sortie already passes.
  Correct harness boundary errors before touching production code.
- [x] Add exactly this branch after toggleSight in resetVehicle:

```js
    if (G.mapId === 'range') {
      select(G.id);
      missileBattleStart();
      return;
    }
```

- [x] Run the seven tests again, then `node --test test/gameplay-runtime.test.mjs
  test/range-vehicles.test.mjs test/missile-launcher.test.mjs`. Verify original saved 0 mix,
  model, launcher state and map/network
  guards; inspect the final diff and `git diff --check`.
- [ ] Commit only the three named plan/test/runtime paths. Fresh read-only SPEC review checks
  all design requirements; fresh QUALITY follows. Repair findings as root writer and re-review.

## Task 2: Build and publish the approved repair

- [ ] Preserve existing named pages and both B2 frozen inputs. Compile source-matched WASM
  through the existing build owner, then generate tankforge-range-ammo-reset-20261011.html.
- [ ] Compare embedded data and independently bundled source to the generated page; run focused
  post-build tests and the complete Node regression suite with actual bridge receipt environment.
  No native logic changes: unchanged native receipts may be retained after input verification.
- [ ] Record source/page/core hashes, fresh checks, old page preservation and review outcomes.
  New capture-point gameplay and historical steering remain awaiting their existing approvals.
- [ ] Integrate accepted commits to the clean shared main, copy the verified page to named
  and default paths, rerun lifecycle checks against main, push without force, verify remote HEAD.
  Do not call browser/CDP/HTTP verification after the earlier approval rejection.
