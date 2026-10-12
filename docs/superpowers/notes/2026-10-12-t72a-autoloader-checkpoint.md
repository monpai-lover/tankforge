# T-72A autoloader implementation checkpoint R1

Worktree: `C:/Users/24908/.codex/scratch/tankforge-t72a-autoloader-20261012`.
Branch: `codex/t72a-autoloader`, uncommitted base
`f73986d3cb1be472acbcc0ea5e406b335e8b1998`. Root owns acceptance/integration.

## Implemented

Independent first-party `su_t72a` obr 1979; six large wheel stations, low cast
loft, long 125 mm tube, thermal cover and bore evacuator, three crew/no loader,
TPD-K1 laser, PKT/NSVT identities with measured generic rendered MG anatomy.
Seven vehicle JSON files, three named compatible 125 mm round reconstructions,
and an idempotent scoped builder. Original vehicle/projectile bytes remain
unchanged; original ten MG entries remain byte-identical within the appended
catalog. Sources and every estimate are in the research JSON.

Fitted mount `mechanized_loading` owns AZ metadata, capacity22, base8s and
physical parts `az_drive`/`az_ram`. It is distinct from GunDef, manual queue,
autocannon belts and launch tubes. Only 2A46-1/125 mm compatible metadata is
accepted. A gun-only workshop transplant uses manual rack handling; retaining
the stock fitted mount preserves its AZ. No separate depleting carousel counter
exists: `g.ammo`, OnlineAmmo and C2 remain the only stock/scope owners.

JS queue has a dedicated per-gun worker with immutable actual cycle identity.
Main constructor, actual frame work and HUD use the fitted owner. Human loader
1.6 factor is removed only for the fitted mechanical owner while named parts,
rack damage, repairs and destruction retain their actual effects. Native
mounted capabilities report `mechanized` and `mechanism_available`; older
cores use the small explicit named-module adapter. Existing drive module kinds
serve that adapter; they are excluded from gun laying by explicit references.

Rust typed folder loading, schema and validator retain the fitted definition;
the Loading library mirrors dedicated independent work and dynamic rate.
Mounted combat bindings preserve unique apparatus ownership and separate
mechanical availability from a chambered round's firing capability. Existing
server conventional cannon cadence remains a client-owner boundary; no new
server reload authority is claimed.

## Audio handoff (separate Root adoption)

No `Sound` method, `audio.js`, audio asset or main audio callback hunk was
changed in this lane. The queue exposes:

```js
loading.newLoading(t.guns.length, t.loaders.length,
  t.guns.map(g => !g.rack), t.guns.map(g => g.mechanizedLoading));
loading.tick(L, dt, reloadTime, rate, event => {
  // event: {gun, stage, owner:'mechanized', mechanism:'az_t72', cycle, workFraction}
});
```

`cycle` is the worker-captured `L.waitedSince[gun]`, not current clock/time.
Provisional consumed-work milestones: `select_lift` at0, `projectile_ram` at.32,
`charge_ram` at.61. Events are emitted once on real positive consumed work;
paused work does not advance stages. Selection/lift uses the adopted drive
texture; both ram strokes may use the adopted generic ram once at normal pitch.

In main's done loop, restore `g.loaded = nextAmmo(g)`, selection and shell,
then permit lock only if `L.state[gi] === 'ready'`, `g.loaded >= 0` and that ammo
has positive count. The audio owner must return binding ownership even when an
AZ cycle was rejected/omitted, keeping it silent without legacy fallback.
Audio lifecycle/scope cancellation remains the separate controller's job.

## Evidence and remaining refresh

Node RED first showed missing real stock vehicle (9 fail), then absent owner,
stage and capacity behavior (8 fail). Target behavior became green through
actual stock loadout, buildTank, VehicleSim, actual main fire/frame/HUD, gameplay
mode, selected ammo, exhausted stock, five-second resupply, OnlineAmmo rejected
last-round prediction/stale scope and real native receipt replay.

Rust RED: actual strict folder refused the unknown mechanism field; actual
combat caps lacked mechanical identity; the independent Loading API was absent.
After implementation the full weapon/vehicle/combat/server suite passed249
tests, including84 combat,108 server,31 vehicle and21 weapon. The final fresh
all-tree native validator passed with zero issues. Scoped estimated module
overlaps were corrected only on the new T-72A.

Initial full Node run:789 total,780 pass,9 fail. Catalog-specific count and
equipment expectations were corrected without removing geometry/stock/damage
checks; the focused82 affected tests then passed. Second full run:789 total,
788 pass,1 fail. The sole failure is the deliberately enforced source check on
the older T72 C2 receipt after the final compatibility/outline changes. It is
recorded in `target/t72a-node-suite-checkpoint-r1.log` and requires the scheduled
native refresh, rather than changing or bypassing its source assertions.

The first release WASM/page/server builds passed. Later checks corrected the
construction label to the established `dimensions` value and strengthened
AZ compatibility against matching edited gun IDs. Their Node RED/GREEN is
verified, but those final changes require a fresh small native/C2/WASM/page
refresh when Root returns the exclusive native lane. Earlier artifacts and
the T72 native receipt must not be represented as current after that change.

No game browser was used. No paid audio generation, credentials, stage, commit,
push, deployment, global physics/B2 change or Root completion/status edit.
Reserve transfer, selection-distance variation, loading-elevation interlock,
composite armor, exact ballistics and visual game acceptance remain documented
limits. Positive nominal1.51m minimum turn radius avoids granting zero-radius
counter-rotation, but the old continuous-difference/creep owner does not yet
reproduce a one-moving/one-stopped planetary pivot.

Exact source paths/hashes and artifact freshness are frozen in
`target/t72a-implementation-checkpoint-20261012-R1.json`. This is an
implementation checkpoint for independent SPEC/QUALITY, not final acceptance.
