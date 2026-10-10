import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadData } from '../tools/load-data.mjs';
import { makeLoadout, generatedTurretParts, exportFolder, newTurretSpec, fireLauncherRound, tickLauncher, refillLauncher } from '../src/game/loadout.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { buildInterior, MODULE_LABEL } from '../src/gfx/interior.js';
import { decodeAllImported } from '../src/gfx/imported.js';
import { STRIDE } from '../src/gfx/geo.js';
import { newLoading } from '../src/sim/loading.js';
import { loadCoreSync } from '../src/design/core.js';
import { Combat } from '../src/game/combat.js';

const data = loadData();
const ids = ['us_m901_itv', 'xp_bmp_k64_atgm', 'xp_bmp_k64_kornet', 'su_bmpt34'];
await decodeAllImported(Object.fromEntries(['xp_bmp_k64', ...ids].map(id => [id, data.vehicles[id]])));
const renderer = { mesh: vertices => ({ vertices }), instancedMesh: vertices => ({ vertices }), setInstances() {}, freeMesh() {} };
function interiorOf(id, bundle = data.vehicles[id]) {
  const lo = makeLoadout(id, bundle, data.projectiles, data.machineGuns);
  const model = buildTank(renderer, lo, generatedTurretParts);
  const interior = buildInterior(renderer, model, lo, bundle.modules, bundle.crew);
  return { lo, model, interior };
}

test('actual launcher fleet draws cannon breeches only for its conventional guns', () => {
  const found = Object.entries(data.vehicles).filter(([, b]) => [b.weapons.main_gun, ...(b.weapons.extra_guns || []).map(g => g.gun), ...(b.weapons.extra_turrets || []).flatMap(t => t.guns.map(g => g.gun))].some(g => g.missile)).map(([id]) => id).sort();
  assert.deepEqual(found, [...ids].sort(), 'new launcher types must join the anatomy coverage');
  for (const id of ids) {
    const { lo, model, interior } = interiorOf(id);
    const cannons = lo.turrets.flatMap(t => t.guns).filter(g => !g.def.missile && g.def.caliber_mm >= 20);
    assert.equal(interior.labels.filter(l => l.text === MODULE_LABEL.gun_breech).length, cannons.length, id);
    assert.equal(interior.labels.filter(l => l.text === MODULE_LABEL.launcher).length, id === 'su_bmpt34' ? 2 : 1, id);
    for (const n of interior.nodes) assert.ok([...n.mesh.vertices].every(Number.isFinite), id + ' finite interior mesh');
    model.dispose(); interior.dispose();
  }
});

test('guided launcher damage parts are apparatus, while mixed BMPT retains its cannon modules', () => {
  for (const id of ids.slice(0, 3)) {
    const mods = data.vehicles[id].modules;
    assert.ok(mods.some(m => m.kind === 'launcher'), id);
    assert.ok(!mods.some(m => ['gun_breech', 'gun_barrel'].includes(m.kind)), id);
    assert.ok(mods.some(m => m.kind === 'ammo_rack'), id + ' live ammunition storage remains');
  }
  const bmpt = data.vehicles.su_bmpt34.modules;
  assert.equal(bmpt.filter(m => m.kind === 'gun_breech').length, 2);
  assert.equal(bmpt.filter(m => m.kind === 'gun_barrel').length, 2);
  assert.equal(bmpt.filter(m => m.kind === 'launcher').length, 2);
});

test('mixed BMPT rocket ammunition modules point to their actual loaded rocket bodies', () => {
  const { model, interior } = interiorOf('su_bmpt34');
  for (const id of ['ammo_turret_03', 'ammo_turret_04']) {
    const nodes = interior.byModule.get(id);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].launcherRound?.gun.def.missile, 'tt250_rocket', id + ' must not be a rack of 25 mm cannon rounds');
  }
  model.dispose(); interior.dispose();
});

