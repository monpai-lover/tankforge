import {aircraftPerformancePrelude} from '../tools/aircraft_performance/runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the actual handoff builder; client/web/src is older than this delivered aircraft code.
const source = fs.readFileSync(new URL('../bundle/app.js.html', import.meta.url), 'utf8');
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
const context = vm.createContext({});
vm.runInContext(aircraftPerformancePrelude()+
  slice('  var aircraftGeometry = (() => {', '  // NF-01 gear') +
  slice('  var AIR_FIGHTERS = {', '  function fighterDamageModel(f) {') +
  slice('  function fighterDamageModel(f) {', '  /** Lowest points (y, z)') +
  '\nglobalThis.models = { aircraftGeometry, AIR_FIGHTERS, fighterDamageModel };', context);
const { aircraftGeometry, AIR_FIGHTERS, fighterDamageModel } = context.models;
const aircraftStart = source.indexOf('  var Aircraft = class {');
const poseStart = source.indexOf('    pose(alpha = 1) {', aircraftStart);
const poseEnd = source.indexOf('    /** Sends the damage model', poseStart);
vm.runInContext(slice('  var aqMul = ', '  var AIRCRAFT_KEYS') +
  `\nglobalThis.poseAircraft = ({${source.slice(poseStart, poseEnd)}}).pose;`, context);
const STRIDE = 13;
const meshArrays = model => [model.body, model.cockpit, model.glass, model.prop, model.wings.l, model.wings.r, ...model.controls.map(c => c.data)].filter(Boolean);
const models = Object.fromEntries(Object.entries(AIR_FIGHTERS).map(([id, f]) => [id, aircraftGeometry.fighter(f.spec)]));
const point = (data, i) => Array.from(data.slice(i, i + 3));
function sectionAt(sections, x) {
  for (let k = 1; k < sections.length; k++) if (x <= sections[k][0] + 1e-5) {
    const a = sections[k - 1], b = sections[k], t = Math.max(0, Math.min(1, (x - a[0]) / (b[0] - a[0])));
    return a.map((v, j) => v + (b[j] - v) * t);
  }
  return sections.at(-1);
}

test('both original test aircraft produce finite meshes, including the Vulcan muzzle colour', () => {
  for (const model of [aircraftGeometry(), aircraftGeometry.jet()]) for (const data of meshArrays(model)) assert.ok(Array.from(data).every(Number.isFinite));
});

test('seated helmets and torsos fit the actual canopy ellipsoid and remain cockpit-only geometry', () => {
  const cases = [...Object.entries(AIR_FIGHTERS).map(([id, f]) => [id, models[id], f.spec.canopy]), ['nf02', aircraftGeometry.jet(), [[0, 0.74, 4], [0.36, 0.36, 1.05]]]];
  const colours = ['#313c40', '#646d68'].map(hex => [1, 3, 5].map(i => Math.pow(parseInt(hex.slice(i, i + 2), 16) / 255, 2.2)));
  const pilotColour = (data, i) => colours.some(c => c.every((v, k) => Math.abs(v - data[i + 6 + k]) < 1e-6));
  for (const [id, model, [centre, radii]] of cases) {
    let vertices = 0;
    for (let i = 0; i < model.cockpit.length; i += STRIDE) if (pilotColour(model.cockpit, i)) {
      const p = point(model.cockpit, i);
      const normalizedRadiusSquared = p.reduce((sum, v, k) => sum + ((v - centre[k]) / radii[k]) ** 2, 0);
      assert.ok(normalizedRadiusSquared < 0.9 ** 2, `${id}: pilot intersects the canopy or loses clearance`);
      vertices++;
    }
    assert.ok(vertices > 100, `${id}: no actual pilot vertices checked`);
    for (let i = 0; i < model.body.length; i += STRIDE) assert.ok(!pilotColour(model.body, i), `${id}: pilot leaked into geometry visible in cockpit view`);
  }
});

