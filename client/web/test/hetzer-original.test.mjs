import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GeoBuilder, STRIDE } from '../src/gfx/geo.js';
import { addPart, materials } from '../src/gfx/tankmodel.js';

const bundle = id => {
  const root = new URL(`../../../data/vehicles/${id}/`, import.meta.url);
  const visual = JSON.parse(fs.readFileSync(new URL('visual.json', root), 'utf8'));
  const crew = JSON.parse(fs.readFileSync(new URL('crew.json', root), 'utf8'));
  return { visual, crew, mats: materials(visual.palette) };
};
const vertices = (part, mats) => {
  const b = new GeoBuilder();
  addPart(b, part, [0, 0, 0], mats);
  const out = [];
  for (let i = 0; i < b.data.length; i += STRIDE) out.push(b.data.slice(i, i + 3));
  return out;
};

test('Hetzer fixed collar follows the glacis without the protruding angular block', () => {
  const { visual, mats } = bundle('de_hetzer');
  const collar = visual.parts[12];
  const len = Math.hypot(2.39, 1);
  const relief = vertices(collar, mats).map(p => ((p[1] - 1.27) * 2.39 + p[2] - 2.33) / len);
  assert.ok(Math.max(...relief) <= 0.06, `collar projects ${Math.max(...relief)}m away from the glacis`);
  assert.ok(Math.min(...relief) <= 0, 'collar must engage the glacis');
  assert.equal(collar.mount, 'hull', 'the fixed collar belongs to the glacis, while the Saukopf moves');
  const b = new GeoBuilder();
  addPart(b, collar, [0, 0, 0], mats);
  for (let i = 0; i < b.data.length; i += STRIDE) {
    const d = ((b.data[i + 1] - 1.27) * 2.39 + b.data[i + 2] - 2.33) / len;
    const facing = (b.data[i + 4] * 2.39 + b.data[i + 5]) / len;
    if (d > 0.044 && Math.abs(facing) > 0.99) assert.ok(facing > 0, 'exposed collar face must point outward');
  }
  for (let i = 0; i < b.data.length; i += STRIDE * 3) {
    const center = [0, 1, 2].map(k => (b.data[i + k] + b.data[i + STRIDE + k] + b.data[i + STRIDE * 2 + k]) / 3);
    const radial = ((center[0] - 0.38) / 0.29) ** 2 + ((center[1] - 1.47) / 0.22) ** 2;
    assert.ok(radial > 0.75, 'fixed collar must leave the central moving gun aperture open');
  }
});

test('Hetzer rear grille rests on the rear deck rather than crossing it at the opposite slope', () => {
  const { visual, mats } = bundle('de_hetzer');
  const grille = visual.parts.find(p => p.type === 'box' && p.mat === 'black' && p.pos[2] < -1.5 && p.size[0] > 0.8);
  const len = Math.hypot(1.21, 0.62);
  const relief = vertices(grille, mats).map(p => ((p[1] - 1.89) * 1.21 - (p[2] + 1.20) * 0.62) / len);
  assert.ok(Math.max(...relief) <= 0.035, `grille rises ${Math.max(...relief)}m above the rear deck`);
  assert.ok(Math.min(...relief) >= -0.012, 'grille must not disappear into the deck');
});

for (const id of ['de_hetzer', 'de_hetzer_flak', 'de_flakpz38t']) {
  test(`${id} exhaust starts at the rear tailpipe mouth`, () => {
    const { visual } = bundle(id);
    const outlets = visual.exhaust?.outlets;
    assert.equal(outlets?.length, 1, 'use one explicit physical tailpipe outlet');
    const pipe = visual.parts.find(p => p.type === 'cyl' && p.axis === 'z' && p.mat === 'black' && p.pos[2] < -2.2 && p.r < 0.05);
    assert.ok(pipe, 'tailpipe must be present in the model');
    const end = [pipe.pos[0], pipe.pos[1], pipe.pos[2] - pipe.len / 2];
    assert.ok(Math.hypot(...end.map((v, k) => v - outlets[0].pos[k])) < 0.006,
      `exhaust ${outlets[0].pos} must start at tailpipe end ${end}`);
    assert.ok(outlets[0].dir[2] < -0.9, 'rear pipe points aft');
  });
}

test('Flakpanzer gunner seat supports the pelvis instead of cutting through the chest', () => {
  const { visual, crew, mats } = bundle('de_flakpz38t');
  const gunner = crew.find(c => c.role === 'gunner');
  const seat = visual.parts.find(p => p.type === 'box' && p.mount === 'turret' && p.mat === 'black' &&
    p.size[0] === 0.36 && p.size[1] === 0.06 && p.size[2] === 0.30);
  const hi = Math.max(...vertices(seat, mats).map(p => p[1]));
  assert.ok(gunner.pos.y - hi > 0.28 && gunner.pos.y - hi < 0.4,
    `seat top ${hi} must sit below the chest at ${gunner.pos.y}`);
  const post = visual.parts.find(p => p.type === 'cyl' && p.mount === 'turret' && p.axis === 'y' && p.r === 0.03 &&
    Math.abs(p.pos[2] - seat.pos[2]) < 0.01);
  assert.ok(Math.abs(post.pos[1] - post.len / 2 - 1.035) < 0.015, 'seat post must engage the compartment floor');
});
