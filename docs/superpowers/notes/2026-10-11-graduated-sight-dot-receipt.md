# Graduated sight aiming point

The user's 2026-10-11 screenshot showed the sight's range ladder with an
ambiguous empty zero. The requested small, accurate aiming point belongs to
the selected weapon's projected zero, including independently selected machine
guns. This is a bounded follow-up to the existing weapon/sight alignment fixes.

## Diagnosis and change

`Hud.drawSight` already draws the range ladder at the projected
`cx + offset[0], cy + offset[1]`. The zero had a deliberate gap and an upper
vertical mark; only a lagged weapon produced the separate request ring at the
screen center. There was no persistent filled zero point.

The sight now draws a small ivory point with a dark outline at that same
projected zero. It remains present during reload, overheating and restricted
traverse. The scope clip hides an out-of-view point while the original rim
arrow continues to indicate the weapon direction. The existing range ladder,
request ring, projection, selected weapon's ballistic table, zero setting and
optical field are preserved. No change to weapons, ammunition or vehicle data.

## Fresh verification

- Root's external recorder invoked the actual HUD method over 120 combinations
  of five screen sizes, four powers, three zero/lag offsets and blocked/unblocked
  status. Before the change: 0/120. After: 120/120.
- Added focused regression covers 360 sight frames with ready/reload/hot states,
  plus offscreen clipping and the retained direction arrow. The focused dot,
  sight-window and optics group passed 10/10 without skips.
- Fresh weapon-control/optics/window baseline passed 34/34, including actual MG
  ballistic zero, range graduation, selected muzzle parallax, and pitched/rolled
  hull alignment. The writer's post-change sight/weapon group passed 28/28.
- Root SPEC inspection passed. Fresh independent QUALITY review approved the
  frozen two-file patch, with three additional recorded drawing checks for point
  size/outline, clipping, request-ring placement and restored Canvas state.

Frozen SHA-256:

| File | SHA-256 |
|---|---|
| `client/web/src/game/hud.js` | `26ebd5e85876d996debc17e7cbc291282de4833eae39a17f6459e07d12e8756a` |
| `client/web/test/sight-dot.test.mjs` | `fd694b46e1728cab8507fb3922d8b07c9352edc9aba6a36ecf278243e8cb0a6c` |

External probe: `C:/Users/24908/.codex/scratch/tankforge-root-sight-dot-probe.mjs`.
Only the HUD, its focused regression and this receipt are committed here.
No browser visual acceptance, WASM rebuild, generated HTML update or release
is claimed. Full B2 suspension/track support and the remaining damage/replay
stages continue separately; their unfinished state does not turn this small
sight fix into an integration release.
