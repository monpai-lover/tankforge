import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadData } from '../tools/load-data.mjs';
import { decodeAllImported } from '../src/gfx/imported.js';
import { makeLoadout, generatedTurretParts } from '../src/game/loadout.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { loadCoreSync } from '../src/design/core.js';
import { Combat } from '../src/game/combat.js';

const IDS = ['xp_bmp_k64', 'xp_bmp_k64_atgm', 'xp_bmp_k64_kornet'];
const data = loadData();
await decodeAllImported(data.vehicles);
const renderer = { mesh: vertices => ({ vertices }), texture: () => null, disposeMesh() {} };

test('BMP source triangles are retained during rest-pose and mount repairs', () => {
  for (const [id, count] of [['xp_bmp_k64', 191068], ['xp_bmp_k64_atgm', 9408], ['xp_bmp_k64_kornet', 35120]]) {
    assert.equal(data.vehicles[id].model.parts.reduce((n, p) => n + p.triangles, 0), count);
  }
});

test('all eight complete BMP tyres, including tread and sidewall letters, move on their own wheels', () => {
  for (const id of IDS) {
    const lo = makeLoadout(id, data.vehicles[id], data.projectiles, data.machineGuns);
    const model = buildTank(renderer, lo, generatedTurretParts);
    assert.equal(model.wheels.length, 8);
    for (const w of model.wheels) {
      const parts = lo.imported.parts.filter(p => p.mount === 'road_wheel' && p.side === w.side && p.index === w.axle);
      assert.equal(parts.reduce((n, p) => n + p.triangles, 0), 13128, `${id} wheel ${w.side}:${w.axle} keeps every original tyre triangle`);
      assert.ok(parts.every(p => Math.abs((p.lo[0] + p.hi[0]) / 2) > 1.29), 'fixed chassis bearings must remain on the hull');
    }
    model.root.update();
    const node = model.wheels[0].node.children[0];
    const before = Array.from(node.world);
    model.updateRunningGear({ wheels: model.wheels.map(() => ({ lift: .1, spin: .7, steer: .2 })) });
    model.root.update();
    assert.notDeepEqual(Array.from(node.world), before, 'imported wheel meshes follow spin, steering and suspension');
  }
});

test('BMP front hatches retain their meshes and are closed by default on the common chassis', () => {
  for (const id of IDS) {
    const imp = data.vehicles[id].imported;
    const hatch = imp.parts.filter(p => p.mount === 'hull' && p.rest_pose === 'Hatch_Left');
    assert.equal(hatch.reduce((n, p) => n + p.triangles, 0), 1696, `${id} left hatch geometry remains present`);
    assert.ok(hatch.every(p => p.hi[1] < 2.02), '80 degree source hatch is closed around its hinge');
  }
  const cupola = data.vehicles.xp_bmp_k64.imported.parts.filter(p => p.rest_pose === 'Cupola_Hatch');
  assert.equal(cupola.reduce((n, p) => n + p.triangles, 0), 1656, 'KPVT cupola lid, inner padding and handle remain present');
  assert.ok(cupola.every(p => p.hi[1] < 2.18), 'the closed lid and raised handle stay below the cupola roof hardware');
  const pad = cupola.find(p => p.triangles === 1024);
  assert.ok(pad.hi[1] - pad.lo[1] < .03, 'inner padding is horizontal instead of the source vertical hatch pose');
});

