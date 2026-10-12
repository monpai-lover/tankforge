import { Missiles } from '../src/game/missiles.js';
import stabilizerDrives from '../../../config/stabilizer-drives.json' with { type: 'json' };
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as gunnery from '../src/sim/gunnery.js';
import * as ballistics from '../src/sim/ballistics.js';
import * as mgSim from '../src/sim/mg.js';
import * as loading from '../src/sim/loading.js';
import * as optics from '../src/game/optics.js';
import * as selection from '../src/game/weaponselection.js';
import * as loadout from '../src/game/loadout.js';
import { hullTilt } from '../src/sim/tank/tank.js';
import { RigidBody } from '../src/sim/tank/body.js';
import { foldDepression, foldYawLimit } from '../src/game/folding.js';
import { loadData } from '../tools/load-data.mjs';
import { loadCoreSync } from '../src/design/core.js';
import { Hud } from '../src/game/hud.js';
import { OnlineFires } from '../src/game/onlineFire.js';
import { OnlineAmmo } from '../src/game/onlineAmmo.js';
import { OnlineLaunches } from '../src/game/onlineLaunch.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { Combat, launcherCanFire, bulletShell } from '../src/game/combat.js';
import { Enemy, useCombat, combatHit } from '../src/game/enemies.js';
import { captureRangeTargetRestPose } from '../src/game/rangeTargetRevival.js';
import { hitTargets, groundHit } from '../src/game/world.js';
import * as performanceApi from '../src/game/gameplayPerformance.js';
import * as phys from '../src/sim/physics.js';
import { VehicleSim } from '../src/game/vehicle.js';
import { applyAmmo } from '../src/game/deploy.js';
import { ground } from './tankrig.mjs';
import { GameplaySession } from '../src/game/gameplaySession.js';
import { GAMEPLAY_RULES_VERSION } from '../src/game/gameplayRules.js';
import { GAMEPLAY_UPDATE_NEEDED } from '../src/game/net.js';
import { normalizeWorkshopBuild } from '../src/game/workshopBuild.js';
import * as inventory from '../src/game/ammoInventory.js';
import * as resupply from '../src/game/ammoResupply.js';
const damageApi = await import('../src/game/weaponDamage.js').catch(() => ({}));

