# G weapon-control cycle design

Date: 2026-10-11. Original source examined: `633d668acda2c109ddb416d76c5af71ff30c6bfd` in `C:/Users/24908/.codex/scratch/tankforge-gameplay-modes`, including the delivered C1 offline ammunition work. Follow-up APS handoff investigation examined current worktree source with HEAD `9101104b98eba8e2b74964ea4324cafcd4cc0348` while C2's sole writer continued its authority work. This document records the user's prescribed behavior for root review; it introduces no user approval gate and changes no runtime or tests.

## Required behavior

G cycles deterministically through **ALL FIRE → first gun solo → second gun solo → every further mounted gun solo → first MG solo → every further MG solo → ALL FIRE**. A gun instance is one entry in `loadout.turrets[ti].guns[gi]`, including normal cannons, autocannons, APS cannons, and finite missile/rocket launchers. Identical weapon definitions mounted twice are two instances. Empty, damaged, or reloading weapons remain in the cycle. Every mounted instance appears once per cycle; ALL is a separate state, even though its sight uses the first gun as a reference.

The default after a fresh vehicle selection/deploy is ALL. Selection changes firing ownership and motor ownership together. In a gun solo, left click fires only that gun regardless of its original primary, secondary, or rocket trigger group. In MG solo, left click and N fire only that MG. Selecting an MG must not rotate or elevate any cannon turret. Changing between different turrets leaves the inactive turrets' motors at their previous poses.

## Source evidence and cause

| Current owner | Observed behavior | Required correction |
| --- | --- | --- |
| `client/web/src/game/weaponselection.js:nextSightWeapon` | Its cycle consists only of gun/MG sight references. First gun reference doubles as the default group state. | Store an explicit control mode distinct from the sight reference. |
| `client/web/src/main.js:cycleSightGun` | Updates `sightT/G/M`, cancels queued shots and ranging, and synchronizes APS. | Cycle the explicit mode, derive a valid sight context, and show a unique mode label. |
| `main.js:trigger` | Traverses every gun, classifies an autocannon as secondary according to the current sight turret, and isolates only the selected APS turret. | Use explicit selection plus intrinsic group/APS role to decide eligibility. |
| `main.js:aimTurrets` | Every turret and every gun elevation chases `G.aimPoint`; selected coax adds a special convergence target for the main cannon. | Lay only owned motors; remove coax-driven cannon laying in MG solo. |
| `main.js:trackHull` | Maintains gyro/gunner histories later used to drive yaw/elevation compensation. | Rebase held mounts without motor movement; do not replay stale compensation when reselected. |
| `main.js:layMg` and `stepMachineGuns` | All flexible MGs auto-lay every step; a coax muzzle is correctly rigid with the first cannon. | Gate flexible joint movement by ownership while retaining rigid coax geometry. |
| `main.js:apsAutomatic`, `syncApsControl`, `applyAps` | Automatic APS is suppressed only when its own sight is selected; snapshots can overwrite its yaw/pitch in other selections. | Suppress automatic ownership for every solo state and reject automatic pose writes while held. |
| `main.js:update` rotary spin, model, camera, reticle, HUD blocks | Spin derives from sight turret; highlighting derives from sight indices; actual MG reticle already projects its muzzle direction. | Use control ownership for spin/highlighting, retain actual muzzle/optics projection, and display a persistent control label. |

The causal issue is shared use of sight indices as a partial control policy. Changing only the G sequence or `trigger` leaves the other motor and APS writers active. This was a read-only source investigation; no browser reproduction, runtime test, or native build was run by this document writer.

## Control and sight state

Use a discriminated object on `G.weaponControl`:

```js
{ kind: 'all' }
{ kind: 'gun', ti: 0, gi: 0 }
{ kind: 'mg', mi: 0 }
```

Keep `G.sightT`, `G.sightG`, and `G.sightM` as derived compatibility references for existing optics, ammunition selection, camera placement, and rangefinder context. ALL resolves to the first available gun; gun solo resolves to that exact gun; MG solo resolves `sightM` to its MG while retaining the first available gun's valid turret/gun context. Runtime loadouts currently always provide a main gun. The pure helper handles an empty slot list without modulo-zero or a fabricated selectable weapon.

The UI identifies control by `all`, `gun:ti:gi`, or `mg:mi`. ALL highlights no solo row. Gun/MG solo highlights exactly its row; the first gun must be represented too. The persistent labels are `全炮開火`, `炮塔 1 · 火炮 1 單獨開火`, and `機槍 1 · <weapon name> 單獨開火`, with indices disambiguating identical mounts. The ALL label and first-gun label must differ even when sight indices match.

