// The tracked-vehicle model (sim/tank) against the acceptance list for the running gear:
// independent wheels, emergent pitch and roll, weight transfer, rebound that dies out, slip,
// no penetration, slopes, and the multiplayer rebuild. The same scenarios run as Rust tests in
// crates/physics/src/tank.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rig, ground, run, placeTank, terrains } from './tankrig.mjs';
import { netState, applyNetState, reconstructRunningGear, newTank } from '../src/sim/tank/tank.js';
import { Terrain } from '../src/game/terrain.js';

const flat = ground(() => 0);
const wave = (z) => (z > 10 && z < 70 ? 0.12 * (1 - Math.cos(((z - 10) / 6) * 2 * Math.PI)) : 0);
const waves = ground((x, z) => wave(z), 'dirt');
const cruise = (r, kmh) => () => ({ throttle: kmh > 90 ? 1 : Math.max(-0.2, Math.min(1, kmh / 3.6 / r.tm.p.vTop + (kmh / 3.6 - (r.t.info.u || 0)) * 1.5)), steer: 0, brake: 0 });
const per = (r) => r.tm.sp.stations.length / 2;

test('tank: stands level on its springs, every wheel carrying its share, nothing in the ground', () => {
  for (const id of ['de_tiger_e', 'su_t34_85', 'us_m4a3_75w']) {
    const r = rig(id);
    placeTank(r.tm, r.t, flat, 0, 0, 0);
    const info = run(r, flat, { throttle: 0, steer: 0, brake: 0 }, 3);
    assert.ok(Math.abs(info.pitch) < 0.002 && Math.abs(info.roll) < 0.002, `${id} level ${info.pitch} ${info.roll}`);
    const total = r.t.ss.load.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total / (r.tm.mass * 9.81) - 1) < 0.02, `${id} carries its weight ${total}`);
    assert.ok(r.t.ss.load.every((l) => l > 0.3 * (r.tm.mass * 9.81) / r.t.ss.load.length), `${id} every wheel loaded`);
    for (const c of r.t.contacts) assert.ok(c.p[1] > -0.01, `${id} contact above ground ${c.p[1]}`);
  }
});

test('tank: over sine waves the wheels rise one after another, the hull follows slower and settles', () => {
  for (const kmh of [5, 15, 30, 99]) {
    const r = rig('de_tiger_e');
    placeTank(r.tm, r.t, waves, 0, 0, 0);
    run(r, waves, { throttle: 0, steer: 0, brake: 0 }, 1);
    const n = per(r);
    const rise = [];
    let pitchHi = 0;
    let pitchLo = 0;
    let wheelRate = 0;
    let hullRate = 0;
    let prev = null;
    let after = [];
    let pen = 0;
    run(r, waves, cruise(r, kmh), 75 / Math.max(kmh / 3.6, 2.5) + 5, 1 / 120, (t, info) => {
      const o = r.t.body.origin();
      for (const k of [0, Math.floor(n / 2), n - 1]) if (rise[k] == null && r.t.ss.support[k] > 0.05) rise[k] = o[2];
      pitchHi = Math.max(pitchHi, info.pitch);
      pitchLo = Math.min(pitchLo, info.pitch);
      const comp = r.t.ss.comp.slice(0, n);
      if (prev) wheelRate = Math.max(wheelRate, ...comp.map((c, i) => Math.abs(c - prev[i]) * 120));
      prev = comp;
      hullRate = Math.max(hullRate, Math.abs(r.t.body.v[1]));
      if (o[2] > 72 && o[2] < 95) after.push(Math.abs(info.pitch));
      r.tm.sp.stations.forEach((s, i) => {
        const p = r.t.ss.contact[i];
        pen = Math.max(pen, waves.height(p[0], p[2]) - p[1]);
      });
    });
    const front = rise[0];
    const mid = rise[Math.floor(n / 2)];
    const rear = rise[n - 1];
    assert.ok(front < mid && mid < rear, `${kmh} km/h: wheels rise front ${front} mid ${mid} rear ${rear}`);
    assert.ok(pitchHi > 0.01 && pitchLo < -0.01, `${kmh} km/h: pitch both ways ${pitchHi} ${pitchLo}`);
    assert.ok(wheelRate > 1.5 * hullRate, `${kmh} km/h: wheels move faster (${wheelRate}) than the hull heaves (${hullRate})`);
    assert.ok(pen < 0.01, `${kmh} km/h: no wheel in the ground ${pen}`);
    if (after.length > 20) {
      const late = after.slice(Math.floor(after.length * 0.6));
      assert.ok(Math.max(...late) < 0.006, `${kmh} km/h: the bouncing dies out after the waves ${Math.max(...late)}`);
    }
  }
});

