import { OnlineAmmo } from '../src/game/onlineAmmo.js';
import { Sound } from '../src/game/audio.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadData } from '../tools/load-data.mjs';
import * as loadout from '../src/game/loadout.js';
import * as performanceApi from '../src/game/gameplayPerformance.js';
import * as phys from '../src/sim/physics.js';
import * as loading from '../src/sim/loading.js';
import * as gunnery from '../src/sim/gunnery.js';
import * as mgSim from '../src/sim/mg.js';
import { applyAmmo } from '../src/game/deploy.js';
import { VehicleSim } from '../src/game/vehicle.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { OnlineFires } from '../src/game/onlineFire.js';
import { GameplaySession } from '../src/game/gameplaySession.js';
import { ammoKeyIndex } from '../src/game/weaponselection.js';
import * as selection from '../src/game/weaponselection.js';
import * as inventory from '../src/game/ammoInventory.js';
import * as resupply from '../src/game/ammoResupply.js';
import { ground } from './tankrig.mjs';

const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const data = loadData();
function functionSource(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `live ${name} owner`);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}

// Execute live lifecycle owners. Loadout, loading, MG, geometry and vehicle physics are real;
// rendering, transport, damage and map presentation are boundary sinks, not browser emulation.
function runtime(id = 'su_bmpt34', cfg = {}) {
  const G = { id, mode: 'battle', gameplayMode: 'historical', mapId: 'range', map: null,
    maps: new Map(), thumbs: [], s: phys.newState(), pending: [], shots: [], bullets: [],
    cam: {}, aim: {}, guided: [], keys: new Set(), designs: new Map(), online: null, view: 'third' };
  const renderer = { mesh: vertices => ({ vertices }), instancedMesh: vertices => ({ vertices }), setInstances() {}, freeMesh() {} };
  const scene = { children: [], add(root) { this.children.push(root); } };
  const hud = new Proxy({}, { get: () => () => {} });
  const onlineFires = new OnlineFires(), onlineLaunches = new Map();
  const missileResets = [], apsAdds = [];
  G.missiles = { reset(terrain) { missileResets.push(terrain); }, removeAps() {},
    addAps(...args) { apsAdds.push(args); } };
  const gameplay = new GameplaySession({ get: () => JSON.stringify({ mode: 'historical', version: 1 }), set() {} });
  gameplay.beginBattle();
  let respawns = 0;
  const deps = { G, sound: new Sound(), data, ...selection, ...loadout, ...performanceApi, ...inventory, ...resupply, phys, loading, gunnery, mgSim, applyAmmo, AMMO_CFG: cfg,
    onlineFires, onlineLaunches, onlineAmmo:new OnlineAmmo(), renderer, scene, buildTank, VehicleSim, terrain: ground(() => 0), ME: 1,
    isDesign: () => false, store: { set() {} }, STORE_VEHICLE: 'unused', LANG_INDEX: 0,
    Exhaust: class {}, fx: {}, exhaustOf() {}, rebuildInterior() {}, applyXray() {}, combatInit() {},
    mods: { choose() {}, cardOf: id => id, slots: () => [] }, hud, reloadShown() {}, selectAmmo() {},
    sightGun: () => G.loadout.turrets[0].guns[0], statusShape() {}, measureInsets() {},
    document: { getElementById: () => ({}), pointerLockElement: null }, canvas: {}, net: { inRoom: false, send() {} }, lobby: { render() {} },
    cameraObstruction: { reset() {} }, vehicleActions: { reset() {} }, vehicleActionIndicator: { update() {} },
    clamp: (n, lo, hi) => Math.max(lo, Math.min(hi, n)), GARAGE: { x: 0, z: 0, heading: 0, camYaw: 0, camPitch: -.14 },
    spawnPoint: () => ({ x: 100, z: 100, heading: 0 }), surfaceAt: () => 0,
    toggleSight() { G.view = G.view === 'sight' ? 'third' : 'sight'; }, onlineRespawn() { respawns++; },
    missileTerrain: () => ({ size: 2000 }), syncApsControl() {}, enemyOwner: i => 100 + i,
    gameplay, updateGameplayDisplay() {}, setMode: mode => { G.mode = mode; }, useWorld: id => { G.mapId = id; },
    spawnEnemies() { G.enemies = []; }, clearEnemies() { G.enemies = []; },
    spawnRemotes() {}, updateNetHud() {}, deploy: { close() {} }, cqBar: {}, cqMsg: {}, hitcam: { hide() {} },
    testRange: { exit() {} }, GAMEPLAY_UPDATE_NEEDED: 'update needed',
  };
  const names = ['bundleFor', 'select', 'resetPose', 'resetVehicle', 'missileVehicle', 'missileBattleStart', 'startBattle', 'toGarage', 'goBattle'];
  const live = new Function(...Object.keys(deps), `${names.map(functionSource).join('\n')}\nreturn {${names.join(',')}};`)(...Object.values(deps));
  live.select(id);
  const keyStart = source.indexOf("  window.addEventListener('keydown', (e) => {");
  const keyEnd = source.indexOf('\n  });', keyStart);
  assert.ok(keyStart >= 0 && keyEnd > keyStart, 'actual keydown dispatcher');
  const triggers = [];
  const keyMapSource = source.match(/  const KEYMAP = .*;/)?.[0];
  assert.ok(keyMapSource, 'actual movement key map');
  const KEYMAP = new Function(`${keyMapSource}\nreturn KEYMAP;`)();
  const keyDeps = { ...deps, ...live, HTMLButtonElement: class {}, KEYMAP, ammoKeyIndex,
    sound: Object.assign(deps.sound, { start() {} }), lockSoon() {}, trigger: (...args) => triggers.push(args) };
  const keydown = new Function(...Object.keys(keyDeps), `let handler; const window = {addEventListener(type, fn) {handler = fn;}};\n${source.slice(keyStart, keyEnd + 6)}\nreturn handler;`)(...Object.values(keyDeps));
  const key = code => keydown({code, target: {tagName:'CANVAS'}, repeat:false, preventDefault() {}});
  return { G, live, key, triggers, missileResets, apsAdds, onlineFires, onlineLaunches, respawns: () => respawns };
}

