import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/load-data.mjs';
import { decodeAllImported, decodeImported, partMesh } from '../src/gfx/imported.js';
import { makeLoadout, generatedTurretParts } from '../src/game/loadout.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { STRIDE } from '../src/gfx/geo.js';
import { workshopImportedModel, exportWorkshopModel } from '../src/game/workshopImported.js';

// Loading through the stock decoder also resolves BMP's shared chassis, as browser boot does.
const data = loadData();
await decodeAllImported(data.vehicles);
const fixed = p => !['turret', 'gun', 'barrel'].includes(p.mount);
const ids = ['xp_bmp_k64', 'xp_bmp_k64_kornet', 'de_sdkfz140_1', 'de_hetzer_sdkfz1401'];

function importedOf(base, keepStock) {
  return workshopImportedModel(base, keepStock);
}

function exportedOf(base, keepStock, registry = data) {
  return exportWorkshopModel(base, keepStock, registry);
}

test('workshop replacement preserves every fixed imported part and all eight wheel stations', () => {
  for (const id of ids) {
    const base = data.vehicles[id];
    const before = base.imported.parts.slice();
    const model = importedOf(base, false);
    assert.deepEqual(model.parts, before.filter(fixed), id);
    assert.ok(model.parts.some(p => p.mount === 'hull'), `${id} keeps its source hull`);
    assert.equal(new Set(model.parts.filter(p => p.mount === 'road_wheel').map(p => `${p.side}:${p.index}`)).size, 8, id);
    assert.equal(model.images, base.imported.images, 'images stay shared rather than reloaded');
    model.parts.forEach(p => assert.equal(p, before.find(q => q === p), 'geometry objects stay shared'));
    assert.deepEqual(base.imported.parts, before, 'filtering must not mutate the source model');
    for (let k = 0; k < 3; k++) {
      assert.equal(model.bounds[0][k], Math.min(...model.parts.map(p => p.lo[k])));
      assert.equal(model.bounds[1][k], Math.max(...model.parts.map(p => p.hi[k])));
    }
  }
});

test('keeping stock imported weapons keeps every turret, gun and recoil barrel', () => {
  for (const id of ids) {
    const base = data.vehicles[id];
    const model = importedOf(base, true);
    assert.equal(model, base.imported, 'the full stock model can be reused directly');
    assert.ok(model.parts.some(p => p.mount === 'gun'));
    assert.ok(model.parts.some(p => p.mount === 'turret'));
    assert.equal(importedOf(base, false), importedOf(base, false), 'replacement model is cached per source');
  }
});

test('procedural bases and weapon-only imports need no replacement model', () => {
  assert.equal(importedOf(data.vehicles.proto_a, false), null);
  assert.equal(exportedOf(data.vehicles.proto_a, false), null);
  assert.equal(importedOf(data.vehicles.xp_kda35, false), null);
  assert.equal(exportedOf(data.vehicles.xp_kda35, false), null);
});

test('an imported base must be decoded before workshop construction or export', () => {
  const raw = { model: data.vehicles.xp_bmp_k64.model };
  assert.throws(() => importedOf(raw, false), /decod/i);
  assert.throws(() => exportedOf(raw, false), /decod/i);
  const incomplete = { model: data.vehicles.xp_bmp_k64_kornet.model, imported: { ...data.vehicles.xp_bmp_k64_kornet.imported, borrowed: false } };
  assert.throws(() => importedOf(incomplete, false), /shared|chassis/i);
  assert.throws(() => exportedOf(incomplete, false), /shared|chassis/i);
});

test('ordinary exports retain their packed blob with filtered mounts and normal maps', async () => {
  const base = data.vehicles.de_hetzer_sdkfz1401;
  const json = exportedOf(base, false);
  assert.equal(json.blob, base.model.blob, 'ordinary geometry is already packed');
  assert.equal(json.source, base.model.source);
  assert.equal(json.shared, undefined);
  assert.deepEqual(json.parts, base.model.parts.filter(fixed));
  assert.deepEqual(json.textures, base.model.textures);
  assert.equal(json, exportedOf(base, false), 'packing result is cached');
  const decoded = await decodeImported(JSON.parse(JSON.stringify(json)));
  const source = importedOf(base, false);
  assert.deepEqual(decoded.bounds, source.bounds);
  decoded.parts.forEach((p, i) => {
    for (const key of ['pos', 'nor', 'uv', 'idx']) assert.deepEqual(p[key], source.parts[i][key], `${key} stays exact`);
    assert.equal(p.normal, source.parts[i].normal, 'normal-map indices stay exact');
  });
});

