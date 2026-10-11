# Capture-Point Ammunition Resupply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Execute two functional code checkpoints below, with one fresh runtime writer for each checkpoint. The coordinator dispatches a fresh SPEC reviewer, then a fresh QUALITY reviewer, repairs their findings, and accepts the checkpoint before starting the next. Delivery belongs to the root coordinator. User approval of the five-second design is recorded on 2026-10-11; do not ask another implementation-choice question.

**Goal:** Refill every finite weapon inventory to the selected deployment load after five continuous seconds inside a completely friendly, uncontested captured point, identically offline and through online server authority.

**Architecture:** Small pure inventory and dwell owners drive offline actors without resetting loading or damage. A native per-mounted-instance/per-type ledger supplies the online truth, including the shared manual/automatic APS pool; versioned absolute inventory messages reconcile cannon predictions and acknowledged missile launches. Main, conquest, deploy, networking, and lobby remain integration owners rather than duplicate inventory implementations.

**Tech Stack:** Existing dependency-free JavaScript/WebGL2, Node test runner, Rust/serde, WebSocket, and the current tg-design-wasm core. No new package installation or browser/native-UI automation.

---

Accepted specification: `docs/superpowers/specs/2026-10-11-ammunition-resupply-design.md`. Worktree: `C:/Users/24908/.codex/scratch/tankforge-gameplay-modes`; branch: `codex/capture-point-ammo-resupply`; plan-start HEAD: `5ff6856`, with runtime from `f66c04a` / accepted range-reset work. Keep the already accepted reset/keyboard behavior. This plan does not implement the pending historical steering proposal.

## Boundaries and file ownership

| File | Responsibility |
| --- | --- |
| Create `config/ammo-resupply.json` | Shared five-second duration, one-second accepted-pose freshness, and ammo protocol version; independent of gameplay rules version 1. |
| Create `client/web/src/game/ammoInventory.js` | Capture selected targets, enumerate finite gun pools, absolute count application, normal empty-weapon reload activation, and APS declaration-order consumption. |
| Create `client/web/src/game/ammoResupply.js` | Pure eligibility and one accumulator per actor; no DOM, network, loading, or damage calls. |
| Create `client/web/src/game/onlineAmmo.js` | Battle/life/revision validation, confirmed base counts, pending cannon overlays, processed-sequence coverage, and resupply progress. |
| Modify `client/web/src/game/loadout.js` | Separate acknowledged launcher readiness/cooldown transition from its optional ammo consumption; keep existing offline callers compatible. |
| Modify `client/web/src/game/deploy.js` | Serialize the already fitted chosen mix by mounted key; do not reload a live vehicle to resupply it. |
| Modify `client/web/src/game/net.js` | Ammo capability handshake and strict inventory-envelope admission. |
| Modify `client/web/src/game/onlineFire.js`, `onlineLaunch.js` | Reconcile replies with the inventory owner; preserve cannon prediction versus ACK-only missile consumption. |
| Modify `client/web/src/main.js` | Thin offline actor integration, live keyboard/unload conservation, HUD/payload/rack refresh, online lifecycle/discharge wiring. |
| Modify `crates/gameplay/src/lib.rs` | Parse/validate the new policy bytes and expose typed constants; leave existing mode registry/version untouched. |
| Create `crates/server/src/ammo.rs` | Trusted catalog, immutable selected targets, mutable counts, projections, terminal request coverage, and native resupply helpers. |
| Create `crates/server/src/ammo_tests.rs` | Actual lobby/discharge/capture/resume test scenarios and mandatory source-tagged resupply receipt. |
| Modify `crates/server/src/lib.rs`, `lobby.rs`, `server.rs` | Module hookup, capability and scoped protocol, authoritative mutation/projections, fresh server clock/pose guard, and receipt emission. |
| Modify `crates/server/src/gameplay_tests.rs` and its Node receipt consumer | Modernize protocol setup and regenerate genuine current-source coverage without deleting substantive assertions. |
| Create focused Node tests listed in each checkpoint | Real loadout/loading and extracted live main handlers; actual native messages for online integration. |
| Root creates `target/ammo-resupply-verify.mjs` | New current-source/build/asset/freeze verifier, replacing neither old receipts nor old verifiers. |

Do not edit `data`, `schemas`, imported/packed/GLB models, source weapon definitions, original named pages, or the separate dirty B2 checkout. Do not run global vehicle/model generators. Secondary machine guns currently have infinite replacement belts; keep their ordinary belt, heat, cooldown, and reload behavior. The finite ledger covers mounted `turrets[].guns[]`, including autocannons, rockets, multi-tube missiles, and either Oplot variant.

## Exact contracts agreed before implementation

### Shared policy and actor eligibility

Create these exact registry bytes:

```json
{
  "ammo_protocol_version": 1,
  "resupply_seconds": 5,
  "pose_max_age_seconds": 1
}
```

JS imports this JSON from both new owners. Rust includes `../../../config/ammo-resupply.json` from `crates/gameplay/src/lib.rs`, validates these exact keys and finite positive timings once, and exposes `AMMO_PROTOCOL_VERSION`, `RESUPPLY_SECONDS`, and `POSE_MAX_AGE_SECONDS`. Do not multiply dwell by casual fire-rate factors.

The pure JS contract is below; the eligibility body is complete and the dwell body is supplied immediately afterward:

```js
export function newResupplyState() { return { elapsed: 0 }; }
export function eligiblePoint(points, actor) {
  if (!['blue','red'].includes(actor?.team) || !Number.isFinite(actor.x) || !Number.isFinite(actor.z)
    || !actor.alive || !actor.deployed || !actor.connected || !actor.active) return null;
  const sign = actor.team === 'red' ? -1 : 1;
  const enemy = actor.team === 'red' ? 'blue' : 'red';
  const point = (points || []).find(p => Number.isFinite(p.x) && Number.isFinite(p.z)
    && Number.isFinite(p.r) && p.r > 0 && Number.isFinite(p.progress)
    && Number.isInteger(p[enemy]) && p[enemy] === 0
    && p.owner === actor.team && p.progress * sign >= 1
    && Math.hypot(actor.x-p.x,actor.z-p.z) <= p.r);
  return point?.id ?? null;
}
```

`actor` is `{team, x, z, alive, deployed, connected, active}`. Reject nonfinite position/dt and invalid team. Eligibility requires all four booleans, distance <= radius, `owner === team`, `progress * (team === 'red' ? -1 : 1) >= 1`, and zero opposing effective occupants. `points` carry the existing `{id,x,z,r,owner,progress,blue,red}` fields. Return the first eligible id only for display; dwell is actor-owned, and changing directly between overlapping eligible circles does not restart or multiply it. No stationary/brake requirement.

