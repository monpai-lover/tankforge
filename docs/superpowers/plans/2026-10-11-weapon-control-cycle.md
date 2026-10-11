# G Weapon-Control Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Root assigns any runtime writer and serializes shared-file edits; this document writer does not execute the plan.

**Goal:** Make G cycle ALL FIRE, each mounted gun solo, then each MG solo, with exclusive firing and motor ownership and accurate actual-bore aiming.

**Architecture:** Add explicit control state and pure selection/trigger policy to the existing small `weaponselection.js` module. Derive sight references from it, then apply that policy at the existing live trigger, gun, MG, turret, stabilization and APS boundaries. Add a narrow trusted held-pose handoff to the existing native APS owner so ALL resumes from the real motor pose; preserve ammunition/life authority, and do not rewrite `main.js` or add seats.

**Tech Stack:** Dependency-free browser JavaScript/WebGL2, Node's test runner, existing extracted-live-handler fixtures, current Rust/WASM combat and missile dependencies supplied by the root-owned build lane.

---

## Inputs, scope and file map

Read `docs/superpowers/specs/2026-10-11-weapon-control-cycle-design.md` first. Investigation baseline is `633d668acda2c109ddb416d76c5af71ff30c6bfd`; root reconciles its sole runtime writer's later C1 fixes before execution. All source ranges below identify named owners at that baseline rather than authorizing unrelated edits. Preserve C1 actor stock targets, normal reloads, finite APS stock and actual ready-payload depiction. Future C2 scope/ledger changes remain owned by that task.

The APS-resume follow-up examined current source with HEAD `9101104b98eba8e2b74964ea4324cafcd4cc0348`, including C2's evolving worktree. `World::set_aps_rounds` never adopts pose; disabled `step_aps` returns before changing yaw/pitch; server `actor_of` supplies only parent base/pivot; client `applyAps` directly adopts the stale native pose when ALL returns. Task 5A is required by that concrete source trace. It executes after C2 is reviewed in the same sole native lane, not concurrently with C2 and not by this document writer.

| Path | Responsibility and permitted implementation change |
| --- | --- |
| `client/web/src/game/weaponselection.js` | Explicit mode cycle, sight derivation, labels, motor eligibility and trigger routing; retain `ammoKeyIndex`. |
| `client/web/src/main.js` | Initial/select state, reset-time attachment bookkeeping, `cycleSightGun`, `trigger`, `fireGun`, `trackHull`, `aimTurrets`, `layMg`, `stepMachineGuns`, rotary spin, APS control and HUD adapters only. |
| `client/web/src/game/hud.js` | Persistent mode label and complete gun row highlighting, including first gun. |
| `client/web/src/game/missiles.js` | Offline pose adoption bridge before existing APS enable, without recreation or stock grant. |
| `client/web/template.html` | Add visible mode label and correct G help copy using existing HUD style. |
| `crates/missile/src/world.rs`, `crates/design-wasm/src/lib.rs` | In-place trusted APS pose adoption and WASM call, preserving all non-pose state. |
| `crates/server/src/missiles.rs`, `crates/server/src/lobby.rs` | Normalize/limit the bound held joint pose from accepted State; adopt it in the existing APS ownership transition and expose a snapshot barrier. |
| `crates/missile/src/tests.rs`, `crates/server/src/gameplay_tests.rs`, `crates/server/src/ammo_tests.rs` | Actual disabled/resumed world and server handler tests, and regenerated source-tagged receipt phases. |
| `client/web/test/weapon-selection.test.mjs` | Pure cycle/routing/mode identity REDs. |
| `client/web/test/weapon-control.test.mjs` | Existing `controls` fixture plus actual live cycle/fire/aim/MG/APS/reticle tests; no replacement simulation. |
| `client/web/test/gameplay-runtime.test.mjs`, `client/web/test/oplot23-variant.test.mjs`, `client/web/test/third-person-aa.test.mjs` | Initialize the explicit state and migrate exact expected selections; preserve physical, damage, performance and ammo assertions. |
| `client/web/test/ammo-resupply-aps.test.mjs`, `client/web/test/ammo-resupply-runtime.test.mjs`, `client/web/test/gameplay-network.test.mjs` | Inject newly imported helpers into extracted live handlers and preserve real C1/net lifecycle assertions. |
| `client/web/test/live-network-rig.mjs`, `client/web/test/ammo-resupply-network.test.mjs` | Reuse C2's completed real live handler rig for accepted pose/barrier replay and unchanged stock/life assertions. |
| `client/web/test/launcher-damage-control.test.mjs`, `client/web/test/gameplay-performance.test.mjs` | Inject control helpers/state into extracted `trigger`/`fireGun` dependencies, preserving their existing damage/cost tests. |
| `client/web/test/hetzer-mg-anchor.test.mjs` | Explicit MG solo fixture and parent-carry initialization for actual anchored muzzle comparisons. |
| `client/web/test/weapon-selection.browser.mjs` | Migrate stale cycle/coax expectations if maintained; this plan does not authorize execution of browser tooling. |

Do not change `data/`, models, external asset schemas, ammunition/life authority, `game/optics.js`, `sim/mg.js`, or generated pages during runtime implementation. Native changes are limited to the APS pose handoff paths/tests named above; do not touch C2's ledger/projection/readiness ownership to achieve it. The root owns final source/build artifacts. Do not modify a whole fixture to suppress failures; add its explicit `weaponControl` state and the actual imported helper dependencies.

## Task 1: Pure control state, cycle and routing

**Files:** Modify `client/web/src/game/weaponselection.js`; test `client/web/test/weapon-selection.test.mjs`.

- [ ] **1. Add pure REDs before changing the helper.** Retain the existing digit-row test. Replace the old six-slot sight-only cycle expectation with these tests and import the names defined in step 3:

```js
test('ALL is distinct from gun 0 and G visits each mounted instance once', () => {
  const lo = {turrets:[{guns:[{},{}]},{guns:[{}]}],
    machineGuns:[{def:{name:'same'}},{def:{name:'same'}},{def:{name:'hull'}}]};
  const expected = ['all','gun:0:0','gun:0:1','gun:1:0','mg:0','mg:1','mg:2'];
  let c = {kind:'all'};
  for (let turn=0; turn<3; turn++) {
    const seen=[];
    for (let i=0;i<expected.length;i++) {seen.push(weaponControlKey(c));c=nextWeaponControl(lo,c);}
    assert.deepEqual(seen,expected);assert.equal(weaponControlKey(c),'all');
  }
  assert.deepEqual(weaponControlSight(lo,{kind:'all'}),{ti:0,gi:0,mi:-1});
  assert.deepEqual(weaponControlSight(lo,{kind:'gun',ti:0,gi:0}),{ti:0,gi:0,mi:-1});
  assert.notEqual(weaponControlLabel(lo,{kind:'all'}),weaponControlLabel(lo,{kind:'gun',ti:0,gi:0}));
  assert.notEqual(weaponControlLabel(lo,{kind:'mg',mi:0}),weaponControlLabel(lo,{kind:'mg',mi:1}));
});
test('cycle includes empty or broken slots and empty input stays ALL', () => {
  const lo={turrets:[{guns:[{loaded:-1,ammo:[{count:0}]}]}],machineGuns:[]};
  assert.deepEqual(nextWeaponControl(lo,{kind:'all'}),{kind:'gun',ti:0,gi:0});
  assert.deepEqual(nextWeaponControl(lo,{kind:'gun',ti:0,gi:0}),{kind:'all'});
  assert.deepEqual(nextWeaponControl({turrets:[],machineGuns:[]},{kind:'all'}),{kind:'all'});
  assert.deepEqual(nextWeaponControl(lo,{kind:'gun',ti:9,gi:9}),{kind:'all'});
});
test('solo routing cannot leak into another gun or any MG', () => {
  for(const def of [{},{autocannon:{}},{trigger:'secondary'},{trigger:'rocket'}]) {
    const c={kind:'gun',ti:1,gi:2};
    assert.equal(gunTrigger(c,1,2,def,false,false,1),true);
    for(const [n,r] of [[false,false],[true,false],[false,true]])
      assert.equal(gunTrigger(c,0,0,def,n,r,1),false);
    assert.equal(gunTrigger(c,1,2,def,false,true,1),def.trigger==='rocket');
    assert.equal(machineGunTrigger(c,0,true,true),false);
  }
  const c={kind:'mg',mi:1};
  for(let i=0;i<3;i++) {
    assert.equal(machineGunTrigger(c,i,true,false),i===1);
    assert.equal(machineGunTrigger(c,i,false,true),i===1);
    assert.equal(gunTrigger(c,0,0,{trigger:'rocket'},false,true),false);
  }
});
test('ALL primary is independent of sight and retains secondary and rocket roles', () => {
  const c={kind:'all'};
  for(const ti of [0,1,2]) assert.equal(gunTrigger(c,ti,0,{autocannon:{}},false,false,3),true);
  assert.equal(gunTrigger(c,3,0,{autocannon:{}},false,false,3),false);
  assert.equal(gunTrigger(c,3,0,{autocannon:{}},true,false,3),true);
  assert.equal(gunTrigger(c,0,0,{trigger:'secondary'},true,false),true);
  assert.equal(gunTrigger(c,0,0,{trigger:'rocket'},false,true),true);
  assert.equal(machineGunTrigger(c,0,true,false),false);
  assert.equal(machineGunTrigger(c,0,false,true),true);
});
```

