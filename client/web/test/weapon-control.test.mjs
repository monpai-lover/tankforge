import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as gunnery from '../src/sim/gunnery.js';
import * as ballistics from '../src/sim/ballistics.js';
import * as mgSim from '../src/sim/mg.js';
import * as loading from '../src/sim/loading.js';
import * as optics from '../src/game/optics.js';
import * as selection from '../src/game/weaponselection.js';
import * as loadout from '../src/game/loadout.js';
import { hullTilt } from '../src/sim/tank/tank.js';
import { RigidBody } from '../src/sim/tank/body.js';
import { foldDepression, foldYawLimit } from '../src/game/folding.js';
import { loadData } from '../tools/load-data.mjs';
import { runtimeParts } from '../tools/procedural-fleet-audit.mjs';
import { project, perspective, mul, lookAtLH, transformPoint, transformDir, translation, rotX, rotY, rotZ } from '../src/gfx/math.js';
import { loadCoreSync } from '../src/design/core.js';
import { Hud } from '../src/game/hud.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { decodeImported } from '../src/gfx/imported.js';
import { STRIDE } from '../src/gfx/geo.js';
import { launcherCanFire } from '../src/game/combat.js';

const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const data = loadData(), DEG = Math.PI / 180, ME = 1;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const dirFrom = (yaw, pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
// Run the exact live function bodies, with real gun/loadout/ballistic dependencies.
// Presentation and transport sinks are the only fakes; no browser is needed.
function functionSource(name) {
  const start = source.indexOf(`  function ${name}(`);
  return start < 0 ? '' : source.slice(start, source.indexOf('\n  }', start) + 4);
}
function controls(id, mesh = false) {
  const rt = mesh ? runtimeParts(id, data) : null;
  const lo = rt?.loadout || loadout.makeLoadout(id, data.vehicles[id], data.projectiles, data.machineGuns);
  const G = { id, mode: 'battle', loadout: lo, model: rt?.model, zero: 0,
    s: { x: 0, y: 0, z: 0, heading: 0 }, ss: { pitch: 0, roll: 0 },
    sightT: 0, sightG: 0, sightM: -1, pending: [], zoomIdx: 0,
    cam: { yaw: 0, pitch: 0, shake: 0 }, camPos: [0, 3, 0], aimPoint: [0, 3, 800], aim: { dist: 800 },
    MG: lo.machineGuns.map(m => ({ m, st: mgSim.newMg(m.def), aim: { yaw: 0, pitch: 0 }, bearing: true })),
    T: lo.turrets.map(t => ({ yaw: t.facing, bearing: true, yawErr: 0,
      guns: t.guns.map(() => ({ pitch: 0, pitchErr: 0, smoke: 0 })),
      loading: loading.newLoading(t.guns.length, t.loaders.length, t.guns.map(g => !g.rack)) })),
    aps: lo.weapons.aps, apsOn: true, shots: [], bullets: [], online: null,
    veh: { body: new RigidBody(1000, [1000, 1000, 1000], [0, 0, 0]) },
  };
  const sent = [], apsCalls = [];
  const core = loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm', import.meta.url)),
    { materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains) });
  core.call({ op: 'mw_reset', defs: Object.values(data.missiles) });
  if (G.aps) core.call({ op: 'mw_aps', owner: ME, team: 0, def: G.aps, seed: 10 });
  G.missiles = { setAps(owner, enabled, rate_rpm = null, rounds = null) {
    apsCalls.push({ owner, enabled, rounds });
    core.call({ op: 'mw_aps', owner, enabled, rate_rpm, rounds });
  } };
  const deps = { G, ME, data, DEG, clamp, dirFrom, hullTilt, gunnery, ballistics, mgSim, loading,
    foldDepression, foldYawLimit, launcherCanFire,
    ...selection, ...loadout, ...optics, rng: { nextF32: () => .5 },
    net: { send: m => sent.push(m) }, hud: { buildAmmo() {}, toast() {}, aps() {} },
    sound: { tone() {}, apsGun() {}, mg() {} }, fx: { mgFlash() {} },
    surfaceAt: () => 0, impactColor: () => [0, 0, 0], selectAmmo() {},
    launcherMount: loadout.launcherMount, reloadTime: loadout.reloadTime,
  };
  delete deps.sightLevels;
  const preamble = source.slice(source.indexOf('  const pose = '), source.indexOf('  // ----------------------------------------------------------------- workshop'));
  const moduleCheck = source.slice(source.indexOf('  const moduleOk ='), source.indexOf('  /** Where the protection gun'));
  const stabilizers = source.slice(source.indexOf('  const GUNNER ='), source.indexOf('  /**\n   * The hull\'s attitude'));
  const functions = ['cycleSightGun', 'trigger', 'fireGun', 'layMg', 'sightMuzzle', 'stepMachineGuns', 'currentLos', 'applyAps', 'toggleAps', 'apsAutomatic', 'syncApsControl', 'trackHull', 'aimTurrets'].map(functionSource).join('\n');
  const live = new Function(...Object.keys(deps), `${preamble}\n${moduleCheck}\n${stabilizers}\n${functions}\nreturn {cycleSightGun, trigger, fireGun, layMg, sightMuzzle, stepMachineGuns, currentLos, applyAps, toggleAps, aimTurrets};`)(...Object.values(deps));
  const snapshot = () => core.call({ op: 'mw_step', dt: 1 / 60, actors: [] }).aps[0];
  return { G, live, rt, sent, apsCalls, snapshot };
}
const close = (actual, expected, message, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) < epsilon, `${message}: ${actual} != ${expected}`);
function tiltBody(r, pitch, roll, heading = 0, origin = [0, 0, 0]) {
  const matrix = mul(translation(...origin), mul(rotY(heading), mul(rotX(-pitch), rotZ(roll))));
  const body = r.G.veh.body;
  body.ex = transformDir(matrix, [1, 0, 0]); body.ey = transformDir(matrix, [0, 1, 0]); body.ez = transformDir(matrix, [0, 0, 1]); body.pos = origin.slice();
  r.G.s = { x: origin[0], y: origin[1], z: origin[2], heading: body.attitude().heading };
  r.G.ss = body.attitude();
  if (r.rt) r.rt.model.body.local = matrix;
}

