import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { loadData } from '../tools/load-data.mjs';
import { buildTank } from '../src/gfx/tankmodel.js';
import { decodeImported } from '../src/gfx/imported.js';
import { STRIDE } from '../src/gfx/geo.js';
import { transformPoint } from '../src/gfx/math.js';
import * as track from '../src/gfx/track.js';

const data = loadData();
const fixtures = ['de_aufkl_panther', 'de_vk1602', 'su_att_m46', 'de_rso_pak40', 'de_rso_flak'];
await Promise.all(fixtures.map(async id => {
  const bundle = data.vehicles[id];
  if (bundle.model) bundle.imported = await decodeImported(bundle.model);
}));

function rig(id) {
  const bundle = data.vehicles[id];
  let created = 0;
  const meshes = [];
  const mesh = vertices => {
    created++;
    const result = { data: vertices, count: vertices.length / STRIDE };
    meshes.push(result);
    return result;
  };
  const renderer = {
    mesh, instancedMesh: mesh,
    setInstances(mesh, matrices, count) { mesh.matrices = matrices; mesh.instances = count; },
    freeMesh() {},
  };
  const M = buildTank(renderer, {
    vehicle: bundle.vehicle, visual: bundle.visual, imported: bundle.imported, turrets: [],
  }, () => []);
  return { M, meshes, created: () => created };
}

function pose(M, right, left = right, extra = {}) {
  const level = M.stations.map(() => 0);
  return { lifts: { 1: level, [-1]: level }, travel: { 1: right, [-1]: left }, lod: 2, ...extra };
}

function update(M, dyn) {
  const travel = { ...dyn.travel };
  M.updateRunningGear(dyn);
  M.root.update();
  assert.deepEqual(dyn.travel, travel, 'rendering preserves unwrapped material travel');
}

const wheel = (M, side = 1, role = 'sprocket') => M.wheels.find(w => w.role === role && w.side === side);

// A marked off-axis vertex in the original mesh witnesses the full hub rotation.
function witness(node, toothStep) {
  const vertices = node.mesh.data;
  for (let i = 0; i < vertices.length; i += STRIDE) {
    if (Math.abs(vertices[i + 1]) > .02 && Math.abs(vertices[i + 2]) > .02) {
      const point = Array.from(vertices.subarray(i, i + 3));
      if (toothStep !== undefined) {
        const c = Math.cos(toothStep), s = Math.sin(toothStep);
        const turned = [point[0], c * point[1] - s * point[2], s * point[1] + c * point[2]];
        let repeated = false;
        for (let j = 0; j < vertices.length; j += STRIDE) {
          if (Math.hypot(vertices[j] - turned[0], vertices[j + 1] - turned[1], vertices[j + 2] - turned[2]) < 1e-4) {
            repeated = true; break;
          }
        }
        if (repeated) continue;
      }
      return point;
    }
  }
  assert.fail('original axle mesh needs an off-axis orientation witness');
}

function direction(node, point) {
  const p = transformPoint(node.world, point);
  const origin = transformPoint(node.world, [0, 0, 0]);
  return p.map((v, k) => v - origin[k]);
}

const angleBetween = (a, b) => Math.atan2(
  Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]),
  a.reduce((sum, v, k) => sum + v * b[k], 0),
);

const TAU = Math.PI * 2;
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance,
  `${actual} should be within ${tolerance} of ${expected}`);
function equivalent(angle, raw, step) {
  near((angle - raw) / step, Math.round((angle - raw) / step), 1e-8);
}
const phaseState = () => ({ initialized: false, angle: 0, travel: 0 });
function lift(raw, teeth, travel, pitch, state, expected, tolerance) {
  assert.equal(typeof track.liftSprocketPhase, 'function', 'travel-predicted phase helper must exist');
  const angle = track.liftSprocketPhase(raw, teeth, travel, pitch, state);
  near(angle, expected, tolerance);
  equivalent(angle, raw, TAU / teeth);
  assert.equal(state.angle, angle);
  assert.equal(state.travel, travel);
  assert.deepEqual(Object.keys(state).sort(), ['angle', 'initialized', 'travel']);
  return angle;
}

