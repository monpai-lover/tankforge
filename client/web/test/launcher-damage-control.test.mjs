import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as loadout from '../src/game/loadout.js';
import * as loading from '../src/sim/loading.js';
import * as gunnery from '../src/sim/gunnery.js';
import { loadData } from '../tools/load-data.mjs';
import { loadCoreSync } from '../src/design/core.js';
import * as combatApi from '../src/game/combat.js';
import * as damageApi from '../src/game/weaponDamage.js';
import * as ballistics from '../src/sim/ballistics.js';

const data = loadData();
const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const functionSource = name => {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
};
const make = () => loadout.makeLoadout('us_m901_itv', data.vehicles.us_m901_itv, data.projectiles, data.machineGuns);
function live(name, deps) {
  return new Function(...Object.keys(deps), `${functionSource(name)}\nreturn ${name};`)(...Object.values(deps));
}

test('live player launch rejects disabled apparatus without spending a tube or transport request', () => {
  for (const online of [false, true]) {
    const lo = make(), g = lo.turrets[0].guns[0], requests = [];
    const G = { loadout: lo, T: [{ loading: loading.newLoading(1, 1) }], caps: { can_fire: false }, online: online ? { seq: 0 } : null, missiles: { ready: true, launch: () => { requests.push('launch'); return 1; } }, guided: [], cam: { shake: 0 }, model: {} };
    const launch = live('launchFromGun', { G, data, ME: 1, rng: { nextF32: () => .5 }, ...loadout, ...combatApi, ...damageApi, net: { open: true, send: () => requests.push('send') }, onlineLaunches: { has: () => false, begin: () => true } });
    const before = loadout.roundsLeft(g);
    assert.equal(launch(0, 0, { pos: [0, 2.7, 0], dir: [0, 0, 1] }), false, online ? 'online request' : 'offline launch');
    assert.deepEqual(requests, []);
    assert.equal(loadout.roundsLeft(g), before);
    assert.equal(g.launcher.ready, 2);
    G.caps.can_fire = true;
    assert.equal(launch(0, 0, { pos: [0, 2.7, 0], dir: [0, 0, 1] }), true, 'repaired apparatus fires normally');
    assert.equal(requests.length, 1);
  }
});

test('live bot launch obeys combat capability and resumes after apparatus repair', () => {
  const lo = make(), g = lo.turrets[0].guns[0], requests = [];
  const e = { loadout: lo, alive: true, caps: { can_fire: false }, x: 0, z: 0, heading: 0, name: 'M901', mslT: 0, mslLoading: loading.newLoading(1, 1), gunPitch: [0], pose() {} };
  const G = { mode: 'battle', caps: { destroyed: false }, time: 10, enemies: [e], missiles: { ready: true, nodes: new Map(), launch: () => { requests.push('launch'); return 1; } } };
  const fire = live('aiMissiles', { G, data, DEG: Math.PI / 180, playerMiddle: () => [0, 2.7, 500], enemyOwner: () => 2, enemyYaws: e => [e.turretYaw || 0], enemyPose: () => ({ pos: [0, 0, 0], heading: 0 }), mountFor: () => ({ pivot: lo.turrets[0].pivot, trunnion: g.trunnion }), losHit: () => null, hud: { toast() {} }, loading, gunnery, ...loadout, ...combatApi, ...damageApi });
  const before = loadout.roundsLeft(g);
  fire(.01);
  assert.deepEqual(requests, [], 'disabled bot must not launch');
  assert.equal(loadout.roundsLeft(g), before);
  e.caps.can_fire = true;
  fire(.01);
  assert.equal(requests.length, 1);
  assert.equal(loadout.roundsLeft(g), before - 1);
});

test('live bot launcher elevation consumes its actual damaged own drive without scattering missiles', () => {
  const bundle = data.vehicles.su_bmpt34, lo = loadout.makeLoadout('su_bmpt34', bundle, data.projectiles, data.machineGuns), g = lo.turrets[0].guns[2], requests = [];
  const core = loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm', import.meta.url)), {materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains)});
  const combat = new combatApi.Combat(core, data.machineGuns), r = combat.fresh('ai:elevation', bundle);
  const index = bundle.modules.findIndex(m => m.kind === 'vertical_drive');
  assert.ok(index >= 0); r.state.modules[index] = 0;
  const caps = combat.advance('ai:elevation', r.state, 0, 1).caps;
  assert.equal(caps.weapons[g.damageKey].can_fire, true);
  const e = {loadout: lo, alive: true, caps, x: 0, z: 0, heading: 0, name: 'M901', mslT: 0, mslLoading: loading.newLoading(1, 1), gunPitch: [0], pose() {}};
  const G = {mode: 'battle', time: 10, enemies: [e], missiles: {ready: true, nodes: new Map(), launch: (...args) => {requests.push(args); return 1;}}};
  const fire = live('aiMissiles', {G, data, DEG: Math.PI / 180, playerMiddle: () => [0, 100, 500], enemyOwner: () => 2, enemyYaws: e => [e.turretYaw || 0], enemyPose: () => ({pos: [0, 0, 0], heading: 0}), mountFor: () => ({pivot: lo.turrets[0].pivot, trunnion: lo.turrets[0].guns[0].trunnion}), losHit: () => null, hud: {toast() {}}, loading, gunnery, ...loadout, ...combatApi, ...damageApi});
  const dt = 1 / 120; fire(dt);
  assert.equal(requests.length, 1);
  const pitch = Math.asin(requests[0][4][1]);
  assert.ok(pitch <= g.def.elevate_deg_s * caps.weapons[g.damageKey].elevate_mult * Math.PI / 180 * dt + 1e-8, 'actual launch direction follows damaged hand elevation');
  assert.equal(caps.weapons[g.damageKey].dispersion_mult, 1, 'missile dispersion keeps its own flight model');
});

