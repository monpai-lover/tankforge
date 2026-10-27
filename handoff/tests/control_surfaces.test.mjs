import {aircraftPerformancePrelude} from '../tools/aircraft_performance/runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the delivered bundle's real procedural geometry and pose, rather than a mirrored builder.
const source = fs.readFileSync(new URL('../bundle/app.js.html', import.meta.url), 'utf8');
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
const context = vm.createContext({});
const geometry = slice('  var aircraftGeometry = (() => {', '  // NF-01 gear')
  .replace('    return build;', '    build.controlTestHooks = { panel, splitSurface, movingSurface, surfaceAt, flapSurfaces };\n    return build;');
vm.runInContext(aircraftPerformancePrelude()+geometry + slice('  var AIR_FIGHTERS = {', '  function fighterDamageModel(f) {') +
  '\nglobalThis.models = { aircraftGeometry, AIR_FIGHTERS };', context);
const { aircraftGeometry, AIR_FIGHTERS } = context.models;
const hooks = aircraftGeometry.controlTestHooks;
const aircraftStart = source.indexOf('  var Aircraft = class {');
const poseStart = source.indexOf('    pose(alpha = 1) {', aircraftStart);
const poseEnd = source.indexOf('    /** Sends the damage model', poseStart);
vm.runInContext(slice('  var aqMul = ', '  var AIRCRAFT_KEYS') +
  `\nglobalThis.poseAircraft = ({${source.slice(poseStart, poseEnd)}}).pose;`, context);
const models = Object.fromEntries(Object.entries(AIR_FIGHTERS).map(([id, f]) => [id, aircraftGeometry.fighter(f.spec)]));
const STRIDE = 13;
const points = data => Array.from({ length: data.length / STRIDE }, (_, i) => Array.from(data.slice(i * STRIDE, i * STRIDE + 3)));
const key = p => p.map(v => Math.round(v * 1e6)).join(',');
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function closedTriangles(vertices, indices) {
  const edges = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const tri = indices.slice(i, i + 3).map(k => vertices[k]);
    const n = cross(tri[1].map((v, k) => v - tri[0][k]), tri[2].map((v, k) => v - tri[0][k]));
    if (Math.hypot(...n) < 1e-10) continue;
    for (let k = 0; k < 3; k++) {
      const e = [key(tri[k]), key(tri[(k + 1) % 3])].sort().join('/');
      edges.set(e, (edges.get(e) || 0) + 1);
    }
  }
  assert.ok(edges.size > 20, 'closed geometry check must examine actual triangles');
  for (const [edge, count] of edges) assert.equal(count, 2, `open or multiply covered surface edge ${edge}`);
}
function emittedHinge(control) {
  const bySpan = new Map();
  for (const p of points(control.data)) {
    const k = Math.round(p[0] * 1e5);
    const prior = bySpan.get(k);
    if (!prior || p[2] > prior[2]) bySpan.set(k, p);
  }
  return [...bySpan.values()];
}
function planeFor(id, deployment, deadLeft = false) {
  const cur = new Float32Array(64); cur[6] = 1; cur[33] = 1; cur[34] = deployment; cur[35] = 100;
  return { prev: cur.slice(), cur, root: {}, controls: models[id].controls.map(c => ({ ...c, node: {} })),
    damage: { dead: id => deadLeft && id === 'wing_l' }, state: { camera: 0 }, glass: {}, cockpit: {} };
}

test('airfoil tips and control side faces are closed with independent flat cap normals', () => {
  for (const side of [-1, 1]) {
    const m = hooks.panel(side, [[0.7, -0.1, 1, 2.2, 0.14], [1.5, 0, 0.5, 1.8, 0.1], [2.7, 0.1, -0.1, 0.8, 0.035]]);
    const vertices = Array.from({ length: m.p.length / 3 }, (_, i) => Array.from(m.p.slice(i * 3, i * 3 + 3)));
    closedTriangles(vertices, Array.from(m.i));
    let caps = 0;
    for (let i = 0; i < m.n.length; i += 3) if (Math.abs(m.n[i]) > 0.999999) {
      assert.ok(Math.abs(m.n[i + 1]) < 1e-8 && Math.abs(m.n[i + 2]) < 1e-8);
      caps++;
    }
    assert.ok(caps >= 34, 'tip cap normals must not average into the wing skin');
  }
});