On G, retain held-input state, cancel all not-yet-fired `G.pending` entries and the active ranging job, derive the sight references, reset zoom as today, rebuild the current ammo selector, then synchronize APS before a newly selected manual APS gun can fire. The next actual input frame routes a still-held trigger to the new mode. Already fired projectiles and already sent launch requests retain their original instance and life scope. Selection never initializes ammunition, loaders, belts, heat, launcher tubes, damage, or repair.

## Firing policy

“全炮開火” means ALL left click fires the ordinary primary cannon group. N preserves the secondary MG battery and secondary gun group; R preserves the existing one-rocket-per-press behavior. An ordinary unmarked autocannon is primary irrespective of which turret supplies the sight. An APS-owned cannon is its existing automatic/secondary role, and is not promoted into the primary group.

| Mode | Left click | N / secondary hold | R |
| --- | --- | --- | --- |
| ALL | All ready/damage-eligible ordinary primary guns | Existing MG battery and explicitly secondary guns; manual APS cannon when automatic APS is off | One ready rocket from the existing rocket group |
| Gun solo | Exactly selected gun, including an originally secondary or rocket gun | Only the selected gun if it is secondary, an autocannon, or the APS cannon; no MGs | Only the selected gun if it is a rocket; no other rail |
| MG solo | Exactly selected MG | Exactly selected MG | No weapon launch |

ALL preserves existing readiness, launch interval, duplicate pending suppression, off-sight on-target checks, fire staggering, damage/crew/repair gates and online-dead/disconnected checks. Solo retains those gun-specific checks but never considers another gun or MG for dispatch. `fireGun(ti,gi)` also checks selection before consuming stock, protecting against an obsolete queued action or delayed local call. An already admitted online launch ACK remains an ACK for the original request, rather than a fresh `fireGun` action; changing selection cannot undo or remap it.

The rotary spin update must use the same eligible trigger policy: holding left click for a selected APS cannon spins it, while other rotary guns run down naturally. Reloading, cooling and any already active normal loading job continue for inactive weapons. No stock or readiness reset occurs on selection.

## Motor hold and physical attachment

Hold is defined in **the mount's parent frame**, not as a magical fixed world direction. Inactive turret traverse and inactive gun elevation remain at their prior motor angles. Hull translation, heading, pitch and roll still physically carry every attached weapon. For an inactive child turret on a moving selected parent, its hull-frame `G.T[child].yaw` changes only by the parent's yaw delta; `child.yaw - parent.yaw` remains constant. Selecting the child freezes the parent's motor. For two guns sharing a turret ring, selecting either may move that shared ring and therefore physically carries its sibling; the unselected sibling's own elevation stays fixed. No independent ring or coax swivel is invented.

Apply parent carry before the motor gate in `aimTurrets`. Then the active turret alone calls gunner/gyro tracking and traverse. Within it, only the selected elevation motor advances in gun solo. In ALL, ordinary mounts keep existing cooperative laying. Automatic APS is a separate writer only in ALL while requested; `aimTurrets` must not race it with camera-driven laying.

For a held turret, rebase `seen`, `hand`, `prev`, drive/history/clock and `lay` tracking to the current hull attitude without changing physical yaw or pitch. Clear inactive gun `lay` accumulators without resetting their elevation. This prevents accumulated hull correction or an old stabilized target from producing a delayed snap after G. On return to ALL or reselection, an owned motor starts from its actual current pose and advances at its existing rate/limits. A direct held `trackHull` call must also satisfy this contract.

Flexible MGs hold their own yaw/elevation joints when inactive. A turret-anchored pintle's hull-frame aim yaw receives only its parent's carry delta so its rendered local yaw stays fixed; a hull-anchored pintle/hull MG remains in the hull frame. A selected hull/pintle MG slews within its real arcs and damage-adjusted rates. Coax MG solo never calls the main turret/elevation motors: its bore remains the actual rigid cannon bore. Hull steering can change that bore naturally. It remains manually fireable at that actual direction even when the camera looks elsewhere.

## Actual aim, optics and ranging

Keep `sightMuzzle`, `mountOf`, `pivotOf`, the rigid-body world transforms, `currentLos`, and `optics.sightProjection` as the source of actual muzzle and optic geometry. MG sight reads may compute the muzzle but must not move a joint. Preserve the existing chosen MG zero and ballistics table for a flexible MG. A fixed coax's zero affects its displayed ballistic graticule, not a fictitious independent actuator or the held cannon pitch.

