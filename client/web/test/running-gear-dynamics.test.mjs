import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rig, ground, run, placeTank } from './tankrig.mjs';
import { stepTank, gearFromVisual, makeTank, newTank, applyNetState, netState, reconstructRunningGear } from '../src/sim/tank/tank.js';
import { makeRunningGear, newMassResponse } from '../src/sim/tank/runningGearDynamics.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { VehicleSim } from '../src/game/vehicle.js';
import { STRIDE } from '../src/gfx/geo.js';

const idle = { throttle: 0, steer: 0, brake: 0 };
const flat = ground(() => 0);
const close = (a, b, e = 1e-8) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const tracked = (r) => {
  assert.ok(r.tm.runningGear && r.t.body.runningGear, 'tracked running gear has an inertial owner');
  return r.t.body.runningGear;
};

test('running gear: static assembly recombines the original mass, COM and full inertia', () => {
  const dir = new URL('../../../data/vehicles/', import.meta.url);
  const ids = fs.readdirSync(dir).filter(id => {
    const visual = new URL(`${id}/visual.json`, dir);
    return fs.existsSync(visual) && Array.isArray(JSON.parse(fs.readFileSync(visual)).running_gear?.wheels);
  });
  assert.equal(ids.length, 37, 'includes the new T-72A and hidden fun_hexa source geometry');
  for (const id of ids) {
    const r = rig(id);
    const m = tracked(r).model;
    const masses = m.wheelMass;
    const total = masses.reduce((a, b) => a + b, m.sprungMass);
    close(total, r.tm.mass);
    const sum = m.sprungCom.map(x => x * m.sprungMass);
    for (let i = 0; i < masses.length; i++) for (let k = 0; k < 3; k++) sum[k] += masses[i] * m.points[i][k];
    for (let k = 0; k < 3; k++) close(sum[k] / total, r.tm.com[k]);
    const tensor = m.sprungInertia.slice();
    const addPoint = (mass, p) => {
      const d = p.map((x, k) => x - r.tm.com[k]);
      const d2 = d.reduce((a, x) => a + x * x, 0);
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) tensor[a * 3 + b] += mass * ((a === b ? d2 : 0) - d[a] * d[b]);
    };
    addPoint(m.sprungMass, m.sprungCom);
    for (let i = 0; i < masses.length; i++) addPoint(masses[i], m.points[i]);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) close(tensor[a * 3 + b], a === b ? r.tm.inertia[a] : 0, 1e-6);
    close(m.estimatedRatio, 0.06);
  }
});

test('running gear: disc volume survives axle dedup and estimated mass shrinks for small inertia', () => {
  const rg = { wheels: [{ z: 1, y: 0.5, r: 0.4, w: 0.1 }, { z: 1, y: 0.5, r: 0.4, w: 0.1, x: 0.1 }, { z: -1, y: 0.5, r: 0.4, w: 0.1 }], track_x: 1.2, track_width: 0.4, track_thickness: 0.08, sprocket: { z: 1.8, y: 0.6, r: 0.3 }, idler: { z: -1.8, y: 0.6, r: 0.3 } };
  const gear = gearFromVisual(rg);
  assert.equal(gear.stations.length, 2);
  close(gear.stations[0].volumeProxy / gear.stations[1].volumeProxy, 2);
  const stations = [1, -1].flatMap(side => gear.stations.map(s => ({ ...s, x: side * gear.trackX, side })));
  const mass = makeRunningGear(10000, [0, 1, 0], [100, 100, 100], stations, gear.stations.map(s => s.volumeProxy));
  assert.ok(mass.estimatedRatio > 0 && mass.estimatedRatio < 0.06);
  close(mass.wheelMass[0] / mass.wheelMass[1], 2);
  const explicit = makeRunningGear(10000, [0, 1, 0], [10000, 10000, 10000], stations, [], [100, 200]);
  assert.deepEqual(explicit.wheelMass, [100, 200, 100, 200]);
  close(explicit.sprungMass, 9400);
  assert.throws(() => makeRunningGear(10000, [0, 1, 0], [100, 100, 100], stations, [], [9000, 9000]), /non-positive sprung inertia/);
});