const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const data = loadData(), DEG = Math.PI / 180, ME = 1;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const dirFrom = (yaw, pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
// Run the exact live function bodies, with real gun/loadout/ballistic dependencies.
// Presentation and transport sinks are the only fakes; no browser is needed.
function functionSource(name) {
  const start = source.indexOf(`  function ${name}(`);
  return start < 0 ? '' : source.slice(start, source.indexOf('\n  }', start) + 4);
}
function controls(id, mode = 'historical') {
  const lo = selectionRuntime(id, mode).loadout;
  const G = { id, mode: 'battle', weaponControl: { kind: 'all' }, gameplayMode: mode, loadout: lo, zero: 0,
    s: { x: 0, y: 0, z: 0, heading: 0 }, ss: { pitch: 0, roll: 0 },
    sightT: 0, sightG: 0, sightM: -1, pending: [], zoomIdx: 0,
    cam: { yaw: 0, pitch: 0, shake: 0 }, camPos: [0, 3, 0], aimPoint: [0, 3, 800], aim: { dist: 800 },
    MG: lo.machineGuns.map(m => ({ m, st: mgSim.newMg(m.def), aim: { yaw: 0, pitch: 0 }, bearing: true })),
    T: lo.turrets.map(t => ({ yaw: t.facing, bearing: true, yawErr: 0,
      guns: t.guns.map(() => ({ pitch: 0, pitchErr: 0, smoke: 0 })),
      loading: loading.newLoading(t.guns.length, t.loaders.length, t.guns.map(g => !g.rack)) })),
    aps: lo.weapons.aps, apsOn: true, shots: [], bullets: [], online: null,
    veh: { body: new RigidBody(1000, [1000, 1000, 1000], [0, 0, 0]), impulse() {}, worldPoint: p => p },
  };
  G.veh.netState=()=>({pos:G.veh.body.origin(),ex:G.veh.body.ex,ez:G.veh.body.ez,v:G.veh.body.v,w:G.veh.body.w,track:[0,0],rpm:0,gear:0});
  const sent = [], apsCalls = [];
  const core = loadCoreSync(fs.readFileSync(process.env.TG_TEST_WASM || new URL('../assets/tg_design.wasm', import.meta.url)),
    { materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains) });
  const combat = new Combat(core, data.machineGuns), fresh = combat.fresh('control:' + id, data.vehicles[id]);
  G.combat = combat; G.combatKey = 'control:' + id; G.cstate = fresh.state; G.caps = fresh.caps;
  G.bundle = combat.prepare?.(G.combatKey, data.vehicles[id]) || data.vehicles[id];
  core.call({ op: 'mw_reset', defs: Object.values(data.missiles) });
  if (G.aps) core.call({ op: 'mw_aps', owner: ME, team: 0, def: G.aps, seed: 10 });
  G.missiles = new Missiles({core,defs:data.missiles,projectiles:data.projectiles});
  const setAps=G.missiles.setAps.bind(G.missiles);
  G.missiles.setAps=(owner,enabled,rate_rpm=null,rounds=null)=>{apsCalls.push({owner,enabled,rounds});setAps(owner,enabled,rate_rpm,rounds);};
  const onlineAmmo=new OnlineAmmo(), selected=inventory.ammoMix(lo);
  onlineAmmo.begin({t:'ammo',ammo_protocol_version:1,battle:7,life:2,revision:1,processed_through:0,counts:selected,targets:selected,resupply_progress:0,refilled:false},lo,G.T.map(t=>t.loading));
  const deps = { G, stabilizerDrives, ME, data, DEG, RECOIL_ROCK: 1, BULLET_DT: 1 / 120, clamp, dirFrom, hullTilt, gunnery, ballistics, mgSim, loading, ...inventory,
    foldDepression, foldYawLimit, launcherCanFire, ...damageApi, ...performanceApi,
    ...selection, ...loadout, ...optics, rng: { nextF32: () => .5 },
    onlineFires: new OnlineFires(), onlineAmmo, net: { open: true, send: m => sent.push(m) }, hud: { buildAmmo() {}, toast() {}, aps() {} },
    sound: { tone() {}, apsGun() {}, mg() {}, shot() {} }, fx: { mgFlash() {}, autocannonBlast() {}, muzzleBlast() {}, bulletBoard() {}, bulletGround() {}, beam() {} },
    hitTargets, groundHit, combatHit, bulletShell, rangeTargets: () => [], buildingHit: () => null, onCombatHit() {}, rnd: k => v => Math.round(v * k) / k,
    surfaceAt: () => 0, impactColor: () => [0, 0, 0], selectAmmo() {},
    launcherMount: loadout.launcherMount, reloadTime: loadout.reloadTime,
  };
  delete deps.sightLevels;
  const preamble = source.slice(source.indexOf('  const pose = '), source.indexOf('  // ----------------------------------------------------------------- workshop'));
  const moduleCheck = source.slice(source.indexOf('  const moduleOk ='), source.indexOf('  /** Where the protection gun'));
  const stabilizers = source.slice(source.indexOf('  const GUNNER ='), source.indexOf('  /**\n   * The hull\'s attitude'));
  const functions = ['cycleSightGun', 'trigger', 'fireGun', 'layMg', 'sightMuzzle', 'stepMachineGuns', 'hitEnemy', 'wireShot', 'updateBullets', 'currentLos', 'applyAps', 'toggleAps', 'apsAutomatic', 'apsHullPose','apsFrame','heldApsPose','sendOnlineState','acceptApsPose','suspendApsPose','syncApsControl', 'mountFor', 'apsOf', 'trackHull', 'aimTurrets'].map(functionSource).join('\n');
  const live = new Function(...Object.keys(deps), `${preamble}\n${moduleCheck}\n${stabilizers}\n${functions}\nreturn {cycleSightGun, trigger, fireGun, layMg, sightMuzzle, stepMachineGuns, updateBullets, currentLos, applyAps, toggleAps, syncApsControl, apsOf, aimTurrets};`)(...Object.values(deps));
  const snapshot = () => core.call({ op: 'mw_step', dt: 1 / 60, actors: [] }).aps[0];
  return { G, live, sent, apsCalls, snapshot, core, combat, damage: (id, health = 0) => {
    G.cstate.modules[G.bundle.modules.findIndex(m => m.id === id)] = health;
    G.caps = combat.advance(G.combatKey, G.cstate, 0, 1).caps;
  } };
}
const close = (actual, expected, message, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) < epsilon, `${message}: ${actual} != ${expected}`);
function selectionRuntime(id, mode, build = loadout.PRESETS.hexa.build) {
  const terrain = ground(() => 0);
  const renderer = { mesh: vertices => ({ vertices }), instancedMesh: vertices => ({ vertices }), setInstances() {}, freeMesh() {} };
  const G = { mode: 'garage', gameplayMode: mode, s: phys.newState(), pending: [], cam: {}, build: structuredClone(build) };
  const hud = new Proxy({}, { get: () => () => {} });
  const scene = { children: [], add(root) { this.children.push(root); } };
  const deps = { G, stabilizerDrives, data, LANG_INDEX: 0, isDesign: () => false, bundleFor: id => ({ bundle: data.vehicles[id], projectiles: data.projectiles }),
    onlineFires: new OnlineFires(), onlineLaunches:new OnlineLaunches(), onlineAmmo:new OnlineAmmo(), scene, store: { set() {} }, STORE_VEHICLE: 'unused', ...selection, ...loadout, ...performanceApi, ...inventory, ...resupply, phys, applyAmmo, AMMO_CFG: {}, loading, mgSim, gunnery,
    renderer, buildTank, VehicleSim, terrain, Exhaust: class {}, fx: {}, exhaustOf() {}, applyXray() {}, rebuildInterior() {}, combatInit() {},
    resetPose() { G.veh.place(0, 0, 0); G.veh.compat(G.s); },
    mods: { choose() {}, cardOf: id => id, slots: () => [] }, hud, reloadShown() {}, selectAmmo() {}, sightGun: () => G.loadout.turrets[0].guns[0], statusShape() {},
    document: { getElementById: () => ({}) }, measureInsets() {}, net: {}, lobby: { render() {} }, missileVehicle() {} };
  const selectSource = `${functionSource('bundleFor')}\n${functionSource('select')}\nselect('${id}');`;
  new Function(...Object.keys(deps), selectSource)(...Object.values(deps));
  G.selectAgain = () => new Function(...Object.keys(deps), selectSource)(...Object.values(deps));
  return G;
}

