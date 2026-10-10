import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadData } from '../tools/load-data.mjs';
import { runtimeParts, surfaceCrossings, touches, makePiece } from '../tools/procedural-fleet-audit.mjs';
import { pintleGun, setMgModels } from '../src/gfx/mgmodel.js';
import { materials } from '../src/gfx/tankmodel.js';
import { STRIDE } from '../src/gfx/geo.js';
import { transformPoint } from '../src/gfx/math.js';
import { muzzleLocal } from '../src/sim/gunnery.js';

const data = loadData(), DEG = Math.PI / 180;
const models = JSON.parse(fs.readFileSync(new URL('../assets/mg_models.json', import.meta.url)));
const regressions = [
  ['su_is2', 0, 60, 'visual#26'],
  ['su_t54', 60, 60, 'visual#52'],
  ['us_m8', -75, 60, 'visual#19'],
  ['us_m10', -30, 60, 'visual#25'],
  ['us_m4a2', 0, 30, 'visual#40'],
  ['us_m4a3_75w', 0, 30, 'visual#39'],
  ['us_m4a1_76w', 135, 45, 'visual#41'],
  ['us_m4a3_76w_hvss', -135, 30, 'visual#28'],
  ['de_hetzer', 45, 60, 'visual#16'],
];

for (const [id, yaw, pitch, obstacle] of regressions) {
  test(`${id}: roof gun clears ${obstacle} at yaw ${yaw}, elevation ${pitch}`, () => {
    const parts = runtimeParts(id, data).at({ mgYaw: yaw * DEG, mgPitch: pitch * DEG });
    assert.equal(surfaceCrossings(parts.find(p => p.mgGun), parts.find(p => p.id === obstacle)).count, 0);
  });
}

test('Hetzer remote MG34 removes only the separate buttstock and preserves the receiver/barrel/muzzle', () => {
  setMgModels(models);
  const a = models.mg34, stockless = pintleGun('mg34', 7.92, materials({}), 'mg34_remote');
  const expected = [];
  for (let t = 0; t < a.triangles; t++) {
    const p = a.pos.slice(t * 9, t * 9 + 9);
    if (Math.max(p[2], p[5], p[8]) > -332) expected.push(...p.map(v => v / 1000));
  }
  const actual = stockless.geo.data.filter((_, i) => i % STRIDE < 3);
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 1e-6);
  assert.equal(stockless.muzzle, a.muzzle);
  // The immutable shared gun asset still includes its infantry stock by default.
  assert.equal(pintleGun('mg34', 7.92, materials({})).geo.data.length, a.triangles * 3 * STRIDE);
});

test('roof-gun muzzle metadata follows the real mesh bore in the asset and fallback paths', () => {
  for (const [id, expected] of [['m2hb', [.002, .155, 1.09]], ['dshk', [.0095, .232, 1.047]], ['mg34', [.037, .0585, .719]]]) {
    setMgModels(models);
    const gun = pintleGun(id, 12.7, materials({}));
    assert.deepEqual(gun.muzzleVector, expected);
    assert.equal(gun.muzzleVector[2], gun.muzzle);
  }
  setMgModels(null);
  assert.deepEqual(pintleGun('m2hb', 12.7, materials({})).muzzleVector, [0, .18, 1.09]);
  assert.deepEqual(pintleGun('dshk', 12.7, materials({})).muzzleVector, [0, .19, .95]);
  assert.deepEqual(pintleGun('mg34', 7.92, materials({})).muzzleVector, [0, .06, 1.17 * .72]);
});

