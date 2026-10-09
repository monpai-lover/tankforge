import test from 'node:test';
import assert from 'node:assert/strict';
import { GeoBuilder, STRIDE } from '../src/gfx/geo.js';
import { Node, mul, rotY, rotX, translation, transformPoint } from '../src/gfx/math.js';
import { statusViewDistance } from '../src/game/statusview.js';

const material = { color: [0.3, 0.3, 0.3], rough: 0.7, metal: 0.1 };
function box(size, world = translation(0, 0, 0)) {
  const b = new GeoBuilder();
  b.box(translation(0, 0, 0), false, size, material);
  const node = new Node('test vehicle part');
  node.world = world;
  node.mesh = { _src: { data: b.build() } };
  return node;
}

function projectedRadius(nodes, center, distance, tan) {
  let radius = 0;
  for (const node of nodes) {
    const mesh = node.mesh;
    for (let instance = 0; instance < (mesh.instanced ? mesh.instances : 1); instance++) {
      const im = mesh.instanced ? mesh._src.matrices.subarray(instance * 16, instance * 16 + 16) : null;
      const vertices = mesh._src.data;
      for (let i = 0; i < vertices.length; i += STRIDE) {
        let p = [vertices[i], vertices[i + 1], vertices[i + 2]];
        if (im) p = transformPoint(im, p);
        p = transformPoint(node.world, p);
        radius = Math.max(radius, Math.hypot(p[0] - center[0], p[2] - center[2]) / ((distance - (p[1] - center[1])) * tan));
      }
    }
  }
  return radius;
}

test('fits the complete footprint to a circle, including perspective from tall geometry', () => {
  const nodes = [box([4, 6, 8])];
  const center = [0, 0, 0];
  const tan = Math.tan(9 * Math.PI / 360);
  const distance = statusViewDistance(nodes, center, tan);
  assert.ok(Math.abs(distance - (3 + Math.hypot(2, 4) / (0.82 * tan))) < 1e-6);
  assert.ok(projectedRadius(nodes, center, distance, tan) <= 0.820001);
});

test('fits a live gun turned sideways and backwards without relying on forward-only dimensions', () => {
  const hull = box([3, 2, 6]);
  const gun = box([0.3, 0.3, 5]);
  const center = [20, 1, -30];
  const tan = Math.tan(9 * Math.PI / 360);
  hull.world = translation(...center);
  for (const yaw of [0, Math.PI / 2, Math.PI]) {
    gun.world = mul(translation(...center), mul(rotY(yaw), translation(0.6, 2, 3)));
    const nodes = [hull, gun];
    const distance = statusViewDistance(nodes, center, tan);
    assert.ok(projectedRadius(nodes, center, distance, tan) <= 0.820001, `yaw=${yaw}`);
  }
});

test('includes both animated track instances and follows changed instance transforms', () => {
  const track = box([0.5, 0.2, 0.3], mul(translation(10, 0, -4), rotX(0.15)));
  track.mesh.instanced = true;
  track.mesh.instances = 2;
  track.mesh._src.matrices = new Float32Array(32);
  track.mesh._src.matrices.set(translation(-2, 0, -3), 0);
  track.mesh._src.matrices.set(translation(2, 0, 3), 16);
  const center = [10, 0, -4];
  const tan = 0.08;
  const before = statusViewDistance([track], center, tan);
  assert.ok(projectedRadius([track], center, before, tan) <= 0.820001);
  track.mesh._src.matrices.set(translation(2, 0, 6), 16);
  const after = statusViewDistance([track], center, tan);
  assert.ok(after > before);
  assert.ok(projectedRadius([track], center, after, tan) <= 0.820001);
});