test('actual BMPT damaged rocket rail preserves both cannons and the opposite rocket in live controls', () => {
  const bundle = data.vehicles.su_bmpt34, lo = loadout.makeLoadout('su_bmpt34', bundle, data.projectiles, data.machineGuns);
  const core = loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm', import.meta.url)), { materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains) });
  const combat = new combatApi.Combat(core), state = combat.fresh('su_bmpt34', bundle).state;
  state.modules[bundle.modules.findIndex(m => m.id === 'launcher_tt250_rail_r')] = 0;
  const caps = combat.advance('su_bmpt34', state, 0, 1).caps;
  assert.equal(caps.can_fire, true, 'a failed rocket apparatus must not disable the intact 25 mm cannons');
  const G = { id: 'su_bmpt34', loadout: lo, caps, cstate: state, T: lo.turrets.map(t => ({ yaw: 0, bearing: true, yawErr: 0, guns: t.guns.map(() => ({ pitch: 0, pitchErr: 0, smoke: 0 })), loading: loading.newLoading(t.guns.length, 1, t.guns.map(() => true)) })), pending: [], sightM: -1, sightT: 0, ss: {}, shots: [], missiles: { ready: true, launch: () => 1 }, guided: [], cam: { shake: 0 }, model: {} };
  const deps = { G, data, ME: 1, ...loadout, ...combatApi, ...damageApi, loading, gunnery, ballistics, mountOf: (t, g) => ({ pivot: t.pivot, trunnion: g.trunnion, muzzleOffset: g.muzzleOffset, muzzleVector: g.muzzleVector }), pose: () => ({ pos: [0, 0, 0], heading: 0 }), hullTilt: () => 0, rng: { nextF32: () => .5 }, surfaceAt: () => 0, impactColor: () => [1, 1, 1], fx: { autocannonBlast() {} }, sound: { mg() {} } };
  const live = new Function(...Object.keys(deps), `${functionSource('trigger')}\n${functionSource('launchFromGun')}\n${functionSource('fireGun')}\nreturn {trigger, fireGun};`)(...Object.values(deps));
  live.trigger(false, false);
  assert.deepEqual(G.pending.map(p => p.gi), [0, 1], 'both conventional cannons remain queued');
  const cannonCount = lo.turrets[0].guns[0].ammo[0].count;
  assert.equal(live.fireGun(0, 0), true);
  assert.equal(lo.turrets[0].guns[0].ammo[0].count, cannonCount - 1);
  assert.equal(G.shots.length, 1);
  G.pending.length = 0;
  live.trigger(false, true);
  assert.deepEqual(G.pending.map(p => p.gi), [3], 'rocket key skips the disabled right rail and selects the intact left rail');
  assert.equal(live.fireGun(0, 2), false, 'the disabled right rail cannot fire');
  assert.equal(loadout.roundsLeft(lo.turrets[0].guns[2]), 1);
  assert.equal(live.fireGun(0, 3), true, 'the intact left rail still fires');
  assert.equal(loadout.roundsLeft(lo.turrets[0].guns[3]), 0);
});

