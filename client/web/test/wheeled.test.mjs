// The wheeled-vehicle model (sim/wheeled) on analytic ground with the real M8 and Puma data:
// it stands on its springs, reaches its published road speed, turns on its turning circle,
// stops, reverses (the Puma as fast as it goes forward), and grips less on mud than on road.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWheeled, newWheeled, placeWheeled, stepWheeled, wheelsFromVisual } from '../src/sim/wheeled/wheeled.js';
import { ground, terrains } from './tankrig.mjs';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../data');
const json = (p) => JSON.parse(fs.readFileSync(path.join(DATA, p), 'utf8'));

function car(id) {
  const v = json(`vehicles/${id}/vehicle.json`);
  const e = json(`vehicles/${id}/engine.json`);
  const vis = json(`vehicles/${id}/visual.json`);
  const tm = makeWheeled(v, e, wheelsFromVisual(vis.running_gear), { bellyY: 0.45 });
  return { tm, t: newWheeled(tm), v };
}

function run(r, terrain, input, secs, dt = 1 / 120, each) {
  const n = Math.round(secs / dt);
  let info;
  for (let i = 0; i < n; i++) {
    info = stepWheeled(r.tm, r.t, typeof input === 'function' ? input(i * dt) : input, terrain, dt);
    if (each) each(i * dt, info);
  }
  return info;
}

const flat = ground(() => 0);
const mud = ground(() => 0, 'mud');
const IDLE = { throttle: 0, steer: 0, brake: 0 };

test('armoured car: stands level on its tyres, each carrying its share', () => {
  for (const id of ['us_m8', 'de_sdkfz234_2', 'xp_kda35']) {
    const r = car(id);
    placeWheeled(r.tm, r.t, flat, 0, 0, 0);
    const info = run(r, flat, IDLE, 3);
    assert.ok(Math.abs(info.pitch) < 0.01 && Math.abs(info.roll) < 0.005, `${id} level ${info.pitch} ${info.roll}`);
    assert.ok(Math.abs(info.u) < 0.05, `${id} still ${info.u}`);
    const total = r.t.ss.load.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total / (r.tm.mass * 9.81) - 1) < 0.03, `${id} carries its weight ${total}`);
    assert.ok(r.t.ss.grounded.every(Boolean), `${id} every wheel on the ground`);
  }
});

test('armoured car: full throttle on a road reaches the published speed', () => {
  for (const [id, kmh] of [['us_m8', 89], ['de_sdkfz234_2', 90], ['xp_kda35', 90]]) {
    const r = car(id);
    placeWheeled(r.tm, r.t, flat, 0, 0, 0);
    let t50 = null;
    const info = run(r, flat, { throttle: 1, steer: 0, brake: 0 }, 90, 1 / 120, (t, i) => {
      if (t50 == null && i.speedKmh >= 50) t50 = t;
    });
    assert.ok(info.speedKmh > kmh * 0.85 && info.speedKmh < kmh * 1.1, `${id} top speed ${info.speedKmh.toFixed(1)} km/h`);
    assert.ok(t50 != null && t50 < 30, `${id} 0-50 km/h in ${t50}`);
    assert.ok(Math.abs(r.t.body.origin()[0]) < 1.0, `${id} runs straight ${r.t.body.origin()[0]}`);
  }
});

test('armoured car: tyre drive preserves acceleration when the simulation step is larger', () => {
  for (const id of ['us_m8', 'de_sdkfz234_2', 'xp_bmp_k64']) {
    const accelerate = dt => {
      const r = car(id);
      placeWheeled(r.tm, r.t, flat, 0, 0, 0);
      run(r, flat, IDLE, 2, dt);
      return run(r, flat, { throttle: 1, steer: 0, brake: 0 }, 10, dt).speedKmh;
    };
    const fine = accelerate(1 / 120), coarse = accelerate(1 / 30);
    assert.ok(Math.abs(coarse / fine - 1) < 0.025,
      `${id}: 10 s road acceleration depends on step size: ${fine.toFixed(2)} vs ${coarse.toFixed(2)} km/h`);
  }
});

