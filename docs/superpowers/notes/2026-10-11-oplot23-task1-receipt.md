# Oplot23 Task1 accepted source receipt

2026-10-11. Isolated branch `codex/casual-historical-modes`, worktree
`C:/Users/24908/.codex/scratch/tankforge-gameplay-modes`.
Task1 implementation is `3d73ac3cd21a22b1cc5fa989c7ae2249aa679a2f`; the two
QUALITY fixes are `c361d0c320081f815f99f9bdea6ca21c84848695`. Fresh SPEC PASS then
QUALITY APPROVE accepted the final Task1 source before Task2 began. This records
that accepted boundary, not final combined delivery acceptance or integration.

## Implemented and preserved

- Independent `su_t10m_oplot23` and two new projectiles, eight new vehicle JSONs.
  Original `su_t10m` remains the 14.5 mm option in the new Mods family. ORDER has
  the new ID adjacent to the original; native server loading registers its directory.
- GSh-informed hypothetical six-barrel 23×115 mm fit; mean axis has 1 m muzzle
  offset, six open 23 mm bores, 45 mm outer diameter and 55 mm centre-circle radius.
  Source turret/gun housing is shared; old barrel parts excluded from the new fit.
- API .174 kg/715 m/s with newly calculated B-32-derived De Marre estimated curve;
  HEI .174 kg/715 m/s/.0178 kg A-IX-2 via existing HE path. Installation, dimension,
  drag, curves, complete HEI projectile mass assumption and inherited vehicle mass
  limits remain explicit. No factory PDF inspection or historical installation claim.
- Actual manual shots, new ammo depletion, native/WASM automatic interception,
  shared total rounds, own gun/crew/repair and independent primary gun damage gates
  were exercised in both modes and on both original/new variants. Source exports
  remain original-valued and independent of effective gameplay factors.
- New body recoil exists only in the autocannon branch. It opposes nominal world
  `mz.dir`, with the existing 1.3 gas/game convention, at the physical transformed
  local trunnion. The old normal-gun impulse block is byte-identical to the prior
  accepted gameplay source. Dispersion remains a property of individual bullets.

## RED, GREEN and review repairs

Initial real RED lacked independent data and native registration and demonstrated
absent autocannon rigid-body impulse. Task1 GREEN included focused 8 checks,
237 selected Node regressions, combat83, missile24 plus3 old ignored, server58,
coast1 and socket2 native checks. The final focused+mandatory bridge group was22.
Existing fleet/gun-binding counts changed42→43 and47→49; harnesses gained real
RigidBody/existing RECOIL_ROCK dependencies, preserving prior behavior assertions.

QUALITY found canonical output rewriting and tilted parented recoil-axis mismatch.
The actual tool's attempted canonical write was denied in isolation RED; tilted
pitch0.2 recoil RED failed the real muzzle/body comparison. The fixes add optional
`--output-root` while retaining all source reads at the repository, and use nominal
world gun direction. Two isolated temp outputs match canonical bytes; canonical
hashes, mtime and ctime remain unchanged. No author default rerun on canonical data
was used for verification. Affected GREEN was 111; fleet metadata correction GREEN 32.

The complete Root Node suite after those repairs at `c361d0c` is 558 PASS/0 FAIL/
0 SKIP. The complete native workspace at `3d73ac3` is 366 PASS/0 FAIL/4 old debug
ignored; Rust/data/config/manifests are unchanged by `c361d0c`. Task2 independently
checks retained logs and these exact unchanged-input diffs, then performs fresh
actual-handler regeneration, release/web builds and 33 post-build checks.

Retained ignored evidence: `target/oplot23-task1-freeze.json`,
`target/oplot23-isolation-red.log`, `target/oplot23-tilted-recoil-red.log`,
`target/oplot23-quality-fixes-green.log`, `target/oplot23-quality-fleet-metadata-green.log`,
`target/oplot23-root-full-node.tap`, `target/oplot23-full-native.log`.

## Guards and limits

All 448 original tracked data/assets except deliberate WASM build remain unchanged
relative to `c5350a4`, aggregate `e117187c12d8dd16de6ed89d38590ee4d2b415c8b0667a94929d8635da9d8f4c`.
Only 10 new JSONs were added. Existing model/source packed bytes remain unchanged;
legacy raw GLB is absent, so no absent-file hash claim. B2's 13 + 2 external frozen
files remain intact; no B2 code/tests or tolerance edits were copied.

CPU geometry and actual owner tests are not browser visual acceptance. P2–P5,
full ammo/fuze/energy calibration, exact hitboxes, barrel visual sampling, B2 and
V3 multi-hit/death replay remain outside acceptance. Task1 did not build HTML,
push or integrate. Latest combined behavior/parameters:
[`docs/gameplay-oplot23-2026-10-11.md`](../../gameplay-oplot23-2026-10-11.md).
