import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeTank, newTank, placeTank, stepTank, gearFromVisual } from '../src/sim/tank/tank.js';
import { makeWheeled, newWheeled, placeWheeled, stepWheeled, wheelsFromVisual } from '../src/sim/wheeled/wheeled.js';
import { ground, rig as trackedRig, run } from './tankrig.mjs';

const flat = ground(() => 0), dt = 1 / 60;
const idle = { throttle: 0, steer: 0, brake: 0 }, go = { throttle: 1, steer: 0, brake: 0 };
const rig = id => {
  const root = new URL(`../../../data/vehicles/${id}/`, import.meta.url);
  const read = f => JSON.parse(fs.readFileSync(new URL(`${f}.json`, root), 'utf8'));
  const vehicle = read('vehicle'), engine = read('engine'), visual = read('visual');
  const wheeled = vehicle.physics.drive === 'wheeled';
  const tm = wheeled ? makeWheeled(vehicle, engine, wheelsFromVisual(visual.running_gear)) : makeTank(vehicle, engine, gearFromVisual(visual.running_gear));
  const t = wheeled ? newWheeled(tm) : newTank(tm);
  const step = input => (wheeled ? stepWheeled : stepTank)(tm, t, input, flat, dt);
  (wheeled ? placeWheeled : placeTank)(tm, t, flat, 0, 0, 0);
  for (let i = 0; i < 120; i++) step(idle);
  return { tm, t, step };
};

test('W launch builds track and wheel thrust instead of applying peak torque in the first frame', () => {
  for (const id of ['de_flakpz38t', 'de_hetzer', 'de_tiger_e', 'us_m8', 'de_sdkfz234_2', 'xp_bmp_k64']) {
    const r = rig(id), first = r.step(go);
    assert.ok(Math.abs(first.ax) < 1, `${id}: first-frame acceleration ${first.ax}m/s² is an abrupt driveline impulse`);
    let maxAcc = 0;
    for (let i = 0; i < 120; i++) maxAcc = Math.max(maxAcc, r.step(go).ax);
    assert.ok(maxAcc > 1, `${id}: full-throttle drive must still build useful acceleration`);
    assert.ok(r.t.info.u > 1, `${id}: throttle response must not prevent launch`);
  }
});

test('progressive launch reduces light tank pitch while preserving real rearward load transfer', () => {
  const r = rig('de_flakpz38t'), n = r.tm.sp.stations.length / 2;
  const frontBefore = r.t.ss.load[0], rearBefore = r.t.ss.load[n - 1];
  let maxPitch = 0, front = frontBefore, rear = rearBefore;
  for (let i = 0; i < 120; i++) {
    const info = r.step(go);
    if (info.pitch > maxPitch) { maxPitch = info.pitch; front = r.t.ss.load[0]; rear = r.t.ss.load[n - 1]; }
  }
  assert.ok(maxPitch * 180 / Math.PI < 3.5, `launch nose rise ${maxPitch * 180 / Math.PI}° remains excessive`);
  assert.ok(maxPitch > 0.005 && front < frontBefore && rear > rearBefore,
    'nose rise and rearward weight transfer must come from the unchanged suspension');
});

test('engaged take-up survives gear changes so a heavy tank keeps accelerating in mud', () => {
  const r = trackedRig('de_tiger_e'), mud = ground(() => 0, 'mud');
  placeTank(r.tm, r.t, mud, 0, 0, 0);
  const info = run(r, mud, go, 10, 1 / 120);
  assert.ok(info.gear >= 2 && info.speedKmh > 6,
    `a full-throttle mud launch must progress beyond first gear: gear ${info.gear}, ${info.speedKmh}km/h`);
});

test('stopping and reversing rebuild the driveline force instead of reusing its previous peak', () => {
  for (const id of ['de_flakpz38t', 'us_m8']) {
    const r = rig(id);
    for (let i = 0; i < 120; i++) r.step(go);
    r.step({ throttle: -1, steer: 0, brake: 0 });
    assert.equal(r.t.ds.driveDirection, -1);
    assert.ok(r.t.ds.driveForce <= r.tm.mass * 4 * dt + 1e-6, `${id}: reversing must reset the previous drive force`);
    for (let i = 0; i < 180; i++) r.step({ ...idle, brake: 1 });
    assert.ok(Math.abs(r.t.info.u) < 0.1, `${id}: must be stopped before relaunch`);
    assert.equal(r.t.ds.driveForce, 0);
    const restart = r.step(go);
    assert.ok(Math.abs(restart.ax) < 1, `${id}: relaunch acceleration ${restart.ax}m/s² reused the old torque`);
  }
});
