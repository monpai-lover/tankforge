import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/load-data.mjs';
import { buildToBundle, makeLoadout, newTurretSpec, generatedTurretParts, exportFolder, reloadTime, fireLauncherRound, tickLauncher, refillLauncher, nextAmmo, PRESETS } from '../src/game/loadout.js';
import * as loading from '../src/sim/loading.js';
import { muzzleLocal } from '../src/sim/gunnery.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { transformPoint } from '../src/gfx/math.js';
import { STRIDE } from '../src/gfx/geo.js';
import { decodeAllImported, decodeImported } from '../src/gfx/imported.js';

const data = loadData();
await decodeAllImported(data.vehicles);
const catalog = await import('../src/game/workshopCatalog.js').catch(() => ({}));
const turret = (weapon, overrides = {}) => ({ ...newTurretSpec(), ...overrides, guns: [{ cal: 75, len: 48, weapon }] });
const compile = (weapon, overrides = {}) => buildToBundle({ base: 'de_hetzer', keepStock: false, turrets: [turret(weapon, overrides)] }, data);
const runtime = compiled => makeLoadout('workshop_test', compiled.bundle, { ...data.projectiles, ...compiled.projectiles }, data.machineGuns);

test('workshop catalogs expose existing weapon and sight source IDs and practical presets', () => {
  assert.equal(typeof catalog.workshopWeapons, 'function');
  assert.equal(typeof catalog.workshopSights, 'function');
  assert.equal(typeof catalog.workshopPresets, 'function');
  const weapons = catalog.workshopWeapons(data), sights = catalog.workshopSights(data), presets = catalog.workshopPresets(data);
  for (const id of ['xp_kda35', 'us_m901_itv', 'xp_bmp_k64', 'xp_bmp_k64_atgm', 'de_hetzer_sdkfz1401']) {
    const descriptor = weapons.find(w => w.id === id);
    assert.equal(descriptor.sourceVehicle, id);
    assert.deepEqual(descriptor.gun, data.vehicles[id].weapons.main_gun);
    assert.ok(descriptor.label && descriptor.category);
    assert.deepEqual(sights.find(s => s.id === id).sight, data.vehicles[id].weapons.sight);
  }
  assert.ok(presets.some(p => p.build.base === 'de_hetzer' && p.build.turrets.some(t => t.guns.some(g => g.weapon === 'de_hetzer_sdkfz1401'))));
  assert.ok(presets.some(p => p.build.turrets.some(t => t.guns.some(g => g.weapon === 'xp_bmp_k64_atgm'))));
  assert.ok(presets.some(p => p.build.turrets.some(t => t.guns.some(g => g.weapon === 'xp_kda35'))));
  assert.ok(Object.keys(PRESETS).every(id => presets.some(p => p.id === id)), 'legacy creative presets remain available');
});

test('workshop 35 mm source gun keeps five real rounds, counts, recoil and automatic cycle', () => {
  const source = structuredClone(data.vehicles.xp_kda35.weapons.main_gun);
  const compiled = compile('xp_kda35'), t = runtime(compiled).turrets[0], g = t.guns[0];
  assert.equal(g.def.id, source.id);
  assert.deepEqual(g.def.ammo, source.ammo);
  assert.deepEqual(g.ammo.map(a => a.count), source.ammo_count);
  assert.deepEqual(g.def.autocannon, source.autocannon);
  assert.equal(g.def.recoil_mm, source.recoil_mm);
  assert.equal(g.def.traverse_deg_s, source.traverse_deg_s, 'source gun drive specification remains intact');
  assert.equal(compiled.layouts[0].traverse_deg_s, t.traverse, 'workshop summary and active turret use the same source drive');
  assert.deepEqual(compiled.layouts[0].guns[0].shells.map(s => s.id), source.ammo);
  assert.deepEqual(Object.keys(compiled.projectiles), source.ammo);
  assert.deepEqual(compiled.layouts[0].guns[0].shell, data.projectiles[source.ammo[0]]);
  assert.equal(reloadTime(t, 0, 0), 60 / 550);
  g.belt = 0;
  assert.equal(reloadTime(t, 0, 0), source.autocannon.belt_reload_s);
  assert.deepEqual(data.vehicles.xp_kda35.weapons.main_gun, source, 'compilation cannot change stock source definitions');
  const out = exportFolder({ base: 'de_hetzer', keepStock: false, turrets: [turret('xp_kda35')] }, data, data.vehicles.de_hetzer, 'export_35', '35 mm');
  assert.deepEqual(Object.keys(out.projectiles), source.ammo, 'export includes every ammunition definition');
});

