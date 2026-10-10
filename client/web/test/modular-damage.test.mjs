import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadData } from '../tools/load-data.mjs';
import { loadCoreSync } from '../src/design/core.js';
import { Combat, targetDef, EVENT_NAME, CREW_NAME } from '../src/game/combat.js';
import * as loadout from '../src/game/loadout.js';
import * as loading from '../src/sim/loading.js';
import * as mgSim from '../src/sim/mg.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { buildInterior, MODULE_LABEL } from '../src/gfx/interior.js';
import { decodeAllImported } from '../src/gfx/imported.js';
import { Enemy, useCombat } from '../src/game/enemies.js';
import { VehicleSim } from '../src/game/vehicle.js';
import { Terrain } from '../src/game/terrain.js';
import { humpLift } from '../src/game/world.js';
import * as phys from '../src/sim/physics.js';

const data = loadData();
await decodeAllImported(data.vehicles);
const core = loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm', import.meta.url)), {materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains)});
const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const helper = await import('../src/game/weaponDamage.js').catch(() => null);
const functionSource = name => {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `live ${name} entry is required`);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
};
const live = (names, deps) => new Function(...Object.keys(deps), `${names.map(functionSource).join('\n')}\nreturn {${names.join(',')}};`)(...Object.values(deps));
const combat = () => new Combat(core, data.machineGuns);
const workshop = build => {
  const out = loadout.exportFolder(build, data, data.vehicles[build.base], 'custom', 'custom', {includeModel: false});
  return Object.fromEntries(['vehicle', 'weapons', 'armor', 'modules', 'crew', 'engine', 'visual'].map(k => [k, out.files[k + '.json']]));
};

test('target descriptions retain combined crew duties and send only measured damage inputs', () => {
  const b = data.vehicles.su_t34_1940, def = targetDef('crew', b, 0, Object.values(data.machineGuns));
  assert.deepEqual(def.crew.find(c => c.role === 'commander').also, ['gunner']);
  assert.equal(def.weapons, b.weapons);
  assert.ok(Array.isArray(def.machine_guns));
  assert.deepEqual(Object.keys(def.visual).sort(), ['mg_anchors', 'mg_variants']);
  assert.ok(!('parts' in def.visual) && !('model' in def));
});

test('actual T34 1940 loses its combined commander/gunner until a real seat swap completes', () => {
  const c = combat(), b = data.vehicles.su_t34_1940, r = c.fresh('t34:crew', b);
  r.state.crew[b.crew.findIndex(x => x.role === 'commander')] = 0;
  const hit = c.advance('t34:crew', r.state, 0, 1);
  assert.equal(hit.caps.gunner, false);
  assert.equal(hit.caps.can_fire, false);
  assert.equal(hit.caps.weapons['gun:0:0'].can_fire, false);
  assert.ok(hit.state.swaps.some(s => s.role === 'gunner'));
  const pending = c.advance('t34:crew', hit.state, 1, 2);
  assert.equal(pending.caps.gunner, false);
  const recovered = c.advance('t34:crew', pending.state, 30, 3);
  assert.equal(recovered.caps.gunner, true);
  assert.equal(recovered.caps.weapons['gun:0:0'].can_fire, true);
  assert.ok(recovered.state.roles.includes('gunner'));
});

