import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/load-data.mjs';
import { Mods, familyOf } from '../src/game/mods.js';
import { buildToBundle, makeLoadout, generatedTurretParts, exportFolder, checkFolder } from '../src/game/loadout.js';
import { addPart, materials, buildTank } from '../src/gfx/tankmodel.js';
import { GeoBuilder, STRIDE } from '../src/gfx/geo.js';
import { transformPoint } from '../src/gfx/math.js';
import { muzzleLocal } from '../src/sim/gunnery.js';

const data = loadData();
const original = data.vehicles.de_hetzer;
const points = part => {
  const geo = new GeoBuilder();
  addPart(geo, part, [0, 0, 0], materials(original.visual.palette));
  return Array.from({ length: geo.data.length / STRIDE }, (_, i) => geo.data.slice(i * STRIDE, i * STRIDE + 3));
};

test('Hetzer four large road wheels have distinct, separated rubber rims', () => {
  for (const id of ['de_hetzer', 'de_hetzer_flak']) {
    const gear = data.vehicles[id].visual.running_gear;
    assert.equal(gear.wheels.length, 4);
    for (let i = 1; i < gear.wheels.length; i++) {
      const a = gear.wheels[i - 1], b = gear.wheels[i];
      const gap = Math.hypot(a.z - b.z, a.y - b.y) - a.r - b.r;
      assert.ok(gap >= 0.025, `${id} wheels ${i - 1}/${i} overlap or lose the reference gap: ${gap} m`);
    }
    assert.ok(gear.wheels.every(w => w.r >= 0.39 && w.r <= 0.43), 'preserve the large 38(t) wheel diameter');
  }
});

test('Saukopf is a broad rounded casting tapering to the offset barrel', () => {
  const mantlet = original.visual.parts.find(p => p.type === 'loft' && p.mount === 'gun');
  const vertices = points(mantlet);
  const range = k => Math.max(...vertices.map(p => p[k])) - Math.min(...vertices.map(p => p[k]));
  assert.ok(range(0) >= 0.82 && range(0) <= 1.0, `reference casting width: ${range(0)}`);
  assert.ok(range(2) >= 1.1 && range(2) <= 1.5, `reference casting length: ${range(2)}`);
  const tip = mantlet.rings.at(-1);
  const center = [0, 1].map(k => tip.reduce((s, p) => s + p[k], 0) / tip.length);
  assert.ok(Math.abs(center[0] - original.weapons.mount_m[0]) < 1e-4, 'casting neck stays centered on the gun axis');
  assert.ok(Math.abs(center[1] - original.weapons.mount_m[1]) < 1e-4);
  assert.ok(mantlet.rings.every(r => r.length >= 28), 'rounded cast sections must not become a thick box');
});

test('Hetzer roof has a shaped loader hatch and a physical rear louvre bank', () => {
  const parts = original.visual.parts;
  const hatch = parts.find(p => p.type === 'plan' && p.mount === 'hull' && p.y0 >= 1.89 && p.outline.some(v => v[0] < -0.6));
  assert.ok(hatch && hatch.outline.length > 8, 'loader hatch follows the curved outline on the supplied top view');
  const louvres = parts.filter(p => p.type === 'box' && p.mat === 'paint_dark' && p.pos[2] < -1.45 && p.size[0] > 0.6 && p.size[2] < 0.04);
  assert.ok(louvres.length >= 10, 'rear cooling grille needs visible slats, not a solid black rectangle');
  const normalLength = Math.hypot(1.21, 0.62);
  for (const slat of louvres) {
    for (const p of points(slat)) {
      const relief = ((p[1] - 1.89) * 1.21 - (p[2] + 1.20) * 0.62) / normalLength;
      assert.ok(relief >= -0.005 && relief <= 0.055, `louvre must rest on the rear deck: ${relief}`);
    }
  }
});

