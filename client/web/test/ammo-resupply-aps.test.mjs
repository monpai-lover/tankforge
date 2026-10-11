import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadData } from '../tools/load-data.mjs';
import { loadCoreSync } from '../src/design/core.js';
import * as loadout from '../src/game/loadout.js';
import * as loading from '../src/sim/loading.js';
import { deriveLoadoutPerformance, deriveVehicleParams } from '../src/game/gameplayPerformance.js';
import { applyAmmo } from '../src/game/deploy.js';
import * as damage from '../src/game/weaponDamage.js';
import { weaponReloadRate } from '../src/game/weaponDamage.js';
import * as inventory from '../src/game/ammoInventory.js';
import * as policy from '../src/game/ammoResupply.js';
import * as phys from '../src/sim/physics.js';
import * as gunnery from '../src/sim/gunnery.js';
import * as ballistics from '../src/sim/ballistics.js';
import * as mgSim from '../src/sim/mg.js';
import { hullTilt } from '../src/sim/tank/tank.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { VehicleSim } from '../src/game/vehicle.js';
import { Combat, emptyRacks } from '../src/game/combat.js';
import { Conquest, captureMessage } from '../src/game/conquest.js';
import { nextSightWeapon } from '../src/game/weaponselection.js';
import { ground } from './tankrig.mjs';
const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n'),data=loadData();
function body(name){const start=source.indexOf(`  function ${name}(`);assert.ok(start>=0);return source.slice(start,source.indexOf('\n  }',start)+4);}
function runtime(id,mode){
  const lo=deriveLoadoutPerformance(loadout.makeLoadout(id,data.vehicles[id],data.projectiles,data.machineGuns),mode);applyAmmo(lo,{});
  const ti=lo.weapons.aps.turret??1,G={loadout:lo,mode:'battle',online:null,aps:lo.weapons.aps,apsOn:true,sightM:-1,sightT:0,
    T:lo.turrets.map(t=>({loading:loading.newLoading(t.guns.length,t.loaders.length,t.guns.map(g=>!g.rack))}))};
  const core=loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm',import.meta.url)),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)});
  core.call({op:'mw_reset',defs:Object.values(data.missiles)});core.call({op:'mw_aps',owner:1,team:0,def:G.aps,seed:10});
  G.missiles={setAps(owner,enabled,rate_rpm=null,rounds=null){core.call({op:'mw_aps',owner,enabled,rate_rpm,rounds});}};
  const live=new Function('G','ME','roundsLeft','net','hud',`${body('apsAutomatic')}\n${body('syncApsControl')}\n${body('cycleApsRate')}\nreturn {syncApsControl,cycleApsRate};`)(G,1,loadout.roundsLeft,{send(){}},{toast(){}});
  const actor={id:1,team:0,alive:true,center:[0,1.3,0],aps_pivot:[.502,2.715,.557],aps_base_yaw:0,aps_gun_ok:true,aps_radar_ok:true};
  const step=dt=>core.call({op:'mw_step',dt,actors:[actor]});
  const threat=seed=>core.call({op:'mw_launch',def:'bgm71a_tow',owner:99,team:1,pos:[0,2,600],dir:[0,0,-1],seed});
  return {G,core,live,step,threat,ti,g:lo.turrets[ti].guns[0],L:G.T[ti].loading};
}

