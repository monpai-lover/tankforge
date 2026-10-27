import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../bundle/app.js.html', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('  function m4()'),
  source.indexOf('  // client/web/src/game/relief.js')) +
  fs.readFileSync(new URL('../tools/frontline_lod.js', import.meta.url), 'utf8'), context);
const bundle = id => Object.fromEntries(['vehicle', 'weapons', 'visual'].map(name => [name,
  JSON.parse(fs.readFileSync(new URL(`../../data/vehicles/${id}/${name}.json`, import.meta.url), 'utf8'))]));
const point = (m, p) => [0, 1, 2].map(k => m[k] * p[0] + m[4+k] * p[1] + m[8+k] * p[2] + m[12+k]);

test('distant LOD uses actual catalog dimensions, stays below 200 triangles and owns only three persistent meshes', () => {
  for (const id of ['su_t72a', 'de_tiger_e', 'us_m4a2', 'de_gepard']) {
    let uploads = 0, frees = 0;
    const renderer = {mesh(data) {uploads++;return {count:data.length / 13, data};}, freeMesh(){frees++;}};
    const b = bundle(id), lod = context.createFrontlineLod(renderer, b);
    assert.equal(uploads, 3); assert.equal(lod.meshes.length, 3);
    assert.ok(lod.meshes.reduce((n, m) => n + m.count / 3, 0) < 200, id);
    assert.ok(lod.meshes.every(m => m.data.every(Number.isFinite)), id);
    const verts = lod.body.mesh.data, xs = [], zs = [];
    for (let i = 0; i < verts.length; i += 13) {xs.push(verts[i]);zs.push(verts[i+2]);}
    assert.ok(Math.abs(Math.max(...xs) - b.vehicle.hull.size_m[0] / 2) < .01, `${id} width`);
    assert.ok(Math.max(...zs) <= b.vehicle.hull.size_m[2] / 2 + .1, `${id} track/hull length`);
    const offset = b.weapons.muzzle_offset_m ?? b.weapons.main_gun.barrel_length_mm / 1000;
    const barrelZ = [];
    for (let i = 0; i < lod.gun.mesh.data.length; i += 13) barrelZ.push(lod.gun.mesh.data[i+2]);
    assert.ok(Math.abs(Math.max(...barrelZ)-offset)<1e-5, `${id} actual mesh muzzle cap`);
    assert.ok(Math.abs(Math.min(...barrelZ)-(offset-b.weapons.main_gun.barrel_length_mm/1000))<1e-5, `${id} full source barrel length`);
    const u = {pos:[100,20,200], net:{ex:[0,0,-1], ez:[1,0,0]}, turret_yaw:Math.PI/2, gun_pitch:Math.PI/6};
    for (let i = 0; i < 100; i++) assert.equal(lod.pose(u), true);
    assert.equal(uploads, 3, 'pose must not allocate GPU meshes');
    lod.root.update();
    const muzzle = point(lod.gun.world, [0,0,offset]);
    const mount = b.weapons.mount_m, pivot = b.vehicle.turret.position_m;
    const expected = [100+pivot[2]-(mount[0]-pivot[0]), 20+mount[1]+offset*.5,
      200-pivot[0]-(mount[2]-pivot[2])-offset*Math.cos(Math.PI/6)];
    for (let k=0;k<3;k++) assert.ok(Math.abs(muzzle[k]-expected[k])<2e-5, `${id} accepted body/turret/pitch transform`);
    const xsBefore = Array.from(lod.body.local);
    assert.equal(lod.pose({...u, pos:[NaN,20,200]}), false);
    assert.deepEqual(Array.from(lod.body.local), xsBefore);
    lod.dispose();lod.dispose();assert.equal(frees, 3);assert.equal(lod.pose(u), false);
  }
});
