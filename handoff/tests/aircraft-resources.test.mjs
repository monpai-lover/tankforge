import {mountedDetailsPrelude} from './fixture-model-upgrade.mjs';
import {fuelSourceParts} from './fixtures/aircraft-fuel-source-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const source = fs.readFileSync(new URL('handoff/bundle/app.js.html', root), 'utf8');
const resourceSource = fs.readFileSync(new URL('handoff/tools/aircraft_resources.js', root), 'utf8');
const hudSource = fs.readFileSync(new URL('handoff/tools/air_hud_inventory.js', root), 'utf8');
const data = { projectiles: {} };
for (const name of fs.readdirSync(new URL('data/projectiles/', root))) if (name.endsWith('.json')) {
  const p = JSON.parse(fs.readFileSync(new URL(`data/projectiles/${name}`, root), 'utf8')); data.projectiles[p.id] = p;
}
function section(a, b) {
  const start = source.indexOf(a), end = source.indexOf(b, start);
  assert.ok(start >= 0 && end > start, `actual production section missing: ${a}`);
  return source.slice(start, end);
}
const start = source.indexOf('  var AIR_FIGHTERS = {'), end = source.indexOf('\n  };', start) + 6;
assert.ok(start >= 0 && end > start);
const fuelSource = section('    const AIR_FUEL = {', '    // ---- engine start and stop');
const fuelParts = fuelSourceParts(source);
const engineSource = section('    const engineCue = ', '    function stepEngineStart(air)');
const podSource = section('    function syncPodGuns(air)', '    function stepAircraftGuns(dt)');
const weaponsSource = section('    function stepAirWeapons(dt)', '    /** Fire and smoke from a damaged aircraft');
assert.match(fuelSource, /aircraftStoreAvailable\(air, it\)/, 'test must execute patched actual fuel consumer');
assert.match(fuelSource, /aircraftUsableFuel\(air\)/, 'actual fuel-out must use complete usable stock');
assert.match(weaponsSource, /syncAircraftStoreLosses/, 'actual weapon step must own loss synchronization');
assert.match(podSource, /previous\.has\(it\)/, 'actual pod synchronization must preserve existing feeds');
assert.match(engineSource, /aircraftUsableFuel\(air\)/, 'actual engine restart must include available external fuel');
const fuelEvents = new Map(), fuelStorage = new Map();
const c = vm.createContext({ data, console, G4: { mode: 'battle', time: 12 }, sound: { full: null },
  document: { addEventListener: (name, handler) => fuelEvents.set(name, handler) },
  localStorage: { getItem: key => fuelStorage.get(key) ?? null, setItem: (key, value) => fuelStorage.set(key, value) },
  LANG: 'en', airGarage: { on: false }, deploy: { o: {}, visible: false },
  L10N: (zh, en) => zh, airVoice() {}, airReason() {}, configureAircraftSurfaces() {},
  stepAirSystems() {}, seekerTone() {}, stepEngineStart() {}, stepOrdnance() {}, stepJettison() {}, stepBots() {}, storeImpact() { return null; }
});
vm.runInContext(fuelParts.helper + '\n' + section('/* TF_GUIDED_AIRCRAFT_VARIANTS_BEGIN */','/* TF_GUIDED_AIRCRAFT_VARIANTS_END */') + mountedDetailsPrelude(source) + resourceSource + '\n' + hudSource + '\n' + source.slice(start, end) + '\nvar AIRCRAFT_TYPES=Object.fromEntries(Object.entries(AIR_FIGHTERS).map(([id,fighter])=>[id,{...fighter,id,fighter}]));\n' +
  section('    const AIR_STORE_DEFS = ', '    /**\n     * Each weapon\'s four separate states') +
  section('    const storeMassOf = ', '    // the release programs') +
  section('    function applyStoreLoad(air)', '    G4.airLoadout = ') +
  section('    function storeGroup(st)', '    function cycleStore(air)') +
  podSource + fuelSource + engineSource + weaponsSource +
  '\nglobalThis.api={aircraftStoreAvailable,aircraftUsableFuel,syncAircraftStoreLosses,stepAirFuel,fuelFlow,engineToggle,syncPodGuns,applyStoreLoad,stepAirWeapons,createAirHudInventory,defs:AIR_STORE_DEFS,fighters:AIR_FIGHTERS};', c);
