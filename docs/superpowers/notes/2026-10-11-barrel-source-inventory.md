# Barrel damage source inventory — independent Root preparation

2026-10-11,TankForge. Read-only input to X/P2/P4/P5;the visible fracture feature
is **not implemented**. External inventory script and detailed JSON:
`C:/Users/24908/.codex/scratch/tankforge-root-barrel-inventory.mjs` and
`tankforge-root-barrel-inventory.json`. Source data and original buffers unchanged.

## Actual loaded inventory

Fresh script exit0 against all42 stock loadouts and the existing P1-era WASM,
SHA256 `2bd8feef65e8f00e0da988092ccf8aa5d334719e88f0dc1d45553fef753c8524`.
This is explicitly the existing binary,not a new B2/native release.

-47 mounted gun/launcher instances:42 nonmissile,5 missile;45 secondary MG
  entries are listed independently.
-No binding errors reported by the existing normalized combat registration.
-12 gun/launcher instances have imported `mount:barrel` parts;27 have procedural
  recoiling `mount:gun` parts. This inventories render assembly,not certified
  physical material/solid regions.
-Three nonmissile instances have neither of those separate sets:Hetzer MK103,
  its camouflage variant,and Sd.Kfz.140/1. Their imported elevating gun assembly
  needs a reviewed barrel-only derivative partition;this does not imply the
  original barrel is invisible or the model is absent.
-The five missile launchers also lack those sets,as expected for their actual
  launcher/payload assembly. Do not manufacture cannon barrel/breech anatomy.
-15 bundles load local packed JSON.27 declare GLBs and use the source loader's
  procedural/runtime path here. No declared `.json` path is missing in this
  inventory. This says nothing about separate reference GLB availability or
  other previously audited raw authoring inputs;do not label these27 game models
  unavailable or overwrite the X source-availability ledger from this result.

## Authority binding probe and a multi-barrel exception

The external diagnostic clones each fresh module health array,sets one existing
barrel/APS part to zero,and calls the actual WASM advance at dt0. It records
which healthy weapon keys become disabled. This tests health binding only;
it is not a physical barrel hit,fracture event or accepted damaged geometry.

Main T-10M `gun_barrel` disables only `gun:0:0`;Oplot `oplot_gun` is `aps_gun`
and disables only `gun:1:0`. The Oplot imported barrel parent has three source
pieces and its visual assembly is multi-barrel,but source weapon metadata has
no explicit barrel-count field. Never default that field to1 or infer a trusted
solid count from its ID. X's reviewed derivative partition must supply physical
barrel IDs,including their outer/bore/retained-fracture regions.

Consequently a real barrel surface cannot be selected only by
`ModuleKind::GunBarrel`. Secondary MG barrel modules use `machine_gun` plus a
specific normalized barrel ID;Oplot's critical module uses `aps_gun`. Use
accepted physical role/solid→mounted weapon/module binding,then preserve the
existing capability law. A hit to the receiver,APS mechanism or breech must not
pretend to break all exterior tubes.

Hetzer's `gun_barrel` and `mg:roof_mg34:barrel` independently disable main gun
and roof MG. The new Sd.Kfz.140/1 head's main barrel and `mg:coax_mg42:barrel`
are also independent. M46 and KDA primary barrel health each disables their own
gun instance. All original assemblies/buffers must remain immutable while
fracture derivatives and replay snapshots retain their own leases.

## Runtime metadata seam

`combat_target` currently exports normalized module definitions and binding
errors,but not the authoritative critical-part→weapon binding table. Many
normalized cannon modules have no explicit `weapon_group`;this does **not**
mean registration lacks a valid binding. The health mutation above is an audit
method,not a runtime binding algorithm. Expose the existing registration's
stable selected module IDs/weapon keys in the trusted anatomy/pose metadata
when X/P2/P5 need them;rereading labels,nearest trunnions or mutating health
to discover owners during rendering is inappropriate.

P4 must implement the intake note's fracture/repair/replay requirements for
procedural tubes,imported dedicated barrel parts,imported mixed elevating gun
parts,MG receiver/barrel composites,and multiple tubes on one weapon. The
authority event needs the accepted physical barrel ID/contact/severity/seed
and shape/repair revision. Scalar `can_fire:false` alone remains insufficient.