- [ ] **2. Run RED.** `node --test client/web/test/weapon-selection.test.mjs` must fail because the new exported contract is absent; retain that result. Once exports exist, make one targeted pre-fix run against old cycling/routing to demonstrate the missing ALL slot or leaked group, rather than relying exclusively on an import failure.

- [ ] **3. Replace the old `nextSightWeapon` export and old numeric-selection MG helper with this complete policy; retain `ammoKeyIndex` unchanged.** The naming makes control state explicit rather than overloading a sight function.

```js
export function weaponControlKey(c) {
  return c.kind==='gun' ? `gun:${c.ti}:${c.gi}` : c.kind==='mg' ? `mg:${c.mi}` : 'all';
}
export function weaponControlSlots(lo) {
  const slots=[{kind:'all'}];
  lo.turrets.forEach((t,ti)=>t.guns.forEach((g,gi)=>slots.push({kind:'gun',ti,gi})));
  lo.machineGuns.forEach((m,mi)=>slots.push({kind:'mg',mi}));
  return slots;
}
export function nextWeaponControl(lo,current) {
  const slots=weaponControlSlots(lo),key=weaponControlKey(current);
  const i=slots.findIndex(c=>weaponControlKey(c)===key);
  return slots[(i+1)%slots.length];
}
export function weaponControlSight(lo,c) {
  const first=weaponControlSlots(lo).find(s=>s.kind==='gun');
  const reference=c.kind==='gun'?c:first;
  return {ti:reference?.ti??0,gi:reference?.gi??0,mi:c.kind==='mg'?c.mi:-1};
}
export function gunControlActive(c,ti,gi) {
  return c.kind==='all'||(c.kind==='gun'&&c.ti===ti&&c.gi===gi);
}
export function mgControlActive(c,mi) {
  return c.kind==='all'||(c.kind==='mg'&&c.mi===mi);
}
export function gunTrigger(c,ti,gi,def,secondary=false,rocket=false,apsTurret=-1) {
  if(!gunControlActive(c,ti,gi)) return false;
  if(rocket) return def.trigger==='rocket';
  if(c.kind==='gun') return !secondary||def.trigger==='secondary'||!!def.autocannon||ti===apsTurret;
  if(def.trigger==='rocket') return false;
  return (def.trigger==='secondary'||ti===apsTurret)===secondary;
}
export function machineGunTrigger(c,index,primary,secondary) {
  return c.kind==='mg' ? c.mi===index&&(primary||secondary) : c.kind==='all'&&secondary;
}
export function weaponControlLabel(lo,c) {
  if(c.kind==='all') return '全炮開火';
  if(c.kind==='gun') return `炮塔 ${c.ti+1} · 火炮 ${c.gi+1} 單獨開火`;
  const m=lo.machineGuns[c.mi];
  return `機槍 ${c.mi+1} · ${m.def.name||m.weapon||m.def.id} 單獨開火`;
}
```

- [ ] **4. Run GREEN.** Repeat the same Node command; all pure tests pass. Scope the reviewed checkpoint to this helper and its test. Root commits only exact reviewed paths if a checkpoint commit is requested; never broad-stage generated work.

## Task 2: Live cycle, exclusive discharge and held input

**Files:** `client/web/src/main.js:53,294,662,1451,3501,3535,3654,4146`; `client/web/test/weapon-control.test.mjs` plus extracted dependencies listed in the file map.

- [ ] **1. Prepare the existing real fixture, then write failing live tests.** Import the new helper namespace exactly as already done through `* as selection`. Add `weaponControl:{kind:'all'}` to `controls`'s G object. Add `cycleApsRate` to its extracted function list, and return both `cycleApsRate` and the already extracted `trackHull` in `live`. Give its HUD sink `weaponControl(){}` for the later actual `select` label call. Add these test helpers immediately after `controls`; they operate the real live cycle and the actual trigger/pending frame, not a modeled dispatcher:

```js
function chooseControl(r,key) {
  const limit=selection.weaponControlSlots(r.G.loadout).length;
  for(let i=0;i<=limit;i++) {
    if(selection.weaponControlKey(r.G.weaponControl)===key) return;
    r.live.cycleSightGun();
  }
  assert.fail(`unreachable mounted control ${key}`);
}
function triggerFrame(r,dt=1/60) {
  const a=source.indexOf("    if (G.fireHeld && G.mode === 'battle') trigger();");
  const b=source.indexOf('    G.acc += dt;',a);
  assert.ok(a>=0&&b>a,'live trigger/pending frame exists');
  new Function('G','dt','trigger','fireGun',source.slice(a,b))(
    r.G,dt,r.live.trigger,r.live.fireGun);
}
function angles(r) {
  return r.G.T.map(t=>({yaw:t.yaw,pitches:t.guns.map(g=>g.pitch)}));
}
test('first G is gun 0 solo and held primary cancels old queued work',()=>{
  const r=controls('su_bmpt34'),before=r.G.loadout.turrets[0].guns.map(loadout.roundsLeft);
  r.live.trigger();assert.equal(r.G.pending.length,2,'ALL primary includes both cannons');
  r.G.fireHeld=true;r.live.cycleSightGun();
  assert.equal(selection.weaponControlKey(r.G.weaponControl),'gun:0:0');
  assert.equal(r.G.pending.length,0);assert.equal(r.G.fireHeld,true);
  triggerFrame(r);
  const after=r.G.loadout.turrets[0].guns.map(loadout.roundsLeft);
  assert.deepEqual(after,before.map((n,i)=>n-(i===0?1:0)));
  assert.equal(r.G.shots.length,1);
});
test('gun 1 solo rejects gun 0 even when both share one turret',()=>{
  const r=controls('su_bmpt34');chooseControl(r,'gun:0:1');
  const before=r.G.loadout.turrets[0].guns.map(loadout.roundsLeft);
  r.G.fireHeld=true;triggerFrame(r);
  assert.deepEqual(r.G.loadout.turrets[0].guns.map(loadout.roundsLeft),before.map((n,i)=>n-(i===1?1:0)));
  assert.equal(r.live.fireGun(0,0),false,'obsolete local dispatch is rejected');
  r.G.mgHeld=true;r.live.stepMachineGuns(1/60);
  assert.equal(r.G.bullets.length,0);
});
test('selected rocket left trigger or R cannot choose the other real BMPT rail',()=>{
  for(const secondary of [false,true]) {
    const r=controls('su_bmpt34');chooseControl(r,'gun:0:3');
    r.live.trigger(secondary,false);
    assert.deepEqual(r.G.pending.map(p=>[p.ti,p.gi]),secondary?[]:[[0,3]]);
    r.G.pending.length=0;r.live.trigger(false,true);
    assert.deepEqual(r.G.pending.map(p=>[p.ti,p.gi]),[[0,3]]);
  }
  const r=controls('de_pz3_j');chooseControl(r,'mg:0');r.live.trigger(false,true);
  assert.equal(r.G.pending.length,0);
});
```

Extend `controls` to accept a cloned bundle, retaining real combat preparation; never mutate the shared catalog. The exact fixture edits are:

```js
// Add this import:
import {deriveLoadoutPerformance} from '../src/game/gameplayPerformance.js';
// Extend the existing signature and its loadout construction:
function controls(id,mesh=false,bundle=data.vehicles[id],mode='historical') {
  const fixtureData={...data,vehicles:{...data.vehicles,[id]:bundle}};
  const rt=mesh?runtimeParts(id,fixtureData):null;
  const lo=deriveLoadoutPerformance(rt?.loadout||loadout.makeLoadout(id,bundle,data.projectiles,data.machineGuns),mode);
  // Retain the rest of the existing real fixture body, with G.gameplayMode=mode,
  // combat.fresh('control:'+id,bundle), and combat.prepare(G.combatKey,bundle).
}
```

The code above specifies exact changed lines, not a replacement fixture. Add this complete test:

```js
test('authored secondary solo uses only its real gun on left or N',()=>{
  const bundle=structuredClone(data.vehicles.su_bmpt34);
  bundle.weapons.extra_guns[0].gun.trigger='secondary';
  const r=controls('su_bmpt34',false,bundle);chooseControl(r,'gun:0:1');
  for(const n of [false,true]) {
    r.G.pending.length=0;r.live.trigger(n,false);
    assert.deepEqual(r.G.pending.map(p=>[p.ti,p.gi]),[[0,1]]);
  }
  r.G.pending.length=0;r.live.trigger(false,true);assert.deepEqual(r.G.pending,[]);
  const before=r.G.loadout.turrets[0].guns.map(loadout.roundsLeft);
  assert.equal(r.live.fireGun(0,1),true);
  assert.deepEqual(r.G.loadout.turrets[0].guns.map(loadout.roundsLeft),before.map((n,i)=>n-(i===1?1:0)));
});
```

- [ ] **2. Run RED.** `node --test --test-name-pattern='first G|gun 1 solo|selected rocket|secondary solo' client/web/test/weapon-control.test.mjs` must expose the current skipped first-gun solo/group leak. Execute the two-rail `trigger` assertion even if a later launcher fixture dependency is missing; distinguish setup errors from behavioral REDs.

- [ ] **3. Wire state and the live cycle.** Replace the `nextSightWeapon` named import with the new policy functions used below. Add `weaponControl:{kind:'all'}` beside G's sight fields; reset it to ALL in `select` immediately before resetting sight indices. Preserve the rest of `select`, particularly C1 `ammoPlan`, resupply, loaders and `G.model.payload(...g.launcher.ready)`. Replace only `cycleSightGun`:

```js
function cycleSightGun() {
  G.ranging=null;
  G.weaponControl=nextWeaponControl(G.loadout,G.weaponControl);
  const next=weaponControlSight(G.loadout,G.weaponControl);
  G.sightT=next.ti;G.sightG=next.gi;G.sightM=next.mi;
  G.pending.length=0;
  syncApsControl();
  G.zoomIdx=0;
  hud.buildAmmo(G.sightM>=0?null:sightGun(),selectAmmo);
  hud.toast(weaponControlLabel(G.loadout,G.weaponControl),1.5);
}
```

- [ ] **4. Replace only `trigger` with this bounded dispatcher, and add the defensive selection check at the top of `fireGun`.** All actual discharge code, C1 debit/reload, and C2's later prediction/ACK code remain in their owner.

```js
function trigger(mgTrigger=false,rocket=false) {
  if(G.online&&G.online.dead) return;
  let n=G.pending.length;
  const apsTi=G.aps?G.aps.turret??1:-1;
  let rocketGone=rocket&&G.pending.some(p=>G.loadout.turrets[p.ti].guns[p.gi].def.trigger==='rocket');
  G.loadout.turrets.forEach((t,ti)=>{
    const rt=G.T[ti];
    t.guns.forEach((g,gi)=>{
      if(!gunTrigger(G.weaponControl,ti,gi,g.def,mgTrigger,rocket,apsTi)) return;
      if(!weaponDamage(G.caps,g.damageKey).can_fire||rt.loading.state[gi]!=='ready') return;
      if(g.def.missile&&G.caps?.weapons===undefined&&!launcherCanFire(G.loadout,(G.bundle||data.vehicles[G.id])?.modules,G.cstate,g)) return;
      if(rocket&&rocketGone) return;
      if(G.pending.some(p=>p.ti===ti&&p.gi===gi)) return;
      const own=G.weaponControl.kind==='gun'||ti===G.sightT;
      const onTarget=rt.bearing&&Math.abs(rt.yawErr)<.02&&Math.abs(rt.guns[gi].pitchErr)<.02;
      if(!own&&!onTarget) return;
      if(ti===apsTi&&(apsAutomatic()||!moduleOk(G.bundle||data.vehicles[G.id],G.cstate,G.aps.gun_module))) return;
      G.pending.push({ti,gi,t:g.def.autocannon?0:n*.07});
      if(rocket) rocketGone=true;
      if(!g.def.autocannon) n++;
    });
  });
}
```

```js
// First line of fireGun(ti,gi), before reading or mutating gun/loading/ammo:
if(!gunControlActive(G.weaponControl,ti,gi)) return false;
// stepMachineGuns firing policy (retain every existing damage/thermal/reload gate):
const firing=enabled&&damage.can_fire&&machineGunTrigger(G.weaponControl,i,G.fireHeld,G.mgHeld);
// Change rotary iteration to t.guns.forEach((g,gi)=>{...}), and replace its held expression:
const apsTi=G.aps?G.aps.turret??1:-1;
const held=(G.fireHeld&&gunTrigger(G.weaponControl,ti,gi,g.def,false,false,apsTi))||
  (G.mgHeld&&gunTrigger(G.weaponControl,ti,gi,g.def,true,false,apsTi));
```

The live R handler must return without discharge/reset in an MG solo on a rocket-equipped vehicle; its existing `trigger(false,true)` already produces no eligible gun. Preserve its pre-existing no-rocket-vehicle reset behavior and Backspace rather than changing an unrelated control. No solo path may bypass `launchFromGun` cooldown or payload/ACK semantics.

- [ ] **5. Run GREEN and checkpoint.** Repeat the RED command, then `node --test client/web/test/weapon-selection.test.mjs client/web/test/weapon-control.test.mjs client/web/test/launcher-damage-control.test.mjs client/web/test/gameplay-performance.test.mjs`. New selection tests may still fail in later unfinished motor/APS requirements, but current task cases must pass; record them individually instead of claiming the whole feature complete.

## Task 3: Hold inactive turret/elevation motors and rebase hull tracking

**Files:** `client/web/src/main.js:trackHull,aimTurrets,zeroElev`; `client/web/test/weapon-control.test.mjs`; fixture injection in the three other aiming suites.

- [ ] **1. Add meaningful motor REDs using the actual handlers.** The existing fixture exposes `aimTurrets`; also return `trackHull` from its real function compilation for the direct compensation test.

```js
test('gun solo holds every inactive elevation and another turret drive',()=>{
  const r=controls('su_t10m');chooseControl(r,'gun:1:0');
  r.G.T[0].yaw=.7;r.G.T[0].guns[0].pitch=.13;
  const held=angles(r)[0];r.G.aimPoint=[500,100,300];
  for(let i=0;i<240;i++) r.live.aimTurrets(1/60);
  assert.deepEqual(angles(r)[0],held);
  assert.notEqual(r.G.T[1].yaw,0,'selected child moves independently');
  const same=controls('su_bmpt34');chooseControl(same,'gun:0:1');
  same.G.T[0].guns[0].pitch=.17;same.G.aimPoint=[300,80,400];
  for(let i=0;i<240;i++) same.live.aimTurrets(1/60);
  close(same.G.T[0].guns[0].pitch,.17,'unselected same-ring elevation');
  assert.notEqual(same.G.T[0].guns[1].pitch,0);
});
test('inactive child holds local yaw while selected parent physically carries it',()=>{
  const r=controls('su_t10m');chooseControl(r,'gun:0:0');
  r.G.T[0].yaw=.2;r.G.T[1].yaw=.65;r.G.T[1].carried=.2;
  r.G.T[1].guns[0].pitch=.23;r.G.aimPoint=[500,20,100];
  for(let i=0;i<240;i++) r.live.aimTurrets(1/60);
  close(gunnery.wrapPi(r.G.T[1].yaw-r.G.T[0].yaw),.45,'held child motor');
  close(r.G.T[1].guns[0].pitch,.23,'held child elevation');
});
test('MG solo freezes stabilized cannon poses through hull motion and direct tracking',()=>{
  const r=controls('su_is2',true);chooseControl(r,'mg:0');
  r.G.T[0].yaw=.42;r.G.T[0].guns[0].pitch=.12;
  const before=angles(r);r.G.aimPoint=[500,200,-100];
  for(let i=0;i<120;i++) {
    tiltBody(r,.1*Math.sin(i/8),.08*Math.cos(i/7),i*.005);
    r.live.aimTurrets(1/60);
    r.live.trackHull(r.G.T[0],'two_plane',1/60,1,1,false);
  }
  assert.deepEqual(angles(r),before);
  close(r.G.T[0].seen.heading,r.G.s.heading,'held history rebased');
  chooseControl(r,'gun:0:0');const yaw=r.G.T[0].yaw,pitch=r.G.T[0].guns[0].pitch;
  r.live.aimTurrets(1/60);
  const t=r.G.loadout.turrets[0],g=t.guns[0];
  assert.ok(Math.abs(gunnery.wrapPi(r.G.T[0].yaw-yaw))<=Math.max(t.traverse,50)*DEG/60+1e-9);
  assert.ok(Math.abs(r.G.T[0].guns[0].pitch-pitch)<=Math.max(g.def.elevate_deg_s,50)*DEG/60+1e-9);
});
```

Run a variant with `r.G.loadout.turrets[0].stabilizer='two_plane'` for the explicit stabilized case; retain the source IS-2 case too. Direct `trackHull` observes tracking state, while `aimTurrets` assertions catch real physical motor writes. The selected parent's moving child's test must compare local relative yaw, not falsely require a rigid child to stay fixed in hull/world coordinates.

- [ ] **2. Run RED.** `node --test --test-name-pattern='gun solo holds|inactive child|MG solo freezes' client/web/test/weapon-control.test.mjs` must fail on actual inactive yaw/pitch movement, not only a missing helper.

- [ ] **3. Add an explicit hold parameter to `trackHull(rt,stab,dt,traverse=1,elevate=1,active=true)`.** Compute `att` first and insert this complete early branch. Move the existing source/st calculation after it; the active tracking algorithm remains unchanged.

```js
const att={pitch:G.ss.pitch,roll:G.ss.roll,heading:G.s.heading};
if(!active) {
  rt.seen={...att};rt.hand={...att};rt.prev={...att};
  rt.drive={pitch:0,roll:0,heading:0};rt.hist=[];rt.clock=0;rt.lay=null;
  for(const gs of rt.guns) gs.lay=null;
  return;
}
```

- [ ] **4. Gate live laying after existing parent carry, and gate per-gun elevation.** In `aimTurrets`, retain the parent `base/carried` delta block before this insertion. For inactive mounts use no zero-angle reset and no traverse/elevate call:

```js
const apsOwned=G.aps&&ti===(G.aps.turret??1)&&apsAutomatic();
const active=!apsOwned&&(G.weaponControl.kind==='all'||
  (G.weaponControl.kind==='gun'&&G.weaponControl.ti===ti));
trackHull(rt,t.stabilizer,dt,travMult,damage.elevate_mult,active);
if(!active) return;
// At the start of the existing t.guns.forEach((g,gi)=>{...}) elevation body:
if(!gunControlActive(G.weaponControl,ti,gi)) {rt.guns[gi].lay=null;return;}
```