```js
export function stepResupply(state, dt, eligible, missing) {
  if (!Number.isFinite(dt) || dt < 0) throw new Error('Invalid resupply dt');
  if (!eligible || !missing) { state.elapsed = 0; return {progress: 0, complete: false}; }
  state.elapsed = Math.min(RESUPPLY_SECONDS, state.elapsed + dt);
  const complete = state.elapsed + 1e-9 >= RESUPPLY_SECONDS;
  const progress = Math.min(1, state.elapsed / RESUPPLY_SECONDS);
  if (complete) state.elapsed = 0;
  return {progress, complete};
}
```

Finite inventory targets are captured once after `applyAmmo` at life creation, never recaptured after shooting or resupply:

```js
// The gun capacity is a total across types; targets are this life's fitted chosen mix.
// count includes the breech round, belt rounds, and loaded launcher tubes.
{
  'gun:0:0': { ammo: ['apt_25_br132p','hefi_25_ozr132'], targets: [420,420] },
  'gun:0:2': { ammo: ['he_420_tt250'], targets: [1] },
  'gun:0:3': { ammo: ['he_420_tt250'], targets: [1] }
}
```

`ammoInventory.js` exports `captureAmmoPlan(loadout)`, `ammoMix(loadout)`, `needsAmmo(loadout, plan)`, `refillAmmo(loadout, plan, loadings)`, `applyAmmoCounts(loadout, counts, loadings)`, and `consumeApsRounds(loadout, instance, rounds)`. `loadings[ti]` is the existing `loading` object for that turret. `refillAmmo` changes only counts that are below targets and returns changed mounted keys. Both count application functions call a private `wakeEmptyGun(g,L,gi)` only for `L.state[gi] === 'empty'` with positive new inventory. It uses existing `loading.fired(L,gi)`; if an autocannon belt is zero, set `beltChange=true` to retain the full belt-change cycle. Do not call `applyAmmo`, `refillLauncher`, `newLoading`, or `newMg` in a resupply mutation.

An empty Oplot also requires its normal belt-change cycle before **automatic** interception can use replenished rounds. Keep requested automatic control separate from effective enabled state. Offline `apsAutomatic()` continues to represent `G.apsOn` and sight selection; do not flip the U preference because a reload is in progress. The effective local world flag is requested-on **and** the bound gun's existing loader state is `ready`. Local enemies retain `e.apsDesired` separately and use their `e.ammoLoading[ti]` readiness. Refresh effective state through existing `setAps` after a grant and before every local missile-world step, and restore it once the normal loader finishes. Do not fake module damage or recreate APS objects.

```js
const desired = apsAutomatic();
const ti = G.aps.turret ?? 1;
const effective = desired && G.T[ti].loading.state[0] === 'ready';
G.missiles.setAps(ME,effective,null,roundsLeft(G.loadout.turrets[ti].guns[0]));
// Online sends user intent; the server owns its effective reload gate.
if (G.online) net.send({t:'aps',enabled:desired});
```

Use the same effective gate in the rate-change path and local enemy APS controls. `apsOf` keeps actual damage capability independent from loading; a temporary reload does not turn a healthy gun into an APS Fault. The existing disabled-world path clears target tracks and allows normal cooling/spin-down. Consequently record tracking reacquisition and normal spin-up after re-enabling; do not claim preserved radar lock or frozen thermal/spin state. Preserve the existing object's yaw/pitch, requested rate, counters and damage, with no reset of heat or spin at the grant.

### Online wire, ledger, and projections

Keep `GAMEPLAY_RULES_VERSION === 1`. Add separate `ammo_protocol_version:1` to hello/welcome and room/start/respawn envelopes. Missing, noninteger, or unsupported capability cannot join/create/resume an online battle; emit the current-style update-needed error before moving a held seat or changing a room. Archived clients remain immutable and receive a clear online incompatibility error.

Use `AmmoScope { battle: u64, life: u64 }` in discharge requests and terminal accepted/rejected replies, serialized as `ammo_scope:{battle,life}` alongside the existing `seq`. The owner Launched reply also carries its original scope. `battle` is a unique monotonically allocated battle number on the lobby, assigned at Start; `life` increases only on deployment/spawn. Transport resume retains both. Make all wire counters JavaScript-safe integers, refuse wrap/exhaustion rather than silently reuse them. Cannon, launcher, and sequence-bearing `mg_fire` requests share the monotonic discharge sequence.

```json
{"t":"deploy","vehicle":"su_bmpt34","spawn":0,
 "ammo_mix":{"gun:0:0":[420,420],"gun:0:1":[420,420],"gun:0:2":[1],"gun:0:3":[0]}}
```

Use `ammo_mix` on Vehicle as well, so non-deploy room Start/Respawn uses the same validated saved plan. Reject malformed present mixes atomically before changing the player. Every known mounted gun must appear exactly once, with exactly one nonnegative integer per authored ammo entry; reject unknown keys, unknown types through the catalog, excess length, fractions, coercible strings, overflow, and per-gun sums above capacity. Omitted whole mix means authoritative source defaults only, for genuine server fixtures and default callers. A present empty/incomplete mix is an error, never a request for default inventory. Do not accept live ammo mix edits.

```rust
pub type AmmoMix = BTreeMap<String, Vec<u32>>;
pub struct AmmoCatalog { pub guns: BTreeMap<String, AmmoGunSpec> }
pub struct AmmoGunSpec {
    pub ammo: Vec<String>, pub defaults: Vec<u32>, pub capacity: Option<u32>,
    pub missile: Option<String>, pub aps: bool,
}
pub struct AmmoLedger {
    pub scope: AmmoScope, pub revision: u64, pub processed_through: u32,
    pub targets: AmmoMix, pub counts: AmmoMix,
}
impl AmmoCatalog {
    pub fn from_target(target: &tg_combat::Target, aps: Option<&crate::missiles::ApsSpec>) -> Result<Self,String>;
    pub fn validate_mix(&self, mix: Option<&AmmoMix>) -> Result<AmmoMix,String>;
}
impl AmmoLedger {
    pub fn new(scope: AmmoScope, targets: AmmoMix) -> Self;
    pub fn missing(&self) -> bool;
    pub fn spend(&mut self, catalog: &AmmoCatalog, instance: &str, ammo: &str) -> Result<(), &'static str>;
    pub fn consume_aps(&mut self, catalog: &AmmoCatalog, spent: u32) -> Result<(), &'static str>;
    pub fn refill(&mut self) -> bool;
    pub fn terminal(&mut self, seq: u32) -> Result<(), &'static str>;
}
```

