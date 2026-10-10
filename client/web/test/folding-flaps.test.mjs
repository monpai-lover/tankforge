import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/load-data.mjs';
import { decodeAllImported } from '../src/gfx/imported.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { makeLoadout, generatedTurretParts } from '../src/game/loadout.js';
import { STRIDE } from '../src/gfx/geo.js';
import { transformPoint } from '../src/gfx/math.js';
import fs from 'node:fs';
import { Combat, bulletShell } from '../src/game/combat.js';
import { loadCoreSync } from '../src/design/core.js';

const data = loadData();
await decodeAllImported(data.vehicles);
const renderer = { mesh: v => ({ vertices: v }), instancedMesh: v => ({ vertices: v }),
  setInstances() {}, texture: () => null, disposeMesh() {} };
const ids = ['su_att_m46', 'de_hetzer_mk103', 'de_hetzer_mk103_camo'];

test('M46 cab and bed boards and both MK103 casemates retain source meshes on separate folding hinges', () => {
  for (const id of ids) {
    const b = data.vehicles[id];
    const model = buildTank(renderer, makeLoadout(id, b, data.projectiles), generatedTurretParts);
    assert.equal(model.hasFlaps, true, `${id} supports the existing I-key folding control`);
    const parts = b.imported.parts.filter(p => p.hinge);
    assert.equal(new Set(parts.map(p => JSON.stringify(p.hinge))).size, id === 'su_att_m46' ? 6 : 7);
    assert.ok(parts.every(p => p.mount === 'hull'), 'folding bed/casemate panels remain mounted on the hull');
    const flaps = model.body.children.filter(n => n.name === 'imported_flap');
    assert.equal(flaps.length, id === 'su_att_m46' ? 6 : 7);
    model.root.update();
    const gun = Array.from(model.turrets[0].guns[0].node.world);
    const raised = flaps.map(n => Array.from(n.world));
    model.setFold(1);
    model.root.update();
    assert.ok(flaps.every((n, i) => JSON.stringify(Array.from(n.world)) !== JSON.stringify(raised[i])));
    assert.deepEqual(Array.from(model.turrets[0].guns[0].node.world), gun, 'folding the sides never rotates the gun or its narrow shield');
    assert.ok(b.armor.filter(p => p.hinge).length >= (id === 'su_att_m46' ? 6 : 7), 'every visual panel has real moving combat armour');
  }
});

test('the complete tall M46 cab side walls become horizontal with their edge frames and fittings', () => {
  const b = data.vehicles.su_att_m46;
  const panels = b.imported.parts.filter(p => p.source_node?.startsWith('cab_side_'));
  assert.equal(panels.reduce((n, p) => n + p.triangles, 0), 2352, 'both complete original high side assemblies move');
  assert.ok(panels.some(p => p.hi[1] > 2.65 && p.hi[2] > 1), 'the original visible high forward walls are included');
  const model = buildTank(renderer, makeLoadout('su_att_m46', b, data.projectiles), generatedTurretParts);
  model.setFold(1);
  model.root.update();
  const cabFlaps = model.body.children.filter(n => n.name === 'imported_flap' && Math.abs(n.world[12]) < 1.26);
  assert.equal(cabFlaps.length, 2);
  for (const flap of cabFlaps) for (const child of flap.children) {
    const vertices = child.mesh.vertices;
    for (let i = 0; i < vertices.length; i += STRIDE) {
      assert.ok(transformPoint(child.world, [vertices[i], vertices[i + 1], vertices[i + 2]])[1] < 1.60,
        'no part of the tall cab wall remains upright after the real hinge transform');
    }
  }
});

test('fold stages describe the actual safe firing arc throughout the movement', () => {
  for (const id of ids) {
    const w = data.vehicles[id].weapons;
    assert.ok(Array.isArray(w.depression_by_bearing_deg), `${id} has a raised firing-arc table`);
    assert.ok(Array.isArray(w.folded_depression_by_bearing_deg), `${id} has a folded firing-arc table`);
    assert.equal(w.depression_by_bearing_deg.length, 36);
    assert.equal(w.folded_depression_by_bearing_deg.length, 36);
    assert.deepEqual(w.fold_depression_stages.map(s => s.fold), [0, .25, .5, .75, 1]);
    assert.ok(w.fold_depression_stages.every(s => s.angles.length === 36 && s.angles.every(Number.isFinite)));
    if (id !== 'su_att_m46') assert.ok(w.folded_depression_by_bearing_deg.some((v, i) => v > w.depression_by_bearing_deg[i]), `${id} gains a useful firing arc after folding`);
    if (id === 'su_att_m46') {
      assert.ok(w.folded_yaw_limit_deg[1] > w.yaw_limit_deg[1]);
      assert.deepEqual(w.fold_yaw_limit_stages.map(s => s.fold), [0, .25, .5, .75, 1]);
    }
  }
});

test('M46 removes the front shovel and its keeper frame from the playable model and retains the narrow gun shield', () => {
  const b = data.vehicles.su_att_m46;
  const tool = b.imported.parts.filter(p => p.source_node === 'front_stowed_tool');
  assert.equal(tool.length, 0, 'the shovel and frame must be absent, including the old right-front storage position');
  assert.equal(b.imported.parts.reduce((n,p)=>n+p.triangles,0),159825,
    'remove precisely the 2,636 original shovel/frame/chain triangles');
  for (const p of b.armor.filter(p => p.id === 'turret_side_r' || p.id === 'turret_side_l')) {
    assert.ok(p.half_u <= .2 && p.center.z >= -.4, 'the narrow gun shield does not protect the open rear bed');
    assert.equal(p.thickness_mm, 1);
  }
});

test('real M46 cab-side fire loses the cab armor layer when the complete side wall is folded', () => {
  const core = loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm', import.meta.url)),
    { materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains) });
  const combat = new Combat(core);
  const state = combat.fresh('m46-cab', data.vehicles.su_att_m46).state;
  const shot = { shell: bulletShell(data.machineGuns.mg34), origin: [4, 1.95, .55], dir: [-1, 0, 0],
    speed_ms: 800, distance_m: 0, seed: 1, turret_yaw: 0 };
  const raised = combat.shoot('m46-cab', state, shot);
  assert.ok(raised.layers.some(p => p.plate === 'folding_cab_side_right'));
  combat.setFold('m46-cab', 1);
  const lowered = combat.shoot('m46-cab', state, shot);
  assert.equal(lowered.layers.length, 0, 'lowered cab walls cannot retain any invisible raised side armor');
  assert.ok(lowered.crew.length > 0);
});