Seed parent carry before the first active frame: after `select` has built `G.T`, apply the parent's initial yaw to child rest yaw and store its base. After the existing `resetPose` yaw-reset loop, seed `carried` from those already reset parent poses. Use the same initialization in `controls`, so G before the first frame cannot lose the parent's first movement:

```js
// After G.T construction in select and in controls:
G.loadout.turrets.forEach((t,ti)=>{
  if(t.parent!=null) {
    G.T[ti].yaw=gunnery.wrapPi(G.T[ti].yaw+G.T[t.parent].yaw);
    G.T[ti].carried=G.T[t.parent].yaw;
  }
});
// After the existing resetPose turret-reset loop; do not add parent yaw twice:
G.loadout.turrets.forEach((t,ti)=>{
  G.T[ti].carried=t.parent!=null?G.T[t.parent].yaw:null;
});
for(const e of G.MG) e.carried=e.m.mount==='pintle'&&e.m.anchor!=='hull'?G.T[0].yaw:0;
```

Also test a first-frame G to parent solo with a nonzero authored parent facing, before any previous ALL aiming frame; the child's relative yaw must hold on that first movement.

```js
test('first SOLO frame carries an inactive child from its authored parent base',()=>{
  const bundle=structuredClone(data.vehicles.su_t10m);bundle.weapons.facing_deg=20;
  const r=controls('su_t10m',false,bundle);chooseControl(r,'gun:0:0');
  const relative=gunnery.wrapPi(r.G.T[1].yaw-r.G.T[0].yaw);
  const pitch=r.G.T[1].guns[0].pitch;r.G.aimPoint=[500,20,100];
  r.live.aimTurrets(1/60);
  close(gunnery.wrapPi(r.G.T[1].yaw-r.G.T[0].yaw),relative,'first carried local yaw');
  close(r.G.T[1].guns[0].pitch,pitch,'first held child pitch');
});
```

Remove the entire `coaxMuzzle/coaxLay` target block from `aimTurrets`, and replace its two ternary targets with their existing ordinary expressions:

```js
const targetYaw=Math.atan2(lp[0]-pv[0],lp[2]-pv[2]);
const los=Math.atan2(lp[1]-tr[1],Math.hypot(lp[0]-tr[0],lp[2]-tr[2]));
// zeroElev no longer substitutes MG ballistics into a cannon actuator:
const zeroElev=g=>ballistics.elevationAt(g.table,G.zero);
```

When deriving traverse damage for an active solo turret, choose its selected gun as before. For a held turret use gun 0 only for non-moving diagnostic metadata; never use that choice as permission to lay it. Leave actual model yaw mapping (`rt.yaw - parent.yaw`) and muzzle transforms unchanged.

- [ ] **5. Run GREEN.** Repeat motor REDs, then `node --test client/web/test/weapon-control.test.mjs client/web/test/third-person-aa.test.mjs client/web/test/oplot23-variant.test.mjs`. Preserve existing mechanical stops, damage-adjusted slew and high-elevation camera tests. Checkpoint only named laying/state test changes after root review.

## Task 4: MG joints, fixed coax and actual reticle

**Files:** `client/web/src/main.js:select,layMg,stepMachineGuns,sightMuzzle`; `client/web/test/weapon-control.test.mjs`; existing Hetzer MG anchor test fixture.

- [ ] **1. Add live REDs and replace incompatible old expectations explicitly.** Existing tests named `selected coax converges...` and `selected coax keeps its zero and parallax alignment...` currently demand cannon movement when a coax is selected. Replace only that obsolete behavior with frozen-parent/actual-bore assertions; retain chosen-zero, parallax, tilted-hull and actual HUD coverage for flexible MGs.

```js
test('selected fixed coax preserves cannon motors and fires from the actual rendered bore',()=>{
  const r=controls('su_is2',true),i=r.G.MG.findIndex(e=>e.m.mount==='coax');
  chooseControl(r,`mg:${i}`);tiltBody(r,.1,.15,.6,[5,.4,-7]);
  r.G.T[0].yaw=.7;r.G.T[0].guns[0].pitch=.2;
  const held=angles(r),before=r.live.sightMuzzle();
  r.G.zero=800;r.G.aimPoint=[-300,80,500];
  for(let k=0;k<240;k++){r.live.aimTurrets(1/60);r.live.layMg(i,1/60);}
  assert.deepEqual(angles(r),held);
  assert.deepEqual(r.live.sightMuzzle(),before,'zero/view cannot swivel rigid coax');
  r.G.MG[i].m.def={...r.G.MG[i].m.def,dispersion_mrad:0};
  r.G.fireHeld=true;r.live.stepMachineGuns(1/60);
  assert.ok(r.G.bullets.length>0,'fixed bore remains fireable');
  r.G.bullets[0].s.vel.forEach((v,k)=>close(v/r.G.MG[i].m.bullet.muzzle_velocity_ms,before.dir[k],'actual bullet direction',1e-6));
});
test('flexible MG solo leaves other joints and cannon motors held',()=>{
  for(const id of ['su_is2','de_pz3_j','de_hetzer']) {
    const r=controls(id,true),i=r.G.MG.findIndex(e=>e.m.mount!=='coax');assert.ok(i>=0,id);
    chooseControl(r,`mg:${i}`);r.G.aimPoint=[400,100,200];
    const held=angles(r),joint=r.G.MG.map(e=>({...e.aim}));
    for(let k=0;k<240;k++){r.live.aimTurrets(1/60);r.live.stepMachineGuns(1/60);}
    assert.deepEqual(angles(r),held);
    r.G.MG.forEach((e,k)=>{if(k!==i)assert.deepEqual(e.aim,joint[k]);});
    assert.notDeepEqual(r.G.MG[i].aim,joint[i]);
    assert.ok(Math.abs(r.G.MG[i].aim.pitch)<=Math.max(...r.G.MG[i].m.arc)+1e-9);
  }
});
test('inactive turret pintle receives attachment carry without its joint slewing',()=>{
  const r=controls('su_is2',true),i=r.G.MG.findIndex(e=>e.m.mount==='pintle');
  chooseControl(r,'gun:0:0');r.G.T[0].yaw=.2;
  const e=r.G.MG[i];e.aim={yaw:.6,pitch:.2};e.carried=.2;
  r.G.aimPoint=[400,30,100];
  for(let k=0;k<120;k++){r.live.aimTurrets(1/60);r.live.layMg(i,1/60);}
  close(gunnery.wrapPi(e.aim.yaw-r.G.T[0].yaw),.4,'pintle local yaw hold');
  close(e.aim.pitch,.2,'pintle elevation hold');
});
```

Execute the existing actual scope projection block (`if (inSight) { // where the gun...`) after a fixed-coax solo view change with this complete test. Keep the existing actual roof/hull model mouth comparisons. A fixed coax may be authored as visual parts on the cannon rather than a `model.mgs` joint, so its bore direction is compared to the real posed cannon node rather than an invented independent MG node.

```js
test('coax actual reticle remains at frozen bore with real zero and parallax',()=>{
  const r=controls('su_is2',true),i=r.G.MG.findIndex(e=>e.m.mount==='coax');
  chooseControl(r,`mg:${i}`);r.G.T[0].yaw=.7;r.G.T[0].guns[0].pitch=.2;
  tiltBody(r,.1,.15,.6,[5,.4,-7]);r.G.zero=800;
  r.rt.at({yaw:.7,pitch:.2});
  const mz=r.live.sightMuzzle(),node=r.rt.model.turrets[0].guns[0].node;
  transformDir(node.world,[0,0,1]).forEach((v,k)=>close(mz.dir[k],v,'rigid rendered bore',1e-6));
  assert.deepEqual(r.live.currentLos().from,mz.pos);
  const selectedMg=r.G.MG[i],ze=ballistics.elevationAt(selectedMg.m.table,r.G.zero);
  const yaw=Math.atan2(mz.dir[0],mz.dir[2]),pitch=Math.asin(clamp(mz.dir[1],-1,1));
  const cw=1280,ch=800,fwd=dirFrom(yaw+.2,pitch-ze),tilt=0;
  const camPos=mz.trunnion.map((v,k)=>v+mz.dir[k]*.6);
  const viewProj=mul(perspective(.3,cw/ch,.3,9000),lookAtLH(camPos,fwd).view);
  r.G.aim.dist=100;
  const a=source.indexOf('    if (inSight) {\n      // where the gun');
  const b=source.indexOf('\n\n    // ---- projectiles',a);assert.ok(a>=0&&b>a);
  new Function('G','selectedMg','sightMuzzle','tilt','ze','dirFrom','clamp','project','viewProj',
    'camPos','fwd','cw','ch','inSight','srt','sgs',source.slice(a,b))(
    r.G,selectedMg,r.live.sightMuzzle,tilt,ze,dirFrom,clamp,project,viewProj,camPos,fwd,cw,ch,true,r.G.T[0],r.G.T[0].guns[0]);
  const sl=dirFrom(yaw,pitch-ze),reach=100-Math.hypot(...mz.pos.map((v,k)=>v-mz.trunnion[k]));
  const pr=project(viewProj,mz.pos.map((v,k)=>v+sl[k]*reach));
  close(r.G.sightOffset[0],pr[0]*.5*cw,'actual bore horizontal offset',1e-5);
  close(r.G.sightOffset[1],-pr[1]*.5*ch,'actual bore vertical offset',1e-5);
  assert.ok(Math.abs(r.G.sightOffset[0])>20,'camera movement does not fake coax convergence');
});
```