`from_target` traverses `main_gun`, `extra_guns`, and `extra_turrets[].guns` exactly as `makeLoadout` does, and cross-checks stable mounted bindings and their ordered allowed ammo IDs. Count defaults match the existing JS/Rust 40-per-type fallback. Explicit zero is finite zero. Preserve genuine legacy unknown-capacity behavior when the loaded `Target` has unknown zero capacity and omitted counts; an unknown pool is excluded from finite targets/counts and replenishment, never inferred to contain a new finite stock. A client-present mix specifying that unknown pool is rejected because no trusted capacity exists; it cannot convert unknown `None` into new finite rounds. Omitted legacy fixture plans keep their prior unlimited inference without a refill grant. Identify APS ownership through its bound critical gun module, not caliber, projectile ID, or guessed turret label.

There is one pool per mounted gun. Both BMPT rails remain separate. Manual APS spends the selected type from its binding pool; automatic world consumption drains that same pool in declaration order. The following are read-only projections recomputed from that ledger:

| Projection | Exact meaning |
| --- | --- |
| `Player.rounds` | Non-APS finite gun sum; manual/automatic APS does not change it. Keep legacy unknown `None` inference where applicable. |
| `Player.missiles_left` | Sum of finite launcher bindings grouped by missile ID; never used instead of the selected mounted pool to authorize discharge. |
| APS world `rounds` | Sum of the APS binding's remaining types, bounded by its source magazine. |
| Combat rack-fill | Every finite mounted gun's remaining count summed once, including APS, against the existing target ammo capacity; do not double-add breech/belt/tubes or a second APS pool. |

Combat rack occupancy continues to use existing `tg_combat::load_ammo` and source rack geometry. This is its existing aggregate occupancy projection, not a claim of exact per-shell rack placement. Source authored zero racks remain empty. Do not replace combat state, capability/damage state, or the APS object to synchronize ammunition.

```json
{"t":"ammo","ammo_protocol_version":1,"battle":7,"life":2,"revision":12,
 "processed_through":41,
 "counts":{"gun:0:0":[419,420],"gun:0:1":[420,420],"gun:0:2":[1],"gun:0:3":[0]},
 "targets":{"gun:0:0":[420,420],"gun:0:1":[420,420],"gun:0:2":[1],"gun:0:3":[0]},
 "resupply_progress":0.5,"refilled":false}
```

Targets travel on initialization/resume and remain validated against the same binding catalog in client admission; progress is authoritative online. Increment revision on initialization, each new terminal discharge outcome (including rejection with unchanged counts), every automatic APS consumption batch, every resupply progress change/reset, and each grant. Progress-only updates always receive new revisions; do not send them with duplicate revisions that the count owner discards. Emit absolute inventory to its owning player after each such revision; do not grant from capture messages, arbitrary snapshots, or client requests. A new life initializes revision/processed coverage within a new scope.

For new requests in the current scope, require `seq > processed_through`. Finalize every accepted or rejected discharge as a terminal outcome; all sequences <= coverage are either processed or permanently too old. A previously unknown out-of-order lower request is finally rejected and cannot later be accepted. Known retries replay a bounded cached outcome without a second spend, revision bump, cooldown change, or fresh grant. Preserve existing accepted-shot/hit proofs and launcher request fingerprint checks. Cache at most the room's existing sequence capacity; expired/evicted outcomes remain retired through coverage. Old battle/life requests cannot advance current-life coverage or mutate counts. Existing missing/legacy request scopes in baseline fixtures must be modernized, not silently authorized in production.

Absolute counts become the client's confirmed base. Overlay only pending cannon predictions whose sequences exceed `processed_through`; missile requests have no predicted count spend. Process receipt effects once, independently of count adoption: a late launcher ACK can still animate/guide and advance tube readiness once, but cannot subtract again from an already covered authoritative count. A late rejected cannon removes its predicted projectile without returning a round already present in the confirmed base.

## Checkpoint 1 — playable offline resupply and ammunition conservation

**Create:** the config and two pure client owners above; `client/web/test/ammo-inventory.test.mjs`; `client/web/test/ammo-resupply.test.mjs`; `client/web/test/ammo-resupply-runtime.test.mjs`.

Also create `client/web/test/ammo-resupply-aps.test.mjs` for the real WASM incoming-missile reload gate, using `loadCoreSync` and the actual `mw_aps`/`mw_step` calls as in the existing Oplot verifier. No substitute APS simulation is permitted in that test.

**Modify:** `client/web/src/main.js`; `client/web/src/game/deploy.js` for initial selected-load belt clamping; `client/web/src/game/loadout.js` only if the acknowledged readiness split is introduced here; `client/web/test/range-ammo-reset.test.mjs` only to supply new lifecycle dependencies while preserving its assertions.

- [ ] **1. Write complete RED vectors using real loadouts.** Import `loadData`, `makeLoadout`, `applyAmmo`, real loading functions, and new inventory/policy APIs. Drain BMPT rails by `fireLauncherRound`, not arbitrary final counts. The following small policy test is mandatory; clone/reset states per exclusion case.

```js
const p = {id:'A',x:0,z:0,r:45,owner:'blue',progress:1,blue:1,red:0};
const actor = {team:'blue',x:45,z:0,alive:true,deployed:true,connected:true,active:true};
const s = newResupplyState();
assert.equal(eligiblePoint([p,{...p,id:'B'}],actor),'A');
assert.deepEqual(stepResupply(s,4.75,true,true),{progress:.95,complete:false});
assert.deepEqual(stepResupply(s,.25,true,true),{progress:1,complete:true});
assert.equal(s.elapsed,0);
for (const bad of [{owner:null},{owner:'red'},{progress:.999},{red:1}])
  assert.equal(eligiblePoint([{...p,...bad}],actor),null);
for (const bad of [{x:45.001},{alive:false},{deployed:false},{connected:false},{active:false}])
  assert.equal(eligiblePoint([p],{...actor,...bad}),null);
stepResupply(s,4,true,true); stepResupply(s,.1,false,true);
assert.equal(stepResupply(s,1,true,true).complete,false);
stepResupply(s,4,true,false); assert.equal(s.elapsed,0);
assert.equal(eligiblePoint([{...p,owner:'red',progress:-1,blue:0,red:1}],
  {...actor,team:'red'}),'A');
```