test('BMP visible weapon muzzles use the real elevation hinge and align with the level bore', () => {
  const expected = { xp_bmp_k64: [0, .033, 1.357], xp_bmp_k64_atgm: [-.09, -.085, .725], xp_bmp_k64_kornet: [-.284, .267, .68] };
  for (const id of IDS) {
    const lo = makeLoadout(id, data.vehicles[id], data.projectiles, data.machineGuns);
    assert.deepEqual(lo.turrets[0].guns[0].muzzleVector, expected[id]);
    const model = buildTank(renderer, lo, generatedTurretParts);
    const gun = model.turrets[0].guns[0];
    assert.ok(gun.node.children.some(n => n.name === 'gun_model') || gun.barrel.children.length);
    model.root.update();
    const fixed = Array.from(model.turrets[0].node.world);
    const before = Array.from(gun.node.world);
    gun.node.pitch = -.3;
    model.root.update();
    assert.notDeepEqual(Array.from(gun.node.world), before, 'visible launcher follows elevation');
    assert.deepEqual(Array.from(model.turrets[0].node.world), fixed, 'fixed traversing pedestal does not elevate');
  }
  const barrel = data.vehicles.xp_bmp_k64.imported.parts.filter(p => p.mount === 'barrel');
  assert.ok(barrel.length, 'the KPVT tube has its own recoil mount');
  assert.ok(Math.abs(Math.max(...barrel.map(p => p.hi[2])) - 1.077) < .005);
  const konkurs = data.vehicles.xp_bmp_k64_atgm.imported.parts.find(p => p.mount === 'gun' && p.triangles === 1224);
  for (const tip of [[-.205, 2.12, .445], [-.205, 2.264, .445]]) {
    let found = false;
    for (let i = 0; i < konkurs.pos.length; i += 3) {
      if (Math.hypot(...tip.map((v, k) => konkurs.pos[i + k] / 1000 - v)) < .002) found = true;
    }
    assert.ok(found, 'Konkurs muzzle lies on the actual levelled tube cap');
  }
  const kornet = data.vehicles.xp_bmp_k64_kornet.imported.parts.find(p => p.mount === 'gun' && p.triangles === 1792);
  for (const sx of [-1, 1]) {
    const ring = [];
    for (let i = 0; i < kornet.pos.length; i += 3) {
      if (Math.sign(kornet.pos[i]) === sx && kornet.pos[i + 2] >= 229) ring.push([kornet.pos[i] / 1000, kornet.pos[i + 1] / 1000]);
    }
    const center = [0, 1].map(k => ring.reduce((n, p) => n + p[k], 0) / ring.length);
    assert.ok(Math.abs(center[0] - sx * .284) < .002 && Math.abs(center[1] - 2.747) < .002,
      'Kornet muzzle vector follows the centre of its visible launcher mouth');
  }
});

test('all BMP variants retain the shared T-64A protection approximation and cover their visible hull', () => {
  const base = data.vehicles[IDS[0]].armor.filter(p => p.zone.startsWith('hull'));
  for (const id of IDS) assert.deepEqual(data.vehicles[id].armor.filter(p => p.zone.startsWith('hull')), base);
  assert.equal(base.find(p => p.id === 'hull_upper_front').thickness_mm, 205);
  assert.equal(base.find(p => p.id === 'hull_upper_front').material, 'composite');
  const core = loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm', import.meta.url)),
    { materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains) });
  const combat = new Combat(core);
  for (const id of IDS) {
    for (const [origin, dir, zone, mm] of [
      [[1.42, 1.5, 40], [0, 0, -1], 'hull_upper_front', 205],
      [[40, 1.6, -1], [-1, 0, 0], 'hull_side', 80],
      [[1.29, 1.5, -40], [0, 0, 1], 'hull_rear', 45],
      [[1.3, 40, -1], [0, -1, 0], 'hull_roof', 20],
    ]) {
      const state = combat.fresh(id, data.vehicles[id]).state;
      const report = combat.shoot(id, state, { shell: data.projectiles.apcbc_88_l56,
        origin, dir, speed_ms: 770, distance_m: 40, seed: 1, turret_yaw: 0 });
      assert.notEqual(report.outcome, 'miss', `${id} visible ${zone} remains hittable`);
      assert.ok(report.layers.some(l => l.zone === zone && l.thickness_mm === mm), `${id} ${zone} uses actual combat armour`);
    }
  }
});
