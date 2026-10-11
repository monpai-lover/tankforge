import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HitCam } from '../src/game/hitcam.js';
import { Enemy, combatHit, useCombat } from '../src/game/enemies.js';
import { VehicleSim } from '../src/game/vehicle.js';
import { Renderer } from '../src/gfx/renderer.js';
import { Node, m4, transformPoint } from '../src/gfx/math.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { buildInterior } from '../src/gfx/interior.js';
import { makeLoadout, generatedTurretParts } from '../src/game/loadout.js';
import { loadCoreSync } from '../src/design/core.js';
import { Combat } from '../src/game/combat.js';
import { loadData } from '../tools/load-data.mjs';
import { RigidBody } from '../src/sim/tank/body.js';
import { captureImpactPose, rememberImpactPose } from '../src/game/replayPose.js';

// Exercise the renderer's actual mesh ownership/upload methods without a browser or GPU.
function rendererSink() {
  let serial = 0;
  const uploads = [], deleted = [], created = [];
  const handle = kind => { const h = {[kind]: ++serial}; created.push(h); return h; };
  const gl = { ARRAY_BUFFER: 1, FLOAT: 2, STATIC_DRAW: 3, DYNAMIC_DRAW: 4,
    createVertexArray: () => handle('vao'), createBuffer: () => handle('buffer'),
    bindVertexArray() {}, bindBuffer(_, b) { this.bound = b; },
    bufferData(_, data) { uploads.push({ buffer: this.bound, data: typeof data === 'number' ? data : Array.from(data) }); },
    bufferSubData(_, __, data) { uploads.push({ buffer: this.bound, data: Array.from(data) }); },
    enableVertexAttribArray() {}, vertexAttribPointer() {}, vertexAttribDivisor() {},
    deleteVertexArray: h => deleted.push(h), deleteBuffer: h => deleted.push(h),
    getExtension: () => true,
  };
  const r = Object.assign(Object.create(Renderer.prototype), { gl, _live: new Set(), _texSrc: new Map(), lost: false, uploads, deleted, created, generation: 0 });
  r.renderInset = function(nodes, cam) { this.last = nodes.slice(); this.cam = cam; };
  return r;
}
function hitcam(renderer) {
  const elements = new Map();
  const root = { hidden: true, style: {}, dataset: {}, querySelector(s) { if (!elements.has(s)) elements.set(s, { style: {}, dataset: {} }); return elements.get(s); } };
  return new HitCam({ renderer, root });
}
const frame = nodes => ({ cw: 1280, ch: 800, scale: 1, nodes });
function close(a, b) { a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-5, `${a} != ${b}`)); }
const data = loadData();
const core = loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm', import.meta.url)), { materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains) });
function t54() {
  const renderer = rendererSink(), bundle = data.vehicles.su_t54;
  const loadout = makeLoadout('su_t54', bundle, data.projectiles, data.machineGuns);
  const model = buildTank(renderer, loadout, generatedTurretParts);
  const terrain = { height: () => 0, normal: () => [0, 1, 0], deform: () => 0 };
  const veh = new VehicleSim(bundle, model, terrain);
  veh.place(10, 30, 0); veh.body.place([10, 2, 30], 0);
  const e = Object.assign(Object.create(Enemy.prototype), { model, bundle, loadout, veh, x: 10, z: 30, heading: 0, turretYaw: .6, gunPitch: [.2], fold: 0, alive: true });
  e.pose(); model.root.update();
  useCombat(e, new Combat(core), 'replay_t54');
  let interiorCalls = 0;
  const target = { model, body: veh.body, armor: bundle.armor, pivot: loadout.turrets[0].pivot, name: 'T-54', length: model.length, crewRoles: bundle.crew.map(c => c.role),
    interior() { interiorCalls++; return e.interior ||= buildInterior(renderer, model, loadout, bundle.modules, bundle.crew); } };
  return { renderer, e, target, model, loadout, get interiorCalls() { return interiorCalls; } };
}