test('selected roof MG obeys the chosen zero instead of silently ranging the target', () => {
  const r = controls('su_is2', true), i = r.G.MG.findIndex(e => e.m.mount === 'pintle');
  r.G.sightM = i;
  for (const zero of [0, 200, 800]) {
    r.G.zero = zero;
    for (let k = 0; k < 120; k++) r.live.layMg(i, 1 / 60);
    const mz = r.live.sightMuzzle(), d = r.G.aimPoint.map((v, k) => v - mz.pos[k]);
    const los = Math.atan2(d[1], Math.hypot(d[0], d[2]));
    close(Math.asin(mz.dir[1]) - los, ballistics.elevationAt(r.G.MG[i].m.table, zero), `MG zero ${zero}`, 2e-6);
  }
});

test('selected hull MG compensates hull tilt once and aims from its own muzzle', () => {
  const r = controls('de_pz3_j'), i = r.G.MG.findIndex(e => e.m.mount === 'hull');
  assert.ok(i >= 0);
  r.G.sightM = i; tiltBody(r, .05, .03);
  for (let k = 0; k < 120; k++) r.live.layMg(i, 1 / 60);
  const mz = r.live.sightMuzzle(), d = r.G.aimPoint.map((v, k) => v - mz.pos[k]);
  close(Math.asin(mz.dir[1]), Math.atan2(d[1], Math.hypot(d[0], d[2])), 'tilted hull MG direct aim', 2e-6);
});

test('rangefinder origin belongs to selected roof, hull and coax machine gun', () => {
  for (const id of ['su_is2', 'de_pz3_j']) {
    const r = controls(id, true);
    for (let i = 0; i < r.G.MG.length; i++) {
      r.G.sightM = i;
      assert.deepEqual(r.live.currentLos().from, r.live.sightMuzzle().pos, `${id}/${r.G.MG[i].m.mount}: range must start at selected muzzle`);
    }
  }
});

