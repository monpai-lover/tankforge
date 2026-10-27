# TankForge aircraft mechanism display upgrade

This module upgrades the current C213 aircraft presentation only. It registers a lazy `ensureDetailedInterior` on all 26 catalog entries; AI construction does not upload detailed interior geometry. First O inspection or the active player's damage diagram builds the geometry once, and respawn reuses it.

Nine models retain their authored dedicated internals: `mig15`, `f86f`, `f104g`, `me262`, `me262a2a`, `me262u4`, `hunter6`, `mirage3e`, `mig29`. Their generated geometry path is not used; the preservation regression compares the dedicated component buffers byte for byte to the previous builder. Existing cockpit and textured pilot nodes remain owned by the host.

The other seventeen catalog entries use the deep mechanism builder: `nf01`, `nf02`, `p51d`, `bf109g`, `spitfire9`, `mig21`, `fw190a8`, `yak9u`, `a6m2`, `f4u1d`, `mig17f`, `f4e`, `f15c`, `f16v`, `su27`, `a10a`, `su25`.

Generated mechanisms include the existing compressor/combustion/turbine or piston-cylinder detail, plus engine accessory gearboxes, oil/starter pumps, hydraulic accumulators, valve manifolds and short service lines. Fuel cells have visual inspection openings with internal baffles, pickup strainers, boost pumps and shutoff fittings. Accessories within the six previously fitted jet models use the model-derived engine core profiles; fuel details use the already corrected cell triangles, not the stale damage AABB. Radial layouts distinguish the 14-cylinder A6M/FW190 and 18-cylinder F4U. Yak9/A6M wing fuel envelopes no longer become a wide central tank block.

The discarded procedural cage is never tessellated or uploaded. The old guessed fuselage-long control rod is omitted; its MiG21 tail extension is replaced by local pump/manifold detail. Engine, fuel, control and avionics damage use role-sensitive heat colour, driven by the host's accepted HP/fire state; repaired mechanisms clear the effect.

## Contact and ownership

The inspection cutaway is display only. Each generated fuel cell keeps its complete original uploaded contact mesh on a parent node whose own mesh is suppressed by `aircraftHiddenSkin`. A separate nonphysical child supplies the opened render mesh. Each auxiliary service module has `enabled=false` and `hitboxDisabled=true`, so it adds no contact surfaces. O visibility never changes accepted damage IDs, source model bytes, outer model geometry or contact membership. Accessory display follows the existing engine/pod carrier's detachment.

The complete generated interior upload, including hidden full tank contact meshes and visible cutaway children, is bounded to 30,000 triangles per fallback aircraft. Reports distinguish `triangles`, `renderTriangles` and `uploadedTriangles`.

These are fitted gameplay mechanism presentations, not surveyed manufacturing interiors. The work introduces no new backend damage schema, aircraft capabilities or flight physics.

## Validation

`all-interior.test.mjs` checks the actual current 26-entry catalog: lazy construction, accepted HP bindings, O/release, damage/repair, detachment, respawn, disposal, geometry finiteness, normal-view restoration and upload budget.

`deep-mechanisms.test.mjs` checks dedicated geometry preservation, actual contact audits, nonphysical accessory exclusion, O-invariant contact hashes, projectile contact with a visually opened tank lid, radial-bank and wing-fuel layout selection, and damage/fire effect clearing.

`deep-audit/full-tests.log` contains the combined result with the existing direct-builder/live-interior tests. `all-interior-test-results.json` records current per-aircraft geometry and upgrade policy.
