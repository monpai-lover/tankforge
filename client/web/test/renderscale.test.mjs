import test from 'node:test';
import assert from 'node:assert/strict';
import { RenderScale } from '../src/gfx/renderscale.js';

const run = (rs, ms, seconds) => {
  let last = null;
  for (let t = 0; t < seconds; t += ms / 1000) {
    const v = rs.sample(ms / 1000);
    if (v != null) last = v;
  }
  return last;
};

test('slow frames lower the render scale step by step down to the floor', () => {
  const rs = new RenderScale();
  run(rs, 30, 3);
  assert.equal(rs.scale, 0.9);
  run(rs, 30, 30);
  assert.equal(rs.scale, 0.7);
  assert.ok(rs.atFloor);
});

test('fast frames raise it again, slowly, and a bounce makes the next try wait longer', () => {
  const rs = new RenderScale();
  run(rs, 30, 30);
  run(rs, 16, 5);
  assert.equal(rs.scale, 0.7, 'not before the hold');
  run(rs, 16, 4);
  assert.equal(rs.scale, 0.8);
  // too slow again right after the step up: back down, and the hold doubles
  run(rs, 30, 3);
  assert.equal(rs.scale, 0.7);
  assert.equal(rs.upHold, 12);
});

test('hitches and frames in the comfortable band change nothing', () => {
  const rs = new RenderScale();
  rs.sample(0.5);
  run(rs, 21, 20);
  assert.equal(rs.scale, 1);
});