for (const [id, f] of Object.entries(AIR_FIGHTERS)) {
  test(`${id}: finite meshes, authored span, bounded triangle count, unchanged wheel contact`, () => {
    const model = models[id], arrays = meshArrays(model);
    for (const data of arrays) {
      assert.equal(data.length % (STRIDE * 3), 0);
      assert.ok(Array.from(data).every(Number.isFinite));
    }
    const triangles = arrays.reduce((n, a) => n + a.length / (STRIDE * 3), 0);
    assert.ok(triangles < 20000, `${id}: ${triangles} triangles exceeds the software-render budget`);
    for (const side of ['l', 'r']) {
      const data = model.wings[side];
      const xs = Array.from({ length: data.length / STRIDE }, (_, i) => Math.abs(data[i * STRIDE]));
      assert.ok(Math.abs(Math.max(...xs) - f.spec.wing.at(-1)[0]) < 0.09);
    }
    const gear = model.controls.filter(c => c.type === 'gear');
    for (const c of gear) {
      const ys = Array.from({ length: c.data.length / STRIDE }, (_, i) => c.data[i * STRIDE + 1] + c.p[1]);
      const expected = f.spec.gear.main.y - f.spec.gear.main.len - f.spec.gear.main.r;
      assert.ok(Math.abs(Math.min(...ys) - expected) < 0.007, `${id}: main wheel contact changed`);
    }
  });
  test(`${id}: moving aileron/elevon follows the authored trailing edge and its damage envelope`, () => {
    const controls = models[id].controls.filter(c => c.type === 'roll' || c.type === 'elevon');
    assert.equal(controls.length, 2);
    for (const c of controls) {
      assert.ok(Math.abs(Math.hypot(...c.axis) - 1) < 1e-6);
      const bounds = aircraftGeometry.controlBounds(f.spec, c.sign);
      for (let i = 0; i < c.data.length; i += STRIDE) {
        const p = point(c.data, i).map((v, k) => v + c.p[k]);
        const s = sectionAt(f.spec.wing, Math.abs(p[0])), trailing = s[2] - s[3];
        assert.ok(p[2] >= trailing - 1e-5 && p[2] <= trailing + f.spec.aileron.d + 1e-5, `${id}: surface floats off trailing edge`);
        for (let k = 0; k < 3; k++) assert.ok(Math.abs(p[k] - bounds.c[k]) <= bounds.h[k] + 1e-5, `${id}: moving surface outside its envelope`);
      }
    }
  });
}

test('piston fighters retain fixed stabilizers and only their elevators move', () => {
  for (const [id, f] of Object.entries(AIR_FIGHTERS).filter(([, f]) => f.spec.prop)) {
    const pitch = models[id].controls.filter(c => c.type === 'pitch');
    assert.equal(pitch.length, 2);
    for (const c of pitch) {
      assert.equal(c.deflectionSign, c.sign);
      const xs = Array.from({ length: c.data.length / STRIDE }, (_, i) => Math.abs(c.data[i * STRIDE] + c.p[0]));
      assert.ok(Math.max(...xs) <= f.spec.htail.sections.at(-1)[0] + 1e-5);
    }
  }
});

test('unchanged wing stations retain shared smooth normals across neighboring span intervals', () => {
  for (const id of ['p51d', 'spitfire9', 'f4u1d', 'f104g']) {
    const spec = AIR_FIGHTERS[id].spec, ail = spec.aileron;
    const section = spec.wing.slice(1, -1).find(s =>
      (s[0] < ail.x - ail.w / 2 || s[0] > ail.x + ail.w / 2) &&
      (spec.flaps?.kind !== 'plain' || spec.flaps.spans.every(([lo, hi]) => s[0] < lo || s[0] > hi)));
    assert.ok(section, `${id}: no unchanged interior station`);
    const [x, y, z, chord, thickness] = section;
    // The top mid-chord vertex is away from the deliberate airfoil seam and any control cutout.
    const expected = [x, y + thickness, z - chord / 2], normals = [], data = models[id].wings.r;
    for (let i = 0; i < data.length; i += STRIDE) if (expected.every((v, k) => Math.abs(v - data[i + k]) < 1e-5)) normals.push(Array.from(data.slice(i + 3, i + 6)));
    assert.ok(normals.length >= 4, `${id}: shared station vertex not exercised`);
    for (const n of normals) assert.ok(n.every((v, k) => Math.abs(v - normals[0][k]) < 1e-5), `${id}: reflection seam across an unchanged station`);
  }
});

test('Mirage has wing-mounted elevons and no separate horizontal tail or tail skin envelope', () => {
  const f = AIR_FIGHTERS.mirage3e, model = models.mirage3e, damage = fighterDamageModel(f);
  assert.equal(model.controls.filter(c => c.type === 'pitch').length, 0);
  assert.equal(model.controls.filter(c => c.type === 'elevon').length, 2);
  assert.equal(damage.skin.length, 5);
  assert.equal(damage.parts.find(p => p.id === 'elevator').name, '升降副翼');
});