test('actual T-54 ammo detonation replays the articulation before Enemy.pose applies death offsets', () => {
  const f = t54(), shell = data.projectiles.aphe_122_br471;
  const rack = f.e.bundle.modules.find(m => m.id === 'ammo_front');
  const localOrigin = [40, rack.center.y, rack.center.z], localDir = [-1, 0, 0];
  const dir = f.e.veh.body.worldDir(localDir), o = f.e.veh.body.worldPoint(localOrigin);
  const p0 = o.map((v, i) => v + dir[i] * 2);
  // P1 work-allocated spall changes secondary RNG order; seed 2 retains real cookoff.
  const rep = combatHit(f.e, p0, dir, shell, shell.muzzle_velocity_ms * .85, 100, 2);
  assert.ok(rep.events.includes('ammo_detonation') && rep.events.includes('fire') && rep.caps.destroyed, JSON.stringify(rep.events));
  assert.equal(f.model.turrets[0].node.yaw, .95, 'live death animation still applies');
  assert.equal(f.model.turrets[0].guns[0].node.pitch, .08);
  const keys = Object.keys(rep);
  const hc = hitcam(f.renderer); hc.show(f.target, rep, shell, 100);
  assert.equal(hc.cur.target.model.turrets[0].node.yaw, .6, 'replay must preserve pre-core yaw');
  assert.equal(hc.cur.target.model.turrets[0].guns[0].node.pitch, -.2, 'replay must preserve pre-core elevation');
  assert.deepEqual(Object.keys(rep), keys, 'pose stays private, outside report/wire fields');
  close(hc.cur.target.body.worldPoint([0, 0, 0]), [10, 2, 30]);
  hc.hide(); f.model.dispose(); f.e.interior.dispose();
});

function simple() {
  const renderer = rendererSink(), root = new Node('vehicle'), body = root.add(new Node('body'));
  const hull = body.add(new Node('hull')); hull.mesh = renderer.mesh(new Float32Array(13));
  const turret = body.add(new Node('turret')); turret.pos = [0, 2, 0]; turret.yaw = .6;
  const gun = turret.add(new Node('gun')); gun.pitch = -.2;
  const barrel = gun.add(new Node('barrel')); barrel.pos = [0, 0, -.12]; barrel.mesh = hull.mesh;
  const track = body.add(new Node('tracks')); track.mesh = renderer.instancedMesh(new Float32Array(13), 2);
  const matrices = new Float32Array([...m4(), ...m4()]); matrices[12] = 3;
  renderer.setInstances(track.mesh, matrices, 2);
  const hidden = body.add(new Node('invisible')); hidden.visible = false; hidden.mesh = hull.mesh;
  const model = { root, body, hull, shellNodes: [hull, barrel], turrets: [{node: turret, guns: [{node: gun, barrel}]}] };
  const rigid = new RigidBody(1000, [1, 1, 1], [.3, 1, .2]); rigid.place([10, 2, 30], .4);
  root.update(); // Deliberately stale worlds: physics has not been copied to the graph.
  let innerCalls = 0, liveUpdates = 0, inner;
  const launcher = { loaded: 0, ammo: [{count: 2}], launcher: {nextTube: 0, ready: 1} };
  const armor = [{ id: 'plate', center: [0, 1, 0], normal: [0, 0, -1], axis_u: [1, 0, 0], half_u: 1, half_v: 1 }];
  const target = { model, body: rigid, armor, pivot: [0, 2, 0], name: 'fixture', crewRoles: ['gunner'], moduleLabels: new Map([['rack', 'rack']]), interior() {
    innerCalls++;
    if (!inner) {
      const crew = turret.add(new Node('crew')); crew.pos = [1, 0, 0]; crew.mesh = renderer.mesh(new Float32Array(13)); crew.visible = false; crew.highlight = [1, 0, 0, .2]; crew.texture = {cached: 1}; crew.normalTex = {cached: 2};
      const apparatus = gun.add(new Node('apparatus')); apparatus.mesh = crew.mesh; apparatus.visible = false;
      const round = gun.add(new Node('round')); round.mesh = crew.mesh; round.visible = false; round.launcherRound = {gun: launcher, tube: 0, apparatus};
      inner = { nodes: [crew, apparatus, round], byModule: new Map([['rack', [round]]]), byCrew: [crew], labels: [{node: crew, local: [0, 1, 0]}], updateLaunchers() { liveUpdates++; round.visible = apparatus.visible && launcher.ammo[0].count > 0; } };
    }
    return inner;
  } };
  const rep = { impact: [0, 1, 0], outcome: 'penetrated', plate: 'plate', path: [[0, 1, 0], [0, 1, 3]], shot: {dir: [0, 0, 1]}, fragments: [{from: [0, 1, 0], to: [1, 1, 2], kind: 'spall'}], bursts: [{pos: [0, 1, 1], radius: 1, inside: true}], modules: [{id: 'rack', damage: 1, health: 0, destroyed: true}], crew: [{index: 0, killed: true}], caps: {}, title: 'hit' };
  const hc = hitcam(renderer); const show = () => hc.show(target, rep, {kind: 'ap', caliber_mm: 75}, 100);
  return { renderer, root, body, model, hull, turret, gun, barrel, track, hidden, rigid, target, rep, launcher, hc, show, get inner() { return inner; }, get innerCalls() { return innerCalls; }, get liveUpdates() { return liveUpdates; } };
}

