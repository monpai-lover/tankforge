import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadData } from '../tools/load-data.mjs';
import { runtimeParts, surfaceCrossings, touches, makePiece } from '../tools/procedural-fleet-audit.mjs';
import { foldYawLimit, foldDepression, foldedPlate } from '../src/game/folding.js';
import { buildToBundle, newTurretSpec, exportFolder } from '../src/game/loadout.js';
import { buildInterior } from '../src/gfx/interior.js';
import { transformPoint } from '../src/gfx/math.js';
import { STRIDE } from '../src/gfx/geo.js';
import { targetDef } from '../src/game/combat.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'), DEG = Math.PI / 180;
const fixture = JSON.parse(execFileSync('python', ['-c', `
import copy,json,sys
sys.path.insert(0,'tools')
import gen_vehicles as g
from procedural_hull_details import apply_rso_pak40_firing_config, apply_rso_drive_roles
source = apply_rso_drive_roles(g.rso_pak40())
print(json.dumps({'original':source,'repaired':apply_rso_pak40_firing_config(copy.deepcopy(source))}))
`], { cwd: root, encoding: 'utf8' }));

function dataFor(state) {
  const data = loadData(), spec = fixture[state], b = data.vehicles.de_rso_pak40;
  b.visual.parts = spec.parts;
  b.visual.running_gear = spec.running_gear;
  for (const key of ['depression_by_bearing_deg', 'folded_depression_by_bearing_deg', 'fold_depression_stages', 'fold_yaw_limit_stages', 'folded_yaw_limit_deg']) {
    if (spec[key]) b.weapons[key] = spec[key];
  }
  b.armor = spec.plates;
  b.modules = spec.modules;
  b.crew = spec.crew;
  return data;
}
const runtime = state => runtimeParts('de_rso_pak40', dataFor(state));
function worldPiece(name, node) {
  const local = makePiece(name, node.mesh.data);
  return makePiece(name, local.tris.map(t => t.map(p => transformPoint(node.world, p))), true);
}

function allMovingClear(pieces, message) {
  for (const moving of pieces.filter(p => p.part.mount === 'gun' || p.part.mount === 'turret')) {
    for (const hull of pieces.filter(p => p.group === 'hull')) {
      assert.equal(surfaceCrossings(moving, hull).count, 0, `${message}: ${moving.id} crosses ${hull.id}`);
    }
  }
}

test('RSO PaK40/4: original raised ammo boxes reproduce a forbidden breech collision at full firing traverse', () => {
  const pieces = runtime('original').at({ yaw: 60 * DEG, pitch: 22 * DEG });
  assert.ok(surfaceCrossings(pieces[36], pieces[43]).count > 0);
});

test('RSO PaK40/4: original cab envelope now contains two real wells and independent covers, without relocating the gun, crew or track', () => {
  const spec = fixture.repaired;
  assert.ok(spec.parts.find(p => p.name === 'rso_pak40_open_cab'));
  assert.equal(spec.parts.filter(p => p.name?.startsWith('rso_pak40_driving_lid_')).length, 2);
  assert.deepEqual(spec.parts.filter(p => ['gun', 'turret'].includes(p.mount)), fixture.original.parts.filter(p => ['gun', 'turret'].includes(p.mount)));
  for (const key of ['crew', 'running_gear', 'mount', 'muzzle_offset', 'gun']) assert.deepEqual(spec[key], fixture.original[key]);
  const ammo = spec.parts.find(p => p.name === 'rso_pak40_floor_ammo_lids');
  assert.ok(ammo.pos[1] + ammo.size[1] / 2 <= 1, 'lockers are flush with the bed floor');
  assert.ok(!spec.plates.some(p => p.id === 'cab_roof'), 'a continuous plate must not falsely seal both openings');
  assert.equal(spec.plates.filter(p => p.hinge).length, 2);
  for (const p of spec.plates.filter(p => p.id.startsWith('cab_roof_cell_') || p.hinge)) {
    assert.equal(p.material, 'skirt');
    assert.equal(p.thickness_mm, 3);
  }
  for (const lid of spec.parts.filter(p => p.hinge)) {
    const x = lid.pos[0], z = lid.pos[2];
    const coverCells = spec.plates.filter(p => p.id.startsWith('cab_roof_cell_') || p.hinge);
    const coversPoint = p => Math.abs(p.center.x - x) < p.half_u - 1e-5 && Math.abs(p.center.z - z) < p.half_v - 1e-5;
    assert.ok(coverCells.some(coversPoint), 'closed well is protected by its own lid');
    assert.ok(!coverCells.map(p => foldedPlate(p, 1)).some(coversPoint), 'full-open well has no false stationary armor roof');
  }
});

