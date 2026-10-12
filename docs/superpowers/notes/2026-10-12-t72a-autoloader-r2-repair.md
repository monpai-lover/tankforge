# T-72A R2 compatibility repair and current build

R1 SPEC-R1-001 showed that equal editable gun/recipe ammo lists could fit
`he_100_of412` to the AZ owner. R2 independently reproduces the defect through
production `makeLoadout` and typed `MechanizedLoadingDef::valid_for` before
changing either resolver. Node RED:3 incompatible cases fail their assertions
and the compatible case passes. Native RED:the actual typed owner accepts the
foreign cartridge, failing its rejection assertion.

Both resolvers now accept only the authored compatible identities
`apfsds_125_3bm22`, `heatfs_125_3bk14`, `he_125_3of26`, in addition to the
existing fitted gun/mount/count/recipe checks. Matching foreign lists, mixed
lists with a foreign cartridge and an invented125mm alias cannot confer AZ
behavior. Authored subsets of the three supported identities remain valid.
The whitelist constrains cartridge identity. The gun bore remains125mm and
the APFSDS flight body remains44mm. Rust's ordinary W002 projectile validation
is unchanged and independently still rejects the100mm HE case.

Focused Node GREEN:6/6, including the immutable Root reproduction and APFSDS
control. Actual typed folder/owner GREEN:2/2, including W014/W002 separation and
all three compatible subsets. Full weapon/vehicle/combat/server native suite:
250 pass,0 fail, including the shipped-tree validator with zero issues.

Fresh actual server receipts use new paths:

- `target/t72a-r2-c2-native.json` — T72 canonical stock/caps/deploy/discharge,
  duplicate retry, empty rejection and five-second selected refill in both modes.
- `target/t72a-r2-gameplay-network.json` and
  `target/t72a-r2-ammo-network.json` — fresh existing20-source C2/APS receipts.

The complete unfiltered Node command consumes those exact current receipts:

```powershell
$env:TG_GAMEPLAY_NETWORK_RECEIPT='C:/Users/24908/.codex/scratch/tankforge-t72a-autoloader-20261012/target/t72a-r2-gameplay-network.json'
$env:TG_AMMO_RESUPPLY_RECEIPT='C:/Users/24908/.codex/scratch/tankforge-t72a-autoloader-20261012/target/t72a-r2-ammo-network.json'
$env:TG_T72A_RECEIPT='C:/Users/24908/.codex/scratch/tankforge-t72a-autoloader-20261012/target/t72a-r2-c2-native.json'
node --test client/web/test/*.test.mjs
```

Unfiltered result:793 tests,793 pass,0 fail,0 cancelled,0 skipped (94.87s).
Its counts are frozen with its log in
`target/t72a-implementation-checkpoint-20261012-R2.json`. No source assertions
are filtered or bypassed. The historical R1 receipt paths remain unchanged.

Matched release WASM, browser page and native server builds passed using the
documented scratch RUSTUP_HOME/CARGO_HOME and explicit esbuild binary, without
CARGO_TARGET_DIR/stack overrides. The named current outputs are
`target/t72a-r2-design.wasm`, `target/t72a-r2-range.html`,
`target/t72a-r2-artifact.html`, `target/t72a-r2-server.exe`.
The runtime WASM equals the compiled output and the named page contains that
exact WASM. The exclusive native lane was explicitly released after builds;
the remaining work uses Node/source verification only.

All57 R1 archive entries and15 original R1 target files were checked unchanged.
The original page, fragment, WASM and release server were copied and hashed
before any new build in `target/t72a-r2-preserved-r1-build-20261012`.
The preservation/build identity report lists the narrowly changed R1 paths:
JS resolver, Rust resolver, typed regression and rebuilt WASM. The new Node
regression and this note are additional source files. Original fleet/ammo/audio
and all other R1 sources remain unchanged.

Scope is still the approved real T72 fitted22-set owner. Capacity, sole C2
quantity/scope ownership, base8s choice, mode multiplier, dynamic mechanism/rack
damage, explicit two-piece milestones and three crew/no human loader remain.
No new conventional server cannon cadence authority, reserve transfer or
historical geometry/ballistics certification is claimed. Original research
estimate boundaries and the continuous-creep/planetary-pivot limitation remain.

No Sound or audio hook/asset changes, browser driving, paid generation, global
B2/physics changes, staging, commit, push or deployment. Automatic audio and
actual-ready lock routing stay in Root's separate audio handoff. R2 is frozen
for fresh SPEC, then QUALITY; it is not final acceptance.