test('renderer leases defer owner frees, share multiple leases, and leave cached owners alive', () => {
  const r = rendererSink(), m = r.mesh(new Float32Array(13)), cached = r.mesh(new Float32Array(13));
  assert.equal(typeof r.retainMesh, 'function', 'renderer must expose mesh leases');
  r.retainMesh(m); r.retainMesh(m); r.freeMesh(m);
  assert.ok(r._live.has(m)); assert.equal(r.deleted.length, 0);
  r.releaseMesh(m); assert.ok(r._live.has(m));
  r.releaseMesh(m); assert.ok(!r._live.has(m)); assert.equal(r.deleted.length, 2);
  r.releaseMesh(m); r.freeMesh(m); assert.equal(r.deleted.length, 2, 'release/free are idempotent');
  r.retainMesh(cached); r.releaseMesh(cached); assert.ok(r._live.has(cached));
});

test('fallback computes fresh detached hull and first-frame lazy interior worlds, maps, and textures', () => {
  const f = simple(); f.show(); const t = f.hc.cur.target;
  assert.notEqual(t.model.root, f.root, 'snapshot must be detached');
  assert.equal(f.innerCalls, 1);
  close(transformPoint(t.model.body.world, [0, 1, 0]), f.rigid.worldPoint([0, 1, 0]));
  const sourceCrew = f.inner.byCrew[0], cloneCrew = t.interior().byCrew[0];
  assert.notEqual(cloneCrew, sourceCrew); assert.notEqual(cloneCrew.pos, sourceCrew.pos);
  assert.notEqual(cloneCrew.highlight, sourceCrew.highlight);
  close(Array.from(cloneCrew.world.slice(12, 15)), f.rigid.worldPoint([Math.cos(.6), 2, -Math.sin(.6)]));
  assert.ok(t.interior().byModule.get('rack').every(n => !f.inner.nodes.includes(n)));
  const texture = cloneCrew.texture, normal = cloneCrew.normalTex;
  sourceCrew.texture = {}; sourceCrew.normalTex = {}; sourceCrew.pos[0] = 80;
  f.target.pivot[0] = 20; f.target.armor[0].center[0] = 90; f.target.crewRoles[0] = 'driver'; f.target.moduleLabels.set('rack', 'changed');
  assert.equal(cloneCrew.texture, texture); assert.equal(cloneCrew.normalTex, normal);
  assert.equal(t.pivot[0], 0); assert.equal(t.armor[0].center[0], 0); assert.equal(t.crewRoles[0], 'gunner'); assert.equal(t.moduleLabels.get('rack'), 'rack');
  const hiddenClone = t.model.body.children.find(n => n.name === 'invisible');
  assert.ok(hiddenClone && !hiddenClone.visible, 'invisible hierarchy members are also cloned');
  f.hc.hide();
});