test('tank: one track on a kerb rolls the hull; staggered waves roll it both ways', () => {
  const kerb = ground((x, z) => (x < 0 && z > 5 ? 0.3 : 0));
  const r = rig('us_m4a3_76w_hvss');
  placeTank(r.tm, r.t, kerb, 0, 0, 0);
  run(r, kerb, { throttle: 0.3, steer: 0, brake: 0 }, 6);
  const roll = r.t.body.attitude().roll;
  assert.ok(roll < -0.04, `left side up means negative roll: ${roll}`);
  const stag = ground((x, z) => (z > 10 && z < 70 ? 0.12 * (1 - Math.cos(((z - 10) / 6) * 2 * Math.PI + (x > 0 ? Math.PI : 0))) : 0), 'dirt');
  const r2 = rig('su_t34_85');
  placeTank(r2.tm, r2.t, stag, 0, 0, 0);
  let hi = 0;
  let lo = 0;
  run(r2, stag, cruise(r2, 12), 12, 1 / 120, (t, i) => {
    hi = Math.max(hi, i.roll);
    lo = Math.min(lo, i.roll);
  });
  assert.ok(hi > 0.01 && lo < -0.01, `rolls both ways ${hi} ${lo}`);
});

test('tank: weight moves back accelerating, forward braking, and onto the low end on a slope', () => {
  const r = rig('de_tiger_e');
  placeTank(r.tm, r.t, flat, 0, 0, 0);
  run(r, flat, { throttle: 0, steer: 0, brake: 0 }, 2);
  const n = per(r);
  const fr = () => [r.t.ss.load[0], r.t.ss.load[n - 1]];
  const [f0, b0] = fr();
  run(r, flat, { throttle: 1, steer: 0, brake: 0 }, 1.2);
  const [f1, b1] = fr();
  assert.ok(f1 < f0 && b1 > b0, `accelerating: front ${f0}->${f1}, rear ${b0}->${b1}`);
  run(r, flat, { throttle: 1, steer: 0, brake: 0 }, 10);
  run(r, flat, { throttle: 0, steer: 0, brake: 1 }, 0.5);
  const [f2, b2] = fr();
  assert.ok(f2 > f0 && b2 < b0, `braking: front ${f2}, rear ${b2}`);
  const slope = ground((x, z) => z * Math.tan((12 * Math.PI) / 180));
  const r2 = rig('de_tiger_e');
  placeTank(r2.tm, r2.t, slope, 0, 0, 0);
  const z0 = r2.t.body.origin()[2];
  run(r2, slope, { throttle: 0, steer: 0, brake: 1 }, 4);
  assert.ok(Math.abs(r2.t.body.origin()[2] - z0) < 0.1, 'braked on 12 degrees it holds');
  assert.ok(r2.t.ss.load[n - 1] > r2.t.ss.load[0] * 1.5, 'the rear (downhill) wheels carry more');
  const climb = run(r2, slope, { throttle: 1, steer: 0, brake: 0 }, 8);
  assert.ok(climb.speedKmh > 2, `climbs it ${climb.speedKmh}`);
});

