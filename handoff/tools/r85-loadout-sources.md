# R8.5 loadout repair evidence

The reported click failure was subsequently reproduced on the integrated R8.5
page (pre-cache SHA256
`3166fdeab69307cec531848773d38d963193bcee3ec79967d5600e9b8c8da015`).
After normal runway return, both F-15C and the exact reported MiG-17F could not
click preset 2: the real browser repeatedly found the visible/enabled button
detached before click. MiG-17F recorded 36 such retries in 20 seconds at
`D:/TankForge-validation/r85-20261028/loadout-mig17-before-dom-fix/receipt.json`.
F-15 evidence is in `r85-20261028/loadout-f15-green/receipt.json` (this initial
GREEN attempt failed and remains a RED receipt).

The cause was comparing browser-serialized `target.innerHTML` against generated
markup. Native fuel HTML contains `<option selected>`; the browser serializes it
as `<option selected="">`. The adapter therefore replaced all deployment controls
on every native refresh, removing the target between pointerdown and click. A
focused RED reproduced four replacements for unchanged markup. The repair caches
the generated markup per actual target element in a WeakMap; unchanged refreshes
preserve input nodes, while real configuration changes and new target elements
still render. No MiG-specific selection exception or native rule change is needed.

The same review preserves the airport fuel node rather than comparing its
serialized innerHTML, keeps a focused service preset selection until change
commits, and preserves shared-lobby map/era option nodes across unchanged room
refreshes. Actual option-list or saved-choice changes still update the controls;
returning to legacy lobby fields invalidates the native option cache. Focused
tests cover both unchanged-node identity and real configuration updates.

The confirmed defect is a dropped custom quantity at the UI/shared/native boundary.
On the frozen R8.4 production page, the normal Taiwan escort / 2022 / F-15C
editor selected one AIM-9L at each `mid` station and saved `airCustomCounts=1`.
The normal deployment sent only slot-to-store choices; the native fixed catalog
materialized two missiles per station (four total). The browser assertion failed
against the native accepted stores, not a fabricated frame.

Evidence: `D:/TankForge-validation/r85-loadout-f15-red/receipt.json`, with
`custom.png`. The separate focused native RED rejected the previously unknown
`custom_counts` protocol field. The focused JS RED dropped quantity in shared
configuration/deploy and failed retained quantity propagation.

`patch_r85_loadout.mjs` is the narrow, guarded, idempotent canonical patch owner.
It adds optional quantity intent to shared validation, retains accepted quantities
on reclaim, serializes the original editor quantity choices, updates the existing
airport rearm path, and moves the existing detached airport controls into the
original aircraft HUD. The original service eligibility and native 15-second
commit rules remain authoritative.

The native extension advertises `custom_counts_version=1` and per-slot
`quantity_options`. It accepts integer quantities from 1 through source capacity
only for the quantity controls the original editor exposes (F-15 AIM-9/AIM-120 at
mid/belly stations, F-4 AIM-9 at mid stations). Native stores use a subset of the
immutable catalog-fitted positions. Clients cannot set positions, pod contents,
gun feeds, fuel, damage, service elapsed time or sortie eligibility. Presets and
clients which omit quantities retain their catalog behavior. Accepted counts are
echoed in aircraft/service views and service completion evidence; reclaim compares
approved count identity without refilling spent stores.

Earlier MiG-17F investigations did **not reproduce** the click failure in the
fresh or retained-aircraft flows on the frozen R8.4 page. These older successful
traces remain useful baseline evidence, and do not override the integrated-page
RED above:

- `D:/TankForge-validation/r85-loadout-mig17-red/receipt.json`: normal aircraft
  card, preset 1, custom FAB-250 editor, native two-bomb acceptance all passed.
- `D:/TankForge-validation/r85-loadout-mig17-return-red/receipt.json`: normal
  runway departure, original return button, preset 2, custom editor, and reclaim
  of the same native aircraft/configuration all passed.
- The F-86F normal preset/custom/native path also passed at
  `D:/TankForge-validation/r85-loadout-red/receipt.json`.

These passes establish the tested conditions only. Run the committed
`r85-loadout-browser.py` against the final
frozen page and source-matched server for actual GREEN evidence. The R8.4 frozen
server used for investigation is independently managed on local port 8897.