function drainRockets(r) {
  const rails = r.G.loadout.turrets[0].guns.filter(g => g.def.missile);
  assert.equal(rails.length, 2);
  for (const g of rails) {
    const gi = r.G.loadout.turrets[0].guns.indexOf(g);
    assert.equal(loadout.fireLauncherRound(g, r.G.T[0].loading, gi), true);
    assert.equal(loadout.roundsLeft(g), 0);
    r.G.model.payload(0, gi, 0);
  }
  return rails;
}

test('actual Backspace range restart restores both depleted BMPT34 rails and their fresh loading/model state', () => {
  const r = runtime(), oldModel = r.G.model, oldLoadout = r.G.loadout;
  drainRockets(r);
  r.G.guided.push(123); r.onlineLaunches.set(123, {});
  r.G.view = 'sight'; r.G.sightT = 0; r.G.sightG = 3;
  r.G.s.x = 300;
  r.key('Backspace');
  const rails = r.G.loadout.turrets[0].guns.filter(g => g.def.missile);
  assert.deepEqual(rails.map(loadout.roundsLeft), [1, 1]);
  assert.notEqual(r.G.loadout, oldLoadout);
  assert.notEqual(r.G.model, oldModel);
  assert.deepEqual(rails.map(g => [g.loaded, g.launcher.ready, g.launcher.cooldown, g.launcher.nextTube]), [[0, 1, 0, 0], [0, 1, 0, 0]]);
  assert.deepEqual(r.G.T[0].loading.state, ['ready', 'ready', 'ready', 'ready']);
  assert.equal(r.G.view, 'third'); assert.equal(r.G.sightG, 0); assert.equal(r.G.s.x, 0);
  assert.equal(r.missileResets.length, 1);
  assert.equal(r.onlineLaunches.size, 0); assert.deepEqual(r.G.guided, []);
  // Payload is the actual scene geometry, not just HUD stock. Model must equal a new sortie.
  assert.deepEqual(r.G.model.root, runtime().G.model.root);
});

test('range restart retains saved short/zero ammunition choices and restores finite autocannon rounds', () => {
  const cfg = { su_bmpt34: { '0.0': [7, 0], '0.1': [0, 5], '0.2': [0], '0.3': [1] } };
  const r = runtime('su_bmpt34', cfg);
  for (const g of r.G.loadout.turrets[0].guns) { for (const a of g.ammo) a.count = 0; g.loaded = -1; g.belt = 0; }
  r.G.T[0].loading.state.fill('empty');
  r.live.resetVehicle();
  assert.deepEqual(r.G.loadout.turrets[0].guns.map(g => g.ammo.map(a => a.count)), [[7, 0], [0, 5], [0], [1]]);
  assert.equal(r.G.T[0].loading.state[2], 'empty');
  assert.equal(r.G.loadout.turrets[0].guns[2].launcher.ready, 0);
  assert.equal(r.G.loadout.turrets[0].guns[3].launcher.ready, 1);
  assert.equal(r.G.loadout.turrets[0].guns[0].belt, 7);
});