test('scope reticle projects the selected MG muzzle line at the target distance, including parallax', () => {
  const r = controls('su_is2', true), selectedMg = r.G.MG.find(e => e.m.mount === 'pintle');
  r.G.sightM = r.G.MG.indexOf(selectedMg);
  const mz = r.live.sightMuzzle(), camPos = mz.trunnion.map((v, k) => v + mz.dir[k] * .6);
  const cw = 1280, ch = 800, fwd = dirFrom(0, 0), tilt = 0, ze = 0;
  r.G.aim.dist = 25;
  const viewProj = mul(perspective(.3, cw / ch, .3, 9000), lookAtLH(camPos, fwd).view);
  const start = source.indexOf('    if (inSight) {\n      // where the gun');
  const end = source.indexOf('\n\n    // ---- projectiles', start);
  assert.ok(start >= 0 && end > start);
  new Function('G', 'selectedMg', 'sightMuzzle', 'tilt', 'ze', 'dirFrom', 'clamp', 'project', 'viewProj', 'camPos', 'fwd', 'cw', 'ch', 'inSight', 'srt', 'sgs', ...Object.keys(optics), source.slice(start, end))(
    r.G, selectedMg, r.live.sightMuzzle, tilt, ze, dirFrom, clamp, project, viewProj, camPos, fwd, cw, ch, true, r.G.T[0], r.G.T[0].guns[0], ...Object.values(optics));
  const reach = 25 - Math.hypot(...mz.pos.map((v, k) => v - mz.trunnion[k]));
  const pr = project(viewProj, mz.pos.map((v, k) => v + mz.dir[k] * reach));
  close(r.G.sightOffset[0], pr[0] * .5 * cw, 'reticle horizontal parallax', 1e-5);
  close(r.G.sightOffset[1], -pr[1] * .5 * ch, 'reticle vertical parallax', 1e-5);
});

test('selected roof MG muzzle follows the same real mesh transform after parent traverse', () => {
  const r = controls('su_is2', true), pm = r.rt.model.mgs[0];
  r.G.T[0].yaw = .7; r.G.sightM = pm.index;
  r.G.MG[pm.index].aim = { yaw: 1.1, pitch: .4 };
  const mz = r.live.sightMuzzle();
  r.rt.at({ yaw: .7, mgYaw: .4, mgPitch: .4 });
  const mesh = transformPoint(pm.node.world, pm.muzzleVector);
  mz.pos.forEach((v, k) => close(v, mesh[k], 'real roof muzzle', 1e-6));
});

test('selected roof MG camera and firing muzzle match the rendered bore on a pitched and rolled hull', () => {
  const r = controls('su_is2', true), pm = r.rt.model.mgs[0];
  tiltBody(r, .12, .1, .6, [5, .4, -7]);
  r.G.T[0].yaw = .7; r.G.sightM = pm.index;
  r.G.MG[pm.index].aim = { yaw: 1.1, pitch: .4 };
  const mz = r.live.sightMuzzle();
  r.rt.at({ yaw: .7, mgYaw: .4, mgPitch: .4 });
  const mouth = transformPoint(pm.node.world, pm.muzzleVector), direction = transformDir(pm.node.world, [0, 0, 1]);
  mz.pos.forEach((v, k) => close(v, mouth[k], 'sloped roof muzzle', 1e-6));
  mz.dir.forEach((v, k) => close(v, direction[k], 'sloped roof bore', 1e-6));
});

test('G takes manual Oplot ownership, fires its actual gun and restores automatic preference with remaining rounds', () => {
  const r = controls('su_t10m');
  r.live.cycleSightGun();
  assert.equal(r.G.sightT, 1);
  assert.equal(r.G.apsOn, true, 'manual selection preserves the interception preference');
  assert.equal(r.snapshot().enabled, false, 'automatic drive is paused for manual control');
  r.live.trigger();
  assert.deepEqual(r.G.pending.map(p => [p.ti, p.gi]), [[1, 0]], 'primary fires the selected six-barrel gun alone even when both turrets bear');
  const gun = r.G.loadout.turrets[1].guns[0], before = loadout.roundsLeft(gun);
  assert.equal(r.live.fireGun(1, 0), true);
  assert.equal(r.G.shots.length, 1);
  assert.equal(loadout.roundsLeft(gun), before - 1);
  r.live.cycleSightGun();
  assert.equal(r.G.sightT, 0);
  assert.equal(r.snapshot().enabled, true);
  assert.equal(r.snapshot().rounds, before - 1, 'interception uses the remaining shared magazine');
  r.G.apsOn = false;
  r.live.cycleSightGun(); r.live.cycleSightGun();
  assert.equal(r.snapshot().enabled, false, 'switchback preserves an explicit disabled preference');
});