- [ ] **2. Run RED.** `node --test --test-name-pattern='selected fixed coax|flexible MG solo|inactive turret pintle|coax actual reticle' client/web/test/weapon-control.test.mjs`. Expected current failures: main cannon yaw/pitch changes in coax solo, unused flexible joints move, and inactive pintle relative yaw changes.

- [ ] **3. Preserve the current rigid coax branch in `layMg`, add parent carry for flexible mounts, and gate only the joint-slew block.** Initialize MG `carried` at construction to the current first turret yaw for turret pintles, and 0 for hull mounts; add it in fixture construction too. Immediately after the coax early return and before computing the flexible `base`, insert:

```js
// Exact G.MG construction in select; add the same carried expression to controls:
G.MG=G.loadout.machineGuns.map(m=>({m,st:mgSim.newMg(m.def),aim:{yaw:0,pitch:0},bearing:true,
  carried:m.mount==='pintle'&&m.anchor!=='hull'?G.T[0].yaw:0}));
```

```js
const parentYaw=m.mount==='pintle'&&m.anchor!=='hull'?rt0.yaw:0;
if(dt>0) {
  if(e.carried!=null) e.aim.yaw=gunnery.wrapPi(e.aim.yaw+gunnery.wrapPi(parentYaw-e.carried));
  e.carried=parentYaw;
}
```

Wrap the existing flexible-mount lines from `const oldPitch` through `mgSim.slewMount` in this exact condition; leave the final muzzle construction outside it. A sight read with `dt=0` must not perform auto-lay. When selected, the existing body-local conversion, chosen-zero formula, arcs and damage-adjusted rates run unchanged:

```js
if(dt>0&&mgControlActive(G.weaponControl,i)) {
  const oldPitch=e.aim.pitch;
  const localMuzzle=m.mount==='pintle'
    ?gunnery.muzzleLocal({pivot:base,trunnion:base,muzzleOffset:m.muzzleOffset??1,muzzleVector:m.muzzleVector},{yaw:e.aim.yaw,pitch:oldPitch}).pos
    :base.map((v,k)=>v+dirFrom(e.aim.yaw,oldPitch)[k]*.3);
  const muzzle=body.worldPoint(localMuzzle),d=G.aimPoint.map((v,k)=>v-muzzle[k]);
  const range=Math.hypot(d[0],d[1],d[2]);
  const laid=body.localDir(dirFrom(Math.atan2(d[0],d[2]),Math.atan2(d[1],Math.hypot(d[0],d[2]))+
    ballistics.elevationAt(m.table,G.sightM===i?G.zero:range)));
  const want={yaw:Math.atan2(laid[0],laid[2]),pitch:Math.atan2(laid[1],Math.hypot(laid[0],laid[2]))};
  const damage=weaponDamage(G.caps,m.damageKey);
  e.bearing=mgSim.slewMount(e.aim,want,m.arc,m.slew*damage.traverse_mult,dt,(m.elevateSlew??m.slew)*damage.elevate_mult);
}
```

The coax branch continues `e.bearing=true` for mechanical availability and uses no `e.aim` swivel. Actual alignment remains the real reticle's direction comparison, not an artificial camera-center condition that would make the held coax unshootable. Keep `sightMuzzle` using that rigid branch and retain the existing actual MG reticle projection.

- [ ] **4. Run GREEN.** `node --test client/web/test/weapon-control.test.mjs client/web/test/hetzer-mg-anchor.test.mjs client/web/test/optics.test.mjs client/web/test/procedural-hull-details.test.mjs`. Existing roof/hull MG ballistic graduation tests must still match real round impact and real `Hud.drawSight` marks. Both selected and held MG model transforms must agree on pitched/rolled hulls.

## Task 5: APS temporary hold, U intent and C1 preservation

**Files:** `client/web/src/main.js:apsAutomatic,syncApsControl,cycleApsRate,applyAps,toggleAps`; `client/web/test/weapon-control.test.mjs`; `client/web/test/oplot23-variant.test.mjs`; `client/web/test/ammo-resupply-aps.test.mjs`.

- [ ] **1. Add live APS REDs for both calibers and both modes.** Ensure `controls`'s loadout performance is derived through the actual `deriveLoadoutPerformance(lo,mode)` as in existing gameplay fixtures; extend it to `controls(id,mesh=false,bundle=data.vehicles[id],mode='historical')`. Preserve existing real WASM and combat setup.

```js
test('every SOLO inhibits automatic APS without changing U or held poses',()=>{
  for(const id of ['su_t10m','su_t10m_oplot23'])for(const mode of ['historical','casual']) {
    const r=controls(id,false,data.vehicles[id],mode),ti=r.G.aps.turret??1;
    const g=r.G.loadout.turrets[ti].guns[0],stock=loadout.roundsLeft(g);
    chooseControl(r,'gun:0:0');assert.equal(r.G.apsOn,true);
    assert.equal(r.snapshot().enabled,false,'unselected APS must not drive in main-gun SOLO');
    r.G.T[ti].yaw=.7;r.G.T[ti].guns[0].pitch=.2;
    const held=angles(r)[ti],a=r.snapshot();
    r.live.applyAps({aps:[{...a,owner:ME,enabled:true,mode:'search',yaw:1.2,pitch:.4,rounds:stock}],events:[]},
      {aps_gun_ok:true,aps_radar_ok:true});
    assert.deepEqual(angles(r)[ti],held,'old enabled snapshot cannot move held APS');
    chooseControl(r,`gun:${ti}:0`);r.live.trigger();
    assert.deepEqual(r.G.pending.map(p=>[p.ti,p.gi]),[[ti,0]]);
    assert.equal(r.live.fireGun(ti,0),true);assert.equal(loadout.roundsLeft(g),stock-1);
    chooseControl(r,'all');assert.equal(r.snapshot().enabled,false,'normal source cycle still unready');
    const t=r.G.loadout.turrets[ti];
    for(const gi of loading.tick(r.G.T[ti].loading,1,(gi,li)=>loadout.reloadTime(t,gi,li,mode))) {
      loadout.refillBelt(t.guns[gi]);t.guns[gi].loaded=loadout.nextAmmo(t.guns[gi]);loadout.syncGunShell(t.guns[gi]);
    }
    r.live.syncApsControl();assert.equal(r.snapshot().enabled,true);
    assert.equal(r.snapshot().rounds,stock-1);
    chooseControl(r,'gun:0:0');r.live.toggleAps();assert.equal(r.G.apsOn,false);
    r.live.cycleApsRate();chooseControl(r,'all');assert.equal(r.snapshot().enabled,false);
  }
});
```

Keep the current real short-load/manual-exhaustion C1 tests. Migrate their selection calls to `chooseControl(...,'gun:1:0')`/`chooseControl(...,'all')` rather than deleting assertions because one G now selects gun 0. Retain actual warm incoming missile interception, no fake final stocks, five-second point grant, exact chosen seven-round targets, heat/spin/rate retention, full source belt timer, actual loader completion, repair/damage and payload tests. Include the existing `ammo-resupply-aps` off-U/Y case.

- [ ] **2. Run RED.** `node --test --test-name-pattern='every SOLO inhibits' client/web/test/weapon-control.test.mjs` must fail because current APS remains enabled for main-gun solo or overwrites its held pose.

- [ ] **3. Replace only `apsAutomatic` with the shared effective ownership rule.** Its callers already include `syncApsControl`, Y and `applyAps`; leave their C1 normal-loader/stock reconciliation paths intact.

```js
function apsAutomatic() {
  return !!(G.aps&&G.apsOn&&G.weaponControl.kind==='all');
}
```

`syncApsControl` retains `desired=apsAutomatic()`, `enabled=desired&&loading.state[0]==='ready'`, finite offline stock and no online client rounds. Task 5A adds current-pose adoption before the real enable transition, and an online acceptance barrier before pose writes resume. The existing `apsAutomatic()&&a.enabled&&a.mode!=='dead'` condition protects SOLO but is insufficient by itself during the return-to-ALL gap; combine it with the acknowledged current-life handoff barrier. Continue reconciling finite ammunition and actual thermal/rate state independently of pose-write eligibility. Do not reject a genuine stock-debit snapshot just because pose control is held.

Change only the U toast text to expose retained preference when a solo holds it:

```js
const requested=G.apsOn;
hud.toast(!requested?`${G.aps.name}：自動攔截已關閉`:
  G.weaponControl.kind==='all'?`${G.aps.name}：自動攔截已開啟（U 關閉，Y 換射速）`:
  `${G.aps.name}：自動攔截偏好已開啟；單獨控制暫停，回到全炮開火恢復`,2.5);
```

An online manual APS shot must be preceded by the existing APS disable control and use the actual APS `gun:ti:gi` instance/shell. Returning to ALL requests enable only with U preference on, after publishing the held State pose and requesting the Task 5A adoption/barrier; native readiness retains C2's trusted gate. Do not promise a whole authoritative reload engine as part of this feature.

- [ ] **4. Run GREEN.** `node --test client/web/test/weapon-control.test.mjs client/web/test/oplot23-variant.test.mjs client/web/test/ammo-resupply-aps.test.mjs client/web/test/ammo-resupply-runtime.test.mjs client/web/test/ammo-inventory.test.mjs client/web/test/range-ammo-reset.test.mjs`. Verify repaired weapons recover through the normal combat/loader handlers and selected empty weapons remain selectable but cannot fire. Root reviews this checkpoint against the newest C1 source before integrating.