test('all42 live bundles prepare normalized MG anatomy once and preserve original module indices', () => {
  const c = combat();
  assert.equal(typeof c.prepare, 'function');
  assert.equal(Object.keys(data.vehicles).length, 42);
  for (const [id, b] of Object.entries(data.vehicles)) {
    const before = JSON.stringify(b), n = c.prepare(id, b), r = c.fresh(id, n);
    assert.equal(n.modules.length, r.state.modules.length, id);
    assert.deepEqual(n.modules.slice(0, b.modules.length).map(m => m.id), b.modules.map(m => m.id), id);
    assert.equal(n.modules.filter(m => m.kind === 'machine_gun').length, (b.weapons.secondary || []).length * 2, id);
    assert.deepEqual(c.describe(id).binding_errors, {}, id);
    const lo = loadout.makeLoadout(id, n, data.projectiles, data.machineGuns);
    for (const [ti, t] of lo.turrets.entries()) for (const [gi, g] of t.guns.entries()) {
      assert.equal(g.damageKey, `gun:${ti}:${gi}`);
      assert.equal(r.caps.weapons[g.damageKey].can_fire, true, `${id}/${g.damageKey}`);
      const L = loading.newLoading(t.guns.length, t.loaders.length, t.guns.map(g => !g.rack));
      loading.fired(L, gi);
      const original = loadout.reloadTime(t, gi, 0) * (g.rack && t.loaders.length === 0 ? 1.6 : 1);
      loading.tick(L, .00001, (gun, loader) => loadout.reloadTime(t, gun, loader), gun => helper.weaponReloadRate(r.caps, t.guns[gun].damageKey));
      assert.ok(Math.abs(loading.progress(L, gi).total - original) < 1e-8, `${id}/${g.damageKey} healthy cycle preserved`);
    }
    for (const m of lo.machineGuns) {
      assert.equal(m.damageKey, 'mg:' + m.id);
      assert.equal(r.caps.weapons[m.damageKey].can_fire, true, `${id}/${m.damageKey}`);
    }
    assert.equal(JSON.stringify(b), before, id + ' original source unchanged');
  }
});

test('registration caches normalized bundles, supports same-id new sources and fold without duplicate MGs', () => {
  let registrations = 0;
  const c = new Combat({combatTarget(def) {registrations++; return core.combatTarget(def);}, combatNew: id => core.combatNew(id)}, data.machineGuns);
  assert.equal(typeof c.prepare, 'function');
  const b = data.vehicles.de_hetzer, n = c.prepare('updated', b), count = n.modules.length;
  assert.equal(c.prepare('updated', b), n);
  assert.equal(c.prepare('updated', n), n);
  c.fresh('updated', n); c.fresh('updated', b);
  assert.equal(registrations, 1);
  c.setFold('updated', .75); c.fresh('updated', n);
  assert.equal(registrations, 2);
  assert.equal(c.describe('updated').modules.length, count);
  const changed = structuredClone(b); changed.weapons.secondary = [];
  const next = c.prepare('updated', changed);
  assert.notEqual(next, n);
  assert.equal(next.modules.length, b.modules.length);
  assert.equal(registrations, 3);
  assert.equal(c.fresh('updated', next).state.modules.length, next.modules.length);
  assert.equal(registrations, 3);
});

test('live imported MG catalog additions, replacements and missing definitions refresh same actor registration', () => {
  const catalog = {...data.machineGuns}, c = new Combat(core, catalog), original = data.vehicles.de_pz3_j;
  const first = c.prepare('catalog:update', original);
  const added = structuredClone(catalog.mg34); added.id = 'imported_measured_mg';
  catalog[added.id] = added;
  const bundle = structuredClone(original); bundle.weapons.secondary[0].weapon = added.id;
  const second = c.prepare('catalog:update', bundle);
  assert.deepEqual(second.binding_errors, {});
  assert.equal(c.fresh('catalog:update', second).caps.weapons['mg:' + bundle.weapons.secondary[0].id].can_fire, true);
  const replacement = structuredClone(added); replacement.damage_geometry.barrel.center[2] += .03;
  catalog[added.id] = replacement;
  const third = c.prepare('catalog:update', bundle);
  assert.notEqual(third, second, 'same bundle with a replaced current catalog definition must refresh');
  const barrel = n => n.modules.find(m => m.id === 'mg:' + bundle.weapons.secondary[0].id + ':barrel');
  assert.notEqual(barrel(third).center.z, barrel(second).center.z);
  assert.equal(third.modules.length, second.modules.length);
  delete catalog[added.id];
  const missing = c.prepare('catalog:update', bundle);
  assert.ok(missing.binding_errors['mg:' + bundle.weapons.secondary[0].id]);
  assert.equal(c.fresh('catalog:update', missing).caps.weapons['mg:' + bundle.weapons.secondary[0].id].can_fire, false);
  assert.equal(first.modules.length, original.modules.length + original.weapons.secondary.length * 2);
});