test('an old automatic snapshot cannot overwrite manually selected Oplot bearing', () => {
  const r = controls('su_t10m');
  r.live.cycleSightGun();
  r.G.T[1].yaw = .7; r.G.T[1].guns[0].pitch = .2;
  r.live.applyAps({ aps: [{ ...r.snapshot(), owner: ME, enabled: true, mode: 'scanning', yaw: 1.2, pitch: .4, spin: 0, track_pos: [] }], events: [] }, { aps_gun_ok: true, aps_radar_ok: true });
  assert.equal(r.G.T[1].yaw, .7);
  assert.equal(r.G.T[1].guns[0].pitch, .2);
});

test('garage weapon selection after leaving a protection vehicle ignores its old battle APS cache', () => {
  const r = controls('de_pz3_j');
  r.G.mode = 'garage'; r.G.aps = data.vehicles.su_t10m.weapons.aps;
  assert.doesNotThrow(() => r.live.cycleSightGun());
  assert.equal(r.apsCalls.length, 0, 'garage switching cannot drive a stale battle protection mount');
});

test('online manual Oplot fire uses the independently traversed rendered mount and existing server fire path', async () => {
  const r = controls('su_t10m');
  r.G.loadout.imported = await decodeImported(data.vehicles.su_t10m.model);
  const renderer = { mesh: data => ({ data, count: data.length / STRIDE }), instancedMesh: (data, capacity) => ({ data, count: data.length / STRIDE, capacity }), setInstances() {}, freeMesh() {} };
  r.G.model = buildTank(renderer, r.G.loadout, loadout.generatedTurretParts);
  r.G.online = { seq: 0, dead: false };
  r.live.cycleSightGun();
  r.G.T[0].yaw = .7; r.G.T[1].yaw = 1.1; r.G.T[1].guns[0].pitch = .25;
  const modelGun = r.G.model.turrets[1].guns[0];
  r.G.model.turrets[0].node.yaw = .7;
  r.G.model.turrets[1].node.yaw = 1.1 - .7; modelGun.node.pitch = -.25; r.G.model.root.update();
  const gun = r.G.loadout.turrets[1].guns[0], mouth = transformPoint(modelGun.node.world, [0, 0, gun.muzzleOffset]);
  const sight = r.live.sightMuzzle();
  sight.pos.forEach((v, k) => close(v, mouth[k], 'independent Oplot muzzle', 1e-6));
  assert.equal(r.live.fireGun(1, 0), true);
  r.G.shots[0].origin.forEach((v, k) => close(v, mouth[k], 'Oplot round leaves rendered muzzle', 1e-6));
  const packets = r.sent.map(m => m.t);
  assert.deepEqual(packets, ['aps', 'fire']);
  assert.equal(r.sent[0].enabled, false, 'pause reaches the server before manual fire');
  assert.equal(r.sent[1].shell, gun.ammo[0].shell.id);
  assert.equal(r.sent[1].seq, 1);
  assert.ok(!('rounds' in r.sent[0]), 'online control never asks the server to trust a client ammunition count');
  r.live.cycleSightGun();
  assert.equal(r.sent.at(-1).t, 'aps'); assert.equal(r.sent.at(-1).enabled, true);
});

test('selected coax converges from its actual muzzle while retaining its shared gun elevation', () => {
  const r = controls('su_is2', true), i = r.G.MG.findIndex(e => e.m.mount === 'coax');
  r.G.sightM = i; r.G.aimPoint = [0, 2.02, 25];
  for (let k = 0; k < 240; k++) r.live.aimTurrets(1 / 60);
  const mz = r.live.sightMuzzle(), d = r.G.aimPoint.map((v, k) => v - mz.pos[k]);
  close(Math.atan2(mz.dir[0], mz.dir[2]), Math.atan2(d[0], d[2]), 'coax parallax at 25m', 2e-6);
  close(Math.asin(mz.dir[1]), Math.atan2(d[1], Math.hypot(d[0], d[2])), 'coax vertical convergence', 2e-6);
});