test('approach and xray are invariant under live movement, toss, joints, instances, and launcher state', () => {
  const f = simple(); f.show(); const snapshot = f.hc.cur.target, inner = snapshot.interior();
  const background = new Node('background'); background.mesh = {};
  const nodes = []; f.root.collect(nodes); nodes.push(background);
  function sample(t) { f.hc.cur.t = t; f.hc.render3d(frame(nodes)); return { worlds: f.renderer.last.map(n => [n.name, Array.from(n.world)]), impact: f.hc.cur.cam.W(f.rep.impact), fragment: f.hc.cur.cam.W(f.rep.fragments[0].to), matrices: Array.from(snapshot.model.body.children.find(n => n.name === 'tracks').mesh._src.matrices) }; }
  const approach = sample(.45), xray = sample(2.8);
  assert.ok(!f.renderer.last.some(n => nodes.includes(n)), 'xray contains only detached target and explanatory projectile');
  f.rigid.place([100, 7, 200], 1.2); f.turret.pos = [3, 9, 4]; f.turret.pitch = 2; f.turret.roll = 1; f.turret.yaw = 2;
  f.gun.pitch = .8; f.gun.yaw = 1; f.barrel.pos[2] = 7; f.hidden.visible = true;
  f.launcher.loaded = -1; f.launcher.ammo[0].count = 0; f.launcher.launcher.ready = 0;
  for (const n of f.inner.nodes) { n.visible = true; n.pos[0] += 40; n.highlight = [0, 1, 0, 1]; }
  const matrices = f.track.mesh._src.matrices.slice(); matrices[12] = 91; f.renderer.setInstances(f.track.mesh, matrices, 1); f.root.update();
  assert.deepEqual(sample(.45), approach); assert.ok(f.renderer.last.includes(background)); assert.ok(!f.renderer.last.some(n => n !== background && nodes.includes(n)));
  assert.deepEqual(sample(2.8), xray); assert.equal(f.liveUpdates, 0, 'replay must never call the live launcher closure');
  let roundVisible; f.renderer.renderInset = list => { roundVisible = list.some(n => n === inner.byModule.get('rack')[0]); };
  sample(2.8); assert.equal(roundVisible, true, 'loaded impact-time round stays visible after live firing');
  assert.notEqual(snapshot.model.body.children.find(n => n.name === 'tracks').mesh.ibuf, f.track.mesh.ibuf);
  f.hc.hide();
});

test('suppressed MG and invalid reports allocate nothing and do not resolve interiors', () => {
  const f = simple(); f.show(); const cur = f.hc.cur, size = f.renderer._live.size, calls = f.innerCalls;
  f.hc.show(f.target, f.rep, {}, 100, true); f.hc.show(f.target, null, {}, 100);
  assert.equal(f.hc.cur, cur); assert.equal(f.renderer._live.size, size); assert.equal(f.innerCalls, calls);
  f.hc.hide();
});

test('replacement, hide and expiry release once, preserve persistent projectile meshes and pending owners', () => {
  const f = simple(); f.show(); f.hc.render3d(frame([])); const old = f.hc.cur, projectile = f.hc.projectile.shell.mesh, size = f.renderer._live.size;
  f.renderer.freeTexture = () => assert.fail('renderer-owned cache textures must never be released by a replay');
  f.show(); assert.equal(f.renderer._live.size, size); assert.notEqual(f.hc.cur.target, old.target); assert.equal(f.hc.projectile.shell.mesh, projectile);
  const replacementDeletes = f.renderer.deleted.length; old.target.dispose(); assert.equal(f.renderer.deleted.length, replacementDeletes);
  const cloneTrack = f.hc.cur.target.model.body.children.find(n => n.name === 'tracks').mesh;
  for (const n of [f.hull, f.track, ...f.inner.nodes]) f.renderer.freeMesh(n.mesh);
  assert.ok(f.renderer._live.has(f.hull.mesh), 'live model disposal leaves retained static mesh usable');
  assert.ok(f.renderer._live.has(cloneTrack));
  f.hc.cur.t = f.hc.cur.total - .01; f.hc.tick(.02); assert.equal(f.hc.active, false);
  assert.ok(!f.renderer._live.has(cloneTrack)); assert.ok(!f.renderer._live.has(f.hull.mesh)); assert.ok(f.renderer._live.has(projectile));
  const deleted = f.renderer.deleted.length; f.hc.hide(); f.hc.hide(); assert.equal(f.renderer.deleted.length, deleted);
});