test('running gear: production buildTank and VehicleSim preserve source disc-volume mass distribution', () => {
  const root = new URL('../../../data/vehicles/de_vk1602/', import.meta.url);
  const read = name => JSON.parse(fs.readFileSync(new URL(name, root)));
  const real = { vehicle: read('vehicle.json'), visual: read('visual.json'), engine: read('engine.json'), turrets: [] };
  const uneven = structuredClone(real);
  const first = uneven.visual.running_gear.wheels[0];
  first.w = 0.09; first.x = -0.13;
  uneven.visual.running_gear.wheels.push({ ...first, r: first.r * 0.8, w: 0.21, x: 0.13 });
  uneven.visual.running_gear.wheels[1].w = 0.27;
  const renderer = {
    mesh: data => ({ data, count: data.length / STRIDE }),
    instancedMesh: data => ({ data, count: data.length / STRIDE }),
    setInstances(mesh, matrices, count) { mesh.matrices = matrices; mesh.instances = count; },
    freeMesh() {},
  };
  for (const bundle of [real, uneven]) {
    const model = buildTank(renderer, bundle, () => []);
    const sim = new VehicleSim(bundle, model, flat);
    const direct = makeTank(bundle.vehicle, bundle.engine, gearFromVisual(bundle.visual.running_gear));
    const proxies = model.stations.map(s => bundle.visual.running_gear.wheels.filter(w => w.z.toFixed(3) === s.z.toFixed(3)).reduce((sum, w) => sum + w.r * w.r * (w.w || bundle.visual.running_gear.track_width), 0));
    const sum = proxies.reduce((a, b) => a + b, 0);
    for (let i = 0; i < sim.tm.runningGear.wheelMass.length; i++) {
      close(sim.tm.runningGear.wheelMass[i], direct.runningGear.wheelMass[i], 1e-8);
      close(sim.tm.runningGear.wheelMass[i], 0.06 * sim.tm.mass * proxies[i % proxies.length] / (2 * sum), 1e-8);
    }
    assert.equal(sim.tm.sp.stations[0].y, model.stations[0].y);
    model.stations[0].y += 0.03; // older model metadata still retains measured coordinates
    delete model.stations[0].volumeProxy;
    const measured = new VehicleSim(bundle, model, flat);
    assert.equal(measured.tm.sp.stations[0].y, model.stations[0].y);
    close(measured.tm.runningGear.wheelMass[0], direct.runningGear.wheelMass[0], 1e-8);
  }
});

test('running gear: net horizontal force accelerates the original assembly mass', () => {
  const r = rig('de_tiger_e');
  tracked(r);
  r.t.body.linearDamping = r.t.body.angularDamping = 0;
  r.t.body.addForce([10000, 0, 0]);
  r.t.body.integrateVelocity(1 / 240);
  close(r.t.body.v[0] * 240, 10000 / r.tm.mass, 1e-10);
});

test('running gear: freefall gravity is identical for hull and wheels', () => {
  const r = rig('us_m4a3_76w_hvss');
  const rg = tracked(r);
  r.t.body.linearDamping = r.t.body.angularDamping = 0;
  r.t.body.integrateVelocity(1 / 240);
  close(r.t.body.v[1], -9.81 / 240);
  rg.qv.forEach(v => close(v, 0));
});

test('running gear: terrain height does not instantaneously set wheel displacement', () => {
  const r = rig('su_t34_85');
  placeTank(r.tm, r.t, flat, 0, 0, 0);
  run(r, flat, idle, 1);
  const before = r.t.ss.comp.slice();
  stepTank(r.tm, r.t, idle, ground(() => 0.12), 1 / 120);
  assert.ok(Math.max(...r.t.ss.comp.map((q, i) => Math.abs(q - before[i]))) < 0.11, 'wheel step is inertial');
  assert.ok(r.t.ss.comp.some((q, i) => q > before[i] + 0.001), 'wheel responds to the step');
});