Inventory tests cover real `su_bmpt34`, `us_m901_itv`, `xp_bmp_k64_atgm`, `su_t10m`, `su_t10m_oplot23`, a multi-turret workshop loadout, and each gun in `loadData().order`. Preserve source bundle JSON before/after. A short saved mix with a zero BMPT rail refills to exactly the chosen counts. A partially ready two-tube launcher retains `ready`, `nextTube`, and cooldown; a loading gun retains the exact loader record; Oplot preserves heat/spin and shared consumption order; a secondary MG preserves its entire `newMg` state. Assert outgoing count never exceeds captured target after firing/loading/unloading sequences.

- [ ] **2. Run RED.** From repository root:

```powershell
node --test client/web/test/ammo-inventory.test.mjs client/web/test/ammo-resupply.test.mjs client/web/test/ammo-resupply-runtime.test.mjs client/web/test/ammo-resupply-aps.test.mjs
```

Expected: failure because the new modules/live integration are absent. Record the failing assertions in `target/ammo-resupply-c1-red.tap`; an import typo is not sufficient evidence for the live-handler conservation test.

- [ ] **3. Implement the pure owners and idle-empty wakeup.** Capture immutable targets by mounted key after saved mix fitting. `refillAmmo` adds each shortage without touching ready/loading state. For an empty belt set `beltChange=true` before its ordinary reload queue; empty missile sets queue without preloading a tube or clearing launch interval. `consumeApsRounds` validates a nonnegative integer no greater than the pool total, then drains types in existing declaration order. No defensive refill from missing/undefined counts.

```js
function wakeEmptyGun(g,L,gi) {
  if (!L || L.state[gi] !== 'empty' || !g.ammo.some(a => a.count > 0)) return;
  if (g.def.autocannon && g.belt <= 0) g.beltChange = true;
  loading.fired(L,gi);
}
```

- [ ] **4. Wire live offline owners.** At `select`, store `G.ammoPlan=captureAmmoPlan(G.loadout)` after `applyAmmo`; initialize player dwell. At `missileBattleStart` initialize plans/dwell for actual local enemies, excluding remote vehicles and fixed range targets. Use actor-specific plans and loaders, never a same-spec shared object. In `conquestStep`, after `c.step(dt,vs)` and its winner check, evaluate one resupply accumulator for the player and each alive local red actor. Full stocks keep progress zero. On completion call the helper, update `G.model.payload(ti,gi,roundsLeft(g))`, call `syncRacks()` offline, and update the existing APS through `G.missiles.setAps(owner,effectiveEnabled,null,poolTotal)` using the requested-on/loader-ready gate above; preserve the object rather than resetting rate, heat or servo state. For local enemy rack state, use its `combat.ammo`/combat key and store returned state/caps without changing damage.

Give each local enemy `e.ammoLoading = e.loadout.turrets.map(t => loading.newLoading(t.guns.length,t.loaders.length,t.guns.map(g=>!g.rack)))`. `aiMissiles` uses `e.ammoLoading[ti]` with actual `gi`, not a one-gun queue always indexed zero. Tick only the active existing AI launcher path; do not add new AI fire behavior. Enemy APS automatic count changes must consume its own loadout pool too, before its resupply eligibility/missing check; preserve its existing aim/presentation behavior. A full plan for unused guns still prevents fabricated ammo or cross-actor grants.

Reset player/enemy dwell on `toGarage`, deployment/selection, death, disconnect, battle end and conquest loss of eligibility. Preserve the range-reset fix: its select establishes a new plan, while non-range reset continues the existing flow. A live ready weapon remains ready; refilling ammunition does not repair it.

- [ ] **5. Fix the required quick-unload conservation issue and test actual handlers.** In `selectAmmo`, remove the `g.ammo[g.loaded].count++` operation: the breech round was already included in total aboard. Keep `loaded=-1`, existing selected type, and existing normal reload queue. Execute the extracted live `selectAmmo`, `fireGun`, loading completion, and `conquestStep` bodies with real ammo/loading helpers. Boundary sinks may stand in for sound/DOM/damage transport; neither replace the ammo operation nor invent final inventory directly.

At new-life `applyAmmo`, clamp finite autocannon ready belt to `Math.min(g.def.autocannon.belt_rounds, roundsLeft(g))`; otherwise a short selected Oplot load can leave a nominal belt larger than all ammunition aboard. Preserve the existing last-round fire behavior: when total stock reaches zero, `fireGun` marks the gun idle `empty`; do not fabricate an active belt job at that shot. Manual and automatic zero-stock depletion both wait until a positive grant starts the normal empty-belt cycle. Any actually active existing loading/belt-change job with remaining stock is retained unchanged by the grant, including its exact remaining work.

```js
const before = gun.ammo.map(a=>a.count);
live.selectAmmo(1); live.selectAmmo(1); // real quick-unload path, ready different type
assert.deepEqual(gun.ammo.map(a=>a.count),before);
assert.equal(gun.loaded,-1);
assert.equal(rt.loading.state[gi],'waiting');
// Advance actual loader to ready, fire through live fireGun, and repeat switching.
// Total aboard falls by accepted/offline discharges only; loading/unloading leaves it equal.
```

- [ ] **6. Add HUD/readiness functional assertions.** Use `cqMsg` and the existing toast sink: while missing and eligible show `彈藥補給 XX%` appended to the capture message; completion toasts `彈藥已補滿` once. Full stocks/ineligibility clear progress; no percentage outside a valid point. Live tests run 4.75 seconds then .25, verify normal missile/empty-belt waiting, complete their actual source reload cycles before firing, and verify the partial-tube case remains fireable without an extra reload. Damaged weapon tests prove count refill changes neither modules/crew nor `can_fire`.

For both real Oplot variants and both modes, empty the shared pool, apply the five-second grant, and run extracted live effective APS controls against the real WASM world while advancing real `loading.tick` with `reloadTime`/damage reload rate. Launch a real hostile `mw_launch` threat during the reload and assert every `mw_step` before loader completion emits no APS fired rounds; inject new threats as needed so their passage does not make the test vacuous. After the ordinary source belt cycle completes, assert requested-on preference is still true and a fresh incoming threat produces real APS fire after its existing radar confirmation/spin-up delay. Requested-off remains off after completion. At the grant itself compare yaw/pitch/rate/heat/spin and damage before/after; over elapsed reload time assert only the core's ordinary cooling/spin-down behavior, and explicitly expect reacquisition rather than preserved target lock.