test('actual selection derives source values once, keeps source/export data and each actor ammunition independent', () => {
  const id = 'su_t34_85', bundle = data.vehicles[id], before = structuredClone(bundle);
  const a = selectionRuntime(id, 'casual'), b = selectionRuntime(id, 'casual'), h = selectionRuntime(id, 'historical');
  close(a.params.vTop / h.params.vTop, 1.15, 'selected speed');
  close(a.params.power / h.params.power, 1.25 * 1.15, 'selected power');
  close(a.veh.tm.p.power / h.veh.tm.p.power, 1.25 * 1.15, 'VehicleSim owns matching derived power');
  close(a.loadout.turrets[0].traverse / h.loadout.turrets[0].traverse, 1.3, 'selected turret');
  assert.equal(a.sourceBundle, bundle);
  const count = b.loadout.turrets[0].guns[0].ammo[0].count;
  a.loadout.turrets[0].guns[0].ammo[0].count--;
  assert.equal(b.loadout.turrets[0].guns[0].ammo[0].count, count);
  const speed = a.params.vTop;
  for (let i = 0; i < 3; i++) { a.selectAgain(); close(a.params.vTop, speed, 'reselect never compounds'); }
  assert.deepEqual(bundle, before, 'original source files remain source-valued');
  const original = loadout.exportFolder(a.build, data, { armor: bundle.armor, modules: bundle.modules, crew: bundle.crew });
  const historical = loadout.exportFolder(h.build, data, { armor: bundle.armor, modules: bundle.modules, crew: bundle.crew });
  assert.deepEqual(original, historical, 'workshop export unaffected by selected gameplay');
});
test('real tracked and wheeled VehicleSim launches gain drive while retaining source geometry, steering lock and historical defaults', () => {
  for (const id of ['su_t34_85', 'us_m8']) {
    const run = mode => {
      const G = selectionRuntime(id, mode);
      for (let i = 0; i < 240; i++) G.veh.step({ throttle: 0, steer: 0, brake: 1 }, 1 / 120, false);
      for (let i = 0; i < 960; i++) G.veh.step({ throttle: 1, steer: 0, brake: 0 }, 1 / 120, false);
      return G;
    };
    const a = run('casual'), h = run('historical');
    assert.ok(a.veh.info.speedKmh > h.veh.info.speedKmh * 1.05, `${id} actual launch ${a.veh.info.speedKmh}/${h.veh.info.speedKmh}`);
    const stock = new VehicleSim(data.vehicles[id], h.model, ground(() => 0));
    assert.deepEqual(stock.tm.p, h.veh.tm.p, 'omitted mode remains historical');
    assert.deepEqual(a.veh.tm.inertia, h.veh.tm.inertia);
    if (id === 'us_m8') {
      assert.equal(a.veh.tm.minR, h.veh.tm.minR);
      assert.deepEqual(a.veh.tm.wheels, h.veh.tm.wheels);
      for (const r of [a, h]) { r.veh.place(0, 0, 0); r.veh.step({ throttle: 0, steer: 1, brake: 0 }, .05, false); }
      close(a.veh.t.ds.steer / h.veh.t.ds.steer, 1.25, 'actual road wheel actuator');
    }
  }
});
test('actual aiming and independent roof MG poses apply horizontal/vertical factors once', () => {
  const h = controls('su_is2', 'historical'), a = controls('su_is2', 'casual');
  for (const r of [a, h]) { r.G.aimPoint = [400, 200, 400]; r.live.aimTurrets(.05); }
  close(a.G.T[0].yaw / h.G.T[0].yaw, 1.3, 'main traverse pose');
  close(a.G.T[0].guns[0].pitch / h.G.T[0].guns[0].pitch, 1.2, 'main elevation pose');
  const i = h.G.MG.findIndex(e => e.m.mount === 'pintle');
  for (const r of [a, h]) { r.G.sightM = i; r.live.layMg(i, .05); }
  close(a.G.MG[i].aim.yaw / h.G.MG[i].aim.yaw, 1.3, 'MG horizontal pose');
  close(a.G.MG[i].aim.pitch / h.G.MG[i].aim.pitch, 1.2, 'MG vertical pose');
});
function loadStep(r, dt) {
  const start = source.indexOf('      G.loadout.turrets.forEach((t, ti) => {\n        t.guns.forEach((g) => tickLauncher');
  const end = source.indexOf('\n      G.acc -= SIM_DT;', start);
  assert.ok(start >= 0 && end > start, 'actual main loader/spin loop');
  const deps = { G: r.G, SIM_DT: dt, ...loadout, loading, ...damageApi, sound: { click() {} }, clamp };
  new Function(...Object.keys(deps), source.slice(start, end))(...Object.values(deps));
}
test('actual manual reload emits at final layout time/fire, consumes real ammo and respects loader damage', () => {
  const a = controls('su_t34_85', 'casual'), h = controls('su_t34_85');
  const fired = r => {
    const before = loadout.roundsLeft(r.G.loadout.turrets[0].guns[0]);
    assert.equal(r.live.fireGun(0, 0), true);
    const timestamps = [0];
    for (let i = 1; i < 3000 && timestamps.length < 2; i++) { loadStep(r, 1 / 120); if (r.G.T[0].loading.state[0] === 'ready') { assert.equal(r.live.fireGun(0, 0), true); timestamps.push(i / 120); } }
    assert.equal(loadout.roundsLeft(r.G.loadout.turrets[0].guns[0]), before - 2);
    assert.equal(r.G.shots.length, 2);
    return timestamps;
  };
  const at = fired(a), ht = fired(h);
  close(at[1] / ht[1], 1 / 1.2, 'actual emitted manual reload timing', .002);
});
test('actual MG emission cadence consumes one round and keeps heat per shot/capacity', () => {
  const a = controls('de_pz3_j', 'casual'), h = controls('de_pz3_j');
  const run = r => {
    r.G.weaponControl = { kind: 'mg', mi: 0 }; r.G.sightM = 0; r.G.fireHeld = true;
    const st = r.G.MG[0].st, cap = st.belt, timestamps = [];
    for (let i = 0; i < 60; i++) { const n = r.G.bullets.length; r.live.stepMachineGuns(1 / 120); if (r.G.bullets.length > n) timestamps.push(i / 120); }
    assert.equal(st.belt, cap - r.G.bullets.length);
    return timestamps;
  };
  const at = run(a), ht = run(h);
  assert.ok(at.length > ht.length);
  close((at[2] - at[0]) / (ht[2] - ht[0]), 1 / 1.2, 'actual MG emitted intervals', .06);
  assert.equal(a.G.MG[0].m.def.heat_rounds, h.G.MG[0].m.def.heat_rounds);
  assert.equal(a.G.MG[0].m.def.belt_rounds, h.G.MG[0].m.def.belt_rounds);
});
test('actual enemy/remote selection and APS registration use locked mode descriptors', () => {
  for (const name of ['spawnEnemies', 'addRemote']) {
    const G = { id: 'su_t34_85', gameplayMode: 'casual', mode: 'battle', s: {}, enemies: [] };
    const deps = { G, stabilizerDrives, data, ENEMY_POOL: ['su_t10m'], clearEnemies() { G.enemies = []; }, rangeVehicleTargets: () => [{ id: 'su_t10m', x: 0, z: 0, heading: 0 }],
      ...loadout, ...performanceApi, buildTank, renderer: { mesh: vertices => ({ vertices }), instancedMesh: vertices => ({ vertices }), setInstances() {}, freeMesh() {} },
      scene: { add() {} }, Enemy, terrain: ground(() => 0), onlineSpawn: () => ({ x: 0, z: 0, heading: 0 }), useCombat, captureRangeTargetRestPose };
    new Function(...Object.keys(deps), `${functionSource(name)}\n${name === 'spawnEnemies' ? 'spawnEnemies()' : "addRemote({ id: 9, vehicle: 'su_t10m', team: 'red', name: 'other' })"};`)(...Object.values(deps));
    close(G.enemies[0].loadout.weapons.aps.rate_rpm / data.vehicles.su_t10m.weapons.aps.rate_rpm, 1.2, `${name} APS`);
    close(G.enemies[0].veh.tm.p.power / phys.makeParams(data.vehicles.su_t10m.vehicle, data.vehicles.su_t10m.engine).power, 1.25 * 1.15, `${name} VehicleSim`);
    const registrations = [];
    G.missiles = { reset() {}, setAps() {}, addAps: (...args) => registrations.push(args) };
    const init = { G, onlineLaunches: { clear() {} }, missileTerrain: () => null, missileVehicle() {}, enemyOwner: () => 100, ...inventory, ...resupply, ...loadout, loading };
    G.enemies[0].rangeTarget = false; G.enemies[0].remote = false;
    new Function(...Object.keys(init), `${functionSource('missileBattleStart')}\nmissileBattleStart();`)(...Object.values(init));
    assert.equal(registrations[0][2], G.enemies[0].loadout.weapons.aps, 'registered APS uses runtime descriptor');
  }
});

