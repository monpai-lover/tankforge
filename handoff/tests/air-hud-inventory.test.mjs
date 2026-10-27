import {mountedDetailsPrelude} from './fixture-model-upgrade.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const source = fs.readFileSync(new URL('handoff/bundle/app.js.html', root), 'utf8');
const helper = fs.readFileSync(new URL('handoff/tools/air_hud_inventory.js', root), 'utf8');
const resources = fs.readFileSync(new URL('handoff/tools/aircraft_resources.js', root), 'utf8');
const data = { projectiles: {}, machineGuns: {} };
for (const name of fs.readdirSync(new URL('data/projectiles/', root))) if (name.endsWith('.json')) {
  const p = JSON.parse(fs.readFileSync(new URL(`data/projectiles/${name}`, root), 'utf8'));
  data.projectiles[p.id] = p;
}
for (const gun of JSON.parse(fs.readFileSync(new URL('data/machine_guns.json', root), 'utf8'))) data.machineGuns[gun.id] = gun;
const section = (a, b) => {
  const start = source.indexOf(a), end = source.indexOf(b, start);
  assert.ok(start >= 0 && end > start, `missing production source section ${a}`);
  return source.slice(start, end);
};
const fighterStart = source.indexOf('  var AIR_FIGHTERS = {');
const fighterEnd = source.indexOf('\n  };', fighterStart) + 6;
assert.ok(fighterStart >= 0 && fighterEnd > fighterStart);
const c = vm.createContext({ data, G4: { bulletShells: new Map() }, console });
vm.runInContext(mountedDetailsPrelude(source) + resources + '\n' + source.slice(fighterStart, fighterEnd) + '\nvar AIRCRAFT_TYPES = Object.fromEntries(Object.entries(AIR_FIGHTERS).map(([id,fighter])=>[id,{id,fighter}]));\n' +
  section('    const M61_DEF = ', '    /**\n     * Gunnery aim') +
  section('    function syncPodGuns(air)', '    function stepAircraftGuns(dt)') +
  section('    const AIR_STORE_DEFS = ', '    /**\n     * Each weapon\'s four separate states') +
  helper + '\nglobalThis.api={createAirHudInventory,aircraftGuns,syncPodGuns,defs:AIR_STORE_DEFS,types:AIRCRAFT_TYPES};', c);
const api = c.api;
const plain = x => JSON.parse(JSON.stringify(x));
function aircraft(type = 'mig15') {
  const dead = new Set();
  const plane = { type: api.types[type], cur: Array(60).fill(0), engineOff: false, engineStart: null, damage: { broken: false, dead: owner => dead.has(owner) } };
  return { plane, guns: api.aircraftGuns(type), stores: { items: [], groups: [], sel: 0 }, fuel: { type, kg: 1000, max: 1000, flow: 2 }, dead };
}
const create = options => api.createAirHudInventory({ projectiles: () => data.projectiles, storeDefs: () => api.defs, ...options });
const item = (id, extra = {}) => ({ id, def: api.defs[id], owner: 'body', gone: false, count: 1, ...extra });
function freeze(object, seen = new Set()) {
  if (!object || typeof object !== 'object' || seen.has(object)) return;
  seen.add(object); for (const value of Object.values(object)) freeze(value, seen); Object.freeze(object);
}

test('real MiG-15bis constructor gives independent 23/37 mm reservoirs without barrel multiplication', () => {
  const air = aircraft();
  assert.deepEqual(plain(air.guns.map(g => g.ammo)), [80, 80, 40]);
  freeze(air);
  const report = create().report(air, 1);
  assert.deepEqual(plain(report.guns.map(g => [g.scope, g.caliberMm, g.rounds, g.reservoirCount])), [['internal', 23, 160, 2], ['internal', 37, 40, 1]]);
  assert.equal(air.guns[0].ammo, 80, 'presentation must not mutate the actual accepted reservoir');
});

test('real F-104 M61 remains one configured 725-round rotary feed even with six muzzle ports', () => {
  const air = aircraft('f104g');
  assert.equal(air.guns[0].ammo, 725, 'production F-104G stock is 725; UI must not invent a 750-round stock');
  air.guns[0].mounts = Array.from({ length: 6 }, () => [0, 0, 0]);
  const r = create().report(air, 1);
  assert.equal(r.guns[0].caliberMm, 20);
  assert.equal(r.guns[0].rounds, air.guns[0].ammo);
  assert.equal(r.guns[0].reservoirCount, 1);
});

test('production SPPU-22 pod feed is counted once, separately from same-calibre internal guns', () => {
  const air = aircraft();
  const pod = item('sppu22', { p: [-2, 0, 0], pylonN: 2, side: -1 });
  air.stores.items = [pod]; api.syncPodGuns(air);
  const mounted = air.guns.find(g => g.podItem);
  assert.equal(mounted.ammo, 260);
  mounted.mounts = [[0, 0, 0], [0.1, 0, 0]];
  air.guns.push({ ...mounted }, mounted); // two render aliases plus the original object
  let r = create().report(air, 1);
  assert.equal(r.guns.find(g => g.scope === 'pod').rounds, 260);
  assert.equal(r.guns.find(g => g.scope === 'internal' && g.caliberMm === 23).rounds, 160);
  pod.gone = true;
  r = create().report(air, 1);
  assert.equal(r.guns.some(g => g.scope === 'pod'), false);
});

