import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STRIDE, GeoBuilder } from '../src/gfx/geo.js';
import { buildTank, materials, addPart } from '../src/gfx/tankmodel.js';
import { stationsOf, buildLoop, wheelGeometry } from '../src/gfx/track.js';
import { gearFromVisual } from '../src/sim/tank/tank.js';

const bundle = id => {
  const root = new URL(`../../../data/vehicles/${id}/`, import.meta.url);
  const read = name => JSON.parse(fs.readFileSync(new URL(name, root), 'utf8'));
  return { vehicle: read('vehicle.json'), visual: read('visual.json'), turrets: [] };
};
const vertices = mesh => {
  const out = [];
  for (let i = 0; i < mesh.length; i += STRIDE) out.push(Array.from(mesh.slice(i, i + STRIDE)));
  return out;
};
const sameColor = (p, mat) => mat.color.every((c, k) => Math.abs(p[k + 6] - c) < 1e-6);
const renderer = {
  mesh: data => ({ data, count: data.length / STRIDE }),
  instancedMesh: data => ({ data, count: data.length / STRIDE }),
  setInstances(mesh, matrices, count) { mesh.matrices = matrices.slice(); mesh.instances = count; },
  freeMesh() {},
};

for (const [id, count, width] of [['us_m4a3_76w_hvss', 6, .42], ['us_m901_itv', 5, .30]]) {
  test(`${id}: paired discs retain axle count, tyre footprint and guide channel`, () => {
    const { visual } = bundle(id);
    const rg = visual.running_gear;
    const stations = stationsOf(rg);
    assert.equal(stations.length, count);
    assert.deepEqual(gearFromVisual(rg).stations, stations, 'render and simulation agree about axles');
    for (const s of stations) {
      const pair = rg.wheels.filter(w => w.z === s.z).sort((a, b) => a.x - b.x);
      assert.equal(pair.length, 2, `${id} axle ${s.z} has two separate discs`);
      assert.ok(pair[0].x < 0 && pair[1].x > 0);
      assert.ok(Math.abs(pair[0].x + pair[1].x) < 1e-9);
      const gap = pair[1].x - pair[1].w / 2 - (pair[0].x + pair[0].w / 2);
      assert.ok(gap >= .09, `tyres leave the center guide channel: ${gap}`);
      assert.ok(Math.abs(pair[1].x + pair[1].w / 2 - (pair[0].x - pair[0].w / 2) - width) < 1e-6);
      const mats = materials(visual.palette);
      const points = pair.flatMap(w => vertices(wheelGeometry(w.r, w.w, rg.wheel_style, mats)).map(p => {
        p[0] += w.x;
        return p;
      }));
      const tyres = points.filter(p => sameColor(p, mats.rubber));
      assert.ok(tyres.length > 0, 'road wheels have rubber tyres');
      const tyreTriangles = [];
      for (let i = 0; i < tyres.length; i += 3) {
        tyreTriangles.push(tyres.slice(i, i + 3).map(p => p.slice(0, 3).map(n => n.toFixed(6)).join(',')).sort().join('|'));
      }
      assert.equal(new Set(tyreTriangles).size, tyreTriangles.length, 'each disc has one tyre surface without coincident duplicate triangles');
      assert.ok(tyres.every(p => Math.abs(p[0]) > .025), 'rubber never closes the guide channel');
      assert.ok(points.every(p => Math.hypot(p[1], p[2]) < s.r * .30 || Math.abs(p[0]) >= .025 - 1e-6),
        'only the narrow axle/hub may bridge the wheel pair');
      assert.ok(Math.max(...tyres.map(p => Math.abs(p[0]))) <= rg.track_width / 2, 'tyres remain under their track');
    }
    const single = { ...rg, wheels: stations.map(s => ({ ...s, x: 0, w: width })) };
    assert.deepEqual(buildLoop(rg, stations, null, rg.track_sag).pts,
      buildLoop(single, stationsOf(single), null, rg.track_sag).pts, 'paired discs must not add belt support points');
  });

  test(`${id}: each complete wheel pair moves and spins on its own station`, () => {
    const model = buildTank(renderer, bundle(id), () => []);
    const road = model.wheels.filter(w => w.role === 'road_wheel');
    assert.equal(road.length, count * 4, 'two discs on every axle on both sides');
    const before = road.map(w => [...w.node.pos]);
    const lifts = { 1: Array.from({ length: count }, (_, i) => .012 * (i + 1)), [-1]: Array.from({ length: count }, (_, i) => -.008 * (i + 1)) };
    model.updateRunningGear({ lifts, travel: { 1: .19, [-1]: -.27 } });
    for (const side of [1, -1]) for (let station = 0; station < count; station++) {
      const pair = road.filter(w => w.side === side && w.station === station);
      assert.equal(pair.length, 2);
      assert.ok(pair[0].node.mesh === pair[1].node.mesh, 'same disc shape is shared, not duplicated at the same position');
      assert.notEqual(pair[0].node.pos[0], pair[1].node.pos[0]);
      assert.equal(pair[0].node.pos[1], pair[1].node.pos[1]);
      assert.equal(pair[0].node.pitch, pair[1].node.pitch);
      for (const w of pair) {
        const initial = before[road.indexOf(w)];
        assert.ok(Math.abs(w.node.pos[1] - initial[1] - lifts[side][station]) < 1e-9);
        assert.equal(w.node.pos[0], initial[0]);
        assert.equal(w.node.pos[2], initial[2]);
        assert.equal(w.node.pitch, (side === 1 ? .19 : -.27) / w.r);
        assert.ok(vertices(w.node.mesh.data).some(p => Math.hypot(p[1], p[2]) < .07 && Math.abs(p[0]) > .08),
          'the axle/hub belongs to the moving wheel mesh');
      }
    }
    const tracks = model.running.children.find(n => n.name === 'tracks').mesh;
    assert.equal(tracks.instances, model.linkCount * 2);
    assert.ok([...tracks.matrices].every(Number.isFinite), 'track link placement survives independently lifted pairs');
    model.updateRunningGear({ lifts, travel: { 1: .19, [-1]: -.27 }, lod: 2 });
    assert.ok(road.every(w => w.node.pos[1] === w.node.baseY), 'both discs return to static height at the far LOD');
  });
}

