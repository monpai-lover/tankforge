import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadData } from '../tools/load-data.mjs';
import { loadCoreSync } from '../src/design/core.js';
import { Combat } from '../src/game/combat.js';
import { Enemy, useCombat, combatHit } from '../src/game/enemies.js';
import { VehicleSim } from '../src/game/vehicle.js';
import { captureRangeTargetRestPose, reviveRangeTarget } from '../src/game/rangeTargetRevival.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { ground } from './tankrig.mjs';

const data = loadData();
const core = loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm', import.meta.url)), {
  materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains),
});
const terrain = ground(() => 0);
const renderer = {
  mesh: data => ({ data }), instancedMesh: data => ({ data }), freeMesh() {},
  setInstances(mesh, matrices, count) { mesh.matrices = matrices.slice(); mesh.instances = count; },
};
function actor(key = 'damage:enemy', id = 'de_tiger_e', at = { x: 0, z: 0, heading: 0 }) {
  const bundle = data.vehicles[id], combat = new Combat(core);
  const model = buildTank(renderer, { vehicle: bundle.vehicle, visual: bundle.visual, turrets: [] }, () => []);
  const e = new Enemy(id, bundle, model, terrain, at, null);
  useCombat(e, combat, key);
  return e;
}
const tracks = e => e.model.running.children.find(n => n.name === 'tracks').mesh;
const sideMatrices = (e, side) => tracks(e).matrices.slice(side === 1 ? 0 : e.model.linkCount * 16, side === 1 ? e.model.linkCount * 16 : undefined);
const point = (pins, i) => Array.from(pins.slice(i * 3, i * 3 + 3));
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
function shootRightTrack(e) {
  const m = e.bundle.modules.find(m => m.kind === 'track' && m.center.x > 0);
  const p0 = e.veh.body.worldPoint([40, m.center.y, m.center.z]);
  return combatHit(e, p0, e.veh.body.worldDir([-1, 0, 0]), data.projectiles.he_122_of471, 600, 600, 4);
}
function shootLeftTrack(e) {
  const m = e.bundle.modules.find(m => m.kind === 'track' && m.center.x < 0);
  const p0 = e.veh.body.worldPoint([-40, m.center.y, m.center.z]);
  return combatHit(e, p0, e.veh.body.worldDir([1, 0, 0]), data.projectiles.he_122_of471, 600, 600, 4);
}
function assertGap(e, side) {
  const pins = e.model.openTrackPins[side], n = e.model.linkCount;
  assert.equal(pins.length, (n + 1) * 3, 'all original shoes have two independent ends');
  assert.ok(distance(point(pins, 0), point(pins, n)) > e.model.linkPitch * .2, 'the disconnected ends expose a visible gap');
  assert.equal(tracks(e).instances, n * 2, 'neither belt nor any shoe disappears');
  assert.ok([...tracks(e).matrices].every(Number.isFinite));
}

test('a surviving real Enemy WASM hit immediately opens only the accepted damaged belt and its mechanical state', () => {
  const e = actor(), left = sideMatrices(e, -1), right = sideMatrices(e, 1);
  const report = shootRightTrack(e);
  assert.ok(report.events.includes('track_right')); assert.equal(e.alive, true);
  assert.deepEqual(e.veh.t.broken, { 1: true, [-1]: false }, 'combat capabilities must reach bare-wheel physics');
  assert.notDeepEqual(sideMatrices(e, 1), right, 'no manual pose/render tick is needed after a surviving hit');
  assert.deepEqual(sideMatrices(e, -1), left, 'the valid opposite belt keeps its exact phase and matrices');
  assertGap(e, 1);
  const opened = e.veh.runningGearPose()[1];
  e.caps = { ...e.caps };
  assert.equal(e.veh.runningGearPose()[1], opened, 'repeated snapshots do not cut the belt again');
});

test('a surviving real Enemy WASM hit on the opposite side opens only the left belt', () => {
  const e = actor('damage:enemy-left'), left = sideMatrices(e, -1), right = sideMatrices(e, 1);
  const report = shootLeftTrack(e);
  assert.ok(report.events.includes('track_left')); assert.equal(e.alive, true);
  assert.deepEqual(e.veh.t.broken, { 1: false, [-1]: true });
  assert.deepEqual(sideMatrices(e, 1), right);
  assert.notDeepEqual(sideMatrices(e, -1), left);
  assertGap(e, -1);
});