// Reconstruct the unchanged raw alignment and shoe placement independently of the model's
// continuous shaft assignment. The selected pin pair diagnoses wrap-selector ties only.
function rawSampler(M) {
  const rg = M.runningGear;
  const staticLoop = track.buildLoop(rg, M.stations, null, M.baseSag);
  const pins = new Float32Array((M.linkCount + 1) * 2);
  const matrices = new Float32Array(M.linkCount * 16);
  const teethFor = axle => Math.max(8, Math.round(TAU * (rg[axle].r + rg.track_thickness / 2) / M.linkPitch));
  return (dyn, side = 1, axle = 'sprocket') => {
    const lod = dyn.lod || 0;
    const loop = lod >= 2 ? staticLoop : track.fitLoop(rg, M.stations, dyn.lifts[side],
      lod === 0 && dyn.ground ? dyn.ground[side] : null, staticLoop.length,
      dyn.slack ? dyn.slack[side] : 1);
    track.placeLinks(loop, M.linkCount, -dyn.travel[side], side * rg.track_x, matrices, 0, pins);
    const phaseLoop = axle === 'idler' ? { ...loop, sprocketFront: !loop.sprocketFront } : loop;
    const teeth = teethFor(axle), step = TAU / teeth;
    const raw = track.sprocketPhase(phaseLoop, pins, M.linkCount, rg[axle], teeth);
    const center = phaseLoop.sprocketFront ? loop.front : loop.rear;
    let selected = -1, best = Infinity;
    for (let i = 0; i < M.linkCount; i++) {
      const z = (pins[i * 2] + pins[i * 2 + 2]) / 2 - center.z;
      const y = (pins[i * 2 + 1] + pins[i * 2 + 3]) / 2 - center.y;
      const distance = Math.abs(Math.hypot(z, y) - center.r) - (phaseLoop.sprocketFront ? z : -z) * .2;
      if (distance < best) { best = distance; selected = i; }
    }
    return { raw, teeth, step, pitch: loop.length / M.linkCount, selected, matrices };
  };
}

