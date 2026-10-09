import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadData } from '../tools/load-data.mjs';
import { runtimeParts, surfaceCrossings, touches } from '../tools/procedural-fleet-audit.mjs';
import { stationsOf, buildLoop } from '../src/gfx/track.js';
import { transformPoint } from '../src/gfx/math.js';
import { slewMount } from '../src/sim/mg.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixture = JSON.parse(execFileSync('python', ['-c', `
import copy, json, sys
sys.path.insert(0, 'tools')
import gen_vehicles as g
from procedural_hull_details import apply_flak38t_fold_clearance, apply_is2_hull_mg, apply_rso_drive_roles
out = {}
for builder, repair in [(g.flak38t, apply_flak38t_fold_clearance), (g.is2, apply_is2_hull_mg), (g.rso_flak, apply_rso_drive_roles), (g.rso_pak40, apply_rso_drive_roles)]:
    source = builder()
    repaired = repair(copy.deepcopy(source))
    out[source['id']] = {'original': source, 'repaired': repaired}
print(json.dumps(out))
`], { cwd: root, encoding: 'utf8' }));

function dataFor(id, state) {
  const data = loadData(), spec = fixture[id][state], bundle = data.vehicles[id];
  bundle.visual.parts = spec.parts;
  bundle.visual.running_gear = spec.running_gear;
  bundle.weapons.secondary = spec.secondary;
  return data;
}

const distanceToHinge = (point, hinge) => {
  const d = hinge.b.map((v, k) => v - hinge.a[k]);
  const t = Math.max(0, Math.min(1, d.reduce((n, v, k) => n + v * (point[k] - hinge.a[k]), 0) / d.reduce((n, v) => n + v * v, 0)));
  return Math.hypot(...point.map((v, k) => v - hinge.a[k] - d[k] * t));
};

test('Flak38(t): the original front board reproduces the engine-deck collision', () => {
  const runtime = runtimeParts('de_flakpz38t', dataFor('de_flakpz38t', 'original'));
  const pieces = runtime.at({ fold: .75 });
  assert.ok(surfaceCrossings(pieces[10], pieces[34]).count > 0);
});

test('Flak38(t): all eight boards clear fixed hull fittings throughout the fold sweep except their intended hinge joins', () => {
  const runtime = runtimeParts('de_flakpz38t', dataFor('de_flakpz38t', 'repaired'));
  assert.equal(runtime.records.filter(p => p.part.hinge).length, 8);
  for (let step = 0; step <= 100; step++) {
    const pieces = runtime.at({ fold: step / 100 });
    for (const board of pieces.filter(p => p.part.hinge)) {
      for (const fixed of pieces.filter(p => p.group === 'hull' && !p.part.hinge)) {
        const hits = surfaceCrossings(board, fixed, 1000);
        const offHinge = hits.points.filter(p => distanceToHinge(p, board.part.hinge) > .032);
        assert.equal(offHinge.length, 0, `fold ${step}% ${board.id} crosses ${fixed.id}: ${JSON.stringify(offHinge)}`);
      }
    }
  }
  assert.ok(runtime.maxRuntimeError < 1e-6, `runtime mapping error ${runtime.maxRuntimeError}`);
});

test('Flak38(t): moved antenna and rear can retain real hull attachments', () => {
  const runtime = runtimeParts('de_flakpz38t', dataFor('de_flakpz38t', 'repaired'));
  const pieces = runtime.at(), named = name => pieces.find(p => p.part.name === name);
  const base = named('flak38t_antenna_base'), antenna = named('flak38t_antenna');
  const bracket = named('flak38t_rear_can_bracket'), can = named('flak38t_rear_can');
  assert.ok(touches(antenna, base));
  assert.ok(touches(base, pieces[0]));
  assert.ok(touches(can, bracket));
  assert.ok(touches(bracket, pieces[0]), 'rear bracket joins the lower hull');
});

test('Flak38(t): separate front stop does not create board-to-board penetration during folding', () => {
  const runtime = runtimeParts('de_flakpz38t', dataFor('de_flakpz38t', 'repaired'));
  const distanceToOutline = (point, board) => {
    const record = runtime.records.find(p => p.id === board.id);
    const corners = board.part.vertices.slice(0, 4).map(v => transformPoint(record.node.world, v.map((n, k) => n - board.part.hinge.a[k])));
    return Math.min(...corners.map((a, k) => distanceToHinge(point, { a, b: corners[(k + 1) % 4] })));
  };
  for (let step = 0; step <= 100; step++) {
    const boards = runtime.at({ fold: step / 100 }).filter(p => p.part.hinge);
    for (let i = 0; i < boards.length; i++) for (let j = i + 1; j < boards.length; j++) {
      const hits = surfaceCrossings(boards[i], boards[j], 1000);
      // Raised panels have designed 10mm miter joins along their shared seams.
      const offSeam = hits.points.filter(p => distanceToOutline(p, boards[i]) > .012 || distanceToOutline(p, boards[j]) > .012);
      assert.equal(offSeam.length, 0, `fold ${step}% ${boards[i].id} crosses ${boards[j].id}: ${JSON.stringify(offSeam)}`);
    }
  }
});

test('IS-2: fixed DT mouth is beside the right turret-ring shoulder, attached to the hull and agrees with the firing point', () => {
  const spec = fixture.su_is2.repaired;
  const barrel = spec.parts.find(p => p.name === 'is2_shoulder_dt_barrel');
  assert.ok(barrel, 'a named shoulder barrel replaces the central-glacis DT');
  const mg = spec.secondary.find(m => m.id === 'bow_dt');
  assert.ok(mg.position_m[0] > 1.2 && mg.position_m[0] < 1.5);
  assert.ok(mg.position_m[2] < spec.turret_pos[2] + spec.ring / 2);
  assert.deepEqual(mg.arc_deg, [2, 2, 2]);
  const mouthZ = Math.max(...barrel.vertices.map(v => v[2]));
  const mouthRim = barrel.vertices.filter(v => v[2] === mouthZ);
  const mouthCenter = [0, 1].map(k => Number((mouthRim.reduce((n, v) => n + v[k], 0) / mouthRim.length).toFixed(4)));
  // main.layMg treats a hull gun's data point as its pivot and adds .30m.
  assert.deepEqual([mg.position_m[0], mg.position_m[1], Number((mg.position_m[2] + .3).toFixed(4))], [...mouthCenter, mouthZ]);
  const runtime = runtimeParts('su_is2', dataFor('su_is2', 'repaired'));
  const mount = runtime.loadout.machineGuns.find(m => m.id === 'bow_dt');
  for (const sign of [-1, 1]) {
    const aim = { yaw: 0, pitch: 0 };
    slewMount(aim, { yaw: sign, pitch: sign }, mount.arc, 10, 1);
    assert.ok(Math.abs(aim.yaw - sign * 2 * Math.PI / 180) < 1e-9);
    assert.ok(Math.abs(aim.pitch - sign * 2 * Math.PI / 180) < 1e-9);
  }
  const pieces = runtime.at();
  const mouth = pieces.find(p => p.part.name === barrel.name);
  assert.ok(pieces.some(p => p.group === 'hull' && p !== mouth && touches(mouth, p)), 'barrel remains physically attached');
  assert.equal(surfaceCrossings(mouth, pieces[1]).count, 0, 'the short external barrel clears the sloped shoulder surface');
  const opening = pieces.find(p => p.part.name === 'is2_shoulder_dt_opening');
  assert.ok(touches(opening, pieces[1]), 'the bounded opening stays embedded in the shoulder');
});

for (const id of ['de_rso_flak', 'de_rso_pak40']) test(`${id}: rear axle drives, front tensioner keeps teeth, all axle positions and track footprint are retained`, () => {
  const { original, repaired } = fixture[id], rg = repaired.running_gear;
  assert.ok(rg.sprocket.z < rg.idler.z);
  assert.equal(rg.idler.teeth, original.running_gear.sprocket.teeth);
  assert.deepEqual([rg.sprocket.z, rg.sprocket.y, rg.sprocket.r], [original.running_gear.idler.z, original.running_gear.idler.y, original.running_gear.idler.r]);
  assert.deepEqual([rg.idler.z, rg.idler.y, rg.idler.r], [original.running_gear.sprocket.z, original.running_gear.sprocket.y, original.running_gear.sprocket.r]);
  assert.deepEqual(rg.wheels, original.running_gear.wheels);
  assert.deepEqual(repaired.parts, original.parts);
  const before = buildLoop(original.running_gear, stationsOf(original.running_gear), null, original.running_gear.track_sag);
  const after = buildLoop(rg, stationsOf(rg), null, rg.track_sag);
  assert.deepEqual(after.front, before.front);
  assert.deepEqual(after.rear, before.rear);
  assert.deepEqual(after.pts, before.pts);
  const runtime = runtimeParts(id, dataFor(id, 'repaired'));
  for (const wheel of runtime.model.wheels.filter(w => w.role === 'idler')) {
    assert.ok(wheel.node.children.some(n => n.name === 'idler_teeth' && n.mesh?.count > 0), 'the front toothed tensioner keeps its physical tooth ring');
  }
});
