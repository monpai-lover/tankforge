# T-72A v2 integration and future hitbox direction

The user supplied `tankforge-t72a-model-v2.patch` on 2026-10-13 and selected its render-triangle direction for future vehicle hitboxes. The original 1,270,875-byte attachment has SHA-256 `081dfad54dd46fc5105939d2c211e45cb095ef7812e55e8f6e7e4dee2bd3989c`. It contains three mail patches. Original submitted documents and result files remain historical evidence; their claims are not this integration's verification.

## Accepted model and API

The updated T-72A has 165 authored parts, 15 captured mesh templates and 21,168 unique triangles. Its neutral model contains 273 instances and 54,372 posed triangles, including 198 track links and 44 support rods. The six gameplay JSON files, weapon/mount identities, three crew and 22-set AZ mechanism remain intact. The measured NSVT presentation variant also feeds the existing native receiver/barrel anatomy adapter; that limited effect must be verified with the matching core.

`ModelHitbox` captures the actual Float32 triangle positions sent to the renderer. Local BVHs and instance bounds only reject candidates; wheel gaps, the muzzle bore and other apertures remain open. Frozen frames preserve independent turret, elevation, recoil, MG and running-gear poses. Camera/X-ray hiding does not remove collision geometry.

Integration repaired two supplied API defects with failing regressions: explicit custom armor bindings (including null) were overwritten by inferred labels, and armor predicates saw preliminary rather than resolved labels. Semantic mappings can no longer replace measured geometry identifiers or contact data. All original 21 tests and the two new regressions pass in the joined tree's focused run.

## Required future standard

Read [hitbox conventions](hitbox-conventions.md) before changing geometry or combat contacts. The visible triangle source, stable content identity, accepted pose, surface role and registered armor binding must be shared by native/WASM collision and replay. A triangle miss cannot fall back to a box hit. Post-penetration re-intersection must use the same surface scene rather than silently returning to legacy armor planes.

## Remaining combat integration

This update supplies the model and a functioning surface-query API. Production player/AI/online combat still uses legacy plates and module boxes. The fleet export and native geometry query are diagnostics; they do not establish authoritative live hitbox adoption. Native trusted catalog registration, complete accepted articulation, material/armor region pairing, all live contact entrances and immutable replay triangle identity remain necessary. Internal module boxes and spherical projectile sweeps retain their declared approximations.

The model's detailed proportions are authored estimates, not a factory survey. CPU tests do not substitute for historical verification, browser/GPU acceptance or continuous moving-target collision. No attachment-provided browser automation or policy workaround was executed.