test('real repair starts and cancellation keep the gap; only restored capabilities close the belt without changing velocities', () => {
  const e = actor('damage:repair'); shootRightTrack(e);
  const left = sideMatrices(e, -1), b = e.veh.body;
  b.v = [.2, -.1, .3]; b.w = [.01, .02, -.03];
  const qv = b.runningGear.qv.slice(), travel = { ...e.veh.t.travel };
  const started = e.combat.repair(e.combatKey, e.cstate);
  assert.equal(started.ok, true);
  e.cstate = started.state; e.caps = started.caps;
  assertGap(e, 1);
  e.caps = { ...e.caps, repair_s: 0 }; assertGap(e, 1);
  const repaired = e.combat.advance(e.combatKey, started.state, started.caps.repair_s + 1, 0);
  e.cstate = repaired.state; e.caps = repaired.caps;
  assert.equal(e.caps.track_right, true);
  assert.equal(e.veh.t.broken, null);
  assert.equal(e.model.openTrackPins[1], null);
  assert.deepEqual(sideMatrices(e, -1), left);
  assert.deepEqual(b.v, [.2, -.1, .3]); assert.deepEqual(b.w, [.01, .02, -.03]);
  assert.deepEqual(b.runningGear.qv, qv); assert.deepEqual(e.veh.t.travel, travel);
});

test('range revival clears both accepted breaks and restores the existing model without resurrecting a wreck early', () => {
  const e = actor('damage:revival'); e.rangeTarget = true;
  e.rangeRestPose = captureRangeTargetRestPose(e);
  const intact = tracks(e).matrices.slice(), model = e.model;
  shootRightTrack(e);
  e.caps = { ...e.caps, track_left: false, destroyed: true };
  e.alive = false; e.pose(); assertGap(e, 1); assertGap(e, -1);
  assert.equal(reviveRangeTarget(e, e.combat), true);
  assert.equal(e.model, model); assert.equal(e.veh.t.broken, null);
  assert.equal(e.model.openTrackPins[1], null); assert.equal(e.model.openTrackPins[-1], null);
  assert.deepEqual(tracks(e).matrices, intact);
});

test('remote capability updates use the same open topology and reconstruction never restores a broken belt', () => {
  const e = actor('damage:remote'); e.remote = true;
  e.caps = { ...e.caps, track_left: false }; assertGap(e, -1);
  const topology = e.veh.runningGearPose()[-1], snapshot = e.veh.netState();
  snapshot.pos[0] += 4; snapshot.pos[2] += 3;
  e.pushState(snapshot, 1); e.follow(1.2, 1 / 60);
  assert.equal(e.veh.runningGearPose()[-1], topology); assertGap(e, -1);
  assert.deepEqual(e.veh.t.broken, { 1: false, [-1]: true });
  const pins = e.model.openTrackPins[-1], n = e.model.linkCount;
  for (const i of [0, n]) {
    const p = point(pins, i);
    assert.ok(p[1] >= e.veh.groundUnder(-1)(p[2]) + e.model.runningGear.track_thickness / 2 - 1e-5, 'attached terminal shoes respect actual terrain after motion');
  }
  e.caps = { ...e.caps, track_left: true }; assert.equal(e.veh.t.broken, null);
  assert.equal(e.model.openTrackPins[-1], null);
});

test('the player VehicleSim keeps rigid shoe dimensions, existing bare-wheel drive behavior and fresh-placement reset', () => {
  const e = actor('damage:player', 'su_t34_85'), veh = new VehicleSim(e.bundle, e.model, terrain);
  veh.place(0, 0, 0);
  veh.setDamageCaps({ track_left: false, track_right: true });
  const state = veh.runningGearPose()[-1];
  e.model.updateRunningGear({ lifts: veh.wheelLifts(), travel: veh.t.travel, ground: { 1: veh.groundUnder(1), [-1]: veh.groundUnder(-1) }, openBelts: veh.runningGearPose() });
  assertGap(e, -1);
  const matrices = tracks(e).matrices;
  for (let i = 0; i < e.model.linkCount * 2; i++) for (const k of [0, 4, 8]) {
    assert.ok(Math.abs(Math.hypot(matrices[i * 16 + k], matrices[i * 16 + k + 1], matrices[i * 16 + k + 2]) - 1) < 1e-5, 'shoe dimensions cannot stretch to expose the break');
  }
  for (let i = 0; i < 600; i++) veh.step({ throttle: 1, steer: 0, brake: 0 }, 1 / 120, false);
  assert.equal(veh.runningGearPose()[-1], state);
  assert.ok(veh.t.contacts.some(c => c.side === -1 && c.bare));
  assert.ok(Math.abs(veh.info.trackSpeedL) < .05 && veh.info.trackSpeedR > .2);
  veh.place(20, 30, .4);
  assert.equal(veh.t.broken, null); assert.equal(veh.runningGearPose(), null);
  assert.equal(e.model.openTrackPins[-1], null);
});