test('actual workshop and stripped legacy bundles retain per-instance damage with duplicate launcher picks', () => {
  assert.equal(typeof combat().prepare, 'function');
  const builds = [loadout.PRESETS.porcupine.build,
    {base: 'de_hetzer', keepStock: false, turrets: [{...loadout.newTurretSpec(), guns: [{weapon: 'us_m901_itv'}, {weapon: 'us_m901_itv'}]}]},
    {base: 'su_t10m', keepStock: true, turrets: [{...loadout.newTurretSpec(), guns: [{weapon: 'us_m901_itv'}]}]}];
  for (const build of builds) for (const legacy of [false, true]) {
    const b = workshop(build);
    if (legacy) {
      for (const m of b.modules) {delete m.weapon_group; delete m.turret_index;}
      for (const m of [b.weapons, ...(b.weapons.extra_guns || []), ...(b.weapons.extra_turrets || []).flatMap(t => t.guns)]) {delete m.damage; delete m.weapon_group; delete m.gun?.damage; delete m.gun?.weapon_group;}
    }
    const c = combat(), key = 'custom:' + build.base + ':' + legacy, n = c.prepare(key, b), r = c.fresh(key, n);
    assert.deepEqual(c.describe(key).binding_errors, {}, key);
    assert.ok(Object.values(r.caps.weapons).every(w => w.can_fire), key);
    const launchers = n.modules.map((m, i) => [m, i]).filter(([m]) => m.kind === 'launcher');
    if (launchers.length === 2 && build.base === 'de_hetzer') {
      r.state.modules[launchers[0][1]] = 0;
      const caps = c.advance(key, r.state, 0, 1).caps;
      assert.equal(caps.weapons['gun:0:0'].can_fire, false);
      assert.equal(caps.weapons['gun:0:1'].can_fire, true);
    }
  }
});

test('weaponDamage fails closed only for unknown new-core keys and preserves legacy/null flow', () => {
  assert.ok(helper, 'per-instance damage helper is required');
  const w = helper.weaponDamage;
  assert.equal(w(null, 'gun:0:0').can_fire, true);
  assert.equal(w({can_fire: false, reload_mult: 1.6}, 'gun:0:0').can_fire, false);
  assert.equal(w({can_fire: true}, 'gun:0:0').dispersion_mult, 1);
  assert.equal(w({can_fire: true, weapons: {}}, 'unknown').can_fire, false);
  const own = {can_fire: true, dispersion_mult: 2, reload_mult: 1.4, traverse_mult: .7, elevate_mult: .4};
  assert.equal(w({can_fire: false, weapons: {'gun:1:0': own}}, 'gun:1:0'), own);
});

test('binding late core retains authoritative damage and caps, filling only appended module defaults', () => {
  const c = combat(), b = data.vehicles.de_pz3_j;
  assert.equal(typeof c.bind, 'function');
  const state = {modules: b.modules.map(m => m.max_health), crew: [100, 0, 100, 100, 100], roles: b.crew.map(c => c.role), repair_s: 7, swaps: [], rack_fill: []};
  state.modules[0] = 13;
  const caps = {can_fire: false, repair_s: 7};
  const bound = c.bind('late:existing', b, state, caps);
  assert.equal(bound.state.modules[0], 13);
  assert.deepEqual(bound.state.crew, state.crew);
  assert.equal(bound.state.repair_s, 7);
  assert.equal(bound.caps, caps, 'existing server capability has authority');
  assert.equal(bound.state.modules.length, bound.bundle.modules.length);
  assert.ok(bound.state.modules.slice(b.modules.length).every(h => h === 40));
  const a = c.bind('actor:a', b), d = c.bind('actor:b', b);
  a.state.modules[0] = 0;
  assert.notEqual(a.state.modules[0], d.state.modules[0], 'duplicate spec choices have independent states');
  c.setFold('actor:a', .8);
  c.fresh('actor:a', a.bundle);
  assert.equal(c.appliedFold.get('actor:b'), 0, 'fold pose belongs to the actor');
});

