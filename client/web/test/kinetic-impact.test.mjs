import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCoreSync } from '../src/design/core.js';
import { loadData } from '../tools/load-data.mjs';
import { newDesign } from '../src/design/templates.js';

const data = loadData();
const catalog = structuredClone(data.designCatalog);
catalog.penetration.sigma_fraction = 0;
const core = loadCoreSync(fs.readFileSync(process.env.TG_TEST_WASM || new URL('../assets/tg_design.wasm', import.meta.url)),
  { materials: data.materials, catalog, terrains: Object.values(data.terrains) });
const shell = { id: 'p1_synthetic', name: 'P1 synthetic', kind: 'ap', caliber_mm: 10, mass_kg: .1, muzzle_velocity_ms: 100,
  explosive_mass_kg: 0, explosive_type: 'none', penetrator_material: 'steel', length_mm: 100, drag_coefficient: 0,
  penetration_curve: [{ distance_m: 0, pen_mm: 150 }], ricochet_angle_deg: 89, normalization_deg: 0, shatter_angle_deg: 90, fuse_delay_s: 0, fuse_sensitivity_mm: 0 };
const plate = (id, z) => ({ id, zone: 'hull_side', material: 'rha', thickness_mm: 50, center: [0, 1, z], normal: [0, 0, -1], axis_u: [1, 0, 0], half_u: 1, half_v: 1, curvature: 0 });
function target(id, plates = [], modules = [], crew = []) {
  core.combatTarget({ id, plates, modules, crew, turret: null, open_top: false, ammo_capacity: 0 });
  return core.combatNew(id).state;
}
function fire(id, state, projectile = shell, speed_ms = 100) {
  const shot = { shell: structuredClone(projectile), origin: [0, 1, -2], dir: [0, 0, 1], speed_ms, distance_m: 0, seed: 1, turret_yaw: 0 };
  const probe = core.combatShoot(id, state, shot);
  shot.shell.penetration_curve[0].pen_mm *= 150 / probe.pen_mm;
  return core.combatShoot(id, state, shot);
}
function designBox() {
  const design = newDesign('blank', catalog);
  design.hull_geometry = { vertices: Array.from({ length: 8 }, (_, i) => [i & 1 ? 1 : -1, i & 2 ? 2 : 0, i & 4 ? 2 : -1]),
    faces: [[4, 5, 7, 6], [1, 0, 2, 3], [5, 1, 3, 7], [0, 4, 6, 2], [6, 7, 3, 2], [0, 1, 5, 4]].map((v, id) => ({ id, v, tag: '' })) };
  design.turret_geometry = null; design.turret_ring = null; design.gun_mount = null; design.weapons = null;
  design.internal_modules = []; design.crew_positions = []; design.addons = []; design.ammunition = [];
  design.armor_faces = [{ body: 'hull', face: 1, material: 'rha', thickness_mm: 50 }];
  design.armor_layers = [{ body: 'hull', face: 1, layers: [{ material: 'rha', thickness_mm: 50, spacing_mm: 100, angle_deg: 0 }] }];
  return design;
}
function ledger(b) {
  const sum = b.core_out_j + b.projectile_pieces_j + b.armour_debris_j + b.target_deposition_j + b.deformation_fracture_j + b.unresolved_loss_j;
  assert.ok(Object.values(b).every(v => Number.isFinite(v) && v >= 0));
  assert.ok(Math.abs(sum - b.input_j) <= 1e-5 * Math.max(1, b.input_j));
}

test('actual WASM combat and design carry the same two-physical-layer kinetic state', () => {
  const state = target('p1:plates', [plate('front', 0), plate('second', .2)]);
  const combat = fire('p1:plates', state);
  core.setDesign(designBox());
  const design = core.shoot({ shell, origin: [0, 1, -2], dir: [0, 0, 1], speed_ms: 100, distance_m: 0, seed: 1, path: [] });
  const kinetic = combat.impact_events.filter(e => e.verdict === 'passed');
  assert.equal(kinetic.length, 2);
  assert.equal(design.event.impact_events.filter(e => e.verdict === 'passed').length, 2);
  assert.ok(Math.abs(kinetic[1].budget.core_out_j - 500 * 2 / 3) < .001);
  assert.ok(Math.abs(kinetic[1].budget.core_out_j - design.event.impact_state.mass_kg *
    (design.event.impact_state.velocity_m_s.x ** 2 + design.event.impact_state.velocity_m_s.y ** 2 + design.event.impact_state.velocity_m_s.z ** 2) / 2) < .001);
  [...combat.impact_events, ...design.event.impact_events].forEach(e => ledger(e.budget));
  assert.deepEqual(fire('p1:plates', state), combat, 'same input/seed has stable local IDs and results');
});