const api = c.api;
const plain = x => JSON.parse(JSON.stringify(x));
function aircraft() {
  const dead = new Set(), gone = new Set(), configurations = [];
  const type = { id: 'f86f', ...api.fighters.f86f, sound: 'jet' };
  const plane = { type, cur: Array(60).fill(0), onGround: false, crashed: false, engineOff: false, engineStart: null,
    damage: { broken: false, dead: owner => dead.has(owner), gone: owner => gone.has(owner) },
    api: { configure_airframe(...values) { configurations.push(values); } },
    damageApplications: 0, applyDamage() { this.damageApplications++; } };
  plane.cur[27] = 0.6;
  return { active: true, plane, guns: [{ id: 'internal', ammo: 55, belt: ['hei_23_ofz'], owner: 'body' }],
    stores: { items: [], groups: [], sel: 0, cool: 0.4, burst: 0 },
    fuel: { type: 'f86f', kg: 100, max: 1300, told: 100, flow: 3, low: true, bingo: true },
    dead, gone, configurations };
}
const store = (id, extra = {}) => ({ id, def: api.defs[id], owner: 'body', count: 1, gone: false, p: [0, -0.2, 0], ...extra });
const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-8, `${why || 'quantity'}: ${a} != ${b}`);

// Quantity/presentation assertions exclude model callbacks and their diagnostic counters.
const resourceState = air => JSON.stringify({ fuel: air.fuel, items: air.stores.items, guns: air.guns, fuelOut: air.plane.fuelOut, damageRev: air.plane.damageRev, resourceRevision: air.resourceRevision });

test('store availability checks actual owner loss, detached state and explicit disconnection', () => {
  assert.equal(typeof fuelEvents.get('change'), 'function', 'Actual fuel controller owns delegated changes');
  assert.match(c.deploy.o.airFuelHtml('f86f'), /data-air-fuel="f86f"/, 'Actual complete controller renders source-backed fuel');
  const air = aircraft(), tank = store('tank120', { owner: 'wing_l' });
  assert.equal(api.aircraftStoreAvailable(air, tank), true);
  air.dead.add('wing_l'); assert.equal(api.aircraftStoreAvailable(air, tank), false);
  air.dead.clear(); air.gone.add('wing_l'); assert.equal(api.aircraftStoreAvailable(air, tank), false);
  air.gone.clear(); tank.connected = false; assert.equal(api.aircraftStoreAvailable(air, tank), false);
  tank.connected = true; tank.disconnected = true; assert.equal(api.aircraftStoreAvailable(air, tank), false);
  tank.disconnected = false; tank.gone = true; assert.equal(api.aircraftStoreAvailable(air, tank), false);
  assert.equal(api.aircraftStoreAvailable(air, null), false);
});

test('usable fuel is a pure current quantity including remaining live external tanks', () => {
  const air = aircraft(), first = store('tank120', { fuel: 20 });
  air.stores.items = [first, first, store('tank120'), store('tank120', { fuel: 90, gone: true }), store('tank120', { fuel: 80, connected: false }), store('tank120', { fuel: 70, owner: 'wing_r' })];
  air.dead.add('wing_r');
  const before = resourceState(air);
  assert.equal(api.aircraftUsableFuel(air), 100 + 20 + 363);
  assert.equal(resourceState(air), before);
  assert.equal(api.aircraftUsableFuel(null), 0);
});

test('actual stepAirFuel leaves engine-off/crashed/idle/damaged-engine quantities unchanged and clears stale flow', () => {
  for (const state of ['off', 'crashed', 'groundIdle', 'broken', 'engine', 'prop']) {
    const air = aircraft(), tank = store('tank120', { fuel: 25 }); air.stores.items = [tank];
    if (state === 'off') air.plane.engineOff = true;
    if (state === 'crashed') air.plane.crashed = true;
    if (state === 'groundIdle') { air.plane.onGround = true; air.plane.cur[27] = 0; }
    if (state === 'broken') air.plane.damage.broken = true;
    if (['engine', 'prop'].includes(state)) air.dead.add(state);
    api.stepAirFuel(air, 10);
    assert.equal(air.fuel.kg, 100, state); assert.equal(tank.fuel, 25, state); assert.equal(air.fuel.flow, 0, state);
    assert.equal(air.configurations.length, 0, state);
  }
});

