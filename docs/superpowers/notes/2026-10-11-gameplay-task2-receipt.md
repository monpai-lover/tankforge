# Gameplay Task2 acceptance

TankForge, 2026-10-11. Runtime commit `1c90bf7`; existing harness integration
repair `8a658cc`. Fresh SPEC PASS followed by fresh QUALITY APPROVE. This
accepts single-player performance, selection/session lifecycle and assistance
markers; room authority and final artifact acceptance remain separate.

Root independently ran the new focused tests (21/21 PASS), then the repaired
modular-damage and range-vehicle suites (35/35 PASS). SPEC ran the combined
new/affected group (56/56 PASS). QUALITY ran 56, 78 and 99 tests, all PASS,
plus delayed-map-start and late-core probes. Source data/assets are unchanged.

The independent SPEC sweep initially found six old harness failures (181/187
PASS): their extracted live main bodies lacked newly required owners/context.
The same tests with baseline main bodies passed 35/35. The repair supplies
real session/performance/marker owners and real APS loadouts, retaining all
245 original assertion-bearing lines. No production relaxation was made.

Actual owner tests verify source-derived selections, tracked/wheeled launches,
separate turret/MG slews, manual/autocannon/MG/missile emissions, APS profiles,
damage/repair gates, workshop exports, mode locking/restoration, and both Canvas
maps. Historical qualification happens before tag visibility/projection. Late
core binding retains gameplay profiles, definitions and spent ammunition;
duplicate delayed starts create one profile lock.

Existing legacy rooms explicitly retain historical behavior until Task3 adds
the strict server-owned mode/version protocol. No browser, Cargo build, matching
new page, push or integration was performed. B2 and Oplot23 are not accepted by
this receipt. Native lane free.