test('running gear: spring preload plus wheel gravity supports the original weight', () => {
  for (const id of ['de_tiger_e', 'su_t34_85', 'us_m4a3_76w_hvss']) {
    const r = rig(id);
    const rg = tracked(r);
    close(r.tm.sp.units.reduce((a, u) => a + u.p, 0) + rg.model.wheelMass.reduce((a, m) => a + m * 9.81, 0), r.tm.mass * 9.81, 1e-6);
    placeTank(r.tm, r.t, flat, 0, 0, 0);
    run(r, flat, idle, 3);
    close(r.t.ss.load.reduce((a, x) => a + x, 0) / (r.tm.mass * 9.81), 1, 0.02);
    assert.ok(r.t.ss.load.every(x => x > 0));
  }
});

test('running gear: off-ground wheels carry no load and landing has no stale normal-rate spike', () => {
  const r = rig('de_tiger_e');
  placeTank(r.tm, r.t, flat, 0, 0, 0);
  run(r, flat, idle, 1);
  r.t.body.pos[1] += 0.8;
  stepTank(r.tm, r.t, idle, flat, 1 / 120);
  assert.equal(r.t.ss.load.reduce((a, x) => a + x, 0), 0);
  assert.equal(r.t.contacts.length, 0);
  let max = 0;
  run(r, flat, idle, 3, 1 / 120, () => {
    max = Math.max(max, ...r.t.ss.load);
    assert.ok([...r.t.body.v, ...r.t.body.w, ...r.t.ss.comp].every(Number.isFinite));
  });
  assert.ok(max < 30 * r.tm.mass * 9.81 / r.t.ss.load.length, `finite landing peak ${max}`);
  close(r.t.ss.load.reduce((a, x) => a + x, 0) / (r.tm.mass * 9.81), 1, 0.02);
});

test('running gear: one unloaded wheel has no traction while other stations support the hull', () => {
  const r = rig('su_t34_85');
  const rg = tracked(r);
  placeTank(r.tm, r.t, flat, 0, 0, 0);
  run(r, flat, idle, 1);
  rg.q[0] += 0.2;
  r.t.body.refreshRunningGear();
  stepTank(r.tm, r.t, idle, flat, 1 / 120);
  assert.equal(r.t.ss.load[0], 0);
  assert.ok(r.t.ss.load.slice(1).some(x => x > 0));
});

test('running gear: bridged airborne samples have no traction and broken support omits track thickness', () => {
  const r = rig('de_tiger_e'); tracked(r);
  const dip = ground((x, z) => Math.abs(z) < 0.25 ? -0.3 : 0);
  placeTank(r.tm, r.t, flat, 0, 0, 0); run(r, dip, idle, 1);
  for (const c of r.t.contacts) assert.ok(c.p[1] <= dip.height(c.p[0], c.p[2]) + 0.01, 'traction is admitted on actual terrain');
  const before = r.t.ss.contact[0][1];
  r.t.broken = { 1: true, [-1]: false };
  stepTank(r.tm, r.t, idle, dip, 1 / 120);
  assert.ok(r.t.ss.contact[0][1] > before + r.tm.sp.thickness * 0.7);
});

test('running gear: bogie rocking is damped and soft stopped travel stays finite', () => {
  const r = rig('us_m4a3_76w_hvss');
  const rg = tracked(r);
  placeTank(r.tm, r.t, ground(() => -100), 0, 0, 0);
  r.t.body.pos[1] = 20;
  rg.q[0] = 0.04;
  rg.q[1] = -0.04;
  const energy = () => {
    const rock = (rg.q[0] - rg.q[1]) / 2;
    const vel = (rg.qv[0] - rg.qv[1]) / 2;
    return 0.5 * r.tm.sp.units[0].rockK * rock * rock + 0.5 * (rg.model.wheelMass[0] + rg.model.wheelMass[1]) * vel * vel;
  };
  r.t.body.refreshRunningGear();
  const initial = energy();
  run(r, ground(() => -100), idle, 1);
  assert.ok(energy() < initial * 0.2, `rock energy ${energy()} < ${initial}`);
  assert.ok(rg.q.every(q => Number.isFinite(q) && Math.abs(q) < 1));
  rg.q[0] = 2;
  r.t.body.refreshRunningGear();
  run(r, ground(() => -100), idle, 2);
  assert.ok([...rg.q, ...rg.qv, ...r.t.body.v].every(Number.isFinite));
  assert.ok(Math.abs(rg.q[0]) < 0.5);
});