test('stale/replaced pod and lost wing stores contribute no usable ammo', () => {
  const air = aircraft();
  const old = item('sppu22', { p: [2, 0, 0], pylonN: 3, side: 1, owner: 'wing_r_out' });
  air.stores.items = [old]; api.syncPodGuns(air);
  air.dead.add('wing_r_out');
  assert.equal(create().report(air, 1).guns.some(g => g.scope === 'pod'), false);
  air.dead.clear(); air.stores = { items: [], groups: [], sel: 0 };
  assert.equal(create().report(air, 1).guns.some(g => g.scope === 'pod'), false);
});

test('selected counts use intact actual bomb/rocket/missile inventory and preserve empty selection', () => {
  const air = aircraft();
  const rocket = item('lau68', { count: 4 });
  air.stores = { groups: ['mk82', 'lau68', 'aim9b'], sel: 1, items: [item('mk82'), item('mk82', { gone: true }), rocket, rocket, item('lau68', { count: 7, owner: 'wing_l_out' }), item('aim9b'), item('aim9b', { count: 0 })] };
  air.dead.add('wing_l_out');
  const hud = create(); let r = hud.report(air, 1);
  assert.equal(r.stores.find(s => s.id === 'mk82').count, 1);
  assert.equal(r.selectedStore.weaponKind, 'rocket'); assert.equal(r.selectedStore.count, 4);
  assert.equal(r.selectedBombCount, 0);
  air.stores.sel = 0; r = hud.report(air, 1); assert.equal(r.selectedBombCount, 1);
  air.stores.items.find(s => s.id === 'mk82').gone = true;
  r = hud.report(air, 1); assert.equal(r.selectedStore.empty, true); assert.equal(r.selectedBombCount, 0);
  air.stores = { groups: [], items: [], sel: 0 }; assert.equal(hud.report(air, 1).selectedStore, null);
});

test('fuel estimate includes remaining connected external fuel, not tank capacity or fuel deltas', () => {
  const air = aircraft(), tank = item('tank120', { fuel: 100 });
  air.stores.items = [tank, tank, item('tank120', { fuel: 90, gone: true }), item('tank120', { fuel: 70, connected: false }), item('tank120', { fuel: 50, owner: 'wing_l' })];
  air.dead.add('wing_l');
  const hud = create(), r = hud.report(air, 1);
  assert.equal(r.fuel.internalKg, 1000); assert.equal(r.fuel.externalKg, 100);
  assert.equal(r.fuel.usableKg, 1100); assert.equal(r.fuel.maxKg, 1363);
  assert.equal(r.fuel.enduranceSeconds, 550); assert.equal(r.fuel.timeText, '09:10');
  // A transfer between reservoirs changes neither the current flow nor total usable fuel.
  air.fuel.kg += 20; tank.fuel -= 20;
  const transfer = hud.report(air, 1);
  assert.equal(transfer.fuel.resetReason, null); assert.equal(transfer.fuel.enduranceSeconds, 550);
});

test('throttle-flow changes are exponentially smoothed with elapsed report time', () => {
  const air = aircraft(), hud = create();
  assert.equal(hud.report(air, 1).fuel.enduranceSeconds, 500);
  air.fuel.flow = 6; air.fuel.kg = 996;
  const r = hud.report(air, 5);
  const average = 2 + (1 - Math.exp(-1)) * 4;
  assert.ok(Math.abs(r.fuel.smoothedFlowKgS - average) < 1e-10);
  assert.ok(Math.abs(r.fuel.enduranceSeconds - 996 / average) < 1e-8);
  assert.equal(r.fuel.resetReason, null);
});

test('engine off, starting, failure and zero/invalid flow never display stale or infinite endurance', () => {
  const air = aircraft(), hud = create(); hud.report(air, 1);
  air.plane.engineOff = true; let r = hud.report(air, 1);
  assert.equal(r.fuel.state, 'engine_off'); assert.equal(r.fuel.enduranceSeconds, null); assert.equal(r.fuel.timeText, '—');
  air.plane.engineOff = false; air.plane.engineStart = 0;
  assert.equal(hud.report(air, 1).fuel.state, 'starting');
  air.plane.engineStart = null; air.fuel.flow = 0;
  assert.equal(hud.report(air, 1).fuel.state, 'no_flow');
  air.fuel.flow = NaN; assert.equal(hud.report(air, 1).fuel.state, 'calculating');
  air.fuel.flow = Infinity; assert.equal(hud.report(air, -1).fuel.enduranceSeconds, null);
  air.dead.add('engine'); assert.equal(hud.report(air, 1).fuel.state, 'engine_unavailable');
  air.dead.clear(); air.plane.fuelOut = true; assert.equal(hud.report(air, 1).fuel.state, 'unusable');
  air.fuel.kg = 0; r = hud.report(air, 1); assert.equal(r.fuel.state, 'depleted'); assert.equal(r.fuel.enduranceSeconds, 0); assert.equal(r.fuel.timeText, '00:00');
});

