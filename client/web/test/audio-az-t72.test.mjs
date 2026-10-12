import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sound } from '../src/game/audio.js';
import { reloadProfile } from '../src/game/audioReload.js';
import * as loading from '../src/sim/loading.js';
import * as loadout from '../src/game/loadout.js';
import * as damage from '../src/game/weaponDamage.js';
import * as selection from '../src/game/weaponselection.js';
import * as gunnery from '../src/sim/gunnery.js';
import * as ballistics from '../src/sim/ballistics.js';
import * as inventory from '../src/game/ammoInventory.js';
import * as resupply from '../src/game/ammoResupply.js';
import { deriveLoadoutPerformance } from '../src/game/gameplayPerformance.js';
import { applyAmmo } from '../src/game/deploy.js';
import { loadData } from '../tools/load-data.mjs';
import { buildTank } from '../src/gfx/tankmodel.js';
import { VehicleSim } from '../src/game/vehicle.js';
import { ground } from './tankrig.mjs';
import { NetClient } from '../src/game/net.js';
import { OnlineAmmo } from '../src/game/onlineAmmo.js';
import { OnlineFires } from '../src/game/onlineFire.js';

const data = loadData(), ID = 'su_t72a';
const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const begin = source.indexOf('      G.loadout.turrets.forEach((t, ti) => {\n        t.guns.forEach((g) => tickLauncher');
const end = source.indexOf('\n      G.acc -= SIM_DT;', begin);
assert.ok(begin >= 0 && end > begin);
const body = name => { const p = source.indexOf(`  function ${name}(`); assert.ok(p >= 0); return source.slice(p, source.indexOf('\n  }', p) + 4); };
const adoption = { source: 'human-direct-instruction', statement: '自动装弹的 也用上 找个现实里用自动装弹的车', scope: 'three-fitted-az-t72-stages', mechanism: 'az_t72' };
const bank = () => ({ schemaVersion: 1, reviewState: 'reviewed', automaticAdoption: adoption, cues: {} });