test('live core-ready binding includes current player, AI, remote and range without rebuilding battle models or ammo', () => {
  const b = data.vehicles.de_pz3_j, lo = loadout.makeLoadout('de_pz3_j', b, data.projectiles, data.machineGuns);
  const renderer = {mesh: vertices => ({vertices}), instancedMesh: vertices => ({vertices}), setInstances() {}, freeMesh() {}};
  const model = buildTank(renderer, lo, loadout.generatedTurretParts);
  const oldInterior = buildInterior(renderer, model, lo, b.modules, b.crew);
  const enemies = ['ai', 'remote', 'range'].map(kind => ({id: 'de_pz3_j', sourceBundle: b, bundle: b, loadout: loadout.makeLoadout('de_pz3_j', b, data.projectiles, data.machineGuns), model: buildTank(renderer, lo, loadout.generatedTurretParts), combatKey: kind + ':1:de_pz3_j', remote: kind === 'remote', rangeTarget: kind === 'range', fold: .3}));
  const caps = {can_fire: false, repair_s: 3}, existing = combat().fresh('auth', b).state;
  existing.modules[0] = 8;
  const G = {id: 'de_pz3_j', sourceBundle: b, bundle: b, combatKey: 'player:de_pz3_j', loadout: lo, model, interior: oldInterior, enemies, combat: combat(), mode: 'battle', cstate: existing, caps, fold: {pose: .6}, T: [], MG: [], veh: {pose: 'kept'}, s: {x: 123, z: 456, heading: .4}, sightM: 1, sightT: 0, sightG: 0};
  lo.turrets[0].guns[0].ammo[0].count = 9;
  const saved = {model: G.model, veh: G.veh, pose: G.s, ammo: lo.turrets[0].guns[0].ammo, caps: G.caps, models: enemies.map(e => e.model)};
  const deps = {G, renderer, buildInterior, useCombat, moduleDamageLabels: helper.moduleDamageLabels, statusShape: () => ({normalized: true}), syncRacks() {}, applyXray() {}, Exhaust: class {}, exhaustOf: () => ({})};
  const app = live(['bindCombatReady', 'rebuildInterior', 'combatInit'], deps);
  app.bindCombatReady();
  assert.equal(G.model, saved.model); assert.equal(G.veh, saved.veh); assert.equal(G.s, saved.pose);
  assert.equal(G.loadout.turrets[0].guns[0].ammo, saved.ammo);
  assert.equal(G.loadout.turrets[0].guns[0].ammo[0].count, 9);
  assert.equal(G.sightM, 1); assert.equal(G.caps, saved.caps); assert.equal(G.cstate.modules[0], 8);
  assert.equal(G.interior.byModule.size > oldInterior.byModule.size, true, 'current interior rebuilt with normalized MGs');
  assert.deepEqual(enemies.map(e => e.model), saved.models);
  assert.ok(enemies.every(e => e.combat && e.cstate && e.bundle.modules.some(m => m.kind === 'machine_gun')));
  assert.equal(G.combat.appliedFold.get(G.combatKey), .6);
  assert.ok(enemies.every(e => G.combat.appliedFold.get(e.combatKey) === .3));
});