test('queued then disabled own launcher cannot consume ammo while its healthy cannons keep aggregate fire available', () => {
  const vehicle = 'su_bmpt34', bundle = data.vehicles[vehicle], lo = loadout.makeLoadout(vehicle, bundle, data.projectiles, data.machineGuns), requests = [];
  const core = loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm', import.meta.url)), {materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains)});
  const combat = new combatApi.Combat(core, data.machineGuns), r = combat.fresh('pending:m901', bundle);
  const G = {id: vehicle, loadout: lo, caps: r.caps, cstate: r.state, T: [{yaw: 0, bearing: true, yawErr: 0, guns: lo.turrets[0].guns.map(() => ({pitch: 0, pitchErr: 0})), loading: loading.newLoading(lo.gunCount, 1)}], sightM: -1, sightT: 0, pending: [], ss: {}, missiles: {ready: true, launch: () => {requests.push('launch'); return 1;}}, guided: [], cam: {shake: 0}, model: {}};
  const deps = {G, data, ME: 1, ...loadout, ...combatApi, ...damageApi, loading, gunnery, ballistics, mountOf: (t, g) => ({pivot: t.pivot, trunnion: g.trunnion, muzzleOffset: g.muzzleOffset}), pose: () => ({pos: [0, 0, 0], heading: 0}), hullTilt: () => 0, rng: {nextF32: () => .5}};
  const app = new Function(...Object.keys(deps), `${functionSource('trigger')}\n${functionSource('launchFromGun')}\n${functionSource('fireGun')}\nreturn {trigger, fireGun};`)(...Object.values(deps));
  app.trigger(false, true); assert.equal(G.pending.length, 1);
  const gi = G.pending[0].gi;
  G.cstate.modules[bundle.modules.findIndex(m => m.kind === 'launcher')] = 0;
  G.caps = combat.advance('pending:m901', G.cstate, 0, 1).caps;
  assert.equal(G.caps.can_fire, true, 'healthy cannons remain available');
  const before = loadout.roundsLeft(lo.turrets[0].guns[gi]);
  assert.equal(app.fireGun(0, gi), false);
  assert.equal(loadout.roundsLeft(lo.turrets[0].guns[gi]), before);
  assert.deepEqual(requests, []);
});

test('two actual workshop M901 launcher instances preserve the intact assembly after apparatus damage', () => {
  const out = loadout.exportFolder({ base: 'de_hetzer', keepStock: false, turrets: [{ ...loadout.newTurretSpec(), guns: [{ weapon: 'us_m901_itv' }, { weapon: 'us_m901_itv' }] }] }, data, data.vehicles.de_hetzer, 'two_launchers', 'two launchers');
  const bundle = Object.fromEntries(['vehicle', 'weapons', 'armor', 'modules', 'crew', 'engine', 'visual'].map(k => [k, out.files[k + '.json']]));
  const lo = loadout.makeLoadout('two_launchers', bundle, data.projectiles, data.machineGuns);
  const core = loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm', import.meta.url)), { materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains) });
  const combat = new combatApi.Combat(core), state = combat.fresh('two_launchers', bundle).state;
  const guns = lo.turrets[0].guns;
  const apparatus = bundle.modules.filter(m => m.kind === 'launcher');
  state.modules[bundle.modules.findIndex(m => m.id === 'launcher_t1_0')] = 0;
  assert.deepEqual(guns.map(g => combatApi.launcherCanFire(lo, bundle.modules, state, g)), [false, true]);
  const caps = combat.advance('two_launchers', state, 0, 1).caps;
  assert.equal(caps.can_fire, true, 'one intact launcher assembly must keep the vehicle able to launch');
  assert.notEqual(apparatus[0].weapon_group, apparatus[1].weapon_group, 'same source weapon IDs are distinct mounted assemblies');
  const G = { id: 'two_launchers', loadout: lo, caps, cstate: state, T: [{ loading: loading.newLoading(2, 1, [true, true]) }], missiles: { ready: true, launch: () => 1 }, guided: [], cam: { shake: 0 }, model: {} };
  const launch = live('launchFromGun', { G, data: { ...data, vehicles: { ...data.vehicles, two_launchers: bundle } }, ME: 1, rng: { nextF32: () => .5 }, ...loadout, ...combatApi, ...damageApi });
  const before = guns.map(g => loadout.roundsLeft(g));
  const muzzle = { pos: [0, 2, 0], dir: [0, 0, 1] };
  assert.equal(launch(0, 0, muzzle), false);
  assert.equal(launch(0, 1, muzzle), true, 'live launch uses the intact second assembly');
  assert.deepEqual(guns.map(g => loadout.roundsLeft(g)), [before[0], before[1] - 1]);
  state.modules[bundle.modules.findIndex(m => m.id === 'launcher_t1_1')] = 0;
  assert.ok(Object.entries(combat.advance('two_launchers', state, 0, 1).caps.weapons).filter(([key]) => key.startsWith('gun:')).every(([, c]) => !c.can_fire), 'both launcher assemblies disabled; the healthy secondary MG is independent');
});

test('each critical M901 apparatus part disables its complete assembly, including legacy ungrouped data', () => {
  for (const legacy of [false, true]) for (const part of ['launcher', 'tubes']) {
    const bundle = structuredClone(data.vehicles.us_m901_itv);
    if (legacy) for (const m of bundle.modules) delete m.weapon_group;
    const lo = loadout.makeLoadout('us_m901_itv', bundle, data.projectiles, data.machineGuns);
    const core = loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm', import.meta.url)), { materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains) });
    const combat = new combatApi.Combat(core), state = combat.fresh('us_m901_itv', bundle).state;
    state.modules[bundle.modules.findIndex(m => m.id === part)] = 0;
    assert.equal(combat.advance('us_m901_itv', state, 0, 1).caps.weapons['gun:0:0'].can_fire, false, `${part} is critical (legacy=${legacy})`);
    assert.equal(combatApi.launcherCanFire(lo, bundle.modules, state, lo.turrets[0].guns[0]), false);
  }
});
