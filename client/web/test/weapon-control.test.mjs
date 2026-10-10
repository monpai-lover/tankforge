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
import { Combat, launcherCanFire, bulletShell } from '../src/game/combat.js';
import { Enemy, useCombat, combatHit } from '../src/game/enemies.js';
import { Terrain } from '../src/game/terrain.js';
import { humpLift, hitTargets, groundHit } from '../src/game/world.js';
const damageApi = await import('../src/game/weaponDamage.js').catch(() => ({}));

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
    veh: { body: new RigidBody(1000, [1000, 1000, 1000], [0, 0, 0]), impulse() {}, worldPoint: p => p },
  };
  const sent = [], apsCalls = [];
  const core = loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm', import.meta.url)),
    { materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains) });
  const combat = new Combat(core, data.machineGuns), fresh = combat.fresh('control:' + id, data.vehicles[id]);
  G.combat = combat; G.combatKey = 'control:' + id; G.cstate = fresh.state; G.caps = fresh.caps;
  G.bundle = combat.prepare?.(G.combatKey, data.vehicles[id]) || data.vehicles[id];
  core.call({ op: 'mw_reset', defs: Object.values(data.missiles) });
  if (G.aps) core.call({ op: 'mw_aps', owner: ME, team: 0, def: G.aps, seed: 10 });
  G.missiles = { setAps(owner, enabled, rate_rpm = null, rounds = null) {
    apsCalls.push({ owner, enabled, rounds });
    core.call({ op: 'mw_aps', owner, enabled, rate_rpm, rounds });
  } };
  const deps = { G, ME, data, DEG, RECOIL_ROCK: 1, BULLET_DT: 1 / 120, clamp, dirFrom, hullTilt, gunnery, ballistics, mgSim, loading,
    foldDepression, foldYawLimit, launcherCanFire, ...damageApi,
    ...selection, ...loadout, ...optics, rng: { nextF32: () => .5 },
    net: { send: m => sent.push(m) }, hud: { buildAmmo() {}, toast() {}, aps() {} },
    sound: { tone() {}, apsGun() {}, mg() {}, shot() {} }, fx: { mgFlash() {}, autocannonBlast() {}, muzzleBlast() {}, bulletBoard() {}, bulletGround() {}, beam() {} },
    hitTargets, groundHit, combatHit, bulletShell, rangeTargets: () => [], buildingHit: () => null, onCombatHit() {}, rnd: k => v => Math.round(v * k) / k,
    surfaceAt: () => 0, impactColor: () => [0, 0, 0], selectAmmo() {},
    launcherMount: loadout.launcherMount, reloadTime: loadout.reloadTime,
  };
  delete deps.sightLevels;
  const preamble = source.slice(source.indexOf('  const pose = '), source.indexOf('  // ----------------------------------------------------------------- workshop'));
  const moduleCheck = source.slice(source.indexOf('  const moduleOk ='), source.indexOf('  /** Where the protection gun'));
  const stabilizers = source.slice(source.indexOf('  const GUNNER ='), source.indexOf('  /**\n   * The hull\'s attitude'));
  const functions = ['cycleSightGun', 'trigger', 'fireGun', 'layMg', 'sightMuzzle', 'stepMachineGuns', 'hitEnemy', 'wireShot', 'updateBullets', 'currentLos', 'applyAps', 'toggleAps', 'apsAutomatic', 'syncApsControl', 'mountFor', 'apsOf', 'trackHull', 'aimTurrets'].map(functionSource).join('\n');
  const live = new Function(...Object.keys(deps), `${preamble}\n${moduleCheck}\n${stabilizers}\n${functions}\nreturn {cycleSightGun, trigger, fireGun, layMg, sightMuzzle, stepMachineGuns, updateBullets, currentLos, applyAps, toggleAps, syncApsControl, apsOf, aimTurrets};`)(...Object.values(deps));
  const snapshot = () => core.call({ op: 'mw_step', dt: 1 / 60, actors: [] }).aps[0];
  return { G, live, rt, sent, apsCalls, snapshot, core, combat, damage: (id, health = 0) => {
    G.cstate.modules[G.bundle.modules.findIndex(m => m.id === id)] = health;
    G.caps = combat.advance(G.combatKey, G.cstate, 0, 1).caps;
  } };
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