test('live select registers before actual stock/workshop models, interior and status, including same-id replacement', () => {
  const c = combat(), terrain = new Terrain(data.terrains, humpLift);
  const renderer = {mesh: vertices => ({vertices}), instancedMesh: vertices => ({vertices}), setInstances() {}, freeMesh() {}, freeTexture() {}};
  const G = {mode: 'battle', combat: c, model: null, s: phys.newState(), veh: {}, cam: {yaw: 0}, pending: [], designs: new Map()};
  const scene = {children: [], add(n) {this.children.push(n);}}, order = [];
  const deps = {G, data, renderer, terrain, scene, VehicleSim, phys, loading, mgSim, ...loadout, ...helper,
    buildTank(r, lo, parts) { assert.ok(c.describe(G.combatKey), 'registration exists before real model construction'); order.push('model'); return buildTank(r, lo, parts); },
    buildInterior(...args) {order.push('interior'); return buildInterior(...args);},
    isDesign: () => false, store: {set() {}}, STORE_VEHICLE: 'vehicle', LANG_INDEX: 0, AMMO_CFG: {}, applyAmmo() {}, Exhaust: class {}, fx: {}, exhaustOf: () => ({}), applyXray() {}, syncRacks() {},
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    mods: {choose() {}, cardOf: id => id, slots: () => []}, hud: new Proxy({}, {get: () => () => {}}),
    reloadShown() {}, sightGun: () => G.loadout.turrets[0].guns[0], selectAmmo() {}, missileVehicle() {},
    document: {getElementById: () => ({})}, measureInsets() {}, net: {}, lobby: {render() {}},
    v3x: v => Array.isArray(v) ? v[0] : v.x, v3z: v => Array.isArray(v) ? v[2] : v.z};
  const app = live(['bundleFor', 'select', 'rebuildInterior', 'statusShape', 'combatInit'], deps);
  app.select('xp_bmp_k64', true);
  assert.ok(G.loadout.imported, 'real GLB-backed stock fixture remains loaded');
  assert.equal(G.loadout.imported, data.vehicles.xp_bmp_k64.imported);
  app.select('de_hetzer', true);
  assert.equal(G.bundle.imported, data.vehicles.de_hetzer.imported, 'stock source representation remains unchanged');
  assert.deepEqual(order.slice(0, 2), ['model', 'interior']);
  assert.equal(G.cstate.modules.length, G.bundle.modules.length);
  assert.ok(G.bundle.modules.filter(m => m.kind === 'machine_gun').every(m => G.interior.byModule.has(m.id)));
  G.build = {base: 'su_t10m', keepStock: true, turrets: [{...loadout.newTurretSpec(), guns: [{weapon: 'us_m901_itv'}]}]};
  app.select('custom', true);
  assert.ok(G.caps.weapons['gun:1:0'].can_fire, 'retained Oplot gun');
  assert.ok(G.caps.weapons['gun:2:0'].can_fire, 'added source launcher');
  const old = G.bundle;
  G.build = {base: 'de_hetzer', keepStock: false, turrets: [{...loadout.newTurretSpec(), guns: [{weapon: 'us_m901_itv'}, {weapon: 'us_m901_itv'}]}]};
  app.select('custom', true);
  assert.notEqual(G.bundle, old);
  assert.equal(c.describe('player:custom'), G.bundle);
  assert.deepEqual(Object.keys(G.caps.weapons), ['gun:0:0', 'gun:0:1']);
  assert.equal(G.cstate.modules.length, G.bundle.modules.length);
  assert.equal((G.loadout.imported?.parts || G.loadout.visual.parts).some(p => p.mount === 'gun'), false, 'replacement head preserves the stock hull without the removed old gun');
  assert.ok(G.statusShape.modules.every(m => G.modIndex.has(m.id)));
});

test('live driver input passes actual engine/transmission output without lowering throttle intent or permitting dead pivot', () => {
  const c = combat(), b = c.prepare('drive:caps', data.vehicles.de_pz3_j), fresh = c.fresh('drive:caps', b);
  for (const kind of ['engine', 'transmission']) {
    const i = b.modules.findIndex(m => m.kind === kind);
    fresh.state.modules[i] = b.modules[i].max_health * .25;
  }
  const G = {mode: 'battle', caps: c.advance('drive:caps', fresh.state, 0, 0).caps};
  const start = source.indexOf("    const caps = G.mode === 'battle' ? G.caps : null;"), end = source.indexOf("    if (G.veh) G.veh.t.broken", start);
  const inputGate = new Function('G', 'input', source.slice(start, end));
  const input = {throttle: 1, steer: 1, brake: 0}; inputGate(G, input);
  assert.equal(input.throttle, 1); assert.equal(input.steer, 1);
  assert.equal(input.drive_power, G.caps.drive_power); assert.ok(input.drive_power < G.caps.engine_power);
  fresh.state.modules[b.modules.findIndex(m => m.kind === 'transmission')] = 0;
  G.caps = c.advance('drive:caps', fresh.state, 0, 1).caps;
  inputGate(G, input);
  assert.equal(input.throttle, 0); assert.equal(input.steer, 0); assert.equal(input.drive_power, 0);
  G.caps = {can_move: true, driver: true, engine_power: .8};
  inputGate(G, input); assert.equal(input.drive_power, .8, 'legacy engine fallback');
});

