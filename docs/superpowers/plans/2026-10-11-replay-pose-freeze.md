# Impact-pose replay freeze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Only one runtime implementer writes in this worktree; specification review precedes quality review.

**Goal:** Keep projectile replay at the pose of impact through ammunition detonation, live movement, model disposal and respawn.

**Architecture:** Capture a compact fresh physics frame and articulation before damage. Associate it privately with the report. Build one detached target only after HitCam accepts that report, retain static meshes and duplicate mutable instance buffers. All replay rendering consumes this detached target.

**Tech Stack:** Existing JavaScript/WebGL2 scene graph, Node CPU tests and the existing Rust/WASM combat fixture. No asset or combat-rule changes.

## Task R: frozen target and owned resources

**Files:**
- Create `client/web/src/game/replayPose.js` and `client/web/test/replay-pose.test.mjs`.
- Modify `client/web/src/game/enemies.js`, `client/web/src/game/hitcam.js` and the existing renderer mesh owner (locate through `freeMesh` / `instancedMesh`).
- Extend focused renderer/resource tests and existing replay tests where appropriate.
- Preserve all existing uncommitted B changes, especially `enemies.js` running-gear integration.

- [ ] Write a failing regression using actual `combatHit` / `Enemy.pose`: dying with turret yaw .6 and gun pitch .2 currently changes replay yaw to .95 and gun pitch to .08. Add the real T54/APHE fixture from the specification with the in-memory renderer and bundled WASM.
- [ ] Run the regression and record the expected pose mismatch. New missing-helper tests alone are insufficient evidence for the reported bug.
- [ ] Capture fresh hull origin/basis, parent-relative turret locals, gun locals, fold and launcher readiness before the core call; store through a private WeakMap. Do not traverse meshes or create lazy interior here. Copy current locals for callers outside combatHit. Never capture the dead-pose offsets.
- [ ] Add retain/release semantics for distinct static meshes; deferred owner deletion must remain context-restorable. Clone every instanced mesh into private buffers/matrices. Each acquired resource has one cleanup path; cached textures remain renderer-owned.
- [ ] Build detached hierarchy and remapped interior metadata after existing priority/validity guards. Use an identity root plus captured hull-to-world body matrix and fresh clone-only updates. Freeze launcher-round readiness without retaining its live update closure.
- [ ] Route camera, projectile, traces and every replay stage through the snapshot. Approach rendering excludes original target members and includes snapshot nodes. Preserve the live death/toss animation.
- [ ] Exercise live body and joint changes, all instanced uploads, lazy interior first frame, live launcher state changes, target disposal/respawn, context restoration, replacement, suppressed MG, hide and expiry. A throwing renderer or partial capture must leave live nodes unchanged and release partial acquisitions while preserving the old accepted replay.
- [ ] Verify pose/trace endpoints stay unchanged at the same replay time, interior maps contain clones, and resource counts return to baseline. Test idempotent disposal and multiple retainers.
- [ ] Run `node --test client/web/test/projectile-replay.test.mjs client/web/test/design-replay.test.mjs client/web/test/replay-pose.test.mjs` plus focused renderer/enemy/interior/model tests. Do not run browser, HTTP, CDP or Playwright because the previous approval rejection remains in effect.
- [ ] Run `npm --prefix client/web run build` with the installed esbuild executable configured. Record it as a build check, not visual verification or publication.
- [ ] Commit only R hunks/files. For a file with earlier B changes, stage through an exact patch against HEAD so the B hunks remain unstaged.
- [ ] New SPEC reviewer checks the full design and actual implementation; after PASS, a new QUALITY reviewer checks resources, error paths and regression coverage. Fix and re-review all actionable findings.

## Completion evidence

The 14 old replay baseline tests do not prove this fix. Record new behavioral test results, independent root checks, both review decisions and the exact commit. H and R are integrated into the final B build; this plan does not authorize early publication of unfinished running-gear code.