test('missile bodies consume independently loaded tubes and refill from real reserves', () => {
  const { lo, model, interior } = interiorOf(ids[0]);
  assert.equal(typeof interior.updateLaunchers, 'function');
  const g = lo.turrets[0].guns[0], L = newLoading(1, 1);
  for (const n of interior.nodes) n.visible = true;
  const bodies = interior.nodes.filter(n => n.launcherRound);
  assert.equal(bodies.length, 2);
  model.root.update();
  const labels = interior.labels.filter(l => l.text === '飛彈彈體');
  assert.ok(Math.hypot(...[12, 13, 14].map(k => labels[0].node.world[k] - labels[1].node.world[k])) > .1, 'each projectile label follows its own measured tube');
  interior.updateLaunchers();
  assert.deepEqual(bodies.map(n => n.visible), [true, true]);
  assert.equal(fireLauncherRound(g, L, 0), true);
  interior.updateLaunchers();
  assert.deepEqual(bodies.map(n => n.visible), [false, true]);
  tickLauncher(g, .25); fireLauncherRound(g, L, 0); interior.updateLaunchers();
  assert.deepEqual(bodies.map(n => n.visible), [false, false]);
  const rounds = g.ammo[0].count;
  refillLauncher(g); g.loaded = 0; interior.updateLaunchers();
  assert.deepEqual(bodies.map(n => n.visible), [true, true]);
  assert.equal(g.ammo[0].count, rounds, 'drawing cannot spend or invent ammunition');
  for (const n of bodies) {
    const v = n.mesh.vertices;
    let min = Infinity, max = -Infinity;
    for (let i = 2; i < v.length; i += STRIDE) { min = Math.min(min, v[i]); max = Math.max(max, v[i]); }
    assert.ok(max - min <= g.def.barrel_length_mm / 1000 + .01, 'body fits source launch tube length');
  }
  model.dispose(); interior.dispose();
});

test('workshop exported source launchers keep apparatus and mixed real cannon anatomy', () => {
  const t = { ...newTurretSpec(), guns: [{ weapon: 'us_m901_itv' }, { weapon: 'de_tiger_e' }] };
  const out = exportFolder({ base: 'de_hetzer', keepStock: false, turrets: [t] }, data, data.vehicles.de_hetzer, 'mixed_launcher_test', 'mixed');
  const mods = out.files['modules.json'];
  assert.equal(mods.filter(m => m.kind === 'launcher').length, 1);
  assert.equal(mods.filter(m => m.kind === 'gun_breech').length, 1);
  assert.equal(mods.filter(m => m.kind === 'gun_barrel').length, 1);
  const stock = exportFolder({ base: 'us_m901_itv', keepStock: false, turrets: [{ ...newTurretSpec(), guns: [{ cal: 75, len: 48 }] }] }, data, data.vehicles.us_m901_itv, 'replaced_launcher', 'replacement');
  assert.equal(stock.files['modules.json'].filter(m => m.kind === 'launcher').length, 0, 'removed stock launcher parts do not survive replacement');
});

test('rebuilt WASM resolves actual launcher impacts and repairs using apparatus semantics', () => {
  const core = loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm', import.meta.url)), { materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains) });
  const combat = new Combat(core);
  for (const id of ids) {
    const bundle = data.vehicles[id], fresh = combat.fresh(id, bundle);
    assert.equal(fresh.caps.can_fire, true, id);
    const mi = bundle.modules.findIndex(m => m.kind === 'launcher');
    const m = bundle.modules[mi];
    const shot = combat.shoot(id, fresh.state, { shell: data.projectiles.apcbc_88_l56, origin: [40, m.center.y, m.center.z], dir: [-1, 0, 0], speed_ms: 800, distance_m: 0, seed: 1, turret_yaw: 0 });
    assert.ok(shot.modules.some(h => h.kind === 'launcher'), id + ' impacts hit actual apparatus');
    const state = structuredClone(fresh.state);
    state.modules[mi] = 0;
    assert.equal(combat.advance(id, state, 0, 1).caps.can_fire, id === 'su_bmpt34', id + ' disabled apparatus preserves only separate cannons');
    assert.equal(combat.advance(id, state, 0, 1).caps.ammo_detonated, false, id + ' damage does not invent detonation');
    const repair = combat.repair(id, state);
    assert.equal(repair.ok, true, id);
    const repaired = combat.advance(id, repair.state, repair.caps.repair_s + 1, 1);
    assert.equal(repaired.caps.can_fire, true, id + ' repair restores firing');
  }
});