test('compiled bureau designs keep their existing null-caps battle boundary', () => {
  const G = {mode: 'battle', bundle: {design: {}, modules: []}, combat: combat(), cstate: null, caps: null};
  live(['combatInit'], {G}).combatInit();
  assert.equal(G.cstate, null); assert.equal(G.caps, null);
});

test('per-gun reload rates react during loading and carry remaining real time into shared queues', () => {
  const L = loading.newLoading(2, 1), rates = [.5, 1];
  loading.fired(L, 0); loading.fired(L, 1);
  loading.tick(L, 2, () => 4, gi => rates[gi]);
  assert.equal(loading.progress(L, 0).remaining, 3);
  rates[0] = 1;
  assert.deepEqual(loading.tick(L, 4, () => 4, gi => rates[gi]), [0]);
  assert.equal(loading.progress(L, 1).remaining, 3, 'only one real second remains for the next gun');
  rates[1] = 0;
  loading.tick(L, 10, () => 4, gi => rates[gi]);
  assert.equal(loading.progress(L, 1).remaining, 3, 'repairing pauses current reload');
  const hud = loading.progress(L, 1, 2);
  assert.equal(hud.remaining, 6, 'HUD shows actual current damaged reload seconds');
  assert.equal(hud.total, 8, 'progress fraction remains unchanged');
});

test('actual lost loader and recovered roles apply missing-loader penalty once, retaining feed damage', () => {
  const c = combat(), b = c.prepare('loader:roles', data.vehicles.su_t34_1940), fresh = c.fresh('loader:roles', b);
  fresh.state.crew[b.crew.findIndex(c => c.role === 'loader')] = 0;
  fresh.state.modules[b.modules.findIndex(m => m.kind === 'ammo_rack')] = b.modules.find(m => m.kind === 'ammo_rack').max_health * .25;
  const lost = c.advance('loader:roles', fresh.state, 0, 1);
  assert.equal(lost.caps.loader, false);
  const mult = lost.caps.weapons['gun:0:0'].reload_mult;
  assert.ok(mult > 1.6, 'actual rack feeding and loader losses both present');
  assert.ok(Math.abs(helper.weaponReloadRate(lost.caps, 'gun:0:0', true) - 1.6 / mult) < 1e-8, 'manual queue base 1.6 already accounts for fallback loader');
  assert.equal(helper.weaponReloadRate(lost.caps, 'gun:0:0', false), 1 / mult, 'independent weapon still uses its own source cycle');
  const manual = loading.newLoading(1, 0), independent = loading.newLoading(1, 0, [true]);
  loading.fired(manual, 0); loading.fired(independent, 0);
  loading.tick(manual, 1, () => 10, () => helper.weaponReloadRate(lost.caps, 'gun:0:0', true));
  loading.tick(independent, 1, () => 10, () => helper.weaponReloadRate(lost.caps, 'gun:0:0', false));
  assert.equal(loading.progress(manual, 0).total, 16);
  assert.equal(loading.progress(independent, 0).total, 10);
  const recovered = c.advance('loader:roles', lost.state, 30, 3);
  assert.equal(recovered.caps.loader, true);
  assert.equal(helper.weaponReloadRate(recovered.caps, 'gun:0:0', true), helper.weaponReloadRate(recovered.caps, 'gun:0:0', false));
});