test('workshop twin launchers retain tube vectors and reload only after the second missile', () => {
  for (const id of ['us_m901_itv', 'xp_bmp_k64_atgm', 'xp_bmp_k64_kornet']) {
    const compiled = compile(id), t = runtime(compiled).turrets[0], g = t.guns[0];
    const source = data.vehicles[id].weapons.main_gun;
    assert.equal(g.def.missile, source.missile);
    assert.equal(g.def.guided, source.guided);
    assert.deepEqual(g.def.launcher.muzzle_vectors_m, source.launcher.muzzle_vectors_m);
    assert.equal(g.launcher.ready, 2);
    const L = loading.newLoading(1, t.loaders.length);
    assert.equal(fireLauncherRound(g, L, 0), true);
    assert.equal(L.state[0], 'ready');
    assert.equal(g.launcher.ready, 1);
    tickLauncher(g, .25);
    assert.equal(fireLauncherRound(g, L, 0), true);
    assert.equal(L.state[0], 'waiting');
    assert.equal(g.launcher.ready, 0);
    assert.equal(reloadTime(t, 0, 0), source.reload_s, 'launcher cycle must not become a shell rack reload');
    assert.deepEqual(loading.tick(L, source.reload_s, () => reloadTime(t, 0, 0)), [0]);
    g.loaded = nextAmmo(g); refillLauncher(g);
    assert.equal(g.launcher.ready, 2);
  }
});

test('generated source gun and tube mouths agree with the simulation through yaw and elevation', () => {
  for (const id of ['xp_bmp_k64', 'xp_kda35', 'us_m901_itv', 'xp_bmp_k64_atgm', 'xp_bmp_k64_kornet']) {
    const t = runtime(compile(id)).turrets[0], g = t.guns[0];
    const parts = generatedTurretParts(t, 0).filter(p => p.mount === 'gun');
    const vectors = g.def.launcher?.muzzle_vectors_m || [[0, 0, g.muzzleOffset]];
    if (g.def.missile) {
      assert.equal(g.def.recoil_mm, 0, 'launcher tubes retain zero physical recoil');
      assert.ok(parts.every(p => p.type !== 'cyl' || p.mat !== 'paint_dark'), 'launchers have no cannon muzzle brake');
      assert.equal(parts.filter(p => p.type === 'cyl' && p.axis === 'z').length, vectors.length, 'one cylinder per actual launch tube');
    } else {
      assert.deepEqual(g.muzzleVector, [0, 0, g.muzzleOffset], 'source mount-specific muzzle vector becomes a neutral generated barrel axis');
      assert.ok(parts.some(p => p.recoil), 'automatic barrels retain visible recoil geometry');
    }
    for (const vector of vectors) {
      const mouth = parts.find(p => p.type === 'cyl' && p.axis === 'z' && Math.abs(p.pos[0] - g.trunnion[0] - vector[0]) < 1e-7 && Math.abs(p.pos[1] - g.trunnion[1] - vector[1]) < 1e-7 && Math.abs(p.pos[2] + p.len / 2 - g.trunnion[2] - vector[2]) < 1e-7);
      assert.ok(mouth, `${id} visible mouth must coincide with its firing vector`);
    }
    const mesh = vertices => { assert.ok([...vertices].every(Number.isFinite)); return { vertices, count: vertices.length / STRIDE }; };
    const renderer = { mesh, instancedMesh: mesh, setInstances() {}, freeMesh() {} };
    const model = buildTank(renderer, runtime(compile(id)), generatedTurretParts);
    for (const pose of [{ yaw: -.8, pitch: .3 }, { yaw: 1.1, pitch: -.05 }]) {
      model.turrets[0].node.yaw = pose.yaw; model.turrets[0].guns[0].node.pitch = -pose.pitch; model.root.update();
      for (const vector of vectors) {
        const muzzle = muzzleLocal({ pivot: t.pivot, trunnion: g.trunnion, muzzleOffset: g.muzzleOffset, muzzleVector: vector }, pose);
        const rendered = transformPoint(model.turrets[0].guns[0].node.world, vector);
        assert.ok(Math.hypot(...rendered.map((x, k) => x - muzzle.pos[k])) < 1e-6, `${id} rendered and simulated mouths share pivots`);
      }
    }
    model.dispose();
  }
});