test('running gear: network pose replacement clears wheel velocities and contact impulses', () => {
  const r = rig('su_t34_85');
  const rg = tracked(r);
  rg.qv.fill(4);
  const oldPacket = netState(r.t); delete oldPacket.rg;
  applyNetState(r.tm, r.t, oldPacket);
  assert.ok(rg.qv.every(x => x === 0));
  assert.ok(rg.normalImpulse.every(x => x === 0));
});

function kinetic(body) {
  const rg = body.runningGear, m = rg.model;
  const v = body.localDir(body.v), w = body.localDir(body.w);
  const velocity = (r, qv) => [v[0] + w[1] * r[2] - w[2] * r[1], v[1] + w[2] * r[0] - w[0] * r[2] + qv, v[2] + w[0] * r[1] - w[1] * r[0]];
  const vs = velocity(m.sprungCom.map((x, k) => x - m.com[k]), 0);
  let T = 0.5 * m.sprungMass * vs.reduce((a, x) => a + x * x, 0);
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) T += 0.5 * w[a] * m.sprungInertia[a * 3 + b] * w[b];
  const momentum = vs.map(x => x * m.sprungMass);
  for (let i = 0; i < rg.q.length; i++) {
    const vi = velocity(m.points[i].map((x, k) => x - m.com[k] + (k === 1 ? rg.q[i] : 0)), rg.qv[i]);
    T += 0.5 * m.wheelMass[i] * vi.reduce((a, x) => a + x * x, 0);
    for (let k = 0; k < 3; k++) momentum[k] += m.wheelMass[i] * vi[k];
  }
  return { T, momentum: body.worldDir(momentum) };
}

test('running gear: free internal spring impulses preserve assembly linear momentum', () => {
  const r = rig('us_m4a3_76w_hvss'), rg = tracked(r);
  r.t.body.v = [1.2, -0.5, 0.7]; r.t.body.w = [0.4, 0.3, -0.2];
  rg.q.forEach((_, i) => { rg.q[i] = 0.03 * Math.sin(i); rg.qv[i] = 0.2 * Math.cos(i); });
  r.t.body.refreshRunningGear();
  const before = kinetic(r.t.body).momentum;
  r.t.body.applyRelativeImpulse(r.tm.sp.units[0].heave, -120);
  r.t.body.applyRelativeImpulse(r.tm.sp.units[0].rock, 75);
  kinetic(r.t.body).momentum.forEach((p, k) => close(p, before[k], 1e-8));
});

test('running gear: rotating displaced moving wheels conserve free kinetic energy with inertial bias', () => {
  const r = rig('us_m4a3_76w_hvss'), rg = tracked(r);
  r.t.body.v = [1.2, -0.5, 0.7]; r.t.body.w = [0.7, 0.5, -0.4];
  rg.q.forEach((_, i) => { rg.q[i] = 0.03 * Math.sin(i); rg.qv[i] = 0.2 * Math.cos(i); });
  r.t.body.refreshRunningGear();
  const before = kinetic(r.t.body).T;
  for (let i = 0; i < 2000; i++) {
    rg.integrateVelocity(r.t.body, 0.0001, 0);
    r.t.body.integratePosition(0.0001);
  }
  assert.ok(Math.abs(kinetic(r.t.body).T / before - 1) < 0.0002);
});

test('running gear: body damping cannot add energy when hull and wheel velocities oppose', () => {
  const damped = rig('su_t34_85'), free = rig('su_t34_85');
  for (const r of [damped, free]) {
    const rg = tracked(r);
    r.t.body.v = [0, 1, 0];
    rg.qv.fill(-20);
    r.t.body.angularDamping = 0;
  }
  damped.t.body.linearDamping = 0.5; free.t.body.linearDamping = 0;
  damped.t.body.integrateVelocity(0.01); free.t.body.integrateVelocity(0.01);
  assert.ok(kinetic(damped.t.body).T <= kinetic(free.t.body).T, 'coupled damping dissipates total kinetic energy');
});