test('live damage status reports the affected weapon by name, damaged at half health and healthy after repair', () => {
  const c = combat(), b = c.prepare('status:own', data.vehicles.de_pz3_j), r = c.fresh('status:own', b);
  assert.equal(typeof helper?.moduleDamageLabels, 'function');
  const lo = loadout.makeLoadout('de_pz3_j', b, data.projectiles, data.machineGuns);
  const G = {bundle: b, loadout: lo, cstate: r.state, caps: r.caps, statusShape: {modules: [], crew: []}, modIndex: new Map(b.modules.map((m, i) => [m.id, i])), damageLabels: helper.moduleDamageLabels(lo, b.modules)};
  const view = live(['damageView'], {G, CREW_NAME: {}}).damageView;
  const barrel = b.modules.findIndex(m => m.kind === 'machine_gun' && m.id.endsWith(':barrel'));
  G.cstate.modules[barrel] = 20;
  G.caps = c.advance('status:own', G.cstate, 0, 1).caps;
  assert.ok(view().items.some(x => x.kind === 'warn' && x.text.includes(lo.machineGuns[0].def.name) && x.text.includes('受損')));
  G.cstate.modules[barrel] = 0;
  assert.ok(view().items.some(x => x.kind === 'bad' && x.text.includes(lo.machineGuns[0].def.name) && x.text.includes('損毀')));
  G.cstate.modules[barrel] = 40;
  assert.ok(!view().items.some(x => x.text.includes(lo.machineGuns[0].def.name)), 'repaired weapon clears its warning');
});

test('actual live field repair names its recovered weapon and marks the normalized module for status feedback', () => {
  const c = combat(), b = c.prepare('repair:own', data.vehicles.de_pz3_j), fresh = c.fresh('repair:own', b);
  const lo = loadout.makeLoadout('de_pz3_j', b, data.projectiles, data.machineGuns), labels = helper.moduleDamageLabels(lo, b.modules);
  const i = b.modules.findIndex(m => m.kind === 'machine_gun');
  fresh.state.modules[i] = 0;
  const hit = c.advance('repair:own', fresh.state, 0, 1), toasts = [];
  const G = {bundle: b, mode: 'battle', combat: c, combatKey: 'repair:own', cstate: hit.state, caps: hit.caps, s: {u: 0}, damageLabels: labels, enemies: [], time: 10, combatAcc: 0};
  const app = live(['repairVehicle', 'advanceCombat'], {G, net: {send() {}}, hud: {toast: text => toasts.push(text)}, rng: {nextF32: () => .5}, syncRacks() {}, EVENT_NAME, CREW_NAME});
  app.repairVehicle();
  assert.ok(G.caps.repair_s > 0);
  app.advanceCombat(30);
  assert.ok(toasts.some(t => t.includes('修理完成') && t.includes(lo.machineGuns[0].def.name)));
  assert.ok(G.repairedModules.has(b.modules[i].id));
  assert.ok(G.repairedUntil > G.time);
  assert.ok(G.cstate.modules[i] > b.modules[i].max_health * .5);
});

test('MG feed damage slows belt reload without altering cyclic rate, heat or cooling time', () => {
  const def = data.machineGuns.mg34, damaged = mgSim.newMg(def), healthy = mgSim.newMg(def);
  damaged.reload = healthy.reload = 4;
  damaged.heat = healthy.heat = .8;
  mgSim.stepMg(def, damaged, false, 1, .5);
  mgSim.stepMg(def, healthy, false, 1, 1);
  assert.equal(damaged.reload, 3.5);
  assert.equal(healthy.reload, 3);
  assert.equal(damaged.heat, healthy.heat);
  damaged.reload = healthy.reload = 0;
  assert.equal(mgSim.stepMg(def, damaged, true, .1, .5), mgSim.stepMg(def, healthy, true, .1, 1));
});