test('mirrored physical hinge axes preserve opposite roll, common pitch, and detached-wing visibility', () => {
  const displacement = (id, pitch, roll, deadLeft = false, controlType = 'roll') => {
    const cur = new Float32Array(64); cur[6] = 1; cur[24] = pitch; cur[25] = roll; cur[33] = 1; cur[35] = 100;
    const p = { prev: cur.slice(), cur, root: {}, controls: models[id].controls.map(c => ({ ...c, node: {} })), damage: { dead: id => deadLeft && id === 'wing_l' }, state: { camera: 0 }, glass: {}, cockpit: {} };
    context.poseAircraft.call(p, 1);
    return p.controls.filter(c => controlType === 'pitch' ? c.type === 'pitch' : c.type === 'roll' || c.type === 'elevon').map(c => {
      let trailing = point(c.data, 0);
      for (let i = 0; i < c.data.length; i += STRIDE) if (c.data[i + 2] < trailing[2]) trailing = point(c.data, i);
      const m = c.node.local;
      return { sign: c.sign, deltaY: m[1] * trailing[0] + m[5] * trailing[1] + m[9] * trailing[2] + m[13] - (trailing[1] + c.p[1]), visible: c.node.visible };
    });
  };
  const rolled = displacement('f4u1d', 0, 0.5);
  assert.ok(rolled[0].deltaY * rolled[1].deltaY < 0);
  const pitched = displacement('mirage3e', 0.5, 0);
  assert.ok(pitched[0].deltaY * pitched[1].deltaY > 0);
  for (const id of ['p51d', 'bf109g', 'spitfire9', 'f4u1d']) {
    const elevators = displacement(id, 0.5, 0, false, 'pitch');
    assert.equal(elevators.length, 2);
    assert.ok(elevators[0].deltaY * elevators[1].deltaY > 0, `${id}: elevator halves must pitch together`);
  }
  const damaged = displacement('mirage3e', 0.5, 0.5, true);
  assert.equal(damaged.find(c => c.sign < 0).visible, false);
  assert.equal(damaged.find(c => c.sign > 0).visible, true);
});

test('refined aircraft retain three separate gear joints and hide all wheels when retracted', () => {
  for (const [id, model] of Object.entries(models)) {
    for (const gear of [1, 0.5, 0]) {
      const cur = new Float32Array(64); cur[6] = 1; cur[33] = gear; cur[35] = 100;
      const p = { prev: cur.slice(), cur, root: {}, controls: model.controls.map(c => ({ ...c, node: {} })), damage: { dead: () => false }, state: { camera: 0 }, glass: {}, cockpit: {} };
      context.poseAircraft.call(p, 1);
      const joints = p.controls.filter(c => c.type === 'gear' || c.type === 'tailgear');
      assert.equal(joints.length, 3);
      for (const c of joints) {
        assert.equal(c.node.visible, gear > 0, `${id}: gear visibility`);
        for (let k = 0; k < 3; k++) assert.ok(Math.abs(c.node.local[12 + k] - c.p[k]) < 1e-6, `${id}: gear hinge moved`);
        if (gear === 1) for (let k = 0; k < 3; k++) assert.equal(c.node.local[k * 5], 1);
        if (gear === 0.5) assert.ok(Math.abs(c.node.local[0] - 1) > 0.01 || Math.abs(c.node.local[5] - 1) > 0.01);
      }
    }
  }
});

test('nose intakes have recessed centres instead of a face filling their mouth', () => {
  for (const id of ['mig15', 'mig17f', 'f86f']) {
    const { spec } = AIR_FIGHTERS[id], j = spec.jet.intake, data = models[id].body;
    const nearAxis = [];
    for (let i = 0; i < data.length; i += STRIDE) {
      const p = point(data, i);
      if (Math.abs(p[0]) < j.rx * 0.15 && Math.abs(p[1] - (j.y || 0)) < j.ry * 0.15) nearAxis.push(p[2]);
    }
    // MiGs have a central splitter, so use F-86's unsplit intake for the central aperture check.
    if (id === 'f86f') assert.ok(!nearAxis.some(z => Math.abs(z - j.z) < 0.06));
    assert.ok(nearAxis.some(z => z < j.z - 0.6 && z > j.z - 0.85));
  }
});

test('refined identifying features exist without changing mass, engine or weapon data', () => {
  for (const id of ['p51d', 'bf109g', 'spitfire9']) assert.equal(AIR_FIGHTERS[id].spec.exhausts.count, 6);
  assert.ok(AIR_FIGHTERS.spitfire9.spec.wing.length > 6);
  assert.equal(AIR_FIGHTERS.f104g.spec.sideIntakes.depth, 0.65);
  assert.ok(AIR_FIGHTERS.mig21.spec.spine.profile.length >= 5);
  assert.equal(AIR_FIGHTERS.f104g.guns[0][3], 6000);
});

console.log('Aircraft triangle counts:', Object.entries(models).map(([id, m]) => `${id}=${meshArrays(m).reduce((n, a) => n + a.length / (STRIDE * 3), 0)}`).join(', '));