test('actual WASM spall is allocated from plate work at its generating layer', () => {
  const projectile = { ...shell, caliber_mm: 75 };
  const state = target('p1:spall', [plate('front', 0), plate('second', .2)]);
  const report = fire('p1:spall', state, projectile);
  const impacts = report.impact_events.filter(e => e.verdict === 'passed');
  for (const event of impacts) {
    ledger(event.budget);
    assert.ok(Math.abs(event.budget.armour_debris_j - (event.budget.input_j - event.budget.core_out_j) * .3) < .001);
    const samples = new Map(report.fragments.filter(f => f.parent_event_id === event.event_id).map(f => [f.fragment_id, f]));
    const mass = [...samples.values()].reduce((n, f) => n + f.physical.mass_kg, 0);
    assert.ok(mass <= 7850 * .05 * Math.PI * (.075 / 2) ** 2);
    for (const sample of samples.values()) { assert.equal(sample.source, 'armour_spall'); assert.equal(sample.weight, 1); assert.ok(sample.from.z >= event.entry_position.z); }
  }
});

test('actual WASM module then two crew contacts consume only local deposition', () => {
  const module = { id: 'radio', kind: 'radio', center: [0, 1, 0], half_extents: [.05, .05, .05], max_health: .1, health: .1 };
  const crew = ['driver', 'gunner'].map((role, i) => ({ role, pos: [0, 1, .4 + i * .5], radius: .1, health: 100 }));
  const state = target('p1:serial', [], [module], crew);
  const r = fire('p1:serial', state);
  const contacts = r.impact_events.filter(e => e.verdict === 'deposited');
  assert.equal(contacts.length, 3);
  const absorptions = [3, 5, 5]; let e = 500, pen = 150;
  contacts.forEach((contact, i) => {
    ledger(contact.budget);
    const deposition = e * absorptions[i] / pen;
    assert.ok(Math.abs(contact.budget.target_deposition_j - deposition) < .001);
    assert.ok(Math.abs(contact.budget.input_j - e) < .001);
    e = contact.budget.core_out_j; pen -= absorptions[i];
  });
  assert.equal(r.state.modules[0], 0);
  assert.ok(r.state.crew.every(h => h > 90));
});

test('actual WASM zero kinetic energy cannot cross closed armour or place an APHE burst inside', () => {
  const state = target('p1:zero', [plate('front', 0)], [], [{ role: 'driver', pos: [0, 1, .5], radius: .1, health: 100 }]);
  for (const projectile of [shell, { ...shell, kind: 'aphe', explosive_mass_kg: .01, fuse_delay_s: .02 }]) {
    const r = fire('p1:zero', state, projectile, 0);
    assert.equal(r.layers[0].passed, false);
    assert.equal(r.impact_events[0].verdict, 'stopped');
    assert.equal(r.state.crew[0], 100);
    assert.equal(r.bursts.filter(b => b.inside).length, 0);
  }
});

test('actual WASM an unpenetrated main plate less than two centimetres behind an auxiliary layer blocks its spall', () => {
  const outer = { ...plate('outer', 0), zone: 'skirt', thickness_mm: 20 };
  const main = { ...plate('main', .03), thickness_mm: 200 };
  const state = target('p1:near', [outer, main], [], [{ role: 'driver', pos: [0, 1, .5], radius: .1, health: 100 }]);
  const r = fire('p1:near', state, { ...shell, caliber_mm: 75 });
  assert.equal(r.layers[0].passed, true);
  assert.equal(r.layers[1].passed, false);
  assert.equal(r.state.crew[0], 100);
  assert.ok(r.fragments.filter(f => f.source === 'armour_spall').every(f => f.to.z <= .030001));
});

