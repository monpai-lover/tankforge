import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { loadCoreSync } from '../src/design/core.js';

const read = name => JSON.parse(fs.readFileSync(new URL(`../../../data/${name}.json`, import.meta.url), 'utf8'));
const bytes = fs.readFileSync(new URL('../assets/tg_design.wasm', import.meta.url));
const init = { materials: read('materials'), catalog: read('design_catalog'), terrains: read('terrains') };
const gravity = 9.80665, dt = 1 / 120;
const length = v => Math.hypot(...v);
const dot = (a, b) => a.reduce((s, n, i) => s + n * b[i], 0);
const normal = v => v.map(n => n / length(v));
const definitions = read('missiles');

test('committed WASM bounds twin guided missiles and exports their actual G load', () => {
  const core = loadCoreSync(bytes, init);
  for (const speed of [150, 300, 600]) {
    const def = { ...definitions.find(d => d.id === 'bgm71a_tow'), launch_speed_ms: speed, max_speed_ms: speed, burn_s: 30, max_range_m: 100_000, guidance_lag_s: 0, max_g: 2 };
    core.call({ op: 'mw_reset', defs: [def] });
    const ids = [-1, 1].map(x => core.call({ op: 'mw_launch', def: def.id, owner: 99, team: 1, pos: [x, 1000, 0], dir: [0, 0, 1], seed: 123 + x }).id);
    assert.equal(new Set(ids).size, 2);
    let previous = core.call({ op: 'mw_step', dt: 0.2, actors: [] }).missiles;
    let horizontalRadius;
    for (const aim of [[10_000, 1000, 0], [0, 10_000, 0], [0, -10_000, 0], [0, 1000, -10_000]]) {
      for (const id of ids) core.call({ op: 'mw_guide', id, owner: 99, sight: [0, 1000, 0], aim });
      for (let step = 0; step < 24; step++) {
        const res = core.call({ op: 'mw_step', dt, actors: [] });
        assert.equal(res.missiles.length, 2, 'both missiles keep independent flight state');
        for (const m of res.missiles) {
          const before = previous.find(p => p.id === m.id);
          const acceleration = m.vel.map((v, i) => (v - before.vel[i]) / dt + (i === 1 ? gravity : 0));
          const load = length(acceleration) / gravity;
          assert.ok(load <= 2 + 1e-7, `${speed} m/s actual load ${load} G`);
          assert.equal(m.max_g, 2);
          assert.ok(Math.abs(m.g_load - load) < 1e-7, 'WASM exports the actual control load');
          assert.ok(Number.isFinite(m.lateral_g));
          const angle = Math.acos(Math.max(-1, Math.min(1, dot(normal(before.vel), normal(m.vel)))));
          assert.ok(angle <= 3 * gravity * dt / speed + 1e-8, 'an aim jump cannot rotate velocity instantly');
          if (!horizontalRadius) horizontalRadius = speed * dt / angle;
        }
        previous = res.missiles;
      }
    }
    const expected = speed ** 2 / (gravity * Math.sqrt(3));
    assert.ok(horizontalRadius >= expected * (1 - 1e-5));
    assert.ok(horizontalRadius < expected * 1.001);
  }
});

test('committed WASM accepts old missile definitions and keeps rockets ballistic', () => {
  const core = loadCoreSync(bytes, init);
  const legacy = { ...definitions[0] };
  delete legacy.max_g;
  const rocket = { ...definitions.find(d => d.guidance === 'none'), max_g: 100 };
  core.call({ op: 'mw_reset', defs: [legacy, rocket] });
  const launch = def => core.call({ op: 'mw_launch', def: def.id, owner: 99, team: 1, pos: [0, 1000, 0], dir: [0, 0, 1], seed: 123 }).id;
  const guided = launch(legacy), unguided = launch(rocket);
  core.call({ op: 'mw_guide', id: unguided, owner: 99, sight: [0, 1000, 0], aim: [10_000, 5000, 0] });
  const missiles = core.call({ op: 'mw_step', dt, actors: [] }).missiles;
  assert.ok(Math.abs(missiles.find(m => m.id === guided).max_g - legacy.turn_accel_ms2 / gravity) < 1e-12);
  const r = missiles.find(m => m.id === unguided);
  assert.equal(r.g_load, 0);
  assert.equal(r.max_g, 0);
  assert.equal(r.vel[0], 0);
  assert.ok(Math.abs(r.vel[1] + gravity * dt) < 1e-10);
  assert.throws(() => core.call({ op: 'mw_reset', defs: [{ ...legacy, max_g: -1 }] }), /nonnegative/);
});