test('queued then hit main gun cannot fire or consume ammo while the healthy selected MG still fires', () => {
  const r = controls('de_pz3_j'), g = r.G.loadout.turrets[0].guns[0];
  r.live.trigger();
  assert.equal(r.G.pending.length, 1);
  const before = loadout.roundsLeft(g);
  r.damage(data.vehicles.de_pz3_j.modules.find(m => m.kind === 'gun_breech').id);
  assert.equal(r.live.fireGun(0, 0), false);
  assert.equal(loadout.roundsLeft(g), before);
  assert.equal(r.G.shots.length, 0);
  r.G.sightM = 0; r.G.fireHeld = true;
  r.live.stepMachineGuns(.01);
  assert.ok(r.G.bullets.length > 0, 'healthy MG remains independent of the broken main gun');
});

test('new-core unknown own gun key cannot queue even when other weapons keep can_fire true', () => {
  const r = controls('de_pz3_j');
  r.G.caps = {can_fire: true, weapons: {}};
  r.live.trigger();
  assert.equal(r.G.pending.length, 0);
  assert.equal(r.live.fireGun(0, 0), false);
});

test('MG own barrel damage stops bullets without consuming a belt and healthy gun remains ready', () => {
  const r = controls('de_pz3_j');
  r.G.sightM = 0; r.G.fireHeld = true;
  const before = r.G.MG[0].st.belt;
  r.damage('mg:' + r.G.MG[0].m.id + ':barrel');
  r.live.stepMachineGuns(.01);
  assert.equal(r.G.bullets.length, 0);
  assert.equal(r.G.MG[0].st.belt, before);
  r.live.trigger();
  assert.equal(r.G.caps.can_fire, true, 'healthy main gun remains operational');
});

test('MG firing packets carry original secondary instance and a shared firing sequence', () => {
  const r = controls('de_pz3_j');
  r.G.online = {seq: 20}; r.G.sightM = 0; r.G.fireHeld = true;
  r.live.stepMachineGuns(.01);
  assert.equal(r.sent[0]?.t, 'mg_fire');
  assert.equal(r.sent[0].seq, 21);
  assert.equal(r.sent[0].instance, 'mg:' + r.G.MG[0].m.id);
  assert.equal(r.sent[0].gun, r.G.MG[0].m.def.id);
  assert.equal(r.G.bullets[0].seq, 21);
  assert.equal(r.G.bullets[0].instance, r.sent[0].instance);
});

test('MG projectile retains its firing-time sequence and instance when its own barrel is damaged in flight', () => {
  const r = controls('de_pz3_j'), bundle = r.combat.prepare('remote:88', data.vehicles.de_pz3_j);
  const lo = loadout.makeLoadout('de_pz3_j', bundle, data.projectiles, data.machineGuns);
  const renderer = {mesh: vertices => ({vertices}), instancedMesh: vertices => ({vertices}), setInstances() {}, freeMesh() {}};
  const model = buildTank(renderer, lo, loadout.generatedTurretParts);
  const e = new Enemy('de_pz3_j', bundle, model, new Terrain(data.terrains, humpLift), {x: 0, z: 8, heading: 0}, null);
  e.loadout = lo; e.remote = true; e.netId = 88; e.team = 1;
  useCombat(e, r.combat, 'remote:88');
  r.G.enemies = [e]; r.G.bulletShells = new Map();
  r.G.online = {seq: 20, team: 0}; r.G.sightM = 0; r.G.fireHeld = true;
  r.live.stepMachineGuns(.01);
  const fired = r.sent.find(m => m.t === 'mg_fire');
  assert.ok(fired);
  r.damage('mg:' + r.G.MG[0].m.id + ':barrel');
  for (let i = 0; i < 10 && r.G.bullets.length; i++) r.live.updateBullets(1 / 120);
  const hit = r.sent.find(m => m.t === 'mg_hit');
  assert.ok(hit, 'actual projectile strikes real remote armour');
  assert.equal(hit.seq, fired.seq); assert.equal(hit.instance, fired.instance);
  assert.equal(hit.target, e.netId);
  assert.equal(r.G.caps.weapons[fired.instance].can_fire, false, 'current mount damage cannot revoke a bullet already fired');
});

