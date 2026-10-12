import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sound } from '../src/game/audio.js';
import { mountedReloadRate } from '../src/game/weaponDamage.js';
import * as loading from '../src/sim/loading.js';
import * as loadout from '../src/game/loadout.js';
import { loadData } from '../tools/load-data.mjs';

const data = loadData();
const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const start = source.indexOf('      G.loadout.turrets.forEach((t, ti) => {\n        t.guns.forEach((g) => tickLauncher');
const end = source.indexOf('\n      G.acc -= SIM_DT;', start);
assert.ok(start >= 0 && end > start, 'real main loader/refill/completion adapter');

function fixture({ mixed = false, reverse = false, audible = true, mode = 'battle' } = {}) {
  const lo = loadout.makeLoadout('de_tiger_e', data.vehicles.de_tiger_e, data.projectiles, data.machineGuns);
  if (mixed) {
    const other = structuredClone(lo.turrets[0].guns[0]);
    other.def = { ...other.def, id: 'designed_88' };
    lo.turrets[0].guns.push(other);
    if (reverse) lo.turrets[0].guns.reverse();
  }
  const guns = lo.turrets[0].guns;
  const G = { loadout: lo, T: [{ loading: loading.newLoading(guns.length, guns.length) }], mode,
    caps: null, online: null, gameplayMode: 'historical', model: { payload() {} } };
  const sound = new Sound(), events = [], sources = [];
  sound.master = {};
  sound.ctx = { currentTime: 0, createBufferSource() {
    const node = { playbackRate: { value: 1 }, connect() {}, disconnect() {},
      start() { events.push(this.buffer.id); }, stop() { this.onended?.(); } };
    sources.push(node); return node;
  }, createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; },
  createOscillator() { throw new Error('a mapped bank cannot synthesize a substitute'); } };
  sound.loadReloadBank({ schemaVersion: 1, reviewState: 'reviewed', cues: {} });
  for (const stage of ['grab', 'load', 'lock']) sound.reloadSamples[`de_manual_${stage}`] = { id: stage, duration: 1 };
  sound.setReloadAudible(audible);
  let clicks = 0;
  sound.click = () => clicks++;
  const deps = { G, SIM_DT: 1 / 60, ...loadout, loading, sound, mountedReloadRate,
    clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)), gunTrigger() { throw new Error('manual fixture has no rotary trigger'); } };
  const tick = () => new Function(...Object.keys(deps), source.slice(start, end))(...Object.values(deps));
  const finish = () => { for (let i = 0; i < 1000 && G.T[0].loading.state.some(s => s === 'waiting' || s === 'loading'); i++) tick(); };
  return { G, guns, sound, events, sources, tick, finish, get clicks() { return clicks; } };
}

for (const reverse of [false, true]) test(`simultaneous mapped and unbound completions retain each gun's ownership (${reverse ? 'unbound first' : 'mapped first'})`, () => {
  const r = fixture({ mixed: true, reverse }), L = r.G.T[0].loading;
  loading.fired(L, 0); loading.fired(L, 1); r.finish();
  assert.deepEqual(L.state, ['ready', 'ready']);
  assert.equal(r.events.filter(stage => stage === 'lock').length, 1);
  assert.equal(r.clicks, 1, 'only the separate unbound gun retains a legacy completion');
});

test('a rejected mapped completion remains owned and silent without a playback job', () => {
  const r = fixture(), L = r.G.T[0].loading;
  loading.fired(L, 0); r.sound.cancelReload(r.guns[0], true, L.waitedSince[0]); r.finish();
  assert.equal(L.state[0], 'ready'); assert.deepEqual(r.events, []); assert.equal(r.clicks, 0);
});

test('owner-capacity admission cannot redirect a mapped completion to legacy audio', () => {
  const r = fixture(), L = r.G.T[0].loading, gun = r.guns[0];
  for (let i = 0; i < 8; i++) r.sound.reloadAudio.work({ owner: {}, cycle: i, definition: gun.def, shell: gun.ammo[0].shell, remaining: 7.5, total: 7.5, rate: 0 });
  assert.equal(r.sound.reloadAudio.size, 8);
  loading.fired(L, 0); r.finish();
  assert.equal(L.state[0], 'ready'); assert.deepEqual(r.events, []); assert.equal(r.clicks, 0);
});

for (const options of [{ audible: false }, { audible: false, mode: 'garage' }]) test(`mapped ownership does not depend on audibility or active work (${options.mode || 'battle'})`, () => {
  const r = fixture(options), L = r.G.T[0].loading;
  loading.fired(L, 0); r.finish();
  assert.equal(L.state[0], 'ready'); assert.deepEqual(r.events, []); assert.equal(r.clicks, 0);
});

test('a mapped actual-ready completion without an admitted job reports ownership without emitting lock', () => {
  const r = fixture(), L = r.G.T[0].loading;
  assert.equal(r.sound.reloadAudio.size, 0);
  assert.equal(r.sound.reloadReady(r.guns[0], L, 0), true);
  assert.deepEqual(r.events, []);
});

test('a missing decoded lock stays silent and cannot authorize a substitute completion', () => {
  const r = fixture(), L = r.G.T[0].loading;
  delete r.sound.reloadSamples.de_manual_lock;
  loading.fired(L, 0); r.finish();
  assert.deepEqual(r.events, ['grab', 'load']); assert.equal(r.clicks, 0);
});

test('rejected mapped and unbound guns completing together keep separate policies', () => {
  const r = fixture({ mixed: true }), L = r.G.T[0].loading;
  loading.fired(L, 0); loading.fired(L, 1);
  r.sound.cancelReload(r.guns[0], true, L.waitedSince[0]); r.finish();
  assert.deepEqual(L.state, ['ready', 'ready']); assert.deepEqual(r.events, []); assert.equal(r.clicks, 1);
});

test('mapped loading resolved to empty emits neither actual-ready lock nor legacy fallback', () => {
  const r = fixture(), L = r.G.T[0].loading;
  loading.fired(L, 0); r.tick();
  for (const entry of r.guns[0].ammo) entry.count = 0;
  r.finish();
  assert.equal(L.state[0], 'empty'); assert.equal(r.events.includes('lock'), false); assert.equal(r.clicks, 0);
});