test('actual start, garage choice, locked reselect/respawn and leave restore effective profiles without compounding', () => {
  const G = selectionRuntime('su_t34_85', 'casual'), gameplay = new GameplaySession({ get() {}, set() {} });
  Object.assign(G, { thumbs: [], mapId: 'range', maps: new Map(), enemies: [], keys: new Set() });
  const elements = new Map(), document = { body: { dataset: {} }, getElementById(id) { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); } };
  const hud = new Proxy({}, { get: () => () => {} });
  const deps = { G, stabilizerDrives, gameplay, GAMEPLAY_RULES_VERSION, GAMEPLAY_UPDATE_NEEDED, data, document, hud, sound: {}, canvas: {},
    select: () => G.selectAgain(), isDesign: () => false, testRange: { exit() {} }, setProtect() {}, setWorkshop() {}, setXray() {}, thumbStep() {},
    useWorld() {}, spawnEnemies() {}, spawnRemotes() {}, resetPose() {}, missileBattleStart() {}, updateNetHud() {},
    mapName: () => 'range', deploy: { close() {} }, cqBar: {}, cqMsg: {}, clearEnemies() { G.enemies = []; }, hitcam: { hide() {} }, measureInsets() {}, net: { send() {} },onlineAmmo:new OnlineAmmo() };
  const names = ['setMode', 'gameplayLabel', 'updateGameplayDisplay', 'chooseGameplayMode', 'startBattle', 'toGarage'];
  const live = new Function(...Object.keys(deps), `${names.map(functionSource).join('\n')}\nreturn {chooseGameplayMode, startBattle, toGarage};`)(...Object.values(deps));
  assert.equal(live.chooseGameplayMode('historical'), true);
  assert.equal(elements.get('gameplay-btn').textContent, '玩法：歷史');
  const stock = G.params.vTop;
  assert.equal(live.chooseGameplayMode('casual'), true);
  close(G.params.vTop / stock, 1.15, 'garage choice');
  live.startBattle({ mode: 'historical', version: GAMEPLAY_RULES_VERSION });
  assert.equal(G.mode, 'battle'); assert.equal(G.gameplayMode, 'historical');
  close(G.params.vTop, stock, 'room profile selected from original');
  assert.equal(live.chooseGameplayMode('casual'), false);
  G.selectAgain(); close(G.params.vTop, stock, 'locked respawn');
  live.toGarage();
  assert.equal(G.gameplayMode, 'casual'); close(G.params.vTop / stock, 1.15, 'restored local preference');
  live.startBattle();
  assert.equal(G.gameplayMode, 'casual');
  assert.match(elements.get('gameplay-rule').textContent, /休閒/);
  live.toGarage();
  G.online = { team: 'blue' };
  assert.throws(() => live.startBattle(), /更新/, 'online start requires authoritative room rules');
  live.startBattle({ mode: 'historical', version: GAMEPLAY_RULES_VERSION });
  assert.equal(G.gameplayMode, 'historical', 'supported historical rooms retain source server physics');
  live.toGarage();
});