Separate manual exhaustion vectors use a real short selected Oplot load and extracted `fireGun`: its last shot retains the existing idle-empty behavior, then a five-second grant starts the full normal source belt cycle. An automatic-depletion vector proves the same grant-time cycle. A separate actually active loading-job fixture with remaining stock is refilled partway through its job and retains the exact existing loader record. These cases prevent both instant firing and an unnecessary restart of a legitimate active reload.

- [ ] **7. Run GREEN and checkpoint regressions.**

```powershell
node --test client/web/test/ammo-inventory.test.mjs client/web/test/ammo-resupply.test.mjs client/web/test/ammo-resupply-runtime.test.mjs client/web/test/ammo-resupply-aps.test.mjs client/web/test/range-ammo-reset.test.mjs client/web/test/missile-launcher.test.mjs client/web/test/online-fire.test.mjs client/web/test/online-launch.test.mjs client/web/test/weapon-control.test.mjs client/web/test/workshop-loading.test.mjs client/web/test/gameplay-performance.test.mjs client/web/test/vehicle-actions.test.mjs
```

Expected: all named tests pass, zero failures/skips. Record real output. Commit only config, the new client owners/tests, and reviewed client edits with `feat: resupply offline ammunition at captured points`. Obtain fresh SPEC PASS then fresh QUALITY APPROVE before checkpoint 2. Reviewers inspect actual live integration and the conserved counts, not just helper implementation.

## Checkpoint 2 — server inventory authority and safe online reconciliation

**Create:** `crates/server/src/ammo.rs`, `crates/server/src/ammo_tests.rs`, `client/web/src/game/onlineAmmo.js`, `client/web/test/online-ammo.test.mjs`, `client/web/test/ammo-resupply-network.test.mjs`.

**Modify:** the native and client protocol owners in the ownership table; `client/web/src/game/lobbyui.js` for the fitted mix when selecting a vehicle; existing Rust/Node protocol test setup, `crates/server/tests/socket.rs`, `crates/server/tests/coast_capture.rs`, and Node main extraction dependencies where the added fields/owners require them. Preserve their meaningful ownership, hit-proof, damage, reload, compatibility, and frozen-source assertions.

- [ ] **1. Establish RED native ledger and actual handler vectors.** Hook `#[cfg(test)] #[path="ammo_tests.rs"] mod ammo_tests;` from `lobby.rs` so tests can inspect private player/room state while driving public handlers. `lib.rs` exports `pub mod ammo;`. The declarations below specify required test names, not runnable Rust test bodies; implement each with the complete scenario vectors that follow and actual real-data lobby setup:

```rust
#[test] fn ammo_resupply_validates_selected_mix_atomically();
#[test] fn ammo_resupply_five_seconds_is_one_grant_and_overlap_does_not_double();
#[test] fn ammo_resupply_rejects_enemy_contested_stale_away_dead_and_finished();
#[test] fn ammo_resupply_bmpt_rails_spend_and_refill_independently();
#[test] fn ammo_resupply_oplot_manual_auto_share_one_pool_and_preserve_heat();
#[test] fn ammo_resupply_empty_oplot_waits_for_trusted_source_belt_cycle();
#[test] fn ammo_resupply_revisions_cover_accept_reject_and_retired_sequences();
#[test] fn ammo_resupply_resume_keeps_scope_counts_targets_and_proofs();
#[test] fn ammo_resupply_old_scope_and_wrong_capability_cannot_mutate_new_life();
```

Complete scenario vectors: deploy BMPT selected `[1]`/`[0]` rails, fire its cannon then selected rail through real handlers, retry identical launch, attempt the empty other rail, refresh valid pose every .25 second while calling the real conquest path at 4.75 and 5 seconds, and assert counts, revision, projections, and emitted owner-only ammo messages. In a separate twin-TOW scenario select one missile, and verify the source total tube capacity does not invent a second carried round. For both Oplot variants assert main `Player.rounds` remains unchanged on manual/automatic protection spending, APS total equals its ledger sum, rack total counts that pool once, and automatic allocation drains declared types in order. Snapshot yaw, pitch, heat, spin, rate, requested enabled intent and damage before grant and assert no reset at that mutation. In the empty-APS case effective enabled becomes false during the normal belt cycle; tracks may clear when the disabled world steps, then reacquire normally. Do not assert unchanged effective enabled or retained radar lock for that case.

Malformed mixes include `{}`, one missing rail, extra `gun:99:0`, array too long, negative/fraction/string/u64 overflow, per-gun total capacity+1, and a client-specified load for a genuine unknown-capacity pool; preserve the full previous player's vehicle/ledger/life when rejecting each. Intentional zero is accepted. Omitted whole mix defaults only on a fresh valid initialization. Existing explicit-zero and genuine unknown-capacity tests remain meaningful. Modernize old scalar `rounds:20` deploy fixtures to an explicit fitted mix summing to 20 (for T-34-85, `[20,0,0]`), preserving their short-load rack-fill and subsequent discharge assertions; do not reinterpret the scalar as source-full defaults or delete those assertions.

- [ ] **2. Claim the sole native lane and run native RED.** Use this exact environment; do not set `CARGO_TARGET_DIR`, `RUST_MIN_STACK`, or compiler/linker stack overrides:

```powershell
$env:RUSTUP_HOME='C:/Users/24908/.codex/scratch/tankforge-rust/rustup'
$env:CARGO_HOME='C:/Users/24908/.codex/scratch/tankforge-rust/cargo'
$env:PATH="$env:CARGO_HOME/bin;$env:PATH"
cargo test -p tg-server ammo_resupply --lib
```

Expected: the newly asserted catalog/protocol/resupply behavior fails before its implementation. Record `target/ammo-resupply-c2-native-red.log`. Run no parallel Cargo/build/native test processes.

- [ ] **3. Implement the native catalog/ledger and terminal request contract.** Build the catalog once per loaded target and reuse it; attach selected plan/current ledger to the player, battle identity to Room, next-battle identity to Lobby. Initialize only in `spawn` from a previously validated vehicle/deploy plan. At spawn set existing world APS rounds to the selected APS pool sum; do not initialize from source magazine independently and retain a contradictory selected plan. On non-deploy respawn retain that vehicle's selected plan while creating a new life. Resume never calls spawn or `AmmoLedger::new`.