function assertPrediction(node, previous, travelDelta, sample) {
  const predicted = previous + travelDelta * sample.step / sample.pitch;
  assert.ok(Math.abs(node.pitch - predicted) <= sample.step / 2 + 1e-9,
    `shaft ${node.pitch} must select the raw branch nearest travel prediction ${predicted}`);
  equivalent(node.pitch, sample.raw, sample.step);
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const arrayDigest = array => digest(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
function immutableReceipt(id, r) {
  const root = new URL(`../../../data/vehicles/${id}/`, import.meta.url);
  const bundle = data.vehicles[id];
  const files = [...new Set(['vehicle.json', ...Object.values(bundle.vehicle.files), bundle.model && bundle.vehicle.model].filter(Boolean))]
    .map(name => new URL(name, root));
  const sourceDigests = files.map(file => digest(fs.readFileSync(file)));
  const meshDigests = r.meshes.map(mesh => arrayDigest(mesh.data));
  const arrays = (bundle.imported?.parts || []).flatMap(part => [part.pos, part.nor, part.uv, part.idx]);
  const importedDigests = arrays.map(arrayDigest);
  const trackMesh = r.M.running.children.find(node => node.name === 'tracks').mesh;
  const matrices = trackMesh.matrices, created = r.created();
  return () => {
    assert.equal(r.created(), created, `${id}: updates allocate no new meshes`);
    assert.equal(trackMesh.matrices, matrices, `${id}: shoe matrix buffer is reused`);
    assert.equal(trackMesh.instances, r.M.linkCount * 2, `${id}: shoe count is unchanged`);
    assert.deepEqual(r.meshes.map(mesh => arrayDigest(mesh.data)), meshDigests,
      `${id}: all original vertex/normal/triangle-winding bytes remain unchanged`);
    assert.deepEqual(arrays.map(arrayDigest), importedDigests, `${id}: decoded source buffers remain unchanged`);
    assert.deepEqual(files.map(file => digest(fs.readFileSync(file))), sourceDigests,
      `${id}: packed model and vehicle source files remain unchanged`);
  };
}

test('phase lift initializes from the first raw phase and repeats identically', () => {
  const state = phaseState();
  lift(.12, 19, -8.25, .15, state, .12);
  assert.equal(state.initialized, true);
  lift(.12, 19, -8.25, .15, state, .12);
});

test('phase lift preserves forward and reverse winding across a tooth boundary', () => {
  const step = TAU / 19, pitch = .15;
  const forward = phaseState(), reverse = phaseState();
  lift(.32, 19, 0, pitch, forward, .32);
  lift(.01, 19, pitch * .1, pitch, forward, .01 + step);
  lift(.01, 19, 0, pitch, reverse, .01);
  lift(.32, 19, -pitch * .1, pitch, reverse, .32 - step);
});

test('phase lift counts ten skipped teeth in both travel directions', () => {
  const step = TAU / 19, pitch = .15;
  for (const sign of [1, -1]) {
    const state = phaseState();
    lift(.02, 19, 0, pitch, state, .02);
    lift(.02, 19, sign * 10 * pitch, pitch, state, .02 + sign * 10 * step);
  }
});

test('phase lift retains negative and large cumulative travel without aliasing', () => {
  const step = TAU / 19, pitch = .15, state = phaseState();
  lift(.17, 19, -5 * pitch, pitch, state, .17);
  lift(.17, 19, -12 * pitch, pitch, state, .17 - 7 * step);
  lift(.17, 19, 1000000 * pitch, pitch, state, .17 + 1000005 * step, 1e-7);
  lift(.17, 19, -1000000 * pitch, pitch, state, .17 - 999995 * step, 1e-7);
});

test('phase lift state objects retain independent reference angles and travel', () => {
  const step = TAU / 13, pitch = .1, a = phaseState(), b = phaseState();
  lift(.03, 13, 0, pitch, a, .03);
  lift(.21, 13, -99, pitch, b, .21);
  lift(.03, 13, 4 * pitch, pitch, a, .03 + 4 * step);
  lift(.21, 13, -99, pitch, b, .21);
  assert.notEqual(a.angle, b.angle);
});

test('actual Aufkl Panther shaft continues across the .945 -> .946 m tooth boundary', () => {
  const { M } = rig('de_aufkl_panther');
  const sprocket = wheel(M).node;
  const sample = rawSampler(M);
  assert.ok(!sprocket.imported, 'Aufkl uses its existing procedural sprocket');
  assert.equal(M.linkCount, 89);
  assert.equal(M.runningGear.sprocket.teeth, 17, 'source tooth calibration is preserved');
  assert.equal(sample(pose(M, .945)).teeth, 19, 'existing renderer tooth derivation is preserved');
  near(M.linkPitch, .14928796318139922, 1e-12);
  update(M, pose(M, .945));
  const before = sprocket.pitch;
  update(M, pose(M, .946));
  const after = sprocket.pitch;
  assert.ok(Math.abs(after - before) < .01,
    `shaft must continue across the tooth boundary: ${before} -> ${after}`);
  const raw = sample(pose(M, .946));
  equivalent(after, raw.raw, raw.step);
  M.dispose();
});

test('actual Aufkl hub vertex world orientation continues across the tooth boundary', () => {
  const { M } = rig('de_aufkl_panther');
  const sprocket = wheel(M).node;
  const point = witness(sprocket);
  update(M, pose(M, .945));
  const before = direction(sprocket, point);
  update(M, pose(M, .946));
  const delta = angleBetween(before, direction(sprocket, point));
  assert.ok(delta < .01, `original hub vertex rotated ${delta} rad for 1 mm travel`);
  M.dispose();
});

test('actual Aufkl forward 0 -> 2 m and reverse 2 -> -2 m sweeps retain winding and raw tooth alignment', () => {
  const r = rig('de_aufkl_panther'), { M } = r;
  const unchanged = immutableReceipt('de_aufkl_panther', r), sample = rawSampler(M);
  const sprocket = wheel(M).node;
  update(M, pose(M, 0));
  const initial = sprocket.pitch;
  let previous = sprocket.pitch, oldTravel = 0, oldSelected = sample(pose(M, 0)).selected;
  let selectorChanges = 0;
  const visit = (travel, sign) => {
    const dyn = pose(M, travel), raw = sample(dyn);
    update(M, dyn);
    const delta = sprocket.pitch - previous;
    assert.ok(Number.isFinite(sprocket.pitch) && Math.abs(delta) < .01,
      `shaft must have a finite small adjacent increment at ${oldTravel} -> ${travel}: ${delta}`);
    if (raw.selected === oldSelected) assert.ok(sign * delta > 0,
      `shaft retains travel direction away from wrap-selector ties: ${delta}`);
    else selectorChanges++;
    equivalent(sprocket.pitch, raw.raw, raw.step);
    assert.ok(Math.abs(sprocket.pitch - (initial + travel * raw.step / raw.pitch)) < raw.step / 2,
      'every sample retains the intended cumulative winding');
    previous = sprocket.pitch; oldTravel = travel; oldSelected = raw.selected;
  };
  for (let mm = 1; mm <= 2000; mm++) visit(mm / 1000, 1);
  assert.ok(sprocket.pitch > initial + 4, 'forward travel completes multiple shaft radians');
  for (let mm = 1999; mm >= -2000; mm--) visit(mm / 1000, -1);
  assert.ok(sprocket.pitch < initial - 4, 'reverse travel retains the negative winding');
  assert.ok(selectorChanges > 0, 'sweep traverses actual link-selector changes');
  unchanged(); M.dispose();
});

test('actual Aufkl skipped ten-tooth samples retain both forward and reverse winding', () => {
  const { M } = rig('de_aufkl_panther'), sample = rawSampler(M), sprocket = wheel(M).node;
  update(M, pose(M, .946));
  const start = sprocket.pitch;
  const { pitch, step } = sample(pose(M, .946));
  update(M, pose(M, .946 + 10 * pitch));
  near(sprocket.pitch, start + 10 * step, 1e-6);
  equivalent(sprocket.pitch, sample(pose(M, .946 + 10 * pitch)).raw, step);
  update(M, pose(M, .946 - 10 * pitch));
  near(sprocket.pitch, start - 10 * step, 1e-6);
  equivalent(sprocket.pitch, sample(pose(M, .946 - 10 * pitch)).raw, step);
  const repeated = sprocket.pitch;
  update(M, pose(M, .946 - 10 * pitch));
  assert.equal(sprocket.pitch, repeated);
  M.dispose();
});

test('opposite track sides and separate Aufkl models keep independent phase history', () => {
  const { M: a } = rig('de_aufkl_panther'), { M: b } = rig('de_aufkl_panther');
  const initial = [wheel(b, 1).node.pitch, wheel(b, -1).node.pitch];
  update(a, pose(a, 2, -2));
  assert.ok(wheel(a, 1).node.pitch > initial[0] + 4);
  assert.ok(wheel(a, -1).node.pitch < initial[1] - 4);
  assert.deepEqual([wheel(b, 1).node.pitch, wheel(b, -1).node.pitch], initial,
    'another actor does not inherit the first actor phase');
  const heldLeft = wheel(a, -1).node.pitch;
  update(a, pose(a, 2.001, -2));
  assert.equal(wheel(a, -1).node.pitch, heldLeft, 'stationary side ignores other-side travel');
  update(b, pose(b, -2, 2));
  near(wheel(b, 1).node.pitch, heldLeft);
  update(a, pose(a, 2.001, -2));
  assert.equal(wheel(a, -1).node.pitch, heldLeft);
  const { M: fresh } = rig('de_aufkl_panther');
  assert.deepEqual([wheel(fresh, 1).node.pitch, wheel(fresh, -1).node.pitch], initial,
    'new model initializes its own zero-travel reference');
  a.dispose(); b.dispose(); fresh.dispose();
});

test('LOD, lifts, slack and ground changes preserve the nearest winding and unchanged shoe placement', () => {
  const r = rig('de_aufkl_panther'), { M } = r;
  const unchanged = immutableReceipt('de_aufkl_panther', r), sample = rawSampler(M);
  const tracks = M.running.children.find(node => node.name === 'tracks').mesh;
  update(M, pose(M, 1.46, -1.46));
  const configurations = [
    { lod: 0, lifts: { 1: M.stations.map((_, i) => .07 * Math.sin(i)), [-1]: M.stations.map((_, i) => -.06 * Math.cos(i)) },
      slack: { 1: .75, [-1]: 1.3 }, ground: { 1: z => -.02 + .02 * Math.sin(z), [-1]: z => -.02 + .02 * Math.cos(z) } },
    { lod: 1, lifts: { 1: M.stations.map((_, i) => -.08 * Math.cos(i)), [-1]: M.stations.map((_, i) => .06 * Math.sin(i)) }, slack: { 1: 1.4, [-1]: .7 } },
    { lod: 2 }, { lod: 0 },
  ];
  let travel = 1.46;
  for (const extra of configurations) for (const delta of [0, .001]) {
    const previous = { 1: wheel(M, 1).node.pitch, [-1]: wheel(M, -1).node.pitch };
    travel += delta;
    const dyn = pose(M, travel, -travel, extra);
    update(M, dyn);
    for (const side of [1, -1]) {
      const raw = sample(dyn, side);
      assertPrediction(wheel(M, side).node, previous[side], side * delta, raw);
      const offset = side === 1 ? 0 : M.linkCount * 16;
      assert.deepEqual(tracks.matrices.subarray(offset, offset + M.linkCount * 16), raw.matrices,
        'phase lifting does not change existing link-placement matrices');
      for (const w of M.wheels.filter(w => w.side === side && w.role !== 'sprocket')) {
        near(w.node.pitch, (dyn.travel[side] / w.r) % TAU, 1e-12);
      }
    }
  }
  unchanged(); M.dispose();
});

for (const id of ['de_rso_pak40', 'de_rso_flak']) test(`${id}: procedural toothed idlers retain independent continuous winding`, () => {
  const r = rig(id), { M } = r, sample = rawSampler(M), unchanged = immutableReceipt(id, r);
  for (const side of [1, -1]) {
    const idler = wheel(M, side, 'idler').node;
    assert.ok(!idler.imported && idler.children.some(node => node.name === 'idler_teeth'));
  }
  update(M, pose(M, 0));
  const initial = { 1: wheel(M, 1, 'idler').node.pitch, [-1]: wheel(M, -1, 'idler').node.pitch };
  let previous = { ...initial }, oldTravel = 0;
  const visit = travel => {
    const dyn = pose(M, travel, -travel);
    update(M, dyn);
    for (const side of [1, -1]) {
      const node = wheel(M, side, 'idler').node, raw = sample(dyn, side, 'idler');
      assert.ok(Number.isFinite(node.pitch) && Math.abs(node.pitch - previous[side]) < .02);
      equivalent(node.pitch, raw.raw, raw.step);
      assert.ok(Math.abs(node.pitch - (initial[side] + side * travel * raw.step / raw.pitch)) < raw.step / 2);
      previous[side] = node.pitch;
    }
    oldTravel = travel;
  };
  for (let mm = 1; mm <= 1500; mm++) visit(mm / 1000);
  for (let mm = 1499; mm >= -1500; mm--) visit(mm / 1000);
  const pitch = sample(pose(M, oldTravel), 1, 'idler').pitch;
  for (const delta of [10 * pitch, -20 * pitch]) {
    const dyn = pose(M, oldTravel + delta, -oldTravel - delta);
    update(M, dyn);
    for (const side of [1, -1]) {
      const node = wheel(M, side, 'idler').node, raw = sample(dyn, side, 'idler');
      near(node.pitch, previous[side] + side * delta / pitch * raw.step, 1e-6);
      equivalent(node.pitch, raw.raw, raw.step);
      previous[side] = node.pitch;
    }
    oldTravel += delta;
  }
  unchanged(); M.dispose();
});

for (const [id, from, to] of [['de_vk1602', .006, .007], ['su_att_m46', .011, .012]]) {
  test(`${id}: original asymmetric imported sprocket children continue at their discovered boundary`, () => {
    const r = rig(id), { M } = r, sample = rawSampler(M), unchanged = immutableReceipt(id, r);
    let prior = sample(pose(M, 0)), discovered;
    for (let mm = 1; mm <= 2000; mm++) {
      const current = sample(pose(M, mm / 1000));
      if (prior.raw - current.raw > current.step / 2) { discovered = [(mm - 1) / 1000, mm / 1000]; break; }
      prior = current;
    }
    assert.deepEqual(discovered, [from, to], 'boundary is derived from this original chassis, not Aufkl travel');
    const witnesses = [];
    for (const side of [1, -1]) {
      const sprocket = wheel(M, side).node;
      assert.equal(sprocket.imported, true);
      assert.equal(sprocket.children.length, 3);
      for (const child of sprocket.children) {
        assert.equal(child.name, 'sprocket_model');
        // This original vertex has no counterpart at one renderer tooth rotation, so a
        // whole-node tooth reset cannot hide behind the imported ring's symmetry.
        const point = witness(child, sample(pose(M, 0)).step);
        witnesses.push({ child, point, side });
      }
    }
    for (const [start, end] of [[from, to], [to, from]]) {
      update(M, pose(M, start));
      const angles = { 1: wheel(M, 1).node.pitch, [-1]: wheel(M, -1).node.pitch };
      const before = witnesses.map(({ child, point }) => direction(child, point));
      update(M, pose(M, end));
      for (const side of [1, -1]) {
        const raw = sample(pose(M, end), side), node = wheel(M, side).node;
        assert.ok(Math.abs(node.pitch - angles[side]) < .01);
        assert.ok((end - start) * (node.pitch - angles[side]) > 0, 'imported shaft keeps forward/reverse sign');
        equivalent(node.pitch, raw.raw, raw.step);
      }
      witnesses.forEach(({ child, point }, i) => assert.ok(angleBetween(before[i], direction(child, point)) < .01,
        'actual imported child world orientation keeps the small boundary motion'));
    }
    let travel = from;
    const { pitch, step } = sample(pose(M, travel));
    for (const delta of [10 * pitch, -20 * pitch]) {
      const old = { 1: wheel(M, 1).node.pitch, [-1]: wheel(M, -1).node.pitch };
      const before = witnesses.map(({ child, point }) => direction(child, point));
      travel += delta;
      update(M, pose(M, travel));
      for (const side of [1, -1]) {
        near(wheel(M, side).node.pitch, old[side] + delta / pitch * step, 1e-6);
        equivalent(wheel(M, side).node.pitch, sample(pose(M, travel), side).raw, step);
      }
      // The original marked point must rotate with the complete imported assembly. A
      // full world-matrix rotation test also checks side mirroring and local mesh axes.
      const a = delta / pitch * step, c = Math.cos(a), s = Math.sin(a);
      witnesses.forEach(({ child, point }, i) => {
        const p = before[i], expected = [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]];
        assert.ok(angleBetween(expected, direction(child, point)) < 1e-5,
          'imported asymmetric child follows skipped-sample shaft winding on its original axis');
      });
    }
    unchanged(); M.dispose();
  });
}