test('actual main autocannon loading emits scaled cycles without dividing the derived cadence again', () => {
  const run = mode => {
    const r = controls('xp_kda35', mode), g = r.G.loadout.turrets[0].guns[0], times = [];
    g.spin = 1; r.G.sightT = 0; r.G.fireHeld = true;
    for (let i = 0; i < 240; i++) {
      if (r.G.T[0].loading.state[0] === 'ready') { assert.equal(r.live.fireGun(0, 0), true); times.push(i / 120); }
      loadStep(r, 1 / 120);
    }
    assert.equal(g.belt, g.def.autocannon.belt_rounds - times.length);
    return { times, r };
  };
  const a = run('casual'), h = run('historical');
  for (const [result, factor] of [[a, 1.2], [h, 1]]) {
    const expected = 60 / data.vehicles.xp_kda35.weapons.main_gun.autocannon.rate_rpm / factor;
    close((result.times[10] - result.times[0]) / 10, expected, 'actual automatic cycle within one fixed step', 1 / 120);
  }
  assert.equal(a.r.G.shots[0].shell, h.r.G.shots[0].shell, 'original round ballistic definition');
});

test('actual player and bot missile launch paths emit scaled tube intervals and retain ammunition and missile definition', () => {
  for (const actor of ['player', 'bot']) for (const mode of ['casual', 'historical']) {
    const G = selectionRuntime('us_m901_itv', mode), g = G.loadout.turrets[0].guns[0];
    Object.assign(G, { mode: 'battle', time: 0, guided: [], T: [{ yaw: 0, guns: [{ pitch: 0 }], loading: loading.newLoading(1, 1) }] });
    const emissions = [], mdef = data.missiles[g.def.missile];
    G.missiles = { ready: true, nodes: new Map(), guide() {}, launch(...args) { emissions.push({ at: G.time, args }); return emissions.length; } };
    const deps = { G, stabilizerDrives, data, ME, DEG, rng: { nextF32: () => .5 }, ...loadout, ...damageApi, launcherCanFire,
      playerMiddle: () => [0, 2.7, 500], enemyOwner: () => 100, enemyYaws: e => [e.turretYaw || 0], enemyPose: () => ({ pos: [0, 0, 0], heading: 0 }),
      mountFor: (lo, yaws, ti) => ({ pivot: lo.turrets[ti].pivot, trunnion: lo.turrets[ti].guns[0].trunnion }),
      losHit: () => null, loading, gunnery, hud: { toast() {} } };
    const e = { loadout: G.loadout, alive: true, x: 0, z: 0, heading: 0, mslT: 0, ammoLoading: [loading.newLoading(1, 1)], gunPitch: [0], pose() {}, model: { payload() {} } };
    G.enemies = [e];
    const live = new Function(...Object.keys(deps), `${functionSource('launchFromGun')}\n${functionSource('aiMissiles')}\nreturn {launchFromGun, aiMissiles};`)(...Object.values(deps));
    const before = loadout.roundsLeft(g);
    for (let i = 0; i < 60 && emissions.length < 2; i++) {
      G.time = i / 120;
      if (actor === 'player') { live.launchFromGun(0, 0, { pos: [0, 2.7, 0], dir: [0, 0, 1] }); loadStep({ G }, 1 / 120); }
      else live.aiMissiles(1 / 120);
    }
    assert.equal(emissions.length, 2, `${actor}/${mode}`);
    close(emissions[1].at - emissions[0].at, .25 / (mode === 'casual' ? 1.2 : 1), 'actual two-tube timestamps', 1 / 120);
    assert.equal(loadout.roundsLeft(g), before - 2);
    assert.equal(emissions[0].args[0], mdef.id);
    assert.equal(G.loadout.turrets[0].guns[0].def.launcher, data.vehicles.us_m901_itv.weapons.main_gun.launcher, 'source tube geometry');
  }
});

