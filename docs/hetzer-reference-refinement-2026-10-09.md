# Original Hetzer reference refinement

The user supplied a longitudinal cutaway (`1-照片-1.jpg`, 1280 × 644) and a
four-view drawing (`2-照片-2.jpg`, 848 × 1060) for this refinement. SHA-256:

- Cutaway: `ca006edd797e090afae3b25e8334ef3b2e449f445c5b7dc434960d9357d61ae1`.
- Four-view: `bc7b2b4a141f362a3dcfe6bf096d07674dfb6259e99920571b9a8232f3b935c8`.

These user-provided images are shape references. They are not imported runtime
meshes, and their authorship/licensing has not been independently established.
No Claude of Tanks art or vehicle asset is used by this refinement.

## Drawing observations and changes

The existing low, sloped casemate and stepped lower hull already agree with the
drawings at the level of this procedural model, so their sections are retained.
The four-view has four distinct large road wheels, a broad cast Saukopf tapering
to the right-offset barrel, a rounded loader hatch, and rear cooling louvres.

- The first road-wheel pair formerly overlapped by 50 mm. Centers are adjusted
  while retaining the existing 0.82 m diameter; adjacent rubber rims now have
  40–80 mm of clearance. Both original procedural Hetzers share this correction.
- The original casting was only 0.62 m wide and 0.70 m long. Its elliptical
  sections are now 0.92 m wide and 1.30 m long, with raised broad cheeks aft and
  a rounded taper forward. The slope-following fixed flange remains thin and
  open around the moving gun. The barrel-axis offset remains +0.38 m.
- The loader hatch has a curved front leaf; the commander hatch has clipped
  corners. Both have low hinges/handles. Eleven louvres sit on the established
  rear-deck slope over the existing dark radiator opening.

The drawing is a proportional reference, not a production drawing or a certified
measurement. Casting sections, small fittings and wheel coordinates remain
estimates. Armor uses the existing simplified planes; this does not implement a
cast-metal thickness map. The cutaway does not justify inventing new crew or
module coordinates, so existing interior, weapons, muzzle, traverse and elevation
data are retained.

## Rebuild and compatibility

Run `python tools/build_hetzer_original.py` to rebuild only `de_hetzer` and
`de_hetzer_flak`, with repository LF line endings. It does not regenerate the
fleet, projectile catalog, imported GLBs, MK103 variants or custom Sd.Kfz.140/1
conversion. The shared generator keeps all existing IDs and mount ownership.

`client/web/test/hetzer-reference.test.mjs` covers the drawing defects and the
actual Mods → buildToBundle → makeLoadout → buildTank paths. Three geometry tests
failed on the old data (overlapping wheels, narrow casting and square hatch)
before the authoring change, and passed after it. The workshop tests cover both
replacement of the original gun and retention of it with an added generated
turret; exported armor, gun modules and crew must pass the real folder validator.
The original collar/deck/exhaust and custom GLB tests also remain applicable.

`client/web/test/hetzer-workshop.browser.mjs` drives the actual workshop import
control, selects all five existing Hetzer family fits, and checks both workshop
builds, gun-node/muzzle agreement and unchanged vehicle placement. Existing
`hetzer-original.browser.mjs` captures front, side, rear, oblique, roof and mantlet
views. QA uses Edge software WebGL, which verifies rendering but does not measure
hardware performance.

Validated in this worktree: 16 original/custom/geometry/workshop Node checks and
the custom-turret recipe regression pass; the 14 original Hetzer JSON files are
byte-identical after a second targeted rebuild. The five family fits instantiate
real active weapon geometry; the three GLB fits retain their imported-model path.
The actual workshop UI exposed a prior keep-pose defect (69.31 m teleport on the
first rebuild). Application selection now places the replacement physics body at
the saved x/z/heading and settles it on the ground. The regression passed with
less than 0.000001 m of horizontal shift and less than 0.34 mm of gun-node/muzzle
error in both workshop states. Both states and the original vehicle's front,
side, rear and oblique views were visually inspected after rendering.