`spend` locates the owned mounted key, then its declared shell index, checks positive current count, and subtracts exactly one. Launcher requests have missile ID but no shell ID today: add selected `ammo` to Launch; validate it against both the binding and requested missile/warhead relationship. Client supplies the loaded entry's shell ID. Reject a missile sent through `Fire`, a foreign rail, or wrong type; no aggregate `rounds_left`/missile-ID pool can authorize it. Manual APS uses the same `spend` method. `refill` copies shortages from immutable targets without touching discharge receipts or any gameplay state.

Terminal algorithm under the lobby mutex:

```text
validate room/capability/battle/life before touching current coverage
if cached exact request fingerprint exists: replay its original outcome only
if seq <= processed_through: final stale/sequence rejection, no mutation
validate mounted ownership, damage, origin, timing and exact pool count
accept: perform one successful discharge and one exact pool spend
reject: perform neither discharge nor pool spend
terminal(seq): processed_through=seq; revision+=1 even if counts equal
cache outcome/fingerprint within existing room sequence-capacity bound
emit outcome and current absolute owner inventory
```

Any internal launch failure remains a terminal rejection with unchanged inventory. Late retries replay the cached original Launched ID instead of launching again. Keep hit proof/sequence pruning and server launch spacing intact. Client reconnect sequence is `max(localSeq,processed_through)`; do not reset it on transport resume.

- [ ] **4. Implement authoritative resupply/APS projections with a real clock.** Add `Lobby::tick_at(now:f64)->Broadcast`; validate nonfinite/backwards supplied times, advance `self.now` monotonically, and run the existing tick body. Retain `tick()` as a deterministic convenience using `self.now + 1.0/20.0` for existing native fixtures. In `server.rs` ticker call `h.now()` then `h.lobby.tick_at(now)`; freshness must use the same clock as `ClientMsg::State`, not message-arrival-stale `self.now` or a separately initialized tick-time origin.

After conquest ownership updates and before granting anything, build effective supply occupancy from live/deployed/connected actors with `last_pos` accepted at `0 <= now-at <= 1`. Exclude away seats and benches even when their old `state` remains. Use those counts in supply eligibility; do not grant based on client-sent position/owner/progress/ammo fields. Retain capture/ticket behavior outside this supply derivation unless an actual new test demonstrates a necessary consistency fix. Store one player dwell accumulator. Stop/reset before grant if the same tick ends the battle. Reset dwell on `drop_link`, bench/death, spawn, leave, end, stale pose, and lost eligibility. Reconnect resets dwell but retains ledger/proofs.

`step_missiles` obtains each world APS pool total before stepping, computes actual count consumed afterward, and drains its ledger by that delta in declaration order. Assert world never consumes more than its selected pool and never silently increases above ledger. Recompute all four projections after spending, automatic consumption, initialization, and grant; set existing APS world count with `set_aps_rounds` using its trusted effective-enabled gate and unchanged requested rate. Synchronize combat rack fill from total finite inventory, then emit `Status` state/caps as necessary for rack depiction; keep module health/fire/crew/repair data intact. Owner ammo update carries its revision and progress. Do not serialize enemy inventories to other players.

Add a narrowly scoped trusted APS refill reload gate on Player: `aps_desired_enabled:bool`, `aps_reload_until:Option<f64>`, and remaining source-cycle work/last trusted update time. Initialize intent at spawn and retain it on resume. Current source marks both manual and automatic zero-stock depletion idle-empty; do not start an invented native timer at the last shot. When an empty APS pool receives a positive grant, start that binding's source `autocannon.belt_reload_s / room.rules().fire` cycle at the trusted grant time. Retain any actually tracked active refill cycle's remaining work/deadline rather than restarting it; partial top-ups do not start another cycle. Project `aps_reload_until` from remaining work and the existing native bound weapon reload multiplier, updating remaining work on trusted tick time so damage-related slowing cannot let automatic APS finish before the ordinary cycle. This is a limited APS empty-belt refill/readiness gate, not a new general server reload engine.

```text
manual or automatic total depletion: preserve current idle-empty behavior, no invented timer
empty APS -> positive grant: retain an active refill cycle, otherwise start the full source cycle
new refill remaining work = source belt_reload_s / gameplay fire factor
each trusted tick: remaining = max(0, remaining - elapsed / current weapon reload multiplier)
aps_reload_until = remaining > epsilon ? now + remaining * multiplier : None
effective_enabled = aps_desired_enabled && aps_reload_until.is_none()
existing_world.set_aps_rounds(player,effective_enabled,None,Some(ledger APS total))
```

`ClientMsg::Aps` updates requested intent/rate only; a client ready flag or enabled=true cannot cancel the trusted cycle. The server manual APS discharge path also rejects with `reloading` while this gate is active, even when temporary world disable would otherwise allow manual fire. After the cycle expires, re-enable only when requested; existing module/radar/crew/repair/overheat/spin gates still apply. Incoming actual-world missiles must produce no automatic APS shots before this cycle completes, then permit fire after normal reacquisition/spin-up, in both modes/variants. Explicit off intent remains off. Preserve yaw/pitch/rate and no thermal reset; disabled stepping may clear tracks and cool/spin down naturally. Add these actual handler phases to the native-to-Node receipt. Primary cannon/missile reload readiness remains its established client behavior plus existing native burst/launch-spacing limits; do not claim this feature creates complete authoritative reload simulation for every weapon.

- [ ] **5. Write complete RED client prediction vectors and implement `OnlineAmmo`.** Public API signatures (the empty braces denote the contract shape here, not completed implementations):

```js
export class OnlineAmmo {
  begin(frame,loadout,loadings) {}
  predictCannon(seq,instance,ammoId) {}
  receive(frame) {} // false for obsolete scope/revision; throws for malformed current data
  counts() {} // confirmed base minus uncovered cannon predictions
  scope() {} // {battle,life}
  clear() {}
}
```

Validate exact key/type array lengths, safe integer counts/targets/counters, counts <= targets, and binding identity before atomically adopting a current frame. New scope is accepted only at authoritative Start/Respawned initialization; arbitrary ammo messages cannot switch vehicles/lives. Same-life target drift is invalid. On accepted revision remove overlays `seq <= processed_through`; never decrement a missile prediction. The test vectors below are required with actual real gun objects and loading state:

