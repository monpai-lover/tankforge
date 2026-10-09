import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/load-data.mjs';
import { decodeImported } from '../src/gfx/imported.js';
import { FAMILIES } from '../src/game/mods.js';
import { muzzleLocal } from '../src/sim/gunnery.js';
import fs from 'node:fs';
import { loadCoreSync } from '../src/design/core.js';
import { Combat } from '../src/game/combat.js';
import { makeLoadout } from '../src/game/loadout.js';

test('main gun off-axis muzzle data survives loadout construction', () => {
  const data = loadData();
  const bundle = structuredClone(data.vehicles.de_hetzer_sdkfz1401);
  bundle.weapons.main_gun.muzzle_vector_m = [-.1, .267, .65];
  const gun = makeLoadout('de_hetzer_sdkfz1401', bundle, data.projectiles, data.machineGuns).turrets[0].guns[0];
  assert.deepEqual(gun.muzzleVector, [-.1, .267, .65]);
});

test('an off-axis coax muzzle follows the shared gun elevation hinge', () => {
  const m = muzzleLocal({ pivot: [0, 1.92, 0.15], trunnion: [0, 2.274, 0.138],
    muzzleOffset: 0, muzzleVector: [-0.4, -0.048, 0.96] }, { yaw: 0, pitch: Math.PI / 2 });
  assert.ok(Math.abs(m.pos[0] + 0.4) < 1e-8);
  assert.ok(Math.abs(m.pos[1] - 3.234) < 1e-8);
  assert.ok(Math.abs(m.pos[2] - 0.186) < 1e-8);
});

test('visible upper glacis remains hittable by the real combat core', () => {
  const data = loadData();
  const core = loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm', import.meta.url)),
    { materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains) });
  const combat = new Combat(core);
  const id = 'de_hetzer_sdkfz1401';
  for (const y of [1.7, 1.8, 1.85]) {
    const state = combat.fresh(id, data.vehicles[id]).state;
    const result = combat.shoot(id, state, { shell: data.projectiles.apcbc_88_l56,
      origin: [0, y, 40], dir: [0, 0, -1], speed_ms: 770, distance_m: 40, seed: 1, turret_yaw: 0 });
    assert.notEqual(result.outcome, 'miss', `visible glacis at y=${y} must stop or resolve the shot`);
    assert.ok(result.layers.length > 0, 'visible armour must produce a combat layer');
  }
});

test('custom Hetzer turret conversion is selectable without replacing historical vehicles', async () => {
  const data = loadData();
  const id = 'de_hetzer_sdkfz1401';
  assert.ok(data.order.includes(id), 'new variant must be in the playable registry');
  for (const old of ['de_hetzer', 'de_hetzer_mk103', 'de_hetzer_mk103_camo', 'de_sdkfz140_1']) {
    assert.ok(data.vehicles[old], `${old} must remain available`);
  }
  assert.ok(FAMILIES.find(f => f.key === 'de_hetzer').variants.some(v => v.id === id));
  const bundle = data.vehicles[id];
  assert.ok(!bundle.armor.some(p => p.hinge), 'custom turret must not inherit the MK103 folding armor');
  for (const key of ['depression_by_bearing_deg', 'folded_depression_by_bearing_deg',
    'fold_depression_stages', 'fold_yaw_limit_stages', 'folded_yaw_limit_deg']) {
    assert.equal(bundle.weapons[key], undefined, `custom turret must not inherit ${key}`);
  }
  assert.match(bundle.vehicle.meta.notes, /custom|hypothetical/i);
  assert.equal(bundle.weapons.main_gun.id, 'kwk38_20');
  assert.equal(bundle.weapons.secondary[0].weapon, 'mg42');
  assert.ok(Math.abs(bundle.weapons.secondary[0].position_m[2] - 1.0977) < 0.002,
    'MG42 shot origin must match the source barrel tip');
  const pv = bundle.vehicle.turret.position_m;
  for (const c of bundle.crew.filter(c => c.role !== 'driver')) {
    assert.ok(c.pos.y > pv[1] - 0.12, `${c.role} must attach to the turret`);
    assert.ok(Math.hypot(c.pos.x - pv[0], c.pos.z - pv[2]) < 0.55 * Math.max(...bundle.vehicle.turret.size_m));
  }
  assert.ok(bundle.armor.some(p => p.id === 'turret_front'), 'transplanted turret must have combat armour');
  const model = await decodeImported(bundle.model);
  assert.deepEqual(bundle.visual.exhaust.outlets, [{ pos: [.7481, 1.27, -2.434], dir: [0, 0, -1] }],
    'exhaust must use the measured single tailpipe');
  const outlet = bundle.visual.exhaust.outlets[0].pos;
  let pipeDistance = Infinity;
  for (const p of model.parts.filter(p => p.mount === 'hull')) {
    for (let i = 0; i < p.pos.length; i += 3) {
      pipeDistance = Math.min(pipeDistance, Math.hypot(...outlet.map((v, k) => v - p.pos[i + k] / 1000)));
    }
  }
  assert.ok(pipeDistance < .045, 'single outlet must touch the source tailpipe lip');
  for (const mount of ['hull', 'turret', 'gun', 'barrel']) {
    assert.ok(model.parts.some(p => p.mount === mount), `${mount} must have imported geometry`);
  }
  const wheelKeys = new Set(model.parts.filter(p => p.mount === 'road_wheel').map(p => `${p.side}:${p.index}`));
  assert.equal(wheelKeys.size, 8, 'all eight road wheels must follow suspension rather than the hull');
  for (const p of model.parts) {
    for (const i of p.idx) assert.ok(i < p.vertices, 'all triangle indices must address actual vertices');
  }
  const barrel = model.parts.filter(p => p.mount === 'barrel');
  const trunnion = bundle.weapons.mount_m;
  const muzzleZ = trunnion[2] + bundle.weapons.muzzle_offset_m;
  const end = Math.max(...barrel.map(p => p.hi[2]));
  assert.ok(Math.abs(end - muzzleZ) < 0.04, 'simulated muzzle must match imported barrel end');
  const points = barrel.flatMap(p => {
    const out = [];
    for (let i = 0; i < p.pos.length; i += 3) if (p.pos[i + 2] / 1000 > end - 0.025) out.push([p.pos[i] / 1000, p.pos[i + 1] / 1000]);
    return out;
  });
  assert.ok(points.length > 0);
  const center = [0, 1].map(k => points.reduce((s, p) => s + p[k], 0) / points.length);
  assert.ok(Math.abs(center[0] - trunnion[0]) < 0.035, 'barrel axis must align horizontally');
  assert.ok(Math.abs(center[1] - trunnion[1]) < 0.035, 'the baked 25 degree display elevation must be removed');
});