test('running gear: a vertical hull forward axis keeps terrain normals finite', () => {
  const r = rig('su_t34_85'); tracked(r);
  r.t.body.ex = [1, 0, 0]; r.t.body.ey = [0, 0, -1]; r.t.body.ez = [0, 1, 0]; r.t.body.pos[1] = 5;
  assert.doesNotThrow(() => stepTank(r.tm, r.t, idle, flat, 1 / 120));
  assert.ok([...r.t.body.v, ...r.t.body.w, ...r.t.ss.comp].every(Number.isFinite));
});

test('running gear: cached contact response matches the coupled solve and expires after refresh/model replacement', () => {
  const direct = rig('de_tiger_e'), cached = rig('de_tiger_e');
  for (const r of [direct, cached]) {
    const rg = tracked(r); r.t.body.place([0, 3, 0], 0.4);
    for (let i = 0; i < rg.q.length; i++) { rg.q[i] = 0.02 * Math.sin(i); rg.qv[i] = 0.3 * Math.cos(i); }
    r.t.body.refreshRunningGear();
  }
  const body = cached.t.body, n = [0.1, 0.97, 0.2], weights = [0, 0.4, 1, 0.6];
  const p = body.worldPoint([1.5, 0.1, 1.1]);
  const response = newMassResponse(body.runningGear.q.length);
  body.contactResponse(n, p, weights, response);
  const velocity = body.pointVelocityAlong(p, n, weights);
  close(response.invMass, body.invMassAlong(n, p, weights), 1e-12);
  direct.t.body.applyImpulseAt(n.map(x => x * 123), p, weights);
  body.applyCachedResponse(response, 123);
  for (const field of ['v', 'w']) body[field].forEach((v, i) => close(v, direct.t.body[field][i], 1e-12));
  body.runningGear.qv.forEach((v, i) => close(v, direct.t.body.runningGear.qv[i], 1e-12));
  close(body.pointVelocityAlong(p, n, weights) - velocity, 123 * response.invMass, 1e-12);
  body.refreshRunningGear();
  assert.throws(() => body.applyCachedResponse(response, 1), /stale/);
  body.contactResponse(n, p, weights, response);
  body.installRunningGear(cached.tm.runningGear);
  assert.throws(() => body.applyCachedResponse(response, 1), /stale/);
});

test('running gear: inertial airborne snapshot roundtrips without ground overwriting q/qv', () => {
  const r = rig('su_t34_85'), rg = tracked(r);
  rg.q[0] = 0.15; rg.qv[0] = -0.8; rg.normalImpulse[0] = 100;
  const packet = netState(r.t);
  assert.ok(packet.rg, 'snapshot includes optional inertial wheel hint');
  const remote = newTank(r.tm);
  applyNetState(r.tm, remote, packet);
  reconstructRunningGear(r.tm, remote, flat, 1 / 60);
  close(remote.body.runningGear.q[0], 0.15);
  close(remote.body.runningGear.qv[0], -0.8);
  close(remote.ss.comp[0], 0.15);
  assert.ok(remote.body.runningGear.normalImpulse.every(x => x === 0));
});

test('running gear: malformed hints use bounded legacy terrain reconstruction', () => {
  const r = rig('su_t34_85'); tracked(r);
  for (const rg of [undefined, { version: 1, q: [], qv: [] }, { version: 1, q: r.t.ss.comp.map(() => NaN), qv: r.t.ss.comp.map(() => 0) }, { version: 1, q: r.t.ss.comp.map(() => 100), qv: r.t.ss.comp.map(() => 100) }]) {
    const remote = newTank(r.tm);
    const packet = netState(r.t); packet.rg = rg;
    applyNetState(r.tm, remote, packet);
    reconstructRunningGear(r.tm, remote, flat, 1 / 60);
    assert.ok(remote.body.runningGear.q.every(q => Number.isFinite(q) && Math.abs(q) < 0.3));
    assert.ok(remote.body.runningGear.qv.every(qv => qv === 0));
  }
});
