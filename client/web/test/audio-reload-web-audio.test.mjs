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
const begin = source.indexOf('      G.loadout.turrets.forEach((t, ti) => {\n        t.guns.forEach((g) => tickLauncher');
const end = source.indexOf('\n      G.acc -= SIM_DT;', begin);
assert.ok(begin >= 0 && end > begin, 'actual main loading-rate and completion callback');

function fixture(failures = [], { synchronousEndOnStop = false } = {}) {
  const failing = new Set(failures), sources = [], gains = [], events = [];
  const fail = at => { if (failing.has(at)) throw new Error(`Injected ${at}`); };
  const sound = new Sound(); sound.master = {};
  sound.ctx = { state: 'running', createBufferSource() {
    fail('createBufferSource');
    let buffer, rate = 1, ended;
    const node = { playbackRate: {}, connect() { fail('source.connect'); },
      disconnect() { this.disconnectAttempts = (this.disconnectAttempts || 0) + 1; fail('source.disconnect'); this.disconnected = true; },
      start() { fail('source.start'); events.push(buffer.id); },
      stop() { this.stopAttempts = (this.stopAttempts || 0) + 1; fail('source.stop'); if (synchronousEndOnStop) ended?.(); } };
    Object.defineProperty(node, 'buffer', { get: () => buffer, set: value => { fail('source.buffer'); buffer = value; } });
    Object.defineProperty(node.playbackRate, 'value', { get: () => rate, set: value => { fail('source.rate'); rate = value; } });
    Object.defineProperty(node, 'onended', { get: () => ended, set: value => { fail('source.onended'); ended = value; } });
    sources.push(node); return node;
  }, createGain() {
    fail('createGain'); let value = 0;
    const node = { gain: {}, connect() { fail('gain.connect'); },
      disconnect() { this.disconnectAttempts = (this.disconnectAttempts || 0) + 1; fail('gain.disconnect'); this.disconnected = true; } };
    Object.defineProperty(node.gain, 'value', { get: () => value, set: v => { fail('gain.value'); value = v; } });
    gains.push(node); return node;
  }, createOscillator() { throw new Error('mapped failures cannot synthesize a substitute'); } };
  sound.loadReloadBank({ schemaVersion: 1, reviewState: 'reviewed', cues: {} });
  const buffers = () => { for (const phase of ['grab', 'load', 'lock']) sound.reloadSamples[`de_manual_${phase}`] = { id: phase, length: 100, numberOfChannels: 1 }; };
  buffers();
  const lo = loadout.makeLoadout('de_tiger_e', data.vehicles.de_tiger_e, data.projectiles, data.machineGuns);
  const G = { loadout: lo, T: [{ loading: loading.newLoading(1, 1) }], mode: 'battle', caps: null, online: null, gameplayMode: 'historical', model: { payload() {} } };
  let clicks = 0; sound.click = () => clicks++;
  const deps = { G, SIM_DT: 1 / 60, ...loadout, loading, sound, mountedReloadRate,
    clamp: (v, low, high) => Math.min(high, Math.max(low, v)), gunTrigger() { throw new Error('manual fixture'); } };
  const step = () => new Function(...Object.keys(deps), source.slice(begin, end))(...Object.values(deps));
  const finish = () => { for (let i = 0; i < 1000 && G.T[0].loading.state[0] !== 'ready'; i++) step(); };
  return { sound, failing, sources, gains, events, G, step, finish, buffers, get clicks() { return clicks; } };
}

for (const at of ['createBufferSource', 'createGain', 'source.buffer', 'source.rate', 'gain.value', 'source.connect', 'gain.connect', 'source.onended', 'source.start']) {
  test(`partial ${at} stays silent, advances actual work and releases every admission`, () => {
    const r = fixture([at]), L = r.G.T[0].loading;
    loading.fired(L, 0);
    assert.doesNotThrow(r.step);
    assert.equal(L.state[0], 'loading'); assert.ok(L.loaders[0].remaining < L.loaders[0].total);
    assert.doesNotThrow(r.finish);
    assert.equal(L.state[0], 'ready'); assert.deepEqual(r.events, []); assert.equal(r.clicks, 0);
    assert.equal(r.sound.reloadVoices.size, 0);
    assert.ok(r.sources.every(node => node.disconnectAttempts >= 1));
    assert.ok(r.gains.every(node => node.disconnectAttempts >= 1));
    assert.doesNotThrow(() => r.sound.cancelReloads()); assert.equal(r.sound.reloadAudio.size, 0);
  });
}