test('failed instance acquisition deletes partial GL handles and preserves the previous replay', () => {
  const f = simple(); f.show(); const previous = f.hc.cur, live = new Set(f.renderer._live), start = f.renderer.created.length;
  const upload = f.renderer.gl.bufferData;
  f.renderer.gl.bufferData = () => { throw new Error('failed GL upload'); };
  f.show();
  assert.equal(f.hc.cur, previous); assert.deepEqual(f.renderer._live, live);
  assert.ok(f.renderer.created.slice(start).every(h => f.renderer.deleted.includes(h)), 'every partial instance handle must be released');
  f.renderer.gl.bufferData = upload;
  f.hc.hide(); f.renderer.freeMesh(f.hull.mesh); assert.ok(!f.renderer._live.has(f.hull.mesh), 'failed snapshot leaves no static lease behind');
});

test('failed lazy interior and instance upload preserve old replay without changing live node state', () => {
  const f = simple(); f.show(); const previous = f.hc.cur, live = new Set(f.renderer._live);
  const source = () => [...f.body.children, ...f.inner.nodes].map(n => [n, n.visible, n.kind, n.highlight, Array.from(n.world), Array.from(n.pos)]);
  const before = source();
  f.hc.show({...f.target, interior() { throw new Error('interior failed'); }}, f.rep, {}, 100);
  assert.equal(f.hc.cur, previous); assert.deepEqual(source(), before); assert.deepEqual(f.renderer._live, live);
  const upload = f.renderer.setInstances;
  f.renderer.setInstances = () => { throw new Error('instances failed'); }; f.show(); f.renderer.setInstances = upload;
  assert.equal(f.hc.cur, previous); assert.deepEqual(source(), before); assert.deepEqual(f.renderer._live, live);
  f.hc.cur.t = 2.8; f.renderer.renderInset = () => { throw new Error('inset failed'); };
  assert.throws(() => f.hc.render3d(frame([])), /inset failed/); assert.deepEqual(source(), before);
  f.hc.hide();
});

test('context restoration reuploads retained static owners and each isolated frozen instance source', () => {
  const f = simple(); f.show(); const snapshot = f.hc.cur.target;
  const tracks = snapshot.model.body.children.find(n => n.name === 'tracks').mesh;
  const frozen = Array.from(tracks._src.matrices), oldBuffer = tracks.ibuf;
  const live = f.track.mesh._src.matrices.slice(); live[12] = 99; f.renderer.setInstances(f.track.mesh, live, 1);
  f.renderer.freeMesh(f.hull.mesh);
  f.renderer.lost = true; f.renderer._initGL = () => {}; f.renderer.setQuality = () => {}; f.renderer._restore();
  assert.notEqual(tracks.ibuf, oldBuffer); assert.equal(tracks.instances, 2); assert.deepEqual(Array.from(tracks._src.matrices), frozen);
  assert.ok(f.renderer._live.has(f.hull.mesh));
  assert.ok(f.renderer.uploads.some(x => x.buffer === tracks.ibuf && JSON.stringify(x.data) === JSON.stringify(frozen)));
  assert.equal(f.track.mesh.instances, 1); assert.equal(f.track.mesh._src.matrices[12], 99);
  f.hc.hide(); assert.ok(!f.renderer._live.has(f.hull.mesh));
});

test('two active replay leases survive live owner disposal until the last replay hides', () => {
  const f = simple(); f.show(); const second = hitcam(f.renderer); second.show(f.target, f.rep, {}, 100);
  f.renderer.freeMesh(f.hull.mesh); f.hc.hide(); assert.ok(f.renderer._live.has(f.hull.mesh));
  second.cur.t = 2; second.render3d(frame([])); second.hide(); assert.ok(!f.renderer._live.has(f.hull.mesh));
});