test('casual actual damage keeps loader, MG, independent Oplot and common repair gates', () => {
  const r = controls('su_t10m', 'casual');
  r.damage(data.vehicles.su_t10m.modules.find(m => m.kind === 'gun_breech').id);
  assert.equal(r.live.fireGun(0, 0), false);
  r.G.sightT = 1;
  assert.equal(r.live.fireGun(1, 0), true, 'independent Oplot can fire');
  const actor = {};
  r.live.apsOf(actor, r.G.aps, r.G.loadout, r.G.T.map(t => t.yaw), { pos: [0, 0, 0], heading: 0 }, r.G.bundle, r.G.cstate, r.G.caps);
  assert.equal(actor.aps_gun_ok, true);
  r.G.cstate.repair_s = 3;
  r.G.caps = r.combat.advance(r.G.combatKey, r.G.cstate, 0, 1).caps;
  r.live.apsOf(actor, r.G.aps, r.G.loadout, r.G.T.map(t => t.yaw), { pos: [0, 0, 0], heading: 0 }, r.G.bundle, r.G.cstate, r.G.caps);
  assert.equal(actor.aps_gun_ok, false);
  const manual = controls('su_t34_85', 'casual');
  manual.live.fireGun(0, 0); loadStep(manual, .1);
  const before = manual.G.T[0].loading.loaders[0].remaining;
  manual.G.cstate.repair_s = 3;
  manual.G.caps = manual.combat.advance(manual.G.combatKey, manual.G.cstate, 0, 1).caps;
  loadStep(manual, .5);
  assert.equal(manual.G.T[0].loading.loaders[0].remaining, before, 'repair does not accelerate or advance loader');
});

