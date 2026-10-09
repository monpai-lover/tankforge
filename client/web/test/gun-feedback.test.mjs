import test from 'node:test';
import assert from 'node:assert/strict';
import * as feedback from '../src/game/fx.js';

const auto = (caliber = 20, rpm = 450, stroke = 30) => ({ caliber_mm: caliber, recoil_mm: stroke, autocannon: { rate_rpm: rpm } });
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

function step(state, def, dt) {
  assert.equal(typeof feedback.advanceGunRecoil, 'function', 'a gun-specific recoil cycle is required');
  feedback.advanceGunRecoil(state, def, dt);
}

function blast(fx, caliber, dir = [0, 0, 1], dust = null, y = 2) {
  assert.equal(typeof fx.autocannonBlast, 'function', 'automatic cannon gas needs its own short, bounded preset');
  fx.autocannonBlast([0, y, 0], dir, caliber, dust, 0);
}

test('each automatic cannon round reaches its data-defined stroke and returns before the next round', () => {
  for (const def of [auto(), auto(30, 420, 40), auto(35, 550, 60)]) {
    const interval = 60 / def.autocannon.rate_rpm;
    const gs = { recoilT: -1, recoil: 0 };
    for (let shot = 0; shot < 12; shot++) {
      gs.recoilT = 0;
      step(gs, def, interval * 0.85 * 0.18);
      assert.ok(Math.abs(gs.recoil - def.recoil_mm / 1000) < 1e-9, `${def.caliber_mm} mm stroke`);
      step(gs, def, interval * 0.82);
      assert.equal(gs.recoil, 0, `round ${shot} must return to battery`);
      assert.equal(gs.recoilT, -1);
    }
  }
});

test('a large cannon keeps its existing back, dwell and recuperator timing', () => {
  const def = { recoil_mm: 580, caliber_mm: 88 };
  const gs = { recoilT: 0, recoil: 0 };
  step(gs, def, 0.05);
  assert.equal(gs.recoil, 0.58);
  step(gs, def, 0.04);
  assert.equal(gs.recoil, 0.58);
  step(gs, def, (0.45 + 0.58 * 0.6) / 2);
  assert.ok(Math.abs(gs.recoil - 0.29) < 1e-9);
  step(gs, def, 0.45);
  assert.equal(gs.recoil, 0);
  assert.equal(gs.recoilT, -1);
});

test('inactive and zero-stroke guns stay at battery', () => {
  const gs = { recoilT: -1, recoil: 0 };
  step(gs, auto(), 0.02);
  assert.deepEqual(gs, { recoilT: -1, recoil: 0 });
  gs.recoilT = 0;
  step(gs, auto(20, 450, 0), 1);
  assert.equal(gs.recoil, 0);
  assert.equal(gs.recoilT, -1);
});

test('brake jets form opposed lateral pairs even when the barrel is elevated or vertical', () => {
  for (const dir of [[0, 0, 1], [0.6, 0.8, 0], [0, 1, 0]]) {
    const fx = new feedback.Effects();
    blast(fx, 20, dir);
    const jets = fx.particles.filter(p => p.additive && Math.hypot(...p.vel) > 0);
    assert.equal(jets.length, 4, 'two brief flame puffs from each side');
    for (const p of jets) assert.ok(Math.abs(dot(p.vel, dir)) < 1e-8, 'jet must be perpendicular to the bore');
    for (const i of [0, 2]) assert.ok(Math.hypot(...jets[i].vel.map((v, k) => v + jets[i + 1].vel[k])) < 1e-8, 'opposed side ports');
  }
});

test('20, 30 and 35 mm automatic cannon flashes scale continuously with caliber', () => {
  const sizes = [];
  for (const caliber of [20, 30, 35]) {
    const fx = new feedback.Effects();
    blast(fx, caliber);
    sizes.push(Math.max(...fx.particles.filter(p => p.additive).map(p => p.size0)));
  }
  assert.ok(Math.abs(sizes[1] / sizes[0] - 1.5) < 1e-8);
  assert.ok(Math.abs(sizes[2] / sizes[0] - 1.75) < 1e-8);
});

test('automatic cannon smoke and optional ground dust have a fixed small per-shot budget', () => {
  for (const y of [0.5, 2.5]) {
    const fx = new feedback.Effects();
    blast(fx, 35, [0, 0, 1], [0.3, 0.25, 0.2], y);
    assert.ok(fx.particles.length <= 10, `at most ten particles, got ${fx.particles.length}`);
    assert.ok(fx.particles.every(p => p.life <= 0.28), 'no long-lived artillery plume per round');
    if (y === 2.5) assert.ok(fx.particles.every(p => p.pos[1] > 2), 'a high barrel must not lift ground dust');
  }
});

test('sustained 600 rpm fire settles below forty active muzzle particles', () => {
  const fx = new feedback.Effects();
  let peak = 0;
  for (let frame = 0; frame < 600; frame++) {
    if (frame % 6 === 0) blast(fx, 35, [0, 0, 1], [0.3, 0.25, 0.2], 0.5);
    fx.update(1 / 60);
    peak = Math.max(peak, fx.particles.length);
  }
  assert.ok(peak <= 40, `muzzle particle peak ${peak}`);
  fx.update(0.3);
  assert.equal(fx.particles.length, 0);
});

test('ordinary machine gun flash and large cannon blast retain their distinct presets', () => {
  const mg = new feedback.Effects();
  mg.mgFlash([0, 2, 0], [0, 0, 1], 7.92);
  assert.equal(mg.particles.filter(p => p.additive).length, 1);
  assert.ok(mg.particles.length <= 2);
  const cannon = new feedback.Effects();
  cannon.muzzleBlast([0, 2, 0], [0, 0, 1], 88, null);
  assert.equal(cannon.particles.filter(p => !p.additive).length, 22);
  assert.ok(cannon.particles.some(p => p.life > 1.5));
});