test('source optics and selected stabilizer reach main and extra turrets as ordinary data', () => {
  const build = { base: 'de_hetzer', keepStock: false, turrets: [turret('xp_kda35', { sightSource: 'us_m901_itv', stabilizer: 'both' }), turret('xp_bmp_k64_atgm', { z: -1, sightSource: 'xp_bmp_k64_atgm', stabilizer: 'vertical' })] };
  const compiled = buildToBundle(build, data), lo = runtime(compiled);
  assert.deepEqual(compiled.bundle.weapons.sight, data.vehicles.us_m901_itv.weapons.sight);
  assert.equal(compiled.bundle.weapons.stabilizer, 'two_plane');
  assert.deepEqual(compiled.bundle.weapons.extra_turrets[0].sight, data.vehicles.xp_bmp_k64_atgm.weapons.sight);
  assert.equal(compiled.bundle.weapons.extra_turrets[0].stabilizer, 'vertical');
  assert.deepEqual(lo.turrets[0].sight.levels, data.vehicles.us_m901_itv.weapons.sight.levels);
  assert.equal(lo.turrets[0].stabilizer, 'two_plane');
  assert.equal(lo.turrets[1].stabilizer, 'vertical');
  assert.equal(lo.turrets[1].traverse, lo.turrets[1].guns[0].def.traverse_deg_s, 'source drive works identically as an auxiliary turret');
});

test('legacy workshop settings retain designed guns and default 3x/6x optics', () => {
  const build = structuredClone(PRESETS.hexa.build), compiled = buildToBundle(build, data), lo = runtime(compiled);
  assert.equal(lo.gunCount, 6);
  assert.deepEqual(lo.turrets[0].sight.levels.map(l => l.magnification), [3, 6]);
  assert.equal(lo.turrets[0].stabilizer, 'none');
  assert.equal(compiled.stats.stockTurrets, 0);
});

test('retaining a multi-gun multi-turret base preserves every stock weapon before added heads', () => {
  const sourceData = { ...data, vehicles: { ...data.vehicles, de_hetzer: structuredClone(data.vehicles.de_hetzer) } };
  const base = sourceData.vehicles.de_hetzer;
  base.weapons.extra_guns = [{ gun: structuredClone(base.weapons.main_gun), mount_m: [.35, 1.3, .2], muzzle_offset_m: 2 }];
  base.weapons.extra_turrets = [{ id: 'stock_aux', position_m: [0, 1.4, -1], ring_diameter_m: .8, size_m: [1, .5, 1], traverse_deg_s: 20, guns: [{ gun: structuredClone(base.weapons.main_gun), mount_m: [0, 1.6, -.6], muzzle_offset_m: 2 }] }];
  const snapshot = structuredClone(base);
  const compiled = buildToBundle({ base: 'de_hetzer', keepStock: true, turrets: [turret('xp_kda35')] }, sourceData);
  const lo = makeLoadout('multi_stock', compiled.bundle, { ...sourceData.projectiles, ...compiled.projectiles }, sourceData.machineGuns);
  assert.equal(lo.turrets.length, 3);
  assert.equal(lo.gunCount, 4);
  assert.equal(compiled.stats.stockTurrets, 2);
  assert.equal(compiled.stats.guns, 4);
  assert.equal(lo.turrets[1].id, 'stock_aux');
  assert.equal(lo.turrets[2].guns[0].def.id, 'kda_35');
  assert.deepEqual(base, snapshot, 'preserving a base must not rewrite its auxiliary mounts');
  assert.ok(base.weapons.main_gun.ammo.every(id => compiled.projectiles[id]), 'retained ammunition is included in exports');
});