function fixture({ mode = 'historical', failures = [], mixed = false, transplanted = false } = {}) {
  let b = data.vehicles[ID], id = ID, projectiles = data.projectiles;
  if (transplanted) {
    const built = loadout.buildToBundle({ base: 'de_hetzer', keepStock: false, turrets: [{ ...loadout.newTurretSpec(), loaders: 0, guns: [{ weapon: ID }] }] }, data);
    b = built.bundle; id = 'custom'; projectiles = { ...projectiles, ...built.projectiles };
  }
  const lo = deriveLoadoutPerformance(loadout.makeLoadout(id, b, projectiles, data.machineGuns), mode);
  if (mixed) {
    const manual = loadout.makeLoadout('de_tiger_e', data.vehicles.de_tiger_e, data.projectiles, data.machineGuns).turrets[0].guns[0];
    const unbound = structuredClone(manual); unbound.def.id = 'designed_88';
    lo.turrets[0].guns.push(manual, unbound);
  }
  const t = lo.turrets[0], g = t.guns[0];
  const renderer = { mesh: vertices => ({ vertices }), instancedMesh: vertices => ({ vertices }), setInstances() {}, freeMesh() {} };
  const model = buildTank(renderer, lo, loadout.generatedTurretParts);
  const veh = new VehicleSim(b, model, ground(() => 0), mode); veh.place(0, 0, 0);
  const G = { id, bundle: b, loadout: lo, model, veh, mode: 'battle', gameplayMode: mode, online: null, caps: null,
    cstate: { modules: (b.modules || []).map(m => m.max_health) }, weaponControl: { kind: 'all' }, aps: null, shots: [], pending: [],
    cam: { shake: 0 }, sightT: 0, s: { x: 0, y: 0, z: 0, heading: 0 }, ss: { pitch: 0, roll: 0 },
    T: lo.turrets.map(t => ({ yaw: 0, guns: t.guns.map(() => ({ pitch: 0 })), loading: loading.newLoading(t.guns.length, mixed ? 2 : t.loaders.length, t.guns.map(g => !g.rack), t.guns.map(g => g.mechanizedLoading)) })) };
  const sound = new Sound(), failing = new Set(failures), events = [], sources = [], gains = [];
  const fail = at => { if (failing.has(at)) throw new Error(`Injected ${at}`); };
  sound.master = {};
  sound.ctx = { state: 'running', createBufferSource() {
    fail('source.create'); const s = { playbackRate: { value: 1 }, connect() { fail('source.connect'); },
      disconnect() { this.disconnectAttempts = (this.disconnectAttempts || 0) + 1; fail('source.disconnect'); },
      start() { fail('source.start'); events.push(this.buffer.id); }, stop() { this.stopped = true; fail('source.stop'); this.onended?.(); } };
    sources.push(s); return s;
  }, createGain() { fail('gain.create'); const n = { gain: { value: 0 }, connect() { fail('gain.connect'); }, disconnect() { this.disconnectAttempts = (this.disconnectAttempts || 0) + 1; fail('gain.disconnect'); } }; gains.push(n); return n; },
  createOscillator() { throw new Error('No owned automatic synthesis fallback'); } };
  sound.loadReloadBank(bank());
  const buffers = () => { for (const id of ['az_t72_drive', 'az_t72_ram', 'az_t72_lock', 'de_manual_grab', 'de_manual_load', 'de_manual_lock']) sound.reloadSamples[id] = { id, length: 100, numberOfChannels: 1 }; };
  buffers(); let clicks = 0; sound.click = () => clicks++; sound.shot = () => {};
  const net = new NetClient(), onlineAmmo = new OnlineAmmo(), onlineFires = new OnlineFires();
  const deps = { G, data, ...loadout, ...damage, ...selection, loading, gunnery, ballistics, sound, net, onlineAmmo, onlineFires,
    hullTilt: () => 0, pose: () => ({ pos: [0, 0, 0], heading: 0 }), mountOf: (t, g) => ({ pivot: t.pivot, trunnion: g.trunnion, muzzleOffset: g.muzzleOffset }),
    rng: { nextF32: () => .5 }, surfaceAt: () => 0, impactColor: () => [0, 0, 0], RECOIL_ROCK: 1,
    fx: { muzzleBlast() {} }, clamp: (v, a, b) => Math.max(a, Math.min(b, v)) };
  const frame = new Function(...Object.keys(deps), 'SIM_DT', source.slice(begin, end));
  const tick = (dt = 1 / 60) => frame(...Object.values(deps), dt);
  const fire = new Function(...Object.keys(deps), body('fireGun') + '\nreturn fireGun;')(...Object.values(deps));
  const L = G.T[0].loading;
  const finish = () => { for (let i = 0; i < 1200 && L.state.some(s => s === 'waiting' || s === 'loading'); i++) tick(); };
  const online = () => {
    const counts = Object.fromEntries(lo.turrets.flatMap((t, ti) => t.guns.map((g, gi) => [`gun:${ti}:${gi}`, g.ammo.map(a => a.count)])));
    onlineAmmo.begin({ t: 'ammo', ammo_protocol_version: 1, battle: 7, life: 2, revision: 1, processed_through: 0, counts, targets: structuredClone(counts), resupply_progress: 0, refilled: false }, lo, G.T.map(t => t.loading));
    G.online = { seq: 0 }; net.status = 'open'; net.ws = { readyState: 1, send() {} };
    const a = source.indexOf('  const currentFireGun ='), b = source.indexOf('  G.pendingLaunch =', a);
    new Function('net', 'onlineFires', 'onlineAmmo', 'G', 'hud', 'sound', source.slice(a, b))(net, onlineFires, onlineAmmo, G, { toast() {} }, sound);
  };
  return { G, g, L, t, sound, events, failing, sources, gains, buffers, tick, fire, finish, online, net, get clicks() { return clicks; } };
}

test('only an installed AZ with canonical cartridge identities binds, including its 44 mm APFSDS body', () => {
  const r = fixture(); assert.equal(r.g.ammo[0].shell.caliber_mm, 44);
  for (const a of r.g.ammo) assert.equal(reloadProfile(r.g.def, a.shell, r.g.mechanizedLoading)?.style, 'az_t72');
  assert.equal(reloadProfile(r.g.def, r.g.shell), null);
  assert.equal(reloadProfile(r.g.def, { ...r.g.shell, id: 'he_100_of412' }, r.g.mechanizedLoading), null);
  const transplant = fixture({ transplanted: true }); assert.equal(transplant.g.mechanizedLoading, null);
  assert.equal(reloadProfile(transplant.g.def, transplant.g.shell, transplant.g.mechanizedLoading), null);
});

