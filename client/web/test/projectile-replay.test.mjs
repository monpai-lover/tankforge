import test from 'node:test';
import assert from 'node:assert/strict';
import { HitCam } from '../src/game/hitcam.js';
import { Node, project, transformPoint } from '../src/gfx/math.js';

function fixture(outcome = 'penetrated', extra = {}, shell = { kind: 'ap', caliber_mm: 75 }) {
  const elements = new Map();
  const root = { hidden: true, style: {}, dataset: {}, querySelector: selector => {
    if (!elements.has(selector)) elements.set(selector, { style: {}, dataset: {} });
    return elements.get(selector);
  } };
  const renderer = { uploads: 0, last: [], mesh(data) { this.uploads++; return { data }; }, renderInset(nodes) { this.last = nodes.slice(); } };
  const hc = new HitCam({ root, renderer });
  const hull = new Node('hull'); hull.mesh = {}; hull.kind = 9;
  const target = { name: 'target', body: { worldPoint: p => p.slice(), worldDir: p => p.slice() }, model: { shellNodes: [hull], root: hull }, armor: [], interior: () => null };
  const rep = { impact: [0, 1, 0], outcome, path: [[0, 1, 0], [0, 1, 1], [0, 1, 5]], shot: { dir: [0, 0, 1] }, fragments: [], bursts: [], modules: [], crew: [], caps: {}, title: outcome, ...extra };
  const frame = { cw: 1280, ch: 800, scale: 1, nodes: [hull] };
  hc.show(target, rep, shell, 100);
  const at = t => { hc.cur.t = t; hc.render3d(frame); return renderer.last.find(n => n.name === 'replay_projectile'); };
  return { hc, renderer, target, rep, frame, at };
}

function tip(node) { assert.ok(node, 'a visible projectile mesh must accompany the trace'); return Array.from(node.world.slice(12, 15)); }
function close(a, b) { a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-5, `${a} != ${b}`)); }

test('replay shows an oriented, readable projectile during incoming flight', () => {
  const f = fixture();
  const n = f.at(0.45);
  close(tip(n), [0, 1, -4.5]);
  assert.ok(n.world[10] > 0 && n.world[0] >= .14, 'nose points into the armour; diameter is enlarged for the inset');
  assert.equal(n.castShadow, false, 'the explanatory round must not alter the main scene');
});

test('approach camera keeps the complete enlarged shell within the picture throughout flight', () => {
  const f = fixture();
  for (const time of [.18, .45, .72]) {
    const n = f.at(time);
    const vertices = n.mesh.data;
    for (let i = 0; i < vertices.length; i += 13) {
      const p = project(f.hc.cur.cam.viewProj, transformPoint(n.world, vertices.slice(i, i + 3)));
      assert.ok(p[2] > 0 && Math.abs(p[0]) < .98 && Math.abs(p[1]) < .98, `whole shell at ${time}s must fit: ${p}`);
    }
  }
});

test('the flying shell is steel with a narrow copper driving band rather than a brass cartridge', () => {
  const n = fixture().at(.45);
  let copper = 0;
  for (let i = 0; i < n.mesh.data.length; i += 13) if (n.mesh.data[i + 6] > n.mesh.data[i + 8]) copper++;
  assert.ok(copper / (n.mesh.data.length / 13) < .2, 'copper is confined to the narrow rear driving band');
});

test('penetration advances by physical distance over unequal report segments and persists through hold', () => {
  const f = fixture();
  close(tip(f.at(.9 + .45 + 2.6 * .36)), [0, 1, 2.5]);
  close(tip(f.at(.9 + .45 + 2.6 + .7)), [0, 1, 5]);
  assert.deepEqual(f.rep.path, [[0, 1, 0], [0, 1, 1], [0, 1, 5]], 'presentation cannot mutate the authoritative path');
});

test('stopped round holds at the reported contact without inventing an interior trajectory', () => {
  const f = fixture('stopped', { path: [[0, 1, 0]] });
  close(tip(f.at(1.4)), [0, 1, 0]);
  close(tip(f.at(f.hc.cur.total - .4)), [0, 1, 0]);
});

test('ricochet progressively follows only the reported reflection and keeps the nose aligned', () => {
  const f = fixture('ricochet', { path: [[0, 1, 0]], ricochet_dir: [1, 0, 0] });
  const n = f.at(.9 + .45 + .75);
  close(tip(n), [3, 1, 0]);
  assert.ok(n.world[8] > 0 && Math.abs(n.world[10]) < 1e-5);
  close(tip(f.at(f.hc.cur.total - .4)), [6, 1, 0]);
});

test('HEAT shell remains outside while the separately rendered jet follows the authoritative path', () => {
  const f = fixture('penetrated', {}, { kind: 'heat', caliber_mm: 90 });
  close(tip(f.at(.9 + .45 + 2.6 * .36)), [0, 1, 0]);
  const jet = f.renderer.last.find(n => n.name === 'replay_jet');
  close(tip(jet), [0, 1, 2.5]);
  assert.notEqual(jet.mesh, f.renderer.last.find(n => n.name === 'replay_projectile').mesh);
});

test('repeated replays reuse GPU meshes and restore the vehicle rendering state', () => {
  const f = fixture();
  f.at(1.8);
  const uploads = f.renderer.uploads;
  assert.ok(uploads > 0);
  const mesh = f.renderer.last.find(n => n.name === 'replay_projectile').mesh;
  for (let i = 0; i < 20; i++) {
    f.hc.show(f.target, f.rep, { kind: i % 2 ? 'heat' : 'ap', caliber_mm: 75 }, 100);
    f.at(1.8);
    assert.equal(f.renderer.last.find(n => n.name === 'replay_projectile').mesh, mesh);
    assert.equal(f.target.model.root.kind, 9);
  }
  assert.equal(f.renderer.uploads, uploads, 'no mesh upload per report or frame');
});