test('real imported workshop export includes its model while internal exports remain light', async () => {
  const build = { base: 'xp_bmp_k64_kornet', keepStock: false, turrets: [turret('xp_bmp_k64_atgm')] };
  const compiled = buildToBundle(build, data);
  assert.ok(compiled.bundle.imported?.parts.some(p => p.mount === 'hull'), 'compiled chassis keeps its decoded hull');
  assert.ok(compiled.bundle.imported.parts.every(p => !['turret', 'gun', 'barrel'].includes(p.mount)), 'source weapons are removed');
  const before = structuredClone(data.vehicles.xp_bmp_k64_kornet.model);
  const lightweight = exportFolder(build, data, data.vehicles[build.base], 'light_bmp', 'Light BMP', { includeModel: false });
  assert.equal(lightweight.files['model.json'], undefined);
  const complete = exportFolder(build, data, data.vehicles[build.base], 'complete_bmp', 'Complete BMP');
  assert.equal(complete.files['vehicle.json'].model, 'model.json');
  assert.ok(complete.files['model.json']);
  assert.equal(complete.files['model.json'].shared, undefined);
  const decoded = await decodeImported(complete.files['model.json']);
  assert.equal(decoded.parts.length, compiled.bundle.imported.parts.length);
  assert.deepEqual(data.vehicles.xp_bmp_k64_kornet.model, before, 'export leaves packed source assets untouched');
  assert.deepEqual(complete.missiles['9m113_konkurs'], data.missiles['9m113_konkurs'], 'missile exports include the shared flight definition');
});

test('an empty legacy custom build consistently retains the entire base and its interior', () => {
  const build = { base: 'xp_bmp_k64', keepStock: false, turrets: [] };
  const compiled = buildToBundle(build, data);
  assert.ok(compiled.bundle.imported === data.vehicles.xp_bmp_k64.imported, 'an empty build retains the decoded source model by reference');
  assert.equal(compiled.stats.stockTurrets, 1);
  assert.equal(compiled.stats.guns, 1);
  const out = exportFolder(build, data, data.vehicles.xp_bmp_k64, 'empty_legacy', 'Stock BMP', { includeModel: false });
  for (const key of ['armor', 'modules', 'crew']) assert.deepEqual(out.files[key + '.json'], data.vehicles.xp_bmp_k64[key]);
});

test('unknown source optics fail compilation rather than silently exporting a default sight', () => {
  assert.throws(() => compile('xp_kda35', { sightSource: 'missing_source' }), /sight/i);
});

test('normalized custom selectors and retained machine gun dependencies export through the old path', () => {
  const build = { base: 'de_hetzer', keepStock: true, turrets: [{ ...newTurretSpec(), guns: [{ weapon: 'custom', cal: 57, len: 50 }] }] };
  const compiled = buildToBundle(build, data);
  assert.equal(runtime(compiled).turrets.at(-1).guns[0].def.id, 'gun_custom_57_l50');
  const out = exportFolder(build, data, data.vehicles.de_hetzer, 'retained_mg', 'Retained MG', { includeModel: false });
  for (const secondary of data.vehicles.de_hetzer.weapons.secondary) assert.deepEqual(out.machineGuns[secondary.weapon], data.machineGuns[secondary.weapon]);
});

test('workshop salvo recoil excludes zero-recoil missiles but retains automatic cannon momentum', () => {
  for (const id of ['us_m901_itv', 'xp_bmp_k64_atgm', 'xp_bmp_k64_kornet']) assert.equal(compile(id).stats.salvoMomentum, 0, id);
  const gun = compile('xp_kda35').layouts[0].guns[0];
  assert.equal(compile('xp_kda35').stats.salvoMomentum, gun.shell.mass_kg * gun.shell.muzzle_velocity_ms * 1.3);
});