test('range reset rebuilds main gun and APS ammunition rather than retaining the depleted life', () => {
  const r = runtime('su_t10m'), pristine = runtime('su_t10m');
  for (const t of r.G.loadout.turrets) for (const g of t.guns) { for (const a of g.ammo) a.count = 0; g.loaded = -1; g.belt = 0; }
  for (const m of r.G.MG) { m.st.belt = 0; m.st.heat = 1; }
  r.G.apsState = { rounds: 0 }; r.G.apsOn = false;
  r.live.resetVehicle();
  assert.deepEqual(r.G.loadout, pristine.G.loadout);
  assert.deepEqual(r.G.MG, pristine.G.MG);
  assert.equal(r.G.apsOn, true); assert.equal(r.G.apsState, null);
  assert.equal(r.missileResets.length, 1);
  assert.deepEqual(r.apsAdds.at(-1), [1, 0, r.G.loadout.weapons.aps, 3]);
});

test('range reset restores real secondary MG belts and retains the active casual gameplay mode', () => {
  const r = runtime('su_t34_85');
  assert.ok(r.G.MG.length > 0, 'this fixture has actual secondary machine guns');
  const original = structuredClone(r.G.MG.map(m => m.st));
  for (const m of r.G.MG) { m.st.belt = 0; m.st.reload = 5; m.st.heat = 1; }
  r.G.gameplayMode = 'casual';
  r.live.resetVehicle();
  assert.deepEqual(r.G.MG.map(m => m.st), original);
  assert.equal(r.G.gameplayMode, 'casual');
  const historical = runtime('su_t34_85').G.params;
  assert.ok(r.G.params.power > historical.power);
});

test('actual Tab and Enter new sortie restore both BMPT34 rockets using the existing lifecycle', () => {
  const r = runtime(); drainRockets(r);
  r.key('Tab');
  assert.equal(r.G.mode, 'garage');
  r.key('Enter');
  assert.equal(r.G.mode, 'battle');
  assert.deepEqual(r.G.loadout.turrets[0].guns.filter(g => g.def.missile).map(loadout.roundsLeft), [1, 1]);
});

test('R remains the rocket trigger on a live BMPT34 and resets a vehicle without rockets', () => {
  const rocket = runtime(); drainRockets(rocket);
  rocket.key('KeyR');
  assert.deepEqual(rocket.triggers, [[false, true]], 'existing rocket action, even when empty');
  assert.equal(rocket.missileResets.length, 0);
  assert.deepEqual(rocket.G.loadout.turrets[0].guns.filter(g => g.def.missile).map(loadout.roundsLeft), [0, 0]);
  const tank = runtime('su_t34_85');
  const g = tank.G.loadout.turrets[0].guns[0], expected = g.ammo.map(a => a.count);
  for (const a of g.ammo) a.count = 0;
  tank.key('KeyR');
  assert.deepEqual(tank.G.loadout.turrets[0].guns[0].ammo.map(a => a.count), expected);
});

test('offline battlefield reset cannot refill rockets and garage reset stays inert', () => {
  for (const mode of ['battle', 'garage']) {
    const r = runtime(); drainRockets(r);
    const old = r.G.loadout;
    r.G.mode = mode; r.G.mapId = 'map'; r.G.map = { points: [] };
    r.live.resetVehicle();
    assert.equal(r.G.loadout, old);
    assert.deepEqual(old.turrets[0].guns.filter(g => g.def.missile).map(loadout.roundsLeft), [0, 0]);
    assert.equal(r.missileResets.length, 0);
  }
});

test('online range reset only requests authoritative respawn without refilling locally', () => {
  const r = runtime(); drainRockets(r);
  const old = r.G.loadout;
  r.G.online = { team: 'blue' };
  r.live.resetVehicle();
  assert.equal(r.respawns(), 1); assert.equal(r.G.loadout, old);
  assert.deepEqual(old.turrets[0].guns.filter(g => g.def.missile).map(loadout.roundsLeft), [0, 0]);
  assert.equal(r.missileResets.length, 0);
});