test('a real Puma wheel-module hit retains existing rear-wheel support loss without open-belt visuals', () => {
  const e = actor('damage:puma', 'de_sdkfz234_2');
  const report = shootLeftTrack(e);
  assert.equal(e.veh.wheeled, true);
  assert.equal(e.alive, true);
  assert.ok(report.events.includes('track_left'));
  const broken = { 1: !e.caps.track_right, [-1]: !e.caps.track_left };
  assert.deepEqual(e.veh.t.broken, broken, 'accepted wheel-module capabilities must reach the existing wheeled contact physics');
  assert.equal(e.veh.runningGearPose(), null, 'a wheeled vehicle has no belt to open');
  assert.equal(e.model.openTrackPins, undefined);
  e.veh.step({ throttle: 0, steer: 0, brake: 1 }, 1 / 120, false);
  for (const side of [1, -1]) {
    if (!broken[side]) continue;
    const rearZ = Math.min(...e.veh.tm.wheels.filter(w => w.side === side).map(w => w.z));
    const rear = e.veh.tm.wheels.findIndex(w => w.side === side && w.z === rearZ);
    assert.equal(e.veh.t.wheels[rear].grounded, false, 'the damaged rear wheel must stop providing support');
    assert.equal(e.veh.t.wheels[rear].load, 0);
  }
  const started = e.combat.repair(e.combatKey, e.cstate);
  assert.equal(started.ok, true);
  e.cstate = started.state; e.caps = started.caps;
  assert.deepEqual(e.veh.t.broken, broken, 'starting repair must not restore wheel support early');
  const repaired = e.combat.advance(e.combatKey, started.state, started.caps.repair_s + 1, 0);
  e.cstate = repaired.state; e.caps = repaired.caps;
  assert.equal(e.caps.track_left, true); assert.equal(e.caps.track_right, true);
  assert.equal(e.veh.t.broken, null);
  assert.equal(e.veh.runningGearPose(), null);
});

for (const id of ['su_t10m', 'proto_a']) {
  test(`${id}: a settled near-LOD broken belt keeps a readable rigid opening across modest travel phases`, () => {
    const e = actor(`damage:settled:${id}`, id), veh = e.veh;
    veh.place(0, 0, 0);
    e.caps = { ...e.caps, track_left: false, track_right: true };
    for (let i = 0; i < 240; i++) veh.step({ throttle: 0, steer: 0, brake: 1 }, 1 / 120, false);
    const n = e.model.linkCount, pitch = e.model.linkPitch;
    for (const travel of [0, .01, .04, .07, .1, .13, .2, -.01, -.1]) {
      const dyn = { lod: 0, lifts: veh.wheelLifts(), travel: { 1: travel, [-1]: travel },
        ground: { 1: veh.groundUnder(1), [-1]: veh.groundUnder(-1) } };
      e.model.updateRunningGear({ ...dyn, openBelts: null });
      const intactRight = sideMatrices(e, 1);
      e.model.updateRunningGear({ ...dyn, openBelts: veh.runningGearPose() });
      assert.deepEqual(sideMatrices(e, 1), intactRight, `the intact right belt must keep its exact matrices at travel ${travel}`);
      const pins = e.model.openTrackPins[-1];
      assert.ok(distance(point(pins, 0), point(pins, n)) >= pitch * .3, `the opening must remain readable at travel ${travel}`);
      for (const i of [0, n]) {
        const p = point(pins, i);
        assert.ok(p[1] >= dyn.ground[-1](p[2]) + e.model.runningGear.track_thickness / 2 - 1e-5,
          `the free terminal pin must stay above terrain at travel ${travel}`);
      }
      const matrices = tracks(e).matrices;
      for (const i of [n, n * 2 - 1]) for (const k of [0, 4, 8]) {
        assert.ok(Math.abs(Math.hypot(matrices[i * 16 + k], matrices[i * 16 + k + 1], matrices[i * 16 + k + 2]) - 1) < 1e-5,
          'terminal shoe dimensions must stay rigid');
      }
      assertGap(e, -1);
    }
  });
}