test('selected coax keeps its zero and parallax alignment on a pitched and rolled hull', () => {
  const r = controls('su_is2', true), i = r.G.MG.findIndex(e => e.m.mount === 'coax');
  r.G.sightM = i; tiltBody(r, .1, .15); r.G.aimPoint = [0, 6, 35];
  for (const zero of [0, 800]) {
    r.G.zero = zero;
    for (let k = 0; k < 240; k++) r.live.aimTurrets(1 / 60);
    const mz = r.live.sightMuzzle(), d = r.G.aimPoint.map((v, k) => v - mz.pos[k]);
    close(Math.atan2(mz.dir[0], mz.dir[2]), Math.atan2(d[0], d[2]), 'sloped coax horizontal convergence', 2e-6);
    close(Math.asin(mz.dir[1]) - Math.atan2(d[1], Math.hypot(d[0], d[2])), ballistics.elevationAt(r.G.MG[i].m.table, zero), `sloped coax zero ${zero}`, 2e-6);
  }
});

test('automatic Oplot ammunition depletion selects a valid manual round and never fires an empty magazine', () => {
  const r = controls('su_t10m'), gun = r.G.loadout.turrets[1].guns[0];
  r.live.applyAps({ aps: [{ ...r.snapshot(), owner: ME, enabled: true, mode: 'scanning', yaw: 0, pitch: 0, spin: 0, rounds: 500, track_pos: [] }], events: [] }, { aps_gun_ok: true, aps_radar_ok: true });
  assert.equal(gun.ammo[0].count, 0);
  r.live.cycleSightGun();
  assert.equal(r.live.fireGun(1, 0), true);
  assert.equal(gun.ammo[1].count, 299, 'the selected ready round follows the remaining type');
  r.live.cycleSightGun();
  r.live.applyAps({ aps: [{ ...r.snapshot(), owner: ME, enabled: true, mode: 'empty', yaw: 0, pitch: 0, spin: 0, rounds: 0, track_pos: [] }], events: [] }, { aps_gun_ok: true, aps_radar_ok: true });
  r.live.cycleSightGun();
  assert.equal(r.live.fireGun(1, 0), false, 'no ghost round after interception drains the magazine');
});

test('a destroyed Oplot gun cannot be fired by taking manual control', () => {
  const r = controls('su_t10m');
  r.G.cstate = { modules: data.vehicles.su_t10m.modules.map(() => 1) };
  const i = data.vehicles.su_t10m.modules.findIndex(m => m.id === r.G.aps.gun_module);
  r.G.cstate.modules[i] = 0;
  r.live.cycleSightGun(); r.live.trigger();
  assert.ok(!r.G.pending.some(p => p.ti === 1), 'broken protection gun is not queued');
  assert.equal(r.live.fireGun(1, 0), false);
  assert.equal(loadout.roundsLeft(r.G.loadout.turrets[1].guns[0]), 900);
});

test('selected MG primary fires only that MG and preserves the secondary battery in cannon mode', () => {
  const r = controls('su_is2', true), i = r.G.MG.findIndex(e => e.m.mount === 'pintle');
  r.G.fireHeld = true; r.G.sightM = i;
  r.live.trigger();
  assert.equal(r.G.pending.length, 0, 'MG primary cannot queue cannons');
  r.live.stepMachineGuns(1 / 60);
  assert.ok(r.G.MG[i].st.fired > 0);
  assert.ok(r.G.MG.every((e, k) => k === i || e.st.fired === 0));
  r.G.fireHeld = false; r.G.mgHeld = true; r.G.sightM = -1;
  r.live.stepMachineGuns(1 / 60);
  assert.ok(r.G.MG.every(e => e.st.fired > 0));
});