test('each emitted moving-surface leading edge stays on its rigid hinge through deflection', () => {
  let examined = 0;
  for (const [id, f] of Object.entries(AIR_FIGHTERS)) {
    for (const c of models[id].controls.filter(c => ['roll', 'elevon', 'flap'].includes(c.type) || c.type === 'pitch' && f.spec.prop)) {
      const hinge = emittedHinge(c);
      assert.ok(hinge.length >= 2, `${id}: missing span stations`);
      for (const p of hinge) {
        assert.ok(Math.hypot(...cross(c.axis, p)) < 2e-5, `${id}/${c.type}: leading edge is not a physical straight hinge`);
        // Any rotation about this axis must leave every hinge station in exactly the same place.
        const angle = 0.63, co = Math.cos(angle), sn = Math.sin(angle), d = c.axis.reduce((n, v, k) => n + v * p[k], 0), cp = cross(c.axis, p);
        const rotated = p.map((v, k) => v * co + cp[k] * sn + c.axis[k] * d * (1 - co));
        assert.ok(distance(rotated, p) < 2e-5, `${id}/${c.type}: deflection opens a hinge gap`);
      }
      const vertices = points(c.data);
      closedTriangles(vertices, vertices.map((_, i) => i));
      examined++;
    }
  }
  assert.ok(examined > 50, 'must check real ailerons, elevators and flap parts');
});

test('neutral moving hinges coincide with their fixed-wing or fixed-tail cutout edge', () => {
  for (const [id, f] of Object.entries(AIR_FIGHTERS)) {
    const model = models[id];
    for (const c of model.controls.filter(c => ['roll', 'elevon'].includes(c.type) || c.type === 'flap' && !c.hideWhenRetracted || c.type === 'pitch' && f.spec.prop)) {
      const fixed = points(c.type === 'pitch' ? model.body : model.wings[c.sign < 0 ? 'l' : 'r']);
      for (const local of emittedHinge(c)) {
        const p = local.map((v, k) => v + c.p[k]);
        assert.ok(fixed.some(q => distance(p, q) < 2e-5), `${id}/${c.type}: fixed surface does not meet the physical hinge`);
      }
    }
  }
});

test('piston flap parts follow core deployment downward on both sides and hide with their wing', () => {
  const pistons = Object.entries(AIR_FIGHTERS).filter(([, f]) => f.spec.prop);
  assert.equal(pistons.length, 7);
  for (const [id, f] of pistons) {
    assert.ok(f.spec.flaps?.spans.length, `${id}: missing authored flap spans`);
    const p = planeFor(id, 1); context.poseAircraft.call(p, 1);
    const flaps = p.controls.filter(c => c.type === 'flap');
    assert.equal(flaps.length, f.spec.flaps.spans.length * 2);
    for (const c of flaps) {
      assert.equal(c.owner, c.sign < 0 ? 'wing_l' : 'wing_r');
      assert.equal(c.node.visible, true);
      let tail = points(c.data)[0];
      for (const v of points(c.data)) if (v[2] < tail[2]) tail = v;
      const m = c.node.local, deployedY = m[1] * tail[0] + m[5] * tail[1] + m[9] * tail[2] + m[13];
      assert.ok(deployedY < tail[1] + c.p[1] - 0.03, `${id}: flap goes up instead of down`);
    }
    const up = planeFor(id, 0); context.poseAircraft.call(up, 1);
    for (const c of up.controls.filter(c => c.type === 'flap')) assert.equal(c.node.visible, !c.hideWhenRetracted);
    const lost = planeFor(id, 1, true); context.poseAircraft.call(lost, 1);
    for (const c of lost.controls.filter(c => c.type === 'flap')) assert.equal(c.node.visible, c.sign > 0);
  }
  assert.equal(models.mirage3e.controls.filter(c => c.type === 'flap').length, 0, 'tailless Mirage uses its elevons, not fictitious split flaps');
});

test('split flap aircraft preserve their original upper wing skin', () => {
  for (const id of ['spitfire9', 'fw190a8', 'yak9u', 'a6m2']) {
    const f = AIR_FIGHTERS[id], span = f.spec.flaps.spans[0];
    const section = f.spec.wing.find(s => s[0] > span[0] && s[0] < span[1]);
    assert.ok(section, `${id}: no authored interior station exercised`);
    for (const side of [-1, 1]) {
      const upper = [side * section[0], section[1] + section[4], section[2] - section[3] * 0.5];
      assert.ok(points(models[id].wings[side < 0 ? 'l' : 'r']).some(p => distance(p, upper) < 2e-5), `${id}: split flap removed the upper wing`);
    }
  }
  assert.equal(models.f4u1d.controls.filter(c => c.type === 'flap').length, 4, 'Corsair gull-wing flap hinges must be separate straight segments');
});