test('HVSS wheel discs have solid dished faces without false through-hole rods', () => {
  const { visual } = bundle('us_m4a3_76w_hvss');
  const mats = materials(visual.palette);
  const points = vertices(wheelGeometry(.26, .16, 'hvss_dish', mats));
  assert.ok(points.every(p => !sameColor(p, mats.black)), 'HVSS plates must not contain the generic fake lightening-hole rods');
  assert.ok(points.filter(p => sameColor(p, mats.steel)).every(p => Math.abs(p[0]) > .08),
    'each face has short bolt heads rather than rods crossing the wheel');
});

test('HVSS central swing arms connect wheel axles to supported horizontal spring bodies', () => {
  const { visual } = bundle('us_m4a3_76w_hvss');
  const rg = visual.running_gear;
  const mats = materials(visual.palette);
  const arms = visual.parts.filter(p => p.name?.startsWith('hvss_swing_arm_'));
  assert.equal(arms.length, 12, 'six center arms per side');
  for (const side of [1, -1]) for (const s of stationsOf(rg)) {
    const arm = arms.find(p => p.x === side * rg.track_x && p.profile.some(([z]) => Math.abs(z - s.z) < .05));
    assert.ok(arm, `${side}:${s.z} wheel axle has a suspension arm`);
    const b = new GeoBuilder();
    addPart(b, arm, [0, 0, 0], mats);
    assert.ok(b.min[1] < s.y && b.max[1] > .65);
    assert.ok(arm.w < .08, 'central arm remains in the open tyre gap');
  }
  const springs = visual.parts.filter(p => p.type === 'cyl' && p.axis === 'z' && p.len === .46 && p.mirror);
  assert.equal(springs.length, 3);
  for (const spring of springs) assert.ok(spring.pos[1] - spring.r > .315 + .26,
    'horizontal spring body clears the static tyre envelope');
});