for (const mode of ['historical', 'casual']) test(`${mode} real main fire and consumed work emit drive, two separate rams and post-refill lock once`, () => {
  const r = fixture({ mode }), seconds = loadout.reloadTime(r.t, 0, 0, mode);
  assert.equal(r.fire(0, 0), true); assert.equal(r.fire(0, 0), false); assert.equal(r.g.loaded, -1);
  r.tick(.01); assert.deepEqual(r.events, ['az_t72_drive']);
  r.tick(seconds * .32); assert.deepEqual(r.events, ['az_t72_drive', 'az_t72_ram']);
  r.tick(seconds * .30); assert.deepEqual(r.events, ['az_t72_drive', 'az_t72_ram', 'az_t72_ram']);
  assert.equal(r.L.state[0], 'loading'); assert.equal(r.g.loaded, -1);
  r.finish(); assert.equal(r.L.state[0], 'ready'); assert.ok(r.g.ammo[r.g.loaded].count > 0);
  assert.deepEqual(r.events, ['az_t72_drive', 'az_t72_ram', 'az_t72_ram', 'az_t72_lock']); assert.equal(r.clicks, 0);
  r.tick(30); assert.equal(r.events.length, 4);
  assert.ok(r.sources.every(s => s.playbackRate.value === 1 && s.loop === false));
});

for (const mode of ['historical', 'casual']) test(`${mode} actual fire exhausts 22 sets and selected five-second refill requires a new real cycle`, () => {
  const r = fixture({ mode });
  for (let i = 0; i < 22; i++) { assert.equal(r.fire(0, 0), true); r.finish(); }
  assert.equal(r.G.shots.length, 22); assert.equal(loadout.roundsLeft(r.g), 0); assert.equal(r.L.state[0], 'empty');
  assert.equal(r.events.filter(x => x === 'az_t72_lock').length, 21); assert.equal(r.fire(0, 0), false); r.tick(50);
  const selected = fixture({ mode }); applyAmmo(selected.G.loadout, { [ID]: { '0.0': [2, 0, 1] } });
  const plan = inventory.captureAmmoPlan(selected.G.loadout);
  for (const a of selected.g.ammo) a.count = 0; selected.g.loaded = -1; selected.L.state[0] = 'empty';
  const supply = resupply.newResupplyState(); assert.equal(resupply.stepResupply(supply, 4.99, true, true).complete, false);
  assert.equal(resupply.stepResupply(supply, .01, true, true).complete, true);
  assert.deepEqual(inventory.refillAmmo(selected.G.loadout, plan, [selected.L]), ['gun:0:0']);
  assert.deepEqual(selected.g.ammo.map(a => a.count), [2, 0, 1]); assert.equal(selected.g.loaded, -1); assert.equal(selected.L.state[0], 'waiting');
  assert.deepEqual(selected.events, []); selected.tick(.01); assert.deepEqual(selected.events, ['az_t72_drive']);
  selected.finish(); assert.deepEqual(selected.events, ['az_t72_drive', 'az_t72_ram', 'az_t72_ram', 'az_t72_lock']);
});

for (const part of ['az_drive', 'az_ram']) test(`${part} damage stalls real work and cleanup; recovery never repeats a consumed stroke`, () => {
  const r = fixture(); r.G.caps = { loader: false, weapons: { 'gun:0:0': { can_fire: true, reload_mult: 1.6, dispersion_mult: 1 } } };
  assert.equal(r.fire(0, 0), true); r.tick(.01); assert.deepEqual(r.events, ['az_t72_drive']);
  const i = r.G.bundle.modules.findIndex(m => m.id === part); r.G.cstate.modules[i] = 0;
  const before = loading.progress(r.L, 0).remaining; r.tick(100); assert.equal(loading.progress(r.L, 0).remaining, before);
  assert.equal(r.sound.reloadVoices.size, 0); r.G.cstate.modules[i] = r.G.bundle.modules[i].max_health;
  r.finish(); assert.deepEqual(r.events, ['az_t72_drive', 'az_t72_ram', 'az_t72_ram', 'az_t72_lock']);
});

test('inaudible real milestones are consumed without catch-up and unavailable completion stays owned', () => {
  const r = fixture(); r.sound.setReloadAudible(false); r.fire(0, 0); r.tick(5);
  assert.deepEqual(r.events, []); r.sound.setReloadAudible(true); r.tick(.01); assert.deepEqual(r.events, []);
  r.finish(); assert.deepEqual(r.events, ['az_t72_lock']); assert.equal(r.clicks, 0);
  const missing = fixture(); delete missing.sound.reloadSamples.az_t72_lock; missing.fire(0, 0); missing.finish();
  assert.deepEqual(missing.events, ['az_t72_drive', 'az_t72_ram', 'az_t72_ram']); assert.equal(missing.clicks, 0);
});