test('tank: differential drive turns, pivots, and a fast turn slides; mud spins the tracks', () => {
  const r = rig('de_tiger_e');
  placeTank(r.tm, r.t, flat, 0, 0, 0);
  const piv = run(r, flat, { throttle: 0, steer: 1, brake: 0 }, 4);
  assert.ok(piv.yawRateDeg > 8 && piv.trackSpeedL > 0.1 && piv.trackSpeedR < -0.1 && Math.abs(piv.speedKmh) < 1, `pivot ${JSON.stringify(piv)}`);
  const r2 = rig('su_t34_85');
  placeTank(r2.tm, r2.t, flat, 0, 0, 0);
  run(r2, flat, { throttle: 1, steer: 0, brake: 0 }, 20);
  const fast = run(r2, flat, { throttle: 1, steer: 1, brake: 0 }, 3);
  assert.ok(fast.yawRateDeg > 10 && Math.abs(fast.w) > 0.2, `slides sideways in a fast turn ${fast.w}`);
  assert.ok(fast.roll > 0.005, `leans out of the turn ${fast.roll}`);
  // straight on a road the tracks run at the ground speed
  const r3 = rig('us_m4a3_75w');
  placeTank(r3.tm, r3.t, flat, 0, 0, 0);
  const road = run(r3, flat, { throttle: 0.6, steer: 0, brake: 0 }, 15);
  assert.ok(Math.abs(road.trackSpeedL - road.u) < 0.05 * Math.abs(road.u) + 0.05, `track ${road.trackSpeedL} ground ${road.u}`);
  // pulling away at full throttle: the tracks slip far more in mud than on a road
  const launchSlip = (surface) => {
    const g = ground(() => 0, surface);
    const q = rig('su_t34_85');
    placeTank(q.tm, q.t, g, 0, 0, 0);
    run(q, g, { throttle: 0, steer: 0, brake: 0 }, 1);
    let worst = 0;
    run(q, g, { throttle: 1, steer: 0, brake: 0 }, 1, 1 / 120, (t, i) => (worst = Math.max(worst, i.trackSlip)));
    return worst;
  };
  const inMud = launchSlip('mud');
  const onRoad = launchSlip('road');
  assert.ok(inMud > 0.15 && inMud > 2 * onRoad, `launch slip mud ${inMud} road ${onRoad}`);
});

test('tank: a remote client rebuilds the wheels from the sent hull pose', () => {
  const r = rig('de_tiger_e');
  placeTank(r.tm, r.t, waves, 0, 0, 0);
  run(r, waves, cruise(r, 15), 6);
  const sent = JSON.parse(JSON.stringify(netState(r.t)));
  const remote = newTank(r.tm);
  applyNetState(r.tm, remote, sent);
  reconstructRunningGear(r.tm, remote, waves, 1 / 60);
  const err = r.t.ss.comp.map((c, i) => Math.abs(c - remote.ss.comp[i]));
  assert.ok(Math.max(...err) < 0.03, `wheel positions within 3 cm ${Math.max(...err)}`);
  assert.equal(remote.ds.belts[-1].v, sent.track[0]);
});

test('terrain: tracks leave ruts in soft ground and marks on hard ground', () => {
  const t = new Terrain(terrains);
  // mud zone of the range: x -100..-24, z 30..130; the road: x -6..6
  const before = t.height(-60, 80);
  for (let i = 0; i < 30; i++) t.press(-60, 80, 0, 1, 0.6, 0.4, 60000, 0, 1 / 120);
  const rut = before - t.height(-60, 80);
  assert.ok(rut > 0.03, `mud rut ${rut}`);
  assert.ok(t.deform(-60 + 0.6, 80) > 0, 'soil heaped beside the rut');
  const roadBefore = t.height(0, 500);
  for (let i = 0; i < 30; i++) t.press(0, 500, 0, 1, 0.6, 0.4, 60000, 1.5, 1 / 120);
  assert.equal(t.height(0, 500), roadBefore, 'the road keeps its shape');
  assert.ok(t.mark(0, 500) > 0.1, 'but carries tread marks');
});