test('custom selection and imported workshop export roundtrip retain source performance through repeated mode changes', () => {
  const originalBuild = normalizeWorkshopBuild(loadout.PRESETS.hexa.build, data);
  const a = selectionRuntime('custom', 'casual', originalBuild), h = selectionRuntime('custom', 'historical', originalBuild);
  close(a.params.power / h.params.power, 1.25 * 1.15, 'custom runtime power');
  const exportOf = G => loadout.exportFolder(G.build, data, data.vehicles[G.build.base], 'my_tank', '自訂戰車');
  const out = exportOf(a);
  assert.deepEqual(out, exportOf(h));
  const imported = normalizeWorkshopBuild(JSON.parse(JSON.stringify({ build: a.build, files: out.files })).build, data);
  const c = selectionRuntime('custom', 'casual', imported);
  assert.deepEqual(exportOf(c), out, 'saved/exported source values roundtrip');
  for (const mode of ['historical', 'casual', 'historical', 'casual']) {
    c.gameplayMode = mode; c.selectAgain();
    close(c.params.power / h.params.power, mode === 'casual' ? 1.25 * 1.15 : 1, 'import/reselect factor');
    assert.deepEqual(c.sourceBundle.engine, h.sourceBundle.engine, 'original engine remains source-valued');
  }
});