The reticle must remain at the projected actual bore-minus-zero line with muzzle-to-camera parallax. In a fixed coax solo, mouse motion moves the view while the bore marker can remain off-center; never fake convergence by setting the marker to the camera center. Keep `currentLos().from` at the selected muzzle. Rangefinder equipment, delay, seeded error, distance limits and existing first-turret compatibility context are unchanged. Verify roof, hull and coax muzzle/bore against the actual model transforms on flat and pitched/rolled hulls, including parent carry.

## APS ownership and C1/C2 boundary

For both `su_t10m` and `su_t10m_oplot23`, automatic APS is effective only when `weaponControl.kind === 'all'` and the saved U preference is on. Every solo state temporarily inhibits automatic tracking/fire so an inactive APS turret cannot rotate against hold. Selecting its gun gives it manual left-click ownership. U still changes the saved preference while inhibited; Y retains rate choice and the C1 normal-loader readiness gate. Returning to ALL resumes only if U is on, the normal loader is ready, and existing stock/damage/crew/radar/thermal/spin gates allow it. Reacquisition and spin-up remain real; return does not create immediate interception.

Use the existing `aps` control message to send the effective desired automatic flag before manual discharge. Continue sending no client ammunition grant. Ignore automatic yaw/pitch writes from an old enabled snapshot in any solo, while preserving the C1 shared finite stock reconciliation, heat/spin/rate state, and HUD snapshot handling. Do not remove/re-add the APS object merely to hold it.

### Verified ALL-resume pose gap

The follow-up source trace proves a real pose handoff gap; inhibiting `applyAps` only during SOLO is insufficient:

| Current source | Evidence |
| --- | --- |
| `crates/missile/src/world.rs:378–387`, `World::set_aps_rounds` | Changes enabled/rate/count only; it never adopts the current manually controlled or carried yaw/pitch. |
| `world.rs:762–789`, `step_aps` | Disabled stepping cools the barrels, clears tracks, spins down, and returns before the servo block. The APS retains its old world yaw/pitch while the client can carry or manually move its real mount. |
| `world.rs:978–994` | Re-enabled automatic stepping advances from that stale world pose toward the parent's current bearing or a target by at most one bounded servo step. A finite servo rate bounds this movement from the old pose, not from the actual held pose. |
| `crates/server/src/missiles.rs:207–219`, `actor_of` | Supplies pivot and `heading + parent yaw`, but no adopted manual child joint yaw/elevation. Existing State acceptance at `lobby.rs:1193–1214` validates position, not the APS motor angles inside `tur`. Raw accepted packet presence is not mechanically validated pose evidence. |
| `client/web/src/game/missiles.js:125–127` and `crates/design-wasm/src/lib.rs:216–229` | The offline control bridge likewise forwards only enabled/rate/rounds. |
| `client/web/src/main.js:2595–2598`, `applyAps` | Once ALL allows automatic ownership, it directly assigns the old native world's yaw/pitch to the displayed turret/gun. An enabled snapshot generated before the transition can also arrive before the server has processed a new resume. |

For example, native automatic yaw 0 remains world-oriented while a SOLO moves the hull and parent by .9 rad and manually leaves the child at a further .4 rad. Resuming ALL can replace the actual 1.3 rad world bearing with approximately 0 plus one native servo step. This is a visible pose jump even though the native servo itself stayed rate-limited. No runtime test or native command was used for this finding; it follows from the setter, disabled early return, lack of joint adoption, and client pose assignment.

### Required bounded pose handoff

A narrow native missile/control change is required for both offline WASM and the server. Before automatic ownership resumes, the existing APS owner must adopt the **current accepted, mechanically valid bound gun pose**. The world keeps one APS object and one automatic servo owner; this is a pose synchronization at that owner's transition, not a second lifecycle or ammunition authority.