test('tank: the tracks and the hull collide with obstacles (a wall stops it, a glancing wall turns it)', () => {
  const wallZ = (r) => {
    let maxZ = -Infinity;
    for (const lp of r.tm.collide) maxZ = Math.max(maxZ, r.t.body.worldPoint(lp)[2]);
    return maxZ;
  };
  const r = rig('su_t34_85');
  placeTank(r.tm, r.t, flat, 0, 0, 0);
  // a 3 m high wall across the way, its face at z = 19
  r.t.obstacles = [{ x: 0, z: 20, yaw: 0, hx: 6, hz: 1, y0: -1, y1: 3 }];
  let maxZ = -Infinity;
  run(r, flat, { throttle: 1, steer: 0, brake: 0 }, 8, 1 / 120, () => (maxZ = Math.max(maxZ, wallZ(r))));
  assert.ok(maxZ < 19 + 0.08, `nothing goes through the wall: front reached ${maxZ}`);
  assert.ok(Math.abs(r.t.info.u) < 0.5, `it stops against it ${r.t.info.u}`);
  // driving at a wall 25 degrees off square: the track's front corner meets it and the hull swings
  const q = rig('su_t34_85');
  placeTank(q.tm, q.t, flat, 0, 0, 0);
  const yaw = (25 * Math.PI) / 180;
  q.t.obstacles = [{ x: 6, z: 18, yaw, hx: 12, hz: 1, y0: -1, y1: 3 }];
  let inside = 0;
  run(q, flat, { throttle: 0.6, steer: 0, brake: 0 }, 10, 1 / 120, () => {
    for (const lp of q.tm.collide) {
      const p = q.t.body.worldPoint(lp);
      const w = (p[0] - 6) * Math.sin(yaw) + (p[2] - 18) * Math.cos(yaw);
      inside = Math.max(inside, 1 - Math.abs(w));
    }
  });
  const heading = q.t.body.attitude().heading;
  assert.ok(inside < 0.12, `the track stays out of the wall (deepest ${inside} m)`);
  assert.ok(Math.abs(heading) > 0.05, `the wall turned the hull ${heading}`);
});

test('online: snapshots blend smoothly and server addresses are completed', async () => {
  const { mixState } = await import('../src/game/enemies.js');
  const { normalizeServer } = await import('../src/game/net.js');
  const a = { pos: [0, 0, 0], ex: [1, 0, 0], ez: [0, 0, 1], v: [0, 0, 10], w: [0, 0, 0], track: [10, 10], rpm: 1500, gear: 2, tur: [[3.0, 0]] };
  const b = { pos: [0, 0, 1], ex: [0, 0, -1], ez: [1, 0, 0], v: [0, 0, 10], w: [0, 1, 0], track: [10, 12], rpm: 1600, gear: 2, tur: [[-3.0, 0.1]] };
  const m = mixState(a, b, 0.5);
  assert.deepEqual(m.pos, [0, 0, 0.5]);
  // the hull's axes stay unit length and square to each other half way round a turn
  assert.ok(Math.abs(Math.hypot(...m.ez) - 1) < 1e-9 && Math.abs(Math.hypot(...m.ex) - 1) < 1e-9);
  assert.ok(Math.abs(m.ex[0] * m.ez[0] + m.ex[1] * m.ez[1] + m.ex[2] * m.ez[2]) < 1e-9);
  // the turret takes the short way across ±180°
  assert.ok(Math.abs(Math.abs(m.tur[0][0]) - Math.PI) < 0.01, String(m.tur[0][0]));
  assert.equal(normalizeServer('192.168.1.5:8787'), 'ws://192.168.1.5:8787/ws');
  assert.equal(normalizeServer('https://tanks.example.org'), 'wss://tanks.example.org/ws');
  assert.equal(normalizeServer('ws://localhost:8787/ws'), 'ws://localhost:8787/ws');
});

test('tank: a track shot off leaves the vehicle all but stuck: bare wheels on one side, a weak push on the other', () => {
  const go = (broken) => {
    const r = rig('su_t34_85');
    placeTank(r.tm, r.t, flat, 0, 0, 0);
    r.t.broken = broken;
    const info = run(r, flat, { throttle: 1, steer: 0, brake: 0 }, 5);
    return { info, dist: Math.hypot(r.t.body.origin()[0], r.t.body.origin()[2]) };
  };
  const sound = go(null);
  const left = go({ 1: false, [-1]: true });
  assert.ok(left.dist < sound.dist * 0.4 && left.info.speedKmh < sound.info.speedKmh * 0.4, `crawls ${left.dist.toFixed(1)} m vs ${sound.dist.toFixed(1)} m`);
  // the broken side's track no longer runs
  assert.ok(Math.abs(left.info.trackSpeedL) < 0.05 && left.info.trackSpeedR > 0.2, `${left.info.trackSpeedL} ${left.info.trackSpeedR}`);
});