// Real selection, fitted stock, damage, vehicle, fire, capture and frame loading owners.
// Only presentation/transport boundaries are sinks; no inventory operation is replaced.
function manualRuntime(id, mode) {
  const r = runtime(id, mode), G = r.G;
  Object.assign(G, {
    id, gameplayMode: mode, s: phys.newState(), pending: [], shots: [], bullets: [],
    cam: { yaw: 0, shake: 0 }, camPos: [0, 3, 0], enemies: [],
    combat: new Combat(r.core, data.machineGuns), guided: [],
  });
  const lifecycle = { adds: 0, removes: 0 };
  G.missiles.addAps = (owner, team, def, seed) => {
    lifecycle.adds++;
    r.core.call({ op: 'mw_aps', owner, team, def, seed });
  };
  G.missiles.removeAps = owner => {
    lifecycle.removes++;
    r.core.call({ op: 'mw_aps', owner, remove: true });
  };
  const sourceGun = data.vehicles[id].weapons.extra_turrets[0].guns[0].gun;
  const chosen = sourceGun.ammo.map((_, i) => i === 0 ? 7 : 0);
  const toasts = [], hud = new Proxy({ toast: text => toasts.push(text) }, { get: (o, k) => o[k] || (() => {}) });
  const terrain = ground(() => 0), cqBar = {}, cqMsg = { textContent: '' };
  const deps = {
    G, data, ME: 1, DEG: Math.PI / 180, RECOIL_ROCK: 1,
    ...loadout, ...inventory, ...policy, ...damage, loading, phys, gunnery, ballistics, mgSim,
    deriveLoadoutPerformance, deriveVehicleParams, applyAmmo, AMMO_CFG: { [id]: { '1.0': chosen } },
    nextSightWeapon, hullTilt, buildTank, VehicleSim, terrain, emptyRacks, captureMessage,
    renderer: { mesh: vertices => ({ vertices }), instancedMesh: vertices => ({ vertices }), setInstances() {}, freeMesh() {} },
    scene: { children: [], add(root) { this.children.push(root); } },
    onlineFires: { clear() {} }, isDesign: () => false,
    bundleFor: vehicle => ({ bundle: data.vehicles[vehicle], projectiles: data.projectiles }),
    store: { set() {} }, STORE_VEHICLE: 'unused', LANG_INDEX: 0,
    Exhaust: class {}, exhaustOf() {}, rebuildInterior() {}, applyXray() {}, statusShape() {}, measureInsets() {}, reloadShown() {},
    resetPose() { G.veh.place(0, 0, 0); G.veh.compat(G.s); },
    mods: { choose() {}, cardOf: vehicle => vehicle, slots: () => [] },
    hud, net: { inRoom: false, open: true, send() {} }, lobby: { render() {} },
    document: { getElementById: () => ({}) },
    sound: new Proxy({}, { get: () => () => {} }), fx: new Proxy({}, { get: () => () => {} }),
    moduleOk: () => true, rng: { nextF32: () => .5 }, surfaceAt: () => 0, impactColor: () => [0, 0, 0],
    cqBar, cqMsg, announcePoint() {}, toGarage() {}, enemyOwner: i => 100 + i,
    clamp: (n, a, b) => Math.max(a, Math.min(b, n)),
  };
  // The live preamble defines sightLevels, pose, pivotOf and the parent-aware mountOf.
  delete deps.sightLevels;
  const preamble = source.slice(source.indexOf('  const pose = '), source.indexOf('  // ----------------------------------------------------------------- workshop'));
  const names = ['select', 'selectAmmo', 'cycleSightGun', 'fireGun', 'conquestStep', 'resupplyStep',
    'apsAutomatic', 'syncApsControl', 'cycleApsRate', 'missileVehicle', 'combatInit', 'carriedRounds', 'syncRacks', 'applyAps'];
  const live = new Function(...Object.keys(deps), `${preamble}\n${names.map(body).join('\n')}\nreturn {${names.join(',')}};`)(...Object.values(deps));
  live.select(id);
  live.combatInit();
  G.conquest = new Conquest([{ id: 'A', x: 0, z: 0, r: 45 }]);
  G.conquest.local = true;
  Object.assign(G.conquest.points[0], { owner: 'blue', progress: 1 });
  const start = source.indexOf('      G.loadout.turrets.forEach((t, ti) => {\n        t.guns.forEach((g) => tickLauncher');
  const end = source.indexOf('\n      G.acc -= SIM_DT;', start);
  assert.ok(start >= 0 && end > start, 'actual loader completion frame');
  const frame = dt => new Function(...Object.keys(deps), 'SIM_DT', source.slice(start, end))(...Object.values(deps), dt);
  const ti = G.aps.turret ?? 1;
  return { ...r, live, frame, chosen, toasts, lifecycle, ti, g: G.loadout.turrets[ti].guns[0], L: G.T[ti].loading };
}
test('actual APS control and rate changes inhibit a healthy gun during normal loading',()=>{
  const r=runtime('su_t10m','historical');loading.fired(r.L,0);r.live.syncApsControl();assert.equal(r.step(0).aps[0].enabled,false,'requested on must wait for normal loader');
  r.live.cycleApsRate();assert.equal(r.step(0).aps[0].enabled,false,'rate selection must keep the reload gate');assert.equal(r.G.apsOn,true);
});
test('real WASM incoming missiles cannot use replenished Oplot stock before the source belt cycle',()=>{
  assert.equal(typeof inventory.captureAmmoPlan,'function','selected life targets exist');assert.equal(typeof policy.stepResupply,'function','five-second dwell exists');
  for(const id of ['su_t10m','su_t10m_oplot23'])for(const mode of ['historical','casual']){
    const r=runtime(id,mode),plan=inventory.captureAmmoPlan(r.G.loadout),state=policy.newResupplyState();
    r.threat(1);let warm;for(let i=0;i<1200;i++){warm=r.step(1/120);if(warm.fired.length)break;}
    assert.ok(warm.fired.length&&warm.aps[0].heat>0&&warm.aps[0].spin>0,'grant preservation starts from actual warm interception state');
    inventory.consumeApsRounds(r.G.loadout,`gun:${r.ti}:0`,loadout.roundsLeft(r.g));r.g.belt=0;r.g.loaded=-1;r.L.state[0]='empty';
    r.live.syncApsControl();const before=r.step(0).aps[0];assert.equal(policy.stepResupply(state,5,true,true).complete,true);
    inventory.refillAmmo(r.G.loadout,plan,r.G.T.map(t=>t.loading));r.live.syncApsControl();const granted=r.step(0).aps[0];
    for(const key of ['yaw','pitch','rate_rpm','heat','spin'])assert.equal(granted[key],before[key],`${id} ${key} at grant`);
    assert.equal(r.G.apsOn,true);assert.equal(granted.enabled,false);assert.equal(r.L.state[0],'waiting');
    const duration=r.g.def.autocannon.belt_reload_s;let last=granted,threats=0;
    for(let i=0;i<Math.ceil(duration*120)-1;i++){
      if(i%120===0){r.threat(3+threats++);}
      r.live.syncApsControl();last=r.step(1/120);assert.deepEqual(last.fired,[],`${id} ${mode} no fire before loader completion`);
      assert.deepEqual(loading.tick(r.L,1/120,(gi,li)=>loadout.reloadTime(r.G.loadout.turrets[r.ti],gi,li,mode),()=>weaponReloadRate(null,r.g.damageKey)),[]);
    }
    assert.ok(threats>0);assert.ok(last.aps[0].heat<=granted.heat);assert.ok(last.aps[0].spin<=granted.spin);assert.deepEqual(last.aps[0].track_pos||[],[],'disabled core reacquires tracks on re-enable');
    const done=loading.tick(r.L,1/120,(gi,li)=>loadout.reloadTime(r.G.loadout.turrets[r.ti],gi,li,mode));assert.deepEqual(done,[0]);
    loadout.refillBelt(r.g);r.g.loaded=loadout.nextAmmo(r.g);loadout.syncGunShell(r.g);r.live.syncApsControl();assert.equal(r.step(0).aps[0].enabled,true);
    r.threat(900);let fired=[];for(let i=0;i<1200&&!fired.length;i++)fired=r.step(1/120).fired;assert.ok(fired.length,`${id} ${mode} resumes genuine interception after reacquisition/spin-up`);
    r.G.apsOn=false;r.live.syncApsControl();assert.equal(r.step(0).aps[0].enabled,false);r.live.cycleApsRate();assert.equal(r.step(0).aps[0].enabled,false);
  }
});