test('refill/rearm/jettison/life boundaries reset only the estimator, without inventing fuel', () => {
  const air = aircraft(), hud = create(); hud.report(air, 1, { lifeKey: 'b1:a1' });
  air.fuel.flow = 6; hud.report(air, 5, { lifeKey: 'b1:a1' });
  air.fuel.kg += 100;
  let r = hud.report(air, 1, { lifeKey: 'b1:a1' });
  assert.equal(r.fuel.resetReason, 'refuel'); assert.equal(r.fuel.state, 'calculating'); assert.equal(r.fuel.smoothedFlowKgS, 6);
  r = hud.report(air, 1, { lifeKey: 'b1:a2' }); assert.equal(r.fuel.resetReason, 'life'); assert.equal(r.fuel.enduranceSeconds, null);
  air.stores = { ...air.stores, items: [item('tank120', { fuel: 100 })] };
  assert.equal(hud.report(air, 1, { lifeKey: 'b1:a2' }).fuel.resetReason, 'rearm');
  hud.report(air, 1, { lifeKey: 'b1:a2' });
  air.stores.items[0].gone = true;
  r = hud.report(air, 1, { lifeKey: 'b1:a2' }); assert.equal(r.fuel.resetReason, 'tank_change'); assert.equal(r.fuel.usableKg, air.fuel.kg);
  hud.report(air, 1, { lifeKey: 'b1:a2' }); air.guns[0].ammo += 1;
  assert.equal(hud.report(air, 1, { lifeKey: 'b1:a2' }).fuel.resetReason, 'rearm');
  air.fuel = null; assert.equal(hud.report(air, 1, { lifeKey: 'b1:a2' }).fuel.state, 'unavailable');
  air.fuel = { kg: 500, max: 1000, flow: 2 };
  assert.equal(hud.report(air, 1, { lifeKey: 'b1:a2' }).fuel.resetReason, 'rearm');
});

test('clock pause, backwards time and long gaps cannot create negative/infinite estimates', () => {
  const air = aircraft(), hud = create();
  assert.equal(hud.report(air, 0, { timeSeconds: 5 }).fuel.state, 'calculating');
  assert.equal(hud.report(air, 100, { timeSeconds: 5 }).fuel.state, 'calculating');
  assert.equal(hud.report(air, 0, { timeSeconds: 5.5 }).fuel.state, 'current');
  let r = hud.report(air, 1, { timeSeconds: 3 }); assert.equal(r.fuel.resetReason, 'clock'); assert.equal(r.fuel.enduranceSeconds, null);
  r = hud.report(air, 0, { timeSeconds: 30 }); assert.equal(r.fuel.resetReason, 'sample_gap'); assert.equal(r.fuel.enduranceSeconds, null);
  r = hud.report(air, 0, { timeSeconds: NaN }); assert.equal(r.fuel.resetReason, 'clock'); assert.equal(r.fuel.enduranceSeconds, null);
});

test('fresh aircraft objects never inherit another flight flow history; online and local reads match', () => {
  const hud = create(), local = aircraft(); hud.report(local, 1);
  local.fuel.flow = 6; hud.report(local, 5);
  const online = aircraft(); online.online = true; online.fuel.flow = 8;
  const before = JSON.stringify(online);
  const r = hud.report(online, 0.1);
  assert.equal(r.fuel.resetReason, 'aircraft'); assert.equal(r.fuel.state, 'calculating'); assert.equal(r.fuel.smoothedFlowKgS, 8);
  assert.equal(JSON.stringify(online), before);
  const localSame = aircraft(); localSame.fuel.flow = 8;
  assert.deepEqual(plain(create().report(localSame, 0.1).guns), plain(r.guns));
});

test('accepted non-fuel jettison/reset revision discards prior flow history without touching stores', () => {
  const air = aircraft(), hud = create();
  air.stores = { groups: ['mk82'], sel: 0, items: [item('mk82'), item('mk82')] };
  hud.report(air, 1, { resetKey: 0 });
  air.fuel.flow = 6; hud.report(air, 5, { resetKey: 0 });
  air.stores.items.forEach(it => { it.gone = true; });
  const before = JSON.stringify(air);
  const r = hud.report(air, 1, { resetKey: 1 });
  assert.equal(r.fuel.resetReason, 'resource_epoch');
  assert.equal(r.fuel.state, 'calculating');
  assert.equal(r.fuel.smoothedFlowKgS, 6);
  assert.equal(r.selectedBombCount, 0);
  assert.equal(JSON.stringify(air), before);
});