## Task 5A: Trusted APS held-pose adoption before automatic resume

**Files:** `client/web/src/main.js:syncApsControl,onlineSky,applyAps,netStep`; `client/web/src/game/missiles.js`; `crates/missile/src/world.rs`; `crates/design-wasm/src/lib.rs`; `crates/server/src/missiles.rs`; `crates/server/src/lobby.rs`; tests/receipts in `crates/missile/src/tests.rs`, `crates/server/src/gameplay_tests.rs`, `crates/server/src/ammo_tests.rs`, `client/web/test/weapon-control.test.mjs`, `client/web/test/live-network-rig.mjs`, `client/web/test/ammo-resupply-network.test.mjs`.

**Source evidence:** At the inspected current source, the native setter is `world.rs:378–387`; disabled early return is `762–789`; re-enabled servo starts from the old world angles at `978–994`; server actor base-only derivation is `missiles.rs:207–219`; the client's direct pose assignments are `main.js:2595–2598`. Current State acceptance validates position but does not mechanically validate `tur` (`lobby.rs:1193–1214`). Treating that raw packet's child yaw as a trusted pose would introduce a different defect.

- [ ] **1. Add a behavioral offline RED to the real current-WASM live fixture.** It must fail on the first resumed actual pose jump, independently of any missing new API. Forward any new actual pose bridge call through the fixture's real core rather than replacing the handoff with a mock. `tiltBody` establishes the real body heading, and the actual `apsOf`/`mw_step`/`applyAps` chain remains the subject:

```js
test('APS pose handoff resumes from manual or carried SOLO pose without a stale-world snap',()=>{
  for(const id of ['su_t10m','su_t10m_oplot23'])for(const mode of ['historical','casual']) {
    const r=controls(id,false,data.vehicles[id],mode),ti=r.G.aps.turret??1;
    r.live.syncApsControl();chooseControl(r,`gun:${ti}:0`);
    tiltBody(r,0,0,.4);r.G.T[0].yaw=.5;r.G.T[ti].yaw=.9;
    r.G.T[ti].carried=.5;r.G.T[ti].guns[0].pitch=.2;
    const g=r.G.loadout.turrets[ti].guns[0],stock=loadout.roundsLeft(g);
    const loadingBefore=structuredClone(r.G.T[ti].loading),off=r.snapshot();
    const held={yaw:r.G.T[ti].yaw,pitch:r.G.T[ti].guns[0].pitch};
    chooseControl(r,'all');
    const adopted=r.snapshot();
    close(gunnery.wrapPi(adopted.yaw-(r.G.s.heading+held.yaw)),0,'adopted current world bearing',1e-6);
    close(adopted.pitch,held.pitch,'adopted elevation on flat hull',1e-6);
    for(const k of ['heat','spin','rate_rpm','rounds'])assert.equal(adopted[k],off[k],`adoption preserves ${k}`);
    const actor={id:ME,team:0,alive:true,center:[0,1.3,0],vel:[0,0,0]};
    r.live.apsOf(actor,r.G.aps,r.G.loadout,r.G.T.map(t=>t.yaw),
      {pos:[0,0,0],heading:r.G.s.heading},r.G.bundle,r.G.cstate,r.G.caps);
    const res=r.core.call({op:'mw_step',dt:1/120,actors:[actor]});
    r.live.applyAps(res,actor);
    const maxYaw=r.G.aps.traverse_deg_s*DEG/120;
    const maxPitch=r.G.aps.elevate_deg_s*DEG/120;
    assert.ok(Math.abs(gunnery.wrapPi(r.G.T[ti].yaw-held.yaw))<=maxYaw+1e-6);
    assert.ok(Math.abs(r.G.T[ti].guns[0].pitch-held.pitch)<=maxPitch+1e-6);
    assert.equal(loadout.roundsLeft(g),stock);assert.deepEqual(r.G.T[ti].loading,loadingBefore);
    assert.equal(r.G.apsOn,true);
  }
});
```

Add the carried-only variant: select `gun:0:0`, keep the child motor offset constant while actual `aimTurrets` moves the parent and the hull changes heading, then return ALL and run the same real handoff/servo assertions. Add flat and pitched/rolled hull round-trip variants using the real rendered bore, not a world-pitch-equals-local-pitch assumption.

- [ ] **2. In the sole native lane after C2, add a small in-place world adoption primitive and its RED/GREEN native test.** The concrete primitive's contract is `World::adopt_aps_pose(owner:u32,world_yaw:f64,world_pitch:f64)->bool`; callers must first produce a valid bound joint pose as described in step 3. This complete mutation shows the intended scope; do not replace `add_aps`, rewrite the servo or set other fields:

```rust
pub fn adopt_aps_pose(&mut self, owner: u32, world_yaw: f64, world_pitch: f64) -> bool {
    if !world_yaw.is_finite() || !world_pitch.is_finite() { return false; }
    let Some(a) = self.aps.iter_mut().find(|a| a.owner == owner) else { return false; };
    if a.enabled { return false; }
    a.yaw = wrap(world_yaw);
    a.pitch = world_pitch;
    a.yaw_cmd = a.yaw;
    a.pitch_cmd = a.pitch;
    true
}
```

In `crates/missile/src/tests.rs`, use its actual `world`, `tank`, `World::step` and `ApsDef::oplot_mo` helpers. Disable a warm gun, step it so natural cooling/spin-down really occurs, clone its serialized state, adopt yaw 1.3/pitch .2, and assert **all** serialized fields except the four named pose/command values remain byte-equivalent. Re-enable with parent base .9, step `MAX_STEP`, and assert yaw/pitch deltas are bounded from 1.3/.2 rather than the old automatic pose. Include NaN/infinity/unknown owner rejection with unchanged world state. The first API test fails before the primitive exists; the step-1 live behavioral RED proves why adoption is necessary.

- [ ] **3. Produce a trusted bound motor pose in the existing APS server/client owners.** Add a focused `accepted_aps_pose` helper in `crates/server/src/missiles.rs`, reusing `ApsSpec`, `Target` weapon binding, `TargetState` caps, `pose_of`, `yaws_of` and room performance. Its accepted record contains local motor yaw/elevation, parent/hull frame, converted world yaw/pitch, and trusted acceptance time. The record is geometry validation metadata for the existing Player/APS owner, not a new life scope, mode controller or ammo ledger.

The mandatory validator algorithm is concrete:

```text
resolve the owner's current APS Cannon binding, exact turret/gun and parent
read finite numeric tur[apsTurret][yaw,pitch] plus the finite current parent/hull frame
normalize motorYaw = wrap(hullFrameTurretYaw - parentHullYaw)
reject outside authored yaw arc/facing, bearing-dependent depression, or elevation ceiling
with a previous accepted pose, reject motor deltas exceeding authored manual rate
    * room performance * current bound weapon damage multiplier * trusted elapsed time
validate required parent joint inputs from their bound source; physical carry is not child traverse
convert the accepted mount through the actual current hull/parent basis to world bore yaw/pitch
store only the normalized accepted pose for the current existing C2 battle/life
```

Current State's position acceptance alone is insufficient. Do not adopt pose from a malformed/wrong turret record, a pose in an old life, an away/dead/benched owner, rejected/stale State, out-of-arc data, or an impossible manual motor jump. Rejecting a handoff leaves automatic activation inhibited until a valid current pose exists; it does not mutate U intent, rate, stock or loading. The authored parent chain and damage-adjusted rate checks must use trusted server elapsed time, not a client `dt`.

In the offline path, validate/derive the same bound local motor pose from actual `G.T` and the existing mount/rigid-body transform before forwarding it through the actual `Missiles` class to the WASM adoption call. Extend the existing `mw_aps` bridge or a narrowly named `mw_aps_pose` operation to invoke only the in-place primitive; no `addAps`, `reset`, `removeAps`, client stock grant, or reinitialization. At execution, choose the spelling that fits the completed C2 bridge; the validator/adoption contract above is fixed.

Retain one coordinate conversion contract: returned native world yaw/pitch maps through the inverse current mount basis to local motor yaw/elevation. Test pose→world bore→motor round trips on a parented turret with nonzero hull heading/pitch/roll and parent yaw. Do not apply raw world pitch as local elevation or raw world yaw as a child-local angle.

At a mechanical stop on a tilted hull, a valid accepted local elevation can differ from the old world's world-pitch limit convention. Use the same bound joint frame for handoff validation and the resumed servo's mechanical limit; a post-step clamp in the wrong frame must not produce an instant jump beyond the true motor rate. Keep that adjustment within the APS pose/limit boundary and verify it with a tilted-at-stop vector; do not broaden it into a general aiming rewrite.

- [ ] **4. Wire the adoption to actual ownership transitions and the existing trusted reload gate.** In offline `syncApsControl`, adopt the current held pose before a false-to-true automatic enable, including U-on and completion of normal loading. Synchronize the held pose while disabled as needed for parent/hull carry. Never reseed an already enabled automatic servo from camera intent or a delayed state each frame.

In the existing server APS handler, use the current normalized accepted State pose before enabling the world. In the existing C2 readiness owner, perform the same adoption when its trusted reload gate permits the world to change from disabled to enabled; do not reset or bypass that gate. When disabled, update the world from validated accepted held-pose observations so the last handoff pose remains current. World adoption itself preserves `heat`, `spin`, `rate_rpm`, `rounds`, `overheated`, loaders and C2 projections.