test('normalized MG anatomy has labels, correct parent nodes, and disposable interiors preserve source meshes', async () => {
  await decodeAllImported({de_hetzer: data.vehicles.de_hetzer});
  assert.equal(typeof combat().prepare, 'function');
  for (const id of ['de_hetzer', 'de_pz3_j', 'su_is2']) {
    const b = combat().prepare('interior:' + id, data.vehicles[id]), lo = loadout.makeLoadout(id, b, data.projectiles, data.machineGuns);
    const renderer = {mesh: vertices => ({vertices}), instancedMesh: vertices => ({vertices}), setInstances() {}, freeMesh() {}, freeTexture() {}};
    const model = buildTank(renderer, lo, loadout.generatedTurretParts), before = model.root.children.slice();
    const interior = buildInterior(renderer, model, lo, b.modules, b.crew);
    for (const m of b.modules.filter(m => m.kind === 'machine_gun')) {
      const nodes = interior.byModule.get(m.id);
      assert.ok(nodes?.length, id + '/' + m.id);
      const parent = m.turret_index == null ? model.body : model.turrets[m.turret_index].node;
      assert.ok(nodes.every(n => parent.children.includes(n)), m.id + ' metadata parent');
      assert.ok(interior.labels.some(l => nodes.includes(l.node) && l.text.includes(MODULE_LABEL.machine_gun)));
    }
    assert.equal(interior.labels.filter(l => l.text === MODULE_LABEL.gun_breech).length, lo.gunCount, 'no invented MG breeches');
    interior.dispose();
    assert.deepEqual(model.root.children, before);
    for (const n of interior.nodes) assert.ok(!model.body.children.includes(n) && model.turrets.every(t => !t.node.children.includes(n)), 'disposed nodes detach');
    model.dispose();
  }
});

test('normalized Oplot gun/radar anatomy has its own turret, names and damage status while primary-drive labels stay independent', () => {
  const c = combat(), b = c.prepare('oplot:status', data.vehicles.su_t10m), r = c.fresh('oplot:status', b);
  const lo = loadout.makeLoadout('su_t10m', b, data.projectiles, data.machineGuns);
  const renderer = {mesh: vertices => ({vertices}), instancedMesh: vertices => ({vertices}), setInstances() {}, freeMesh() {}, freeTexture() {}};
  const model = buildTank(renderer, lo, loadout.generatedTurretParts), interior = buildInterior(renderer, model, lo, b.modules, b.crew);
  const labels = helper.moduleDamageLabels(lo, b.modules);
  for (const id of [lo.weapons.aps.gun_module, lo.weapons.aps.radar_module]) {
    const nodes = interior.byModule.get(id);
    assert.ok(nodes?.length, id + ' requires normalized status anatomy');
    assert.ok(nodes.every(n => model.turrets[lo.weapons.aps.turret].node.children.includes(n)));
    assert.ok(interior.labels.some(l => nodes.includes(l.node) && l.text.includes(lo.weapons.aps.name)));
    assert.ok(labels.get(id).includes(lo.weapons.aps.name));
  }
  assert.ok(!labels.get(b.modules.find(m => m.kind === 'turret_drive').id).includes(lo.turrets[1].guns[0].def.id), 'primary drive damage must not label the independent APS gun as affected');
  const G = {bundle: b, loadout: lo, cstate: r.state, caps: r.caps, statusShape: {modules: [], crew: []}, modIndex: new Map(b.modules.map((m, i) => [m.id, i])), damageLabels: labels};
  G.cstate.modules[b.modules.findIndex(m => m.id === lo.weapons.aps.gun_module)] = 0;
  G.caps = c.advance('oplot:status', G.cstate, 0, 1).caps;
  const view = live(['damageView'], {G, CREW_NAME}).damageView();
  assert.ok(view.items.some(i => i.kind === 'bad' && i.text.includes(lo.weapons.aps.name)));
  assert.equal(G.caps.weapons['gun:0:0'].can_fire, true);
  assert.equal(interior.labels.filter(l => l.text === MODULE_LABEL.gun_breech).length, 1, 'no invented APS cannon breech');
  interior.dispose(); model.dispose();
});
