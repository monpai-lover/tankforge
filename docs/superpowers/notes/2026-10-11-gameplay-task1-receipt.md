# Gameplay Task1 acceptance

TankForge isolated worktree, 2026-10-11. Runtime checkpoint `639c2a6`,
test-only cold-spin repair `f1353d6`; fresh SPEC PASS followed by fresh
QUALITY APPROVE. This accepts the shared rules and pure performance owners,
not main/UI/network integration or the unfinished B2 contact solver.

Root independently ran the original focused group (25/25 PASS), the added
cold-spin group (2/2 PASS), native rules unfiltered (2/2 PASS) and native
physics gameplay tests (2/2 PASS). Both reviewers freshly ran the final
focused group (27/27 PASS). QUALITY also ran existing launcher/loading/
weapon-control/wheeled checks (50/50 PASS) and swept all 42 vehicles, 47
guns, 45 MG mounts and the APS without non-finite derived fields.

The original writer ran the broader existing Node selection/loading/launcher/
weapon/wheeled group (66/66 PASS), native weapon tests (20/20 PASS) and
historical vehicle fixture (1/1 PASS). Initial RED had 21 missing API/behavior
failures; replacing the Rust casual transform with identity failed both
numeric tests. The later cold-spin RED concerned a missing test-harness
spin driver, not a demonstrated production defect.

The actual owner probes cover matched-RPM pull, governed speed, unchanged
traction caps, manual/layout and automatic loading, cold/partial/full rotary
spin, MG emissions, twin-launcher spacing/refill and APS emissions/damage.
Caller-owned loadout state is intentionally mutable; immutable definitions
may be shared. Each actor/selection must create its own original loadout.
Manual/layout final reloads use `effectiveReloadSeconds` once. Automatic,
MG, missile and APS profiles already carry their own clock factors.

Root's original data/assets diff from the task baseline is empty; working
tree was clean after review. No browser, push, integration or new preview
was performed. Native lane released.
