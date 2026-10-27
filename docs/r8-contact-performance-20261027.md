# R8 registered HE contact CPU verification

The final registered-surface contact queue reduced the measured initial R8 p95 from 25.96–43.85 ms to 3.77–7.87 ms in four real T-72A and Flakpanzer 38(t) HE cases. Flak still exceeds the internal 6 ms target: 6.63 ms for 20 mm and 7.87 ms for 35 mm. These are CPU-only Node measurements, with no browser, GPU, sustained-battle or FPS claim.

## Measured calls

Each case uses the actual cohort bundle, its embedded combat WASM/data, production model/interior/DamageVisuals builders, verified surface registration and an actual positive triangle contact. Twelve warmups precede 48 timed source-queue calls. Native arena restoration and the actual direct primary hit occur outside each timed call, preserving the core's state-admission guards. The final run was uncontended after native, Node and build workers had finished.

| Actor and HE round | R7 source planes p50 / p95 ms | Initial R8 exact 128 rays p50 / p95 ms | Final R8 exact 16 rays p50 / p95 ms |
| --- | ---: | ---: | ---: |
| T-72A 20 mm | 6.59 / 8.63 | 24.16 / 25.96 | 3.50 / 3.77 |
| T-72A 35 mm | 6.31 / 8.18 | 24.00 / 26.15 | 3.77 / 3.98 |
| Flakpanzer 38(t) 20 mm | 3.77 / 5.39 | 38.42 / 41.25 | 6.04 / 6.63 |
| Flakpanzer 38(t) 35 mm | 4.15 / 5.05 | 41.16 / 43.85 | 7.56 / 7.87 |

The archived R7 and initial R8 measurements use fixture v2. They are not fresh, uncontended R7 v3 results. The table preserves each cohort's actual queue policy: R7 uses declared planes for rounds up to 40 mm, applies TNT-equivalent filler and offsets the supplied contact by 0.15 m; final R8 keeps registered triangles, raw filler and a 1 mm query offset from the accepted primary impact. R7 also ignores the newer pressure-exclusion argument. State/damage parity between these policies is not asserted.

Every final source-queue call invokes `combat_surface_near_burst`. The sampled T-72A reports contain 14 exact geometry contacts; Flak reports contain 12. Both contain 16 distinct physical casing samples. The T-72A case excludes already-recorded primary pressure; the Flak case includes its required registered primary exposure.

## Changes and physical limits

HE-kind rounds at or below 40 mm use four representative rays in each of four unchanged fragment mass bins. The event `small_he_fragment_quadrature_16_v1` labels this statistical approximation. One physical piece retains its mass, velocity, energy, area and drag; representative weight alone compensates for sample count. Sampling variance and individual damage outcomes can differ from 128 rays. Larger rounds and APHE, HESH, HEAT and HEAT-FS retain 128 samples.

Anatomy candidate selection resolves the instance-specific binding once per surface range, then transforms the same selected triangle vertices. Geometry registration now owns surface ordinals, removing a repeated linear search through long surface keys. Full exact visibility traces, unknown barriers, range order and the original work limit remain in place. Refit keeps the indices; fresh registration and shape composition rebuild or clone the correct owner. Unregistered surface-order changes fail closed.

The cache allocates at registration or scene cloning; successful lookup allocates nothing. This does not claim that the whole burst/query/report path is allocation-free. Identical-packet WASM diagnostic registrations measured 11,760 cache bytes for T-72A's 1,812 mesh ranges and 12,144 bytes for Flak's 1,620 ranges. Instances share their mesh indices. All measured diagnostic handles/store meshes and production renderer/surface owners returned to zero after release. `memory.surfaceIndexArrayBytes` reports this cache separately; legacy diagnostic `sceneArrayBytes` remains a partial aggregate of instance, TLAS and query arrays and is not a memory-admission budget.

Focused RED/GREEN coverage includes the 128-to-16 cost contract, unchanged single-piece physical properties and represented mass, seed repeatability, a real aperture, paired-wall shielding, exact posed vertices, instance binding overrides, cache rebuilding, stale-order rejection and scene release.

## Cohort identity and receipts

| Cohort | App SHA-256 | Embedded combat WASM SHA-256 |
| --- | --- | --- |
| R7 | `ca6bcf3bb738151f4578f347a34f4960bbd3f9d126ed98caaa5c545f178a2e7e` | `f4d81323f742f51cbb025d240cd02e62f9423de585db613b106d54f1e32e5d18` |
| Initial R8 | `691e63037db1169628ecb9ed5c550f85445e66de929f462b656e523e5a75dd68` | `b96e453c2a014f50126799ad57f4c3f93cef5f35a3da87e51a259907c9dd2b4e` |
| Final R8 cache candidate | `77720cf0813cb1053294fcfb0510bd3d5528d90f274b47f6cf4969cb25bc7928` | `748ab06b097d82d38b6a7446b445b847224cbd3023814a943358655312e5ab27` |

All cohorts have embedded-data SHA-256 `7a35444f326a3234f7bdf6ad84ff8d2a561edc00d1824740ebc236dd6bf46bd4`. Actual uploaded position-word hashes are unchanged: T-72A `bc21e9bf0e20aab25741801b511fc8a49363816eef583020accbacd4d8bd1284`; Flak `dfe3517243587f5f316473360ed62d7225edc924ba1203c2f915d0f55b75199e`. The receipts also retain unchanged manifest/catalog hashes and the actual positive-contact records.

The harness and receipts are in `D:/TankForge-workspaces/r8-20261027/validation/contact-cpu/`: `registered_contact_cpu.mjs` (v3), its preserved `registered_contact_cpu.v2.mjs`, `r7-v2.json`, `r8-v2.json`, `r8-cache-optimized-uncontended.json`, `comparison-r8-pre-final-uncontended.json` and `r8-cache-memory.json`. The pre-cache hotspot evidence is `profile-findings.json` and the two `.cpuprofile` files; those function indices apply only to their recorded `27dd70…` WASM cohort.

Source audit: [casing budget](../crates/combat/src/near_burst.rs), [geometry range selection and cache](../crates/combat/src/geometry/mod.rs), [anatomy exposure and composition clone](../crates/combat/src/geometry/combat_scene.rs), [physical sampling tests](../crates/combat/src/near_burst_budget_tests.rs) and [cache identity and ownership tests](../crates/combat/src/geometry/tests.rs). Primary receipts: [final CPU samples](D:/TankForge-workspaces/r8-20261027/validation/contact-cpu/r8-cache-optimized-uncontended.json), [initial versus final comparison](D:/TankForge-workspaces/r8-20261027/validation/contact-cpu/comparison-r8-pre-final-uncontended.json) and [separate cache memory accounting](D:/TankForge-workspaces/r8-20261027/validation/contact-cpu/r8-cache-memory.json).