test('actual displayed spec distinguishes original horsepower from the active effective stats', () => {
  const G = selectionRuntime('su_t34_85', 'casual');
  const element = () => ({ children: [], dataset: {}, style: {}, append(...children) { this.children.push(...children); }, textContent: '' });
  const document = { createElement: element, createTextNode: text => ({ textContent: text }) };
  const oldDocument = globalThis.document;
  globalThis.document = document;
  try {
    const el = Object.fromEntries(['kind', 'name', 'vehName', 'based', 'outline', 'spec'].map(key => [key, element()]));
    Hud.prototype.showSpec.call({ el }, G.loadout, G.params, (ti, gi) => loadout.reloadTime(G.loadout.turrets[ti], gi, 0, G.gameplayMode), G.gameplayMode, G.stockParams);
    const rows = new Map();
    for (let i = 0; i < el.spec.children.length; i += 2) rows.set(el.spec.children[i].textContent, el.spec.children[i + 1].textContent);
    assert.match(rows.get('玩法'), /休閒/);
    assert.ok(rows.get('原始性能').includes(`${G.stockParams.engine.horsepower} hp`));
    assert.ok(rows.get('動力').startsWith(`${G.params.engine.horsepower.toFixed(0)} hp`));
    assert.ok(rows.get('極速').startsWith(`${(G.params.vTop * 3.6).toFixed(0)} km/h`));
  } finally { globalThis.document = oldDocument; }
});