test('direct failed start returns silent null and repeated failures cannot exhaust the voice budget', () => {
  const r = fixture(['source.start']);
  for (let i = 0; i < 20; i++) {
    let voice;
    assert.doesNotThrow(() => { voice = r.sound._playReloadCue('de_manual_grab'); });
    assert.equal(voice, null); assert.equal(r.sound.reloadVoices.size, 0);
  }
  assert.ok(r.sources.every(node => node.disconnected)); assert.ok(r.gains.every(node => node.disconnected));
  r.failing.clear();
  const voices = Array.from({ length: 8 }, () => r.sound._playReloadCue('de_manual_grab'));
  assert.ok(voices.every(Boolean)); assert.equal(r.sound.reloadVoices.size, 8);
  assert.equal(r.sound._playReloadCue('de_manual_grab'), null);
  for (const voice of voices) assert.doesNotThrow(() => voice.stop());
  assert.equal(r.sound.reloadVoices.size, 0);
});

for (const failures of [['source.stop'], ['source.disconnect'], ['gain.disconnect'], ['source.stop', 'source.disconnect', 'gain.disconnect']]) {
  test(`teardown attempts independent cleanup and releases the actual job (${failures.join(', ')})`, () => {
    const r = fixture(), L = r.G.T[0].loading; loading.fired(L, 0); r.step();
    const lateEnd = r.sources[0].onended;
    for (const at of failures) r.failing.add(at);
    assert.doesNotThrow(() => r.sound.cancelReloads());
    assert.equal(r.sound.reloadVoices.size, 0); assert.equal(r.sound.reloadAudio.size, 0);
    assert.equal(r.sources[0].stopAttempts, 1);
    assert.equal(r.sources[0].disconnectAttempts, 1); assert.equal(r.gains[0].disconnectAttempts, 1);
    assert.equal(r.gains[0].gain.value, 0);
    assert.doesNotThrow(lateEnd); assert.doesNotThrow(() => r.sound.cancelReloads());
    assert.equal(r.sources[0].disconnectAttempts, 1); assert.equal(r.gains[0].disconnectAttempts, 1);
  });
}

for (const synchronousEndOnStop of [false, true]) test(`ended/cancel reentrancy clears admissions despite disconnect failures (${synchronousEndOnStop ? 'synchronous stop/end' : 'separate end'})`, () => {
  const r = fixture([], { synchronousEndOnStop }), L = r.G.T[0].loading; loading.fired(L, 0); r.step();
  const ended = r.sources[0].onended;
  r.failing.add('source.disconnect'); r.failing.add('gain.disconnect');
  if (synchronousEndOnStop) assert.doesNotThrow(() => r.sound.cancelReloads());
  else { assert.doesNotThrow(ended); assert.doesNotThrow(() => r.sound.cancelReloads()); }
  assert.equal(r.sound.reloadVoices.size, 0); assert.equal(r.sound.reloadAudio.size, 0);
  if (synchronousEndOnStop) assert.equal(r.sources[0].stopAttempts, 1);
  assert.doesNotThrow(ended);
  assert.equal(r.sources[0].disconnectAttempts, 1); assert.equal(r.gains[0].disconnectAttempts, 1);
});

test('repeated faulty cancellation and bank replacement release voices/jobs before the next bank', () => {
  const r = fixture();
  for (let i = 0; i < 12; i++) {
    r.failing.clear(); r.G.T[0].loading = loading.newLoading(1, 1);
    loading.fired(r.G.T[0].loading, 0); r.step();
    r.failing.add('source.stop'); r.failing.add('source.disconnect'); r.failing.add('gain.disconnect');
    assert.doesNotThrow(() => r.sound.loadReloadBank({ schemaVersion: 1, reviewState: 'reviewed', cues: {} }));
    assert.equal(r.sound.reloadVoices.size, 0); assert.equal(r.sound.reloadAudio.size, 0);
    r.buffers();
  }
  assert.equal(r.sources.length, 12);
  assert.ok(r.sources.every(node => node.disconnectAttempts >= 1)); assert.ok(r.gains.every(node => node.disconnectAttempts >= 1));
});

test('bank/session cancellation also releases admitted voices outside a returned job handle', () => {
  const r = fixture(); assert.ok(r.sound._playReloadCue('de_manual_grab'));
  r.failing.add('source.stop'); r.failing.add('source.disconnect'); r.failing.add('gain.disconnect');
  assert.doesNotThrow(() => r.sound.loadReloadBank({ schemaVersion: 1, reviewState: 'reviewed', cues: {} }));
  assert.equal(r.sound.reloadVoices.size, 0); assert.equal(r.sound.reloadAudio.size, 0);
  assert.equal(r.sources[0].disconnectAttempts, 1); assert.equal(r.gains[0].disconnectAttempts, 1);
});