test('actual manual Oplot short-load exhaustion stays idle until its owned-point grant completes the original belt cycle', () => {
  for (const id of ['su_t10m', 'su_t10m_oplot23']) for (const mode of ['historical', 'casual']) {
    const r = manualRuntime(id, mode), { G, g, L, ti } = r;
    assert.deepEqual(g.ammo.map(a => a.count), r.chosen, `${id} ${mode} actual saved selection`);
    assert.equal(g.belt, 7, 'a newly selected belt contains only its chosen finite stock');
    assert.deepEqual(G.ammoPlan[`gun:${ti}:0`].targets, r.chosen);
    r.live.cycleApsRate();
    // Warm the genuine world once, debit its actual snapshot, then manually spend every
    // remaining selected round. No final count/belt/loaded/loader state is assigned.
    r.threat(200);
    let warm;
    for (let i = 0; i < 1200; i++) { warm = r.step(1 / 120); if (warm.fired.length) break; }
    assert.ok(warm.fired.length && warm.aps[0].heat > 0 && warm.aps[0].spin > 0);
    r.live.applyAps(warm, { aps_gun_ok: true, aps_radar_ok: true });
    const remaining = loadout.roundsLeft(g);
    assert.ok(remaining > 0 && remaining < 7, 'warm automatic and manual control share the actual selected pool');
    r.live.cycleSightGun();
    assert.equal(G.sightT, ti);
    for (let i = 0; i < remaining; i++) {
      assert.equal(r.live.fireGun(ti, 0), true, 'actual manual handler accepts each remaining finite round');
      assert.equal(loadout.roundsLeft(g), remaining - i - 1);
      if (i + 1 < remaining) r.frame(1);
    }
    assert.equal(G.shots.length, remaining, 'only accepted manual discharges create those projectiles');
    assert.deepEqual(g.ammo.map(a => a.count), r.chosen.map(() => 0));
    assert.equal(g.belt, 0);
    assert.equal(g.loaded, -1);
    assert.equal(L.state[0], 'empty');
    r.frame(1);
    assert.equal(L.state[0], 'empty', 'the last shot retains the original idle-empty semantics');
    assert.ok(L.loaders.every(loader => loader.gun === -1), 'no invented last-shot loading job');
    assert.equal(r.live.fireGun(ti, 0), false);
    r.live.cycleSightGun();
    assert.equal(G.sightT, 0);
    assert.equal(G.apsOn, true, 'manual ownership did not change the U preference');
    r.live.syncApsControl();
    const before = r.step(0).aps[0], object = G.missiles, lifecycle = { ...r.lifecycle };
    assert.ok(before.heat > 0 && before.spin > 0, 'the grant compares a genuinely warm object');
    assert.equal(before.rounds, 0);
    const damageBefore = structuredClone({ modules: G.cstate.modules, crew: G.cstate.crew, caps: G.caps });
    r.live.conquestStep(4.75);
    assert.equal(G.resupply.elapsed, 4.75);
    assert.equal(loadout.roundsLeft(g), 0);
    r.live.conquestStep(.25);
    const granted = r.step(0).aps[0];
    assert.deepEqual(g.ammo.map(a => a.count), r.chosen, 'grant restores exactly this selected life');
    assert.equal(g.belt, 0);
    assert.equal(g.loaded, -1);
    assert.equal(L.state[0], 'waiting');
    assert.equal(g.beltChange, true);
    assert.equal(G.missiles, object);
    assert.deepEqual(r.lifecycle, lifecycle, 'grant never removes/re-adds the active protection object');
    assert.deepEqual({ modules: G.cstate.modules, crew: G.cstate.crew, caps: G.caps }, damageBefore);
    for (const key of ['yaw', 'pitch', 'rate_rpm', 'heat', 'spin']) assert.equal(granted[key], before[key], `${id} ${mode} preserved ${key}`);
    assert.equal(granted.rounds, 7);
    assert.equal(granted.enabled, false);
    assert.equal(G.apsOn, true);
    assert.equal(r.toasts.filter(text => text === '彈藥已補滿').length, 1);
    const ticks = Math.ceil(g.def.autocannon.belt_reload_s * 120);
    for (let i = 0; i < ticks - 1; i++) {
      if (i % 120 === 0) r.threat(300 + i);
      r.frame(1 / 120);
      assert.notEqual(L.state[0], 'ready');
      assert.equal(r.live.fireGun(ti, 0), false, 'manual fire cannot bypass the source belt timer');
      r.live.syncApsControl();
      assert.deepEqual(r.step(1 / 120).fired, [], 'automatic fire cannot bypass the same timer');
      assert.deepEqual(g.ammo.map(a => a.count), r.chosen);
    }
    r.frame(1 / 120);
    assert.equal(L.state[0], 'ready', 'actual frame completion ends exactly the original source cycle');
    assert.equal(g.belt, 7);
    assert.equal(g.loaded, 0);
    assert.equal(G.apsOn, true);
    r.live.cycleSightGun();
    assert.equal(r.live.fireGun(ti, 0), true, 'manual control resumes only after completion');
    assert.equal(loadout.roundsLeft(g), 6);
    r.frame(1);
    r.live.cycleSightGun();
    r.threat(900);
    let resumed;
    for (let i = 0; i < 1200; i++) { resumed = r.step(1 / 120); if (resumed.fired.length) break; }
    assert.ok(resumed.fired.length, 'requested automatic control resumes after normal reacquisition/spin-up');
    r.live.applyAps(resumed, { aps_gun_ok: true, aps_radar_ok: true });
    assert.equal(loadout.roundsLeft(g), resumed.aps[0].rounds);
    assert.deepEqual(r.lifecycle, lifecycle);
  }
});