test('actual fuel burn skips a lost owner tank and conserves live internal+external quantity', () => {
  const air = aircraft(), lost = store('tank120', { fuel: 80, owner: 'wing_l' }), live = store('tank120', { fuel: 20, owner: 'wing_r' });
  air.stores.items = [lost, live]; air.dead.add('wing_l');
  const before = api.aircraftUsableFuel(air), expectedBurn = api.fuelFlow(air.plane) * 2;
  api.stepAirFuel(air, 2);
  assert.equal(lost.fuel, 80); near(live.fuel, 20 - expectedBurn); assert.equal(air.fuel.kg, 100);
  near(api.aircraftUsableFuel(air), before - expectedBurn);
});

test('actual external-only fuel continues running instead of internal-zero fuelOut', () => {
  const air = aircraft(), tank = store('tank120', { fuel: 10 });
  air.fuel.kg = 0; air.fuel.told = 0; air.plane.fuelOut = true; air.stores.items = [tank];
  const burn = api.fuelFlow(air.plane);
  api.stepAirFuel(air, 1);
  assert.equal(air.fuel.kg, 0); near(tank.fuel, 10 - burn);
  assert.equal(air.plane.fuelOut, false); assert.equal(air.plane.damageApplications, 1);
  assert.ok(air.fuel.flow > 0);
});

test('actual engineToggle restarts on live external-only fuel and rejects empty or unavailable tanks', () => {
  const air = aircraft(), tank = store('tank120', { fuel: 10, owner: 'wing_l' });
  air.fuel.kg = 0; air.plane.engineOff = true; air.stores.items = [tank];
  api.engineToggle(air);
  assert.equal(air.plane.engineOff, false);
  assert.equal(air.plane.engineStart, 12);
  assert.equal(tank.fuel, 10, 'starter toggle must not invent or consume fuel');
  for (const unavailable of ['empty', 'gone', 'ownerLost', 'disconnected']) {
    const stopped = aircraft(), item = store('tank120', { fuel: 10, owner: 'wing_l' });
    stopped.fuel.kg = 0; stopped.plane.engineOff = true; stopped.stores.items = [item];
    if (unavailable === 'empty') item.fuel = 0;
    if (unavailable === 'gone') item.gone = true;
    if (unavailable === 'ownerLost') stopped.dead.add('wing_l');
    if (unavailable === 'disconnected') item.connected = false;
    api.engineToggle(stopped);
    assert.equal(stopped.plane.engineOff, true, unavailable);
    assert.equal(stopped.plane.engineStart, null, unavailable);
  }
});

test('actual burn transfers from external to internal and clamps all pools at exhaustion', () => {
  const air = aircraft(), tank = store('tank120', { fuel: 0.1 });
  air.fuel.kg = 3; air.fuel.told = 3; air.stores.items = [tank];
  const before = api.aircraftUsableFuel(air), burn = api.fuelFlow(air.plane) * 2;
  api.stepAirFuel(air, 2);
  assert.equal(tank.fuel, 0); near(air.fuel.kg, before - burn); near(api.aircraftUsableFuel(air), before - burn);
  api.stepAirFuel(air, 100);
  assert.equal(api.aircraftUsableFuel(air), 0); assert.equal(air.fuel.kg, 0); assert.equal(tank.fuel, 0); assert.equal(air.plane.fuelOut, true);
});