1. Resolve the APS's exact gun binding and parent from the existing authored vehicle/capability data. Validate finite local joint yaw/elevation, the authored traverse/depression/elevation limits and damage-adjusted manual movement rates against the previous accepted pose using trusted elapsed time. Physical parent/hull carry changes world bearing without consuming the child's traverse allowance. The server derives the handoff from its accepted and normalized State `tur` for the current life, not an arbitrary client world yaw or a client-created pose/grant. Offline derives the same bound pose from the actual runtime mount.
2. Convert that valid motor pose to the native world's yaw/pitch with the current hull/parent transform, and seed the same APS object's `yaw`, `pitch`, `yaw_cmd`, and `pitch_cmd` before enabling its existing automatic servo. The inverse snapshot-to-motor conversion must round-trip the accepted held pose, including hull pitch/roll, rather than confusing world pitch with a local elevation angle. Validate and apply resumed mechanical limits in that same joint frame; a wrong-frame post-step clamp at a tilted mechanical stop cannot jump the gun beyond its motor rate. A shared conversion contract and actual bore tests prevent a coordinate-induced jump.
3. Synchronize accepted held pose while disabled, or at each real disabled-to-enabled transition, including ALL after gun solo, ALL after a selected-parent carry, U-on in ALL, and the existing normal-loader gate becoming ready. Never continuously reseed an already enabled automatic servo from delayed client State, which would fight its owner. Rejection of malformed/out-of-arc/impossibly fast/current-life-mismatched pose leaves automatic activation inhibited until a valid current pose is available.
4. At adoption preserve finite ammunition, C2 ledger/scope/revision, belt/tubes, loader work/deadline, heat, spin, requested rate, overheat state, damage/repair and saved U intent. Natural disabled cooling/spin-down and track reacquisition remain valid; adoption itself does not reset them, recreate the APS, shoot, or make loading complete.
5. Before online resume, publish the existing State payload containing the final held pose ahead of the APS enable request on the current ordered transport. Use the existing battle/life scope and server snapshot `tick` for an accepted-pose barrier/correlation in the APS control path. The client holds its pose until that handoff is acknowledged, then accepts only snapshots generated after the barrier; an old enabled snapshot must not overwrite the pose in the gap immediately after G. These narrow acknowledgement/filter fields are transport synchronization metadata, not a new mode/life counter or stock authority. Exact field spelling is reconciled with the completed C2 protocol at execution; the accepted-pose and stale-snapshot rejection contract is mandatory.

C1 `ammoPlan`, resupply timing, empty-belt wakeup, ordinary loader completion, payload visibility from actual `launcher.ready`, repair/damage gates and stock conservation remain intact. C2 battle/life/revision handling continues binding each shot/launch to its original `gun:ti:gi` or `mg:id` and original scope. The handoff creates no client ammunition grant, resets no C2 fields, and adds no seat feature.

## Required evidence

The implementation plan must first establish meaningful failing Node tests using the current live handler extraction pattern, then make them pass with surgical changes. Coverage includes two cannons on one ring and different rings; repeated complete G cycles; primary/secondary/rocket solo routing; held-fire selection; old pending cancellation; inactive yaw and pitch; a selected child and a carried inactive child; hull motion and stabilized reselect; roof, hull and fixed coax MG; actual bore/reticle/rangefinder origin; both APS variants in historical/casual modes; old automatic snapshots; saved U intent; shared stock/normal reload/resupply/repair; source vehicles and actual Hetzer turret swaps; and real existing online fire/launch handler compatibility.

A root-owned acceptance run executes the focused suites and full current Node suite, checks source/build identity and unchanged original assets/older named pages, and obtains fresh specification and quality review. Add actual offline/native handler evidence for parent/hull carry and manual APS pose followed by ALL, U-on and normal-loader-ready resume: first adopted pose equals the held pose, subsequent movement is rate-limited from it, and no old snapshot wins before the acceptance barrier. Cover both APS variants/modes, invalid joint poses, repeated transitions, repair/reload and unchanged stock/heat/spin/rate/U intent. This native handoff requires fresh current-source WASM plus regenerated source-tagged actual-handler receipts, produced after C2 in the sole native lane; previous receipts remain historical evidence. Browser/HTTP/CDP/Playwright status remains NOT RUN under the existing restriction; numeric/handler evidence does not claim rendered gameplay acceptance.

## Resolved routine interpretations

1. N/R in solo may never select or launch a different weapon; the exact selected weapon retains an appropriate dedicated-key alias as shown in the table.
2. Shared rings and parent attachment carry are physical movement, while unused motors hold locally. This reconciles solo hold with the existing vehicle hardware.
3. ALL includes ordinary primary autocannons across turrets, while the APS cannon keeps its secondary/system role.
4. Held inputs retarget on the next frame after G; unsent pending work is canceled and already sent work retains its original binding.

These are concrete implementation judgments for root review, not unanswered user questions or extra approval conditions.
