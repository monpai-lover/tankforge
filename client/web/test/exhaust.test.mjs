import test from 'node:test';
import assert from 'node:assert/strict';
import { Exhaust } from '../src/game/exhaust.js';
import { RigidBody } from '../src/sim/tank/body.js';

test('exhaust follows the full hull pose and velocity on a slope', () => {
  const body = new RigidBody(1000, [200, 200, 200], [0, .8, 0]);
  body.place([10, 2, 20], .7);
  body.w = [.25, 0, -.2];
  body.integratePosition(.8);
  body.v = [3, 1, -2];
  const outlet = { pos: [.55, 1.12, -2.75], dir: [0, 0, -1] };
  const particles = [];
  const exhaust = new Exhaust({ spawn: p => particles.push(p) }, { outlets: [outlet], diesel: false });
  exhaust.updateHull(.2, body, .4, .5);
  assert.ok(particles.length > 0);
  const point = body.worldPoint(outlet.pos), direction = body.worldDir(outlet.dir);
  for (const p of particles) {
    assert.deepEqual(p.pos, point);
    // Particle jitter is bounded, so the engine's actual 3D motion and outlet
    // direction must account for the initial velocity on every axis.
    const work = Math.min(1, .15 + .5 * .4 + .35 * .5 + exhaust.burst * .6);
    const speed = 1.2 + 2.5 * work;
    p.vel.forEach((v, i) => assert.ok(Math.abs(v - (body.v[i] * .6 + direction[i] * speed + (i === 1 ? .4 : 0))) <= .125));
  }
  assert.ok(Math.abs(point[1] - (body.origin()[1] + outlet.pos[1])) > .1,
    'the rear outlet height must change with hull pitch/roll');
});