test('mixed mounted automatic, approved manual and unbound actual completions preserve per-gun ownership', () => {
  const r = fixture({ mixed: true }); for (let gi = 0; gi < 3; gi++) loading.fired(r.L, gi); r.tick(100);
  assert.deepEqual(r.L.state, ['ready', 'ready', 'ready']); assert.equal(r.events.filter(x => x === 'az_t72_lock').length, 1);
  assert.equal(r.events.filter(x => x === 'de_manual_lock').length, 1); assert.equal(r.clicks, 1);
  const unbound = fixture({ transplanted: true }); unbound.fire(0, 0); unbound.finish(); assert.deepEqual(unbound.events, []); assert.equal(unbound.clicks, 1);
});

test('automatic actual ready stays owned with no job, owner/voice saturation and completion-to-empty', () => {
  const idle = fixture(); assert.equal(idle.sound.reloadReady(idle.g, idle.L, 0), true); assert.deepEqual(idle.events, []);
  const garage = fixture(); garage.G.mode = 'garage'; garage.fire(0, 0); garage.finish(); assert.equal(garage.clicks, 0); assert.deepEqual(garage.events, []);
  const capacity = fixture(), manual = loadout.makeLoadout('de_tiger_e', data.vehicles.de_tiger_e, data.projectiles).turrets[0].guns[0];
  for (let i = 0; i < 8; i++) capacity.sound.reloadAudio.work({ owner: {}, cycle: i, definition: manual.def, shell: manual.shell, remaining: 8, total: 8, rate: 0 });
  capacity.fire(0, 0); capacity.finish(); assert.equal(capacity.clicks, 0); assert.deepEqual(capacity.events, []);
  const voices = fixture(); for (let i = 0; i < 8; i++) assert.ok(voices.sound._playReloadCue('de_manual_grab'));
  voices.events.length = 0; voices.fire(0, 0); voices.finish(); assert.deepEqual(voices.events, []); assert.equal(voices.clicks, 0);
  voices.sound.cancelReloads(); assert.equal(voices.sound.reloadVoices.size, 0); assert.equal(voices.sound.reloadAudio.size, 0);
  const empty = fixture(); empty.fire(0, 0); empty.tick(.01); for (const a of empty.g.ammo) a.count = 0; empty.finish();
  assert.equal(empty.L.state[0], 'empty'); assert.deepEqual(empty.events, ['az_t72_drive']); assert.equal(empty.clicks, 0);
});

test('actual current and reordered older prediction rejection blocks only its immutable cycle', () => {
  const r = fixture(); r.online(); r.fire(0, 0); r.tick(.01);
  r.net._receive({ t: 'fire_rejected', seq: 1, ammo_scope: { battle: 7, life: 2 } }); r.finish();
  assert.deepEqual(r.events, ['az_t72_drive']); assert.equal(r.clicks, 0); assert.equal(r.sound.reloadVoices.size, 0);
  r.fire(0, 0); r.tick(.01); r.finish(); assert.equal(r.events.filter(x => x === 'az_t72_lock').length, 1);
  r.fire(0, 0); r.tick(.01); const before = r.events.length;
  r.net._receive({ t: 'fire_rejected', seq: 3, ammo_scope: { battle: 7, life: 2 } });
  r.net._receive({ t: 'fire_rejected', seq: 2, ammo_scope: { battle: 7, life: 2 } }); r.finish(); assert.equal(r.events.length, before);
  const delayed = fixture(); delayed.online(); delayed.fire(0, 0); delayed.finish(); delayed.fire(0, 0); delayed.tick(.01);
  delayed.net._receive({ t: 'fire_rejected', seq: 1, ammo_scope: { battle: 7, life: 2 } }); delayed.finish();
  assert.equal(delayed.events.filter(x => x === 'az_t72_lock').length, 2);
});

