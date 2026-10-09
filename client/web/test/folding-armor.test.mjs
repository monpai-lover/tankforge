import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { foldedPlate, smoothFold, foldDepression, foldYawLimit } from '../src/game/folding.js';

test('partly folded boards retain the conservative intersection of adjacent safe stages', () => {
  const t = { depByYaw: Array(36).fill(0), limit: [-.4, .4],
    foldDepStages: [{ fold: 0, angles: Array(36).fill(0) }, { fold: .5, angles: Array(36).fill(2) }, { fold: 1, angles: Array(36).fill(10) }],
    foldYawStages: [{ fold: 0, limits: [-25, 25] }, { fold: .5, limits: [-40, 40] }, { fold: 1, limits: [-90, 90] }] };
  assert.equal(foldDepression(t, 0, 10, .75), 2);
  assert.equal(foldDepression(t, 0, 10, 1), 10);
  assert.ok(Math.abs(foldYawLimit(t, .75)[1] - 40 * Math.PI / 180) < 1e-8);
  assert.ok(Math.abs(foldYawLimit(t, 1)[1] - Math.PI / 2) < 1e-8);
});
import { Combat, bulletShell, targetDef } from '../src/game/combat.js';
import { loadCoreSync } from '../src/design/core.js';
import { loadData } from '../tools/load-data.mjs';

const plate = { id: 'folding_side', zone: 'hull_side', material: 'rha', thickness_mm: 20,
  center: { x: 1, y: 1.5, z: 0 }, normal: { x: 1, y: 0, z: 0 }, axis_u: { x: 0, y: 0, z: 1 },
  half_u: .5, half_v: .5, hinge: { a: [1, 1, 0], b: [1, 1, 1], angle: -90 } };

test('folding armor rotates the physical plane around the same hinge as the mesh', () => {
  const p = foldedPlate(plate, 1);
  assert.ok(Math.abs(p.center.x - 1.5) < 1e-8 && Math.abs(p.center.y - 1) < 1e-8);
  assert.ok(Math.abs(p.normal.x) < 1e-8 && Math.abs(p.normal.y + 1) < 1e-8);
  assert.deepEqual(p.axis_u, plate.axis_u);
  assert.equal(p.thickness_mm, 20);
  assert.equal(plate.center.y, 1.5, 'source pose must remain immutable');
  assert.equal(smoothFold(0), 0); assert.equal(smoothFold(1), 1); assert.equal(smoothFold(.5), .5);
});

test('real combat stops a bullet at a raised board but reaches exposed crew after it is folded', () => {
  const data = loadData();
  const core = loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm', import.meta.url)),
    { materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains) });
  const combat = new Combat(core);
  const bundle = { vehicle: { turret: { ring_diameter_m: 0, open_top: true } }, armor: [plate], modules: [],
    crew: [{ role: 'gunner', pos: { x: 0, y: 1.5, z: 0 }, radius: .25 }], weapons: {} };
  const shot = { shell: bulletShell(data.machineGuns.mg34), origin: [4, 1.5, 0], dir: [-1, 0, 0],
    speed_ms: 800, distance_m: 0, seed: 1, turret_yaw: 0 };
  const initial = combat.fresh('hinge-test', bundle).state;
  combat.setFold('pre-folded', 1);
  const preFolded = combat.fresh('pre-folded', bundle).state;
  assert.ok(combat.shoot('pre-folded', preFolded, shot).crew.length > 0,
    'folding in the garage before first combat registration must retain its physical pose');
  const raised = combat.shoot('hinge-test', initial, shot);
  assert.ok(raised.layers.length > 0);
  assert.equal(raised.crew.length, 0);
  combat.setFold('hinge-test', 1);
  const lowered = combat.shoot('hinge-test', initial, shot);
  assert.ok(lowered.crew.length > 0, 'horizontal board cannot retain invisible vertical protection');
  assert.equal(targetDef('hinge-test', bundle, 1).plates[0].hinge, undefined, 'the core receives a resolved plane');
  combat.setFold('hinge-test', 0);
  assert.equal(combat.shoot('hinge-test', initial, shot).crew.length, 0, 'raising restores protection');
});
