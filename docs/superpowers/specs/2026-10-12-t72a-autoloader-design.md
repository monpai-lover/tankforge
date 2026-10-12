# T-72A fitted AZ autoloader

The user asked to use automatic loading and add a real vehicle that uses it.
Root selected the T-72A obr 1979 and authorized implementation on the isolated
`codex/t72a-autoloader` worktree. This records that already approved direction;
no new user approval or paid sound generation is required. Root owns final
SPEC/QUALITY, native build scheduling, audio adoption and integration.

## Vehicle and evidence

Add an independent first-party procedural `su_t72a`, not a renamed T-54 or an
imported model. [Weaponsystems' variant sheet](https://weaponsystems.net/system/1408-T-72A)
supports the 2A46-1, three crew, six wheel stations, 41.5 tonnes, 6.86 m hull,
3.60 m width over skirts, 2.19 m height, 780 hp V-46-6 and 22 automatic rounds.
The [Victory Museum T-72 entry](https://victorymuseum.ru/encyclopedia/technic/bronetankovaya-tekhnika/osnovnoy-boevoy-tank-t-72-sssr-/)
corroborates a circular conveyor carrying separate projectile/propellant sets.
Both sources distinguish 22 mechanized sets from a total 44-round load.

Runtime capacity is **22 rounds including the initially chambered round**.
The 22 additional nonmechanized reserve sets are omitted until an explicit
reserve-transfer owner exists. Five-second resupply restores the selected
22-round deployment plan and starts a real loading cycle for an empty gun.
It never places a supplied round directly in a ready chamber.

The published 7-8 rpm range supports an 8 s base cycle as a simulation choice,
not an exact measured cadence. All per-stage fractions, collision plates,
interior/module placement, transmission ratios, suspension constants and
unverified ballistic fields are documented engineering estimates. No ERA,
ATGM capability or later applique plate is fitted to this 1979 baseline.

## Owner and compatibility

Recommended: put `mechanized_loading` on the **mount**, separate from the
gun catalog definition, crew queue, autocannon belt and missile tube owner.
Keeping it on GunDef would grant every transplanted 2A46 an unfitted carousel;
inferring it from zero loaders or nation would misclassify existing vehicles.
The authored definition binds mechanism `az_t72` to compatible gun and ammo
identities, 22-set capacity, an 8 s cycle, named mechanism modules and a
three-event presentation recipe. Invalid or incompatible definitions fail
closed during loadout creation and typed vehicle validation.

`g.loadingOwner = 'mechanized'` and `g.mechanizedLoading` drive an independent
worker in the existing queue. Manual guns keep their queue and gunner 1.6
penalty. Mechanical work ignores that human-loader penalty while retaining
actual rack damage, repair and destruction. The Rust Loading library mirrors
the dedicated worker; the current server does not have a conventional cannon
reload clock, and this work does not claim to add whole-server firing cadence
authority. C2 stock capacity/selection/resupply remains authoritative.

## Presentation contract

`newLoading(count, loaders, independentFlags, mechanicalDefinitions)` accepts
one optional fitted definition per gun. `tick(L, dt, reloadTime, rate, onStage)`
reports `{gun, stage, owner:'mechanized', mechanism:'az_t72', cycle, workFraction}`.
`cycle` is immutable `waitedSince[gun]` captured when that actual worker starts.
Stages are `select_lift`, `projectile_ram`, `charge_ram` at work fractions
0/.32/.61. These are provisional presentation milestones, not source timings.
Paused work emits no progressed stage; a large step crosses each stage once.
The queue reports completion through its existing done list. A lock sound
belongs only to the caller after setting loaded ammo, confirming state ready
and positive stock. This agent exposes the callback but does not call an
unimplemented Sound method or modify the independent audio author's hooks.

Existing interpreted machine textures may accompany those events at normal
pitch, with the ram texture twice. They are not authentic AZ recordings.

## Acceptance and boundary

Production Node tests must first fail, then pass through real stock loadData,
makeLoadout, buildTank, VehicleSim, loading, gameplay mode, ammo plan/resupply,
weapon selection and actual fire owner. Cover no-loader mechanical work,
manual/automatic separation, mixed workers, three-stage order, paused work,
exhaustion, resupply without instant ready, capacity, incompatible recipes,
transplanted manual guns, damage adapter and finite moving geometry.

After Root releases the native lane, typed/Rust Loading/combat/C2 tests and a
matched native/WASM/client build complete the implementation validation.
No game browser driving is performed without the existing Root approval.
All original vehicle, audio and historical receipt bytes remain unchanged.