test('stage observations reject future work, wrong gun/mechanism and stale cycle without duplicating strokes', () => {
  const r = fixture(); r.fire(0, 0); r.tick(.01); assert.equal(typeof r.sound.reloadStage, 'function');
  const e = { gun: 0, owner: 'mechanized', mechanism: 'az_t72', stage: 'projectile_ram', cycle: r.L.waitedSince[0], workFraction: .32 };
  for (const event of [e, { ...e, gun: 1 }, { ...e, mechanism: 'other' }, { ...e, cycle: e.cycle - 1 }]) assert.equal(r.sound.reloadStage(r.g, r.L, 0, event), false);
  r.tick(2.6); const n = r.events.length; assert.equal(r.sound.reloadStage(r.g, r.L, 0, e), false); assert.equal(r.events.length, n);
});

test('replacing a selected round mid-cycle preserves later actual rams without replaying consumed drive', () => {
  const r = fixture(); r.fire(0, 0); r.tick(.01); r.g.selected = 1; r.finish();
  assert.equal(r.g.loaded, 1); assert.deepEqual(r.events, ['az_t72_drive', 'az_t72_ram', 'az_t72_ram', 'az_t72_lock']);
  assert.equal(r.clicks, 0);
});

test('replacing a bank after actual current prediction rejection cannot resurrect that cycle lock', () => {
  const r = fixture(); r.online(); r.fire(0, 0); r.tick(.01);
  r.net._receive({ t: 'fire_rejected', seq: 1, ammo_scope: { battle: 7, life: 2 } });
  r.sound.loadReloadBank(bank()); r.buffers(); r.finish();
  assert.deepEqual(r.events, ['az_t72_drive']); assert.equal(r.clicks, 0); assert.equal(r.sound.reloadVoices.size, 0);
  r.fire(0, 0); r.finish(); assert.equal(r.events.filter(id => id === 'az_t72_lock').length, 1);
});

for (const at of ['source.create', 'gain.create', 'source.connect', 'gain.connect', 'source.start']) test(`automatic ${at} failure cannot escape actual work or create substitute completion`, () => {
  const r = fixture({ failures: [at] }); assert.equal(r.fire(0, 0), true); assert.doesNotThrow(r.finish);
  assert.equal(r.L.state[0], 'ready'); assert.deepEqual(r.events, []); assert.equal(r.clicks, 0);
  assert.equal(r.sound.reloadVoices.size, 0); r.sound.cancelReloads(); assert.equal(r.sound.reloadAudio.size, 0);
});

test('automatic faulty teardown, bank and session replacement clear admissions and jobs without replay', () => {
  const r = fixture(); r.fire(0, 0); r.tick(.01); assert.equal(r.sound.reloadVoices.size, 1);
  const late = r.sources[0].onended;
  for (const at of ['source.stop', 'source.disconnect', 'gain.disconnect']) r.failing.add(at);
  assert.doesNotThrow(() => r.sound.loadReloadBank(bank())); assert.equal(r.sound.reloadVoices.size, 0); assert.equal(r.sound.reloadAudio.size, 0);
  assert.ok(r.sources[0].disconnectAttempts); assert.ok(r.gains[0].disconnectAttempts); assert.equal(r.gains[0].gain.value, 0); assert.doesNotThrow(late);
  r.buffers(); r.failing.clear(); r.sound.setReloadAudible(false); r.finish(); assert.deepEqual(r.events, ['az_t72_drive']);
  assert.doesNotThrow(() => r.sound.cancelReloads()); assert.equal(r.sound.reloadAudio.size, 0);
});

test('automatic cue decoding shares active-style, two-worker and decoded-memory limits', async () => {
  const r = fixture(); const oldFetch = globalThis.fetch; let active = 0, peak = 0, count = 0;
  const cues = Object.fromEntries(['az_t72_drive', 'az_t72_ram', 'az_t72_lock', 'de_manual_grab'].map(id => [id, { url: 'data:audio/wav;base64,AA==' }]));
  r.sound.loadReloadBank({ ...bank(), cues });
  globalThis.fetch = async () => ({ arrayBuffer: async () => new ArrayBuffer(1) });
  r.sound.ctx.decodeAudioData = async () => { active++; peak = Math.max(peak, active); count++; await new Promise(resolve => setImmediate(resolve)); active--; return { length: 4 * 1024 * 1024, numberOfChannels: 1 }; };
  try {
    r.sound.prepareReloadBank(r.G.loadout); for (let i = 0; i < 30 && r.sound.reloadDecodeRunning; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(count, 3); assert.equal(peak, 2); assert.equal(Object.keys(r.sound.reloadSamples).length, 2); assert.equal(r.sound.reloadBytes, 32 * 1024 * 1024);
  } finally { globalThis.fetch = oldFetch; }
});