```js
const data = loadData();
const lo = makeLoadout('us_m901_itv',data.vehicles.us_m901_itv,data.projectiles,data.machineGuns);
applyAmmo(lo,{'us_m901_itv':{'0.0':[2]}});
const loadings = lo.turrets.map(t=>loading.newLoading(t.guns.length,t.loaders.length,t.guns.map(g=>!g.rack)));
const owner = new OnlineAmmo();
const ammoId = lo.turrets[0].guns[0].ammo[0].shell.id;
const initial = {t:'ammo',ammo_protocol_version:1,battle:7,life:2,revision:1,
  processed_through:0,targets:{'gun:0:0':[2]},counts:{'gun:0:0':[2]},
  resupply_progress:0,refilled:false};
owner.begin(initial,lo,loadings);
owner.predictCannon(41,'gun:0:0',ammoId);
assert.deepEqual(owner.counts(),{'gun:0:0':[1]});
owner.receive({...initial,revision:2,processed_through:41,counts:{'gun:0:0':[1]}});
assert.deepEqual(owner.counts(),{'gun:0:0':[1]}); // accepted prediction is not spent twice
owner.receive({...initial,revision:3,processed_through:41,refilled:true});
assert.deepEqual(owner.counts(),{'gun:0:0':[2]});
assert.equal(owner.receive({...initial,revision:2}),false);
assert.deepEqual(owner.counts(),{'gun:0:0':[2]});
owner.predictCannon(42,'gun:0:0',ammoId);
owner.receive({...initial,revision:4,processed_through:42}); // rejection with equal counts
assert.deepEqual(owner.counts(),{'gun:0:0':[2]});
assert.equal(owner.receive({...initial,battle:6,revision:99}),false);
```

Also test seq gaps/out-of-order new request final rejection, duplicate revisions, missing/inconsistent capability, wrong key/type/target, invalid progress, omitted mandatory fields, a pending request from an old life, and new initialization replacing the old owner. Old ACK/reject never revives a removed overlay. Neither missing receipt nor timeout presumes a refund.

- [ ] **6. Wire real client protocol/lifecycle and preserve readiness differences.** `net.js` hello/resume advertises ammo capability; lobby selection/deploy sends `ammoMix` from a fitted fresh loadout. Include authoritative ammo initialization in Start/Respawned or immediately following owner `ammo`; block discharge until initialization is admitted. Extend actual room/start/resume fixtures with the new capability/scope and preserve saved local mode/ammo preferences. Handle owner `ammo` through `OnlineAmmo`, then apply its counts with the helper and update payload/rack depiction from server status. A reconnect does not select/reinitialize the loadout or recapture targets; wait for retained authority and reconcile pending requests.

Cannon: capture selected entry ID before clearing loaded state; start OnlineFires receipt and `OnlineAmmo.predictCannon`, then existing effects/reload proceed. Replace its online `count--` with count application from the overlay, leaving offline decrement intact. A terminal rejection uses OnlineFires removal/projectile notification but **no direct count refund** after authoritative coverage; an acceptance retires the receipt but does not consume again. Preserve default standalone OnlineFires refund semantics for its existing tests via an explicit `refund=false` option in the live authoritative integration, rather than deleting meaningful refund tests.

Missile: `OnlineLaunches.begin` retains the original pending gun/loaded type and scope without spending. Refactor launcher commit into `commitLauncherLaunch(g,L,gi,ammoId,interval,{consumeAmmo=true})`, with the existing `fireLauncherRound` calling it using default true. An admitted matching ACK invokes it once with `consumeAmmo=false`: reduce ready tubes, increment nextTube, maintain launch interval, use current projected counts to decide empty versus normal reload, and preserve selected/loaded remaining tube. Do not require the original loaded entry to remain positive after an already covering absolute last-round state; the valid pending request proves which tube left. In that mode readiness must not be clamped to zero from the authoritative remaining total before the accepted tube is advanced; a zero remaining inventory still advances nextTube/cooldown exactly once, then ends empty without inventing a ready round. Dispose old-scope pending requests without readiness mutation. Snapshot count adoption never itself advances tube/launch readiness. If a grant overtakes a delayed ACK, its stocked rounds survive while that ACK still completes one normal source reload cycle.

For ordinary online APS snapshots preserve downward-only presentation; do not mutate finite inventory from a bare count lacking battle/life/revision. The new authoritative ammo message owns APS counts in either direction and includes automatic consumption revisions. Offline applyAps keeps declaration-order count reconciliation. Protect reloaded inventory from a stale low APS snapshot, and prevent a high unversioned snapshot from granting ammunition. Online capture/HUD displays only server progress/completion and deduplicates completion by current scope/revision.

- [ ] **7. Regenerate actual handler receipts and test their source tags.** Add `browser_ammo_resupply_receipt_from_actual_handlers` in `ammo_tests.rs`. It must execute Create/Join/Start/Deploy/State/Fire/Launch/APSToggle/tick/conquest/drop/resume/new-life handlers and serialize actual returned messages, never hand-author expected server messages. Receipt phases include both gameplay modes, both Oplots, BMPT independent rails, 4.75-second incomplete versus 5-second grant, contested interruption, malformed mixes, unchanged-count rejection coverage, accepted retries, stale epoch, and resumed retained counts. Write `target/ammo-resupply-network.json` only when `TG_AMMO_RESUPPLY_RECEIPT` is set.

Mandatory receipt source tags: the existing ten gameplay receipt tags **plus** `crates/server/src/ammo.rs`, `crates/server/src/ammo_tests.rs`, `config/ammo-resupply.json`, `crates/combat/src/lib.rs`, `crates/combat/src/weapon_damage.rs`, `crates/missile/src/world.rs`, and `crates/missile/src/def.rs`. Include exact bytes, not an empty hash list. Update the genuine current-version gameplay receipt producer/consumer to require the relevant new dependency tags too; omitted/stale source remains a hard failure. Preserve previous `target/gameplay-network.json` and its logs as prior evidence; generate the current gameplay receipt to `target/resupply-gameplay-network.json`.

`ammo-resupply-network.test.mjs` requires the new actual receipt, checks the exact complete source key set and bytes, then replays actual messages through NetClient and extracted live Start/Respawned/ammo/fire/launch/resume handlers with real loadout/loading/OnlineFires/OnlineLaunches/OnlineAmmo. Assert actual counts, readiness, progress, scopes, predictions and source chosen targets. Negative receipt tests remove a mandatory tag, replace any tagged source, or omit the receipt; every case fails before replay.

- [ ] **8. Run GREEN integrated checks in the sole native lane.**