test('armoured car: full lock at a crawl turns on about its turning circle', () => {
  for (const id of ['us_m8', 'de_sdkfz234_2', 'xp_kda35']) {
    const r = car(id);
    placeWheeled(r.tm, r.t, flat, 0, 0, 0);
    // creep at about 10 km/h with the wheel hard over, then measure the circle
    const input = () => ({ throttle: Math.max(0, Math.min(1, (2.8 - (r.t.info.u || 0)) * 0.6 + 0.08)), steer: 1, brake: 0 });
    run(r, flat, input, 6);
    const pts = [];
    run(r, flat, input, 14, 1 / 120, () => {
      const o = r.t.body.origin();
      pts.push([o[0], o[2]]);
    });
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const R = pts.reduce((a, p) => a + Math.hypot(p[0] - cx, p[1] - cz), 0) / pts.length;
    const want = r.v.physics.min_turn_radius_m;
    assert.ok(R > want * 0.7 && R < want * 1.5, `${id} turning radius ${R.toFixed(2)} m (data ${want})`);
    assert.ok(r.t.info.yawRateDeg > 0, `${id} turns right under right lock`);
  }
});

test('armoured car: brakes stop it from 50 km/h in a car-like distance', () => {
  const r = car('us_m8');
  placeWheeled(r.tm, r.t, flat, 0, 0, 0);
  run(r, flat, (t) => ({ throttle: r.t.info.speedKmh > 50 ? 0 : 1, steer: 0, brake: 0 }), 25);
  const z0 = r.t.body.origin()[2];
  const v0 = r.t.info.u;
  run(r, flat, { throttle: 0, steer: 0, brake: 1 }, 8);
  const d = r.t.body.origin()[2] - z0;
  assert.ok(v0 > 12, `got up to speed ${v0}`);
  assert.ok(Math.abs(r.t.info.u) < 0.2 && d > 5 && d < 40, `stopped in ${d.toFixed(1)} m`);
});

test('armoured car: the Puma reverses fast; the M8 only slowly', () => {
  const p = car('de_sdkfz234_2');
  placeWheeled(p.tm, p.t, flat, 0, 0, 0);
  const ip = run(p, flat, { throttle: -1, steer: 0, brake: 0 }, 40);
  const m = car('us_m8');
  placeWheeled(m.tm, m.t, flat, 0, 0, 0);
  const im = run(m, flat, { throttle: -1, steer: 0, brake: 0 }, 20);
  assert.ok(ip.speedKmh < -40, `Puma reverse ${ip.speedKmh.toFixed(1)} km/h`);
  assert.ok(im.speedKmh < -8 && im.speedKmh > -20, `M8 reverse ${im.speedKmh.toFixed(1)} km/h`);
});

test('armoured car: on mud the tyres slip and it is slower than on a road', () => {
  const road = car('us_m8');
  placeWheeled(road.tm, road.t, flat, 0, 0, 0);
  const a = run(road, flat, { throttle: 1, steer: 0, brake: 0 }, 12);
  const soft = car('us_m8');
  placeWheeled(soft.tm, soft.t, mud, 0, 0, 0);
  let slip = 0;
  const b = run(soft, mud, { throttle: 1, steer: 0, brake: 0 }, 12, 1 / 120, (t, i) => (slip = Math.max(slip, i.trackSlip)));
  assert.ok(b.speedKmh < a.speedKmh * 0.85, `mud ${b.speedKmh.toFixed(1)} vs road ${a.speedKmh.toFixed(1)}`);
  assert.ok(slip > 0.05, `tyres slip on mud ${slip}`);
  assert.ok(terrains.mud.traction_mu < terrains.road.traction_mu);
});

test('armoured car: a wheel over a bump lifts against its spring, the hull rolls a little', () => {
  const bump = ground((x, z) => (x > 0.4 && z > 20 && z < 22 ? 0.25 * Math.sin(((z - 20) / 2) * Math.PI) : 0));
  const r = car('us_m8');
  placeWheeled(r.tm, r.t, bump, 0, 0, 0);
  let lift = 0;
  let roll = 0;
  run(r, bump, (t) => ({ throttle: r.t.info.u < 4 ? 0.6 : 0.1, steer: 0, brake: 0 }), 12, 1 / 120, (t, i) => {
    lift = Math.max(lift, r.t.ss.comp[0]);
    roll = Math.max(roll, Math.abs(i.roll));
  });
  assert.ok(lift > 0.08, `right front wheel rises ${lift}`);
  assert.ok(roll > 0.005 && roll < 0.2, `hull rolls ${roll}`);
});