test('actual T-54 tracks and gear connections stay fixed through toss, model/interior disposal and respawn', () => {
  const f = t54(), hc = hitcam(f.renderer), shell = data.projectiles.aphe_122_br471;
  const rack = f.e.bundle.modules.find(m => m.id === 'ammo_front');
  const d = [-1, 0, 0], o = f.e.veh.body.worldPoint([40, rack.center.y, rack.center.z]);
  const rep = combatHit(f.e, o.map((v, i) => v + 2 * d[i]), d, shell, shell.muzzle_velocity_ms * .85, 100, 1);
  hc.show(f.target, rep, shell, 100);
  const frozen = hc.cur.target, all = []; frozen.model.root.collect(all);
  const instanceNodes = all.filter(n => n.mesh.instanced);
  assert.deepEqual(instanceNodes.map(n => n.name).sort(), ['gear_connections', 'tracks']);
  const context = () => {
    const ops = [], gradient = {addColorStop() {}};
    return {ops, ctx: new Proxy({createRadialGradient: () => gradient}, {get(t, k) { return t[k] || ((...args) => ops.push([k, ...args])); }, set(t, k, v) { t[k] = v; return true; }})};
  };
  const sample = time => {
    hc.cur.t = time; hc.render3d(frame([])); const {ops, ctx} = context(); hc.draw2d(ctx, frame([]));
    return {worlds: f.renderer.last.map(n => [n.name, Array.from(n.world)]), instances: instanceNodes.map(n => [n.mesh.instances, Array.from(n.mesh._src.matrices)]), camera: Array.from(hc.cur.cam.viewProj), ops};
  };
  const approach = sample(.45), xray = sample(2.8), hold = sample(4.3);
  f.e.veh.body.place([400, 80, -300], 2); f.model.turrets[0].node.pos = [8, 10, 4]; f.model.turrets[0].node.roll = 1.2; f.model.turrets[0].node.pitch = -.8;
  f.model.turrets[0].node.yaw = 2; f.model.turrets[0].guns[0].node.pitch = 1; f.model.turrets[0].guns[0].barrel.pos[2] = 5;
  const sourceNodes = []; f.model.root.collect(sourceNodes);
  for (const n of sourceNodes.filter(n => n.mesh.instanced)) { const m = n.mesh._src.matrices.slice(); m[12] = 500; f.renderer.setInstances(n.mesh, m, 1); }
  f.e.interior.byCrew[0].pos[0] += 20;
  f.model.dispose(); f.e.interior.dispose(); f.model.root.children = []; // Remote target removal / selecting another vehicle.
  assert.deepEqual(sample(.45), approach); assert.deepEqual(sample(2.8), xray); assert.deepEqual(sample(4.3), hold);
  f.e.veh.body.place([80, 4, 90], 1.1);
  const respawn = buildTank(f.renderer, f.loadout, generatedTurretParts);
  hc.show({...f.target, model: respawn, interior: () => null}, {...rep}, shell, 100);
  close(hc.cur.target.body.worldPoint([0, 0, 0]), [80, 4, 90]);
  assert.ok(instanceNodes.every(n => !f.renderer._live.has(n.mesh)), 'replacement releases old private instance buffers');
  hc.hide(); respawn.dispose();
});

test('compact capture resolves parent-relative command joints and launcher state without traversing or allocating meshes', () => {
  const f = simple(), child = f.turret.add(new Node('child_turret')), childGun = child.add(new Node('child_gun')), childBarrel = childGun.add(new Node('child_barrel'));
  child.pos = [1, 2, 3]; child.roll = .12; childGun.pos = [.1, .2, .3]; childBarrel.pos = [0, 0, -.25];
  childBarrel.local = m4(); childBarrel.local[12] = .07;
  f.model.turrets.push({node: child, guns: [{node: childGun, barrel: childBarrel}]});
  const e = { model: f.model, veh: {body: f.rigid}, loadout: {turrets: [{guns: [f.launcher]}, {parent: 0, guns: []}]}, turretYaws: [1.1, -.4], gunPitch: [.3, -.4], fold: .75 };
  const children = f.root.children, allocated = f.renderer.created.length;
  Object.defineProperty(f.root, 'children', {configurable: true, get() { throw new Error('pre-core graph traversal'); }});
  const pose = captureImpactPose(e);
  Object.defineProperty(f.root, 'children', {configurable: true, writable: true, value: children});
  assert.equal(f.renderer.created.length, allocated); assert.equal(f.innerCalls, 0);
  rememberImpactPose(f.rep, pose);
  e.turretYaws[0] = 9; e.gunPitch[1] = 8; f.rigid.place([700, 10, 800], 2); child.pos[0] = 40; childBarrel.local[12] = 100;
  f.launcher.loaded = -1; f.launcher.ammo[0].count = 0; f.launcher.launcher.ready = 0;
  f.show(); const t = f.hc.cur.target;
  assert.equal(t.model.turrets[0].node.yaw, 1.1); assert.equal(t.model.turrets[1].node.yaw, -1.5);
  assert.equal(t.model.turrets[0].guns[0].node.pitch, -.3); assert.equal(t.model.turrets[1].guns[0].node.pitch, .4);
  assert.deepEqual(t.model.turrets[1].node.pos, [1, 2, 3]); assert.equal(t.model.turrets[1].node.roll, .12);
  close(Array.from(t.model.turrets[1].guns[0].barrel.local), [...m4()].map((v, i) => i === 12 ? .07 : v));
  assert.equal(t.fold, .75); close(t.body.worldPoint([0, 0, 0]), [10, 2, 30]);
  let visible; f.renderer.renderInset = list => { visible = list.includes(t.interior().byModule.get('rack')[0]); };
  f.hc.cur.t = 2.8; f.hc.render3d(frame([])); assert.equal(visible, true, 'launcher readiness comes from pre-core command capture');
  f.hc.hide();
});