test('runtime pintle muzzle vector matches its transformed rendered mesh after traverse and elevation', () => {
  for (const id of ['su_is2', 'us_m8', 'de_hetzer']) {
    const rt = runtimeParts(id, data), mg = rt.loadout.machineGuns.find(m => m.mount === 'pintle'), pm = rt.model.mgs[0];
    assert.deepEqual(pm.muzzleVector, mg.muzzleVector);
    assert.ok(pm.muzzleVector);
    const yaw = .43, mgYaw = .72, pitch = .91;
    rt.at({ yaw, mgYaw, mgPitch: pitch });
    const parentYaw = mg.anchor === 'hull' ? 0 : yaw;
    const base = muzzleLocal({ pivot: rt.loadout.turrets[0].pivot, trunnion: mg.pos, muzzleOffset: 0 }, { yaw: parentYaw, pitch: 0 }).trunnion;
    const shot = muzzleLocal({ pivot: base, trunnion: base, muzzleOffset: pm.muzzle, muzzleVector: mg.muzzleVector }, { yaw: parentYaw + mgYaw, pitch });
    const visible = transformPoint(pm.node.world, pm.muzzleVector);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(shot.pos[k] - visible[k]) < 1e-6);
  }
});

test('display variants stay in visual data while strict secondary weapon fields remain supported', () => {
  const schema = JSON.parse(fs.readFileSync(new URL('../../../schemas/weapons.schema.json', import.meta.url)));
  const supported = new Set(Object.keys(schema.properties.secondary.items.properties));
  for (const [id, bundle] of Object.entries(data.vehicles)) for (const sec of bundle.weapons.secondary)
    for (const key of Object.keys(sec)) assert.ok(supported.has(key), `${id}/${sec.id}: unsupported weapon field ${key}`);
  assert.deepEqual(data.vehicles.de_hetzer.visual.mg_variants, { roof_mg34: 'mg34_remote' });
  const rt = runtimeParts('de_hetzer', data);
  assert.equal(rt.loadout.machineGuns[0].displayVariant, 'mg34_remote');
  assert.equal(rt.model.mgs[0].node.mesh.count, 3984 * 3 + 3 * 12 * 3); // gun plus three shield boxes
});

test('raised roof-gun posts keep their original bases and remain attached at both ends', () => {
  const bases = { su_is2: 2.645, su_t54: 1.96, us_m8: 1.96, us_m10: 2.54, us_m4a2: 2.52,
    us_m4a3_75w: 2.52, us_m4a1_76w: 2.78, us_m4a3_76w_hvss: 2.65, de_hetzer: 1.926 };
  for (const [id, y] of Object.entries(bases)) {
    const parts = runtimeParts(id, data).at(), gun = parts.find(p => p.mgGun), post = parts.find(p => p.id.endsWith(':post'));
    assert.ok(Math.abs(post.lo[1] - y) < 1e-6, `${id}: base moved`);
    assert.ok(touches(post, gun), `${id}: gun separated from its actual support`);
    assert.ok(parts.some(p => p.mg == null && touches(post, p)), `${id}: support lost its roof attachment`);
  }
});

test('all nine repaired roof guns clear source geometry through their legal hand-aim sweeps', () => {
  for (const id of regressions.map(p => p[0])) {
    const rt = runtimeParts(id, data), gun = rt.model.mgs[0].node, source = rt.records.find(p => p.mgGun);
    const fixed = rt.at().filter(p => p.mg == null), mg = rt.loadout.machineGuns.find(p => p.mount === 'pintle');
    const pitches = [-mg.arc[1], ...Array.from({ length: Math.floor(mg.arc[2] / DEG / 5) + 1 }, (_, k) => k * 5 * DEG), mg.arc[2]];
    for (let yaw = -mg.arc[0]; yaw <= mg.arc[0] + 1e-6; yaw += 15 * DEG) for (const pitch of pitches) {
      gun.yaw = yaw; gun.pitch = -pitch; rt.model.root.update();
      const part = makePiece(source.id, source.local.tris.map(t => t.map(p => transformPoint(gun.world, p))), true);
      for (const q of fixed) assert.equal(surfaceCrossings(part, q).count, 0,
        `${id}: ${q.id} at yaw ${(yaw / DEG).toFixed(1)}, pitch ${(pitch / DEG).toFixed(1)}`);
    }
    assert.deepEqual(mg.arc.map(a => Math.round(a / DEG)), [180, 10, 60], `${id}: original firing range must remain available`);
  }
});
