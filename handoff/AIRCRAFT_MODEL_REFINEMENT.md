# Aircraft model refinement

This document records the second model-pass acceptance snapshot (70 tests, before the flight-core
changes). For the final flight controls, three-position flaps and 92-test validation, see
[FLIGHT_CONTROL_IMPROVEMENTS.md](FLIGHT_CONTROL_IMPROVEMENTS.md).

The delivered aircraft source is `bundle/app.js.html`, as described in `README.md`.
Reassemble it with `./build.sh`; the older `client/web/src` builder does not contain these aircraft.

The shared historical-fighter builder now gives its fifteen aircraft framed windscreens, canopy
sills and cockpit seat/panel detail. Nose and side intakes have an annular lip and a recessed
interior, and exhausts have an inner wall and nozzle seams. Me 262 nacelles use open intake and
exhaust mouths instead of capped cylinders. NF-02 receives the same intake/nozzle refinement;
its three-digit muzzle colour also became a valid six-digit colour so the mesh contains no NaNs.
Pilot helmet and torso dimensions/seat height follow each canopy's actual ellipsoid, retaining
clearance instead of protruding through shallow bubbles. They remain in cockpit-only geometry.
Canopy side rails now follow that same curved glass surface, and the historical fighters and
NF-02 use canopy-relative cockpit viewpoints with clearance below the glass.

Recognizable details were refined on several aircraft:

- P-51D: shaped belly radiator scoop with a recessed intake, plus six exhaust stacks per side.
- Bf 109 G-6: separate cowling blisters, oil-cooler mouth and exhaust stacks.
- Spitfire Mk IX: more stations around the elliptical wingtip, radiator faces and exhaust stacks.
- F-104G: side inlet lips, recessed ducts, splitter plates and nozzle seams.
- MiG-21: a tapered dorsal spine replaces the rectangular block, with the nose shock cone retained.
- Mirage IIIE: wing-mounted elevons replace the separate horizontal tail, with mixed pitch/roll.

Moving ailerons and elevons are cut out of the authored wing planform. Their leading edges now
share a straight physical hinge with the fixed wing, including on the MiG-17's swept wing and
F4U's gull wing. The cut preserves the authored outer span, sweep, taper, dihedral and trailing
edge. Wing and control span ends have closed, independently shaded caps. Unchanged span intervals
remain one mesh path so their averaged normals stay smooth; intentional control cutout boundaries
remain separate, without globally welding the hinge or trailing edge. This capping applies to
airfoil panels and leaves the intake and exhaust mouths open. Piston fighters retain fixed
stabilizers while only their trailing elevators move.

All seven piston fighters now have authored inboard flaps driven by the flight core's accepted
flap position (`S[34]`), with up to 0.7 radians of downward deployment. P-51D, Bf 109 G-6 and F4U-1D
use plain trailing-edge flaps; F4U's two panels per side follow its separate gull-wing sections.
Spitfire Mk IX, Fw 190 A-8, Yak-9U and A6M2 use lower split flaps that retain the fixed upper wing
skin. Retracted split-flap plates are hidden to avoid overlapping surfaces. Mirage IIIE retains
its elevons without adding a separate flap or horizontal tail.

Bf 109 and Spitfire main wheels retract outward. F4U main gear retracts aft while twisting its
wheels through 90 degrees. Deployed wheel positions and landing-gear contact heights are unchanged.
All seventeen types explicitly identify their main-gear attachment. Bf 109, F-104 and MiG-21
retain their fuselage-mounted main legs after wing loss; the other types hide each wing-mounted
main leg with its corresponding wing. Nose and tail wheels remain visible.

Wing-mounted barrels, wing fences, radiator/intake details and Me 262 nacelles/pylons now belong
to explicit left/right wing batches; fuselage attachments retain body ownership. Losing a wing
hides its attachments and associated ailerons/elevons/flaps, and its guns stop firing without
consuming ammunition or emitting firing audio. Intact wing and fuselage guns remain usable.
Spitfire's machine guns now select its outer machine-gun barrels and its Hispanos the cannon
barrels; MiG-15's two NR-23s and single N-37 now select their matching barrels. These changes
preserve the authored muzzle coordinates while correcting those gun-to-muzzle indices. Flight-core
parameters, mass, armament definitions and ammunition capacities are unchanged.

From this directory, `node --test tests/*.test.mjs` exercises the actual bundled builders, pose
and gun-update code. The aircraft suites check all seventeen aircraft for finite meshes,
historical-fighter span and wheel contact, a 20,000-triangle ceiling, moving-surface placement and
envelopes, straight hinge axes and matching fixed/moving seams, closed panel ends, mirrored control
motion, seven-model flap deployment, curved canopy rails and cockpit clearance, gear retraction,
explicit attachment/gun ownership, detached-wing visibility and firing, corrected barrel mapping,
Mirage tailless geometry, and recessed nose intakes. The fifteen historical fighters currently
range from 8,776 triangles (A6M2) to 10,948 (Spitfire Mk IX). All 70 regression tests passed.

The final browser check used Chromium/SwiftShader at 960×540 with the actual renderer and reduced
background cloud cost. It inspected Bf 109 and F4U deployed flaps/half-retracted gear, Me 262 before
and after wing loss, MiG-17 wing loss, and the MiG-21 seated cockpit view. Me 262 and MiG-17 hid the
detached wing's main leg while retaining the intact side. A live P-51 firing check spent zero rounds
on the detached side and fired all three intact-side guns. Browser runtime errors: zero. Results,
six screenshots and the source hash are in `tests/out/model-round2-verification/`; the standalone
HTML was rebuilt and its bundled script verified byte-for-byte against the current source.

Aircraft damage still uses its pre-existing component/skin box approximation rather than the
render-triangle combat integration used by some tanks. Aileron envelopes now derive from the same
authored moving surfaces, and Mirage no longer has a separate horizontal-tail skin box. Decorative
detail does not acquire armor or extra hit points. This change does not claim measured historical
thickness, native/WASM aircraft mesh registration, or a replacement of that existing damage model.
