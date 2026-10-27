# Airframe aerodynamics and wingtip condensation implementation plan

**Goal:** Add short, conditional wingtip condensation trails using accepted C215 flight data and measured aircraft planforms, with bounded CPU geometry.

**Architecture:** Preserve C215 as the flight owner. A presentation helper samples each wing's accepted lift, AoA and dynamic pressure, generates short world-space trails only in sufficiently humid/high-load conditions, and writes alpha ribbon vertices into the existing Effects buffer. A staged patcher supplies the three explicit integration hooks; it never overwrites its input.

**Tech stack:** Existing JavaScript/WebGL Effects buffers; C215 state80/aero48 telemetry; Node CPU tests. No new runtime dependency or per-frame mesh.

## Verified existing owners

- `handoff/flight/aerodynamics.h`: twelve wing strips, local angular airflow, independent stall/lift, induced drag/adverse yaw, horizontal tail, fin, delta elevons and surface travel.
- `handoff/flight/flight_core.c`: authoritative rigid body, exponential density, fixed340m/s Mach reference, transonic drag, gear/flaps/airbrake and damage; preserved80/48-float ABI.
- Canonical `configureAircraftSurfaces`: measured decoded `fighter.spec.wing`/tail/fin, mover travel; reapplied after fuel/store mass changes.
- Canonical `applyStoreLoad`/`stepAirFuel`: internal/drop-tank fuel mass, store mass/inertia/frontal drag,25kg update threshold, source surface reconfiguration. Native `frontline_air.rs::loaded_airframe` independently supplies mass/inertia/drag.
- Existing `airEffects`: afterburner, damage smoke and Mach0.93–1.07 vapour cone. No persistent wingtip-vortex or engine-contrail owner was found. Existing cone emits324 temporary glows/frame, so the new effect must not extend that pattern.

## Design decisions

1. Use the final measured wing section `[halfSpan,y,leadingZ,chord]`; emit at the tip trailing edge. Never infer tips from AABBs, pylons, decorative pods or weapons. Missing finite metadata disables the effect for that type.
2. A short aerodynamic condensation effect requires humidity, nonzero accepted dynamic pressure, positive per-wing lift, and high accepted AoA or load. Lift/pressure determine a bounded circulation/pressure-drop proxy; a dew-point deficit gate distinguishes humid and dry air. Missing telemetry disables emission. A lost wing cannot emit.
3. No thermodynamic weather owner currently exists. An explicit authored humid-scene preset is the presentation fallback, overridden by `G4.airAtmosphere`; it is not measured weather. Do not claim CFD or historical airfoil calibration. Ordinary1G cruise should not have permanent white tracks.
4. Keep aerodynamic condensation separate from high-altitude engine exhaust contrails. This change adds no engine contrails: there is no accepted ice-supersaturation/temperature field to justify them. Existing afterburner/nozzle rendering remains separate.
5. Fixed typed-array ring storage, fixed emission cadence, distance interpolation and strict global draw budget. Wind advects old points; no90%-aircraft-speed smoke plume. Short lifetime, low opacity and slight opposite-handed curl. No new mesh, texture, shader or particle allocation per frame.
6. Reset on aircraft/life change, accepted-time rewind, teleport, crash, garage/removal and long sampling gaps. Repeated rendering of one accepted sample cannot add geometry. Render draws existing samples only.

## Plan and verification

- [x] Add failing CPU tests for wet/dry/zero-lift conditions, measured tips, independent wing loss, cadence, interpolation, lifecycle reset and bounded buffers.
- [x] Implement `handoff/tools/air_vortex.js` as a self-contained browser/Node factory.
- [x] Add a non-overwriting patcher for canonical Effects alpha-buffer writing, accepted aircraft presentation sampling and geometry reset.
- [x] Test exact staged hooks in an isolated VM and actual decoded model metadata; record source hashes.
- [x] Report CPU evidence separately from visual inspection. No manual takeoff, browser/GPU/FPS or appearance claim is made by these tests.

CPU evidence:13 new helper/integration tests pass, including actual Effects alpha-buffer writes,26 decoded measured planforms, bounded10-minute sampling, and no mutation of accepted state/aero arrays. The11 existing C215 surface-aerodynamics tests also pass, including force scaling, independent stall/wing damage and mass-change surface reconfiguration. Evidence is in `D:/TankForge-validation/air-aero-vortex-20261027/`. Root must apply the staged patch to its final integration and rerun gates after the final source hash; this work did not overwrite the canonical app.

## Remaining aerodynamic approximations

The current polars/control derivatives are game estimates, Mach uses a fixed340m/s, density is exponential rather than a full atmosphere, and wake interaction/ground effect/icing are absent. These are separate physical-model projects. Client asymmetric store weight uses a lever-torque impulse; the native loaded-airframe path was found to update mass/inertia/drag but a matching lever/CG term has not yet been verified. Do not change authority based only on this audit suspicion.

## Public physical references

- NASA Glenn, [Induced Drag Coefficient](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/induced-drag-coefficient/): circulation/downwash and humidity-dependent visible wingtip lines.
- FAA, [AIM7-4 Wake Turbulence](https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap7_section_4.html): weight, speed, span and wing shape affect wake strength.
- NASA, [Contrails](https://www-pm.larc.nasa.gov/site/doc-library/208-Minnis.CONTRAILS.Ed2.pdf): aerodynamic liquid-water condensation and cold high-altitude exhaust/ice contrails have distinct formation conditions.
