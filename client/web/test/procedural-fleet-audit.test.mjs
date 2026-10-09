import test from 'node:test';
import assert from 'node:assert/strict';
import { GeoBuilder } from '../src/gfx/geo.js';
import { addPart, materials } from '../src/gfx/tankmodel.js';
import { makePiece, surfaceCrossings, touches, topologyStatistics, runtimeParts } from '../tools/procedural-fleet-audit.mjs';
import { loadData } from '../tools/load-data.mjs';

const box = (name, pos, size) => {
  const b = new GeoBuilder();
  addPart(b, { type: 'box', pos, size }, [0, 0, 0], materials({}));
  return makePiece(name, b.data);
};

test('detects a narrow crossing at a triangle rim excluded by the older 2% trim', () => {
  const a = makePiece('a', [[[-1, 0, 0], [1, 0, 0], [0, 1, 0]]], true);
  const b = makePiece('b', [[[0.99, -0.02, -1], [0.99, 0.02, 1], [0.99, 0.02, -1]]], true);
  assert.ok(surfaceCrossings(a, b).count > 0);
});

test('does not mistake a fully contained attached sleeve for a floating component', () => {
  assert.equal(touches(box('sleeve', [0, 0, 0], [.2, .2, .2]), box('mount', [0, 0, 0], [1, 1, 1])), true);
  assert.equal(touches(box('loose', [0, 1.2, 0], [.2, .2, .2]), box('mount', [0, 0, 0], [1, 1, 1])), false);
});

test('recognizes edge-to-edge support where narrow rails cross a transverse bearer', () => {
  assert.equal(touches(box('rail', [.42, .66, 0], [.1, .16, 5.9]),
    box('bearer', [0, .845, .3], [1, .21, .08])), true);
});

test('welds flat-normal seams and identifies a deliberately missing box face', () => {
  const p = box('box', [0, 0, 0], [1, 1, 1]);
  assert.equal(topologyStatistics(p).boundaryEdges, 0);
  p.tris = p.tris.slice(2);
  assert.equal(topologyStatistics(p).boundaryEdges, 4);
});

test('part transforms match actual buildTank nodes including bore, recoil and folding', () => {
  const data = loadData();
  for (const id of ['de_pz3_j', 'de_flakpz38t', 'us_m901_itv']) {
    const runtime = runtimeParts(id, data);
    const neutral = runtime.at({ yaw: 0, pitch: 0, recoil: 0, fold: 0 });
    assert.equal(neutral.length, data.vehicles[id].visual.parts.length + runtime.machineGunPieces);
    const changed = runtime.at({ yaw: .41, pitch: .27, recoil: 1, fold: .5 });
    assert.ok(changed.every(p => p.tris.flat(2).every(Number.isFinite)));
    assert.ok(runtime.maxRuntimeError < 1e-5, `${id}: ${runtime.maxRuntimeError}`);
  }
});