- [ ] **5. Fence stale online automatic snapshots using the current authority's acknowledgement.** Force-publish the existing current State encoding with the final held joint pose before the APS enable request over the ordered current transport. Add a narrow accepted-pose acknowledgement/barrier to the existing APS control path. It carries the existing C2 battle/life identity, exact bound instance, accepted normalized pose, and current server Snap `tick`; request correlation reuses existing transport metadata rather than inventing a second lifecycle or stock epoch. The client holds pose writes while this handoff is pending, accepts only the matching current transition acknowledgement, then permits automatic snapshots with `tick` strictly after that accepted barrier. Stock/thermal/status reconciliation stays independent of this pose filter.

The exact serialization names are reconciled with C2's completed protocol during implementation; do not preemptively change its fields now. The required ordering and outcomes are unambiguous: old enabled snapshot before acknowledgement → no pose write; wrong-life/wrong-instance/obsolete transition acknowledgement → no pose write; accepted current pose → seed/round-trip equal held motor pose; subsequent native snapshot → bounded motion from it. Rapid SOLO→ALL→SOLO transitions and reconnect must never let an old acknowledgement claim current automatic ownership.

- [ ] **6. Add actual server-handler REDs and fresh source-tagged receipt phases.** Extend `crates/server/src/gameplay_tests.rs` or `ammo_tests.rs` using their existing `real_lobby`, `send`, `sortie` and trusted `tick_at` helpers. For each APS variant and both modes, execute actual Hello/Create/Start/Deploy/State/APS-disable/manual-Fire/State/APS-enable/tick handlers. Record actual accepted-pose acknowledgement and Snap output, not hand-authored expected messages. Include these phases:

```text
warm actual automatic interception and capture real heat/spin/rate/stock
disable; accept current legal held pose after parent/hull carry
manual APS fire from a legal moved joint; finish its existing normal source loading cycle
publish final held State; request ALL enable; record acknowledgement before next Snap
first automatic step moves at most its real rate from accepted held pose
U off survives SOLO/ALL; Y preserves chosen rate without canceling normal loading
empty/refilled belt remains inhibited until C2's exact trusted reload gate ends
invalid/nonfinite/out-of-arc/too-fast/wrong-life/stale/away pose cannot enable or grant anything
old enabled Snap before barrier and rapid obsolete acknowledgements cannot overwrite held pose
```

Replay those genuine outputs through C2's completed `live-network-rig.mjs`, `NetClient`, actual `onlineSky/applyAps`, loader and `OnlineAmmo` handlers in `ammo-resupply-network.test.mjs`. Verify real held pose, first post-barrier pose, actual scoped gun/launch receipts, counts/targets/revisions, source reload work, heat/spin/rate, U intent and repair gates. Reuse the existing battle/life metadata; the pose handshake cannot grant ammunition or retire a discharge prediction.

Regenerate the existing actual handler producers to **new** weapon-control receipt paths, retaining old outputs as historical evidence. Preserve their complete mandatory tag set and add the changed WASM bridge source (`crates/design-wasm/src/lib.rs`) to both producer and consumer tags. `world.rs`, `missiles.rs`, `lobby.rs`, and the modified native handler test sources must remain mandatory. Missing/stale source bytes fail before replay.

- [ ] **7. Sole-native-lane GREEN after C2, followed by root acceptance.** These are execution commands for that lane, not commands run by this document author:

```powershell
cargo test -p tg-missile aps_pose
cargo test -p tg-server aps_pose --lib
$env:TG_GAMEPLAY_NETWORK_RECEIPT='C:/Users/24908/.codex/scratch/tankforge-gameplay-modes/target/weapon-control-gameplay-network.json'
cargo test -p tg-server browser_protocol_receipt_from_actual_handlers --lib
$env:TG_AMMO_RESUPPLY_RECEIPT='C:/Users/24908/.codex/scratch/tankforge-gameplay-modes/target/weapon-control-ammo-network.json'
cargo test -p tg-server browser_ammo_resupply_receipt_from_actual_handlers --lib
cargo build -p tg-design-wasm --release --target wasm32-unknown-unknown
```

Root/lane owner then points `TG_TEST_WASM` at the actual new release core and runs the Node focused/full suites plus genuine current receipt replay. Record fresh native test names/counts, receipt source identities and current-WASM hashes. Build the current web source with that core and verify source/core/page equality; do not reuse the older committed WASM for handoff acceptance. Browser/HTTP/CDP/Playwright stay NOT RUN under the existing restriction.

## Task 6: Persistent UI, lifecycle/swap compatibility and final evidence

**Files:** `client/web/src/game/hud.js`; `client/web/template.html`; `client/web/src/main.js:HUD/select`; `client/web/test/weapon-control.test.mjs`; existing gameplay/network/ammo fixtures from the file map.

- [ ] **1. Add actual HUD and lifecycle REDs.** Test `Hud.prototype` methods with the current minimal DOM sink pattern; verify real `buildGunList` creates gun 0's row and the real `guns/mgs` methods select exactly one row. Add these label assertions using the live cycle and real label method (which is introduced next):

```js
test('persistent control label distinguishes ALL and gun 0 with identical sight indices',()=>{
  const r=controls('su_bmpt34'),e={textContent:'',dataset:{}};
  const show=()=>Hud.prototype.weaponControl.call({el:{control:e}},
    selection.weaponControlLabel(r.G.loadout,r.G.weaponControl),selection.weaponControlKey(r.G.weaponControl));
  show();assert.equal(e.textContent,'全炮開火');assert.equal(e.dataset.control,'all');
  r.live.cycleSightGun();show();assert.equal(r.G.sightT,0);assert.equal(r.G.sightG,0);
  assert.equal(e.dataset.control,'gun:0:0');assert.match(e.textContent,/火炮 1 單獨開火/);
  chooseControl(r,'gun:0:1');show();assert.equal(e.dataset.control,'gun:0:1');
});
```

In the existing `gameplay-network.test.mjs` real runtime, enter a solo using the actual cycle, then invoke its extracted `select`, Start, and Respawned handlers for the actual source vehicles/Hetzer variants. Assert each fresh selection resets to `{kind:'all'}`, valid sight references, no pending shot and the original new-life ammo plan. Exercise `de_hetzer`, `de_hetzer_sdkfz1401`, `de_hetzer_flak`, `de_hetzer_mk103`, `de_hetzer_mk103_camo` through the existing actual turret-swap/workshop builder path; preserve sourceVehicle metadata, fitted guns/MGs, anchors, chosen ammo, model/payload and C1 repair gates. A reconnect that does not call `select` retains the current mode and pending network receipts; it does not grant stock or reset readiness.

Add `captureAmmoPlan` to the existing inventory import in `weapon-control.test.mjs` and the following complete source/workshop cycle vector. `buildToBundle` is the current real workshop compiler; use its returned bundle without rewriting catalog files. Existing `hetzer-reference`/`workshop-loadout` tests continue proving the model and borrowed-source metadata path:

```js
test('source vehicles and actual Hetzer head swaps cycle without changing finite life stock',()=>{
  const cases=['de_hetzer','de_hetzer_sdkfz1401','de_hetzer_flak','de_hetzer_mk103','de_hetzer_mk103_camo']
    .map(id=>({id,bundle:data.vehicles[id]}));
  for(const keepStock of [false,true]) {
    const build={base:'de_hetzer',keepStock,turrets:[{...loadout.newTurretSpec(),guns:[{weapon:'xp_kda35'}]}]};
    const compiled=loadout.buildToBundle(build,data);
    cases.push({id:'hetzer_control_'+keepStock,bundle:compiled.bundle});
  }
  for(const {id,bundle} of cases) {
    const r=controls(id,false,bundle),plan=captureAmmoPlan(r.G.loadout);
    const before=r.G.loadout.turrets.map(t=>t.guns.map(g=>({ammo:g.ammo.map(a=>a.count),loaded:g.loaded,
      selected:g.selected,belt:g.belt,launcher:structuredClone(g.launcher)})));
    const expected=selection.weaponControlSlots(r.G.loadout).map(selection.weaponControlKey),seen=[];
    for(let i=0;i<expected.length;i++){seen.push(selection.weaponControlKey(r.G.weaponControl));r.live.cycleSightGun();}
    assert.deepEqual(seen,expected);assert.equal(selection.weaponControlKey(r.G.weaponControl),'all');
    assert.deepEqual(captureAmmoPlan(r.G.loadout),plan);
    assert.deepEqual(r.G.loadout.turrets.map(t=>t.guns.map(g=>({ammo:g.ammo.map(a=>a.count),loaded:g.loaded,
      selected:g.selected,belt:g.belt,launcher:structuredClone(g.launcher)}))),before);
    assert.equal(r.G.pending.length,0);
  }
});
```

The existing live NetClient fixture's reset vector is concrete and must use its real `select`; keep the already validated native Start/Respawned receipt replay immediately beside it:

