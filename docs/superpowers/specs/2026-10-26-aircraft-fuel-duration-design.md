# Aircraft selectable fuel duration

User approved 2026-10-26: fixed 10/20/30/45 minute choices plus full internal fuel, available next to aircraft/loadout selection in the hangar and original in-map deployment screen. The choice must affect actual loaded mass and maneuverability.

Use the existing aircraft fuel coefficients and actual nominal 65% throttle fuel-flow function as the estimate. A duration maps to `min(internalCapacityKg, minutes * 60 * referenceFlowKgPerSecond)`. The label states that this is a cruise reference, not guaranteed flight time; actual burn still varies with throttle, altitude and afterburner. Drop-tank fuel and mass remain governed by the mounted store. Preserve `fuel.max` as physical internal capacity.

The local launch initializes selected stock before the first original mass configuration. Reboarding a retained aircraft preserves its remaining fuel. Existing stopped-ground local K resupply rules are preserved in this change, using the chosen quantity. Online deployment and airport service send an optional validated fixed duration; absent/null means full for compatible old callers. The native server computes fuel kilograms, staged service target and accepted mass. Returning to deployment or reclaiming the same life must never grant fuel or accept a new spawn load. Only a completed native service changes stock; canceling or interruption does not grant partial fuel.

Use existing fuel, mass, damage, local-flight and service projections. Add behavioral tests for strict protocol choices, actual source coefficients, internal-only stock, lifetime preservation and staged service. Verify maneuverability by executing the real C215 plant with the resulting mass, without adding an arbitrary performance multiplier.
