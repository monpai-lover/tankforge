import test from 'node:test';
import assert from 'node:assert/strict';
import * as visuals from '../src/game/projectileVisuals.js';
import { loadData } from '../tools/load-data.mjs';
import { bulletShell } from '../src/game/combat.js';
import { GeoBuilder, IDENTITY } from '../src/gfx/geo.js';

const data = loadData();
const { projectileProfile, buildProjectileGeometry, ProjectileVisualPool, projectileDisplayTransform, projectileTriangleData } = visuals;
const close = (a, b, eps = 2e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const unit = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const point = (g, i) => Array.from(g.vertices.subarray(i * 13, i * 13 + 3));
const normal = (g, i) => Array.from(g.vertices.subarray(i * 13 + 3, i * 13 + 6));
const recorded = kind => ({ kind, recorded: true, source: 'fixture_event', time_s: .125 });

// Independent oracle: V3 src/gl.js:31–38, copyright 2026 Replay Lab Contributors (MIT).
// Kept here rather than importing the adapted helper under test.
function sourceLathe(profile, segments = 40) {
  const p = [], n = [], indices = [];
  for (let j = 0; j < profile.length; j++) {
    const [x, r] = profile[j], prev = profile[Math.max(0, j - 1)], next = profile[Math.min(profile.length - 1, j + 1)];
    const slope = (next[1] - prev[1]) / Math.max(next[0] - prev[0], .0001);
    for (let k = 0; k <= segments; k++) {
      const a = k / segments * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      p.push(x, r * c, r * s); n.push(...unit([-slope, c, s]));
    }
  }
  for (let j = 0; j < profile.length - 1; j++) for (let k = 0; k < segments; k++) {
    const a = j * (segments + 1) + k, b = a + segments + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { p, n, indices };
}

test('profile uses every real catalog body dimension without changing the catalog', () => {
  const before = JSON.stringify(data);
  assert.equal(typeof projectileProfile, 'function');
  const families = new Set();
  for (const shell of Object.values(data.projectiles)) {
    const p = projectileProfile(shell);
    families.add(p.family);
    assert.equal(p.id, shell.id);
    close(p.lengthM, shell.length_mm / 1000, 1e-12);
    close(p.diameterM, shell.caliber_mm / 1000, 1e-12);
    assert.equal(p.provenance.dimensions.lengthM.status, 'catalog');
    assert.equal(p.provenance.dimensions.diameterM.status, 'catalog');
    assert.equal(p.provenance.fineShape, 'v3_display_profile_v1');
    assert.ok(Object.isFrozen(p) && Object.isFrozen(p.roles));
  }
  assert.deepEqual([...families].sort(), ['ap', 'apcbc', 'apcr', 'apds', 'apfsds', 'aphe', 'he', 'heat', 'heat_fs']);
  const aphe = projectileProfile(data.projectiles.aphe_122_br471);
  assert.equal(aphe.lengthM, .451);
  assert.equal(aphe.diameterM, .12192);
  assert.equal(JSON.stringify(data), before);
});

test('catalog cap and explosive fuze facts refine the shared AP/APHE V3 branch', () => {
  const ap = projectileProfile(data.projectiles.ap_75_m72);
  const aphe = projectileProfile(data.projectiles.aphe_122_br471);
  const apbc = projectileProfile(data.projectiles.apbc_100_br412);
  const apc = projectileProfile(data.projectiles.apc_90_m318);
  const apcbc = projectileProfile(data.projectiles.apcbc_75_pzgr39);
  assert.ok(ap.roles.includes('ogive') && !ap.roles.includes('fuze'));
  assert.ok(aphe.roles.includes('fuze'));
  assert.ok(apbc.roles.includes('ballistic_cap'));
  assert.ok(apc.roles.includes('penetration_cap'));
  assert.ok(apcbc.roles.includes('ballistic_cap') && apcbc.roles.includes('penetration_cap') && apcbc.roles.includes('fuze'));
  assert.equal(apbc.provenance.capIdentity.source, 'catalog.id');
  assert.equal(aphe.provenance.fuzeIdentity.source, 'catalog.explosive_mass_kg');
  assert.equal(aphe.provenance.fuzeDimensions, 'v3_display_profile_v1');
});

test('missile dimensions describe the whole body rather than the warhead and absent fine fields remain estimates', () => {
  for (const def of Object.values(data.missiles)) {
    const p = projectileProfile(data.projectiles[def.warhead], def);
    assert.equal(p.id, def.id);
    assert.equal(p.lengthM, def.length_m);
    assert.equal(p.diameterM, def.caliber_mm / 1000);
    assert.equal(p.spanM, def.span_m);
    assert.equal(p.family, def.guidance === 'none' ? 'rocket' : 'missile');
    assert.equal(p.provenance.dimensions.spanM.source, 'missile.span_m');
    assert.equal(p.provenance.finChord, 'v3_display_profile_v1');
    assert.equal(p.provenance.finThickness, 'v3_display_profile_v1');
  }
  const unknown = projectileProfile({ id: 'unknown-warhead', kind: 'heat', caliber_mm: 90, length_mm: 300 }, { id: 'unknown-missile', guidance: 'saclos', caliber_mm: 150 });
  assert.equal(unknown.lengthM, null, 'warhead length cannot become a fake exact missile length');
  assert.equal(unknown.spanM, null);
  assert.equal(unknown.provenance.dimensions.lengthM.status, 'unknown');
  assert.equal(unknown.provenance.dimensions.spanM.status, 'unknown');
  assert.equal(buildProjectileGeometry(unknown).visibility, 'unknown');
});

test('MG bullets use real caliber and explicitly estimated length; autocannon retains ballistic family', () => {
  for (const mg of Object.values(data.machineGuns)) {
    for (const input of [mg, bulletShell(mg)]) {
      const p = projectileProfile(input);
      assert.equal(p.family, 'mg');
      assert.equal(p.weaponClass, 'mg');
      assert.equal(p.diameterM, mg.caliber_mm / 1000);
      assert.equal(p.provenance.dimensions.lengthM.status, 'estimated');
      const g = buildProjectileGeometry(p);
      assert.ok(g.parts.some(part => part.role === 'jacket'));
    }
  }
  const cannon = projectileProfile(data.projectiles.apt_20_pzgr39);
  assert.equal(cannon.family, 'ap');
  assert.equal(cannon.weaponClass, 'autocannon');
  assert.ok(cannon.roles.includes('tracer_base'));
});

test('all actual catalog families have finite indexed STRIDE13 geometry with true +Z nose bounds', () => {
  const inputs = [...Object.values(data.projectiles).map(s => [s]), ...Object.values(data.missiles).map(m => [data.projectiles[m.warhead], m])];
  for (const args of inputs) {
    const p = projectileProfile(...args), g = buildProjectileGeometry(p);
    assert.equal(g.stride, 13);
    assert.ok(g.vertices instanceof Float32Array && g.indices instanceof Uint32Array);
    assert.ok(g.vertices.length > 0 && g.indices.length > 0, p.id);
    assert.ok(Array.from(g.vertices).every(Number.isFinite), p.id);
    assert.ok(Array.from(g.indices).every(i => i < g.vertices.length / 13), p.id);
    close(g.bounds.max[2], 0);
    close(g.bounds.min[2], -p.lengthM);
    assert.ok(g.parts.every(part => p.roles.includes(part.role)));
    assert.ok(g.parts.every(part => part.vertexCount > 0 && part.indexCount > 0));
    const radial = Math.max(...g.parts.filter(part => part.role !== 'fins' && part.role !== 'sabot').flatMap(part => {
      const out = []; for (let i = part.vertexStart; i < part.vertexStart + part.vertexCount; i++) { const v = point(g, i); out.push(Math.hypot(v[0], v[1])); } return out;
    }));
    close(radial * 2, p.diameterM);
    if (p.spanM != null) close(Math.max(g.bounds.max[0], g.bounds.max[1]) * 2, p.spanM);
  }
});

test('family signatures compare topology and normalized silhouettes rather than colors', () => {
  const signatures = new Map();
  const samples = [
    data.projectiles.ap_75_m72, data.projectiles.aphe_122_br471, data.projectiles.apcbc_75_pzgr39,
    data.projectiles.he_75_m48, data.projectiles.heat_75_gr38b, data.projectiles.heatfs_122_3bk9,
    data.projectiles.apcr_75_pzgr40, data.projectiles.apds_122_3bm11, data.projectiles.apfsds_35_pmc287,
    { id: 'hesh-test', kind: 'hesh', caliber_mm: 100, length_mm: 400 },
    bulletShell(data.machineGuns.mg34), data.projectiles.apt_20_pzgr39,
  ];
  for (const shell of samples) {
    const p = projectileProfile(shell), g = buildProjectileGeometry(p);
    const pos = [];
    for (let i = 0; i < g.vertices.length; i += 13) pos.push(...Array.from(g.vertices.subarray(i, i + 3)).map((x, j) => Math.round(x / (j === 2 ? p.lengthM : p.diameterM) * 1e4)));
    const sig = JSON.stringify([g.indices.length, g.parts.map(q => [q.role, q.vertexCount]), pos]);
    assert.ok(!signatures.has(sig), `${p.id} shares topology and silhouette with ${signatures.get(sig)}`);
    signatures.set(sig, p.id);
  }
  const rocket = buildProjectileGeometry(projectileProfile(data.projectiles.he_420_tt250, data.missiles.tt250_rocket));
  const missile = buildProjectileGeometry(projectileProfile(data.projectiles.heat_152_tow, data.missiles.bgm71a_tow));
  assert.equal(rocket.parts.filter(p => p.role === 'fins').length, 4);
  assert.equal(missile.parts.filter(p => p.role === 'fins').length, 8);
});

test('APDS/APFSDS preserve three sector shoes and separate launch, core, and discarded-shoe prototypes', () => {
  for (const shell of [data.projectiles.apds_122_3bm11, data.projectiles.apfsds_35_pmc287]) {
    const p = projectileProfile(shell);
    const launch = buildProjectileGeometry(p, 'launch');
    const core = buildProjectileGeometry(p, recorded('core'));
    const sabot = buildProjectileGeometry(p, recorded('sabot'));
    assert.equal(launch.parts.filter(q => q.role === 'sabot').length, 3);
    assert.equal(sabot.parts.length, 3);
    assert.ok(sabot.parts.every(q => q.role === 'sabot' && q.vertexCount === 12 && q.indexCount === 18));
    assert.deepEqual(sabot.parts.map(q => q.id), ['sabot:0', 'sabot:1', 'sabot:2']);
    assert.ok(core.parts.every(q => q.role !== 'sabot'));
    assert.equal(core.parts.filter(q => q.role === 'fins').length, shell.kind === 'apfsds' ? 4 : 0);
    assert.equal(launch.indices.length, core.indices.length + sabot.indices.length);
    assert.equal(p.provenance.sabotDimensions, 'v3_display_profile_v1');
    // V3 sector shoes are three open three-face wedges, not an intact cylindrical sleeve.
    const first = sabot.parts[0];
    const a = point(sabot, first.vertexStart), b = point(sabot, first.vertexStart + 1);
    close(a[2] - b[2], -.31 * p.shape.axialScale);
    assert.ok(a[1] > 0 && b[1] > 0);
  }
});

test('proper R rotation preserves original V3 positions, inverse-transpose normals and source winding parity', () => {
  const cases = [
    ['apfsds_35_pmc287', [[-.49, 0], [-.49, .018], [.34, .018], [.49, 0]]],
    ['heatfs_122_3bk9', [[-.38, 0], [-.38, .067], [-.21, .081], [.03, .081], [.19, .040], [.41, .012], [.47, 0]]],
    ['he_75_m48', [[-.36, 0], [-.36, .112], [-.18, .124], [.13, .121], [.28, .082], [.39, .028], [.42, 0]]],
  ];
  for (const [id, sourceProfile] of cases) {
    const p = projectileProfile(data.projectiles[id]), g = buildProjectileGeometry(p), part = g.parts[0], oracle = sourceLathe(sourceProfile);
    assert.equal(part.vertexCount, oracle.p.length / 3);
    assert.deepEqual(Array.from(g.indices.subarray(part.indexStart, part.indexStart + part.indexCount)), oracle.indices);
    for (let i = 0; i < part.vertexCount; i++) {
      const s = oracle.p.slice(i * 3, i * 3 + 3), n = oracle.n.slice(i * 3, i * 3 + 3);
      const expectedPos = [-s[2] * p.shape.radialScale, s[1] * p.shape.radialScale, (s[0] - p.shape.sourceNose) * p.shape.axialScale];
      const expectedNormal = unit([-n[2] / p.shape.radialScale, n[1] / p.shape.radialScale, n[0] / p.shape.axialScale]);
      point(g, i).forEach((v, j) => close(v, expectedPos[j]));
      normal(g, i).forEach((v, j) => close(v, expectedNormal[j]));
    }
    const [a, b, c] = oracle.indices.slice(6 * 40, 6 * 40 + 3);
    const sourceFace = cross(sub(oracle.p.slice(b * 3, b * 3 + 3), oracle.p.slice(a * 3, a * 3 + 3)), sub(oracle.p.slice(c * 3, c * 3 + 3), oracle.p.slice(a * 3, a * 3 + 3)));
    const targetFace = cross(sub(point(g, b), point(g, a)), sub(point(g, c), point(g, a)));
    assert.equal(Math.sign(dot(sourceFace, oracle.n.slice(a * 3, a * 3 + 3))), Math.sign(dot(targetFace, normal(g, a))));
  }
});

test('source fin faces, cylinder ring tessellation and all three rotated shoes survive adaptation', () => {
  const p = projectileProfile(data.projectiles.apfsds_35_pmc287), g = buildProjectileGeometry(p, 'launch');
  const firstFin = g.parts.find(q => q.role === 'fins');
  assert.equal(firstFin.vertexCount, 8); assert.equal(firstFin.indexCount, 12);
  // Original source fin starts [x-length/2,.026,-width/2], at x=-.41,length=.15,width=.004.
  const finSource = [[-.485, .026, -.002], [-.335, .026, -.002], [-.395, .086, -.002], [-.485, .0645, -.002]];
  const finNormal = unit(cross(sub(finSource[1], finSource[0]), sub(finSource[2], finSource[0])));
  for (let i = 0; i < 4; i++) {
    const [x, y, z] = finSource[i];
    point(g, firstFin.vertexStart + i).forEach((v, j) => close(v, [-z * p.shape.radialScale, y * p.shape.radialScale, (x - p.shape.sourceNose) * p.shape.axialScale][j]));
    normal(g, firstFin.vertexStart + i).forEach((v, j) => close(v, unit([-finNormal[2] / p.shape.radialScale, finNormal[1] / p.shape.radialScale, finNormal[0] / p.shape.axialScale])[j]));
  }
  const ring = g.parts.find(q => q.role === 'band');
  assert.equal(ring.vertexCount, 4 * 25); assert.equal(ring.indexCount, 3 * 24 * 6);
  const ringOracle = sourceLathe([[-.5, 0], [-.5, 1], [.5, 1], [.5, 0]], 24);
  for (let i = 0; i < ring.vertexCount; i++) {
    const [nx, ny, nz] = ringOracle.n.slice(i * 3, i * 3 + 3);
    const expected = unit([-nz / (.025 * p.shape.radialScale), ny / (.025 * p.shape.radialScale), nx / (.035 * p.shape.axialScale)]);
    normal(g, ring.vertexStart + i).forEach((v, j) => close(v, expected[j]));
  }
  const shoes = g.parts.filter(q => q.role === 'sabot');
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3, sy = .027 * Math.cos(a) + .035 * Math.sin(a), sz = .027 * Math.sin(a) - .035 * Math.cos(a);
    point(g, shoes[i].vertexStart).forEach((v, j) => close(v, [-sz * p.shape.radialScale, sy * p.shape.radialScale, (-.18 - .05 - p.shape.sourceNose) * p.shape.axialScale][j]));
  }
});

test('only recorded stages terminate an intact body and unknown timing never creates a jet, burst or separation', () => {
  const p = projectileProfile(data.projectiles.aphe_122_br471);
  for (const kind of ['stopped', 'detonated', 'fractured', 'terminated']) {
    const g = buildProjectileGeometry(p, recorded(kind));
    assert.equal(g.visibility, 'none');
    assert.equal(g.vertices.length, 0);
    assert.equal(g.indices.length, 0);
    assert.equal(g.transitionKnown, true);
    const unknown = buildProjectileGeometry(p, { kind, time_s: null });
    assert.equal(unknown.visibility, 'unknown');
    assert.equal(unknown.transitionKnown, false);
    assert.equal(unknown.timeS, null);
  }
  const ds = projectileProfile(data.projectiles.apds_122_3bm11);
  assert.equal(buildProjectileGeometry(ds, { kind: 'core' }).visibility, 'unknown');
  assert.equal(buildProjectileGeometry(ds, recorded('core')).transitionKnown, true);
  for (const kind of ['heat_jet', 'hesh_debris', 'aphe_burst']) {
    const g = buildProjectileGeometry(p, recorded(kind));
    assert.equal(g.visibility, 'unknown', 'unsupported mechanisms need their recorded piece/trace builders');
    assert.equal(g.vertices.length, 0);
  }
});

test('triangle adapter keeps CPU role/index data and separate display enlargement fixes the nose', () => {
  const p = projectileProfile(data.projectiles.aphe_122_br471), g = buildProjectileGeometry(p);
  const before = Array.from(g.vertices), triangles = projectileTriangleData(g, { sourceWinding: true });
  assert.equal(triangles.length, g.indices.length * 13);
  for (let i = 0; i < g.indices.length; i++) assert.deepEqual(Array.from(triangles.subarray(i * 13, i * 13 + 13)), Array.from(g.vertices.subarray(g.indices[i] * 13, g.indices[i] * 13 + 13)));
  const enlarged = projectileDisplayTransform(p, { diameterScale: 2.7, lengthScale: 1.4 });
  assert.equal(enlarged.matrix[12], 0); assert.equal(enlarged.matrix[13], 0); assert.equal(enlarged.matrix[14], 0);
  close(enlarged.matrix[0], 2.7); close(enlarged.matrix[10], 1.4);
  assert.equal(enlarged.diagnostic.physicalLengthM, .451);
  assert.equal(enlarged.diagnostic.physicalDiameterM, .12192);
  assert.deepEqual(Array.from(g.vertices), before);
  assert.equal(p.lengthM, .451);
  assert.throws(() => projectileDisplayTransform(p, { diameterScale: NaN }), /scale/i);
});

test('renderer adapter corrects inherited lathe winding and makes source open fins/shoes explicitly two sided', () => {
  // GeoBuilder's real cylinder is an independent target convention oracle: CCW exterior.
  const b = new GeoBuilder();
  b.cyl(IDENTITY, false, 'z', .03, .03, .3, 40, { color: [1, 1, 1], rough: .6, metal: .5 });
  const oracle = b.build();
  const signOfTriangle = (vertices, start) => {
    const v = k => Array.from(vertices.subarray(start + k * 13, start + k * 13 + 3));
    const n = k => Array.from(vertices.subarray(start + k * 13 + 3, start + k * 13 + 6));
    return dot(cross(sub(v(1), v(0)), sub(v(2), v(0))), n(0).map((x, i) => x + n(1)[i] + n(2)[i]));
  };
  assert.ok(signOfTriangle(oracle, 0) > 0);
  for (const id of ['apfsds_35_pmc287', 'apds_122_3bm11', 'heatfs_122_3bk9', 'aphe_122_br471']) {
    const g = buildProjectileGeometry(projectileProfile(data.projectiles[id]), 'launch');
    const doubled = g.parts.filter(p => p.doubleSided);
    assert.ok(doubled.every(p => p.role === 'fins' || p.role === 'sabot'));
    assert.ok(g.parts.filter(p => p.role === 'fins' || p.role === 'sabot').every(p => p.doubleSided));
    const target = projectileTriangleData(g);
    assert.equal(target.length, (g.indices.length + doubled.reduce((n, p) => n + p.indexCount, 0)) * 13);
    for (let i = 0; i < target.length; i += 39) assert.ok(signOfTriangle(target, i) >= -1e-9, `${id} triangle ${i / 39} disagrees with target front face/normal`);
    assert.deepEqual(g.adapter, { frontFace: 'CCW', lathe: 'align_winding_to_normals', openFaces: 'duplicate_reverse_face_and_normal' });
  }
});

function fakeRenderer() {
  return {
    live: new Set(), uploads: 0, freed: 0, failAt: Infinity,
    mesh(vertices) { if (++this.uploads === this.failAt) throw Error('upload failed'); const mesh = { vertices }; this.live.add(mesh); return mesh; },
    freeMesh(mesh) { assert.ok(this.live.delete(mesh), 'free each renderer owner once'); this.freed++; },
  };
}

test('pool shares prototypes across equivalent profiles and warm leases never rebuild', () => {
  const renderer = fakeRenderer(), pool = new ProjectileVisualPool(renderer, { maxPrototypes: 3, maxLeases: 8 });
  const p = projectileProfile(data.projectiles.aphe_122_br471);
  const a = pool.acquire(p), b = pool.acquire(projectileProfile(data.projectiles.aphe_122_br471));
  assert.equal(a.mesh, b.mesh);
  assert.equal(a.geometry, b.geometry);
  assert.equal(pool.stats().leases, 2);
  assert.equal(pool.release(a), true); assert.equal(pool.release(a), false); assert.equal(pool.release({ mesh: b.mesh }), false);
  pool.release(b);
  const baseline = pool.stats();
  assert.deepEqual([baseline.prototypes, baseline.idle, baseline.leases], [1, 1, 0]);
  for (let i = 0; i < 1000; i++) pool.release(pool.acquire(p));
  assert.equal(pool.stats().geometryBuilds, baseline.geometryBuilds);
  assert.equal(renderer.uploads, 1);
  pool.clearIdle();
  assert.equal(pool.stats().prototypes, 0); assert.equal(renderer.live.size, 0);
  pool.dispose(); pool.dispose();
  assert.throws(() => pool.acquire(p), /disposed/i);
});

test('pool capacity evicts idle owners but never active ones; invalid requests and failed uploads are transactional', () => {
  const renderer = fakeRenderer(), pool = new ProjectileVisualPool(renderer, { maxPrototypes: 2, maxLeases: 2 });
  const p = projectileProfile(data.projectiles.aphe_122_br471), q = projectileProfile(data.projectiles.he_75_m48), r = projectileProfile(data.projectiles.ap_75_m72);
  const a = pool.acquire(p), b = pool.acquire(q);
  assert.throws(() => pool.acquire(r), /capacity|lease/i);
  assert.throws(() => pool.acquire({ id: p.id, revision: p.revision, lengthM: -1 }), /profile/i);
  assert.deepEqual([pool.stats().prototypes, pool.stats().leases, renderer.live.size], [2, 2, 2]);
  pool.release(b); renderer.failAt = renderer.uploads + 1;
  assert.throws(() => pool.acquire(r), /upload failed/);
  assert.deepEqual([pool.stats().prototypes, pool.stats().leases, renderer.live.size], [2, 1, 2]);
  renderer.failAt = Infinity;
  const c = pool.acquire(r);
  assert.ok(a.mesh && c.mesh); assert.equal(renderer.live.size, 2);
  assert.equal(pool.stats().prototypes, 2);
  pool.dispose();
  assert.equal(renderer.live.size, 0); assert.equal(a.mesh, null); assert.equal(c.mesh, null);
  assert.equal(pool.release(a), false);
});

test('pool context loss/restore keeps lease identity and rolls back every owner on restore failure', () => {
  const renderer = fakeRenderer(), pool = new ProjectileVisualPool(renderer);
  const a = pool.acquire(projectileProfile(data.projectiles.aphe_122_br471));
  const b = pool.acquire(projectileProfile(data.projectiles.apds_122_3bm11), recorded('core'));
  const builds = pool.stats().geometryBuilds;
  pool.contextLost(); pool.contextLost();
  assert.equal(renderer.live.size, 0); assert.equal(a.mesh, null); assert.equal(b.mesh, null);
  assert.throws(() => pool.acquire(projectileProfile(data.projectiles.he_75_m48)), /context/i);
  renderer.failAt = renderer.uploads + 2;
  assert.throws(() => pool.restoreContext(), /upload failed/);
  assert.equal(renderer.live.size, 0); assert.equal(pool.stats().contextLost, true);
  renderer.failAt = Infinity; pool.restoreContext(); pool.restoreContext();
  assert.equal(renderer.live.size, 2); assert.ok(a.mesh && b.mesh);
  assert.equal(pool.stats().geometryBuilds, builds);
  pool.release(a); pool.release(b);
  assert.equal(pool.stats().leases, 0); assert.equal(pool.stats().idle, 2);
  pool.dispose(); assert.equal(renderer.live.size, 0);
});

test('pool released handles cannot draw an idle owner and shared prototypes never reuse another event time', () => {
  const renderer = fakeRenderer(), pool = new ProjectileVisualPool(renderer);
  const p = projectileProfile(data.projectiles.apds_122_3bm11);
  const a = pool.acquire(p, { ...recorded('core'), time_s: .1 });
  const b = pool.acquire(p, { ...recorded('core'), time_s: .8 });
  assert.equal(a.geometry, b.geometry); assert.equal(a.mesh, b.mesh);
  assert.equal(a.stage.timeS, .1); assert.equal(b.stage.timeS, .8);
  assert.equal(a.geometry.timeS, null, 'prototype has no per-event timing');
  assert.equal(a.geometry.transitionKnown, false);
  pool.release(a); assert.equal(a.mesh, null, 'released handle no longer has drawing ownership');
  assert.ok(b.mesh); pool.clearIdle(); assert.equal(renderer.live.size, 1);
  const stopped = pool.acquire(p, recorded('stopped'));
  assert.equal(stopped.mesh, null); assert.equal(stopped.geometry.vertices.length, 0);
  assert.equal(stopped.stage.transitionKnown, true);
  pool.dispose(); assert.equal(renderer.live.size, 0);
});

test('pool validates budgets, adapters and malformed stages before resource mutation', () => {
  const renderer = fakeRenderer();
  assert.throws(() => new ProjectileVisualPool(renderer, { maxPrototypes: 0 }), /capac/i);
  assert.throws(() => new ProjectileVisualPool(renderer, { maxLeases: Infinity }), /capac/i);
  assert.throws(() => new ProjectileVisualPool({ mesh() {} }), /renderer/i);
  const pool = new ProjectileVisualPool(renderer, { maxPrototypes: 1, maxLeases: 4 });
  const a = pool.acquire(projectileProfile(data.projectiles.ap_75_m72));
  assert.throws(() => pool.acquire(projectileProfile(data.projectiles.he_75_m48)), /prototype capacity/i);
  assert.throws(() => pool.acquire(a.profile, null), /stage/i);
  assert.throws(() => pool.acquire(a.profile, {}), /kind/i);
  assert.equal(renderer.live.size, 1); assert.equal(pool.stats().leases, 1);
  pool.dispose();
  assert.equal(pool.release(null), false); assert.equal(pool.release(undefined), false);
});