```js
test('fresh selection resets SOLO control while same-life resume preserves it',()=>{
  const r=runtime('historical');
  for(const id of ['de_hetzer','de_hetzer_sdkfz1401','de_hetzer_flak','de_hetzer_mk103','de_hetzer_mk103_camo']) {
    r.live.select(id);r.live.cycleSightGun();
    assert.equal(selection.weaponControlKey(r.G.weaponControl),'gun:0:0');
    r.live.select(id,true);
    assert.deepEqual(r.G.weaponControl,{kind:'all'});
    assert.deepEqual([r.G.sightT,r.G.sightG,r.G.sightM],[0,0,-1]);
    assert.deepEqual(r.G.pending,[]);
    assert.deepEqual(r.G.ammoPlan,captureAmmoPlan(r.G.loadout));
  }
  const actual=runtime('casual');
  for(const phase of ['welcome_a','room','start','deploy_a'])
    for(const [to,m] of receipt.phases[phase])if(to===receipt.a)actual.net._receive(m);
  actual.live.cycleSightGun();
  const control=actual.G.weaponControl,gun=actual.G.loadout.turrets[0].guns[0];
  const stock=gun.ammo.map(a=>a.count);
  for(const [to,m] of receipt.phases.resume)if(to===receipt.a)actual.net._receive(m);
  assert.equal(actual.G.weaponControl,control,'same-life resume retains local control object');
  assert.equal(actual.G.loadout.turrets[0].guns[0],gun);
  assert.deepEqual(gun.ammo.map(a=>a.count),stock,'resume grants no stock');
});
```

Replay existing source-tagged actual native Fire/Launch/APS receipt messages through the real `NetClient` and live handlers. A solo gun packet must preserve its precise `gun:ti:gi`, selected shell and sequence; an MG packet preserves `mg:<id>`; a launch retains its original binding through ACK/retry after G. Preserve C2 battle/life scope when that implementation is present. Do not fabricate a receipt, silence mandatory source-tag failures, or rebind an already sent request to the new selected weapon. Add the real `cycleSightGun`, `trigger` and `fireGun` functions to the existing handler dependency injection rather than replacing their logic with mocks.

- [ ] **2. Run RED.** `node --test --test-name-pattern='persistent control label|fresh selection resets|solo network instance' client/web/test/weapon-control.test.mjs client/web/test/gameplay-network.test.mjs`. The label and first-row tests fail before UI changes; actual lifecycle/network assertions fail only on the corresponding behavioral gaps.

- [ ] **3. Add the small persistent UI adapter.** Add `control:$('weapon-control')` in Hud's `el` map and this exact method:

```js
weaponControl(text,key) {
  const e=this.el.control;
  if(e.textContent!==text) e.textContent=text;
  if(e.dataset.control!==key) e.dataset.control=key;
}
```

Add this HTML immediately before the existing `gun-head`; give it the existing gunbox background/padding style by adding `#gunbox #weapon-control` to that selector. Do not unhide unrelated hidden view/zero controls:

```html
<div id="weapon-control" data-control="all">全炮開火</div>
```

Replace the existing G help description with:

```html
<dt><kbd>G</kbd></dt><dd>全炮開火 → 各火炮單獨 → 各機槍單獨；單獨模式只射擊所選武器</dd>
```

Remove only `if(ti===0&&gi===0)return` from `Hud.buildGunList` so the first gun gets its existing indexed row. Replace live HUD `sighting` booleans with control identity, and call the label method in the regular HUD block:

```js
// Gun state entry:
sighting:G.weaponControl.kind==='gun'&&ti===G.weaponControl.ti&&gi===G.weaponControl.gi
// MG state entry:
sighting:G.weaponControl.kind==='mg'&&i===G.weaponControl.mi
// Regular HUD block, before hud.guns(states):
hud.weaponControl(weaponControlLabel(G.loadout,G.weaponControl),weaponControlKey(G.weaponControl));
```

Initialize the label after `select` rebuilds gun/ammo rows using the same call. ALL shows its own label with no solo-highlighted row. The existing reload ring still represents the sight/reference gun; selection stock/repair/resupply display remains intact.

- [ ] **4. Migrate fixture dependencies without weakening assertions.** Replace explicit `nextSightWeapon` imports in `ammo-resupply-aps.test.mjs` with the actual newly used policy namespace. Inject new helpers into all compiled live handlers. Any fixture setting `G.sightT/G/M` to select a weapon must set the corresponding `G.weaponControl` and derive its sight, or call the real cycle through `chooseControl`; optical-only tests may retain deliberate references when they do not execute a control owner. Replace hard-coded “one G reaches APS”/“next G restores main” expectations with the explicit cycle; keep original stock/heat/damage/real model assertions. The browser regression file's fixed-coax expectation must become frozen cannon plus actual reticle offset, but it remains unexecuted.

```js
// Fixture initialization for the documented default:
G.weaponControl={kind:'all'};
// Exact fixture-only explicit selection where an actual cycle is not under test:
G.weaponControl={kind:'mg',mi:i};
Object.assign(G,{sightT:0,sightG:0,sightM:i});
// New dependencies are the real exports, never copies of their implementation:
Object.assign(deps,selection);
```

The `gameplay-performance.test.mjs` spin block has its own positional compilation instead of `deps`; change its compiler and call together so its real extracted frame can resolve the policy:

```js
const spin=new Function('G','t','ti','SIM_DT','clamp','gunTrigger',
  source.slice(spinStart,spinEnd+'\n        });'.length));
// Preserve its existing automaticControls return fields; replace only spinStep:
spinStep:dt=>spin(G,lo.turrets[ti],ti,dt,clamp,selection.gunTrigger)
```

Add `import * as selection from '../src/game/weaponselection.js'` there and spread it into its `fireGun` deps. This retains the measured timing tests rather than replacing the live rotary frame with a copied implementation.

- [ ] **5. Run focused GREEN and full Node verification.** From the isolated project root:

```powershell
node --test client/web/test/weapon-selection.test.mjs client/web/test/weapon-control.test.mjs client/web/test/third-person-aa.test.mjs client/web/test/hetzer-mg-anchor.test.mjs client/web/test/hetzer-reference.test.mjs client/web/test/workshop-loadout.test.mjs client/web/test/workshop-damage-bindings.test.mjs client/web/test/oplot23-variant.test.mjs client/web/test/gameplay-runtime.test.mjs client/web/test/launcher-damage-control.test.mjs client/web/test/optics.test.mjs client/web/test/ammo-resupply-aps.test.mjs client/web/test/ammo-resupply-runtime.test.mjs client/web/test/ammo-inventory.test.mjs client/web/test/range-ammo-reset.test.mjs client/web/test/online-fire.test.mjs client/web/test/online-launch.test.mjs client/web/test/gameplay-network.test.mjs
node --test client/web/test/*.test.mjs
```

Expected: all current tests pass with zero new failures or skipped cases. Record actual test counts and separate focused/full results. If the native receipt source tags changed through C2, root must obtain the genuine regenerated receipt from the sole native owner before replay; a stale receipt is not a selection regression and must not be worked around.

- [ ] **6. Root-only final acceptance.** Request fresh SPEC review against the design and fresh QUALITY review of runtime/tests. Integrate only exact reviewed source/test/document paths. The Task 5A native pose handoff requires fresh current-source WASM and regenerated actual-handler receipts after C2 in the sole native lane. Root builds the current web source with its configured esbuild binary, proves bundled source/core equality, and preserves all older named page/original-asset/B2 hashes using a new acceptance receipt. Browser, HTTP, CDP and Playwright remain NOT RUN unless the root obtains applicable new authorization; do not claim rendered validation from numeric tests. No runtime writer stages, commits, publishes or deploys independently under this plan.

## Self-review and acceptance map

| Required behavior | Task / meaningful evidence |
| --- | --- |
| Default ALL and first gun distinct, every mounted gun/MG once, repeated cycles | 1 pure sequence and unique identity; 2 actual cycle; 6 real label/first row. |
| All primary cannons and preserved N/R groups | 1 intrinsic role vectors; 2 real BMPT dual-cannon and dedicated-key dispatch. |
| Gun solo including secondary/rocket, MG left/N solo, no unselected fire | 1 routing; 2 exact live queue/debit; 4 actual MG bullet and silent siblings. |
| Held input switching and no stale queued shot | 2 real trigger/pending update block; 6 original online request binding. |
| Inactive yaw/elevation hold, no late stabilized re-lay | 3 real `aimTurrets` and direct `trackHull`; rate-bound reselect. |
| Same ring, independent rings, parent/child physical carry | 3 local yaw and sibling elevation; actual model transforms retained. |
| Roof/hull/coax MG hardware and held joints | 4 real slew/bore tests, no coax convergence demand or invented joint. |
| Actual reticle, muzzle, optics, zero, parallax and ranging origin | 4 existing live projection plus genuine `Hud.drawSight`/ballistic/model assertions. |
| Both APS variants, every solo held, old pose snapshot, U/Y intent, manual fire | 5 real WASM/control snapshots and precise manual APS packet. |
| ALL/U-on/loader-ready resumes from accepted held pose, with bounded trusted joints and no stale snapshot snap | 5A world/WASM adoption, actual native/server handlers, coordinate round trips and current-life Snap barrier replay. |
| C1 selected stocks, resupply/reload/ready payload, heat/repair conserved | 5 unchanged exhaustion/grant/loader assertions; 6 lifecycle/swap regressions. |
| Source vehicles and Hetzer turret swapping, real online handlers/C2 scope | 6 actual selection/build/receipt replay, no fabricated authority. |
| Bounded changes, current source/build evidence, honest visual limit | File map, surgical owner edits and root-only final acceptance. |

This plan is documentation only. No runtime tests, native commands or browser tooling were executed by its author. The coordinator subsequently authorized a commit of exactly this plan and its paired design document; no runtime source or generated artifacts belong to that commit. Root review and execution remain pending; the checkboxes are deliberately unchecked.