```powershell
cargo test -p tg-gameplay
cargo test -p tg-server ammo_resupply --lib
$env:TG_GAMEPLAY_NETWORK_RECEIPT='C:/Users/24908/.codex/scratch/tankforge-gameplay-modes/target/resupply-gameplay-network.json'
cargo test -p tg-server browser_protocol_receipt_from_actual_handlers --lib
$env:TG_AMMO_RESUPPLY_RECEIPT='C:/Users/24908/.codex/scratch/tankforge-gameplay-modes/target/ammo-resupply-network.json'
cargo test -p tg-server browser_ammo_resupply_receipt_from_actual_handlers --lib
node --test client/web/test/online-ammo.test.mjs client/web/test/ammo-resupply-network.test.mjs client/web/test/gameplay-network.test.mjs client/web/test/online-fire.test.mjs client/web/test/online-launch.test.mjs client/web/test/launcher-damage-control.test.mjs client/web/test/empty-design-ammo.test.mjs client/web/test/oplot23-variant.test.mjs
cargo test --workspace
node --test client/web/test/*.test.mjs
```

Expected: all focused and full current suites pass, zero Node failures/skips, and no new ignored native tests. Keep the existing native ignored-test count/evidence explicit. Record current commands/results under new resupply log names; no old pinned log is overwritten. The new full Node test count must exceed the accepted 566 baseline; record its actual count rather than changing a frozen old verifier's constant. Commit reviewed source/tests with `feat: resupply authoritative weapon inventories online`. Obtain fresh SPEC PASS then fresh QUALITY APPROVE, including independent actual handler receipt replay, before delivery.

## Root-only current-source verification and delivery

The runtime writers stop after their reviewed checkpoints. Root owns the following actions under existing publishing authorization; this document writer does not run them.

- [ ] Create **new** `target/ammo-resupply-verify.mjs`. Read immutable guard inputs from `target/oplot23-task2-source-build-receipt.json` (448 asset hashes, preserved named pages), prior range-reset receipt, and B2 freeze manifests `C:/Users/24908/.codex/scratch/tankforge-b2-direct-increment-freeze-hashes.json` (13) and `C:/Users/24908/.codex/scratch/tankforge-b2-constructor-freeze-hashes.json` (2). Verify these against the actual separate B2 checkout; never edit its files/manifests. Include the already delivered range-reset and modes/Oplot named pages in preserved hashes.
- [ ] Verify original `data`, original asset bytes excluding the newly built `tg_design.wasm`, schema/source references, and prior named pages remain unchanged. Do not run `target/range-ammo-verify.mjs`, `target/modes-task4-verify.mjs`, or `target/oplot23-task2-verify.mjs` as current acceptance: they intentionally pin earlier native source, core, and test counts. Preserve them as historical evidence. New verification records current relevant source hashes, mandatory handler receipt bytes, fresh full/native logs, actual test counts, B2 freeze hashes, and independently bundled source equality.
- [ ] Rebuild current WASM with the same scratch homes, no target/stack overrides and no concurrent Cargo:

```powershell
cargo build -p tg-design-wasm --release --target wasm32-unknown-unknown
$env:ESBUILD_BIN='C:/Users/24908/Documents/ChatGPT/tankforge/client/web/node_modules/@esbuild/win32-x64/esbuild.exe'
node client/web/build.mjs
Copy-Item -LiteralPath 'client/web/dist/tankforge-range.html' -Destination 'client/web/dist/tankforge-ammo-resupply-20261011.html'
node target/ammo-resupply-verify.mjs
```

Build log must show a real successful build, no committed-core fallback. Assert embedded WASM equals this current release output and page code equals an independent current source bundle; syntax-parse it. New named page and rebuilt default page must match exactly. Do not pin the older WASM hash or pretend source changes cannot alter it.
- [ ] Write a new source/build acceptance receipt `target/ammo-resupply-source-build-receipt.json` and delivery note `docs/superpowers/notes/2026-10-11-ammo-resupply-final-acceptance.md`. Report native/Node passes and preserved sources explicitly. Browser visual status remains **NOT RUN** under the earlier automatic-approval rejection; do not bypass it with browser, HTTP, CDP or Playwright and do not claim rendered gameplay acceptance.
- [ ] Root reviews overlap against shared main, integrates only reviewed changed paths, verifies the actual shared default/new named page bytes and current source after integration, and pushes the authorized public repository. Preserve every older named page. No broad staging, dirty-checkout cleanup, global regeneration, or per-commit deployment.

## Plan self-review coverage

| Approved requirement | Implemented/verified in |
| --- | --- |
| Continuous five seconds, full stocks idle, friendly overlap, moving within point | Policy contract; checkpoint 1 steps 1/4/6; native handler timing vectors. |
| Neutral/enemy/contested/dead/away/stale/finished exclusion; reset lifecycle | Eligibility contract; checkpoint 1 steps 1/4; checkpoint 2 steps 1/4. |
| Selected short/zero mix; gun-total capacity; all finite guns/rails/tubes/Oplots | Inventory/wire/catalog contracts; checkpoint 1 steps 1/3; checkpoint 2 steps 1/3. |
| Infinite secondary MG behavior retained | Boundary statement; complete MG state test; no secondary reserve schema. |
| Preserve loading, partial readiness, heat, spin, damage, selection, launch spacing; APS cannot bypass empty belt reload | Empty wakeup/effective APS contract; real WASM checkpoint 1 step 6; trusted APS refill-cycle checkpoint 2 step 4; honest reacquisition limit. |
| Fix quick-unload conservation under actual fire/loading | Checkpoint 1 step 5. |
| One APS pool; distinct non-APS/APS/rack projections | Projection contract; checkpoint 2 steps 1/3/4. |
| No client grants; authoritative battle/life/revision and complete sequence coverage | Online contract; checkpoint 2 steps 3/5/6. |
| Duplicate/reordered/late reply and reconnect safety | Terminal contract; checkpoint 2 steps 1/5/6/7. |
| Actual source-tagged handler evidence; old assertions preserved | Checkpoint 2 steps 7/8; root verification. |
| Original assets/B2/old pages; new source-matched WASM/page; honest visual limits | Root-only verification/delivery. |

No runtime tests or builds were executed while writing this plan. The unchecked steps represent work still to be performed and independently reviewed.

### Coordinator clarification: launcher depiction

Refilled reserve stock does not put a round instantly on an empty rail. For missile/rocket
payload updates use the actual `g.launcher.ready` count, including discharge/ACK, refill,
and completed source reload; ordinary shell counts are unchanged. Add an actual-model test:
depleted BMPT rail + point grant keeps its round hidden while waiting/loading, then shows
the round only when its original launcher reload completes. Partial ready tubes retain their
visible ready rounds. This clarifies the accepted normal-loading requirement without asset edits.