test('all existing Hetzer family fits still select their own weapon and active mounts', () => {
  const saved = new Map();
  const mods = new Mods({ get: k => saved.get(k), set: (k, v) => saved.set(k, v) }, 'test', id => !!data.vehicles[id]);
  const family = familyOf('de_hetzer');
  assert.deepEqual(family.variants.map(v => v.id), ['de_hetzer', 'de_hetzer_flak', 'de_hetzer_mk103', 'de_hetzer_mk103_camo', 'de_hetzer_sdkfz1401']);
  for (const { id } of family.variants) {
    mods.choose(id);
    assert.equal(mods.variantOf('de_hetzer'), id);
    const bundle = data.vehicles[id];
    const lo = makeLoadout(id, bundle, data.projectiles, data.machineGuns);
    assert.equal(lo.gunCount, 1);
    assert.equal(lo.turrets[0].guns[0].def.id, bundle.weapons.main_gun.id);
    assert.deepEqual(lo.turrets[0].guns[0].trunnion, bundle.weapons.mount_m);
    assert.ok(bundle.model || bundle.visual.parts.some(p => p.mount === 'gun'));
  }
});

for (const keepStock of [false, true]) {
  test(`Hetzer workshop ${keepStock ? 'adds a turret' : 'replaces the original head'} through the real bundle and model paths`, () => {
    const build = { base: 'de_hetzer', keepStock, turrets: [{ x: 0, z: -0.05, lift: 0.12, facing: 0, arc: 360,
      ring: 1.2, loaders: 1, rack: 'ready', open: false, guns: [{ cal: 57, len: 50 }] }] };
    const compiled = buildToBundle(build, data);
    const lo = makeLoadout('hetzer_workshop', compiled.bundle, { ...data.projectiles, ...compiled.projectiles }, data.machineGuns);
    assert.equal(lo.gunCount, keepStock ? 2 : 1);
    assert.deepEqual(compiled.bundle.visual.running_gear, original.visual.running_gear);
    const custom = lo.turrets.at(-1);
    assert.equal(custom.generated, true);
    const mesh = vertices => {
      assert.ok([...vertices].every(Number.isFinite), 'renderer receives finite geometry');
      const value = { vertices, count: vertices.length / STRIDE };
      return value;
    };
    const renderer = { mesh, instancedMesh: mesh, setInstances() {}, freeMesh() {} };
    const model = buildTank(renderer, lo, generatedTurretParts);
    assert.equal(model.turrets.length, keepStock ? 2 : 1);
    assert.ok(model.turrets.at(-1).guns[0].barrel.mesh.count > 0, 'replacement barrel has real geometry');
    assert.ok(model.hull.mesh.count > 0, 'hull survives the replacement');
    assert.equal(model.wheels.filter(w => w.role === 'road_wheel').length, 8);
    for (const role of ['sprocket', 'idler', 'return_roller']) assert.equal(model.wheels.filter(w => w.role === role).length, 2);
    const gun = custom.guns[0];
    const neutral = muzzleLocal({ pivot: custom.pivot, trunnion: gun.trunnion, muzzleOffset: gun.muzzleOffset }, { yaw: 0, pitch: 0 });
    assert.ok(Math.abs(neutral.pos[2] - gun.trunnion[2] - gun.muzzleOffset) < 1e-9);
    for (const pose of [{ yaw: -1.1, pitch: -0.08 }, { yaw: 1.3, pitch: 0.3 }]) {
      const muzzle = muzzleLocal({ pivot: custom.pivot, trunnion: gun.trunnion, muzzleOffset: gun.muzzleOffset }, pose);
      assert.ok(muzzle.pos.every(Number.isFinite));
      assert.ok(Math.abs(Math.hypot(...muzzle.pos.map((v, k) => v - muzzle.trunnion[k])) - gun.muzzleOffset) < 1e-8);
      const turret = model.turrets.at(-1);
      turret.node.yaw = pose.yaw;
      turret.guns[0].node.pitch = -pose.pitch;
      model.root.update();
      const tip = transformPoint(turret.guns[0].node.world, [0, 0, gun.muzzleOffset]);
      assert.ok(Math.hypot(...tip.map((v, k) => v - muzzle.pos[k])) < 1e-6, 'active model and firing muzzle follow the same replacement pivots');
    }
    const { files } = exportFolder(build, data, original, 'hetzer_workshop', 'Hetzer workshop regression');
    assert.deepEqual(checkFolder(files), [], 'exported head, gun modules, armor and crew are valid');
    assert.ok(files['modules.json'].some(m => m.kind === 'gun_breech' && m.id.startsWith('breech_t')));
    if (!keepStock) {
      assert.equal(files['armor.json'].some(p => p.id === 'gun_mantlet'), false);
      assert.equal(compiled.bundle.visual.parts.some(p => p.mount === 'gun'), false, 'stock casting and barrel are removed together');
    }
    model.dispose();
  });
}