test('loss batch marks actual stores gone, cancels ripple/taps once and recomputes real mass', () => {
  const air = aircraft(), lost = store('tank120', { fuel: 80, owner: 'wing_l', p: [-2, -0.2, 0] }), live = store('tank120', { fuel: 20, owner: 'wing_r', p: [2, -0.2, 0] });
  air.stores.items = [lost, live]; air.storeHeld = air.storeTap = true; air.stores.burst = 4;
  air.ccrp = { p: [1, 2, 3] }; air.impact = { at: [1, 2, 3] }; air.resourceRevision = 7;
  api.applyStoreLoad(air); const beforeMass = air.configurations.at(-1)[0];
  air.dead.add('wing_l'); let massCalls = 0, podCalls = 0;
  const callbacks = { applyStoreLoad(a) { massCalls++; api.applyStoreLoad(a); }, syncPodGuns(a) { podCalls++; api.syncPodGuns(a); } };
  const result = api.syncAircraftStoreLosses(air, callbacks);
  assert.deepEqual(plain(result), { changed: true, lostCount: 1, resourceRevision: 8 });
  assert.equal(lost.gone, true); assert.equal(lost.count, 0); assert.equal(lost.fuel, 80);
  assert.equal(live.gone, false); assert.equal(live.fuel, 20);
  assert.equal(air.storeHeld, false); assert.equal(air.storeTap, false); assert.equal(air.stores.burst, 0);
  assert.equal(air.stores.cool, 0.4, 'loss must not shorten the surviving weapon cooldown');
  assert.equal(air.ccrp, null); assert.equal(air.impact, null);
  near(beforeMass - air.configurations.at(-1)[0], lost.def.mass + 80, 'actual configured airframe lost tank mass');
  assert.equal(api.syncAircraftStoreLosses(air, callbacks).changed, false);
  assert.equal(air.resourceRevision, 8); assert.equal(massCalls, 1); assert.equal(podCalls, 1);
});

test('actual syncPodGuns reuses live feed objects and cannot refill another pod on loss or repeated HUD-era sync', () => {
  const air = aircraft(), left = store('sppu22', { owner: 'wing_l', side: -1, pylonN: 2 }), right = store('sppu22', { owner: 'wing_r', side: 1, pylonN: 9 });
  air.stores.items = [left, right]; api.syncPodGuns(air);
  const surviving = air.guns.find(g => g.podItem === right), internal = air.guns.find(g => !g.podItem), originalArray = air.guns;
  surviving.ammo = 37; surviving.fired = 223; surviving.cool = 0.123;
  api.syncPodGuns(air); assert.equal(air.guns, originalArray, 'unchanged membership must keep the actual array');
  air.dead.add('wing_l'); api.syncAircraftStoreLosses(air, { applyStoreLoad: api.applyStoreLoad, syncPodGuns: api.syncPodGuns });
  assert.equal(air.guns.find(g => g.podItem === right), surviving);
  assert.equal(surviving.ammo, 37); assert.equal(surviving.fired, 223); assert.equal(surviving.cool, 0.123);
  assert.equal(air.guns.some(g => g.podItem === left), false); assert.equal(air.guns.find(g => !g.podItem), internal);
  const newPod = store('sppu22', { side: -1, pylonN: 3 }); air.stores.items.push(newPod); api.syncPodGuns(air);
  assert.equal(air.guns.find(g => g.podItem === right), surviving);
  assert.equal(air.guns.find(g => g.podItem === newPod).ammo, newPod.def.gun.rounds, 'only genuinely new feed receives source initial stock');
});

test('actual stepAirWeapons synchronizes owner loss before trying releases and burning fuel', () => {
  const air = aircraft(), tank = store('tank120', { fuel: 80, owner: 'wing_l' });
  air.stores.items = [tank]; air.dead.add('wing_l'); air.storeHeld = air.storeTap = true; air.stores.burst = 3;
  c.G4.air = air;
  const before = air.fuel.kg, burn = api.fuelFlow(air.plane) * 0.1;
  api.stepAirWeapons(0.1);
  assert.equal(tank.gone, true); assert.equal(tank.count, 0); assert.equal(tank.fuel, 80);
  assert.equal(air.resourceRevision, 1); assert.equal(air.storeHeld, false); assert.equal(air.storeTap, false);
  near(air.fuel.kg, before - burn); assert.ok(air.configurations.length > 0);
});

test('HUD observation cannot consume fuel, set fuelOut or change authoritative inventory/revisions', () => {
  const air = aircraft(); air.stores.items = [store('tank120', { fuel: 20 })];
  api.stepAirFuel(air, 0.1);
  const hud = api.createAirHudInventory({ projectiles: () => data.projectiles, storeDefs: () => api.defs });
  const before = resourceState(air), r = hud.report(air, 1, { lifeKey: 'test-life', resetKey: air.resourceRevision });
  near(r.fuel.usableKg, api.aircraftUsableFuel(air));
  assert.equal(resourceState(air), before);
  air.plane.engineOff = true; api.stepAirFuel(air, 1);
  const stopped = resourceState(air), report = hud.report(air, 1);
  assert.equal(report.fuel.state, 'engine_off'); assert.equal(resourceState(air), stopped);
});