test('shared BMP exports decode independently with exact body geometry, UVs and materials', async () => {
  for (const id of ['xp_bmp_k64_atgm', 'xp_bmp_k64_kornet']) {
    const base = data.vehicles[id];
    const partsBefore = base.model.parts.slice();
    const imagesBefore = base.imported.images;
    for (const keep of [false, true]) {
      const json = exportedOf(base, keep);
      assert.equal(json.shared, undefined, 'independent files cannot borrow external geometry');
      assert.equal(json.source, base.model.source, 'source attribution is retained');
      assert.equal(json, exportedOf(base, keep), 'expensive model packing runs once per policy');
      const source = importedOf(base, keep);
      assert.equal(json.parts.length, source.parts.length);
      assert.equal(json.textures.length, base.model.textures.length + data.vehicles.xp_bmp_k64.model.textures.length);
      assert.deepEqual(json.textures.slice(base.model.textures.length), data.vehicles.xp_bmp_k64.model.textures);
      const decoded = await decodeImported(JSON.parse(JSON.stringify(json)));
      assert.deepEqual(decoded.bounds, source.bounds);
      decoded.parts.forEach((p, i) => {
        const original = source.parts[i];
        for (const key of ['pos', 'nor', 'uv', 'idx']) assert.deepEqual(p[key], original[key], `${id} ${key} stays exact`);
        for (const key of ['mount', 'texture', 'normal', 'vertices', 'triangles', 'rough', 'metal', 'side', 'index', 'turret', 'gun']) assert.equal(p[key], original[key], `${id} ${key}`);
        assert.ok(p.texture < json.textures.length && p.normal < json.textures.length, 'every material is included');
        for (const index of p.idx) assert.ok(index < p.vertices, 'indices address actual packed vertices');
      });
    }
    assert.deepEqual(base.model.parts, partsBefore, 'export must not alter the source asset metadata');
    assert.equal(base.imported.images, imagesBefore, 'export must not replace browser images');
  }
});

test('shared model export rejects missing texture dependencies instead of creating an incomplete file', () => {
  assert.throws(() => exportedOf(data.vehicles.xp_bmp_k64_kornet, false, { vehicles: {} }), /shared|source|chassis/i);
});

test('imported mesh cache follows the part when workshop filtering changes its list index', () => {
  let uploads = 0;
  const renderer = { mesh: vertices => ({ vertices, upload: ++uploads }) };
  const source = data.vehicles.de_hetzer_sdkfz1401.imported;
  const part = source.parts.find(p => p.mount === 'hull');
  const originalIndex = source.parts.indexOf(part);
  const filteredIndex = source.parts.filter(fixed).indexOf(part);
  const stock = partMesh(renderer, `${source.uid}:${originalIndex}:0,0,0`, part, [0, 0, 0]);
  for (let swap = 0; swap < 10; swap++) {
    assert.equal(partMesh(renderer, `${source.uid}:${filteredIndex}:0,0,0`, part, [0, 0, 0]), stock);
  }
  assert.equal(uploads, 1, 'unchanged hull geometry uploads once through repeated swaps');
});

test('different imported parts cannot collide when a filtered model reuses an old list index', () => {
  const renderer = { mesh: vertices => ({ vertices }) };
  const source = data.vehicles.de_hetzer_sdkfz1401.imported;
  const gun = source.parts[0];
  const hull = source.parts.find(p => p.mount === 'hull');
  assert.notEqual(partMesh(renderer, 'old-index:0', gun, [0, 0, 0]), partMesh(renderer, 'old-index:0', hull, [0, 0, 0]));
  assert.notEqual(partMesh(renderer, 'origin-a', hull, [0, 0, 0]), partMesh(renderer, 'origin-b', hull, [0, 1, 0]), 'an actual origin change needs another mesh');
});

test('a new turret remains visible when the chassis retains its stock imported turret', () => {
  const renderer = {
    mesh: vertices => ({ vertices, count: vertices.length / STRIDE }),
    instancedMesh: (vertices, instances) => ({ vertices, count: vertices.length / STRIDE, instances }),
    setInstances() {},
    texture: () => null,
    freeMesh() {},
  };
  for (const id of ['xp_bmp_k64', 'de_sdkfz140_1']) {
    const base = data.vehicles[id];
    const gun = data.vehicles.proto_a.weapons.main_gun;
    const bundle = { ...base, imported: importedOf(base, true), weapons: { ...base.weapons, extra_turrets: [{
      id: 'workshop_extra', position_m: [0, 2.2, -1.8], size_m: [1.1, 0.6, 1.4], ring_diameter_m: 0.9,
      traverse_deg_s: 20, guns: [{ gun, mount_m: [0, 2.5, -1.2], muzzle_offset_m: 2 }],
    }] } };
    const loadout = makeLoadout(id, bundle, data.projectiles, data.machineGuns);
    const model = buildTank(renderer, loadout, generatedTurretParts);
    assert.ok(model.turrets[0].node.children.some(n => n.name === 'turret_model'), 'stock turret stays imported');
    assert.equal(model.turrets[0].node.children.find(n => n.name === 'turret_shell').mesh, null, 'stock geometry is not duplicated procedurally');
    assert.ok(model.turrets[1].node.children.find(n => n.name === 'turret_shell').mesh?.count > 0, `${id} new turret has its own generated shell`);
    assert.ok(model.turrets[1].guns[0].node.children.find(n => n.name === 'gun_mount').mesh?.count > 0, `${id} new gun has its own generated mount`);
    assert.ok(model.turrets[1].guns[0].barrel.mesh?.count > 0, `${id} new gun has its own generated tube`);
    assert.equal(new Set(bundle.imported.parts.filter(p => p.mount === 'road_wheel').map(p => `${p.side}:${p.index}`)).size, 8);
    model.dispose();
  }
});