test('RSO PaK40/4: native stage contract stays +/-30 parked, holds +/-0.05 during lid motion including 0.99, and opens 360 only when fully open', () => {
  const t = runtime('repaired').loadout.turrets[0];
  assert.deepEqual(foldYawLimit(t, 0).map(v => Math.round(v / DEG)), [-30, 30]);
  for (const fold of [.001, .1, .25, .49, .5, .51, .75, .99, .999]) assert.deepEqual(foldYawLimit(t, fold), [-.05 * DEG, .05 * DEG], `fold ${fold}`);
  assert.deepEqual(foldYawLimit(t, 1).map(v => Math.round(v / DEG)), [-180, 180]);
});

test('RSO PaK40/4: full-open gun and shield clear the hull at 360 bearings, remapped legal depression, full elevation and full recoil', () => {
  const rt = runtime('repaired'), t = rt.loadout.turrets[0];
  for (let yaw = 0; yaw < 360; yaw++) {
    const depression = foldDepression(t, yaw * DEG, 5, 1);
    for (const pitch of [0, -depression, 22]) for (const recoil of [0, .5, 1]) {
      allMovingClear(rt.at({ yaw: yaw * DEG, pitch: pitch * DEG, recoil, fold: 1 }), `yaw ${yaw} pitch ${pitch} recoil ${recoil}`);
    }
  }
  assert.ok(rt.maxRuntimeError < 1e-6);
});

test('RSO PaK40/4: covers clear fixed cab and the +/-0.05 gun throughout 101 fold states, retain hinges, and move their armor cells', () => {
  const rt = runtime('repaired'), t = rt.loadout.turrets[0];
  const distanceSegment = (p, h) => {
    const d = h.b.map((v, k) => v - h.a[k]);
    const f = Math.max(0, Math.min(1, d.reduce((s, v, k) => s + v * (p[k] - h.a[k]), 0) / d.reduce((s, v) => s + v * v, 0)));
    return Math.hypot(...p.map((v, k) => v - h.a[k] - f * d[k]));
  };
  for (let step = 0; step <= 100; step++) {
    const fold = step / 100, pieces = rt.at({ fold }), lids = pieces.filter(p => p.part.hinge);
    assert.equal(lids.length, 2);
    for (const lid of lids) for (const fixed of pieces.filter(p => p.group === 'hull' && !p.part.hinge)) {
      const offHinge = surfaceCrossings(lid, fixed, 1000).points.filter(p => distanceSegment(p, lid.part.hinge) > .016);
      assert.equal(offHinge.length, 0, `fold ${fold}: ${lid.id}/${fixed.id}`);
    }
    for (const yaw of [-.05, 0, .05]) for (const pitch of [0, -foldDepression(t, yaw * DEG, 5, fold), 22]) for (const recoil of [0, .5, 1]) {
      allMovingClear(rt.at({ fold, yaw: yaw * DEG, pitch: pitch * DEG, recoil }), `fold ${fold}, yaw ${yaw}, pitch ${pitch}, recoil ${recoil}`);
    }
  }
  const closed = rt.at(), cab = closed.find(p => p.part.name === 'rso_pak40_open_cab');
  for (const lid of closed.filter(p => p.part.hinge)) assert.ok(touches(lid, cab), 'closed lid retains its hinge attachment');
  const ammoLids = closed.find(p => p.part.name === 'rso_pak40_floor_ammo_lids');
  assert.ok(touches(ammoLids, closed[13]), 'floor lockers remain supported by the original bed floor');
  for (const yaw of [-30, -20, -10, 0, 10, 20, 30]) for (const pitch of [0, -foldDepression(t, yaw * DEG, 5, 0), 22]) {
    for (const recoil of [0, .5, 1]) allMovingClear(rt.at({ yaw: yaw * DEG, pitch: pitch * DEG, recoil }), `parked yaw ${yaw} pitch ${pitch} recoil ${recoil}`);
  }
  for (const p of fixture.repaired.plates.filter(p => p.hinge)) {
    assert.notDeepEqual(foldedPlate(p, .99).center, p.center);
    assert.notDeepEqual(foldedPlate(p, 1).center, p.center);
  }
});