test('Oplot manual and automatic gun remain usable with a broken main cannon but obey common crew/repair gates', () => {
  const r = controls('su_t10m'), g = r.G.loadout.turrets[1].guns[0];
  r.damage(data.vehicles.su_t10m.modules.find(m => m.kind === 'gun_breech').id);
  r.G.sightT = 1;
  assert.equal(r.live.fireGun(1, 0), true, 'own APS gun survives main cannon damage');
  r.G.T[1].loading.state[0] = 'ready'; g.loaded = 0;
  r.G.cstate.repair_s = 10;
  r.G.caps = r.combat.advance(r.G.combatKey, r.G.cstate, 0, 1).caps;
  assert.equal(r.live.fireGun(1, 0), false, 'repair pauses manual APS fire');
  r.G.sightT = 0;
  r.live.syncApsControl();
  const actor = {};
  r.live.apsOf(actor, r.G.aps, r.G.loadout, r.G.T.map(t => t.yaw), {pos: [0, 0, 0], heading: 0}, r.G.bundle, r.G.cstate, r.G.caps);
  assert.equal(actor.aps_gun_ok, false, 'repair pauses actual automatic APS firing');
  assert.equal(r.apsCalls.at(-1).enabled, true, 'automatic preference persists so recovery resumes automatically');
});

test('main turret drive damage affects its laying rate while Oplot keeps its own traverse and elevation', () => {
  const a = controls('su_t10m'), b = controls('su_t10m');
  a.G.aimPoint = b.G.aimPoint = [400, 50, 400];
  const drive = data.vehicles.su_t10m.modules.find(m => m.kind === 'turret_drive');
  b.damage(drive.id);
  a.live.aimTurrets(.1); b.live.aimTurrets(.1);
  assert.ok(Math.abs(b.G.T[0].yaw) < Math.abs(a.G.T[0].yaw) * .5, 'damaged main drive slows main traverse');
  close(b.G.T[1].yaw, a.G.T[1].yaw, 'independent APS traverse remains original');
  close(b.G.T[1].guns[0].pitch, a.G.T[1].guns[0].pitch, 'APS elevation remains original');
});

test('live cannon and MG projectiles consume their own partial dispersion without changing cyclic rate', () => {
  const a = controls('de_pz3_j'), b = controls('de_pz3_j');
  const barrel = data.vehicles.de_pz3_j.modules.find(m => m.kind === 'gun_barrel');
  b.damage(barrel.id, barrel.max_health * .25);
  assert.equal(a.live.fireGun(0, 0), true); assert.equal(b.live.fireGun(0, 0), true);
  const angle = shot => Math.acos(shot.s.vel[2] / Math.hypot(...shot.s.vel));
  close(angle(b.G.shots[0]) / angle(a.G.shots[0]), b.G.caps.weapons['gun:0:0'].dispersion_mult, 'actual cannon scatter', 1e-5);
  b.damage('mg:' + b.G.MG[0].m.id + ':barrel', 10);
  for (const r of [a, b]) {r.G.sightM = 0; r.G.fireHeld = true; r.live.stepMachineGuns(.01);}
  assert.equal(a.G.MG[0].st.fired, b.G.MG[0].st.fired, 'feed damage does not change RPM');
  close(angle(b.G.bullets[0]) / angle(a.G.bullets[0]), b.G.caps.weapons[b.G.MG[0].m.damageKey].dispersion_mult, 'actual MG scatter', 1e-5);
  assert.equal(a.G.MG[0].st.heat, b.G.MG[0].st.heat);
});

test('live APS actor passes the same per-instance performance and common gate to actual WASM', () => {
  const r = controls('su_t10m');
  const module = r.G.bundle.modules.find(m => m.id === r.G.aps.gun_module);
  r.damage(module.id, module.max_health * .25);
  const actor = {id: ME, team: 0, alive: true, center: [0, 1.3, 0], vel: [0, 0, 0]};
  r.live.apsOf(actor, r.G.aps, r.G.loadout, r.G.T.map(t => t.yaw), {pos: [0, 0, 0], heading: 0}, r.G.bundle, r.G.cstate, r.G.caps);
  const caps = r.G.caps.weapons[r.G.loadout.turrets[1].guns[0].damageKey];
  assert.equal(actor.aps_dispersion_mult, caps.dispersion_mult);
  assert.equal(actor.aps_traverse_mult, caps.traverse_mult);
  assert.equal(actor.aps_elevate_mult, caps.elevate_mult);
  assert.ok(r.core.call({op: 'mw_step', dt: 1 / 60, actors: [actor]}).aps.length === 1);
  r.G.cstate.repair_s = 2;
  r.G.caps = r.combat.advance(r.G.combatKey, r.G.cstate, 0, 1).caps;
  r.live.apsOf(actor, r.G.aps, r.G.loadout, r.G.T.map(t => t.yaw), {pos: [0, 0, 0], heading: 0}, r.G.bundle, r.G.cstate, r.G.caps);
  const result = r.core.call({op: 'mw_step', dt: 1 / 60, actors: [actor]});
  assert.equal(result.aps[0].mode, 'fault'); assert.deepEqual(result.fired, []);
});

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
