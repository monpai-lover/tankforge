# Single-player range target revival design

2026-10-12. This specification records the user's request for range targets to revive gradually and the root-approved concrete defaults. Work is confined to the TankForge worktree; the reference `tank` checkout is not part of this change.

## Accepted behavior

Only destroyed authored vehicle targets in the offline range revive. A target becomes eligible 15 simulation seconds after its death is first observed. The range revives at most one eligible target every 2 simulation seconds. Choose the oldest observed death first; use existing target-array order for ties. There is no burst catch-up after a long update. Living targets, including damaged living targets, retain their damage.

Time comes from the existing accepted game update `dt`, not `Date.now`, `performance.now`, a timeout, or background wall-clock time. The scheduler advances only when `G.mode === 'battle'`, `G.mapId === 'range'`, `!G.map`, and `!G.online`. Its target filter also requires `e.rangeTarget && !e.remote`. Pausing updates cannot revive a target. Leaving or recreating the enemy list clears the scheduler so an old target cannot revive in a later session.

Keep the target's slot, `combatKey`, `Enemy` object, model, loadout, settled hull body and firing lane. Revival does not call `spawnEnemies`, replace the fleet, or reset the player. The first eligible revival is allowed immediately at its 15-second boundary; subsequent successful revivals are separated by at least 2 seconds.

## Existing owners and rationale

`client/web/src/game/rangeVehicles.js` supplies eight authored rows. `main.js` owns `spawnEnemies`, `clearEnemies`, and the battle update. Each range actor already has a distinct stable `range:<slot>:<spec>` combat registration. `game/enemies.js` owns actor state and `useCombat`. `game/combat.js` provides `fresh`, returning independent module, crew, fire, repair and rack state from the shared Rust/WASM combat core.

Death can originate in cannon or bullet hits, missiles, splash, or `advanceCombat` fire progression. A centralized observer after `updateShots` and `updateBullets`, before scene collection, covers these paths without adding a timer to every damage branch. A focused `game/rangeTargetRevival.js` owns timing and the target-state reset adapter; `main.js` supplies the active-world gate and current combat object.

Rebuilding all targets would reset living targets and spend unnecessary mesh allocations. Setting only `alive = true` would leave killed crew, depleted racks, broken modules and fire in place. The accepted design reuses models and creates fresh combat state for only the selected actor.

## State and presentation restoration

Capture the target's rest articulation once after it is constructed and bound in `spawnEnemies`: turret node and gun/barrel local poses, target turret yaw arrays, gun pitch and fold. This snapshot contains node references and small copied pose values; it is not a new mesh or a new collision model.

On revival, synchronize the registration's rest fold and request `Combat.fresh` with the actor key and its source bundle. Install fresh `cstate/caps`, then use existing `useCombat` normalization. Restore `hp = 100`, `alive = true`, clear old hits, visibility cache and `toss`, restore rest node poses and call `Enemy.pose`. This restores the turret displaced/tilted by ammunition detonation as well as the dead gun droop. Core-owned rack fill, crew, repairs, fire and capabilities are reset together. Passive range loadouts and launcher bindings stay on their existing objects.

If the core has not loaded, restore the existing fallback target with `cstate/caps = null`. Late `bindCombatReady` must subsequently attach fresh state, as it already does for newly created targets. If a supplied core cannot return a fresh state, do not partially revive or consume the scheduler slot. Do not send a network message or change an online player's state.

Existing hit-camera replay owns a detached snapshot through `replayPose.js`; revival must not close it or alter its report, frozen articulation or retained mesh leases. Burning stops through fresh `alive/caps`. Existing short-lived world effects may finish naturally.

When later B/X lifecycle work is connected, revival must invoke its existing actor-life reset adapter once so broken-chain, deformed geometry and accepted pose generations also reset. This change does not duplicate B lifecycle implementation, invent an exact hitbox, or require B2 to start the current offline timer/reset feature. Exact geometry certification remains governed by the approved X plan.

## Acceptance and non-goals

Focused tests must prove the exact 15-second boundary, 2-second staggering, oldest-first order, no catch-up burst, unchanged living damage, all active-world exclusions, removal/re-entry cleanup, repeated death cycles and late-core readiness. Actual model/WASM tests must prove fresh crew/modules/racks/caps, restored tossed turret, stable objects/keys/lanes, no new mesh allocation on revival, independent other actors and unchanged frozen replay.

No new difficulty rule, target model, armor/ammunition calibration, server respawn behavior, player ammo refill, or design-bureau test range behavior is added. CPU/model tests are not a browser appearance receipt. Existing browser restrictions remain respected. Completion requires root's fresh specification and quality reviews and relevant regression results, not this planning document alone.