test('RSO PaK40/4: workshop replacement retains open wells, movable covers and their hull armor cells', () => {
  const data = dataFor('repaired'), base = data.vehicles.de_rso_pak40;
  const build = { base: 'de_rso_pak40', keepStock: false, turrets: [newTurretSpec(-.85)] };
  const custom = buildToBundle(build, data, 'custom_rso_pak40');
  const cabinParts = base.visual.parts.filter(p => p.name?.startsWith('rso_pak40_'));
  for (const part of cabinParts) assert.ok(custom.bundle.visual.parts.some(p => p.name === part.name && JSON.stringify(p) === JSON.stringify(part)), part.name);
  const customData = { ...data, projectiles: { ...data.projectiles, ...custom.projectiles }, vehicles: { ...data.vehicles, custom_rso_pak40: custom.bundle } };
  const rt = runtimeParts('custom_rso_pak40', customData);
  assert.equal(rt.model.hasFlaps, true);
  const closed = rt.at(), opened = rt.at({ fold: 1 });
  for (const lid of closed.filter(p => p.part.hinge)) {
    const moved = opened.find(p => p.id === lid.id);
    assert.notDeepEqual(moved.lo, lid.lo, 'I still moves each retained cover');
  }
  const exported = exportFolder(build, data, { armor: base.armor, modules: base.modules, crew: base.crew }, 'exported_rso', 'RSO replacement');
  for (const p of base.armor.filter(p => p.id.startsWith('cab_roof_cell_') || p.hinge)) {
    assert.ok(exported.files['armor.json'].some(q => q.id === p.id && JSON.stringify(q) === JSON.stringify(p)), p.id);
  }
});

test('RSO PaK40/4: actual interior ammo clears both driven-wheel bodies and teeth, road wheels and the fuel mesh', () => {
  const rt = runtime('repaired');
  const target = targetDef('rso-floor-storage', dataFor('repaired').vehicles.de_rso_pak40);
  for (const id of ['ammo_l', 'ammo_r']) {
    const module = target.modules.find(m => m.id === id);
    assert.ok(module.center.y <= target.turret.pivot.y - .12, `${id} stays below the authoritative Rust turret-mount threshold`);
    assert.deepEqual(module.center, fixture.repaired.modules.find(m => m.id === id).center, 'authoritative target receives the same fixed-hull storage center');
  }
  const renderer = { mesh: data => ({ data, count: data.length / STRIDE }), freeMesh() {} };
  const inside = buildInterior(renderer, rt.model, rt.loadout, fixture.repaired.modules, []);
  for (const id of ['ammo_l', 'ammo_r']) {
    for (const n of inside.byModule.get(id)) assert.ok(rt.model.body.children.includes(n), `${id} remains a hull-mounted floor rack`);
  }
  const basePieces = rt.at();
  const ammoBefore = new Map();
  for (const id of ['ammo_l', 'ammo_r']) for (const n of inside.byModule.get(id)) {
    const ammo = worldPiece(id, n);
    assert.ok(touches(ammo, basePieces[1]), `${id} is supported inside the original full-width chassis frame`);
    ammoBefore.set(id, { lo: ammo.lo, hi: ammo.hi });
  }
  for (const yaw of [Math.PI / 2, Math.PI, -Math.PI / 2]) {
    rt.at({ yaw, pitch: 22 * DEG, fold: 1 });
    for (const id of ['ammo_l', 'ammo_r']) for (const n of inside.byModule.get(id)) {
      const ammo = worldPiece(id, n);
      assert.deepEqual({ lo: ammo.lo, hi: ammo.hi }, ammoBefore.get(id), `${id} remains stationary when the PaK traverses`);
    }
  }
  rt.at();
  assert.ok(rt.model.wheels.filter(w => w.role === 'sprocket').every(w => w.node.pos[2] < 0), 'this regression checks the corrected rear drive');
  const statics = [];
  for (const w of rt.model.wheels) {
    statics.push({ name: `${w.side}:${w.role}`, node: w.node });
    for (const child of w.node.children.filter(n => n.mesh)) statics.push({ name: `${w.side}:${child.name}`, node: child });
  }
  statics.push({ name: 'fuel', node: inside.byModule.get('fuel_tank')[0] });
  for (const lift of [0, .04, .12]) for (const travel of [0, .03, .07, .13, .2, -.11]) {
    const level = rt.model.stations.map(() => lift);
    rt.model.updateRunningGear({ lifts: { 1: level, [-1]: level }, travel: { 1: travel, [-1]: -travel } });
    rt.model.root.update();
    for (const name of ['ammo_l', 'ammo_r']) for (const node of inside.byModule.get(name)) {
      const ammo = worldPiece(name, node);
      for (const part of statics) assert.equal(surfaceCrossings(ammo, worldPiece(part.name, part.node)).count, 0, `${name} crosses ${part.name}, lift=${lift} travel=${travel}`);
    }
  }
  inside.dispose();
  rt.model.dispose();
});