test('first replay projectile construction releases both partial static uploads and the new snapshot', () => {
  const f = simple(); f.target.interior();
  const live = new Set(f.renderer._live), created = f.renderer.created.length;
  const upload = f.renderer.gl.bufferData; let projectileUploads = 0;
  f.renderer.gl.bufferData = function(type, data, usage) {
    if (ArrayBuffer.isView(data) && data.length > 13 && ++projectileUploads === 2) throw new Error('second explanatory mesh upload failed');
    return upload.call(this, type, data, usage);
  };
  f.show(); assert.equal(f.hc.active, false); assert.equal(f.hc.projectile, null);
  assert.equal(f.renderer._live.size, live.size, 'failed first replay leaves no projectile or snapshot mesh');
  for (const mesh of live) assert.ok(f.renderer._live.has(mesh));
  assert.ok(f.renderer.created.slice(created).every(h => f.renderer.deleted.includes(h)), 'failed static upload releases every new raw handle');
  f.renderer.gl.bufferData = upload;
  f.show(); assert.equal(f.hc.active, true, 'next hit can retry initialization'); f.hc.hide();
});

test('actual lazy buildInterior rolls back attached nodes and meshes after a later allocation failure', () => {
  const f = t54(), hc = hitcam(f.renderer);
  const rep = {impact: [0, 1, 0], outcome: 'penetrated', modules: [], crew: [], bursts: [], fragments: [], path: [[0, 1, 0], [0, 1, 2]], shot: {dir: [0, 0, 1]}, caps: {}, title: 'hit'};
  hc.show({...f.target, interior: () => null}, rep, {}, 100);
  const previous = hc.cur, live = new Set(f.renderer._live);
  const state = [];
  const walk = n => { state.push([n, n.children.slice(), n.visible, n.kind, n.highlight]); n.children.forEach(walk); }; walk(f.model.root);
  const allocate = f.renderer.mesh; let allocated = 0;
  f.renderer.mesh = function(data) { if (++allocated === 3) throw new Error('third lazy interior mesh failed'); return allocate.call(this, data); };
  hc.show(f.target, rep, {}, 100);
  assert.equal(hc.cur, previous, 'accepted previous replay survives lazy construction failure');
  assert.equal(f.renderer._live.size, live.size, 'partial interior owns no leaked meshes');
  for (const mesh of live) assert.ok(f.renderer._live.has(mesh));
  for (const [n, children, visible, kind, highlight] of state) { assert.equal(n.children.length, children.length); children.forEach((c, i) => assert.equal(n.children[i], c)); assert.equal(n.visible, visible); assert.equal(n.kind, kind); assert.equal(n.highlight, highlight); }
  assert.equal(f.e.interior, undefined);
  f.renderer.mesh = allocate; hc.show(f.target, rep, {}, 100); assert.ok(f.e.interior, 'later hit retries a complete interior');
  hc.hide(); f.model.dispose(); f.e.interior.dispose();
});