test('actual WASM design carries the core through crew into thin and thick far walls', () => {
  for (const thickness of [50, 200]) {
    const d = designBox(); d.armor_layers = [];
    d.armor_faces.push({ body: 'hull', face: 0, material: 'rha', thickness_mm: thickness });
    d.crew_positions = [{ role: 'driver', mount: 'hull', position_m: [0, 1, 0] }];
    core.setDesign(d);
    const r = core.shoot({ shell, origin: [0, 1, -2], dir: [0, 0, 1], speed_ms: 100, distance_m: 0, seed: 1, path: [] });
    assert.equal(r.event.penetration_result, 'penetrated');
    const far = r.event.impact_events.find(e => e.layer_id.startsWith('hull:face:0/'));
    assert.ok(far, 'far armor is a real shared collision after interior damage');
    assert.ok(Math.abs(far.budget.input_j - (500 * 8 / 9) * .95) < .001);
    assert.ok(Math.abs(far.entry_position.z - (2 - thickness / 1000)) < 1e-6);
    assert.equal(far.verdict, thickness === 200 ? 'stopped' : 'passed');
    assert.ok(far.time_s > r.event.impact_events.find(e => e.verdict === 'deposited').time_s);
    if (thickness === 200) assert.equal(far.budget.core_out_j, 0);
    else assert.ok(Math.abs(far.budget.core_out_j - far.budget.input_j * (1 - (50 / 95) ** 2)) < .001);
    r.event.impact_events.forEach(e => ledger(e.budget));
  }
});

test('actual WASM design reverses the far stack before a declared exterior addon', () => {
  const d = designBox();
  d.armor_faces.push({ body: 'hull', face: 0, material: 'rha', thickness_mm: 30 });
  d.armor_layers = [{ body: 'hull', face: 0, layers: [{ material: 'rha', thickness_mm: 20, spacing_mm: 10, angle_deg: 0 }] }];
  d.crew_positions = [{ role: 'driver', mount: 'hull', position_m: [0, 1, 0] }];
  d.addons = [{ id: 'after_exit', kind: 'plate', body: 'hull', face: null, anchor_m: [0, 1, 2.5], normal: [0, 0, 1], u_axis: [1, 0, 0], size_m: [1, 1], material: 'rha', thickness_mm: 10, standoff_mm: 0 }];
  core.setDesign(d);
  const r = core.shoot({ shell, origin: [0, 1, -2], dir: [0, 0, 1], speed_ms: 100, distance_m: 0, seed: 1, path: [] });
  const contacts = r.event.impact_events.filter(e => e.verdict !== 'deposited');
  assert.deepEqual(contacts.map(e => e.layer_id), ['hull:face:1/layer:0', 'hull:face:0/layer:1', 'hull:face:0/layer:0', 'addon:after_exit/layer:0']);
  assert.ok(contacts[1].entry_position.z < contacts[2].entry_position.z);
  assert.equal(r.event.impact_state.remaining_pen_mm, 35);
  assert.equal(r.event.impact_events.filter(e => e.verdict === 'deposited').length, 1);
  assert.ok(r.event.fragments.filter(f => f.is_penetrator).every(f => f.end.z <= 2.510001));
  r.event.impact_events.forEach(e => ledger(e.budget));
});

test('actual WASM combat rejects illegal kinetic material contacts without damage', () => {
  for (const field of ['hardness_bhn', 'kinetic_factor', 'density_kg_m3', 'thickness_mm']) {
    const materials = structuredClone(data.materials), front = plate('front', 0);
    if (field === 'thickness_mm') front.thickness_mm = -1;
    else materials.find(m => m.id === 'rha')[field] = -1;
    const bad = loadCoreSync(fs.readFileSync(process.env.TG_TEST_WASM || new URL('../assets/tg_design.wasm', import.meta.url)), { materials, catalog, terrains: Object.values(data.terrains) });
    bad.combatTarget({ id: 'bad:rha', plates: [front], modules: [], crew: [{ role: 'driver', pos: [0, 1, .4], radius: .1, health: 100 }], turret: null });
    const state = bad.combatNew('bad:rha').state;
    const r = bad.combatShoot('bad:rha', state, { shell, origin: [0, 1, -2], dir: [0, 0, 1], speed_ms: 100, distance_m: 0, seed: 1 });
    assert.ok(r.events.includes('rejected_impact_contact'), field);
    assert.equal(r.state.crew[0], 100);
    assert.equal(r.fragments.length, 0);
    assert.equal(r.impact_events.length, 0);
    const s = r.impact_state, v = s.velocity_m_s;
    assert.ok(Math.abs(s.mass_kg * (v.x ** 2 + v.y ** 2 + v.z ** 2) / 2 - 500) < .001);
  }
});