test('the selected roof MG zero sends real ballistic rounds through the matching range mark', () => {
  const r = controls('su_is2', true), i = r.G.MG.findIndex(e => e.m.mount === 'pintle');
  r.G.sightM = i;
  for (const range of [200, 600, 800]) {
    r.G.zero = range;
    const base = r.live.sightMuzzle().pos;
    r.G.aimPoint = [base[0], base[1], base[2] + range];
    for (let k = 0; k < 240; k++) r.live.layMg(i, 1 / 60);
    const mz = r.live.sightMuzzle(), shot = ballistics.newShot(mz.pos, mz.dir, r.G.MG[i].m.bullet);
    let before;
    while (shot.pos[2] < r.G.aimPoint[2]) { before = shot.pos.slice(); ballistics.stepShot(shot, 1 / 500); }
    const k = (r.G.aimPoint[2] - before[2]) / (shot.pos[2] - before[2]);
    const point = before.map((v, j) => v + (shot.pos[j] - v) * k);
    close(point[0], r.G.aimPoint[0], `ballistic lateral hit ${range}m`, .01);
    close(point[1], r.G.aimPoint[1], `ballistic vertical hit ${range}m`, .015);
  }
});

test('the actual HUD range graduation marks the selected MG ballistic impact in the scope image', () => {
  const r = controls('su_is2', true), i = r.G.MG.findIndex(e => e.m.mount === 'pintle');
  r.G.sightM = i; r.G.zero = 200;
  const table = r.G.MG[i].m.table, row = table.find(q => q.range === 800);
  const ze = ballistics.elevationAt(table, r.G.zero), targetHeight = r.live.sightMuzzle().pos[1];
  r.G.cam.pitch = row.elevation - ze;
  r.G.aimPoint = [0, targetHeight + Math.tan(r.G.cam.pitch) * 800, 800];
  for (let k = 0; k < 240; k++) r.live.layMg(i, 1 / 60);
  const mz = r.live.sightMuzzle(), cw = 1280, ch = 800;
  const selectedMg = r.G.MG[i], fwd = dirFrom(0, r.G.cam.pitch), tilt = 0;
  const camPos = mz.trunnion.map((v, k) => v + mz.dir[k] * .6);
  const scope = optics.sightProjection(r.G.loadout.turrets[0].sight.levels[0], cw, ch);
  const viewProj = mul(perspective(scope.fovY, cw / ch, .3, 9000), lookAtLH(camPos, fwd).view);
  r.G.aim.dist = Math.hypot(...r.G.aimPoint.map((v, k) => v - mz.trunnion[k]));
  const start = source.indexOf('    if (inSight) {\n      // where the gun'), end = source.indexOf('\n\n    // ---- projectiles', start);
  new Function('G', 'selectedMg', 'sightMuzzle', 'tilt', 'ze', 'dirFrom', 'clamp', 'project', 'viewProj', 'camPos', 'fwd', 'cw', 'ch', 'inSight', 'srt', 'sgs', ...Object.keys(optics), source.slice(start, end))(
    r.G, selectedMg, r.live.sightMuzzle, tilt, ze, dirFrom, clamp, project, viewProj, camPos, fwd, cw, ch, true, r.G.T[0], r.G.T[0].guns[0], ...Object.values(optics));
  const shot = ballistics.newShot(mz.pos, mz.dir, selectedMg.m.bullet);
  let before;
  while (shot.pos[2] < 800) { before = shot.pos.slice(); ballistics.stepShot(shot, 1 / 500); }
  const k = (800 - before[2]) / (shot.pos[2] - before[2]), point = before.map((v, j) => v + (shot.pos[j] - v) * k);
  const pr = project(viewProj, point), impactPixel = [(pr[0] * .5 + .5) * cw, (1 - (pr[1] * .5 + .5)) * ch];
  const lines = []; let from;
  const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, arc() {}, fill() {}, clip() {}, stroke() {}, closePath() {},
    createRadialGradient: () => ({ addColorStop() {} }), strokeText() {}, fillText() {},
    moveTo(x, y) { from = [x, y]; }, lineTo(x, y) { lines.push([...from, x, y]); } };
  Hud.prototype.drawSight.call({ ctx, overlay: { width: cw, height: ch } }, scope.radius, scope.pxPerRad,
    { table: [row], zeroElev: ze, offset: r.G.sightOffset, name: selectedMg.m.weapon, ready: true });
  const half = 12 * ch / 900;
  const tick = lines.find(l => Math.abs(l[2] - l[0] - half * 2) < 1e-6 && l[3] === l[1]);
  assert.ok(tick, 'the real HUD emits the 800m graduation');
  close((tick[0] + tick[2]) / 2, impactPixel[0], 'range graduation horizontal impact', .1);
  close(tick[1], impactPixel[1], 'range graduation vertical impact', .1);
});
